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

    var body: some View {
        Group {
            if let store {
                if let error = store.error, store.data == nil {
                    ErrorStateView(error: error) { Task { await store.load() } }
                } else if let data = store.data {
                    ScreenScroll { content(store: store, data: data) }
                } else {
                    LoadingRows(count: 6)
                }
            } else {
                LoadingRows(count: 6)
            }
        }
        .background(Theme.background)
        .navigationTitle("Аналитика")
        .toolbar {
            if let store { ToolbarItem(placement: .primaryAction) { yearMenu(store) } }
            LogoutToolbarItem()
        }
        .task {
            if store == nil {
                let created = MonthlyAnalyticsStore(api: api)
                store = created
                await created.load()
            }
        }
        .refreshable { await store?.load() }
    }

    private func yearMenu(_ store: MonthlyAnalyticsStore) -> some View {
        Menu {
            ForEach(store.selectableYears, id: \.self) { year in
                Button(String(year)) { Task { await store.select(year: year) } }
            }
        } label: {
            Label(String(store.year), systemImage: "calendar")
        }
    }

    @ViewBuilder
    private func content(store: MonthlyAnalyticsStore, data: MonthlyAnalytics) -> some View {
        let months = data.activeMonths

        VStack(spacing: Spacing.lg) {
            if months.isEmpty {
                EmptyStateView(
                    icon: "calendar.badge.exclamationmark",
                    title: "За \(store.year) год данных нет",
                    message: "Ни выручки, ни расходов в этом году не заведено."
                )
            } else {
                totals(data)
                revenueChart(data, months: months)
                profitChart(months)
                monthsTable(months)
                companiesCard(data, months: months)
            }
        }
    }

    private func totals(_ data: MonthlyAnalytics) -> some View {
        DashboardGrid {
            MetricTile(
                label: "Выручка за год",
                value: Money.compact(data.revenueTotal),
                icon: "arrow.down.circle"
            )
            MetricTile(
                label: "Расходы за год",
                value: Money.compact(data.expensesTotal),
                icon: "arrow.up.circle"
            )
            MetricTile(
                label: "Прибыль",
                value: Money.compact(data.profitTotal),
                icon: "chart.line.uptrend.xyaxis",
                accent: data.profitTotal >= 0 ? Theme.positive : Theme.negative
            )
            MetricTile(
                label: "Чеков",
                value: "\(data.checksTotal)",
                icon: "doc.text"
            )
        }
    }

    private func revenueChart(_ data: MonthlyAnalytics, months: [AnalyticsMonth]) -> some View {
        CategoryBarChart(
            title: "Выручка по месяцам",
            points: months.map { month in
                CategoryPoint(
                    label: MonthNames.short(month.monthNumber),
                    value: month.revenue,
                    isHighlighted: month.monthNumber == currentMonthNumber(in: data.year)
                )
            }
        )
    }

    private func profitChart(_ months: [AnalyticsMonth]) -> some View {
        CategoryBarChart(
            title: "Прибыль по месяцам",
            points: months.map {
                CategoryPoint(label: MonthNames.short($0.monthNumber), value: $0.profit)
            },
            color: ChartPalette.series2
        )
    }

    /// Помесячная таблица — то, ради чего на аналитику и заходят: увидеть месяц
    /// рядом с тем же месяцем год назад.
    private func monthsTable(_ months: [AnalyticsMonth]) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("По месяцам")
                ForEach(months) { month in
                    MonthRow(month: month, previousRevenue: previousRevenue(month))
                    if month.id != months.last?.id { RowDivider() }
                }
            }
        }
    }

    @ViewBuilder
    private func companiesCard(_ data: MonthlyAnalytics, months: [AnalyticsMonth]) -> some View {
        let slices = companyTotals(data, months: months)
        if slices.count > 1 {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("По точкам за год")
                    let maximum = slices.first?.amount ?? 0
                    ForEach(slices, id: \.name) { slice in
                        AmountShareRow(
                            name: slice.name,
                            amount: slice.amount,
                            ratio: maximum > 0 ? slice.amount / maximum : 0
                        )
                    }
                }
            }
        }
    }

    // ── Расчёты для отображения ──────────────────────────────────────────────

    private var storedData: MonthlyAnalytics? { store?.data }

    private func previousRevenue(_ month: AnalyticsMonth) -> Double? {
        storedData?.previousRevenue(forMonthNumber: month.monthNumber)
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
            .sorted { $0.amount > $1.amount }
    }

    /// Текущий месяц подсвечиваем только в текущем году: в прошлом августе
    /// выделять август не за что.
    private func currentMonthNumber(in year: Int) -> Int? {
        let now = Calendar.current.dateComponents([.year, .month], from: Date())
        guard now.year == year else { return nil }
        return now.month
    }
}

private struct MonthRow: View {
    let month: AnalyticsMonth
    let previousRevenue: Double?

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack {
                Text(MonthNames.full(month.monthNumber))
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)

                if let change {
                    ChangeBadge(change: change)
                }

                Spacer()

                Text(Money.format(month.revenue))
                    .font(Typography.callout.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(Theme.text)
            }

            HStack(spacing: Spacing.md) {
                Text("Прибыль \(Money.compact(month.profit))")
                    .foregroundStyle(month.profit >= 0 ? Theme.positive : Theme.negative)
                // `margin_pct` приходит уже в процентах — делить не на что.
                Text("Маржа \(Percent.format(month.marginPct))")
                Text("Чеков \(month.checksCount)")
                if month.avgCheck > 0 {
                    Text("Средний \(Money.compact(month.avgCheck))")
                }
            }
            .font(Typography.caption)
            .foregroundStyle(Theme.textDim)
        }
    }

    /// Изменение к тому же месяцу прошлого года, в процентах. Без прошлогодней
    /// выручки показывать нечего: рост «с нуля» — не рост, а первый месяц
    /// работы.
    private var change: Double? {
        guard let previousRevenue, previousRevenue > 0 else { return nil }
        return Percent.change(current: month.revenue, previous: previousRevenue)
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
