import OrdaKit
import OrdaUI
import PhotosUI
import SwiftUI

// ── Доверенные поставщики ────────────────────────────────────────────────────

@MainActor @Observable
final class TrustedVendorStore {
    private(set) var board: TrustedVendorBoard?
    private(set) var isLoading = false
    private(set) var error: APIError?

    private let service: TrustedVendorService

    init(api: APIClient) { service = TrustedVendorService(api: api) }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            board = try await service.load()
            error = nil
        } catch let apiError as APIError {
            error = apiError
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }

}

/// Кому можно платить без фото чека.
///
/// Список — это разрешения, а не справочник: каждая строка снимает требование
/// подтверждать расход. Поэтому на виду держим не количество, а границу
/// действия — «все точки» против конкретной.
struct ExpenseWhitelistScreen: View {
    @Environment(\.api) private var api

    @State private var store: TrustedVendorStore?
    @State private var search = ""

    var body: some View {
        Group {
            if let store {
                if let error = store.error, store.board == nil {
                    ErrorStateView(error: error) { Task { await store.load() } }
                } else if let board = store.board {
                    content(board)
                } else {
                    LoadingRows(count: 7)
                }
            } else {
                LoadingRows(count: 7)
            }
        }
        .background(Theme.background)
        .navigationTitle("Доверенные поставщики")
        .searchable(text: $search, prompt: "Имя, точка или заметка")
        .toolbar { LogoutToolbarItem() }
        .task {
            if store == nil {
                let created = TrustedVendorStore(api: api)
                store = created
                await created.load()
            }
        }
        .refreshable { await store?.load() }
    }

    @ViewBuilder
    private func content(_ board: TrustedVendorBoard) -> some View {
        let vendors = filtered(board)

        ScreenScroll {
            VStack(spacing: Spacing.lg) {
                HStack(spacing: Spacing.md) {
                    SummaryPill(title: "Всего", value: "\(board.vendors.count)", tint: Theme.brand)
                    SummaryPill(
                        title: "На все точки",
                        value: "\(board.vendors.count - board.companyScopedCount)",
                        tint: Theme.warning
                    )
                    SummaryPill(
                        title: "Ограничены точкой",
                        value: "\(board.companyScopedCount)",
                        tint: Theme.info
                    )
                }

                explainer

                if vendors.isEmpty {
                    Card {
                        InlineEmpty(
                            icon: search.isEmpty ? "shield.slash" : "magnifyingglass",
                            text: search.isEmpty
                                ? "Доверенных поставщиков нет — каждый расход требует чека"
                                : "Никого не найдено",
                            tint: Theme.textDim
                        )
                    }
                } else {
                    Card {
                        VStack(spacing: Spacing.md) {
                            SectionHeader("Список", subtitle: "сначала действующие на всех точках")
                            ForEach(Array(vendors.enumerated()), id: \.element.id) { index, vendor in
                                if index > 0 { RowDivider() }
                                TrustedVendorRow(vendor: vendor, board: board)
                            }
                        }
                    }
                }
            }
        }
    }

    private var explainer: some View {
        Card(accent: Theme.positive) {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                SectionHeader("Что это значит")
                Text("Расход в пользу такого получателя проводится без фото чека. Удобно для зарплат, аренды, уборки и регулярных услуг — и опасно для всего остального.")
                    .font(Typography.callout)
                    .foregroundStyle(Theme.textMuted)
                Text("Категория из строки подставляется в расход автоматически.")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
            }
        }
    }

    private func filtered(_ board: TrustedVendorBoard) -> [TrustedVendor] {
        let vendors = board.sortedVendors
        guard !search.isEmpty else { return vendors }
        return vendors.filter { vendor in
            vendor.name.localizedCaseInsensitiveContains(search)
                || (vendor.notes?.localizedCaseInsensitiveContains(search) ?? false)
                || board.companyName(vendor.companyID).localizedCaseInsensitiveContains(search)
        }
    }
}

private struct TrustedVendorRow: View {
    let vendor: TrustedVendor
    let board: TrustedVendorBoard

    var body: some View {
        HStack(spacing: Spacing.md) {
            Image(systemName: "checkmark.shield.fill")
                .font(.system(size: 14))
                .foregroundStyle(Theme.positive)
                .frame(width: 34, height: 34)
                .background(Theme.positive.opacity(0.12), in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))

            VStack(alignment: .leading, spacing: 2) {
                Text(vendor.name)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)

                HStack(spacing: Spacing.xs) {
                    if let category = board.categoryName(vendor.defaultCategoryID) {
                        Text(category)
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                    }
                    if let notes = vendor.notes, !notes.isEmpty {
                        Text(notes)
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                            .italic()
                            .lineLimit(1)
                    }
                }
            }

