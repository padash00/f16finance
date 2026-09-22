import OrdaKit
import OrdaUI
import SwiftUI

// ── Обзор магазина ───────────────────────────────────────────────────────────

/// Склад одним взглядом.
///
/// Владелец открывает этот раздел не «посмотреть остатки», а ответить на два
/// вопроса: что кончается и что от меня ждут. Поэтому наверху — заканчивающееся
/// и заявки, а полный список остатков лежит отдельным экраном.
/// Куда ведут ссылки «Весь склад» и «Все» из карточек магазина.
///
/// По значению: экран перечитывает остатки и заявки сам, и переход, созданный
/// замыканием, схлопывался вместе с пересборкой.
enum StoreRoute: Hashable {
    case stock, movements, requests
}

struct StoreScreen: View {
    @Environment(BusinessStore.self) private var store
    @Environment(\.surface) private var surface

    var body: some View {
        ScreenScroll {
            if let error = store.storeError, store.store == nil {
                ErrorStateView(error: error) { Task { await store.loadStore() } }
            } else if let overview = store.store {
                content(overview)
            } else {
                loadingState
            }
        }
        .background(Theme.background)
        .navigationTitle("Магазин")
        .navigationDestination(for: StoreRoute.self) { route in
            switch route {
            case .stock: StockScreen()
            case .movements: MovementsScreen()
            case .requests: RequestsScreen()
            }
        }
                .toolbar {
            LogoutToolbarItem()
            // Поиск по всему складу — стоя у полки, а не в открытом списке.
            ToolbarItem(placement: .primaryAction) {
                NavigationLink(destination: StoreSearchScreen()) {
                    Image(systemName: "magnifyingglass")
                }
            }
        }
        .task { await store.loadStore() }
        .refreshable { await store.loadStore() }
    }

    private var loadingState: some View {
        VStack(spacing: Spacing.lg) {
            Skeleton(height: 96, cornerRadius: Radius.lg)
            Skeleton(height: 220, cornerRadius: Radius.lg)
            Skeleton(height: 160, cornerRadius: Radius.lg)
        }
    }

    @ViewBuilder
    private func content(_ overview: StoreOverview) -> some View {
        VStack(spacing: Spacing.lg) {
            metrics(overview)

            SplitDashboard {
                lowStockCard(overview)
                movementsCard(overview)
            } side: {
                requestsCard(overview)
                locationsCard(overview)
            }
        }
    }

    // ── Показатели ───────────────────────────────────────────────────────────

    private func metrics(_ overview: StoreOverview) -> some View {
        let totals = overview.totalsByItem
        let low = totals.filter(\.isLow).count
        let pending = overview.pendingRequests.count
        let today = Calendar.current.startOfDay(for: Date())
        let todayMovements = overview.movements.filter { ($0.createdAt ?? .distantPast) >= today }

        return HeroSummary(
            title: "Позиций на складе",
            value: "\(totals.count)",
            caption: low > 0 ? "\(low) заканчивается — ниже порога" : "всего хватает",
            footer: [
                ("Заканчивается", "\(low)"),
                ("Заявок ждёт", "\(pending)"),
                ("Движений сегодня", "\(todayMovements.count)"),
            ],
            colors: Theme.heroGradient
        )
    }

    // ── Заканчивается ────────────────────────────────────────────────────────

    private func lowStockCard(_ overview: StoreOverview) -> some View {
        let low = overview.totalsByItem.filter(\.isLow)

        return Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Заканчивается", subtitle: low.isEmpty ? nil : "\(low.count) позиций ниже порога") {
                    NavigationLink(value: StoreRoute.stock) {
                        Text("Весь склад").font(Typography.caption)
                    }
                }

