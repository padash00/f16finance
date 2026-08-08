import OrdaKit
import OrdaUI
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
    @State private var store: SimulationStore?

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
                        Text("Зоны и тарифы задают на сайте, в разделе «Симуляция выручки». Без них считать потенциал не из чего.")
                            .font(Typography.callout)
                            .foregroundStyle(Theme.textMuted)
                    }
                }
            } else {
                headline(projection, fact: simulation.fact)

                DashboardGrid {
                    MetricTile(
                        label: "Потенциал / мес",
                        value: Money.compact(projection.potentialPerMonth),
                        icon: "chart.bar.fill",
                        accent: Theme.brand
                    )
                    MetricTile(
                        label: "Факт / мес",
                        value: Money.compact(projection.factPerMonth),
                        icon: "banknote.fill",
                        accent: Theme.positive
                    )
                    MetricTile(
                        label: projection.isUnderPotential ? "Недобор / мес" : "Сверх модели / мес",
                        value: Money.compact(abs(projection.gapPerMonth)),
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

                Text(Money.compact(abs(projection.gapPerMonth)))
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
                    Text(Money.compact(zone.potentialPerMonth))
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

@MainActor @Observable
final class SupplierBillingStore {
    private(set) var board: SupplierDebtBoard?
    private(set) var isLoading = false
    private(set) var error: APIError?

    private let service: SupplierDebtService

    init(api: APIClient) { service = SupplierDebtService(api: api) }

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

/// Счета поставщиков: кому и сколько должны, что уже просрочено.
///
/// Свод «должны / просрочено» приходит с сервера — это те же цифры, что в
/// биллинге на сайте. Оплата и списание долга остаются там: это необратимые
/// действия с деньгами, и делать их мимоходом с телефона незачем.
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
                SupplierDebtDetail(debt: debt)
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
                    value: Money.compact(board.totals.open),
                    tint: board.totals.open > 0 ? Theme.warning : Theme.positive
                )
                SummaryPill(
                    title: "Просрочено",
                    value: Money.compact(board.totals.overdue),
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
                Text(Money.compact(debt.amount))
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

    var body: some View {
        ScreenScroll {
            VStack(spacing: Spacing.lg) {
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
