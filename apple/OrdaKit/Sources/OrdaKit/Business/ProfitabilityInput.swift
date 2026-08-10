import Foundation

/// Ручные вводы месяца для ОПиУ: `/api/admin/profitability`.
///
/// Из журналов доходов и расходов не выводятся ни ФОТ, ни налоги, ни
/// амортизация, ни комиссии эквайринга — их владелец задаёт руками, и без них
/// EBITDA считается по неполной картине.
///
/// Тип один на чтение и запись намеренно: сервер делает `upsert` всей строки
/// целиком, и отправка «только изменённого поля» обнулила бы остальные.
/// Форма обязана загрузить месяц, поменять одно число и вернуть всё.
public struct ProfitabilityInput: Codable, Sendable, Equatable {
    /// `YYYY-MM` — то, что уходит в запрос. В ответе сервер отдаёт дату
    /// `YYYY-MM-01`, поэтому при разборе срезаем день.
    public var month: String

    /// Замена расчётной выручки, если наличную считают отдельно.
    public var cashRevenueOverride: Double
    public var posRevenueOverride: Double

    /// Обороты и ставки эквайринга: комиссия считается как оборот × ставку.
    public var kaspiQrTurnover: Double
    public var kaspiQrRate: Double
    public var kaspiGoldTurnover: Double
    public var kaspiGoldRate: Double
    public var qrGoldTurnover: Double
    public var qrGoldRate: Double
    public var otherCardsTurnover: Double
    public var otherCardsRate: Double
    public var kaspiRedTurnover: Double
    public var kaspiRedRate: Double
    public var kaspiKreditTurnover: Double
    public var kaspiKreditRate: Double

    /// Постоянные расходы месяца.
    public var payrollAmount: Double
    public var payrollTaxesAmount: Double
    public var incomeTaxAmount: Double
    public var depreciationAmount: Double
    public var amortizationAmount: Double
    public var otherOperatingAmount: Double

    public var notes: String?

    public init(month: String) {
        self.month = month
        cashRevenueOverride = 0
        posRevenueOverride = 0
        kaspiQrTurnover = 0
        kaspiQrRate = 0
        kaspiGoldTurnover = 0
        kaspiGoldRate = 0
        qrGoldTurnover = 0
        qrGoldRate = 0
        otherCardsTurnover = 0
        otherCardsRate = 0
        kaspiRedTurnover = 0
        kaspiRedRate = 0
        kaspiKreditTurnover = 0
        kaspiKreditRate = 0
        payrollAmount = 0
        payrollTaxesAmount = 0
        incomeTaxAmount = 0
        depreciationAmount = 0
        amortizationAmount = 0
        otherOperatingAmount = 0
        notes = nil
    }

    /// Постоянные расходы месяца одной суммой — то, что владелец видит в ОПиУ
    /// строкой «прочие операционные».
    public var fixedCostsTotal: Double {
        payrollAmount + payrollTaxesAmount + incomeTaxAmount
            + depreciationAmount + amortizationAmount + otherOperatingAmount
    }

    /// Комиссия эквайринга за месяц: оборот × ставку по каждому инструменту.
    ///
    /// Ставку задают в процентах — так её называет банк, и так же её вводят на
    /// сайте. Делить на сто здесь, а не в форме: иначе одна из двух реализаций
    /// однажды разойдётся со второй.
    public var acquiringFeeTotal: Double {
        let pairs: [(Double, Double)] = [
            (kaspiQrTurnover, kaspiQrRate),
            (kaspiGoldTurnover, kaspiGoldRate),
            (qrGoldTurnover, qrGoldRate),
            (otherCardsTurnover, otherCardsRate),
            (kaspiRedTurnover, kaspiRedRate),
            (kaspiKreditTurnover, kaspiKreditRate),
        ]
        return pairs.reduce(0) { $0 + $1.0 * $1.1 / 100 }
    }

    /// Заполнен ли месяц хоть чем-то. Пустая строка в базе и её отсутствие —
    /// одно и то же по смыслу, но по-разному выглядят в интерфейсе.
    public var isEmpty: Bool {
        fixedCostsTotal == 0 && acquiringFeeTotal == 0
            && cashRevenueOverride == 0 && posRevenueOverride == 0
    }