            Spacer(minLength: Spacing.sm)

            StatusChip(
                board.companyName(vendor.companyID),
                kind: vendor.isCompanyScoped ? .info : .warning
            )
        }
    }
}

// ── Симуляция выручки ────────────────────────────────────────────────────────

@MainActor @Observable
final class SimulationStore {
    private(set) var simulation: RevenueSimulation?
    private(set) var isLoading = false
    private(set) var error: APIError?

    private var companyID: String?
    private let service: SimulationService

    init(api: APIClient) { service = SimulationService(api: api) }

    var companies: [Company] { simulation?.companies ?? [] }
    var companyName: String { simulation?.companyName ?? "Точка" }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            simulation = try await service.load(companyID: companyID)
            error = nil
        } catch let apiError as APIError {
            error = apiError
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }

    func select(companyID id: String) async {
        guard companyID != id else { return }
        companyID = id
        await load()
    }
}

/// Потенциал клуба против фактической выручки.
///
/// Ни ставка часа, ни потенциал зоны, ни обратный расчёт загрузки здесь не
/// считаются: их считает сервер той же функцией, что и страница сайта. Вторая
/// реализация означала бы разный «разрыв» в телефоне и на сайте — а именно по
/// нему решают, поднимать ли цены или гнать рекламу.
struct SimulationScreen: View {
    @Environment(\.api) private var api
    @Environment(\.access) private var access
    @State private var store: SimulationStore?
    @State private var isEditing = false

    /// Право `simulation.edit` проверяет и сервер.
    private var canEdit: Bool {
        access?.can("simulation.edit") ?? false
    }

    var body: some View {
        Group {
            if let store {
                if let error = store.error, store.simulation == nil {
                    ErrorStateView(error: error) { Task { await store.load() } }
                } else if let simulation = store.simulation {
                    ScreenScroll { content(simulation) }
                } else {
                    LoadingRows(count: 6)
                }
            } else {
                LoadingRows(count: 6)
            }
        }
        .background(Theme.background)
        .navigationTitle("Симуляция выручки")
        .toolbar {
            if let store, store.companies.count > 1 {
                ToolbarItem(placement: .primaryAction) { companyMenu(store) }
            }
            if canEdit, store?.simulation?.companyID != nil {
                ToolbarItem(placement: .primaryAction) {
                    Button { isEditing = true } label: {
                        Image(systemName: "slider.horizontal.3")
                    }
                }
            }
            LogoutToolbarItem()
        }
        .task {
            if store == nil {
                let created = SimulationStore(api: api)
                store = created
                await created.load()
            }
        }
        .refreshable { await store?.load() }
        .sheet(isPresented: $isEditing) {
            if let simulation = store?.simulation, let companyID = simulation.companyID {
                SimulationEditorSheet(
                    companyID: companyID,
                    companyName: simulation.companyName,
                    initialZones: simulation.zones,
                    initialTariffs: simulation.tariffs,
                    onSaved: { Task { await store?.load() } }
                )
            }
        }
    }

    private func companyMenu(_ store: SimulationStore) -> some View {
        Menu {
            ForEach(store.companies) { company in
                Button(company.name) { Task { await store.select(companyID: company.id) } }
            }
        } label: {
            Label(store.companyName, systemImage: "building.2")
        }
    }

