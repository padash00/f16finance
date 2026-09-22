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
    /// Выручка по способам оплаты — раскрытие строки «Выручка».
    public let income: PnlIncome
    /// Статьи расходов внутри каждой строки: ключ — строка отчёта
    /// (`cogs`, `operating`, `payroll`…), как на сайте.
    public let categories: [String: [PnlCategoryAmount]]
    /// Для сверки с «Расходами»: всё из журнала и отклонённые из них.
    public let check: PnlCheck

    public var id: String { month }

    /// Статьи строки отчёта, крупные сверху.
    public func parts(_ line: PnlLine) -> [PnlCategoryAmount] {
        if line == .revenue {
            return [
                PnlCategoryAmount(name: "Наличные", amount: income.cash),
                PnlCategoryAmount(name: "Kaspi", amount: income.kaspi),
                PnlCategoryAmount(name: "Карта", amount: income.card),
                PnlCategoryAmount(name: "Онлайн", amount: income.online),
            ].filter { $0.amount.rounded() != 0 }
        }
        return categories[line.rawValue] ?? []
    }

    /// Значение строки отчёта.
    public func value(_ line: PnlLine) -> Double {
        switch line {
        case .revenue: revenue
        case .cogs: cogs
        case .grossProfit: grossProfit
        case .operating: operatingExpenses
        case .pos: posCommission
        case .payroll: payroll
        case .payrollTaxes: payrollTaxes
        case .ebitda: ebitda
        case .depreciation: depreciation
        case .operatingProfit: operatingProfit
        case .financial: financialExpenses
        case .tax: incomeTax
        case .nonOperating: nonOperating
        case .netProfit: netProfit
        case .capex: capex
        case .distribution: profitDistribution
        }
    }

    /// Остаётся после покупки оборудования и выплат партнёрам.
    public var leftover: Double { netProfit - capex - profitDistribution }

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
        // Новые поля — необязательные: старый ответ без них тоже читается.
        income = (try? c.decodeIfPresent(PnlIncome.self, forKey: .income)) ?? PnlIncome()
        categories = (try? c.decodeIfPresent([String: [PnlCategoryAmount]].self, forKey: .categories)) ?? [:]
        check = (try? c.decodeIfPresent(PnlCheck.self, forKey: .check)) ?? PnlCheck()
    }

    private enum CodingKeys: String, CodingKey {
        case month, revenue, cashRevenue, cashlessRevenue, cogs, grossProfit
        case operatingExpenses, posCommission, payroll, payrollTaxes, otherOperating
        case ebitda, ebitdaMargin, depreciation, amortization, operatingProfit
        case financialExpenses, incomeTax, nonOperating, netProfit, netMargin
        case capex, profitDistribution, income, categories, check
    }
}

/// Строка отчёта — цепочка как на сайте (`app/(main)/profitability`).
public enum PnlLine: String, Sendable, CaseIterable, Hashable {
    case revenue, cogs, grossProfit, operating, pos, payroll, payrollTaxes, ebitda
    case depreciation, operatingProfit, financial, tax, nonOperating, netProfit
    case capex, distribution

    public var title: String {
        switch self {
        case .revenue: "Выручка"
        case .cogs: "Себестоимость"
        case .grossProfit: "Валовая прибыль"
        case .operating: "Операционные расходы"
        case .pos: "Комиссия банка"
        case .payroll: "Зарплаты"
        case .payrollTaxes: "Налоги на зарплату"
        case .ebitda: "EBITDA"
        case .depreciation: "Амортизация"
        case .operatingProfit: "Операционная прибыль"
        case .financial: "Проценты по кредитам"
        case .tax: "Налог"
        case .nonOperating: "Разовые расходы"
        case .netProfit: "Чистая прибыль"
        case .capex: "Покупка оборудования"
        case .distribution: "Выплаты партнёрам"
        }
    }

    /// Итоговая строка (подытог), а не статья.
    public var isTotal: Bool { [.grossProfit, .ebitda, .operatingProfit, .netProfit].contains(self) }
    /// Расход — рост плохо.
    public var isExpense: Bool { !isTotal && self != .revenue }

    /// Цепочка до чистой прибыли.
    public static let chain: [PnlLine] = [
        .revenue, .cogs, .grossProfit, .operating, .pos, .payroll, .payrollTaxes, .ebitda,
        .depreciation, .operatingProfit, .financial, .tax, .nonOperating, .netProfit,
    ]
    /// После чистой прибыли — в ОПиУ не входят.
    public static let offChain: [PnlLine] = [.capex, .distribution]
}

