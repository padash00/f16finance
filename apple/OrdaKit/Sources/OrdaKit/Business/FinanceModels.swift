import Foundation

// ── Налоги: /api/admin/tax/summary ───────────────────────────────────────────

/// Налог одного месяца.
public struct TaxMonth: Decodable, Sendable, Identifiable, Hashable {
    public let month: String
    public let revenue: Double
    public let ipn: Double
    public let social: Double
    public let total: Double

    public var id: String { month }

    public var date: Date? { DateParsing.parseDateOnly("\(month)-01") }

    public var label: String {
        guard let date else { return month }
        return date.formatted(.dateTime.month(.abbreviated).year())
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        month = try c.decodeFlexibleString(forKey: .month) ?? ""
        revenue = try c.decodeFlexibleDouble(forKey: .revenue) ?? 0
        ipn = try c.decodeFlexibleDouble(forKey: .ipn) ?? 0
        social = try c.decodeFlexibleDouble(forKey: .social) ?? 0
        total = try c.decodeFlexibleDouble(forKey: .total) ?? 0
    }

    private enum CodingKeys: String, CodingKey { case month, revenue, ipn, social, total }
}

/// Налоги за работников — свод по всему штату за один месяц.
public struct TaxPayroll: Decodable, Sendable, Hashable {
    public let employees: Int
    public let gross: Double
    public let ipn: Double
    public let opv: Double
    public let vosms: Double
    public let opvr: Double
    public let so: Double
    public let osms: Double
    /// Удержано с работников.
    public let withheld: Double
    /// Сверх окладов, за счёт работодателя.
    public let employerTop: Double
    public let net: Double
    public let totalCost: Double
    /// Всё, что уходит в бюджет за работников за месяц.
    public let monthlyTax: Double

    public static let zero = TaxPayroll()

    private init() {
        employees = 0
        gross = 0; ipn = 0; opv = 0; vosms = 0; opvr = 0; so = 0; osms = 0
        withheld = 0; employerTop = 0; net = 0; totalCost = 0; monthlyTax = 0
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        employees = Int(try c.decodeFlexibleDouble(forKey: .employees) ?? 0)
        gross = try c.decodeFlexibleDouble(forKey: .gross) ?? 0
        ipn = try c.decodeFlexibleDouble(forKey: .ipn) ?? 0
        opv = try c.decodeFlexibleDouble(forKey: .opv) ?? 0
        vosms = try c.decodeFlexibleDouble(forKey: .vosms) ?? 0
        opvr = try c.decodeFlexibleDouble(forKey: .opvr) ?? 0
        so = try c.decodeFlexibleDouble(forKey: .so) ?? 0
        osms = try c.decodeFlexibleDouble(forKey: .osms) ?? 0
        withheld = try c.decodeFlexibleDouble(forKey: .withheld) ?? 0
        employerTop = try c.decodeFlexibleDouble(forKey: .employerTop) ?? 0
        net = try c.decodeFlexibleDouble(forKey: .net) ?? 0
        totalCost = try c.decodeFlexibleDouble(forKey: .totalCost) ?? 0
        monthlyTax = try c.decodeFlexibleDouble(forKey: .monthlyTax) ?? 0
    }

    private enum CodingKeys: String, CodingKey {
        case employees, gross, ipn, opv, vosms, opvr, so, osms
        case withheld, employerTop, net, totalCost, monthlyTax
    }
}

/// Полная налоговая нагрузка периода. Складывает её сервер: три слагаемых,
/// сложенные на клиенте, дали бы вторую версию «эффективной ставки».
public struct TaxBurden: Decodable, Sendable, Hashable {
    public let ipn: Double
    public let selfSocial: Double
    public let payrollTaxes: Double
    public let total: Double
    public let effectiveRate: Double

    public static let zero = TaxBurden()

    private init() {
        ipn = 0; selfSocial = 0; payrollTaxes = 0; total = 0; effectiveRate = 0
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ipn = try c.decodeFlexibleDouble(forKey: .ipn) ?? 0
        selfSocial = try c.decodeFlexibleDouble(forKey: .selfSocial) ?? 0
        payrollTaxes = try c.decodeFlexibleDouble(forKey: .payrollTaxes) ?? 0
        total = try c.decodeFlexibleDouble(forKey: .total) ?? 0
        effectiveRate = try c.decodeFlexibleDouble(forKey: .effectiveRate) ?? 0
    }

