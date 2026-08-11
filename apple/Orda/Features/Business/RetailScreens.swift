import OrdaKit
import OrdaUI
import SwiftUI

#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

// ── Общее ────────────────────────────────────────────────────────────────────

/// Копирование в буфер. Промокод диктуют по телефону и вставляют в переписку —
/// перепечатывать восемь символов вручную незачем.
private func copyToClipboard(_ text: String) {
    #if os(iOS)
    UIPasteboard.general.string = text
    #elseif os(macOS)
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(text, forType: .string)
    #endif
}

/// Поле ввода в стиле карточек раздела.
private struct RetailField: View {
    let title: String
    let placeholder: String
    @Binding var text: String
    var isNumeric = false
    var isUppercased = false

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(title)
                .font(Typography.label)
                .foregroundStyle(Theme.textDim)
                .textCase(.uppercase)

            TextField(placeholder, text: $text)
                .textFieldStyle(.plain)
                .font(isUppercased ? Typography.body.monospaced() : Typography.callout)
                .foregroundStyle(Theme.text)
                .padding(Spacing.md)
                .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
                #if os(iOS)
                .autocorrectionDisabled()
                .textInputAutocapitalization(isUppercased ? .characters : .sentences)
                .keyboardType(isNumeric ? .decimalPad : .default)
                #endif
        }
    }
}

/// Необязательная дата: пока переключатель выключен, ограничения нет.
private struct OptionalDateField: View {
    let title: String
    @Binding var date: Date?

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Toggle(isOn: Binding(
                get: { date != nil },
                set: { date = $0 ? (date ?? Date()) : nil }
            )) {
                Text(title)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.textMuted)
            }

            if date != nil {
                DatePicker(
                    "",
                    selection: Binding(get: { date ?? Date() }, set: { date = $0 }),
                    displayedComponents: .date
                )
                .labelsHidden()
                .datePickerStyle(.compact)
            }
        }
    }
}

// ── Скидки и промокоды ───────────────────────────────────────────────────────

@MainActor
@Observable
final class DiscountsStore {
    private(set) var items: [Discount] = []
    private(set) var points: [Company] = []
    private(set) var isLoading = false
    private(set) var error: APIError?
    private(set) var actionError: String?
    private(set) var isSaving = false

    private let service: RetailService
    private let business: BusinessService

    init(api: APIClient) {
        service = RetailService(api: api)
        business = BusinessService(api: api)
    }

    var board: DiscountBoard { DiscountBoard(items) }

    func load() async {
        isLoading = true
        defer { isLoading = false }

        // Точки нужны только форме создания: без них экран остаётся рабочим,
        // поэтому их отказ не роняет загрузку скидок.
        if points.isEmpty {
            points = (try? await business.companies()) ?? []
        }

        do {
            items = try await service.discounts()
            error = nil
        } catch let apiError as APIError {
            error = apiError
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }

    func save(_ draft: DiscountDraft, editing existing: Discount?) async -> Bool {
        isSaving = true
        defer { isSaving = false }
        actionError = nil

        do {
            let saved: Discount
            if let existing {
                saved = try await service.updateDiscount(id: existing.id, draft: draft)
            } else {
                saved = try await service.createDiscount(draft)
            }
            replace(saved, previousID: existing?.id)
            Haptics.success()
            return true
        } catch let apiError as APIError {
            actionError = apiError.userMessage
            Haptics.error()
            return false
        } catch {
            actionError = error.localizedDescription
            Haptics.error()
            return false
        }
    }

    func setActive(_ discount: Discount, isActive: Bool) async {
        actionError = nil
        do {
            let saved = try await service.setDiscountActive(id: discount.id, isActive: isActive)
            replace(saved, previousID: discount.id)
            Haptics.tap()
        } catch let apiError as APIError {
            actionError = apiError.userMessage
            Haptics.error()
        } catch {
            actionError = error.localizedDescription
            Haptics.error()
        }
    }

    func delete(_ discount: Discount) async {
        actionError = nil
        do {
            try await service.deleteDiscount(id: discount.id)
            // Сервер не стирает строку, а гасит её — перечитываем, чтобы
            // скидка уехала в «не работают», а не пропала из истории.
            await load()
            Haptics.success()
        } catch let apiError as APIError {
            actionError = apiError.userMessage
            Haptics.error()
        } catch {
            actionError = error.localizedDescription
            Haptics.error()
        }
    }

    private func replace(_ discount: Discount, previousID: String?) {
        if let index = items.firstIndex(where: { $0.id == (previousID ?? discount.id) }) {
            items[index] = discount
        } else {
            items.insert(discount, at: 0)
        }
    }
}

/// Скидки и промокоды.
///
/// Владелец приходит сюда не за списком, а за ответом «что сейчас режет мой
/// чек». Поэтому наверху — действующие скидки и те, у которых на днях кончится
/// срок: продлевают их до конца срока, а не после жалобы клиента на кассе.
/// Истёкшие и выключенные лежат ниже — как история, а не как рабочий список.
struct DiscountsScreen: View {
    @Environment(\.api) private var api
    @Environment(\.access) private var access

    @State private var store: DiscountsStore?
    @State private var selected: Discount?
    @State private var filter: DiscountFilter = .working
    @State private var editing: DiscountEditTarget?

    private enum DiscountFilter: String, CaseIterable, Identifiable {
        case working, scheduled, stopped, all

        var id: String { rawValue }

        var title: String {
            switch self {
            case .working: "Действуют"
            case .scheduled: "Запланированы"
            case .stopped: "Не работают"
            case .all: "Все"
            }
        }
    }

    /// Что открыто в форме: новая скидка или существующая.
    private struct DiscountEditTarget: Identifiable {
        let discount: Discount?
        var id: String { discount?.id ?? "new" }
    }

    private var canCreate: Bool { access?.can("discounts.create") == true }
    private var canEdit: Bool { access?.can("discounts.edit") == true }
    private var canDelete: Bool { access?.can("discounts.delete") == true }
    private var canCopy: Bool { access?.can("discounts.copy_promo") == true }
    private var canGenerate: Bool { access?.can("discounts.generate_promo") == true }

    var body: some View {
        Group {
            if let store {
                if let error = store.error, store.items.isEmpty {
                    ErrorStateView(error: error) { Task { await store.load() } }
                } else if store.isLoading && store.items.isEmpty {
                    LoadingRows(count: 7)
                } else {
                    content(store)
                }
            } else {
                LoadingRows(count: 7)
            }
        }
        .background(Theme.background)
        .navigationTitle("Скидки")
        .toolbar {
            if canCreate {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        editing = DiscountEditTarget(discount: nil)
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            LogoutToolbarItem()
        }
        .task {
            if store == nil {
                let created = DiscountsStore(api: api)
                store = created
                await created.load()
            }
        }
        .refreshable { await store?.load() }
        .sheet(item: $editing) { target in
            if let store {
                DiscountFormSheet(
                    store: store,
                    discount: target.discount,
                    canGenerate: canGenerate
                )
            }
        }
    }

    @ViewBuilder
    private func content(_ store: DiscountsStore) -> some View {
        let board = store.board

        VStack(spacing: 0) {
            summary(board)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Spacing.sm) {
                    ForEach(DiscountFilter.allCases) { option in
                        FilterChip(title: option.title, isOn: filter == option) { filter = option }
                    }
                }
                .padding(.horizontal, Spacing.lg)
            }
            .padding(.bottom, Spacing.md)

            if let message = store.actionError {
                Text(message)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.negative)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, Spacing.lg)
                    .padding(.bottom, Spacing.sm)
            }