    @ViewBuilder
    private func content(_ simulation: RevenueSimulation) -> some View {
        let projection = simulation.projection

        VStack(spacing: Spacing.lg) {
            if !projection.isConfigured {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        SectionHeader("Модель не заполнена")
                        Text("Без зон и тарифов считать потенциал не из чего.")
                            .font(Typography.callout)
                            .foregroundStyle(Theme.textMuted)

                        if canEdit {
                            Button("Заполнить модель") { isEditing = true }
                                .buttonStyle(PrimaryButtonStyle())
                        }
                    }
                }
            } else {
                headline(projection, fact: simulation.fact)

                DashboardGrid {
                    MetricTile(
                        label: "Потенциал / мес",
                        value: Money.format(projection.potentialPerMonth),
                        icon: "chart.bar.fill",
                        accent: Theme.brand
                    )
                    MetricTile(
                        label: "Факт / мес",
                        value: Money.format(projection.factPerMonth),
                        icon: "banknote.fill",
                        accent: Theme.positive
                    )
                    MetricTile(
                        label: projection.isUnderPotential ? "Недобор / мес" : "Сверх модели / мес",
                        value: Money.format(abs(projection.gapPerMonth)),
                        icon: projection.isUnderPotential ? "arrow.down.right" : "arrow.up.right",
                        accent: projection.isUnderPotential ? Theme.warning : Theme.positive
                    )
                    MetricTile(
                        label: "Устройств",
                        value: Quantity.format(projection.totalDevices),
                        icon: "desktopcomputer",
                        accent: Theme.info
                    )
                }

                occupancy(projection)

                SplitDashboard {
                    zonesChart(projection)
                    zonesTable(projection)
                } side: {
                    tariffs(projection)
                    disclaimer(simulation.fact)
                }
            }
        }
    }

    // ── Итог ─────────────────────────────────────────────────────────────────

    private func headline(_ projection: SimulationProjection, fact: SimulationFact?) -> some View {
        Card(accent: projection.isUnderPotential ? Theme.warning : Theme.positive) {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Text(projection.isUnderPotential ? "Недозарабатываем за месяц" : "Факт выше расчётного потенциала")
                    .font(Typography.label)
                    .foregroundStyle(Theme.textDim)
                    .textCase(.uppercase)

                Text(Money.format(abs(projection.gapPerMonth)))
                    .font(Typography.hero)
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)

                if let share = projection.factShare {
                    ProportionBar(
                        ratio: share,
                        color: projection.isUnderPotential ? Theme.warning : Theme.positive
                    )
                    Text("Факт выбирает \(Percent.format(share * 100)) потенциала")
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textMuted)
                }

                if let fact {
                    Text("Факт — вся выручка точки за \(pluralize(fact.windowDays, "день", "дня", "дней")), включая бар и допуслуги.")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                }
            }
        }
    }

    // ── Обратный расчёт ──────────────────────────────────────────────────────

    @ViewBuilder
    private func occupancy(_ projection: SimulationProjection) -> some View {
        if let implied = projection.impliedOccupancyHours {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("Обратный расчёт загрузки", subtitle: "что должно быть, чтобы сходилось")

                    StatRow(
                        "Нужна загрузка",
                        value: hours(implied),
                        valueColor: Theme.brand,
                        icon: "clock.fill",
                        emphasized: true
                    )
                    if let assumed = projection.assumedOccupancyHours {
                        StatRow("Заложено в модели", value: hours(assumed), icon: "slider.horizontal.3")
                    }
                    StatRow(
                        "Час полной загрузки",
                        value: Money.format(projection.capacityRatePerHour),
                        icon: "bolt.fill"
                    )

                    if let gap = projection.occupancyGapHours {
                        RowDivider()
                        Text(verdict(gap))
                            .font(Typography.callout)
                            .foregroundStyle(abs(gap) < 0.5 ? Theme.textMuted : (gap < 0 ? Theme.warning : Theme.textMuted))
                    }
                }
            }
        }
    }

    private func verdict(_ gap: Double) -> String {
        if abs(gap) < 0.5 { return "Расчёт сходится с реальностью." }
        if gap < 0 {
            return "По факту загрузка ниже заложенной на \(hours(abs(gap))) — зоны простаивают."
        }
        return "Факт выше расчёта на \(hours(gap)) — скорее всего, в выручку входят бар и допуслуги."
    }

    private func hours(_ value: Double) -> String {
        String(format: "%.1f", value).replacingOccurrences(of: ".", with: ",") + " ч"
    }

    // ── Зоны ─────────────────────────────────────────────────────────────────

    private func zonesChart(_ projection: SimulationProjection) -> some View {
        CategoryBarChart(
            title: "Потенциал по зонам, ₸ / мес",
            points: projection.zonesByPotential.map {
                CategoryPoint(label: $0.name, value: $0.potentialPerMonth)
            },
            color: ChartPalette.series1
        )
    }

    private func zonesTable(_ projection: SimulationProjection) -> some View {
        Card {
            VStack(spacing: Spacing.md) {
                SectionHeader("Зоны", subtitle: "устройства, загрузка и ставка")
                ForEach(Array(projection.zonesByPotential.enumerated()), id: \.element.id) { index, zone in
                    if index > 0 { RowDivider() }
                    SimulationZoneRow(zone: zone)
                }
            }
        }
    }

    // ── Тарифы ───────────────────────────────────────────────────────────────

    private func tariffs(_ projection: SimulationProjection) -> some View {
        Card {
            VStack(spacing: Spacing.md) {
                SectionHeader("Тарифы", subtitle: "₸ за час с учётом бонусных часов")
                ForEach(projection.tariffs) { tariff in
                    StatRow(
                        "\(tariff.name) · \(tariff.hoursLabel) · \(Money.format(tariff.price))",
                        value: "\(Money.format(tariff.ratePerHour))/ч",
                        icon: "tag"
                    )
                }
            }
        }
    }

    @ViewBuilder
    private func disclaimer(_ fact: SimulationFact?) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                SectionHeader("Как читать")
                Text("Потенциал — это только выручка за время устройств при заложенной загрузке. Бар, допуслуги и продажи в него не входят, поэтому факт может оказаться выше.")
                    .font(Typography.callout)
                    .foregroundStyle(Theme.textMuted)
                if let fact, fact.windowDays > 0 {
                    StatRow(
                        "Факт в среднем за сутки",
                        value: Money.format(fact.revenuePerDay),
                        icon: "calendar"
                    )
                }
            }
        }
    }
}