    private enum CodingKeys: String, CodingKey {
        case ipn, selfSocial, payrollTaxes, total, effectiveRate
    }
}

/// Приближение к порогам НДС и упрощёнки.
public struct TaxYearOutlook: Decodable, Sendable, Hashable {
    public let yearRevenue: Double
    /// Оборот на конец года, если темп сохранится.
    public let projected: Double
    public let vatThreshold: Double
    public let vatRemaining: Double
    public let vatRisk: Bool
    public let simplifiedLimit: Double
    public let simplifiedRemaining: Double
    public let simplifiedRisk: Bool

    public static let zero = TaxYearOutlook()

    private init() {
        yearRevenue = 0; projected = 0
        vatThreshold = 0; vatRemaining = 0; vatRisk = false
        simplifiedLimit = 0; simplifiedRemaining = 0; simplifiedRisk = false
    }

    /// Какая часть годового порога НДС уже выбрана — от 0 до 1.
    public var vatProgress: Double {
        guard vatThreshold > 0 else { return 0 }
        return min(1, max(0, yearRevenue / vatThreshold))
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        yearRevenue = try c.decodeFlexibleDouble(forKey: .yearRevenue) ?? 0
        projected = try c.decodeFlexibleDouble(forKey: .projected) ?? 0
        vatThreshold = try c.decodeFlexibleDouble(forKey: .vatThreshold) ?? 0
        vatRemaining = try c.decodeFlexibleDouble(forKey: .vatRemaining) ?? 0
        vatRisk = (try? c.decodeIfPresent(Bool.self, forKey: .vatRisk)) as? Bool ?? false
        simplifiedLimit = try c.decodeFlexibleDouble(forKey: .simplifiedLimit) ?? 0
        simplifiedRemaining = try c.decodeFlexibleDouble(forKey: .simplifiedRemaining) ?? 0
        simplifiedRisk = (try? c.decodeIfPresent(Bool.self, forKey: .simplifiedRisk)) as? Bool ?? false
    }

    private enum CodingKeys: String, CodingKey {
        case yearRevenue, projected
        case vatThreshold, vatRemaining, vatRisk
        case simplifiedLimit, simplifiedRemaining, simplifiedRisk
    }
}

/// Ставки и пороги года. Приходят с сервера, а не зашиты здесь: они меняются
/// законом, и вторая копия в приложении устарела бы молча.
public struct TaxConstants: Decodable, Sendable, Hashable {
    public let year: Int
    public let mrp: Double
    public let mzp: Double
    public let selfSocialMonthly: Double
    public let defaultRate: Double
    public let minRate: Double
    public let maxRate: Double

    public static let zero = TaxConstants()

    private init() {
        year = 0; mrp = 0; mzp = 0; selfSocialMonthly = 0
        defaultRate = 2; minRate = 2; maxRate = 6
    }

    /// Ставки, которые вправе установить маслихат.
    public var allowedRates: [Double] {
        guard maxRate >= minRate else { return [defaultRate] }
        return stride(from: minRate, through: maxRate, by: 1).map { $0 }
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        year = Int(try c.decodeFlexibleDouble(forKey: .year) ?? 0)
        mrp = try c.decodeFlexibleDouble(forKey: .mrp) ?? 0
        mzp = try c.decodeFlexibleDouble(forKey: .mzp) ?? 0
        selfSocialMonthly = try c.decodeFlexibleDouble(forKey: .selfSocialMonthly) ?? 0
        defaultRate = try c.decodeFlexibleDouble(forKey: .defaultRate) ?? 2
        minRate = try c.decodeFlexibleDouble(forKey: .minRate) ?? 2
        maxRate = try c.decodeFlexibleDouble(forKey: .maxRate) ?? 6
    }

    private enum CodingKeys: String, CodingKey {
        case year, mrp, mzp, selfSocialMonthly, defaultRate, minRate, maxRate
    }
}