                if low.isEmpty {
                    InlineEmpty(icon: "checkmark.circle.fill", text: "Все запасы выше порога", tint: Theme.positive)
                } else {
                    ForEach(Array(low.prefix(8).enumerated()), id: \.element.id) { index, item in
                        if index > 0 { RowDivider() }
                        StockRowView(
                            name: item.name,
                            quantity: item.quantity,
                            unit: item.unit,
                            threshold: item.threshold,
                            caption: item.locationCount > 1 ? "в \(item.locationCount) точках" : nil
                        )
                    }
                }
            }
        }
    }

    // ── Движения ─────────────────────────────────────────────────────────────

    private func movementsCard(_ overview: StoreOverview) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Последние движения") {
                    NavigationLink(value: StoreRoute.movements) {
                        Text("Все").font(Typography.caption)
                    }
                }

                if overview.movements.isEmpty {
                    InlineEmpty(icon: "tray", text: "Движений пока нет", tint: Theme.textDim)
                } else {
                    ForEach(Array(overview.movements.prefix(7).enumerated()), id: \.element.id) { index, movement in
                        if index > 0 { RowDivider() }
                        MovementRowView(movement: movement)
                    }
                }
            }
        }
    }

    // ── Заявки ───────────────────────────────────────────────────────────────

    private func requestsCard(_ overview: StoreOverview) -> some View {
        let pending = overview.pendingRequests

        return Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Заявки точек", subtitle: pending.isEmpty ? nil : "ждут решения") {
                    NavigationLink(value: StoreRoute.requests) {
                        Text("Все").font(Typography.caption)
                    }
                }

                if pending.isEmpty {
                    InlineEmpty(icon: "checkmark.circle", text: "Нет заявок в ожидании", tint: Theme.positive)
                } else {
                    ForEach(Array(pending.prefix(5).enumerated()), id: \.element.id) { index, request in
                        if index > 0 { RowDivider() }
                        RequestRowView(request: request)
                    }
                }
            }
        }
    }

    // ── Точки хранения ───────────────────────────────────────────────────────

    private func locationsCard(_ overview: StoreOverview) -> some View {
        // Считаем позиции по точкам один раз: у крупного клиента балансов
        // десятки тысяч, и перебор на каждую строку заметно тормозил бы.
        var counts: [String: Int] = [:]
        for balance in overview.balances {
            counts[balance.locationID, default: 0] += 1
        }
        let active = overview.locations.filter(\.isActive)

        return Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Точки хранения")

                if active.isEmpty {
                    InlineEmpty(icon: "building.2", text: "Точек не заведено", tint: Theme.textDim)
                } else {
                    ForEach(Array(active.enumerated()), id: \.element.id) { index, location in
                        if index > 0 { RowDivider() }
                        HStack(spacing: Spacing.md) {
                            Image(systemName: location.icon)
                                .font(.system(size: 14))
                                .foregroundStyle(Theme.brand)
                                .frame(width: 22)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(location.name)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.text)
                                Text(location.companyName ?? location.kindLabel)
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.textDim)
                            }
                            Spacer(minLength: Spacing.sm)
                            Text("\(counts[location.id] ?? 0)")
                                .font(Typography.callout.weight(.medium))
                                .monospacedDigit()
                                .foregroundStyle(Theme.textMuted)
                        }
                    }
                }
            }
        }
    }
}

// ── Остатки ──────────────────────────────────────────────────────────────────

/// Полный склад с поиском и разрезом по точкам.
///
/// Два взгляда на одни данные: «по товару» отвечает «сколько всего этого есть»,
/// «по точкам» — «где именно лежит». Владельцу нужен первый, кладовщику второй.
struct StockScreen: View {
    @Environment(BusinessStore.self) private var store

    @Environment(\.access) private var access

    @State private var search = ""
    @State private var mode: Mode = .byItem
    @State private var onlyLow = false

    /// Правка остатка после пересчёта. Ставит остаток равным тому, что лежит на
    /// полке, а не прибавляет разницу: человек у полки знает количество, а не
    /// величину прошлой ошибки.
    @State private var editing: StockBalance?
    @State private var editLocation: StoreLocation?
    @State private var editValue = ""
    @State private var editError: String?
    @State private var isSaving = false
    /// Подтверждение: окно закрывается, и без него не видно, записалось ли.
    @State private var saved: ToastMessage?

    private var canEdit: Bool { access?.can("store-warehouse.edit") ?? false }

    private enum Mode: String, CaseIterable, Identifiable {
        case byItem, byLocation
        var id: String { rawValue }
        var label: String {
            switch self {
            case .byItem: "По товару"
            case .byLocation: "По точкам"
            }
        }
    }

