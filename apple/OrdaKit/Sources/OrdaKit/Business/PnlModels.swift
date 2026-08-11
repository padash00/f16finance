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

    /// Доля строки в выручке месяца.
    public func share(_ value: Double) -> Double? {
        guard revenue > 0 else { return nil }
        return value / revenue * 100
    }

    /// Заполнены ли руками ФОТ и налоги с него.
    ///
    /// Из журналов они не выводятся: зарплату платят вне расходов точки. Пока
    /// их не задали, EBITDA завышена — и об этом надо сказать прямо, иначе
    /// владелец сравнит её с чужой и решит, что у него дела лучше, чем есть.
    public var hasManualPayroll: Bool { payroll > 0 || payrollTaxes > 0 }

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

    /// Отчёт за произвольный набор месяцев — например, за отфильтрованный
    /// период без пустых месяцев.
    public init(months: [MonthlyPnl]) {
        self.months = months
    }

    /// Итог по всем месяцам — той же цепочкой строк, что и месяц.
    ///
    /// Считается здесь, а не на сервере: сервер отдаёт месяцы, а период
    /// владелец выбирает сам. Складываются только суммы; маржа берётся от
    /// суммарной выручки, а не как среднее месячных — среднее из процентов
    /// даёт величину, не сходящуюся ни с чем.
    public var totals: PnlTotals {
        var result = PnlTotals()
        for month in months {
            result.revenue += month.revenue
            result.cashRevenue += month.cashRevenue
            result.cashlessRevenue += month.cashlessRevenue
            result.cogs += month.cogs
            result.grossProfit += month.grossProfit
            result.operatingExpenses += month.operatingExpenses
            result.posCommission += month.posCommission
            result.payroll += month.payroll
            result.payrollTaxes += month.payrollTaxes
            result.otherOperating += month.otherOperating
            result.ebitda += month.ebitda
            result.depreciation += month.depreciation
            result.amortization += month.amortization
            result.operatingProfit += month.operatingProfit
            result.financialExpenses += month.financialExpenses
            result.incomeTax += month.incomeTax
            result.nonOperating += month.nonOperating
            result.netProfit += month.netProfit
            result.capex += month.capex
            result.profitDistribution += month.profitDistribution
        }
        return result
    }
}

/// Суммы за период.
public struct PnlTotals: Sendable, Equatable {
    public var revenue: Double = 0
    public var cashRevenue: Double = 0
    public var cashlessRevenue: Double = 0
    public var cogs: Double = 0
    public var grossProfit: Double = 0
    public var operatingExpenses: Double = 0
    public var posCommission: Double = 0
    public var payroll: Double = 0
    public var payrollTaxes: Double = 0
    public var otherOperating: Double = 0
    public var ebitda: Double = 0
    public var depreciation: Double = 0
    public var amortization: Double = 0
    public var operatingProfit: Double = 0
    public var financialExpenses: Double = 0
    public var incomeTax: Double = 0
    public var nonOperating: Double = 0
    public var netProfit: Double = 0
    public var capex: Double = 0
    public var profitDistribution: Double = 0

    public init() {}

    public var ebitdaMargin: Double { revenue > 0 ? ebitda / revenue * 100 : 0 }
    public var netMargin: Double { revenue > 0 ? netProfit / revenue * 100 : 0 }
    public var grossMargin: Double { revenue > 0 ? grossProfit / revenue * 100 : 0 }

    /// Доля строки в выручке. `nil`, если выручки нет: делить не на что, а
    /// «0 %» читалось бы как «расходов не было».
    public func share(_ value: Double) -> Double? {
        guard revenue > 0 else { return nil }
        return value / revenue * 100
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