/// Ответ `GET /api/admin/tax/summary`.
public struct TaxSummary: Decodable, Sendable {
    public let dateFrom: String
    public let dateTo: String
    /// Ставка ИПН, по которой посчитан этот ответ.
    public let rate: Double
    public let revenue: Double
    public let ipn: Double
    public let selfSocial: Double
    public let monthsCount: Int
    public let total: Double
    public let effectiveRate: Double
    public let months: [TaxMonth]
    public let payroll: TaxPayroll
    public let burden: TaxBurden
    public let year: TaxYearOutlook
    /// Точки, выручка которых в налог не включена.
    public let excludedCompanies: [Company]
    public let constants: TaxConstants

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        dateFrom = try c.decodeFlexibleString(forKey: .from) ?? ""
        dateTo = try c.decodeFlexibleString(forKey: .to) ?? ""
        rate = try c.decodeFlexibleDouble(forKey: .rate) ?? 0
        revenue = try c.decodeFlexibleDouble(forKey: .revenue) ?? 0
        ipn = try c.decodeFlexibleDouble(forKey: .ipn) ?? 0
        selfSocial = try c.decodeFlexibleDouble(forKey: .selfSocial) ?? 0
        monthsCount = Int(try c.decodeFlexibleDouble(forKey: .monthsCount) ?? 0)
        total = try c.decodeFlexibleDouble(forKey: .total) ?? 0
        effectiveRate = try c.decodeFlexibleDouble(forKey: .effectiveRate) ?? 0
        months = (try? c.decodeIfPresent([TaxMonth].self, forKey: .months)) as? [TaxMonth] ?? []
        payroll = (try? c.decodeIfPresent(TaxPayroll.self, forKey: .payroll)) as? TaxPayroll ?? .zero
        burden = (try? c.decodeIfPresent(TaxBurden.self, forKey: .burden)) as? TaxBurden ?? .zero
        year = (try? c.decodeIfPresent(TaxYearOutlook.self, forKey: .year)) as? TaxYearOutlook ?? .zero
        excludedCompanies = (try? c.decodeIfPresent([Company].self, forKey: .excludedCompanies)) as? [Company] ?? []
        constants = (try? c.decodeIfPresent(TaxConstants.self, forKey: .constants)) as? TaxConstants ?? .zero
    }

    private enum CodingKeys: String, CodingKey {
        case from, to, rate, revenue, ipn, selfSocial, monthsCount, total, effectiveRate
        case months, payroll, burden, year, excludedCompanies, constants
    }
}

public struct TaxService: Sendable {
    private let api: APIClient
    public init(api: APIClient) { self.api = api }

    public func load(
        from: String,
        to: String,
        rate: Double,
        includeExtra: Bool = false
    ) async throws -> TaxSummary {
        var query = ["from": from, "to": to, "rate": String(Int(rate))]
        if includeExtra { query["include_extra"] = "1" }
        let response: Envelope<TaxSummary> = try await api.send(
            APIRequest(path: "/api/admin/tax/summary", query: query)
        )
        return response.data
    }
}

// ── Движение денег: /api/admin/cashflow/summary ──────────────────────────────

/// День периода: сколько пришло, сколько ушло, сколько накопилось.
public struct CashflowDay: Decodable, Sendable, Identifiable, Hashable {
    public let date: String
    public let income: Double
    public let expense: Double
    public let net: Double
    /// Накопленный итог с начала периода — не остаток кассы.
    public let balance: Double

    public var id: String { date }

    public var day: Date? { DateParsing.parseDateOnly(date) }

    public var label: String {
        guard let day else { return date }
        return day.formatted(.dateTime.day().month(.abbreviated))
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        date = try c.decodeFlexibleString(forKey: .date) ?? ""
        income = try c.decodeFlexibleDouble(forKey: .income) ?? 0
        expense = try c.decodeFlexibleDouble(forKey: .expense) ?? 0
        net = try c.decodeFlexibleDouble(forKey: .net) ?? 0
        balance = try c.decodeFlexibleDouble(forKey: .balance) ?? 0
    }

    private enum CodingKeys: String, CodingKey { case date, income, expense, net, balance }
}

public struct CashflowTotals: Decodable, Sendable, Hashable {
    public let income: Double
    public let expense: Double
    public let net: Double
    public let margin: Double
    public let negativeDays: Int
    public let endingBalance: Double
    public let daysCount: Int

    public static let zero = CashflowTotals()

    private init() {
        income = 0; expense = 0; net = 0; margin = 0
        negativeDays = 0; endingBalance = 0; daysCount = 0
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        income = try c.decodeFlexibleDouble(forKey: .income) ?? 0
        expense = try c.decodeFlexibleDouble(forKey: .expense) ?? 0
        net = try c.decodeFlexibleDouble(forKey: .net) ?? 0
        margin = try c.decodeFlexibleDouble(forKey: .margin) ?? 0
        negativeDays = Int(try c.decodeFlexibleDouble(forKey: .negativeDays) ?? 0)
        endingBalance = try c.decodeFlexibleDouble(forKey: .endingBalance) ?? 0
        daysCount = Int(try c.decodeFlexibleDouble(forKey: .daysCount) ?? 0)
    }