    var body: some View {
        Group {
            if let error = store.storeError, store.store == nil {
                ErrorStateView(error: error) { Task { await store.loadStore() } }
            } else if store.store == nil {
                LoadingRows(count: 8)
            } else {
                list
            }
        }
        .background(Theme.background)
        .navigationTitle("Склад")
        .searchable(text: $search, prompt: "Название или штрихкод")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Toggle(isOn: $onlyLow) {
                    Label("Только заканчивающиеся", systemImage: "exclamationmark.triangle")
                }
                .toggleStyle(.button)
            }
        }
        .task { await store.loadStore() }
        .refreshable { await store.loadStore() }
        .toast($saved)
        .alert("Поправить остаток", isPresented: Binding(get: { editing != nil }, set: { if !$0 { editing = nil } })) {
            TextField("Сколько на полке", text: $editValue)
                #if os(iOS)
                .keyboardType(.decimalPad)
                #endif
            Button("Сохранить") {
                if let balance = editing, let location = editLocation {
                    Task { await saveStock(balance, location: location) }
                }
            }
            Button("Отмена", role: .cancel) { editing = nil }
        } message: {
            if let editing {
                Text("\(editing.name). Сейчас числится \(Quantity.format(editing.quantity)) \(editing.unit). Введите столько, сколько лежит на самом деле — остаток станет равен этому числу.")
            }
        }
        .alert("Не удалось", isPresented: Binding(get: { editError != nil }, set: { if !$0 { editError = nil } })) {
            Button("Понятно", role: .cancel) { editError = nil }
        } message: {
            Text(editError ?? "")
        }
    }

    private func saveStock(_ balance: StockBalance, location: StoreLocation) async {
        guard let companyID = location.companyID else { return }
        isSaving = true
        defer { isSaving = false }
        editError = await store.setWarehouseQuantity(
            companyID: companyID,
            itemID: balance.itemID,
            quantity: AmountParsing.value(editValue)
        )
        if editError == nil {
            saved = ToastMessage("\(balance.name) — \(Quantity.format(AmountParsing.value(editValue))) \(balance.unit)")
            editing = nil
            Haptics.success()
        } else {
            Haptics.error()
        }
    }

    @ViewBuilder
    private var list: some View {
        VStack(spacing: 0) {
            VStack(spacing: Spacing.md) {
                PillSegment(options: Mode.allCases.map { ($0, $0.label) }, selection: $mode)
                stockSummary
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.md)

            switch mode {
            case .byItem: itemList
            case .byLocation: locationList
            }
        }
    }

    /// Сколько позиций и сколько заканчивается — нажатие на второе оставляет
    /// в списке только их.
    private var stockSummary: some View {
        let totals = store.store?.totalsByItem ?? []
        let low = totals.filter { item in
            guard let threshold = item.threshold, threshold > 0 else { return false }
            return item.quantity <= threshold
        }.count
        return HStack(spacing: Spacing.sm) {
            Label("\(totals.count) позиций", systemImage: "shippingbox.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Theme.text)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Theme.surface, in: Capsule())
            if low > 0 {
                Button {
                    withAnimation(Motion.tap) { onlyLow.toggle() }
                } label: {
                    Label("Заканчивается: \(low)", systemImage: "exclamationmark.triangle.fill")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(onlyLow ? .white : Theme.negative)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(onlyLow ? AnyShapeStyle(Theme.negative) : AnyShapeStyle(Theme.negative.opacity(0.12)), in: Capsule())
                }
                .buttonStyle(.pressable)
            }
            Spacer(minLength: 0)
        }
    }

    /// Свод по товару: одна строка на позицию.
    private var itemList: some View {
        let items = filteredTotals

        return Group {
            if items.isEmpty {
                WideEmptyState(
                    icon: "shippingbox",
                    title: search.isEmpty ? "Склад пуст" : "Ничего не найдено",
                    message: search.isEmpty ? "Остатков пока нет." : "Попробуйте другой запрос."
                )
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                            if index > 0 {
                                Rectangle().fill(Theme.borderSoft).frame(height: 1).padding(.leading, 56)
                            }
                            StockRowView(
                                name: item.name,
                                quantity: item.quantity,
                                unit: item.unit,
                                threshold: item.threshold,
                                caption: item.locationCount > 1 ? "в \(item.locationCount) точках" : nil
                            )
                            .padding(.vertical, Spacing.sm)
                        }
                    }
                    .padding(.horizontal, Spacing.md)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                    .padding(.horizontal, Spacing.lg)
                    .padding(.bottom, Spacing.xxl)
                }
            }
        }
    }

    /// Разрез по точкам: внутри каждой — её позиции.
    private var locationList: some View {
        let overview = store.store
        let grouped = Dictionary(grouping: filteredBalances, by: \.locationID)
        let locations = (overview?.locations ?? []).filter { grouped[$0.id]?.isEmpty == false }

        return Group {
            if locations.isEmpty {
                WideEmptyState(
                    icon: "building.2",
                    title: "Ничего не найдено",
                    message: "Ни в одной точке нет подходящих позиций."
                )
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: Spacing.lg) {
                        ForEach(locations) { location in
                            Card {
                                VStack(alignment: .leading, spacing: Spacing.sm) {
                                    HStack(spacing: Spacing.sm) {
                                        Image(systemName: location.icon)
                                            .font(.system(size: 13, weight: .semibold))
                                            .foregroundStyle(Theme.brand)
                                        Text(location.name)
                                            .font(Typography.label)
                                            .foregroundStyle(Theme.textDim)
                                        Spacer()
                                        Text("\(grouped[location.id]?.count ?? 0)")
                                            .font(Typography.caption)
                                            .monospacedDigit()
                                            .foregroundStyle(Theme.textDim)
                                    }

                                    ForEach(Array((grouped[location.id] ?? []).enumerated()), id: \.element.id) { index, balance in
                                        if index > 0 { RowDivider() }
                                        HStack(spacing: Spacing.sm) {
                                            StockRowView(
                                                name: balance.name,
                                                quantity: balance.quantity,
                                                unit: balance.unit,
                                                threshold: balance.lowStockThreshold,
                                                caption: nil
                                            )
                                            // Править можно только склад: у
                                            // витрины свой порядок — товар туда
                                            // попадает заявкой, а не рукой.
                                            if canEdit, location.kind == "warehouse", location.companyID != nil {
                                                Button {
                                                    editValue = Quantity.format(balance.quantity)
                                                    editLocation = location
                                                    editing = balance
                                                } label: {
                                                    Image(systemName: "pencil")
                                                        .foregroundStyle(Theme.brand)
                                                }
                                                .buttonStyle(.plain)
                                                .disabled(isSaving)
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    .padding(Spacing.lg)
                }
            }
        }
    }

    // ── Фильтрация ───────────────────────────────────────────────────────────

    /// Идентификаторы мест хранения: сам склад и подсобка.
    ///
    /// Витрина сюда не входит — у неё свой раздел. Пока все три пункта меню
    /// вели на этот экран, показывать всё вместе было единственным вариантом;
    /// теперь «Склад» отвечает ровно за склад, иначе его цифры не сходились бы
    /// с соседним разделом.
    private var stockroomLocationIDs: Set<String> {
        Set((store.store?.locations ?? []).filter(\.isStockroom).map(\.id))
    }

    private var filteredTotals: [StoreOverview.ItemTotal] {
        // Свод по товару считаем из тех же строк, что и разрез по точкам:
        // готовый `totalsByItem` складывает и витрину тоже.
        var items = StoreOverview.totals(of: stockroomBalances)
        if onlyLow { items = items.filter(\.isLow) }
        guard !search.isEmpty else { return items }
        return items.filter { $0.name.localizedCaseInsensitiveContains(search) }
    }

    private var filteredBalances: [StockBalance] {
        var items = stockroomBalances
        if onlyLow { items = items.filter(\.isLow) }
        guard !search.isEmpty else { return items }
        return items.filter {
            $0.name.localizedCaseInsensitiveContains(search)
                || ($0.barcode?.contains(search) ?? false)
        }
    }

    private var stockroomBalances: [StockBalance] {
        let allowed = stockroomLocationIDs
        // Пустой список мест — данные ещё не пришли или сервер не отдал типы.
        // Показать всё честнее, чем пустой склад при полных полках.
        guard !allowed.isEmpty else { return store.store?.balances ?? [] }
        return (store.store?.balances ?? []).filter { allowed.contains($0.locationID) }
    }
}

// ── Заявки ───────────────────────────────────────────────────────────────────

/// Заявки точек на товар: список слева, состав справа.
///
/// Два раздела на одном экране, но с разным вопросом. «Заявки» — рабочий
/// список того, что ждёт решения владельца. «Журнал заявок» — история, куда
/// заходят разбираться, что и когда отгрузили. Раньше оба пункта меню вели
/// сюда с одним и тем же начальным состоянием, и журнал приходилось
/// включать тумблером — то есть его как бы и не было.
struct RequestsScreen: View {
    enum Scope {
        /// Только ждущие решения.
        case pending
        /// Вся история заявок.
        case journal
    }

    var scope: Scope = .pending

    @Environment(BusinessStore.self) private var store
    @Environment(\.access) private var access
    @State private var selected: StockRequest?

    /// Права те же, что проверяет сервер: одобрение и отклонение раздельно.
    private var canApprove: Bool { access?.can("store-requests.approve") ?? false }
    private var canReject: Bool { access?.can("store-requests.reject") ?? false }
    private var canCreate: Bool { access?.can("store-requests.create") ?? false }

    @State private var isAdding = false

    var body: some View {
        let requests = scope == .journal
            ? (store.store?.requests ?? [])
            : (store.store?.pendingRequests ?? [])

        return MasterDetail(
            items: requests,
            selection: $selected,
            actions: { request in
                // Заявку заводит точка, решение принимает владелец. Вопрос
                // решается одним взглядом на остаток — открывать карточку
                // ради этого незачем.
                guard request.isPending else { return [] }
                var result: [RowAction] = []
                if canApprove {
                    result.append(
                        RowAction("Одобрить", icon: "checkmark.circle", tint: Theme.positive) {
                            Task { await store.decideStockRequest(id: request.id, approved: true, lines: request.lines) }
                        }
                    )
                }
                if canReject {
                    result.append(
                        RowAction("Отклонить", icon: "xmark.circle", isDestructive: true) {
                            Task { await store.decideStockRequest(id: request.id, approved: false) }
                        }
                    )
                }
                return result
            }
        ) { request in
            RequestRowView(request: request)
        } detail: { request in
            RequestDetail(request: request)
        } empty: {
            WideEmptyState(
                icon: "tray",
                title: scope == .journal ? "Заявок не было" : "Нет заявок в ожидании",
                message: scope == .journal
                    ? "Точки ещё не отправляли заявки."
                    : "Всё разобрано. История — в разделе «Журнал заявок»."
            )
        }
        .background(Theme.background)
        .sheet(isPresented: $isAdding) {
            NewRequestSheet { await store.loadStore() }
        }
        .toolbar {
            if canCreate {
                ToolbarItem(placement: .primaryAction) {
                    Button { isAdding = true } label: { Image(systemName: "plus") }
                }
            }
        }
        .navigationTitle(scope == .journal ? "Журнал заявок" : "Заявки")
        .task { await store.loadStore() }
        .refreshable { await store.loadStore() }
    }
}

private struct RequestDetail: View {
    let request: StockRequest

    @Environment(BusinessStore.self) private var store
    @Environment(\.access) private var access

    private var canApprove: Bool { access?.can("store-requests.approve") ?? false }
    private var canReject: Bool { access?.can("store-requests.reject") ?? false }
    /// Выдача и приёмка — физические действия у товара, а отмечались с
    /// ноутбука: цепочка обрывалась сразу после одобрения.
    private var canMove: Bool { access?.can("store-requests.transition_status") ?? false }
    private var canUndo: Bool { access?.can("store-requests.undecide") ?? false }

    @State private var isMoving = false
    @State private var undoOpen = false
    @State private var undoReason = ""
    @State private var moveError: String?

    var body: some View {
        ScreenScroll {
            VStack(spacing: Spacing.lg) {
                // Решение и в карточке: свайп хорош для очереди, но когда
                // человек открыл заявку и читает состав, кнопка должна быть
                // здесь же, а не «вернитесь в список и потяните строку».
                if request.isPending, canApprove || canReject {
                    Card {
                        VStack(spacing: Spacing.md) {
                            if let message = store.requestDecisionError {
                                Text(message)
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.negative)
                            }
                            HStack(spacing: Spacing.md) {
                                if canReject {
                                    Button("Отклонить") {
                                        Task { await store.decideStockRequest(id: request.id, approved: false) }
                                    }
                                    .buttonStyle(SecondaryButtonStyle())
                                }
                                if canApprove {
                                    Button("Одобрить") {
                                        Task { await store.decideStockRequest(id: request.id, approved: true, lines: request.lines) }
                                    }
                                    .buttonStyle(PrimaryButtonStyle())
                                }
                            }
                        }
                    }
                }

                // Дальше по цепочке: со склада выдали — точка приняла.
                if let stage = request.nextStage, canMove {
                    Card {
                        VStack(alignment: .leading, spacing: Spacing.md) {
                            if let moveError {
                                Text(moveError)
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.negative)
                            }
                            Button(isMoving ? "Отмечаем…" : stage.actionLabel) {
                                Task { await move(to: stage) }
                            }
                            .buttonStyle(PrimaryButtonStyle())
                            .disabled(isMoving)

                            if request.isApproved && canUndo {
                                Button("Откатить одобрение") { undoOpen = true }
                                    .buttonStyle(SecondaryButtonStyle())
                                    .disabled(isMoving)
                            }
                        }
                    }
                }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        HStack {
                            Text(request.companyName ?? "Точка")
                                .font(Typography.title)
                                .foregroundStyle(Theme.text)
                            Spacer()
                            StatusCaption(request.statusLabel, tint: request.isPending ? Theme.warning : Theme.positive)
                        }

                        if let from = request.sourceName, let to = request.targetName {
                            StatRow("Маршрут", value: "\(from) → \(to)", icon: "arrow.right")
                        }
                        if let date = request.createdAt {
                            StatRow("Создана", value: date.formatted(.dateTime.day().month(.abbreviated).hour().minute()), icon: "calendar")
                        }
                        if let comment = request.comment, !comment.isEmpty {
                            RowDivider()
                            Text(comment)
                                .font(Typography.callout)
                                .foregroundStyle(Theme.textMuted)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }

                OwnerSection("Состав") {
                    Text("\(request.lines.count) поз.")
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.textDim)
                } content: {
                    VStack(spacing: 0) {
                        if request.lines.isEmpty {
                            InlineEmpty(icon: "tray", text: "Позиции не указаны", tint: Theme.textDim)
                        } else {
                            ForEach(Array(request.lines.enumerated()), id: \.element.id) { index, line in
                                if index > 0 { PlainRowDivider() }
                                HStack(spacing: Spacing.md) {
                                    LetterBadge(text: line.name, tint: Theme.brand, size: 36)
                                    Text(line.name)
                                        .font(.system(size: 15, weight: .medium))
                                        .foregroundStyle(Theme.text)
                                        .lineLimit(2)
                                    Spacer(minLength: Spacing.sm)
                                    // Одобренное количество часто меньше
                                    // запрошенного — показываем оба, иначе
                                    // непонятно, что урезали.
                                    if let approved = line.approved, approved != line.requested {
                                        Text(Quantity.format(line.requested))
                                            .font(Typography.caption)
                                            .monospacedDigit()
                                            .strikethrough()
                                            .foregroundStyle(Theme.textDim)
                                        Text("\(Quantity.format(approved)) \(line.unit)")
                                            .font(Typography.callout.weight(.medium))
                                            .monospacedDigit()
                                            .foregroundStyle(Theme.positive)
                                    } else {
                                        Text("\(Quantity.format(line.requested)) \(line.unit)")
                                            .font(Typography.callout.weight(.medium))
                                            .monospacedDigit()
                                            .foregroundStyle(Theme.text)
                                    }
                                }
                                .padding(.vertical, Spacing.sm)
                            }
                        }
                    }
                }
            }
        }
        .background(Theme.background)
        .navigationTitle("Заявка")
        // Откат меняет остатки: товар уходит обратно на склад. Причина
        // обязательна — через месяц никто не вспомнит, почему откатывали.
        .alert("Откатить одобрение?", isPresented: $undoOpen) {
            TextField("Причина", text: $undoReason)
            Button("Откатить", role: .destructive) {
                Task { await undo() }
            }
            .disabled(undoReason.trimmingCharacters(in: .whitespaces).isEmpty)
            Button("Отмена", role: .cancel) { undoReason = "" }
        } message: {
            Text("Товар вернётся на склад, а заявка снова станет новой.")
        }
    }

    private func move(to stage: StockRequestStage) async {
        isMoving = true
        defer { isMoving = false }
        moveError = await store.moveStockRequest(id: request.id, to: stage)
        if moveError == nil { Haptics.success() } else { Haptics.error() }
    }

    private func undo() async {
        isMoving = true
        defer { isMoving = false }
        moveError = await store.undoStockRequestDecision(
            id: request.id,
            reason: undoReason.trimmingCharacters(in: .whitespaces)
        )
        if moveError == nil {
            undoReason = ""
            Haptics.success()
        } else {
            Haptics.error()
        }
    }
}

// ── Движения ─────────────────────────────────────────────────────────────────

/// История движений с фильтром по типу.
struct MovementsScreen: View {
    @Environment(BusinessStore.self) private var store
    @State private var kind: String?

    var body: some View {
        let movements = filtered

        return VStack(spacing: 0) {
            filterBar

            if movements.isEmpty {
                WideEmptyState(icon: "arrow.left.arrow.right", title: "Движений нет", message: "За выбранный тип записей нет.")
            } else {
                // Движения — как операции в выписке: белая подложка, иконка в
                // кружке, тонкие линии только под текстом.
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(movements.enumerated()), id: \.element.id) { index, movement in
                            if index > 0 { PlainRowDivider(inset: 56) }
                            MovementRowView(movement: movement)
                                .padding(.vertical, Spacing.sm)
                        }
                    }
                    .padding(.horizontal, Spacing.md)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                    .padding(.horizontal, Spacing.lg)
                    .padding(.bottom, Spacing.xxl)
                }
            }
        }
        .background(Theme.background)
        .navigationTitle("Движения")
        .task { await store.loadMovements() }
        .refreshable { await store.loadMovements() }
    }

    private var filterBar: some View {
        @Bindable var bindable = store

        return VStack(spacing: 0) {
            // Место — отдельной строкой: спрашивают почти всегда про витрину
            // («куда делись двадцать кол»), и мешать его с видом движения в
            // один ряд значит прятать оба.
            PillSegment(
                options: [("all", "Везде"), ("warehouse", "Склад"), ("showcase", "Витрина")] as [(value: String, title: String)],
                selection: $bindable.movementsScope
            )
            .padding(.horizontal, Spacing.lg)
            .padding(.top, Spacing.md)

            kindBar
        }
    }

    private var kindBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Spacing.sm) {
                FilterChip(title: "Все", isOn: kind == nil) { kind = nil }
                ForEach(kinds, id: \.self) { value in
                    FilterChip(title: label(for: value), isOn: kind == value) {
                        kind = kind == value ? nil : value
                    }
                }
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.md)
        }
    }

    private var kinds: [String] {
        Array(Set(store.movements.map(\.kind))).sorted()
    }

    private func label(for value: String) -> String {
        store.movements.first { $0.kind == value }?.kindLabel ?? value
    }

    private var filtered: [StockMovement] {
        guard let kind else { return store.movements }
        return store.movements.filter { $0.kind == kind }
    }
}

