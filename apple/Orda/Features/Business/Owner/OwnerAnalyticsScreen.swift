import Charts
import OrdaKit
import OrdaUI
import SwiftUI

/// Аналитика владельца.
///
/// Период — одним касанием: день, неделя, месяц, год, остальное — под
/// календарём. Сверху одна большая цифра выбранного показателя с графиком,
/// ниже — из чего она сложилась: точки, статьи, оплаты, часы, товары, люди.
struct OwnerAnalyticsScreen: View {
    let resolver: AccessResolver

    @Environment(AnalyticsStore.self) private var analytics
    @State private var metric: OverviewMetric = .revenue
    @State private var showsCompanies = false
    @State private var showsAllExpenses = false

    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.lg) {
                header
                periodBar
                if let data = analytics.data {
                    mainCard(data)
                    statsCard(data)
                    companies(data)
                    expenses(data)
                    payments(data)
                    hours(data)
                    weekdays(data)
                    products(data)
                    operators(data)
                    OwnerFootnote(text: "Выручка и расходы — по отчётам смен, как на сайте. Чеки, часы и товары — по кассе.")
                } else if let error = analytics.error {
                    ErrorStateView(error: error) { Task { await analytics.load() } }
                } else {
                    VStack(spacing: Spacing.lg) {
                        Skeleton(height: 330, cornerRadius: 24)
                        Skeleton(height: 90, cornerRadius: 24)
                        Skeleton(height: 220, cornerRadius: 24)
                    }
                }
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.bottom, Spacing.xxl)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.background)
        .refreshable { await analytics.load() }
        #if os(iOS)
        .toolbar(.hidden, for: .navigationBar)
        #endif
        .task { if analytics.data == nil { await analytics.load() } }
        .onChange(of: ExtraCashPreference.shared.includeExtra) { _, _ in analytics.reload() }
        .sheet(isPresented: $showsCompanies) {
            CompanyPickerSheet(
                companies: analytics.companies,
                selection: Binding(get: { analytics.filter.companyIDs }, set: { analytics.filter.companyIDs = $0 })
            )
            .presentationDetents([.medium, .large])
        }
    }

    // ── Шапка и период ───────────────────────────────────────────────────────

    private var header: some View {
        HStack(alignment: .center) {
            Text("Аналитика")
                .font(.system(size: 30, weight: .bold, design: .rounded))
                .foregroundStyle(Theme.text)
            Spacer()
            if analytics.isLoading && analytics.data != nil {
                ProgressView().controlSize(.small)
            }
            if analytics.companies.count > 1 {
                Button {
                    showsCompanies = true
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "building.2")
                            .font(.system(size: 13, weight: .semibold))
                        Text(analytics.companiesTitle)
                            .font(.system(size: 14, weight: .semibold))
                            .lineLimit(1)
                        Image(systemName: "chevron.down")
                            .font(.system(size: 10, weight: .bold))
                    }
                    .foregroundStyle(analytics.filter.isAllCompanies ? Theme.text : Color.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(analytics.filter.isAllCompanies ? AnyShapeStyle(Theme.surface) : AnyShapeStyle(Theme.brand), in: Capsule())
                }
                .buttonStyle(.pressable)
            }
        }
        .padding(.top, Spacing.md)
    }

    private var periodBar: some View {
        PeriodBar(
            selection: Binding(get: { analytics.filter.period }, set: { analytics.filter.period = $0 }),
            quick: [.today, .thisWeek, .thisMonth, .thisYear],
            trailing: AnyView(compareMenu),
            showsExtra: true
        )
    }

    private var compareMenu: some View {
        Menu {
            Picker("Сравнение", selection: Binding(get: { analytics.filter.compare }, set: { analytics.filter.compare = $0 })) {
                ForEach(AnalyticsCompare.allCases) { Text($0.title).tag($0) }
            }
        } label: {
            HStack(spacing: 2) {
                Text("сравнение: \(analytics.filter.compare.shortTitle)")
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold))
            }
            .foregroundStyle(Theme.brand)
        }
    }

    // ── Главная цифра ────────────────────────────────────────────────────────

    private func mainCard(_ data: OwnerAnalytics) -> some View {
        let cur = data.kpi.current
        let prev = data.kpi.previous
        // Один день: отчёты смен приходят в конце смены, и днём по ним выручка
        // почти ноль против целого вчерашнего дня. Выручку дня берём по кассе
        // к этому часу, а вместо графика из одного столбика — часы.
        let isDay = data.period.from == data.period.to
        let livePos = isDay && metric == .revenue ? data.pos : nil
        let (value, previous): (Double, Double) = if let livePos {
            (livePos.amount, livePos.previous.amount)
        } else {
            switch metric {
            case .revenue: (cur.revenue, prev.revenue)
            case .expense: (cur.expense, prev.expense)
            case .profit: (cur.profit, prev.profit)
            }
        }
        let change = Percent.change(current: value, previous: previous)
        return VStack(alignment: .leading, spacing: Spacing.md) {
            HStack(spacing: Spacing.lg) {
                ForEach(OverviewMetric.allCases) { item in
                    Button {
                        withAnimation(Motion.tap) { metric = item }
                    } label: {
                        VStack(spacing: 6) {
                            Text(item.title)
                                .font(.system(size: 16, weight: metric == item ? .bold : .medium))
                                .foregroundStyle(metric == item ? Theme.text : Theme.textDim)
                            Capsule()
                                .fill(metric == item ? item.color : .clear)
                                .frame(height: 3)
                        }
                        .fixedSize()
                    }
                    .buttonStyle(.plain)
                }
                Spacer()
            }

            VStack(alignment: .leading, spacing: 6) {
                Text(Money.format(value))
                    .font(.system(size: 36, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(value < 0 ? Theme.negative : Theme.text)
                    .contentTransition(.numericText())
                    .animation(Motion.value, value: value)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                HStack(spacing: Spacing.sm) {
                    if let change {
                        ChangeText(change: change, higherIsBetter: metric.higherIsBetter)
                    }
                    Text(livePos?.previous.sameTime == true ? "в это время было \(Money.format(previous))" : "было \(Money.format(previous))")
                        .font(.system(size: 13))
                        .monospacedDigit()
                        .foregroundStyle(Theme.textDim)
                }
                if isDay {
                    Text(livePos != nil ? "по кассе" : "по отчётам смен — они закрываются в конце смены")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textDim)
                }
            }

            if let livePos {
                HourBars(hours: livePos.byHour, color: metric.color)
            } else if data.series.count > 1 {
                ComparisonChart(
                    points: OwnerOverviewScreen.points(data, metric: metric),
                    color: metric.color,
                    asBars: data.period.group != .day || data.series.count <= 7,
                    height: 190
                )
            }
        }
        .padding(Spacing.lg)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    // ── Короткие показатели ──────────────────────────────────────────────────

    private func statsCard(_ data: OwnerAnalytics) -> some View {
        let cur = data.kpi.current
        let prev = data.kpi.previous
        var stats: [(String, String, Double?, Bool)] = []
        if let pos = data.pos {
            stats.append(("Средний чек", Money.format(pos.avgCheck), Percent.change(current: pos.avgCheck, previous: pos.previous.avgCheck), false))
            stats.append(("Чеков", pos.receipts.formatted(), Percent.change(current: Double(pos.receipts), previous: Double(pos.previous.receipts)), false))
        } else {
            let perShift = cur.shifts > 0 ? cur.revenue / Double(cur.shifts) : 0
            let prevPerShift = prev.shifts > 0 ? prev.revenue / Double(prev.shifts) : 0
            stats.append(("За смену", Money.format(perShift), Percent.change(current: perShift, previous: prevPerShift), false))
            stats.append(("Смен", cur.shifts.formatted(), Percent.change(current: Double(cur.shifts), previous: Double(prev.shifts)), false))
        }
        let marginChange = cur.marginPercent.flatMap { c in prev.marginPercent.map { c - $0 } }
        stats.append(("Маржа", Percent.format(cur.marginPercent), marginChange, true))

        return HStack(spacing: 0) {
            ForEach(Array(stats.enumerated()), id: \.offset) { index, stat in
                if index > 0 {
                    Rectangle().fill(Theme.border).frame(width: 1, height: 40)
                }
                VStack(spacing: 4) {
                    Text(stat.0)
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textDim)
                    Text(stat.1)
                        .font(.system(size: 17, weight: .bold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                    if let change = stat.2 {
                        if stat.3 {
                            Text(Percent.format(change, signed: true).replacingOccurrences(of: "\u{202F}%", with: " п.п."))
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(change >= 0 ? Theme.positive : Theme.negative)
                        } else {
                            ChangeText(change: change)
                        }
                    }
                }
                .frame(maxWidth: .infinity)
            }
        }
        .padding(.vertical, Spacing.lg)
        .padding(.horizontal, Spacing.sm)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    // ── Точки ────────────────────────────────────────────────────────────────

    @ViewBuilder
    private func companies(_ data: OwnerAnalytics) -> some View {
        if data.byCompany.count > 1 {
            let values = data.byCompany.map { metricValue($0) }
            let total = max(values.reduce(0) { $0 + max($1, 0) }, 1)
            OwnerSection("По точкам") {
                EmptyView()
            } content: {
                VStack(spacing: Spacing.md) {
                    ForEach(Array(data.byCompany.enumerated()), id: \.element.id) { index, row in
                        Button {
                            analytics.filter.companyIDs = [row.id]
                        } label: {
                            AmountRow(
                                leading: { LetterBadge(text: row.name, tint: OwnerTint.point(index)) },
                                title: row.name,
                                subtitle: Percent.format(max(metricValue(row), 0) / total * 100) + " от всех",
                                amount: Money.format(metricValue(row)),
                                change: Percent.change(current: metricValue(row), previous: metricPrevious(row)),
                                higherIsBetter: metric.higherIsBetter,
                                share: max(metricValue(row), 0) / total,
                                tint: OwnerTint.point(index)
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private func metricValue(_ row: OwnerAnalytics.CompanyRow) -> Double {
        switch metric {
        case .revenue: row.revenue
        case .expense: row.expense
        case .profit: row.profit
        }
    }

    private func metricPrevious(_ row: OwnerAnalytics.CompanyRow) -> Double {
        switch metric {
        case .revenue: row.prevRevenue
        case .expense: row.prevRevenue - row.prevProfit
        case .profit: row.prevProfit
        }
    }

    // ── Расходы ──────────────────────────────────────────────────────────────

    @ViewBuilder
    private func expenses(_ data: OwnerAnalytics) -> some View {
        if let categories = data.expenseCategories, !categories.isEmpty {
            let total = max(categories.reduce(0) { $0 + $1.amount }, 1)
            let shown = showsAllExpenses ? categories : Array(categories.prefix(6))
            OwnerSection("Куда ушли деньги") {
                Text(Money.format(data.kpi.current.expense))
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(Theme.textMuted)
            } content: {
                VStack(spacing: Spacing.md) {
                    ForEach(Array(shown.enumerated()), id: \.element.id) { index, row in
                        let tint = SharePalette.colors[index % SharePalette.colors.count]
                        AmountRow(
                            leading: { TintedIcon(systemName: Self.expenseIcon(row.name), tint: tint, size: 40) },
                            title: row.name,
                            subtitle: Percent.format(row.amount / total * 100),
                            amount: Money.format(row.amount),
                            change: Percent.change(current: row.amount, previous: row.prevAmount),
                            higherIsBetter: false,
                            share: row.amount / total,
                            tint: tint
                        )
                    }
                    if categories.count > 6 {
                        Button(showsAllExpenses ? "Свернуть" : "Все статьи (\(categories.count))") {
                            withAnimation(Motion.transition) { showsAllExpenses.toggle() }
                        }
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.brand)
                        .frame(maxWidth: .infinity)
                        .padding(.top, Spacing.xs)
                    }
                }
            }
        }
    }

    /// Иконка статьи по названию — угадываем по ключевым словам.
    static func expenseIcon(_ name: String) -> String {
        let n = name.lowercased()
        if n.contains("аренд") { return "house.fill" }
        if n.contains("зарплат") || n.contains("зп") || n.contains("аванс") { return "person.2.fill" }
        if n.contains("товар") || n.contains("закуп") || n.contains("продукт") { return "cart.fill" }
        if n.contains("налог") { return "building.columns.fill" }
        if n.contains("коммунал") || n.contains("свет") || n.contains("электр") || n.contains("вода") { return "bolt.fill" }
        if n.contains("интернет") || n.contains("связь") { return "wifi" }
        if n.contains("реклам") || n.contains("маркет") { return "megaphone.fill" }
        if n.contains("ремонт") || n.contains("обслуж") { return "wrench.and.screwdriver.fill" }
        if n.contains("оборуд") || n.contains("техник") { return "desktopcomputer" }
        if n.contains("такси") || n.contains("транспорт") || n.contains("достав") || n.contains("бензин") { return "car.fill" }
        if n.contains("хоз") || n.contains("убор") || n.contains("чист") { return "sparkles" }
        if n.contains("банк") || n.contains("комисс") || n.contains("кредит") { return "creditcard.fill" }
        return "tag.fill"
    }

    // ── Оплаты ───────────────────────────────────────────────────────────────

    @ViewBuilder
    private func payments(_ data: OwnerAnalytics) -> some View {
        let k = data.kpi.current
        let rows: [(String, String, Double, Color)] = [
            ("Наличные", "banknote.fill", k.cash, Color(hex: 0x10B981)),
            ("Kaspi", "k.circle.fill", k.kaspi, Color(hex: 0xEF4444)),
            ("Карта", "creditcard.fill", k.card, Color(hex: 0x3B82F6)),
            ("Онлайн", "globe", k.online, Color(hex: 0x8B5CF6)),
        ].filter { $0.2 > 0 }
        if !rows.isEmpty {
            let total = max(rows.reduce(0) { $0 + $1.2 }, 1)
            OwnerSection("Чем платили") {
                EmptyView()
            } content: {
                VStack(spacing: Spacing.md) {
                    ForEach(rows, id: \.0) { title, icon, amount, tint in
                        AmountRow(
                            leading: { TintedIcon(systemName: icon, tint: tint, size: 40) },
                            title: title,
                            subtitle: Percent.format(amount / total * 100),
                            amount: Money.format(amount),
                            share: amount / total,
                            tint: tint
                        )
                    }
                }
            }
        }
    }

    // ── Часы пик ─────────────────────────────────────────────────────────────

    @ViewBuilder
    private func hours(_ data: OwnerAnalytics) -> some View {
        if let pos = data.pos, pos.receipts > 0 {
            let peak = pos.byHour.max { $0.amount < $1.amount }
            OwnerSection("Часы пик") {
                if let peak, peak.amount > 0 {
                    Text("пик \(peak.hour):00–\(peak.hour + 1):00")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.brand)
                }
            } content: {
                HeatmapGrid(values: pos.heatmap)
            }
        }
    }

    // ── Дни недели ───────────────────────────────────────────────────────────

    @ViewBuilder
    private func weekdays(_ data: OwnerAnalytics) -> some View {
        if data.weekdays.reduce(0, { $0 + $1.days }) >= 7 {
            let names = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
            let top = max(data.weekdays.map(\.average).max() ?? 0, 1)
            let best = data.weekdays.max { $0.average < $1.average }
            OwnerSection("Дни недели") {
                Text("средняя выручка")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
            } content: {
                HStack(alignment: .bottom, spacing: Spacing.sm) {
                    ForEach(data.weekdays) { day in
                        let isBest = day.weekday == best?.weekday
                        VStack(spacing: 6) {
                            Text(Money.axisTick(day.average).replacingOccurrences(of: " ₸", with: ""))
                                .font(.system(size: 10, weight: .semibold))
                                .monospacedDigit()
                                .foregroundStyle(isBest ? Theme.text : Theme.textDim)
                                .lineLimit(1)
                                .minimumScaleFactor(0.6)
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .fill(isBest ? Theme.brand : Theme.brand.opacity(0.25))
                                .frame(height: max(6, 110 * day.average / top))
                            Text(names[day.weekday])
                                .font(.system(size: 12, weight: isBest ? .bold : .medium))
                                .foregroundStyle(isBest ? Theme.text : Theme.textDim)
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
                .frame(height: 160, alignment: .bottom)
            }
        }
    }

    // ── Товары ───────────────────────────────────────────────────────────────

    @ViewBuilder
    private func products(_ data: OwnerAnalytics) -> some View {
        if let pos = data.pos, !pos.topItems.isEmpty {
            let top = pos.topItems.prefix(8)
            let max = Swift.max(top.first?.revenue ?? 1, 1)
            OwnerSection("Топ товаров") {
                EmptyView()
            } content: {
                VStack(spacing: Spacing.md) {
                    ForEach(Array(top.enumerated()), id: \.element.id) { index, item in
                        AmountRow(
                            leading: {
                                Text("\(index + 1)")
                                    .font(.system(size: 15, weight: .bold, design: .rounded))
                                    .foregroundStyle(index < 3 ? Color(hex: 0xF59E0B) : Theme.textDim)
                                    .frame(width: 40, height: 40)
                                    .background(Theme.surfaceRaised, in: Circle())
                            },
                            title: item.name,
                            subtitle: "\(Quantity.format(item.qty)) шт" + (item.profit.map { " · прибыль \(Money.format($0))" } ?? ""),
                            amount: Money.format(item.revenue),
                            share: item.revenue / max,
                            tint: Color(hex: 0xF59E0B)
                        )
                    }
                }
            }
        }
    }

    // ── Операторы ────────────────────────────────────────────────────────────

    @ViewBuilder
    private func operators(_ data: OwnerAnalytics) -> some View {
        if let ops = data.operators, !ops.rows.isEmpty {
            let top = max(ops.rows.first?.revenue ?? 1, 1)
            OwnerSection("Операторы") {
                Text("выручка за смены")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
            } content: {
                VStack(spacing: Spacing.md) {
                    ForEach(Array(ops.rows.prefix(10).enumerated()), id: \.element.id) { index, row in
                        AmountRow(
                            leading: { LetterBadge(text: row.name, tint: OwnerTint.point(index + 1)) },
                            title: row.name,
                            subtitle: "\(row.shifts) смен · \(Money.format(row.perShift)) за смену",
                            amount: Money.format(row.revenue),
                            change: Percent.change(current: row.perShift, previous: row.prevPerShift),
                            share: row.revenue / top,
                            tint: OwnerTint.point(index + 1)
                        )
                    }
                }
            }
        }
    }
}

/// Выручка по часам за день — столбики только в рабочие часы.
private struct HourBars: View {
    let hours: [OwnerAnalytics.POS.Hour]
    let color: Color

    @State private var selected: Int?

    private var shown: [OwnerAnalytics.POS.Hour] {
        let active = hours.filter { $0.amount > 0 }.map(\.hour)
        guard let first = active.min(), let last = active.max() else { return [] }
        return hours.filter { $0.hour >= first && $0.hour <= last }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            if let selected, let hour = hours.first(where: { $0.hour == selected }) {
                Text("\(hour.hour):00–\(hour.hour + 1):00 · \(Money.format(hour.amount)) · \(hour.count) чеков")
                    .font(.system(size: 13, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(Theme.text)
            } else {
                Text("По часам")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
            }
            Chart(shown) { hour in
                BarMark(x: .value("Час", hour.hour), y: .value("Сумма", hour.amount))
                    .foregroundStyle(color.opacity(selected == nil || selected == hour.hour ? 1 : 0.35))
                    .cornerRadius(4)
            }
            .chartXAxis {
                AxisMarks(values: .stride(by: 3)) { value in
                    AxisValueLabel {
                        if let h = value.as(Int.self) { Text("\(h):00").font(.system(size: 10)) }
                    }
                }
            }
            .chartYAxis {
                AxisMarks(position: .leading, values: .automatic(desiredCount: 3)) { value in
                    AxisGridLine().foregroundStyle(Theme.border.opacity(0.5))
                    AxisValueLabel {
                        if let v = value.as(Double.self) { Text(Money.axisTick(v)).font(.system(size: 10)) }
                    }
                }
            }
            .chartXSelection(value: $selected)
            .frame(height: 170)
        }
    }
}
