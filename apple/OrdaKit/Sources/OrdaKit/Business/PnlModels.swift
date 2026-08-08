import Foundation

// ── ОПиУ: /api/admin/profitability/summary ───────────────────────────────────

/// Отчёт о прибылях и убытках за месяц.
///
/// Все величины приходят посчитанными с сервера. Считать их здесь было бы
/// второй реализацией той же формулы: сайт показал бы одну EBITDA, приложение
/// другую, и понять, какая верна, стало бы невозможно.
public struct MonthlyPnl: Decodable, Sendable, Identifiable, Hashable {
    public let month: String
    public let revenue: Double
    public let cashRevenue: Double
    public let cashlessRevenue: Double
    public let cogs: Double
    public let grossProfit: Double
    public let operatingExpenses: Double
    public let posCommission: Double
    public let payroll: Double
    public let payrollTaxes: Double
    public let otherOperating: Double
    public let ebitda: Double
    public let ebitdaMargin: Double
    public let depreciation: Double
    public let amortization: Double
    public let operatingProfit: Double
    public let financialExpenses: Double
    public let incomeTax: Double
    public let nonOperating: Double
    public let netProfit: Double
    public let netMargin: Double
    public let capex: Double
    public let profitDistribution: Double

    public var id: String { month }

    /// Первое число месяца — для подписей и сортировки.
    public var date: Date? { DateParsing.parseDateOnly("\(month)-01") }

    public var label: String {
        guard let date else { return month }
        return date.formatted(.dateTime.month(.abbreviated).year())
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        month = try c.decodeFlexibleString(forKey: .month) ?? ""
        revenue = try c.decodeFlexibleDouble(forKey: .revenue) ?? 0
        cashRevenue = try c.decodeFlexibleDouble(forKey: .cashRevenue) ?? 0
        cashlessRevenue = try c.decodeFlexibleDouble(forKey: .cashlessRevenue) ?? 0
        cogs = try c.decodeFlexibleDouble(forKey: .cogs) ?? 0
        grossProfit = try c.decodeFlexibleDouble(forKey: .grossProfit) ?? 0
        operatingExpenses = try c.decodeFlexibleDouble(forKey: .operatingExpenses) ?? 0
        posCommission = try c.decodeFlexibleDouble(forKey: .posCommission) ?? 0
        payroll = try c.decodeFlexibleDouble(forKey: .payroll) ?? 0
        payrollTaxes = try c.decodeFlexibleDouble(forKey: .payrollTaxes) ?? 0
        otherOperating = try c.decodeFlexibleDouble(forKey: .otherOperating) ?? 0
        ebitda = try c.decodeFlexibleDouble(forKey: .ebitda) ?? 0
        ebitdaMargin = try c.decodeFlexibleDouble(forKey: .ebitdaMargin) ?? 0
        depreciation = try c.decodeFlexibleDouble(forKey: .depreciation) ?? 0
        amortization = try c.decodeFlexibleDouble(forKey: .amortization) ?? 0
        operatingProfit = try c.decodeFlexibleDouble(forKey: .operatingProfit) ?? 0
        financialExpenses = try c.decodeFlexibleDouble(forKey: .financialExpenses) ?? 0
        incomeTax = try c.decodeFlexibleDouble(forKey: .incomeTax) ?? 0
        nonOperating = try c.decodeFlexibleDouble(forKey: .nonOperating) ?? 0
        netProfit = try c.decodeFlexibleDouble(forKey: .netProfit) ?? 0
        netMargin = try c.decodeFlexibleDouble(forKey: .netMargin) ?? 0
        capex = try c.decodeFlexibleDouble(forKey: .capex) ?? 0
        profitDistribution = try c.decodeFlexibleDouble(forKey: .profitDistribution) ?? 0
    }

    private enum CodingKeys: String, CodingKey {
        case month, revenue, cashRevenue, cashlessRevenue, cogs, grossProfit
        case operatingExpenses, posCommission, payroll, payrollTaxes, otherOperating
        case ebitda, ebitdaMargin, depreciation, amortization, operatingProfit
        case financialExpenses, incomeTax, nonOperating, netProfit, netMargin
        case capex, profitDistribution
    }
}

/// Ответ `GET /api/admin/profitability/summary`.
public struct PnlReport: Decodable, Sendable {
    public let months: [MonthlyPnl]

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        months = (try? c.decodeIfPresent([MonthlyPnl].self, forKey: .months)) ?? []
    }

    private enum CodingKeys: String, CodingKey { case months }

    /// Итог по всем месяцам. Маржа считается от суммарной выручки, а не как
    /// среднее месячных: среднее из процентов даёт неверную величину.
    public var totals: (revenue: Double, ebitda: Double, netProfit: Double, ebitdaMargin: Double) {
        let revenue = months.reduce(0) { $0 + $1.revenue }
        let ebitda = months.reduce(0) { $0 + $1.ebitda }
        let net = months.reduce(0) { $0 + $1.netProfit }
        return (revenue, ebitda, net, revenue > 0 ? ebitda / revenue * 100 : 0)
    }
}

/// Границы периода ОПиУ в формате `YYYY-MM`.
public enum PnlPeriod {
    /// Последние `count` месяцев, включая текущий.
    public static func lastMonths(_ count: Int, from date: Date = Date()) -> (from: String, to: String) {
        let calendar = Calendar(identifier: .gregorian)
        let start = calendar.date(byAdding: .month, value: -(count - 1), to: date) ?? date
        return (monthString(start), monthString(date))
    }

    public static func monthString(_ date: Date) -> String {
        let calendar = Calendar(identifier: .gregorian)
        let parts = calendar.dateComponents([.year, .month], from: date)
        return String(format: "%04d-%02d", parts.year ?? 0, parts.month ?? 0)
    }
}
