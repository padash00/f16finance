import Charts
import OrdaKit
import OrdaUI
import SwiftUI

/// Аналитика по месяцам года — то, что на сайте живёт на `/analytics`.
///
/// Раньше пункт «Аналитика» открывал экран отчётов: два разных вопроса
/// отвечались одним ответом. Отчёты смотрят на выбранный период, здесь — год
/// помесячно и сравнение с прошлым годом, ради которого страница и нужна.
struct MonthlyAnalyticsScreen: View {
    @Environment(\.api) private var api
    @State private var store: MonthlyAnalyticsStore?
    /// Что рисует график: выручку или прибыль.
    @State private var showsProfit = false

    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.lg) {
                if let store {
                    // Годы — кнопками сверху, а не спрятанными в меню.
                    let years: [(value: Int, title: String)] = store.selectableYears
                        .prefix(4).reversed().map { (value: $0, title: String($0)) }
                    PillSegment(
                        options: years,
                        selection: Binding<Int>(get: { store.year }, set: { year in Task { await store.select(year: year) } })
                    )
                    if let error = store.error, store.data == nil {
                        ErrorStateView(error: error) { Task { await store.load() } }
                    } else if let data = store.data {
                        content(store: store, data: data)
                    } else {
                        loading
                    }
                } else {
                    loading
                }
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.bottom, Spacing.xxl)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.background)
        .navigationTitle("Аналитика")
        .toolbar { LogoutToolbarItem() }
        .task {
            if store == nil {
                let created = MonthlyAnalyticsStore(api: api)
                store = created
                await created.load()
            }
        }
        .refreshable { await store?.load() }
    }

    private var loading: some View {
        VStack(spacing: Spacing.lg) {
            Skeleton(height: 200, cornerRadius: 28)
            Skeleton(height: 90, cornerRadius: 22)
            Skeleton(height: 260, cornerRadius: 22)
        }
    }

    @ViewBuilder
    private func content(store: MonthlyAnalyticsStore, data: MonthlyAnalytics) -> some View {
        let months = data.activeMonths
        if months.isEmpty {
            EmptyStateView(
                icon: "calendar.badge.exclamationmark",
                title: "За \(store.year) год данных нет",
                message: "Ни выручки, ни расходов в этом году не заведено."
            )
        } else {
            hero(data, months: months)
            extremes(data, months: months)
            chart(data, months: months)
            monthsCard(data, months: months)
            companiesCard(data, months: months)
        }
    }

    // ── Главная цифра ────────────────────────────────────────────────────────

    /// Выручка года крупно и сравнение с прошлым годом за те же месяцы: идущий
    /// год против целого прошлого — это всегда «минус», и ничего не говорит.
    private func hero(_ data: MonthlyAnalytics, months: [AnalyticsMonth]) -> some View {
        let revenue = data.revenueTotal
        let previous = months.reduce(0) { $0 + (data.previousRevenue(forMonthNumber: $1.monthNumber) ?? 0) }
        let change = Percent.change(current: revenue, previous: previous)
        let margin = revenue > 0 ? data.profitTotal / revenue * 100 : nil
        let avgCheck = data.checksTotal > 0 ? revenue / Double(data.checksTotal) : 0
        return HeroSummary(
            title: "Выручка за \(String(data.year))",
            value: Money.format(revenue),
            caption: change.map { "\(Percent.format($0, signed: true)) к \(String(data.year - 1)) за те же месяцы" },
            footer: [
                ("Расходы", Money.format(data.expensesTotal)),
                ("Прибыль" + (margin.map { " · \(Percent.format($0))" } ?? ""), Money.format(data.profitTotal)),
                ("Чеков · \(Money.format(avgCheck))", data.checksTotal.formatted()),
            ],
            colors: Theme.heroGradient
        )
    }

    // ── Лучший и слабый месяц ────────────────────────────────────────────────

    /// Идущий месяц в «слабые» не берём: он ещё не кончился и всегда меньше.
    @ViewBuilder
    private func extremes(_ data: MonthlyAnalytics, months: [AnalyticsMonth]) -> some View {
        let current = currentMonthNumber(in: data.year)
        let closed = months.filter { $0.monthNumber != current }
        if closed.count >= 2, let best = closed.max(by: { $0.revenue < $1.revenue }), let worst = closed.min(by: { $0.revenue < $1.revenue }) {
            HStack(spacing: Spacing.md) {
                extremeTile("Лучший месяц", month: best, icon: "arrow.up.right", tint: Theme.positive)
                extremeTile("Слабый месяц", month: worst, icon: "arrow.down.right", tint: Theme.negative)
            }
        }
    }

    private func extremeTile(_ title: String, month: AnalyticsMonth, icon: String, tint: Color) -> some View {
        HStack(spacing: Spacing.md) {
            TintedIcon(systemName: icon, tint: tint, size: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textDim)
                Text(MonthNames.full(month.monthNumber))
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.text)
                Text(Money.format(month.revenue))
                    .font(.system(size: 13, weight: .medium, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(Theme.textMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            Spacer(minLength: 0)
        }
        .padding(Spacing.md)
        .frame(maxWidth: .infinity)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    // ── График ───────────────────────────────────────────────────────────────

    private func chart(_ data: MonthlyAnalytics, months: [AnalyticsMonth]) -> some View {
        OwnerSection("По месяцам") {
            EmptyView()
        } content: {
            VStack(alignment: .leading, spacing: Spacing.md) {
                PillSegment(options: [(false, "Выручка"), (true, "Прибыль")], selection: $showsProfit)
                MonthBars(
                    months: months.map { month in
                        MonthBars.Bar(
                            month: month.monthNumber,
                            value: showsProfit ? month.profit : month.revenue,
                            // Прошлый год известен только по выручке.
                            previous: showsProfit ? nil : data.previousRevenue(forMonthNumber: month.monthNumber),
                            isCurrent: month.monthNumber == currentMonthNumber(in: data.year)
                        )
                    },
                    color: showsProfit ? ChartPalette.series2 : ChartPalette.series1,
                    previousYear: data.year - 1
                )
            }
        }
    }

    // ── Месяцы ───────────────────────────────────────────────────────────────

    private func monthsCard(_ data: MonthlyAnalytics, months: [AnalyticsMonth]) -> some View {
        let top = max(months.map(\.revenue).max() ?? 1, 1)
        let current = currentMonthNumber(in: data.year)
        return OwnerSection("Месяцы") {
            Text("к \(String(data.year - 1))")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textDim)
        } content: {
            VStack(spacing: Spacing.md) {
                ForEach(months.reversed()) { month in
                    let previous = data.previousRevenue(forMonthNumber: month.monthNumber)
                    AmountRow(
                        leading: {
                            Text(MonthNames.short(month.monthNumber))
                                .font(.system(size: 13, weight: .bold, design: .rounded))
                                .foregroundStyle(month.monthNumber == current ? .white : Theme.text)
                                .frame(width: 42, height: 42)
                                .background(month.monthNumber == current ? AnyShapeStyle(Theme.brand) : AnyShapeStyle(Theme.surfaceRaised), in: Circle())
                        },
                        title: MonthNames.full(month.monthNumber) + (month.monthNumber == current ? " · идёт" : ""),
                        subtitle: "прибыль \(Money.format(month.profit)) · маржа \(Percent.format(month.marginPct))",
                        amount: Money.format(month.revenue),
                        change: previous.flatMap { $0 > 0 ? Percent.change(current: month.revenue, previous: $0) : nil },
                        share: month.revenue / top,
                        tint: ChartPalette.series1
                    )
                }
            }
        }
    }

    // ── Точки ────────────────────────────────────────────────────────────────

    @ViewBuilder
    private func companiesCard(_ data: MonthlyAnalytics, months: [AnalyticsMonth]) -> some View {
        let rows = companyTotals(data, months: months)
        if rows.count > 1 {
            let total = max(rows.reduce(0) { $0 + $1.amount }, 1)
            OwnerSection("Точки за год") {
                EmptyView()
            } content: {
                VStack(spacing: Spacing.md) {
                    ForEach(Array(rows.enumerated()), id: \.element.name) { index, row in
                        AmountRow(
                            leading: { LetterBadge(text: row.name, tint: OwnerTint.point(index)) },
                            title: row.name,
                            subtitle: Percent.format(row.amount / total * 100) + " выручки",
                            amount: Money.format(row.amount),
                            share: row.amount / total,
                            tint: OwnerTint.point(index)
                        )
                    }
                }
            }
        }
    }

    private func companyTotals(_ data: MonthlyAnalytics, months: [AnalyticsMonth]) -> [(name: String, amount: Double)] {
        var sums: [String: Double] = [:]
        for month in months {
            for (companyID, slice) in month.byCompany {
                sums[companyID, default: 0] += slice.revenue
            }
        }
        let names = Dictionary(uniqueKeysWithValues: data.companies.map { ($0.id, $0.name) })
        return sums
            .map { (name: names[$0.key] ?? "Без точки", amount: $0.value) }
            .filter { $0.amount != 0 }
            .sorted { $0.amount > $1.amount }
    }

    private func currentMonthNumber(in year: Int) -> Int? {
        let now = Calendar.current.dateComponents([.year, .month], from: Date())
        guard now.year == year else { return nil }
        return now.month
    }
}

/// Столбики по месяцам с точкой прошлого года над каждым.
private struct MonthBars: View {
    struct Bar: Identifiable {
        let month: Int
        let value: Double
        let previous: Double?
        let isCurrent: Bool
        var id: Int { month }
    }

    let months: [Bar]
    let color: Color
    let previousYear: Int

    @State private var selected: Int?

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            if let selected, let bar = months.first(where: { $0.month == selected }) {
                HStack(spacing: Spacing.sm) {
                    Text(MonthNames.full(bar.month)).foregroundStyle(Theme.textMuted)
                    Text(Money.format(bar.value)).fontWeight(.semibold).foregroundStyle(Theme.text)
                    if let previous = bar.previous, previous > 0 {
                        Text("· в \(String(previousYear)) \(Money.format(previous))").foregroundStyle(Theme.textDim)
                    }
                }
                .font(.system(size: 13))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            } else if months.contains(where: { ($0.previous ?? 0) > 0 }) {
                HStack(spacing: Spacing.md) {
                    LegendSwatch(color: color, title: "Этот год")
                    LegendSwatch(color: Theme.textDim, title: String(previousYear), dashed: true)
                }
            }
            Chart {
                ForEach(months) { bar in
                    BarMark(x: .value("Месяц", MonthNames.short(bar.month)), y: .value("Сумма", bar.value), width: .ratio(0.6))
                        .foregroundStyle(color.opacity(bar.isCurrent ? 0.55 : (selected == nil || selected == bar.month ? 1 : 0.4)))
                        .cornerRadius(5)
                    // Точку прошлого года рисуем, только если тогда была выручка:
                    // ряд точек на нуле читался бы как «в прошлом году был ноль».
                    if let previous = bar.previous, previous > 0 {
                        PointMark(x: .value("Месяц", MonthNames.short(bar.month)), y: .value("Сумма", previous))
                            .symbol(.circle)
                            .symbolSize(28)
                            .foregroundStyle(Theme.textDim)
                    }
                }
            }
            .chartXAxis {
                AxisMarks { _ in
                    AxisValueLabel().font(.system(size: 11))
                }
            }
            .chartYAxis {
                AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) { value in
                    AxisGridLine().foregroundStyle(Theme.border.opacity(0.5))
                    AxisValueLabel {
                        if let v = value.as(Double.self) { Text(Money.axisTick(v)).font(.system(size: 10)) }
                    }
                }
            }
            .chartXSelection(value: Binding(
                get: { selected.map { MonthNames.short($0) } },
                set: { label in selected = months.first { MonthNames.short($0.month) == label }?.month }
            ))
            .frame(height: 200)
        }
    }
}