private struct SimulationZoneRow: View {
    let zone: SimulationZone

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(spacing: Spacing.md) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(zone.name)
                        .font(Typography.callout)
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                    Text("\(zone.deviceTypeLabel) · \(Quantity.format(zone.deviceCount)) шт · \(Quantity.format(zone.occupancyHours)) ч/сут")
                        .font(Typography.caption)
                        .monospacedDigit()
                        .foregroundStyle(Theme.textDim)
                }

                Spacer(minLength: Spacing.sm)

                VStack(alignment: .trailing, spacing: 1) {
                    Text(Money.format(zone.potentialPerMonth))
                        .font(Typography.callout.weight(.medium))
                        .monospacedDigit()
                        .foregroundStyle(Theme.text)
                    Text("\(Money.format(zone.blendedRate))/ч")
                        .font(Typography.caption)
                        .monospacedDigit()
                        .foregroundStyle(Theme.textDim)
                }
            }

            // Незаполненный микс — не косметика: потенциал зоны занижен ровно
            // на долю устройств, которым не назначен тариф.
            if zone.hasNoMix {
                StatusChip("тарифы не назначены", kind: .danger)
            } else if zone.hasBrokenMix {
                StatusChip("микс \(Percent.format(zone.shareSum)) вместо 100 %", kind: .warning)
            }
        }
    }
}

// ── Долги поставщикам ────────────────────────────────────────────────────────

/// Что показывать в списке счетов.
private enum DebtFilter: String, CaseIterable, Identifiable {
    case open, overdue, closed

    var id: String { rawValue }

    var label: String {
        switch self {
        case .open: "Открытые"
        case .overdue: "Просроченные"
        case .closed: "Закрытые"
        }
    }
}

/// Итог загрузки чека: адрес файла или причина отказа.
///
/// Отдельным типом, а не `Result<String, String>`: строка не годится в роли
/// ошибки, а заводить ради этого класс ошибок незачем.
enum ReceiptUpload {
    case success(String)
    case failure(String)
}

@MainActor @Observable
final class SupplierBillingStore {
    private(set) var board: SupplierDebtBoard?
    private(set) var isLoading = false
    private(set) var error: APIError?

    private let service: SupplierDebtService

    init(api: APIClient) { service = SupplierDebtService(api: api) }

    /// Загрузить чек об оплате. Возвращает адрес файла или текст ошибки.
    func uploadReceipt(data: Data, fileName: String, mimeType: String) async -> ReceiptUpload {
        do {
            let url = try await service.uploadPaymentReceipt(fileName: fileName, mimeType: mimeType, data: data)
            return .success(url)
        } catch let error as APIError {
            return .failure(error.userMessage)
        } catch {
            return .failure(error.localizedDescription)
        }
    }

    /// Оплатить долг. Возвращает текст ошибки или `nil`.
    func pay(id: String, paidAt: String, method: String, receiptURL: String, comment: String?) async -> String? {
        await run { try await self.service.payDebt(id: id, paidAt: paidAt, method: method, receiptURL: receiptURL, comment: comment) }
    }

    /// Списать долг без оплаты.
    func writeOff(id: String, reason: String) async -> String? {
        await run { try await self.service.writeOffDebt(id: id, reason: reason) }
    }

    /// Перенести срок оплаты.
    func reschedule(id: String, dueDate: String, reason: String?) async -> String? {
        await run { try await self.service.rescheduleDebt(id: id, dueDate: dueDate, reason: reason) }
    }

    /// Общая обвязка: выполнить, перечитать доску, вернуть текст ошибки.
    private func run(_ work: () async throws -> Void) async -> String? {
        do {
            try await work()
            await load()
            return nil
        } catch let error as APIError {
            return error.userMessage
        } catch {
            return error.localizedDescription
        }
    }