    private enum CodingKeys: String, CodingKey {
        case income, expense, net, margin, negativeDays, endingBalance, daysCount
    }
}

/// Ответ `GET /api/admin/cashflow/summary`.
public struct CashflowReport: Decodable, Sendable {
    public let dateFrom: String
    public let dateTo: String
    public let days: [CashflowDay]
    public let totals: CashflowTotals

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        dateFrom = try c.decodeFlexibleString(forKey: .from) ?? ""
        dateTo = try c.decodeFlexibleString(forKey: .to) ?? ""
        days = (try? c.decodeIfPresent([CashflowDay].self, forKey: .days)) as? [CashflowDay] ?? []
        // Сервер отдаёт `null`, когда движений за период не было вовсе.
        totals = (try? c.decodeIfPresent(CashflowTotals.self, forKey: .totals)) as? CashflowTotals ?? .zero
    }

    private enum CodingKeys: String, CodingKey { case from, to, days, totals }

    /// Самый прибыльный день периода.
    public var bestDay: CashflowDay? { days.max { $0.net < $1.net } }

    /// Самый убыточный. Показываем только настоящий минус — «худший из
    /// прибыльных» дней ни о чём не говорит.
    public var worstDay: CashflowDay? {
        guard let day = days.min(by: { $0.net < $1.net }), day.net < 0 else { return nil }
        return day
    }
}

public struct CashflowService: Sendable {
    private let api: APIClient
    public init(api: APIClient) { self.api = api }

    public func load(from: String, to: String) async throws -> CashflowReport {
        let response: Envelope<CashflowReport> = try await api.send(
            APIRequest(path: "/api/admin/cashflow/summary", query: ["from": from, "to": to])
        )
        return response.data
    }
}

// ── Цели и планы: /api/admin/kpi-plans ───────────────────────────────────────

/// План по метрике на период вместе с фактом.
///
/// Факт и процент выполнения считает сервер: та же выручка, что в отчётах,
/// собранная теми же правилами. Считать её здесь заново значило бы получить
/// цель, выполненную на сайте и невыполненную в телефоне.
public struct GoalPlan: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let companyID: String?
    public let metric: String
    public let periodKind: String
    public let target: Double
    public let fact: Double
    /// Выполнение в процентах.
    public let achievement: Double
    public let periodStart: String
    public let periodEnd: String
    /// Период уже закрыт — итог окончательный.
    public let isClosed: Bool

    public var metricLabel: String {
        switch metric {
        case "revenue": "Выручка"
        case "profit": "Прибыль"
        case "checks": "Чеки"
        case "avg_check": "Средний чек"
        case "margin": "Маржа"
        default: metric
        }
    }

    public var periodLabel: String {
        switch periodKind {
        case "year": "Год"
        case "h1": "1-е полугодие"
        case "h2": "2-е полугодие"
        case "month": monthLabel
        default: periodKind
        }
    }

    private var monthLabel: String {
        guard let date = DateParsing.parseDateOnly(periodStart) else { return periodStart }
        return date.formatted(.dateTime.month(.wide))
    }

    /// Метрики измеряются в разном: тенге, штуках и процентах. Одна форматка
    /// на всех превратила бы 12 % маржи в «12 ₸».
    public func formatted(_ value: Double) -> String {
        switch metric {
        case "checks": Quantity.format(value)
        case "margin": Percent.format(value)
        default: Money.compact(value)
        }
    }

    public var formattedTarget: String { formatted(target) }
    public var formattedFact: String { formatted(fact) }

    /// Доля выполнения от 0 до 1 — для колец и полос.
    public var progress: Double {
        guard target > 0 else { return 0 }
        return min(1, max(0, fact / target))
    }

    public var isDone: Bool { target > 0 && fact >= target }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        companyID = try c.decodeFlexibleString(forKey: .companyID)
        // `kind` приходит как «month.revenue»; разобранные части сервер кладёт
        // рядом, но старые записи их не имеют — тогда достаём из kind сами.
        let kind = try c.decodeFlexibleString(forKey: .kind) ?? ""
        let parts = kind.split(separator: ".").map(String.init)
        metric = try c.decodeFlexibleString(forKey: .metric) ?? (parts.count > 1 ? parts[1] : "revenue")
        periodKind = try c.decodeFlexibleString(forKey: .periodKind) ?? (parts.first ?? "")
        target = try c.decodeFlexibleDouble(forKey: .target) ?? 0
        fact = try c.decodeFlexibleDouble(forKey: .fact) ?? 0
        achievement = try c.decodeFlexibleDouble(forKey: .achievement) ?? 0
        periodStart = try c.decodeFlexibleString(forKey: .periodStart) ?? ""
        periodEnd = try c.decodeFlexibleString(forKey: .periodEnd) ?? ""
        isClosed = (try? c.decodeIfPresent(Bool.self, forKey: .isClosed)) as? Bool ?? false
    }

    private enum CodingKeys: String, CodingKey {
        case id, kind, metric
        case companyID = "company_id"
        case periodKind = "period_kind"
        case target = "target_amount"
        case fact = "fact_value"
        case achievement = "achievement_pct"
        case periodStart = "period_start"
        case periodEnd = "period_end"
        case isClosed = "is_closed"
    }
}

