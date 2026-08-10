import Foundation

// ── Аналитика по месяцам: /api/admin/analytics/monthly ───────────────────────
//
// Отдельный от отчётов контур. «Отчёты» отвечают на вопрос «как прошёл этот
// период», аналитика — «как год идёт по месяцам и где он отличается от
// прошлого». Раньше оба пункта меню вели на экран отчётов, и второй вопрос
// в приложении просто нельзя было задать.

/// Месяц года со всеми показателями. Сервер уже посчитал прибыль, маржу и
/// средний чек — приложение их не пересчитывает.
public struct AnalyticsMonth: Decodable, Sendable, Identifiable, Hashable {
    /// `2026-08`.
    public let month: String
    public let cash: Double
    public let kaspi: Double
    public let card: Double
    public let online: Double
    public let revenue: Double
    public let expenses: Double
    public let profit: Double
    public let marginPct: Double
    public let checksCount: Int
    public let avgCheck: Double
    /// Выручка и чеки в разрезе точек: ключ — идентификатор компании.
    public let byCompany: [String: AnalyticsCompanySlice]

    public var id: String { month }

    /// Номер месяца, 1…12. Нужен для подписи; год в этом экране один.
    public var monthNumber: Int {
        Int(month.split(separator: "-").last.map(String.init) ?? "") ?? 0
    }

    private enum CodingKeys: String, CodingKey {
        case month, cash, kaspi, card, online, revenue, expenses, profit
        case marginPct = "margin_pct"
        case checksCount = "checks_count"
        case avgCheck = "avg_check"
        case byCompany = "by_company"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        month = try c.decodeIfPresent(String.self, forKey: .month) ?? ""
        cash = try c.decodeIfPresent(Double.self, forKey: .cash) ?? 0
        kaspi = try c.decodeIfPresent(Double.self, forKey: .kaspi) ?? 0
        card = try c.decodeIfPresent(Double.self, forKey: .card) ?? 0
        online = try c.decodeIfPresent(Double.self, forKey: .online) ?? 0
        revenue = try c.decodeIfPresent(Double.self, forKey: .revenue) ?? 0
        expenses = try c.decodeIfPresent(Double.self, forKey: .expenses) ?? 0
        profit = try c.decodeIfPresent(Double.self, forKey: .profit) ?? 0
        marginPct = try c.decodeIfPresent(Double.self, forKey: .marginPct) ?? 0
        checksCount = try c.decodeIfPresent(Int.self, forKey: .checksCount) ?? 0
        avgCheck = try c.decodeIfPresent(Double.self, forKey: .avgCheck) ?? 0
        byCompany = try c.decodeIfPresent([String: AnalyticsCompanySlice].self, forKey: .byCompany) ?? [:]
    }
}

public struct AnalyticsCompanySlice: Decodable, Sendable, Hashable {
    public let cash: Double
    public let kaspi: Double
    public let card: Double
    public let online: Double
    public let revenue: Double
    public let checksCount: Int

    private enum CodingKeys: String, CodingKey {
        case cash, kaspi, card, online, revenue
        case checksCount = "checks_count"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        cash = try c.decodeIfPresent(Double.self, forKey: .cash) ?? 0
        kaspi = try c.decodeIfPresent(Double.self, forKey: .kaspi) ?? 0
        card = try c.decodeIfPresent(Double.self, forKey: .card) ?? 0
        online = try c.decodeIfPresent(Double.self, forKey: .online) ?? 0
        revenue = try c.decodeIfPresent(Double.self, forKey: .revenue) ?? 0
        checksCount = try c.decodeIfPresent(Int.self, forKey: .checksCount) ?? 0
    }
}

/// Выручка того же месяца год назад — для сравнения линиями на одном графике.
public struct AnalyticsPreviousMonth: Decodable, Sendable, Hashable {
    public let month: String
    public let revenue: Double

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        month = try c.decodeIfPresent(String.self, forKey: .month) ?? ""
        revenue = try c.decodeIfPresent(Double.self, forKey: .revenue) ?? 0
    }

    private enum CodingKeys: String, CodingKey { case month, revenue }
}

public struct MonthlyAnalytics: Decodable, Sendable {
    public let year: Int
    public let companies: [Company]
    public let months: [AnalyticsMonth]
    public let previousYear: [AnalyticsPreviousMonth]

    /// Год целиком.
    public var revenueTotal: Double { months.reduce(0) { $0 + $1.revenue } }
    public var expensesTotal: Double { months.reduce(0) { $0 + $1.expenses } }
    public var profitTotal: Double { revenueTotal - expensesTotal }
    public var checksTotal: Int { months.reduce(0) { $0 + $1.checksCount } }

    /// Месяцы, в которых что-то происходило. Пустые впереди — это ещё не
    /// наступивший год, а не провал выручки, и в графике они только мешают.
    public var activeMonths: [AnalyticsMonth] {
        months.filter { $0.revenue > 0 || $0.expenses > 0 }
    }

    /// Выручка год назад по номеру месяца — для сравнения.
    public func previousRevenue(forMonthNumber number: Int) -> Double? {
        previousYear.first { Int($0.month.split(separator: "-").last.map(String.init) ?? "") == number }?.revenue
    }

    private enum CodingKeys: String, CodingKey { case year, companies, months, previousYear }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        year = try c.decodeIfPresent(Int.self, forKey: .year) ?? 0
        companies = try c.decodeIfPresent([Company].self, forKey: .companies) ?? []
        months = try c.decodeIfPresent([AnalyticsMonth].self, forKey: .months) ?? []
        previousYear = try c.decodeIfPresent([AnalyticsPreviousMonth].self, forKey: .previousYear) ?? []
    }
}