            MasterDetail(
                items: visible(board),
                selection: $selected,
                listWidth: 360
            ) { discount in
                DiscountRow(discount: discount)
            } detail: { discount in
                DiscountDetailView(
                    discount: discount,
                    store: store,
                    canEdit: canEdit && editable(discount),
                    canDelete: canDelete && editable(discount),
                    canCopy: canCopy,
                    onEdit: { editing = DiscountEditTarget(discount: discount) }
                )
            } empty: {
                WideEmptyState(
                    icon: "tag",
                    title: emptyTitle,
                    message: emptyMessage
                )
            }
        }
    }

    private func summary(_ board: DiscountBoard) -> some View {
        HStack(spacing: Spacing.md) {
            SummaryPill(title: "Действуют", value: "\(board.live.count)", tint: board.live.isEmpty ? Theme.textDim : Theme.brand)
            SummaryPill(
                title: "Промокоды",
                value: "\(board.livePromoCodes.count)",
                tint: board.livePromoCodes.isEmpty ? Theme.textDim : Theme.info
            )
            SummaryPill(
                title: "Скоро кончатся",
                value: "\(board.expiringSoon.count)",
                tint: board.expiringSoon.isEmpty ? Theme.positive : Theme.warning
            )
            if let deepest = board.deepestPercent {
                SummaryPill(title: "Максимум скидки", value: deepest.valueLabel, tint: Theme.warning)
            }
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.md)
    }

    private func visible(_ board: DiscountBoard) -> [Discount] {
        switch filter {
        case .working: board.live
        case .scheduled: board.scheduled
        case .stopped: board.expired + board.exhausted + board.disabled
        case .all: board.items
        }
    }

    /// Платформенную скидку (без точки) заводит суперадмин на все организации.
    /// Сервер отвечает `global-discount-forbidden` — кнопку показывать нельзя.
    private func editable(_ discount: Discount) -> Bool {
        !discount.isGlobal || access?.isAllAccess == true
    }

    private var emptyTitle: String {
        filter == .all ? "Скидок нет" : "Здесь пусто"
    }

    private var emptyMessage: String {
        switch filter {
        case .working: "Действующих скидок нет — чек проходит по полной цене."
        case .scheduled: "Скидок с будущей датой начала нет."
        case .stopped: "Все скидки в работе: ни одна не истекла и не выключена."
        case .all: "Скидки и промокоды создаются здесь же — кнопкой в правом верхнем углу."
        }
    }
}

private struct DiscountRow: View {
    let discount: Discount

    var body: some View {
        HStack(spacing: Spacing.md) {
            Image(systemName: discount.kind.icon)
                .font(.system(size: 14))
                .foregroundStyle(discount.state.isWorking ? Theme.brand : Theme.textDim)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 1) {
                Text(discount.name)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text(subtitle)
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 2) {
                Text(discount.valueLabel)
                    .font(Typography.callout.weight(.medium))
                    .monospacedDigit()
                    .foregroundStyle(Theme.text)
                StatusChip(discount.state.title, kind: stateKind)
            }
        }
        .contentShape(Rectangle())
    }

    private var stateKind: StatusChip.Kind {
        switch discount.state {
        case .live: .good
        case .scheduled: .info
        case .expired: .neutral
        case .exhausted: .warning
        case .disabled: .neutral
        }
    }

    private var subtitle: String {
        var parts = [discount.kind.title]
        if let code = discount.promoCode, !code.isEmpty { parts.append(code) }
        if let limit = discount.usageLimit {
            parts.append("\(discount.usageCount) из \(limit)")
        } else if discount.usageCount > 0 {
            parts.append("\(discount.usageCount) \(pluralize(discount.usageCount, "применение", "применения", "применений"))")
        }
        if let days = discount.daysLeft, days >= 0, days <= 7 {
            parts.append(days == 0 ? "последний день" : "\(days) \(pluralize(days, "день", "дня", "дней"))")
        }
        return parts.joined(separator: " · ")
    }
}

private struct DiscountDetailView: View {
    let discount: Discount
    let store: DiscountsStore
    let canEdit: Bool
    let canDelete: Bool
    let canCopy: Bool
    let onEdit: () -> Void

    @State private var isConfirmingDelete = false
    @State private var didCopy = false

    var body: some View {
        ScreenScroll {
            Card(accent: discount.state.isWorking ? Theme.brand : nil) {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            Text(discount.name)
                                .font(Typography.title)
                                .foregroundStyle(Theme.text)
                            Text(discount.kind.title)
                                .font(Typography.callout)
                                .foregroundStyle(Theme.textMuted)
                        }
                        Spacer()
                        StatusChip(discount.state.title, kind: discount.state.isWorking ? .good : .neutral)
                    }

                    RowDivider()

                    StatRow("Размер", value: discount.valueLabel, emphasized: true)
                    if discount.minOrderAmount > 0 {
                        StatRow("Минимальный чек", value: Money.format(discount.minOrderAmount), icon: "cart")
                    }
                    if discount.isGlobal {
                        StatusChip("платформенная — меняет только суперадмин", kind: .info)
                    }
                }
            }

            if let code = discount.promoCode, !code.isEmpty {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        SectionHeader("Промокод", subtitle: "его называют на кассе")

                        HStack(spacing: Spacing.md) {
                            Text(code)
                                .font(Typography.metric.monospaced())
                                .foregroundStyle(Theme.text)
                            Spacer()
                            if canCopy {
                                Button(didCopy ? "Скопировано" : "Копировать") {
                                    copyToClipboard(code)
                                    didCopy = true
                                    Haptics.tap()
                                }
                                .buttonStyle(SecondaryButtonStyle())
                                .fixedSize()
                            }
                        }
                    }
                }
            }

            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("Срок и лимит")

                    StatRow(
                        "Начало",
                        value: discount.validFrom.map { $0.formatted(.dateTime.day().month(.wide).year()) } ?? "без ограничения",
                        icon: "calendar"
                    )
                    StatRow(
                        "Окончание",
                        value: discount.validTo.map { $0.formatted(.dateTime.day().month(.wide).year()) } ?? "бессрочно",
                        valueColor: expiryColor,
                        icon: "calendar.badge.exclamationmark"
                    )

                    RowDivider()

                    if let limit = discount.usageLimit {
                        StatRow(
                            "Использований",
                            value: "\(discount.usageCount) из \(limit)",
                            valueColor: discount.isExhausted ? Theme.negative : Theme.text,
                            icon: "number"
                        )
                        if let share = discount.usageShare {
                            ProportionBar(ratio: share, color: discount.isExhausted ? Theme.negative : Theme.brand)
                        }
                    } else {
                        StatRow("Использований", value: "\(discount.usageCount) · без лимита", icon: "infinity")
                    }

                    if let created = discount.createdAt {
                        StatRow("Создана", value: created.formatted(.dateTime.day().month(.abbreviated).year()), icon: "clock")
                    }
                }
            }

            if canEdit || canDelete {
                Card {
                    VStack(spacing: Spacing.md) {
                        if canEdit {
                            Button(discount.isActive ? "Выключить скидку" : "Включить скидку") {
                                Task { await store.setActive(discount, isActive: !discount.isActive) }
                            }
                            .buttonStyle(SecondaryButtonStyle())

                            Button("Изменить", action: onEdit)
                                .buttonStyle(PrimaryButtonStyle())
                        }
                        if canDelete {
                            Button("Удалить") { isConfirmingDelete = true }
                                .buttonStyle(DestructiveButtonStyle())
                        }
                    }
                }
            }
        }
        .background(Theme.background)
        .navigationTitle(discount.name)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .confirmationDialog(
            "Удалить скидку?",
            isPresented: $isConfirmingDelete,
            titleVisibility: .visible
        ) {
            Button("Удалить", role: .destructive) {
                Task { await store.delete(discount) }
            }
            Button("Отмена", role: .cancel) {}
        } message: {
            Text("Скидка перестанет применяться, но останется в истории: по ней уже пробиты чеки, и ссылку на неё стирать нельзя.")
        }
        .onChange(of: discount.promoCode) { _, _ in didCopy = false }
    }

    private var expiryColor: Color {
        guard let days = discount.daysLeft else { return Theme.text }
        if days < 0 { return Theme.negative }
        return days <= 7 ? Theme.warning : Theme.text
    }
}