    func load() async {
        // Прошлые долги — сразу: экран открывают, чтобы увидеть сумму, а не
        // скелет.
        if board == nil { board = await service.cached() }
        isLoading = board == nil
        defer { isLoading = false }
        do {
            board = try await service.load()
            error = nil
        } catch let apiError as APIError {
            error = apiError
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }
}

/// Счета поставщиков: кому и сколько должны, что уже просрочено.
///
/// Свод «должны / просрочено» приходит с сервера — это те же цифры, что в
/// биллинге на сайте.
///
/// Оплата, списание и перенос срока сначала были оставлены на сайте: решение
/// необратимое, деньги. Но смотрят на долг именно в телефоне — и уходили за
/// ноутбуком, чтобы нажать одну кнопку. Действия перенесены сюда, с двумя
/// оговорками: оплата не принимается без фотографии чека (так требует сервер,
/// и это правильно — иначе долг закрывается со слов), а списание требует
/// причины.
struct SupplierBillingScreen: View {
    @Environment(\.api) private var api

    @State private var store: SupplierBillingStore?
    @State private var filter: DebtFilter = .open
    @State private var selected: SupplierDebt?
    @State private var search = ""

    var body: some View {
        Group {
            if let store {
                if let error = store.error, store.board == nil {
                    ErrorStateView(error: error) { Task { await store.load() } }
                } else if let board = store.board {
                    content(board)
                } else {
                    LoadingRows(count: 7)
                }
            } else {
                LoadingRows(count: 7)
            }
        }
        .background(Theme.background)
        .navigationTitle("Долги поставщикам")
        .searchable(text: $search, prompt: "Поставщик, БИН или накладная")
        .toolbar { LogoutToolbarItem() }
        .task {
            if store == nil {
                let created = SupplierBillingStore(api: api)
                store = created
                await created.load()
            }
        }
        .refreshable { await store?.load() }
    }

    @ViewBuilder
    private func content(_ board: SupplierDebtBoard) -> some View {
        VStack(spacing: 0) {
            header(board)

            MasterDetail(
                items: filtered(board),
                selection: $selected,
                listWidth: 340
            ) { debt in
                SupplierDebtRow(debt: debt)
            } detail: { debt in
                SupplierDebtDetail(debt: debt, store: store)
            } empty: {
                WideEmptyState(
                    icon: filter == .overdue ? "checkmark.circle" : "doc.text",
                    title: emptyTitle,
                    message: emptyMessage
                )
            }
        }
    }

    private func header(_ board: SupplierDebtBoard) -> some View {
        VStack(spacing: Spacing.md) {
            HStack(spacing: Spacing.md) {
                SummaryPill(
                    title: "Должны",
                    value: Money.format(board.totals.open),
                    tint: board.totals.open > 0 ? Theme.warning : Theme.positive
                )
                SummaryPill(
                    title: "Просрочено",
                    value: Money.format(board.totals.overdue),
                    tint: board.totals.hasOverdue ? Theme.negative : Theme.textMuted
                )
                SummaryPill(
                    title: "Счетов открыто",
                    value: "\(board.totals.openCount)",
                    tint: Theme.textMuted
                )
            }

            if board.totals.hasOverdue {
                ProportionBar(ratio: board.totals.overdueShare, color: Theme.negative)
            }

            HStack(spacing: Spacing.sm) {
                ForEach(DebtFilter.allCases) { value in
                    FilterChip(title: value.label, isOn: value == filter) { filter = value }
                }
                Spacer()
            }
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.md)
    }

    private func filtered(_ board: SupplierDebtBoard) -> [SupplierDebt] {
        var items: [SupplierDebt]
        switch filter {
        case .open: items = board.byUrgency
        case .overdue: items = board.byUrgency.filter(\.isOverdue)
        case .closed: items = board.debts.filter { !$0.isOpen }
        }

        if !search.isEmpty {
            items = items.filter { debt in
                debt.supplierName.localizedCaseInsensitiveContains(search)
                    || (debt.binIIN?.contains(search) ?? false)
                    || (debt.invoiceNumber?.localizedCaseInsensitiveContains(search) ?? false)
            }
        }
        return items
    }

    private var emptyTitle: String {
        if !search.isEmpty { return "Ничего не найдено" }
        switch filter {
        case .open: return "Открытых счетов нет"
        case .overdue: return "Просрочек нет"
        case .closed: return "Закрытых счетов нет"
        }
    }

    private var emptyMessage: String {
        switch filter {
        case .open: "Все приёмки оплачены."
        case .overdue: "Все счета оплачены в срок."
        case .closed: "Здесь появятся оплаченные и списанные счета."
        }
    }
}

private struct SupplierDebtRow: View {
    let debt: SupplierDebt