/// Ответ `GET /api/admin/kpi-plans?year=…`.
public struct GoalsBoard: Decodable, Sendable {
    public let year: Int
    public let companies: [Company]
    public let plans: [GoalPlan]

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        year = Int(try c.decodeFlexibleDouble(forKey: .year) ?? 0)
        companies = (try? c.decodeIfPresent([Company].self, forKey: .companies)) as? [Company] ?? []
        plans = (try? c.decodeIfPresent([GoalPlan].self, forKey: .plans)) as? [GoalPlan] ?? []
    }

    private enum CodingKeys: String, CodingKey { case year, companies, plans }

    public func companyName(_ id: String?) -> String {
        guard let id else { return "Все точки" }
        return companies.first { $0.id == id }?.name ?? "Точка"
    }

    /// Открытые планы вперёд: закрытый период изменить уже нельзя, а
    /// незакрытый — ещё можно вытянуть.
    public var sortedPlans: [GoalPlan] {
        plans.sorted { left, right in
            if left.isClosed != right.isClosed { return !left.isClosed }
            return left.periodStart < right.periodStart
        }
    }
}

public struct GoalsService: Sendable {
    private let api: APIClient
    public init(api: APIClient) { self.api = api }

    public func load(year: Int) async throws -> GoalsBoard {
        let response: Envelope<GoalsBoard> = try await api.send(
            APIRequest(path: "/api/admin/kpi-plans", query: ["year": String(year)])
        )
        return response.data
    }
}

// ── Недельный отчёт: /api/admin/weekly-act ───────────────────────────────────

/// Выручка недели по способам оплаты.
public struct WeeklyIncome: Decodable, Sendable, Hashable {
    public let cash: Double
    public let kaspi: Double
    public let online: Double
    public let card: Double
    public let total: Double

    public static let zero = WeeklyIncome()

    private init() { cash = 0; kaspi = 0; online = 0; card = 0; total = 0 }

    public var cashless: Double { kaspi + online + card }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        cash = try c.decodeFlexibleDouble(forKey: .cash) ?? 0
        kaspi = try c.decodeFlexibleDouble(forKey: .kaspi) ?? 0
        online = try c.decodeFlexibleDouble(forKey: .online) ?? 0
        card = try c.decodeFlexibleDouble(forKey: .card) ?? 0
        total = try c.decodeFlexibleDouble(forKey: .total) ?? 0
    }

    private enum CodingKeys: String, CodingKey { case cash, kaspi, online, card, total }
}

/// Расходы недели одной категории.
public struct WeeklyExpenseGroup: Decodable, Sendable, Identifiable, Hashable {
    public let category: String
    public let amount: Double

    public var id: String { category }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        category = try c.decodeFlexibleString(forKey: .category) ?? "Без категории"
        amount = try c.decodeFlexibleDouble(forKey: .amount) ?? 0
    }

    private enum CodingKeys: String, CodingKey { case category, amount }
}

/// День недели в разрезе точки.
public struct WeeklyDay: Decodable, Sendable, Identifiable, Hashable {
    public let date: String
    public let income: Double
    public let expense: Double
    public let net: Double

    public var id: String { date }

    public var day: Date? { DateParsing.parseDateOnly(date) }

    public var label: String {
        guard let day else { return date }
        return day.formatted(.dateTime.weekday(.abbreviated))
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        date = try c.decodeFlexibleString(forKey: .date) ?? ""
        income = try c.decodeFlexibleDouble(forKey: .income) ?? 0
        expense = try c.decodeFlexibleDouble(forKey: .expense) ?? 0
        net = try c.decodeFlexibleDouble(forKey: .net) ?? 0
    }

