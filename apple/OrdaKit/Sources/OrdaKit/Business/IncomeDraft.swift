import Foundation

/// Заготовка дохода за смену — то, что уходит в `POST /api/admin/incomes`.
///
/// Живёт в OrdaKit, а не рядом с формой: проверки до отправки должны быть
/// теми же, что на сервере, и покрываться тестом. Форма, которая пропускает
/// пустую сумму, узнаёт об этом только по 400 с чужой формулировкой.
public struct IncomeDraft: Encodable, Sendable, Equatable {
    /// `YYYY-MM-DD`.
    public var date: String
    public var companyID: String
    public var operatorID: String?
    /// `day` или `night` — других значений сервер не принимает.
    public var shift: String
    public var cashAmount: Double
    public var kaspiAmount: Double
    public var cardAmount: Double
    public var onlineAmount: Double
    public var comment: String?

    public init(
        date: String,
        companyID: String,
        operatorID: String? = nil,
        shift: String = "day",
        cashAmount: Double = 0,
        kaspiAmount: Double = 0,
        cardAmount: Double = 0,
        onlineAmount: Double = 0,
        comment: String? = nil
    ) {
        self.date = date
        self.companyID = companyID
        self.operatorID = operatorID
        self.shift = shift
        self.cashAmount = cashAmount
        self.kaspiAmount = kaspiAmount
        self.cardAmount = cardAmount
        self.onlineAmount = onlineAmount
        self.comment = comment
    }

    public var total: Double {
        cashAmount + kaspiAmount + cardAmount + onlineAmount
    }

    /// Что мешает отправить. `nil` — можно.
    ///
    /// Порядок и формулировки повторяют серверные: человек должен получить
    /// один и тот же ответ независимо от того, где сработала проверка.
    public var validationMessage: String? {
        if date.isEmpty { return "Дата обязательна" }
        if companyID.isEmpty { return "Точка обязательна" }
        if (operatorID ?? "").isEmpty { return "Оператор обязателен" }
        if shift != "day" && shift != "night" { return "Смена обязательна" }
        if cashAmount < 0 || kaspiAmount < 0 || cardAmount < 0 || onlineAmount < 0 {
            return "Сумма не может быть отрицательной"
        }
        if total <= 0 { return "Сумма дохода обязательна" }
        return nil
    }

    public var isValid: Bool { validationMessage == nil }

    private enum CodingKeys: String, CodingKey {
        case date, shift, comment
        case companyID = "company_id"
        case operatorID = "operator_id"
        case cashAmount = "cash_amount"
        case kaspiAmount = "kaspi_amount"
        case cardAmount = "card_amount"
        case onlineAmount = "online_amount"
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(date, forKey: .date)
        try c.encode(companyID, forKey: .companyID)
        try c.encode(operatorID, forKey: .operatorID)
        try c.encode(shift, forKey: .shift)
        try c.encode(cashAmount, forKey: .cashAmount)
        try c.encode(kaspiAmount, forKey: .kaspiAmount)
        try c.encode(cardAmount, forKey: .cardAmount)
        try c.encode(onlineAmount, forKey: .onlineAmount)
        let trimmed = comment?.trimmingCharacters(in: .whitespacesAndNewlines)
        try c.encode(trimmed?.isEmpty == false ? trimmed : nil, forKey: .comment)
    }
}

struct IncomeCreateRequest: Encodable {
    let action = "createIncome"
    let payload: IncomeDraft
    let force: Bool

    private enum CodingKeys: String, CodingKey { case action, payload, force }
}