// ── Строки и мелочи ──────────────────────────────────────────────────────────

/// Строка остатка: имя слева, количество справа, порог подсказкой.
struct StockRowView: View {
    let name: String
    let quantity: Double
    let unit: String
    let threshold: Double?
    let caption: String?

    private var isLow: Bool {
        guard let threshold, threshold > 0 else { return false }
        return quantity <= threshold
    }

    var body: some View {
        HStack(spacing: Spacing.md) {
            // Буква товара в кружке — строка читается как позиция выписки,
            // а заканчивающийся товар виден по красному кружку издалека.
            Text(String(name.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased())
                .font(.system(size: 16, weight: .bold, design: .rounded))
                .foregroundStyle(isLow ? Theme.negative : Theme.brand)
                .frame(width: 40, height: 40)
                .background((isLow ? Theme.negative : Theme.brand).opacity(0.13), in: Circle())

            VStack(alignment: .leading, spacing: 2) {
                Text(name)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                if isLow, let threshold {
                    Text("заканчивается · порог \(Quantity.format(threshold)) \(unit)")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.negative)
                } else if let caption {
                    Text(caption)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textDim)
                }
            }

            Spacer(minLength: Spacing.sm)

            Text("\(Quantity.format(quantity)) \(unit.lowercased())")
                .font(.system(size: 16, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(isLow ? Theme.negative : Theme.text)
        }
        .padding(.vertical, Spacing.xs)
    }
}

/// Строка движения: тип иконкой, товар, куда/откуда, количество.
struct MovementRowView: View {
    let movement: StockMovement