public struct PnlIncome: Decodable, Sendable, Hashable {
    public var cash: Double = 0
    public var kaspi: Double = 0
    public var card: Double = 0
    public var online: Double = 0
    public init() {}
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        cash = try c.decodeFlexibleDouble(forKey: .cash) ?? 0
        kaspi = try c.decodeFlexibleDouble(forKey: .kaspi) ?? 0
        card = try c.decodeFlexibleDouble(forKey: .card) ?? 0
        online = try c.decodeFlexibleDouble(forKey: .online) ?? 0
    }
    private enum CodingKeys: String, CodingKey { case cash, kaspi, card, online }
}

public struct PnlCategoryAmount: Decodable, Sendable, Hashable, Identifiable {
    public let name: String
    public let amount: Double
    public var id: String { name }
    public init(name: String, amount: Double) {
        self.name = name
        self.amount = amount
    }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decodeFlexibleString(forKey: .name) ?? "Без статьи"
        amount = try c.decodeFlexibleDouble(forKey: .amount) ?? 0
    }
    private enum CodingKeys: String, CodingKey { case name, amount }
}

public struct PnlCheck: Decodable, Sendable, Hashable {
    public var expensesAll: Double = 0
    public var declined: Double = 0
    public var declinedCount: Int = 0
    public init() {}
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        expensesAll = try c.decodeFlexibleDouble(forKey: .expensesAll) ?? 0
        declined = try c.decodeFlexibleDouble(forKey: .declined) ?? 0
        declinedCount = Int(try c.decodeFlexibleDouble(forKey: .declinedCount) ?? 0)
    }
    private enum CodingKeys: String, CodingKey { case expensesAll, declined, declinedCount }
}

/// ОПиУ одной точки.
public struct PnlCompany: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let isExtra: Bool
    public let months: [MonthlyPnl]
    public let previous: MonthlyPnl?

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? ""
        name = try c.decodeFlexibleString(forKey: .name) ?? "Точка"
        isExtra = (try? c.decodeIfPresent(Bool.self, forKey: .isExtra)) ?? false
        months = (try? c.decodeIfPresent([MonthlyPnl].self, forKey: .months)) ?? []
        previous = try? c.decodeIfPresent(MonthlyPnl.self, forKey: .previous)
    }
    private enum CodingKeys: String, CodingKey { case id, name, isExtra, months, previous }
}

/// Месяц, в котором внесены не все отчёты смен.
public struct PnlIncompleteMonth: Decodable, Sendable, Hashable {
    public let month: String
    public let companyID: String
    public let company: String
    public let days: Int
    public let expectedDays: Int

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        month = try c.decodeFlexibleString(forKey: .month) ?? ""
        companyID = try c.decodeFlexibleString(forKey: .companyId) ?? ""
        company = try c.decodeFlexibleString(forKey: .company) ?? "Точка"
        days = Int(try c.decodeFlexibleDouble(forKey: .days) ?? 0)
        expectedDays = Int(try c.decodeFlexibleDouble(forKey: .expectedDays) ?? 0)
    }
    private enum CodingKeys: String, CodingKey { case month, companyId, company, days, expectedDays }
}

/// Ответ `GET /api/admin/profitability/summary`.
public struct PnlReport: Decodable, Sendable {
    public let months: [MonthlyPnl]
    /// Месяц перед первым показанным — для сравнения.
    public let previous: MonthlyPnl?
    public let companies: [PnlCompany]
    public let incompleteMonths: [PnlIncompleteMonth]
    /// Отдельные кассы, которые итоги по умолчанию не складывают.
    public let extraNames: [String]

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        months = (try? c.decodeIfPresent([MonthlyPnl].self, forKey: .months)) ?? []
        previous = try? c.decodeIfPresent(MonthlyPnl.self, forKey: .previous)
        companies = (try? c.decodeIfPresent([PnlCompany].self, forKey: .companies)) ?? []
        incompleteMonths = (try? c.decodeIfPresent([PnlIncompleteMonth].self, forKey: .incompleteMonths)) ?? []
        extraNames = (try? c.decodeIfPresent(Extra.self, forKey: .extra))?.names ?? []
    }

    private struct Extra: Decodable { let names: [String] }
    private enum CodingKeys: String, CodingKey { case months, previous, companies, incompleteMonths, extra }

    /// Отчёт за произвольный набор месяцев — например, за отфильтрованный
    /// период без пустых месяцев.
    public init(months: [MonthlyPnl]) {
        self.months = months
        self.previous = nil
        self.companies = []
        self.incompleteMonths = []
        self.extraNames = []
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