private struct DiscountFormSheet: View {
    let store: DiscountsStore
    let discount: Discount?
    let canGenerate: Bool

    @Environment(\.access) private var access
    @Environment(\.dismiss) private var dismiss

    @State private var draft = DiscountDraft()
    @State private var didPrepare = false

    private var isEditing: Bool { discount != nil }

    /// Скидку организации сервер требует привязать к точке — без неё
    /// `createDiscount` отвечает 400. Исключение только у суперадмина:
    /// он заводит платформенные скидки на всех.
    private var requiresPoint: Bool {
        !isEditing && access?.isAllAccess != true
    }

    private var pointError: String? {
        guard requiresPoint else { return nil }
        if store.points.isEmpty { return "Нет доступных точек — скидку не к чему привязать." }
        if draft.companyID == nil { return "Выберите точку." }
        return nil
    }

    private var blocker: String? { draft.validationError ?? pointError }

    var body: some View {
        NavigationStack {
            ScreenScroll {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        SectionHeader(isEditing ? "Изменить скидку" : "Новая скидка")

                        RetailField(title: "Название", placeholder: "Например: Скидка студентам", text: $draft.name)

                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            Text("Тип")
                                .font(Typography.label)
                                .foregroundStyle(Theme.textDim)
                                .textCase(.uppercase)
                            Picker("Тип", selection: $draft.kind) {
                                ForEach(DiscountKind.allCases) { kind in
                                    Text(kind.title).tag(kind)
                                }
                            }
                            .pickerStyle(.segmented)
                        }

                        RetailField(
                            title: draft.kind.isPercentBased ? "Процент" : "Сумма, ₸",
                            placeholder: draft.kind.isPercentBased ? "10" : "500",
                            text: $draft.value,
                            isNumeric: true
                        )

                        if draft.kind == .promoCode {
                            VStack(alignment: .leading, spacing: Spacing.sm) {
                                RetailField(
                                    title: "Промокод",
                                    placeholder: "SUMMER26",
                                    text: $draft.promoCode,
                                    isUppercased: true
                                )
                                if canGenerate {
                                    Button("Сгенерировать") {
                                        draft.promoCode = DiscountDraft.generatedPromoCode()
                                        Haptics.tap()
                                    }
                                    .buttonStyle(SecondaryButtonStyle())
                                }
                            }
                        }

                        RetailField(
                            title: "Минимальный чек, ₸",
                            placeholder: "Без ограничения",
                            text: $draft.minOrderAmount,
                            isNumeric: true
                        )
                    }
                }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        SectionHeader("Срок действия", subtitle: "без дат скидка работает бессрочно")
                        OptionalDateField(title: "Начало", date: $draft.validFrom)
                        RowDivider()
                        OptionalDateField(title: "Окончание", date: $draft.validTo)
                        RowDivider()
                        RetailField(
                            title: "Лимит использований",
                            placeholder: "Без ограничений",
                            text: $draft.usageLimit,
                            isNumeric: true
                        )
                    }
                }

                if requiresPoint && !store.points.isEmpty {
                    Card {
                        VStack(alignment: .leading, spacing: Spacing.md) {
                            SectionHeader("Точка", subtitle: "скидка действует только на ней")
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: Spacing.sm) {
                                    ForEach(store.points) { point in
                                        FilterChip(title: point.name, isOn: draft.companyID == point.id) {
                                            draft.companyID = point.id
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                if isEditing {
                    Card(accent: Theme.info) {
                        InlineEmpty(
                            icon: "info.circle.fill",
                            text: "Точку у существующей скидки поменять нельзя — заведите новую.",
                            tint: Theme.info
                        )
                    }
                }

                if let blocker {
                    Text(blocker)
                        .font(Typography.callout)
                        .foregroundStyle(Theme.warning)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                if let message = store.actionError {
                    Text(message)
                        .font(Typography.callout)
                        .foregroundStyle(Theme.negative)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                Button(store.isSaving ? "Сохраняем…" : "Сохранить") {
                    Task { if await store.save(draft, editing: discount) { dismiss() } }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(store.isSaving || blocker != nil)
            }
            .background(Theme.background)
            .navigationTitle(isEditing ? "Скидка" : "Новая скидка")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
            }
            .task {
                guard !didPrepare else { return }
                didPrepare = true
                if let discount {
                    draft = DiscountDraft(editing: discount)
                } else if store.points.count == 1 {
                    draft.companyID = store.points[0].id
                }
            }
        }
    }
}

// ── PS-станции и игровые проекты ─────────────────────────────────────────────

@MainActor
@Observable
final class StationsStore {
    private(set) var projects: [ArenaProjectRef] = []
    private(set) var board: ArenaBoard?
    private(set) var sessions: [ArenaSessionRow] = []
    private(set) var projectID: String?
    private(set) var pointID: String?
    private(set) var period: ArenaPeriod = .today
    private(set) var isLoading = false
    private(set) var isLoadingRevenue = false
    private(set) var error: APIError?
    private(set) var actionError: String?
    private(set) var busyStationID: String?

    /// Читать аналитику даёт отдельное право. Экран сообщает его сюда, чтобы
    /// стор не дёргал заведомо запрещённый запрос и не ловил 403 на каждой
    /// загрузке зала.
    var canReadRevenue = false

    private let service: RetailService

    init(api: APIClient) {
        service = RetailService(api: api)
    }

    var project: ArenaProjectRef? { projects.first { $0.id == projectID } }
    var revenue: ArenaRevenue { ArenaRevenue(sessions) }

    func load() async {
        isLoading = true
        defer { isLoading = false }

        do {
            if projects.isEmpty {
                projects = try await service.arenaProjects()
                projectID = projectID ?? projects.first?.id
            }
            guard let projectID else {
                board = nil
                error = nil
                return
            }
            board = try await service.arenaBoard(projectID: projectID, pointID: pointID)
            error = nil
        } catch let apiError as APIError {
            error = apiError
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }

        await loadRevenue()
    }

    func loadRevenue() async {
        guard canReadRevenue, let projectID else { return }
        isLoadingRevenue = true
        defer { isLoadingRevenue = false }
        // Отказ аналитики не должен ломать зал: станции важнее выручки.
        sessions = (try? await service.arenaSessions(projectID: projectID, pointID: pointID, period: period)) ?? []
    }

    func select(project: ArenaProjectRef) async {
        guard project.id != projectID else { return }
        projectID = project.id
        pointID = nil
        board = nil
        sessions = []
        await load()
    }

    func select(pointID: String?) async {
        guard pointID != self.pointID else { return }
        self.pointID = pointID
        board = nil
        sessions = []
        await load()
    }

    func select(period: ArenaPeriod) async {
        guard period != self.period else { return }
        self.period = period
        await loadRevenue()
    }

    func start(station: ArenaStation, tariff: ArenaTariff) async {
        guard let projectID else { return }
        busyStationID = station.id
        defer { busyStationID = nil }
        actionError = nil
        do {
            try await service.startArenaSession(
                stationID: station.id,
                tariffID: tariff.id,
                projectID: projectID,
                pointID: pointID
            )
            board = try? await service.arenaBoard(projectID: projectID, pointID: pointID)
            Haptics.success()
        } catch let apiError as APIError {
            actionError = message(for: apiError)
            Haptics.error()
        } catch {
            actionError = error.localizedDescription
            Haptics.error()
        }
    }

    func end(station: ArenaStation) async {
        guard let projectID else { return }
        busyStationID = station.id
        defer { busyStationID = nil }
        actionError = nil
        do {
            try await service.endArenaSession(stationID: station.id)
            board = try? await service.arenaBoard(projectID: projectID, pointID: pointID)
            await loadRevenue()
            Haptics.success()
        } catch let apiError as APIError {
            actionError = message(for: apiError)
            Haptics.error()
        } catch {
            actionError = error.localizedDescription
            Haptics.error()
        }
    }

    /// Коды сервера превращаем в человеческий текст: «station-already-occupied»
    /// на экране владельца ничего не объясняет.
    private func message(for error: APIError) -> String {
        switch error {
        case .conflict(let code, _) where code == "station-already-occupied":
            "Станция уже занята — обновите зал."
        case .notFound:
            "Активной сессии на станции нет."
        default:
            error.userMessage
        }
    }
}

/// PS-станции и игровые проекты.
///
/// Главный вопрос владельца о зале — «сколько станций сейчас работает и что
/// с ними не так». Поэтому сверху занятость, а тревожное вынесено отдельно:
/// сессия с вышедшим временем означает, что клиент играет бесплатно, а станция
/// без привязанных игр показывает киоску пустой экран.
struct StationsScreen: View {
    @Environment(\.api) private var api
    @Environment(\.access) private var access

    @State private var store: StationsStore?

    private var canStart: Bool { access?.can("stations.admin_start_session") == true }
    private var canEnd: Bool { access?.can("stations.admin_end_session") == true }

    var body: some View {
        ScreenScroll {
            if let store {
                if let error = store.error, store.board == nil {
                    ErrorStateView(error: error) { Task { await store.load() } }
                } else if store.isLoading && store.board == nil {
                    LoadingRows(count: 6)
                } else if store.projects.isEmpty {
                    WideEmptyState(
                        icon: "gamecontroller",
                        title: "Игровых проектов нет",
                        message: "Арена не включена ни на одном проекте. Флаг «арена» ставится проекту или точке в веб-кабинете."
                    )
                } else if let board = store.board {
                    content(store, board)
                } else {
                    LoadingRows(count: 6)
                }
            } else {
                LoadingRows(count: 6)
            }
        }
        .background(Theme.background)
        .navigationTitle("Станции")
        .toolbar { LogoutToolbarItem() }
        .task {
            if store == nil {
                let created = StationsStore(api: api)
                created.canReadRevenue = access?.can("stations.get_analytics") == true
                store = created
                await created.load()
            }
        }
        .refreshable { await store?.load() }
    }

    @ViewBuilder
    private func content(_ store: StationsStore, _ board: ArenaBoard) -> some View {
        pickers(store)

        if let message = store.actionError {
            Card(accent: Theme.negative) {
                InlineEmpty(icon: "exclamationmark.circle.fill", text: message, tint: Theme.negative)
            }
        }

        metrics(store, board)

        SplitDashboard {
            if board.groups.isEmpty {
                Card {
                    InlineEmpty(
                        icon: "rectangle.slash",
                        text: "В проекте нет станций — зоны и станции заводят в веб-кабинете",
                        tint: Theme.textDim
                    )
                }
            } else {
                ForEach(board.groups) { group in
                    zoneCard(store, board, group)
                }
            }
        } side: {
            alerts(board)
            if store.canReadRevenue {
                revenueCard(store, board)
            }
        }
    }

    // ── Выбор проекта и точки ────────────────────────────────────────────────

    @ViewBuilder
    private func pickers(_ store: StationsStore) -> some View {
        let points = store.project?.points ?? []

        if store.projects.count > 1 || points.count > 1 {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    if store.projects.count > 1 {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: Spacing.sm) {
                                ForEach(store.projects) { project in
                                    FilterChip(title: project.name, isOn: store.projectID == project.id) {
                                        Task { await store.select(project: project) }
                                    }
                                }
                            }
                        }
                    }

                    // Один проект может обслуживать несколько точек: зоны и
                    // станции у них разные, и смотреть их вперемешку бессмысленно.
                    if points.count > 1 {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: Spacing.sm) {
                                FilterChip(title: "Все точки", isOn: store.pointID == nil) {
                                    Task { await store.select(pointID: nil) }
                                }
                                ForEach(points) { point in
                                    FilterChip(title: point.name, isOn: store.pointID == point.id) {
                                        Task { await store.select(pointID: point.id) }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // ── Метрики ──────────────────────────────────────────────────────────────

    private func metrics(_ store: StationsStore, _ board: ArenaBoard) -> some View {
        let revenue = store.revenue

        return DashboardGrid {
            MetricTile(
                label: "Занято сейчас",
                value: "\(board.busyStations.count) из \(board.workingStations.count)",
                icon: "gamecontroller.fill",
                accent: board.busyStations.isEmpty ? Theme.textDim : Theme.brand
            )
            MetricTile(
                label: "Загрузка зала",
                value: board.load.map { Percent.format($0 * 100) } ?? "—",
                icon: "chart.pie.fill",
                accent: Theme.info
            )
            if !board.games.isEmpty {
                MetricTile(
                    label: "Игр в каталоге",
                    value: "\(board.games.filter(\.isActive).count)",
                    icon: "square.grid.2x2",
                    accent: Theme.textMuted
                )
            }
            if store.canReadRevenue {
                MetricTile(
                    label: "Выручка · \(store.period.title.lowercased())",
                    value: Money.format(revenue.amount),
                    icon: "banknote.fill",
                    accent: Theme.brand
                )
                MetricTile(
                    label: "Сессий",
                    value: "\(revenue.count)",
                    icon: "clock.arrow.circlepath",
                    accent: Theme.textMuted
                )
                MetricTile(
                    label: "Средний чек",
                    value: Money.format(revenue.averageCheck),
                    icon: "arrow.up.arrow.down",
                    accent: Theme.textMuted
                )
            }
        }
    }

    // ── Зоны и станции ───────────────────────────────────────────────────────

    private func zoneCard(_ store: StationsStore, _ board: ArenaBoard, _ group: ArenaZoneGroup) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader(group.title, subtitle: zoneSubtitle(group))

                if group.stations.isEmpty {
                    InlineEmpty(icon: "rectangle.slash", text: "В зоне нет станций", tint: Theme.textDim)
                } else {
                    ForEach(Array(group.stations.enumerated()), id: \.element.id) { index, station in
                        if index > 0 { RowDivider() }
                        ArenaStationRow(
                            station: station,
                            tariffs: board.zoneTariffs(for: station),
                            isBusy: store.busyStationID == station.id,
                            canStart: canStart,
                            canEnd: canEnd,
                            onStart: { tariff in Task { await store.start(station: station, tariff: tariff) } },
                            onEnd: { Task { await store.end(station: station) } }
                        )
                    }
                }

                if !group.activeTariffs.isEmpty {
                    RowDivider()
                    Text("Тарифы")
                        .font(Typography.label)
                        .foregroundStyle(Theme.textDim)
                        .textCase(.uppercase)
                    ForEach(group.activeTariffs) { tariff in
                        StatRow(
                            tariffLabel(tariff),
                            value: Money.format(tariff.price),
                            icon: tariff.isWindowed ? "clock.badge" : "tag"
                        )
                    }
                }
            }
        }
    }

    private func zoneSubtitle(_ group: ArenaZoneGroup) -> String {
        var parts = ["\(group.busy.count) из \(group.stations.filter(\.isActive).count) занято"]
        if let load = group.load { parts.append(Percent.format(load * 100)) }
        if let hourly = group.zone?.extensionHourlyPrice, hourly > 0 {
            parts.append("продление \(Money.format(hourly))/ч")
        }
        return parts.joined(separator: " · ")
    }

    /// Цена часа рядом с ценой тарифа: только по ней видно, что «три часа»
    /// дешевле трёх часовых — или дороже, и тариф пора пересчитать.
    private func tariffLabel(_ tariff: ArenaTariff) -> String {
        var text = "\(tariff.name) · \(tariff.durationLabel)"
        if let hourly = tariff.hourlyPrice, tariff.durationMinutes != 60 {
            text += " · \(Money.format(hourly))/ч"
        }
        if let window = tariff.windowLabel { text += " · \(window)" }
        return text
    }

    // ── Тревожное ────────────────────────────────────────────────────────────

    @ViewBuilder
    private func alerts(_ board: ArenaBoard) -> some View {
        let overdue = board.overdueStations()
        let silent = board.silentStations()
        let withoutGames = board.stationsWithoutGames

        if !overdue.isEmpty {
            Card(accent: Theme.negative) {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    SectionHeader("Время вышло", subtitle: "сессия не закрыта — станция играет бесплатно")
                    ForEach(overdue) { station in
                        StatRow(
                            station.name,
                            value: overdueLabel(station),
                            valueColor: Theme.negative,
                            icon: "exclamationmark.triangle.fill"
                        )
                    }
                }
            }
        }

        if !silent.isEmpty {
            Card(accent: Theme.warning) {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    SectionHeader("Киоск молчит", subtitle: "нет сигнала больше 15 минут")
                    ForEach(silent) { station in
                        StatRow(
                            station.name,
                            value: station.lastHeartbeatAt.map { $0.formatted(.dateTime.day().month(.abbreviated).hour().minute()) } ?? "—",
                            valueColor: Theme.warning,
                            icon: "wifi.slash"
                        )
                    }
                }
            }
        }

        if !withoutGames.isEmpty {
            Card(accent: Theme.warning) {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    SectionHeader("Без игр", subtitle: "киоск покажет пустой список")
                    ForEach(withoutGames) { station in
                        StatRow(station.name, value: "игр нет", valueColor: Theme.warning, icon: "questionmark.folder")
                    }
                }
            }
        }

        if overdue.isEmpty && silent.isEmpty && withoutGames.isEmpty {
            Card(accent: Theme.positive) {
                InlineEmpty(
                    icon: "checkmark.circle.fill",
                    text: "Зал в порядке: просроченных сессий и молчащих киосков нет",
                    tint: Theme.positive
                )
            }
        }
    }

    private func overdueLabel(_ station: ArenaStation) -> String {
        guard let remaining = station.remainingMinutes() else { return "—" }
        let over = abs(remaining)
        return "переигрывает \(over) \(pluralize(over, "минуту", "минуты", "минут"))"
    }

    // ── Выручка ──────────────────────────────────────────────────────────────

    @ViewBuilder
    private func revenueCard(_ store: StationsStore, _ board: ArenaBoard) -> some View {
        let revenue = store.revenue

        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Выручка зала", subtitle: "по завершённым сессиям")

                HStack(spacing: Spacing.sm) {
                    ForEach(ArenaPeriod.allCases) { period in
                        FilterChip(title: period.title, isOn: store.period == period) {
                            Task { await store.select(period: period) }
                        }
                    }
                    Spacer(minLength: 0)
                }

                if store.isLoadingRevenue && revenue.count == 0 {
                    Skeleton(height: 44, cornerRadius: Radius.md)
                } else if revenue.count == 0 {
                    InlineEmpty(icon: "clock", text: "За период сессий не было", tint: Theme.textDim)
                } else {
                    StatRow("Выручка", value: Money.format(revenue.amount), emphasized: true)
                    StatRow("Наличные", value: Money.format(revenue.cash), icon: "banknote")
                    StatRow("Безналичный", value: Money.format(revenue.kaspi), icon: "qrcode")
                    if let occupancy = revenue.occupancy(
                        stationCount: board.workingStations.count,
                        days: store.period.days
                    ) {
                        RowDivider()
                        StatRow("Загрузка за период", value: Percent.format(occupancy * 100), icon: "chart.bar")
                        Text("Проданные часы против календарных — ночь и утро в знаменателе тоже есть.")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                    }
                }
            }
        }

        if !revenue.byStation.isEmpty {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("Кто заработал", subtitle: "станции по выручке")
                    ForEach(Array(revenue.byStation.prefix(8).enumerated()), id: \.element.id) { index, share in
                        if index > 0 { RowDivider() }
                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            StatRow(share.name, value: Money.format(share.amount))
                            Text("\(share.count) \(pluralize(share.count, "сессия", "сессии", "сессий")) · \(share.minutes / 60) ч")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textDim)
                        }
                    }
                }
            }
        }

        if store.period != .today && revenue.byDay.count > 1 {
            let peak = revenue.byDay.map(\.amount).max()
            CategoryBarChart(
                title: "Выручка по дням",
                points: revenue.byDay.map {
                    CategoryPoint(
                        label: $0.day.formatted(.dateTime.day().month(.abbreviated)),
                        value: $0.amount,
                        isHighlighted: $0.amount == peak
                    )
                }
            )
        }
    }
}

