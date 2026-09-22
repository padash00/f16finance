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
                // Главное — сколько получателей снимают требование чека и
                // сколько из них действуют на всех точках сразу.
                HeroSummary(
                    title: "Доверенных поставщиков",
                    value: "\(board.vendors.count)",
                    caption: "расход в их пользу проводится без чека",
                    footer: [
                        ("На все точки", "\(board.vendors.count - board.companyScopedCount)"),
                        ("Ограничены точкой", "\(board.companyScopedCount)"),
                    ],
                    colors: Theme.heroGradient
                )

                explainer

                if vendors.isEmpty {
                    OwnerSection("Список") {
                        InlineEmpty(
                            icon: search.isEmpty ? "shield.slash" : "magnifyingglass",
                            text: search.isEmpty
                                ? "Доверенных поставщиков нет — каждый расход требует чека"
                                : "Никого не найдено",
                            tint: Theme.textDim
                        )
                    }
                } else {
                    OwnerSection("Список") {
                        Text("сначала на всех точках")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textDim)
                    } content: {
                        VStack(spacing: Spacing.md) {
                            ForEach(vendors, id: \.id) { vendor in
                                TrustedVendorRow(vendor: vendor, board: board)
                            }
                        }
                    }
                }
            }
        }
    }

    private var explainer: some View {
        OwnerSection("Что это значит") {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Text("Расход в пользу такого получателя проводится без фото чека. Удобно для зарплат, аренды, уборки и регулярных услуг — и опасно для всего остального.")
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
                Text("Категория из строки подставляется в расход автоматически.")
                    .font(.system(size: 13))
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
            TintedIcon(systemName: "checkmark.shield.fill", tint: Theme.positive, size: 40)

            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                    Text(vendor.name)
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                    Spacer(minLength: Spacing.sm)
                    // Граница действия подписью, а не плашкой: плашка съедала
                    // полстроки, и имя обрезалось.
                    Text(board.companyName(vendor.companyID))
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(vendor.isCompanyScoped ? Theme.info : Theme.warning)
                        .lineLimit(1)
                }

                HStack(spacing: Spacing.xs) {
                    if let category = board.categoryName(vendor.defaultCategoryID) {
                        Text(category)
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textDim)
                    }
                    if let notes = vendor.notes, !notes.isEmpty {
                        Text(notes)
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textDim)
                            .italic()
                            .lineLimit(1)
                    }
                }
            }
        }
        .padding(.vertical, Spacing.xs)
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
                OwnerSection("Модель не заполнена") {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        Text("Без зон и тарифов считать потенциал не из чего.")
                            .font(.system(size: 15))
                            .foregroundStyle(Theme.textMuted)

                        if canEdit {
                            Button("Заполнить модель") { isEditing = true }
                                .buttonStyle(PrimaryButtonStyle())
                        }
                    }
                }
            } else {
                headline(projection, fact: simulation.fact)

                occupancy(projection)

                SplitDashboard {
                    zonesTable(projection)
                } side: {
                    tariffs(projection)
                    disclaimer(simulation.fact)
                }
            }
        }
    }

    // ── Итог ─────────────────────────────────────────────────────────────────

    /// Разрыв с потенциалом — главной цифрой; потенциал, факт и число
    /// устройств — её расшифровкой, а не четырьмя плитками под ней.
    private func headline(_ projection: SimulationProjection, fact: SimulationFact?) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HeroSummary(
                title: projection.isUnderPotential ? "Недозарабатываем за месяц" : "Факт выше расчётного потенциала",
                value: Money.format(abs(projection.gapPerMonth)),
                caption: projection.factShare.map { "факт выбирает \(Percent.format($0 * 100)) потенциала" },
                footer: [
                    ("Потенциал / мес", Money.format(projection.potentialPerMonth)),
                    ("Факт / мес", Money.format(projection.factPerMonth)),
                    ("Устройств", Quantity.format(projection.totalDevices)),
                ],
                colors: projection.isUnderPotential
                    ? Theme.heroGradient
                    : Theme.heroGradient
            )

            if let fact {
                OwnerFootnote(text: "Факт — вся выручка точки за \(pluralize(fact.windowDays, "день", "дня", "дней")), включая бар и допуслуги.")
            }
        }
    }

    // ── Обратный расчёт ──────────────────────────────────────────────────────

    @ViewBuilder
    private func occupancy(_ projection: SimulationProjection) -> some View {
        if let implied = projection.impliedOccupancyHours {
            OwnerSection("Обратный расчёт загрузки") {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    Text("что должно быть, чтобы сходилось")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textDim)

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

    /// Зоны: кольцо долей потенциала и строки под ним — вместо столбиков и
    /// отдельной таблицы с теми же зонами.
    private func zonesTable(_ projection: SimulationProjection) -> some View {
        let zones = projection.zonesByPotential
        let total = max(zones.reduce(0) { $0 + $1.potentialPerMonth }, 1)

        return OwnerSection("Зоны") {
            Text("₸ / мес")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textDim)
        } content: {
            VStack(spacing: Spacing.lg) {
                DonutChart(
                    slices: zones.enumerated().map { index, zone in
                        ShareSlice(label: zone.name, value: max(zone.potentialPerMonth, 0), color: OwnerTint.point(index))
                    },
                    centerTitle: "Потенциал",
                    centerValue: Money.format(projection.potentialPerMonth),
                    showsLegend: false
                )

                VStack(spacing: Spacing.md) {
                    ForEach(Array(zones.enumerated()), id: \.element.id) { index, zone in
                        SimulationZoneRow(zone: zone, tint: OwnerTint.point(index), share: zone.potentialPerMonth / total)
                    }
                }
            }
        }
    }

    // ── Тарифы ───────────────────────────────────────────────────────────────

    private func tariffs(_ projection: SimulationProjection) -> some View {
        OwnerSection("Тарифы") {
            Text("₸ за час с бонусами")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textDim)
        } content: {
            VStack(spacing: Spacing.md) {
                ForEach(Array(projection.tariffs.enumerated()), id: \.element.id) { index, tariff in
                    AmountRow(
                        leading: { TintedIcon(systemName: "tag.fill", tint: OwnerTint.point(index), size: 40) },
                        title: tariff.name,
                        subtitle: "\(tariff.hoursLabel) · \(Money.format(tariff.price))",
                        amount: "\(Money.format(tariff.ratePerHour))/ч"
                    )
                }
            }
        }
    }

    @ViewBuilder
    private func disclaimer(_ fact: SimulationFact?) -> some View {
        OwnerSection("Как читать") {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Text("Потенциал — это только выручка за время устройств при заложенной загрузке. Бар, допуслуги и продажи в него не входят, поэтому факт может оказаться выше.")
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
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
    let tint: Color
    let share: Double

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            AmountRow(
                leading: { TintedIcon(systemName: "desktopcomputer", tint: tint, size: 40) },
                title: zone.name,
                subtitle: "\(zone.deviceTypeLabel) · \(Quantity.format(zone.deviceCount)) шт · \(Quantity.format(zone.occupancyHours)) ч/сут · \(Money.format(zone.blendedRate))/ч",
                amount: Money.format(zone.potentialPerMonth),
                share: share,
                tint: tint
            )

            // Незаполненный микс — не косметика: потенциал зоны занижен ровно
            // на долю устройств, которым не назначен тариф.
            if zone.hasNoMix {
                Text("тарифы не назначены")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.negative)
                    .padding(.leading, 40 + Spacing.md)
            } else if zone.hasBrokenMix {
                Text("микс \(Percent.format(zone.shareSum)) вместо 100 %")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.warning)
                    .padding(.leading, 40 + Spacing.md)
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

    /// Долг главной цифрой, просрочка и число счетов — её расшифровкой.
    /// Цвет карточки говорит сразу: красный — есть просрочка, оранжевый —
    /// долг в срок, зелёный — никому не должны.
    private func header(_ board: SupplierDebtBoard) -> some View {
        let totals = board.totals
        let options: [(value: DebtFilter, title: String)] = DebtFilter.allCases.map { (value: $0, title: $0.label) }
        return VStack(spacing: Spacing.md) {
            HeroSummary(
                title: totals.open > 0 ? "Должны поставщикам" : "Долгов нет",
                value: Money.format(totals.open),
                caption: totals.hasOverdue
                    ? "просрочено \(Percent.format(totals.overdueShare * 100)) долга"
                    : nil,
                footer: [
                    ("Просрочено", Money.format(totals.overdue)),
                    ("Счетов открыто", "\(totals.openCount)"),
                ],
                colors: totals.hasOverdue
                    ? Theme.heroNegative
                    : totals.open > 0
                        ? Theme.heroGradient
                        : Theme.heroGradient
            )

            PillSegment(options: options, selection: $filter)
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
                .font(.system(size: 15, weight: .bold, design: .rounded))
                .foregroundStyle(tint)
                .frame(width: 40, height: 40)
                .background(tint.opacity(0.14), in: Circle())

            VStack(alignment: .leading, spacing: 2) {
                Text(debt.supplierName)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 2) {
                Text(Money.format(debt.amount))
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(debt.isOpen ? Theme.text : Theme.textDim)
                dueLabel
            }
            .fixedSize()
        }
        .padding(.vertical, Spacing.xs)
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

    /// Срок подписью цвета статуса, а не плашкой — плашка съедала полстроки.
    @ViewBuilder
    private var dueLabel: some View {
        if debt.isOverdue {
            statusText(overdueLabel, color: Theme.negative)
        } else if debt.isConsignment {
            statusText("реализация", color: Theme.info)
        } else if !debt.isOpen {
            statusText(debt.statusLabel.lowercased(), color: debt.isWrittenOff ? Theme.textDim : Theme.positive)
        } else if let days = debt.daysUntilDue, days >= 0, days <= 7 {
            statusText(
                days == 0 ? "платить сегодня" : "через \(pluralize(days, "день", "дня", "дней"))",
                color: Theme.warning
            )
        }
    }

    private func statusText(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(color)
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
                // Сумма долга — цветной карточкой: цвет сразу говорит, горит
                // ли срок, как в строке списка.
                HeroSummary(
                    title: debt.supplierName,
                    value: Money.format(debt.amount),
                    caption: heroCaption,
                    colors: heroColors
                )

                if isOpen, canPay || canWriteOff || canReschedule {
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

                OwnerSection("Счёт") {
                    VStack(spacing: Spacing.md) {
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
                    OwnerSection(debt.isWrittenOff ? "Списание" : "Оплата") {
                        VStack(spacing: Spacing.md) {
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

    /// Статус, признак реализации и БИН — одной подписью под суммой.
    private var heroCaption: String {
        var parts = [debt.statusLabel]
        if debt.isConsignment { parts.append("реализация") }
        if let bin = debt.binIIN, !bin.isEmpty { parts.append("БИН / ИИН \(bin)") }
        return parts.joined(separator: " · ")
    }

    private var heroColors: [Color] {
        if debt.isOverdue { return Theme.heroNegative }
        if debt.isOpen { return Theme.heroGradient }
        if debt.isWrittenOff { return Theme.heroGradient }
        return Theme.heroGradient
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
                        PillSegment(
                            options: [(value: "cash", title: "Наличными"), (value: "kaspi", title: "Kaspi")],
                            selection: $method
                        )

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