enum MonthNames {
    private static let full = [
        "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
        "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
    ]
    private static let short = [
        "Янв", "Фев", "Мар", "Апр", "Май", "Июн",
        "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек",
    ]

    static func full(_ number: Int) -> String {
        guard (1...12).contains(number) else { return "—" }
        return full[number - 1]
    }

    static func short(_ number: Int) -> String {
        guard (1...12).contains(number) else { return "—" }
        return short[number - 1]
    }
}

@MainActor
@Observable
final class MonthlyAnalyticsStore {
    private(set) var data: MonthlyAnalytics?
    private(set) var error: APIError?
    private(set) var year: Int

    private let service: BusinessService

    init(api: APIClient) {
        self.service = BusinessService(api: api)
        self.year = Calendar.current.component(.year, from: Date())
    }

    /// Пять лет назад — дальше данных в системе всё равно нет.
    var selectableYears: [Int] {
        let current = Calendar.current.component(.year, from: Date())
        return Array((current - 4)...current).reversed()
    }

    func load() async {
        do {
            data = try await service.monthlyAnalytics(year: year)
            error = nil
        } catch let apiError as APIError {
            error = apiError
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }

    func select(year newYear: Int) async {
        guard newYear != year else { return }
        year = newYear
        data = nil
        await load()
    }
}