    var body: some View {
        HStack(spacing: Spacing.md) {
            Text(debt.initials)
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundStyle(tint)
                .frame(width: 36, height: 36)
                .background(tint.opacity(0.14), in: Circle())

            VStack(alignment: .leading, spacing: 1) {
                Text(debt.supplierName)
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
                Text(Money.format(debt.amount))
                    .font(Typography.callout.weight(.medium))
                    .monospacedDigit()
                    .foregroundStyle(debt.isOpen ? Theme.text : Theme.textDim)
                dueChip
            }
        }
    }

    private var tint: Color {
        if debt.isOverdue { return Theme.negative }
        return debt.isOpen ? Theme.warning : Theme.positive
    }

    private var subtitle: String {
        var parts: [String] = []
        if let invoice = debt.invoiceNumber, !invoice.isEmpty { parts.append("№ \(invoice)") }
        if let received = debt.receivedAt {
            parts.append(received.formatted(.dateTime.day().month(.abbreviated)))
        }
        if let company = debt.companyName, !company.isEmpty { parts.append(company) }
        return parts.isEmpty ? debt.statusLabel : parts.joined(separator: " · ")
    }

    @ViewBuilder
    private var dueChip: some View {
        if debt.isOverdue {
            StatusChip(overdueLabel, kind: .danger)
        } else if debt.isConsignment {
            StatusChip("реализация", kind: .info)
        } else if !debt.isOpen {
            StatusChip(debt.statusLabel, kind: debt.isWrittenOff ? .neutral : .good)
        } else if let days = debt.daysUntilDue, days >= 0, days <= 7 {
            StatusChip(
                days == 0 ? "платить сегодня" : "через \(pluralize(days, "день", "дня", "дней"))",
                kind: .warning
            )
        }
    }

    /// Дни просрочки — только подпись к признаку, а не сам признак.
    private var overdueLabel: String {
        guard let days = debt.daysUntilDue, days < 0 else { return "просрочен" }
        return "просрочен \(pluralize(-days, "день", "дня", "дней"))"
    }
}

private struct SupplierDebtDetail: View {
    let debt: SupplierDebt
    /// Хранилище нужно, чтобы после оплаты доска перечиталась: суммы «должны»
    /// и «просрочено» меняются вместе с долгом.
    var store: SupplierBillingStore?

    @Environment(\.access) private var access

    @State private var payOpen = false
    @State private var writeOffOpen = false
    @State private var rescheduleOpen = false
    @State private var done: ToastMessage?

    private var canPay: Bool { access?.can("store-billing.pay_debt") ?? false }
    private var canWriteOff: Bool { access?.can("store-billing.write_off_debt") ?? false }
    private var canReschedule: Bool { access?.can("store-billing.reschedule_debt") ?? false }

    /// Действия есть только у открытого долга: оплаченный и списанный уже
    /// закрыты, и кнопки на них были бы обманом.
    private var isOpen: Bool { debt.status == "open" || debt.status == "overdue" }