private struct ArenaStationRow: View {
    let station: ArenaStation
    let tariffs: [ArenaTariff]
    let isBusy: Bool
    let canStart: Bool
    let canEnd: Bool
    let onStart: (ArenaTariff) -> Void
    let onEnd: () -> Void

    var body: some View {
        HStack(spacing: Spacing.md) {
            Image(systemName: station.isBusy ? "gamecontroller.fill" : "gamecontroller")
                .font(.system(size: 14))
                .foregroundStyle(iconColor)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 1) {
                Text(station.name)
                    .font(Typography.callout)
                    .foregroundStyle(station.isActive ? Theme.text : Theme.textDim)
                    .lineLimit(1)
                Text(subtitle)
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }

            Spacer(minLength: Spacing.sm)

            StatusChip(statusText, kind: statusKind)

            if isBusy {
                ProgressView().controlSize(.small)
            } else if hasActions {
                Menu {
                    if station.isBusy {
                        if canEnd {
                            Button("Завершить сессию", role: .destructive, action: onEnd)
                        }
                    } else if canStart {
                        if tariffs.isEmpty {
                            Text("У зоны нет активных тарифов")
                        } else {
                            ForEach(tariffs) { tariff in
                                Button("\(tariff.name) · \(tariff.durationLabel) · \(Money.format(tariff.price))") {
                                    onStart(tariff)
                                }
                            }
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.system(size: 15))
                        .foregroundStyle(Theme.textDim)
                }
                .buttonStyle(.plain)
                .fixedSize()
            }
        }
    }

