import OrdaKit
import OrdaUI
import SwiftUI

/// Показатель, который рисует большой график аналитики.
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

/// Ряд графика аналитики: даты, подписи столбиков и база сравнения.
enum AnalyticsChart {
    static func points(_ data: OwnerAnalytics, metric: OverviewMetric) -> [ComparisonPoint] {
        data.series.enumerated().compactMap { index, p in
            guard let parsed = DateParsing.parseDateOnly(p.date) else { return nil }
            // Начало дня: столбик занимает день целиком, и подпись с пунктиром
            // базы должны стоять по той же сетке, а не на полдень.
            let date = Calendar.current.startOfDay(for: parsed)
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
}