    private var tint: Color {
        switch movement.direction {
        case 1: Theme.positive
        case -1: Theme.negative
        default: Theme.textMuted
        }
    }

    var body: some View {
        // Иконка вида движения в цветном кружке: приход зелёный, расход
        // красный — направление читается до того, как прочитано число.
        HStack(spacing: Spacing.md) {
            TintedIcon(systemName: movement.icon, tint: tint)

            VStack(alignment: .leading, spacing: 2) {
                Text(movement.itemName)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text(route)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 2) {
                Text(signedQuantity)
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(tint == Theme.textMuted ? Theme.text : tint)
                if let date = movement.createdAt {
                    Text(date.formatted(.dateTime.hour().minute()))
                        .font(.system(size: 12))
                        .monospacedDigit()
                        .foregroundStyle(Theme.textDim)
                }
            }
        }
    }

    private var route: String {
        switch (movement.fromName, movement.toName) {
        case let (from?, to?): "\(movement.kindLabel) · \(from) → \(to)"
        case let (from?, nil): "\(movement.kindLabel) · из \(from)"
        case let (nil, to?): "\(movement.kindLabel) · в \(to)"
        default: movement.kindLabel
        }
    }

    private var signedQuantity: String {
        let value = Quantity.format(movement.quantity)
        return switch movement.direction {
        case 1: "+\(value)"
        case -1: "−\(value)"
        default: value
        }
    }
}

/// Строка заявки в списке.
struct RequestRowView: View {
    let request: StockRequest