    private var hasActions: Bool {
        station.isActive && (station.isBusy ? canEnd : canStart)
    }

    private var iconColor: Color {
        if !station.isActive { return Theme.textDim }
        if station.isOverdue() { return Theme.negative }
        return station.isBusy ? Theme.brand : Theme.textMuted
    }

    private var statusText: String {
        if !station.isActive { return "выключена" }
        guard station.isBusy else { return "свободна" }
        guard let remaining = station.remainingMinutes() else { return "занята" }
        return remaining >= 0 ? "\(remaining) мин" : "время вышло"
    }

    private var statusKind: StatusChip.Kind {
        if !station.isActive { return .neutral }
        guard station.isBusy else { return .good }
        return station.isOverdue() ? .danger : .info
    }

    private var subtitle: String {
        var parts: [String] = []
        if let code = station.stationCode, !code.isEmpty { parts.append(code) }
        if station.isUnbound {
            parts.append("без киоска")
        } else if let ip = station.deviceIP, !ip.isEmpty {
            parts.append(ip)
        }
        if parts.isEmpty { parts.append("станция") }
        return parts.joined(separator: " · ")
    }
}

// ── Настройки магазина ───────────────────────────────────────────────────────

@MainActor
@Observable
final class StoreSettingsStore {
    private(set) var config: RetailConfig?
    private(set) var isLoading = false
    private(set) var isSaving = false
    private(set) var error: APIError?
    private(set) var actionError: String?
    private(set) var savedMessage: String?

    /// Что отмечено на экране. Сохраняем не по каждому нажатию, а целиком:
    /// сервер трактует список как полный и гасит всё, чего в нём нет.
    var selected: Set<String> = []
    private(set) var saved: Set<String> = []

    private let service: RetailService

    init(api: APIClient) {
        service = RetailService(api: api)
    }

