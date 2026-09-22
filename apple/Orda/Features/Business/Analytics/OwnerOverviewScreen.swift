import OrdaKit
import OrdaUI
import SwiftUI

/// Показатель, который рисует большой график «Обзора».
enum OverviewMetric: String, CaseIterable, Identifiable {
    case revenue, expense, profit

    var id: String { rawValue }

    var title: String {
        switch self {
        case .revenue: "Выручка"
        case .expense: "Расходы"
        case .profit: "Прибыль"
        }
    }

    var color: Color {
        switch self {
        case .revenue: ChartPalette.series1
        case .expense: ChartPalette.series3
        case .profit: ChartPalette.series2
        }
    }

    var higherIsBetter: Bool { self != .expense }

    func value(_ p: OwnerAnalytics.SeriesPoint) -> Double {
        switch self {
        case .revenue: p.revenue
        case .expense: p.expense
        case .profit: p.profit
        }
    }

    func previous(_ p: OwnerAnalytics.SeriesPoint) -> Double {
        switch self {
        case .revenue: p.prevRevenue
        case .expense: p.prevExpense
        case .profit: p.prevProfit
        }
    }
}

/// «Обзор» владельца: главные цифры за выбранный период и где смотреть дальше.
///
/// Сверху — то, что требует решения, потом показатели, потом из чего они
/// сложились: по дням, по точкам, по способам оплаты, по статьям. Нажатие на
/// показатель перерисовывает большой график, нажатие на точку — сужает фильтр
/// до неё.
struct OwnerOverviewScreen: View {
    let resolver: AccessResolver

    @Environment(AnalyticsStore.self) private var analytics
    @Environment(BusinessStore.self) private var business
    @Environment(\.surface) private var surface

    @State private var metric: OverviewMetric = .revenue

    var body: some View {
        ScreenScroll {
            content
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            AnalyticsFilterBar()
        }
        .refreshable { await analytics.load() }
        // Переходы из «Требует внимания» — в разделы по тем же адресам, что в
        // «Разделах»: у вкладки «Обзор» свой стек, и без этого ссылка молчала бы.
        .navigationDestination(for: SectionRoute.self) { route in
            NativePage.screen(pageID: route.pageID)
        }
        .navigationTitle("Обзор")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task {
            if analytics.data == nil { await analytics.load() }
        }
    }

    @ViewBuilder
    private var content: some View {
        attention

        if let data = analytics.data {
            kpiGrid(data)
            if surface.isCompact {
                chartCard(data)
                companiesCard(data)
                paymentsCard(data)
                expensesCard(data)
                weekdaysCard(data)
            } else {
                SplitDashboard {
                    VStack(spacing: Spacing.lg) {
                        chartCard(data)
                        companiesCard(data)
                        weekdaysCard(data)
                    }
                } side: {
                    VStack(spacing: Spacing.lg) {
                        paymentsCard(data)
                        expensesCard(data)
                    }
                }
            }
            footnote
        } else if let error = analytics.error {
            ErrorStateView(error: error) { Task { await analytics.load() } }
        } else {
            skeleton
        }
    }

    // ── Требует внимания ─────────────────────────────────────────────────────