    var body: some View {
        // Точка буквой в кружке, статус цветной подписью: плашка статуса
        // была шире названия точки и перетягивала взгляд.
        HStack(spacing: Spacing.md) {
            LetterBadge(text: request.companyName ?? "Точка", tint: request.isPending ? Theme.warning : Theme.positive)

            VStack(alignment: .leading, spacing: 2) {
                Text(request.companyName ?? "Точка")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text("\(request.lines.count) \(pluralize(request.lines.count, "позиция", "позиции", "позиций"))")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 2) {
                StatusCaption(request.statusLabel, tint: request.isPending ? Theme.warning : Theme.positive)
                if let date = request.createdAt {
                    Text(date.formatted(.dateTime.day().month(.abbreviated)))
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textDim)
                }
            }
        }
    }
}

/// Компактная подсказка внутри карточки вместо полноэкранной пустоты.
struct InlineEmpty: View {
    let icon: String
    let text: String
    var tint: Color = Theme.textDim

    var body: some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: icon)
                .font(.system(size: 13))
                .foregroundStyle(tint)
            Text(text)
                .font(Typography.callout)
                .foregroundStyle(Theme.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, Spacing.sm)
    }
}

/// Чип фильтра — переключатель без рамки вокруг всего ряда.
struct FilterChip: View {
    let title: String
    let isOn: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(Typography.caption.weight(.medium))
                .padding(.horizontal, Spacing.md)
                .padding(.vertical, Spacing.sm)
                .background(isOn ? Theme.brand.opacity(0.16) : Theme.surfaceRaised)
                .foregroundStyle(isOn ? Theme.brand : Theme.textMuted)
                .clipShape(Capsule())
        }
        .buttonStyle(.pressable)
    }
}