    var isDirty: Bool { selected != saved }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let loaded = try await service.storeConfig()
            config = loaded
            let ids = Set(loaded.storePoints.map(\.id))
            selected = ids
            saved = ids
            error = nil
        } catch let apiError as APIError {
            error = apiError
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }

    func toggle(_ point: RetailPoint) {
        if selected.contains(point.id) {
            selected.remove(point.id)
        } else {
            selected.insert(point.id)
        }
    }

    func save() async {
        isSaving = true
        defer { isSaving = false }
        actionError = nil
        savedMessage = nil
        do {
            try await service.saveStorePoints(ids: Array(selected))
            saved = selected
            savedMessage = "Сохранено"
            Haptics.success()
            await load()
        } catch let apiError as APIError {
            actionError = apiError.userMessage
            Haptics.error()
        } catch {
            actionError = error.localizedDescription
            Haptics.error()
        }
    }

    func setDefault(_ point: RetailPoint?) async {
        actionError = nil
        do {
            try await service.setDefaultStorePoint(id: point?.id)
            await load()
            Haptics.tap()
        } catch let apiError as APIError {
            actionError = apiError.userMessage
            Haptics.error()
        } catch {
            actionError = error.localizedDescription
            Haptics.error()
        }
    }
}

/// Настройки магазина.
///
/// Здесь решается ровно одно, но с далеко идущими последствиями: какие точки
/// работают как магазин. У каждой такой точки свой каталог, склад, витрина и
/// касса — данные между точками изолированы. Снятая галочка не удаляет товары,
/// но убирает точку из всего модуля, поэтому список отмеченных сохраняется
/// целиком и с явным подтверждением.
struct StoreSettingsScreen: View {
    @Environment(\.api) private var api
    @Environment(\.access) private var access

    @State private var store: StoreSettingsStore?

    private var canEdit: Bool { access?.can("store-settings.edit") == true }

    var body: some View {
        ScreenScroll {
            if let store {
                if let error = store.error, store.config == nil {
                    ErrorStateView(error: error) { Task { await store.load() } }
                } else if let config = store.config {
                    content(store, config)
                } else {
                    LoadingRows(count: 5)
                }
            } else {
                LoadingRows(count: 5)
            }
        }
        .background(Theme.background)
        .navigationTitle("Настройки магазина")
        .toolbar { LogoutToolbarItem() }
        .task {
            if store == nil {
                let created = StoreSettingsStore(api: api)
                store = created
                await created.load()
            }
        }
        .refreshable { await store?.load() }
    }

    @ViewBuilder
    private func content(_ store: StoreSettingsStore, _ config: RetailConfig) -> some View {
        let isManager = config.canManage && canEdit

        if config.points.isEmpty {
            WideEmptyState(
                icon: "building.2",
                title: "Точек нет",
                message: "Магазином становится точка. Создайте её в настройках компаний — потом отметите здесь."
            )
        } else {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader(
                        "Точки-магазины",
                        subtitle: "\(store.selected.count) из \(config.points.count) отмечено"
                    )

                    Text("У каждого магазина свои товары, склад, техкарты и касса — данные между точками не смешиваются.")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    ForEach(Array(config.points.enumerated()), id: \.element.id) { index, point in
                        if index > 0 { RowDivider() }
                        RetailPointToggleRow(
                            point: point,
                            isOn: store.selected.contains(point.id),
                            isEnabled: isManager
                        ) {
                            store.toggle(point)
                        }
                    }

                    if store.isDirty {
                        RowDivider()
                        if !removed(store, config).isEmpty {
                            InlineEmpty(
                                icon: "exclamationmark.triangle.fill",
                                text: "Снимутся: \(removed(store, config).map(\.name).joined(separator: ", ")). Товары останутся в базе, но точка исчезнет из модуля «Магазин».",
                                tint: Theme.warning
                            )
                        }
                        Button(store.isSaving ? "Сохраняем…" : "Сохранить") {
                            Task { await store.save() }
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(store.isSaving || !isManager)
                    }

                    if let message = store.savedMessage, !store.isDirty {
                        Text(message)
                            .font(Typography.callout)
                            .foregroundStyle(Theme.positive)
                    }
                    if let message = store.actionError {
                        Text(message)
                            .font(Typography.callout)
                            .foregroundStyle(Theme.negative)
                    }
                    if !isManager {
                        InlineEmpty(
                            icon: "lock.fill",
                            text: "Менять настройки может владелец или менеджер с правом «Изменить настройки магазина»",
                            tint: Theme.textDim
                        )
                    }
                }
            }

            defaultPointCard(store, config, isManager: isManager)
        }
    }

    private func defaultPointCard(_ store: StoreSettingsStore, _ config: RetailConfig, isManager: Bool) -> some View {
        Card(accent: config.needsDefaultPoint ? Theme.warning : nil) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Стартовая точка", subtitle: "с неё открывается модуль и сменные отчёты")

                if config.storePoints.isEmpty {
                    InlineEmpty(icon: "storefront", text: "Сначала отметьте хотя бы одну точку-магазин", tint: Theme.textDim)
                } else {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: Spacing.sm) {
                            ForEach(config.storePoints) { point in
                                FilterChip(title: point.name, isOn: config.defaultPointID == point.id) {
                                    guard isManager else { return }
                                    Task { await store.setDefault(point) }
                                }
                            }
                        }
                    }

                    if config.needsDefaultPoint {
                        InlineEmpty(
                            icon: "exclamationmark.triangle.fill",
                            text: "Точка не выбрана — раздел «Смены магазина» не поймёт, чью кассу показывать",
                            tint: Theme.warning
                        )
                    }
                }
            }
        }
    }

    /// Точки, которые снимутся при сохранении. Их стоит назвать по именам:
    /// список идентификаторов ничего не объясняет, а последствия ощутимые.
    private func removed(_ store: StoreSettingsStore, _ config: RetailConfig) -> [RetailPoint] {
        config.points.filter { store.saved.contains($0.id) && !store.selected.contains($0.id) }
    }
}

private struct RetailPointToggleRow: View {
    let point: RetailPoint
    let isOn: Bool
    let isEnabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: { if isEnabled { action() } }) {
            HStack(spacing: Spacing.md) {
                Image(systemName: isOn ? "checkmark.square.fill" : "square")
                    .font(.system(size: 18))
                    .foregroundStyle(isOn ? Theme.brand : Theme.textDim)

                VStack(alignment: .leading, spacing: 1) {
                    Text(point.name)
                        .font(Typography.callout)
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                    if let code = point.code, !code.isEmpty {
                        Text(code)
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                    }
                }

                Spacer(minLength: Spacing.sm)

                if isOn {
                    StatusChip("магазин", kind: .good)
                }
            }
            .contentShape(Rectangle())
            .opacity(isEnabled ? 1 : 0.6)
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
    }
}

// ── Сменные отчёты магазина ──────────────────────────────────────────────────

@MainActor
@Observable
final class StoreShiftsStore {
    private(set) var points: [RetailPoint] = []
    private(set) var pointID: String?
    private(set) var shifts: [ShiftReport] = []
    private(set) var filter: ShiftFilter = .closed
    private(set) var isLoading = false
    private(set) var error: APIError?
    /// Магазин ещё не настроен — это не ошибка загрузки, а незаконченная
    /// настройка, и вести человека надо в другое место.
    private(set) var needsSetup = false

    private(set) var reports: [String: ZReport] = [:]
    private(set) var loadingReportID: String?
    private(set) var reportErrors: [String: String] = [:]

    private let service: RetailService

    init(api: APIClient) {
        service = RetailService(api: api)
    }

    var pointName: String? { points.first { $0.id == pointID }?.name }