    private enum CodingKeys: String, CodingKey {
        case month, notes
        case cashRevenueOverride = "cash_revenue_override"
        case posRevenueOverride = "pos_revenue_override"
        case kaspiQrTurnover = "kaspi_qr_turnover"
        case kaspiQrRate = "kaspi_qr_rate"
        case kaspiGoldTurnover = "kaspi_gold_turnover"
        case kaspiGoldRate = "kaspi_gold_rate"
        case qrGoldTurnover = "qr_gold_turnover"
        case qrGoldRate = "qr_gold_rate"
        case otherCardsTurnover = "other_cards_turnover"
        case otherCardsRate = "other_cards_rate"
        case kaspiRedTurnover = "kaspi_red_turnover"
        case kaspiRedRate = "kaspi_red_rate"
        case kaspiKreditTurnover = "kaspi_kredit_turnover"
        case kaspiKreditRate = "kaspi_kredit_rate"
        case payrollAmount = "payroll_amount"
        case payrollTaxesAmount = "payroll_taxes_amount"
        case incomeTaxAmount = "income_tax_amount"
        case depreciationAmount = "depreciation_amount"
        case amortizationAmount = "amortization_amount"
        case otherOperatingAmount = "other_operating_amount"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let raw = try c.decodeFlexibleString(forKey: .month) ?? ""
        month = String(raw.prefix(7))

        func number(_ key: CodingKeys) -> Double {
            (try? c.decodeFlexibleDouble(forKey: key)) as? Double ?? 0
        }

        cashRevenueOverride = number(.cashRevenueOverride)
        posRevenueOverride = number(.posRevenueOverride)
        kaspiQrTurnover = number(.kaspiQrTurnover)
        kaspiQrRate = number(.kaspiQrRate)
        kaspiGoldTurnover = number(.kaspiGoldTurnover)
        kaspiGoldRate = number(.kaspiGoldRate)
        qrGoldTurnover = number(.qrGoldTurnover)
        qrGoldRate = number(.qrGoldRate)
        otherCardsTurnover = number(.otherCardsTurnover)
        otherCardsRate = number(.otherCardsRate)
        kaspiRedTurnover = number(.kaspiRedTurnover)
        kaspiRedRate = number(.kaspiRedRate)
        kaspiKreditTurnover = number(.kaspiKreditTurnover)
        kaspiKreditRate = number(.kaspiKreditRate)
        payrollAmount = number(.payrollAmount)
        payrollTaxesAmount = number(.payrollTaxesAmount)
        incomeTaxAmount = number(.incomeTaxAmount)
        depreciationAmount = number(.depreciationAmount)
        amortizationAmount = number(.amortizationAmount)
        otherOperatingAmount = number(.otherOperatingAmount)
        notes = try c.decodeFlexibleString(forKey: .notes)
    }

    /// В запрос уходит только `payload` — месяц сервер берёт отдельным полем.
    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(cashRevenueOverride, forKey: .cashRevenueOverride)
        try c.encode(posRevenueOverride, forKey: .posRevenueOverride)
        try c.encode(kaspiQrTurnover, forKey: .kaspiQrTurnover)
        try c.encode(kaspiQrRate, forKey: .kaspiQrRate)
        try c.encode(kaspiGoldTurnover, forKey: .kaspiGoldTurnover)
        try c.encode(kaspiGoldRate, forKey: .kaspiGoldRate)
        try c.encode(qrGoldTurnover, forKey: .qrGoldTurnover)
        try c.encode(qrGoldRate, forKey: .qrGoldRate)
        try c.encode(otherCardsTurnover, forKey: .otherCardsTurnover)
        try c.encode(otherCardsRate, forKey: .otherCardsRate)
        try c.encode(kaspiRedTurnover, forKey: .kaspiRedTurnover)
        try c.encode(kaspiRedRate, forKey: .kaspiRedRate)
        try c.encode(kaspiKreditTurnover, forKey: .kaspiKreditTurnover)
        try c.encode(kaspiKreditRate, forKey: .kaspiKreditRate)
        try c.encode(payrollAmount, forKey: .payrollAmount)
        try c.encode(payrollTaxesAmount, forKey: .payrollTaxesAmount)
        try c.encode(incomeTaxAmount, forKey: .incomeTaxAmount)
        try c.encode(depreciationAmount, forKey: .depreciationAmount)
        try c.encode(amortizationAmount, forKey: .amortizationAmount)
        try c.encode(otherOperatingAmount, forKey: .otherOperatingAmount)
        let trimmed = notes?.trimmingCharacters(in: .whitespacesAndNewlines)
        try c.encode(trimmed?.isEmpty == false ? trimmed : nil, forKey: .notes)
    }
}

struct ProfitabilityInputList: Decodable, Sendable {
    let items: [ProfitabilityInput]

    private enum CodingKeys: String, CodingKey { case items }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        items = try c.decodeIfPresent([ProfitabilityInput].self, forKey: .items) ?? []
    }
}

struct ProfitabilitySaveRequest: Encodable {
    let month: String
    let payload: ProfitabilityInput
}