    private enum CodingKeys: String, CodingKey { case date, income, expense, net }
}

/// Точка в недельном отчёте.
public struct WeeklyCompany: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let code: String?
    public let income: WeeklyIncome
    public let expenses: [WeeklyExpenseGroup]
    public let expenseTotal: Double
    public let expenseCash: Double
    public let expenseKaspi: Double
    public let net: Double
    /// Остаток наличных: приход минус расход наличными.
    public let remainCash: Double
    /// Остаток безнала.
    public let remainKaspi: Double
    public let daily: [WeeklyDay]

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        name = try c.decodeFlexibleString(forKey: .name) ?? "Точка"
        code = try c.decodeFlexibleString(forKey: .code)
        income = (try? c.decodeIfPresent(WeeklyIncome.self, forKey: .income)) as? WeeklyIncome ?? .zero
        expenses = (try? c.decodeIfPresent([WeeklyExpenseGroup].self, forKey: .expenses)) as? [WeeklyExpenseGroup] ?? []
        expenseTotal = try c.decodeFlexibleDouble(forKey: .expenseTotal) ?? 0
        expenseCash = try c.decodeFlexibleDouble(forKey: .expenseCash) ?? 0
        expenseKaspi = try c.decodeFlexibleDouble(forKey: .expenseKaspi) ?? 0
        net = try c.decodeFlexibleDouble(forKey: .net) ?? 0
        remainCash = try c.decodeFlexibleDouble(forKey: .remainCash) ?? 0
        remainKaspi = try c.decodeFlexibleDouble(forKey: .remainKaspi) ?? 0
        daily = (try? c.decodeIfPresent([WeeklyDay].self, forKey: .daily)) as? [WeeklyDay] ?? []
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, code, income, expenses, net, daily
        case expenseTotal = "expense_total"
        case expenseCash = "expense_cash"
        case expenseKaspi = "expense_kaspi"
        case remainCash = "remain_cash"
        case remainKaspi = "remain_kaspi"
    }

    /// Работала ли точка на этой неделе. Пустые точки в отчёте только шумят.
    public var hasActivity: Bool { income.total != 0 || expenseTotal != 0 }
}

/// Итог недели по всем точкам.
public struct WeeklyTotals: Decodable, Sendable, Hashable {
    public let income: WeeklyIncome
    public let expenses: [WeeklyExpenseGroup]
    public let expenseTotal: Double
    public let expenseCash: Double
    public let expenseKaspi: Double
    public let net: Double
    public let remainCash: Double
    public let remainKaspi: Double

    public static let zero = WeeklyTotals()

    private init() {
        income = .zero; expenses = []
        expenseTotal = 0; expenseCash = 0; expenseKaspi = 0
        net = 0; remainCash = 0; remainKaspi = 0
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        income = (try? c.decodeIfPresent(WeeklyIncome.self, forKey: .income)) as? WeeklyIncome ?? .zero
        expenses = (try? c.decodeIfPresent([WeeklyExpenseGroup].self, forKey: .expenses)) as? [WeeklyExpenseGroup] ?? []
        expenseTotal = try c.decodeFlexibleDouble(forKey: .expenseTotal) ?? 0
        expenseCash = try c.decodeFlexibleDouble(forKey: .expenseCash) ?? 0
        expenseKaspi = try c.decodeFlexibleDouble(forKey: .expenseKaspi) ?? 0
        net = try c.decodeFlexibleDouble(forKey: .net) ?? 0
        remainCash = try c.decodeFlexibleDouble(forKey: .remainCash) ?? 0
        remainKaspi = try c.decodeFlexibleDouble(forKey: .remainKaspi) ?? 0
    }

    private enum CodingKeys: String, CodingKey {
        case income, expenses, net
        case expenseTotal = "expense_total"
        case expenseCash = "expense_cash"
        case expenseKaspi = "expense_kaspi"
        case remainCash = "remain_cash"
        case remainKaspi = "remain_kaspi"
    }
}