    func load() async {
        isLoading = true
        defer { isLoading = false }

        do {
            if points.isEmpty {
                let config = try await service.storeConfig()
                points = config.storePoints
                pointID = pointID ?? config.defaultPointID ?? points.first?.id
            }
            guard let pointID else {
                needsSetup = true
                shifts = []
                error = nil
                return
            }
            needsSetup = false
            shifts = try await service.storeShifts(pointID: pointID, filter: filter)
            error = nil
        } catch let apiError as APIError {
            error = apiError
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }

    func select(filter: ShiftFilter) async {
        guard filter != self.filter else { return }
        self.filter = filter
        shifts = []
        await load()
    }

    func select(pointID: String) async {
        guard pointID != self.pointID else { return }
        self.pointID = pointID
        shifts = []
        reports = [:]
        await load()
    }

    /// Z-отчёт грузим по одной смене и запоминаем: он считается по всем
    /// продажам смены и на большой точке недёшев.
    func loadReport(shiftID: String) async {
        guard reports[shiftID] == nil, loadingReportID != shiftID else { return }
        loadingReportID = shiftID
        defer { loadingReportID = nil }
        reportErrors[shiftID] = nil
        do {
            if let report = try await service.zReport(shiftID: shiftID) {
                reports[shiftID] = report
            } else {
                reportErrors[shiftID] = "Отчёт по смене не сформировался"
            }
        } catch let apiError as APIError {
            reportErrors[shiftID] = apiError.userMessage
        } catch {
            reportErrors[shiftID] = error.localizedDescription
        }
    }
}

/// Сменные отчёты магазина.
///
/// Отличие от общих «Отчётов смен» — глубина: здесь у каждой смены есть
/// Z-отчёт, тот самый, что печатают на A4. В нём видно не только сколько
/// сдали, но и что именно продали, что закончилось на полке и сколько унесли
/// в долг — а долг в выручку не входит и на кассе не виден.
struct StoreShiftsScreen: View {
    @Environment(\.api) private var api
    @State private var store: StoreShiftsStore?
    @State private var selected: ShiftReport?

    var body: some View {
        Group {
            if let store {
                if let error = store.error, store.shifts.isEmpty {
                    ErrorStateView(error: error) { Task { await store.load() } }
                } else if store.needsSetup {
                    WideEmptyState(
                        icon: "storefront",
                        title: "Магазин не выбран",
                        message: "Сменные отчёты показываются по точке-магазину. Отметьте её в «Настройках магазина» и назначьте стартовой."
                    )
                } else if store.isLoading && store.shifts.isEmpty {
                    LoadingRows(count: 7)
                } else {
                    content(store)
                }
            } else {
                LoadingRows(count: 7)
            }
        }
        .background(Theme.background)
        .navigationTitle("Смены магазина")
        .toolbar { LogoutToolbarItem() }
        .task {
            if store == nil {
                let created = StoreShiftsStore(api: api)
                store = created
                await created.load()
            }
        }
        .refreshable { await store?.load() }
    }

    private func content(_ store: StoreShiftsStore) -> some View {
        VStack(spacing: 0) {
            summary(store)
            filters(store)

            MasterDetail(
                items: store.shifts,
                selection: $selected,
                listWidth: 340
            ) { shift in
                StoreShiftRow(shift: shift)
            } detail: { shift in
                StoreShiftDetailView(shift: shift, store: store)
            } empty: {
                WideEmptyState(
                    icon: "calendar.badge.clock",
                    title: "Смен нет",
                    message: emptyMessage(store)
                )
            }
        }
    }

    private func summary(_ store: StoreShiftsStore) -> some View {
        let open = store.shifts.filter(\.isOpen)
        let revenue = store.shifts.reduce(0) { $0 + $1.totals.sales }
        let discrepancies = store.shifts.filter { abs($0.cashDifference ?? 0) > 1 }

        return Group {
            if !store.shifts.isEmpty {
                HStack(spacing: Spacing.md) {
                    SummaryPill(title: "Смен", value: "\(store.shifts.count)", tint: Theme.textMuted)
                    SummaryPill(title: "Выручка", value: Money.format(revenue), tint: Theme.brand)
                    SummaryPill(
                        title: "Открыто сейчас",
                        value: "\(open.count)",
                        tint: open.isEmpty ? Theme.textDim : Theme.info
                    )
                    SummaryPill(
                        title: "С расхождением",
                        value: "\(discrepancies.count)",
                        tint: discrepancies.isEmpty ? Theme.positive : Theme.warning
                    )
                }
                .padding(.horizontal, Spacing.lg)
                .padding(.vertical, Spacing.md)
            }
        }
    }

    @ViewBuilder
    private func filters(_ store: StoreShiftsStore) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack(spacing: Spacing.sm) {
                ForEach(ShiftFilter.allCases) { option in
                    FilterChip(title: option.title, isOn: store.filter == option) {
                        Task { await store.select(filter: option) }
                    }
                }
                Spacer(minLength: 0)
            }

            if store.points.count > 1 {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Spacing.sm) {
                        ForEach(store.points) { point in
                            FilterChip(title: point.name, isOn: store.pointID == point.id) {
                                Task { await store.select(pointID: point.id) }
                            }
                        }
                    }
                }
            }
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.bottom, Spacing.md)
    }

    private func emptyMessage(_ store: StoreShiftsStore) -> String {
        let point = store.pointName.map { " на точке «\($0)»" } ?? ""
        return switch store.filter {
        case .closed: "Закрытых смен\(point) пока нет."
        case .open: "Открытых смен\(point) сейчас нет."
        case .all: "Смены\(point) ещё не открывали."
        }
    }
}

private struct StoreShiftRow: View {
    let shift: ShiftReport

    var body: some View {
        HStack(spacing: Spacing.md) {
            Image(systemName: shift.isOpen ? "play.circle.fill" : "checkmark.circle.fill")
                .font(.system(size: 15))
                .foregroundStyle(shift.isOpen ? Theme.info : Theme.positive)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text(subtitle)
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 2) {
                Text(Money.format(shift.totals.sales))
                    .font(Typography.callout.weight(.medium))
                    .monospacedDigit()
                    .foregroundStyle(Theme.text)
                if let difference = shift.cashDifference, abs(difference) > 1 {
                    StatusChip(Money.signed(difference), kind: difference < 0 ? .danger : .warning)
                }
            }
        }
        .contentShape(Rectangle())
    }

    private var title: String {
        shift.openedAt.map { $0.formatted(.dateTime.day().month(.abbreviated).year()) } ?? "Смена"
    }

    private var subtitle: String {
        var parts = [shift.typeLabel]
        if let opened = shift.openedAt {
            parts.append(opened.formatted(.dateTime.hour().minute()))
        }
        parts.append("\(shift.totals.count) \(pluralize(shift.totals.count, "чек", "чека", "чеков"))")
        return parts.joined(separator: " · ")
    }
}

/// Z-отчёт смены.
private struct StoreShiftDetailView: View {
    let shift: ShiftReport
    let store: StoreShiftsStore