    var body: some View {
        ScreenScroll {
            VStack(spacing: Spacing.lg) {
                if isOpen, canPay || canWriteOff || canReschedule {
                    Card {
                        VStack(spacing: Spacing.sm) {
                            if canPay {
                                Button("Оплатить") { payOpen = true }
                                    .buttonStyle(PrimaryButtonStyle())
                            }
                            if canReschedule {
                                Button("Перенести срок") { rescheduleOpen = true }
                                    .buttonStyle(SecondaryButtonStyle())
                            }
                            if canWriteOff {
                                Button("Списать без оплаты") { writeOffOpen = true }
                                    .buttonStyle(SecondaryButtonStyle())
                            }
                        }
                    }
                }

                Card(accent: accent) {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        Text(debt.supplierName)
                            .font(Typography.title)
                            .foregroundStyle(Theme.text)
                        if let bin = debt.binIIN, !bin.isEmpty {
                            Text("БИН / ИИН \(bin)")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textDim)
                        }

                        Text(Money.format(debt.amount))
                            .font(Typography.hero)
                            .foregroundStyle(Theme.text)
                            .lineLimit(1)
                            .minimumScaleFactor(0.5)

                        HStack(spacing: Spacing.sm) {
                            StatusChip(debt.statusLabel, kind: statusKind)
                            if debt.isConsignment {
                                StatusChip("реализация", kind: .info)
                            }
                        }
                    }
                }

                Card {
                    VStack(spacing: Spacing.md) {
                        SectionHeader("Счёт")
                        if let invoice = debt.invoiceNumber, !invoice.isEmpty {
                            StatRow("Накладная", value: "№ \(invoice)", icon: "doc.text")
                        }
                        if let received = debt.receivedAt {
                            StatRow(
                                "Принято",
                                value: received.formatted(.dateTime.day().month(.wide).year()),
                                icon: "shippingbox"
                            )
                        }
                        if let company = debt.companyName, !company.isEmpty {
                            StatRow("Точка", value: company, icon: "building.2")
                        }
                        if let due = debt.dueDate {
                            StatRow(
                                "Оплатить до",
                                value: due.formatted(.dateTime.day().month(.wide).year()),
                                valueColor: debt.isOverdue ? Theme.negative : Theme.text,
                                icon: "calendar"
                            )
                        } else if debt.isOpen {
                            StatRow("Оплатить до", value: "срок не задан", icon: "calendar")
                        }
                    }
                }

                if !debt.isOpen {
                    Card {
                        VStack(spacing: Spacing.md) {
                            SectionHeader(debt.isWrittenOff ? "Списание" : "Оплата")
                            if let paid = debt.paidAt {
                                StatRow(
                                    "Дата",
                                    value: paid.formatted(.dateTime.day().month(.wide).year()),
                                    icon: "checkmark.circle"
                                )
                            }
                            if debt.paidCash > 0 {
                                StatRow("Наличными", value: Money.format(debt.paidCash), icon: "banknote")
                            }
                            if debt.paidKaspi > 0 {
                                StatRow("Переводом", value: Money.format(debt.paidKaspi), icon: "creditcard")
                            }
                            if let comment = debt.comment, !comment.isEmpty {
                                Text(comment)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.textMuted)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                    }
                }
            }
        }
        .background(Theme.background)
        .navigationTitle(debt.supplierName)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    
        .toast($done)
        .sheet(isPresented: $payOpen) {
            DebtPaySheet(debt: debt, store: store) { done = ToastMessage("Долг оплачен") }
        }
        .sheet(isPresented: $writeOffOpen) {
            DebtReasonSheet(
                title: "Списать долг",
                note: "Списание означает, что поставщик этих денег не получит. Причина обязательна: через полгода никто не вспомнит, почему так решили.",
                actionTitle: "Списать"
            ) { reason in
                let error = await store?.writeOff(id: debt.id, reason: reason)
                if error == nil { done = ToastMessage("Долг списан") }
                return error
            }
        }
        .sheet(isPresented: $rescheduleOpen) {
            DebtRescheduleSheet(debt: debt, store: store) { done = ToastMessage("Срок перенесён") }
        }
}

    private var accent: Color {
        if debt.isOverdue { return Theme.negative }
        return debt.isOpen ? Theme.warning : Theme.positive
    }

    private var statusKind: StatusChip.Kind {
        if debt.isOverdue { return .danger }
        if debt.isPaid { return .good }
        if debt.isWrittenOff { return .neutral }
        return .warning
    }
}

// ── Действия с долгом поставщику ─────────────────────────────────────────────

/// Оплата долга: дата, способ, чек.
///
/// Чек обязателен — так требует сервер, и это правильно: иначе долг
/// закрывается со слов, а через месяц никто не докажет, что деньги ушли.
/// Фотографируют его тут же, телефоном; в этом и смысл переноса действия сюда.
private struct DebtPaySheet: View {
    let debt: SupplierDebt
    var store: SupplierBillingStore?
    /// Подтверждение показывает родитель: это окно к тому времени закроется.
    var onDone: () -> Void = {}

    @Environment(\.dismiss) private var dismiss

    @State private var paidAt = Date()
    @State private var method = "cash"
    @State private var comment = ""
    @State private var photo: PhotosPickerItem?
    @State private var receiptURL: String?
    @State private var isUploading = false
    @State private var isSaving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScreenScroll {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        SectionHeader(debt.supplierName, subtitle: Money.format(debt.amount))

                        FieldLabel("Дата оплаты")
                        DatePicker("", selection: $paidAt, displayedComponents: .date)
                            .labelsHidden()

                        FieldLabel("Чем платили")
                        Picker("Чем платили", selection: $method) {
                            Text("Наличными").tag("cash")
                            Text("Kaspi").tag("kaspi")
                        }
                        .pickerStyle(.segmented)

                        FieldLabel("Чек об оплате")
                        if receiptURL != nil {
                            Label("Чек загружен", systemImage: "checkmark.circle.fill")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.positive)
                        }
                        PhotosPicker(selection: $photo, matching: .images) {
                            Label(
                                isUploading ? "Загружаем…" : (receiptURL == nil ? "Сфотографировать чек" : "Заменить чек"),
                                systemImage: "camera"
                            )
                        }
                        .buttonStyle(SecondaryButtonStyle())
                        .disabled(isUploading || isSaving)