/// Ответ `GET /api/admin/weekly-act`.
public struct WeeklyReport: Decodable, Sendable {
    public let dateFrom: String
    public let dateTo: String
    public let companies: [WeeklyCompany]
    public let totals: WeeklyTotals

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        dateFrom = try c.decodeFlexibleString(forKey: .from) ?? ""
        dateTo = try c.decodeFlexibleString(forKey: .to) ?? ""
        companies = (try? c.decodeIfPresent([WeeklyCompany].self, forKey: .companies)) as? [WeeklyCompany] ?? []
        totals = (try? c.decodeIfPresent(WeeklyTotals.self, forKey: .totals)) as? WeeklyTotals ?? .zero
    }

    private enum CodingKeys: String, CodingKey { case from, to, companies, totals }

    /// Точки, где на неделе было движение, от крупных к мелким.
    public var activeCompanies: [WeeklyCompany] {
        companies.filter(\.hasActivity).sorted { $0.income.total > $1.income.total }
    }

    /// Неделя по дням, сложенная по всем точкам.
    public var dailyTotals: [WeeklyDay] {
        struct Sums { var income = 0.0; var expense = 0.0 }
        var byDate: [String: Sums] = [:]
        for company in companies {
            for day in company.daily {
                var sums = byDate[day.date] ?? Sums()
                sums.income += day.income
                sums.expense += day.expense
                byDate[day.date] = sums
            }
        }
        return byDate
            .sorted { $0.key < $1.key }
            .map { WeeklyDay(date: $0.key, income: $0.value.income, expense: $0.value.expense) }
    }
}

extension WeeklyDay {
    /// Сборка дня из уже посчитанных сервером сумм по точкам.
    fileprivate init(date: String, income: Double, expense: Double) {
        self.date = date
        self.income = income
        self.expense = expense
        self.net = income - expense
    }
}

public struct WeeklyReportService: Sendable {
    private let api: APIClient
    public init(api: APIClient) { self.api = api }

    public func load(from: String, to: String) async throws -> WeeklyReport {
        let response: Envelope<WeeklyReport> = try await api.send(
            APIRequest(path: "/api/admin/weekly-act", query: ["from": from, "to": to])
        )
        return response.data
    }
}

// ── Оценка бизнеса: /api/admin/valuation ─────────────────────────────────────

/// Месяц в истории оценки.
public struct ValuationMonth: Decodable, Sendable, Identifiable, Hashable {
    public let month: String
    public let revenue: Double
    public let ebitda: Double
    public let netProfit: Double
    public let ebitdaMargin: Double

    public var id: String { month }

    public var date: Date? { DateParsing.parseDateOnly("\(month)-01") }

    public var label: String {
        guard let date else { return month }
        return date.formatted(.dateTime.month(.abbreviated).year())
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        month = try c.decodeFlexibleString(forKey: .month) ?? ""
        revenue = try c.decodeFlexibleDouble(forKey: .revenue) ?? 0
        ebitda = try c.decodeFlexibleDouble(forKey: .ebitda) ?? 0
        netProfit = try c.decodeFlexibleDouble(forKey: .netProfit) ?? 0
        ebitdaMargin = try c.decodeFlexibleDouble(forKey: .ebitdaMargin) ?? 0
    }

    private enum CodingKeys: String, CodingKey {
        case month, revenue, ebitda
        case netProfit = "net_profit"
        case ebitdaMargin = "ebitda_margin"
    }
}

/// Что двигает мультипликатор вверх или вниз.
public struct ValuationFactor: Decodable, Sendable, Identifiable, Hashable {
    public let key: String
    public let label: String
    public let status: String
    /// Вклад в мультипликатор.
    public let effect: Double
    public let note: String

    public var id: String { key }

    public var isGood: Bool { status == "good" }
    public var isBad: Bool { status == "bad" }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        key = try c.decodeFlexibleString(forKey: .key) ?? UUID().uuidString
        label = try c.decodeFlexibleString(forKey: .label) ?? ""
        status = try c.decodeFlexibleString(forKey: .status) ?? "neutral"
        effect = try c.decodeFlexibleDouble(forKey: .effect) ?? 0
        note = try c.decodeFlexibleString(forKey: .note) ?? ""
    }

    private enum CodingKeys: String, CodingKey { case key, label, status, effect, note }
}

/// Вилка: пессимистично — вероятно — оптимистично.
public struct ValuationRange: Decodable, Sendable, Hashable {
    public let low: Double
    public let mid: Double
    public let high: Double

    public static let zero = ValuationRange()

    private init() { low = 0; mid = 0; high = 0 }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        low = try c.decodeFlexibleDouble(forKey: .low) ?? 0
        mid = try c.decodeFlexibleDouble(forKey: .mid) ?? 0
        high = try c.decodeFlexibleDouble(forKey: .high) ?? 0
    }

    private enum CodingKeys: String, CodingKey { case low, mid, high }
}