    /// Только то, что ждёт решения владельца. Пусто — блока нет: «всё хорошо»
    /// каждый день превращается в шум, который перестают читать.
    @ViewBuilder
    private var attention: some View {
        let pending = business.pending
        let lowStock = resolver.can("inventory.view") ? (business.dashboard?.lowStock ?? []) : []
        if !pending.isEmpty || !lowStock.isEmpty {
            Card(accent: Theme.warning) {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    SectionHeader("Требует внимания") { EmptyView() }
                    if !pending.isEmpty {
                        NavigationLink(value: SectionRoute(pageID: "expenses-pending")) {
                            NavigationRow(
                                icon: "clock.badge.exclamationmark",
                                iconColor: Theme.warning,
                                title: "Расходы на согласовании: \(pending.count)",
                                subtitle: Money.format(pending.reduce(0) { $0 + $1.total })
                            )
                        }
                        .buttonStyle(.pressable)
                    }
                    if !pending.isEmpty && !lowStock.isEmpty { RowDivider() }
                    if !lowStock.isEmpty {
                        NavigationLink(value: SectionRoute(pageID: "store-warehouse")) {
                            NavigationRow(
                                icon: "shippingbox",
                                iconColor: Theme.warning,
                                title: "Заканчивается на складе: \(lowStock.count)",
                                subtitle: lowStock.prefix(3).map(\.name).joined(separator: ", ")
                            )
                        }
                        .buttonStyle(.pressable)
                    }
                }
            }
        }
    }

    // ── Показатели ───────────────────────────────────────────────────────────

    private func kpiGrid(_ data: OwnerAnalytics) -> some View {
        let cur = data.kpi.current
        let prev = data.kpi.previous
        let pos = data.pos

        return LazyVGrid(
            columns: [GridItem(.adaptive(minimum: surface.isCompact ? 150 : 180), spacing: Spacing.md, alignment: .top)],
            spacing: Spacing.md
        ) {
            metricCard(.revenue, value: cur.revenue, previous: prev.revenue, icon: "arrow.down.circle", data: data)
            metricCard(.expense, value: cur.expense, previous: prev.expense, icon: "arrow.up.circle", data: data)
            metricCard(.profit, value: cur.profit, previous: prev.profit, icon: "chart.line.uptrend.xyaxis", data: data)

            KPICard(
                title: "Маржа",
                icon: "percent",
                value: Percent.format(cur.marginPercent),
                previous: prev.marginPercent.map { Percent.format($0) },
                change: cur.marginPercent.flatMap { c in prev.marginPercent.map { c - $0 } },
                accent: ChartPalette.series2,
                changeInPoints: true
            )

            if let pos {
                KPICard(
                    title: "Средний чек",
                    icon: "receipt",
                    value: Money.format(pos.avgCheck),
                    previous: Money.format(pos.previous.avgCheck),
                    change: Percent.change(current: pos.avgCheck, previous: pos.previous.avgCheck),
                    accent: ChartPalette.series1
                )
                KPICard(
                    title: "Чеков",
                    icon: "number",
                    value: pos.receipts.formatted(),
                    previous: pos.previous.receipts.formatted(),
                    change: Percent.change(current: Double(pos.receipts), previous: Double(pos.previous.receipts)),
                    accent: ChartPalette.series1
                )
            } else {
                // Клуб без кассы: вместо чеков — смены из отчётов.
                let perShift = cur.shifts > 0 ? cur.revenue / Double(cur.shifts) : 0
                let prevPerShift = prev.shifts > 0 ? prev.revenue / Double(prev.shifts) : 0
                KPICard(
                    title: "За смену",
                    icon: "clock",
                    value: Money.format(perShift),
                    previous: Money.format(prevPerShift),
                    change: Percent.change(current: perShift, previous: prevPerShift),
                    accent: ChartPalette.series1
                )
                KPICard(
                    title: "Смен",
                    icon: "number",
                    value: cur.shifts.formatted(),
                    previous: prev.shifts.formatted(),
                    change: Percent.change(current: Double(cur.shifts), previous: Double(prev.shifts)),
                    accent: ChartPalette.series1
                )
            }
        }
    }

    private func metricCard(
        _ kind: OverviewMetric,
        value: Double,
        previous: Double,
        icon: String,
        data: OwnerAnalytics
    ) -> some View {
        Button {
            withAnimation(Motion.value) { metric = kind }
        } label: {
            KPICard(
                title: kind.title,
                icon: icon,
                value: Money.format(value),
                previous: Money.format(previous),
                change: Percent.change(current: value, previous: previous),
                higherIsBetter: kind.higherIsBetter,
                spark: data.series.map { kind.value($0) },
                accent: kind.color,
                isSelected: metric == kind
            )
        }
        .buttonStyle(.plain)
    }

    // ── График ───────────────────────────────────────────────────────────────

    private func chartCard(_ data: OwnerAnalytics) -> some View {
        let total = data.series.reduce(0) { $0 + metric.value($1) }
        let prevTotal = data.series.reduce(0) { $0 + metric.previous($1) }
        return Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(metric.title + Self.groupSuffix(data.period.group))
                            .font(Typography.label)
                            .foregroundStyle(Theme.textDim)
                        Text(Money.format(total))
                            .font(Typography.monospacedDigits(Typography.title))
                            .foregroundStyle(Theme.text)
                    }
                    Spacer()
                    DeltaBadge(change: Percent.change(current: total, previous: prevTotal), higherIsBetter: metric.higherIsBetter)
                }
                Picker("Показатель", selection: $metric.animation(Motion.value)) {
                    ForEach(OverviewMetric.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)

                ComparisonChart(
                    points: Self.points(data, metric: metric),
                    color: metric.color,
                    asBars: data.period.group != .day || data.series.count <= 7
                )
            }
        }
    }

    static func groupSuffix(_ group: AnalyticsGroup) -> String {
        switch group {
        case .day: " по дням"
        case .week: " по неделям"
        case .month: " по месяцам"
        }
    }

    static func points(_ data: OwnerAnalytics, metric: OverviewMetric) -> [ComparisonPoint] {
        data.series.enumerated().compactMap { index, p in
            guard let date = DateParsing.parseDateOnly(p.date) else { return nil }
            return ComparisonPoint(
                id: index,
                date: date,
                label: bucketLabel(p.date, group: data.period.group),
                value: metric.value(p),
                previousLabel: bucketLabel(p.prevDate, group: data.period.group),
                previous: metric.previous(p)
            )
        }
    }

    static func bucketLabel(_ iso: String, group: AnalyticsGroup) -> String {
        switch group {
        case .day: return AnalyticsPeriod.rangeLabel(from: iso, to: iso)
        case .week: return "неделя с " + AnalyticsPeriod.rangeLabel(from: iso, to: iso)
        case .month:
            guard let date = DateParsing.parseDateOnly(iso) else { return iso }
            return date.formatted(.dateTime.month(.wide).year().locale(Locale(identifier: "ru_RU")))
        }
    }

    // ── Точки ────────────────────────────────────────────────────────────────

    @ViewBuilder
    private func companiesCard(_ data: OwnerAnalytics) -> some View {
        if data.byCompany.count > 1 {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("Точки", subtitle: "выручка · нажмите, чтобы смотреть только её") { EmptyView() }
                    RankedBars(
                        rows: data.byCompany.map { row in
                            RankedBarRow(
                                id: row.id,
                                label: row.name,
                                value: row.revenue,
                                change: Percent.change(current: row.revenue, previous: row.prevRevenue),
                                caption: "прибыль \(Money.format(row.profit))"
                            )
                        },
                        onSelect: { row in analytics.filter.companyIDs = [row.id] }
                    )
                }
            }
        }
    }

    // ── Оплаты ───────────────────────────────────────────────────────────────

    private func paymentsCard(_ data: OwnerAnalytics) -> some View {
        let k = data.kpi.current
        let slices = [
            ShareSlice(label: "Наличные", value: k.cash, color: ChartPalette.series1),
            ShareSlice(label: "Kaspi", value: k.kaspi, color: ChartPalette.series2),
            ShareSlice(label: "Карта", value: k.card, color: ChartPalette.series3),
            ShareSlice(label: "Онлайн", value: k.online, color: Theme.accent),
        ].filter { $0.value > 0 }
        return Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Чем платили") { EmptyView() }
                DonutChart(slices: slices, centerTitle: "Выручка", centerValue: Money.format(k.revenue))
            }
        }
    }

    // ── Расходы ──────────────────────────────────────────────────────────────

    @ViewBuilder
    private func expensesCard(_ data: OwnerAnalytics) -> some View {
        if let categories = data.expenseCategories, !categories.isEmpty {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("Куда ушли деньги", subtitle: "\(categories.count) статей") { EmptyView() }
                    DonutChart(
                        slices: SharePalette.slices(categories.map { ($0.name, $0.amount) }),
                        centerTitle: "Расходы",
                        centerValue: Money.format(data.kpi.current.expense)
                    )
                }
            }
        }
    }

    // ── Дни недели ───────────────────────────────────────────────────────────

    @ViewBuilder
    private func weekdaysCard(_ data: OwnerAnalytics) -> some View {
        // Меньше недели — средние по дням недели ни о чём не говорят.
        if data.weekdays.reduce(0, { $0 + $1.days }) >= 7 {
            let names = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
            let best = data.weekdays.max { $0.average < $1.average }
            CategoryBarChart(
                title: "Средняя выручка по дням недели",
                points: data.weekdays.map {
                    CategoryPoint(label: names[$0.weekday], value: $0.average, isHighlighted: $0.weekday == best?.weekday)
                }
            )
        }
    }

    // ── Прочее ───────────────────────────────────────────────────────────────

    @ViewBuilder
    private var footnote: some View {
        if let loadedAt = analytics.loadedAt {
            Text("Выручка и расходы — по отчётам смен, как на сайте. Обновлено \(loadedAt.formatted(.relative(presentation: .named).locale(Locale(identifier: "ru_RU")))).")
                .font(.system(size: 11))
                .foregroundStyle(Theme.textDim)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var skeleton: some View {
        VStack(spacing: Spacing.md) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: Spacing.md)], spacing: Spacing.md) {
                ForEach(0..<6, id: \.self) { _ in Skeleton(height: 110) }
            }
            Skeleton(height: 280)
            Skeleton(height: 180)
        }
    }
}