                        FieldLabel("Комментарий")
                        TextField("необязательно", text: $comment)
                            .textFieldStyle(.plain)
                            .font(Typography.callout)

                        if let error {
                            Text(error).font(Typography.caption).foregroundStyle(Theme.negative)
                        }

                        Button(isSaving ? "Сохраняем…" : "Оплатить") {
                            Task { await pay() }
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(isSaving || isUploading || receiptURL == nil)

                        if receiptURL == nil {
                            Text("Без чека оплата не принимается — так устроен учёт долгов.")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textDim)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
            .background(Theme.background)
            .navigationTitle("Оплата долга")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } } }
            .onChange(of: photo) { _, item in
                guard let item else { return }
                Task { await upload(item) }
            }
        }
    }

    private func upload(_ item: PhotosPickerItem) async {
        isUploading = true
        defer { isUploading = false }
        guard let data = try? await item.loadTransferable(type: Data.self) else {
            error = "Не удалось прочитать фотографию"
            return
        }
        switch await store?.uploadReceipt(data: data, fileName: "receipt.jpg", mimeType: "image/jpeg") {
        case let .success(url):
            receiptURL = url
            error = nil
        case let .failure(message):
            error = message
        case nil:
            error = "Не удалось загрузить чек"
        }
    }

    private func pay() async {
        guard let receiptURL else { return }
        isSaving = true
        defer { isSaving = false }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"

        error = await store?.pay(
            id: debt.id,
            paidAt: formatter.string(from: paidAt),
            method: method,
            receiptURL: receiptURL,
            comment: comment.trimmingCharacters(in: .whitespaces).isEmpty ? nil : comment
        )
        if error == nil {
            Haptics.success()
            onDone()
            dismiss()
        } else {
            Haptics.error()
        }
    }
}

/// Действие, которому нужна причина: списание долга.
private struct DebtReasonSheet: View {
    let title: String
    let note: String
    let actionTitle: String
    let action: (String) async -> String?

    @Environment(\.dismiss) private var dismiss

    @State private var reason = ""
    @State private var isSaving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScreenScroll {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        Text(note)
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                            .fixedSize(horizontal: false, vertical: true)

                        FieldLabel("Причина")
                        TextField("например: поставщик закрылся", text: $reason)
                            .textFieldStyle(.plain)
                            .font(Typography.callout)

                        if let error {
                            Text(error).font(Typography.caption).foregroundStyle(Theme.negative)
                        }

                        Button(isSaving ? "Сохраняем…" : actionTitle) {
                            Task {
                                isSaving = true
                                defer { isSaving = false }
                                error = await action(reason.trimmingCharacters(in: .whitespaces))
                                if error == nil {
                                    Haptics.success()
                                    dismiss()
                                } else {
                                    Haptics.error()
                                }
                            }
                        }
                        .buttonStyle(DestructiveButtonStyle())
                        .disabled(isSaving || reason.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
            .background(Theme.background)
            .navigationTitle(title)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } } }
        }
    }
}

/// Перенос срока оплаты.
private struct DebtRescheduleSheet: View {
    let debt: SupplierDebt
    var store: SupplierBillingStore?
    var onDone: () -> Void = {}

    @Environment(\.dismiss) private var dismiss

    @State private var dueDate = Date()
    @State private var reason = ""
    @State private var isSaving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScreenScroll {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        SectionHeader(debt.supplierName, subtitle: Money.format(debt.amount))

                        FieldLabel("Новый срок")
                        DatePicker("", selection: $dueDate, displayedComponents: .date)
                            .labelsHidden()

                        FieldLabel("Причина")
                        TextField("необязательно", text: $reason)
                            .textFieldStyle(.plain)
                            .font(Typography.callout)

                        if let error {
                            Text(error).font(Typography.caption).foregroundStyle(Theme.negative)
                        }

                        Button(isSaving ? "Сохраняем…" : "Перенести") {
                            Task { await save() }
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(isSaving)
                    }
                }
            }
            .background(Theme.background)
            .navigationTitle("Срок оплаты")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } } }
        }
    }

    private func save() async {
        isSaving = true
        defer { isSaving = false }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        error = await store?.reschedule(
            id: debt.id,
            dueDate: formatter.string(from: dueDate),
            reason: reason.trimmingCharacters(in: .whitespaces).isEmpty ? nil : reason
        )
        if error == nil {
            Haptics.success()
            onDone()
            dismiss()
        } else {
            Haptics.error()
        }
    }
}