/// Ответ `GET /api/admin/valuation`.
///
/// Мультипликатор и вилку считает сервер: он же знает базовую ставку рынка и
/// правила поправок. Повторять их здесь означало бы показывать владельцу свою
/// оценку бизнеса, отличную от той, что на сайте.
public struct BusinessValuation: Decodable, Sendable {
    public let periodStart: String
    public let periodEnd: String
    public let revenue12mo: Double
    public let ebitda12mo: Double
    public let ebitdaPrev12mo: Double
    public let netProfit12mo: Double
    public let ebitdaMargin: Double
    /// Изменение EBITDA год к году, в процентах. `nil` — истории мало.
    public let trendPct: Double?
    /// Коэффициент вариации маржи: чем меньше, тем предсказуемее бизнес.
    public let marginCv: Double?
    public let companiesCount: Int
    public let profitable: Bool
    public let multiple: ValuationRange
    public let valuation: ValuationRange
    public let factors: [ValuationFactor]
    public let monthly: [ValuationMonth]

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let period = try? c.nestedContainer(keyedBy: PeriodKeys.self, forKey: .period)
        periodStart = (try? period?.decodeFlexibleString(forKey: .start)) as? String ?? ""
        periodEnd = (try? period?.decodeFlexibleString(forKey: .end)) as? String ?? ""
        revenue12mo = try c.decodeFlexibleDouble(forKey: .revenue12mo) ?? 0
        ebitda12mo = try c.decodeFlexibleDouble(forKey: .ebitda12mo) ?? 0
        ebitdaPrev12mo = try c.decodeFlexibleDouble(forKey: .ebitdaPrev12mo) ?? 0
        netProfit12mo = try c.decodeFlexibleDouble(forKey: .netProfit12mo) ?? 0
        ebitdaMargin = try c.decodeFlexibleDouble(forKey: .ebitdaMargin) ?? 0
        trendPct = try c.decodeFlexibleDouble(forKey: .trendPct)
        marginCv = try c.decodeFlexibleDouble(forKey: .marginCv)
        companiesCount = Int(try c.decodeFlexibleDouble(forKey: .companiesCount) ?? 0)
        profitable = (try? c.decodeIfPresent(Bool.self, forKey: .profitable)) as? Bool ?? false
        multiple = (try? c.decodeIfPresent(ValuationRange.self, forKey: .multiple)) as? ValuationRange ?? .zero
        valuation = (try? c.decodeIfPresent(ValuationRange.self, forKey: .valuation)) as? ValuationRange ?? .zero
        factors = (try? c.decodeIfPresent([ValuationFactor].self, forKey: .factors)) as? [ValuationFactor] ?? []
        monthly = (try? c.decodeIfPresent([ValuationMonth].self, forKey: .monthly)) as? [ValuationMonth] ?? []
    }

    private enum CodingKeys: String, CodingKey {
        case period, profitable, multiple, valuation, factors, monthly
        case revenue12mo = "revenue_12mo"
        case ebitda12mo = "ebitda_12mo"
        case ebitdaPrev12mo = "ebitda_prev_12mo"
        case netProfit12mo = "net_profit_12mo"
        case ebitdaMargin = "ebitda_margin"
        case trendPct = "trend_pct"
        case marginCv = "margin_cv"
        case companiesCount = "companies_count"
    }

    private enum PeriodKeys: String, CodingKey { case start, end }

    /// Последние 12 месяцев — те, по которым и посчитана оценка.
    public var lastTwelveMonths: [ValuationMonth] {
        monthly.count > 12 ? Array(monthly.suffix(12)) : monthly
    }

    public var periodLabel: String? {
        guard let start = DateParsing.parseDateOnly(periodStart),
              let end = DateParsing.parseDateOnly(periodEnd) else { return nil }
        let format = Date.FormatStyle.dateTime.month(.abbreviated).year()
        return "\(start.formatted(format)) — \(end.formatted(format))"
    }
}

public struct ValuationService: Sendable {
    private let api: APIClient
    public init(api: APIClient) { self.api = api }

    /// Сервер отдаёт `null`, когда доступных точек нет вовсе.
    public func load() async throws -> BusinessValuation? {
        let response: OptionalEnvelope<BusinessValuation> = try await api.send(
            APIRequest(path: "/api/admin/valuation")
        )
        return response.data
    }
}