    var body: some View {
        ScreenScroll {
            header

            if let report = store.reports[shift.id] {
                zReport(report)
            } else if let message = store.reportErrors[shift.id] {
                Card(accent: Theme.negative) {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        InlineEmpty(icon: "doc.text.magnifyingglass", text: message, tint: Theme.negative)
                        Button("Повторить") {
                            Task { await store.loadReport(shiftID: shift.id) }
                        }
                        .buttonStyle(SecondaryButtonStyle())
                    }
                }
            } else {
                Card {
                    VStack(spacing: Spacing.md) {
                        Skeleton(height: 44, cornerRadius: Radius.md)
                        Skeleton(height: 44, cornerRadius: Radius.md)
                        Skeleton(height: 120, cornerRadius: Radius.md)
                    }
                }
            }
        }
        .background(Theme.background)
        .navigationTitle(shift.openedAt.map { $0.formatted(.dateTime.day().month(.abbreviated)) } ?? "Смена")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task(id: shift.id) { await store.loadReport(shiftID: shift.id) }
    }

    private var header: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        Text(shift.companyName ?? "Точка")
                            .font(Typography.title)
                            .foregroundStyle(Theme.text)
                        Text(shift.typeLabel)
                            .font(Typography.callout)
                            .foregroundStyle(Theme.textMuted)
                    }
                    Spacer()
                    StatusChip(shift.statusLabel, kind: shift.isOpen ? .info : .good)
                }

                RowDivider()
                if let opened = shift.openedAt {
                    StatRow("Открыта", value: opened.formatted(.dateTime.day().month(.wide).hour().minute()), icon: "play")
                }
                if let closed = shift.closedAt {
                    StatRow("Закрыта", value: closed.formatted(.dateTime.day().month(.wide).hour().minute()), icon: "stop")
                }
            }
        }
    }

    @ViewBuilder
    private func zReport(_ report: ZReport) -> some View {
        DashboardGrid {
            MetricTile(
                label: "Итог смены",
                value: Money.format(report.total),
                icon: "sum",
                accent: Theme.brand
            )
            MetricTile(
                label: "Чеков",
                value: "\(report.checkCount)",
                icon: "receipt",
                accent: Theme.textMuted
            )
            MetricTile(
                label: "Средний чек",
                value: Money.format(report.averageCheck),
                icon: "arrow.up.arrow.down",
                accent: Theme.info
            )
            MetricTile(
                label: "Возвраты",
                value: Money.format(report.returns),
                icon: "arrow.uturn.left",
                accent: report.returns > 0 ? Theme.warning : Theme.textDim
            )
        }

        SplitDashboard {
            positionsCard(report)
            if !report.debts.isEmpty {
                debtsCard(report)
            }
        } side: {
            cashCard(report)
            shiftCard(report)
            requisitesCard(report)
        }
    }

    private func cashCard(_ report: ZReport) -> some View {
        let difference = report.cashDifference

        return Card(accent: report.isClosed && abs(difference) > 1 ? Theme.warning : nil) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Касса", subtitle: "чем платили и что осталось в ящике")

                SplitBar(segments: [
                    .init(label: "Наличные", value: report.cashSales, color: ChartPalette.series1),
                    .init(label: "Безналичный", value: report.kaspiSales, color: ChartPalette.series2),
                ])

                StatRow("Наличные", value: Money.format(report.cashSales), icon: "banknote")
                Text("\(report.cashCount) \(pluralize(report.cashCount, "чек", "чека", "чеков"))")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
                StatRow("Безналичный", value: Money.format(report.kaspiSales), icon: "qrcode")
                Text("\(report.kaspiCount) \(pluralize(report.kaspiCount, "чек", "чека", "чеков"))")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)

                RowDivider()
                StatRow("Старт кассы", value: Money.format(report.openingCash), icon: "tray.and.arrow.down")
                StatRow("Конец смены", value: Money.format(report.closingCash), icon: "tray.and.arrow.up")

                // Расхождение считаем только у закрытой смены: на середине
                // наличные ещё в обороте, и «недостача» там ничего не значит.
                if report.isClosed {
                    StatRow(
                        "Должно быть",
                        value: Money.format(report.expectedCash),
                        valueColor: Theme.textMuted
                    )
                    StatRow(
                        "Расхождение",
                        value: Money.signed(difference),
                        valueColor: abs(difference) <= 1 ? Theme.positive : (difference < 0 ? Theme.negative : Theme.warning),
                        emphasized: true
                    )
                    if abs(difference) > 1 {
                        Text("Возвраты сервер отдаёт одной суммой, без разбивки по способу оплаты — если возвращали безналом, часть расхождения объясняется этим.")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                    }
                }
            }
        }
    }

    private func shiftCard(_ report: ZReport) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Смена №\(report.shiftNumber)", subtitle: report.pointName)
                StatRow("Кассир", value: report.cashier, icon: "person")
                if let duration = report.durationLabel {
                    StatRow("Длительность", value: duration, icon: "clock")
                }
                StatRow("Позиций продано", value: Quantity.format(report.soldUnits), icon: "shippingbox")
                StatRow("Наименований", value: "\(report.positions.count)", icon: "list.bullet")
                StatRow("Товаров на сумму", value: Money.format(report.goodsTotal), icon: "cart")

                // Публичная страница смены: её можно отправить бухгалтеру или
                // партнёру, не давая доступ в кабинет.
                if let url = URL(string: report.onlineURL), !report.onlineURL.isEmpty {
                    RowDivider()
                    Link(destination: url) {
                        Label("Онлайн-версия отчёта", systemImage: "link")
                            .font(Typography.callout.weight(.medium))
                            .foregroundStyle(Theme.brand)
                    }
                }
            }
        }
    }

    private func positionsCard(_ report: ZReport) -> some View {
        let positions = report.topPositions

        return Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader(
                    "Что продали",
                    subtitle: "\(positions.count) \(pluralize(positions.count, "наименование", "наименования", "наименований"))"
                )

                if positions.isEmpty {
                    InlineEmpty(icon: "tray", text: "Продаж по позициям не было", tint: Theme.textDim)
                } else {
                    // Разные товары могут совпасть по имени (свободные строки
                    // чека), поэтому ключ — позиция в списке, а не имя.
                    ForEach(Array(positions.enumerated()), id: \.offset) { index, position in
                        if index > 0 { RowDivider() }
                        HStack(spacing: Spacing.md) {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(position.name)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.text)
                                    .lineLimit(2)
                                Text(positionSubtitle(position))
                                    .font(Typography.caption)
                                    .monospacedDigit()
                                    .foregroundStyle(position.isOutOfStock ? Theme.warning : Theme.textDim)
                            }
                            Spacer(minLength: Spacing.sm)
                            Text(Money.format(position.amount))
                                .font(Typography.callout.weight(.medium))
                                .monospacedDigit()
                                .foregroundStyle(Theme.text)
                        }
                    }
                }
            }
        }
    }

    /// Остаток рядом с проданным — единственное место, где видно, что товар
    /// ушёл в ноль: следующая смена откроется без него.
    private func positionSubtitle(_ position: ZReportPosition) -> String {
        let unit = position.unit.isEmpty ? "" : " \(position.unit)"
        let sold = "продано \(Quantity.format(position.sold))\(unit)"
        return position.isOutOfStock
            ? "\(sold) · на складе пусто"
            : "\(sold) · остаток \(Quantity.format(position.stock))\(unit)"
    }

    private func debtsCard(_ report: ZReport) -> some View {
        Card(accent: Theme.warning) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader(
                    "Взяли в долг",
                    subtitle: "\(report.debts.count) \(pluralize(report.debts.count, "запись", "записи", "записей")) · в выручку не входит"
                )

                ForEach(Array(report.debts.enumerated()), id: \.offset) { index, debt in
                    if index > 0 { RowDivider() }
                    HStack(spacing: Spacing.md) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(debt.debtor)
                                .font(Typography.callout)
                                .foregroundStyle(Theme.text)
                            Text("\(debt.item) · \(Quantity.format(debt.quantity))")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textDim)
                        }
                        Spacer(minLength: Spacing.sm)
                        Text(Money.format(debt.amount))
                            .font(Typography.callout.weight(.medium))
                            .monospacedDigit()
                            .foregroundStyle(Theme.negative)
                    }
                }

                RowDivider()
                StatRow("Итого долгов", value: Money.format(report.debtsTotal), valueColor: Theme.negative, emphasized: true)
            }
        }
    }

    @ViewBuilder
    private func requisitesCard(_ report: ZReport) -> some View {
        let requisites = report.requisites

        Card(accent: requisites.isFilled ? nil : Theme.warning) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Реквизиты в отчёте")

                if requisites.isFilled {
                    StatRow("Налогоплательщик", value: requisites.name, icon: "building.2")
                    StatRow("БИН / ИИН", value: requisites.bin, icon: "number")
                    if !requisites.address.isEmpty {
                        StatRow("Адрес", value: requisites.address, icon: "mappin")
                    }
                    if !requisites.kkmRegistration.isEmpty {
                        StatRow("Рег. № ККМ", value: requisites.kkmRegistration, icon: "doc.badge.gearshape")
                    }
                    if !requisites.ofd.isEmpty {
                        StatRow("ОФД", value: requisites.ofd, icon: "antenna.radiowaves.left.and.right")
                    }
                } else {
                    InlineEmpty(
                        icon: "exclamationmark.triangle.fill",
                        text: "Реквизиты ККМ не заполнены — отчёт распечатается без шапки налогоплательщика",
                        tint: Theme.warning
                    )
                }
            }
        }
    }
}
