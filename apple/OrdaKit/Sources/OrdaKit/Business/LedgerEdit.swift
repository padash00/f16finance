import Foundation

// ── Исправление и удаление записей в доходах и расходах ─────────────────────
//
// Те же действия, что на сайте: `updateIncome` / `deleteIncome` в
// `/api/admin/incomes`, `updateExpense` / `deleteExpense` в
// `/api/admin/expenses`. Права — `income.edit`, `income.delete`,
// `expenses.edit`, `expenses.delete`; сервер проверяет их сам и пишет
// правку в журнал с прежними значениями.
//
// Важно: сервер перезаписывает запись целиком тем, что пришло. Поэтому
// оператор и точка стартуют со значений исходной записи, а «Kaspi до
// полуночи», которого в форме нет, уходит как было — иначе исправление суммы
// молча обнулило бы их.

/// Исправление дохода за смену.
public struct IncomeEdit: Sendable, Equatable {
    public let id: String
    public var date: String
    public var cash: Double
    public var kaspi: Double
    public var online: Double
    public var card: Double
    public var comment: String
    /// Оператор меняется выбором, как на сайте.
    public var operatorID: String?
    /// Из исходной записи, в форме не правится.
    public let kaspiBeforeMidnight: Double?

    public init(row: IncomeRow) {
        id = row.id
        date = row.date
        cash = row.cashAmount
        kaspi = row.kaspiAmount
        online = row.onlineAmount
        card = row.cardAmount
        comment = row.comment ?? ""
        operatorID = row.operatorID
        kaspiBeforeMidnight = row.kaspiBeforeMidnight
    }

    public var total: Double { cash + kaspi + online + card }

    /// Почему нельзя сохранить; `nil` — можно. Те же правила, что у сервера.
    public var problem: String? {
        if date.trimmingCharacters(in: .whitespaces).isEmpty { return "Укажите дату" }
        if [cash, kaspi, online, card].contains(where: { $0 < 0 }) { return "Сумма не может быть меньше нуля" }
        if total <= 0 { return "Укажите сумму" }
        return nil
    }

    func body() throws -> Data {
        let trimmed = comment.trimmingCharacters(in: .whitespacesAndNewlines)
        let payload: [String: Any] = [
            "date": date,
            "operator_id": operatorID ?? NSNull(),
            "cash_amount": cash,
            "kaspi_amount": kaspi,
            "kaspi_before_midnight": kaspiBeforeMidnight ?? NSNull(),
            "online_amount": online,
            "card_amount": card,
            "comment": trimmed.isEmpty ? NSNull() : trimmed,
        ]
        return try JSONSerialization.data(withJSONObject: [
            "action": "updateIncome",
            "incomeId": id,
            "payload": payload,
        ])
    }
}

/// Исправление расхода.
public struct ExpenseEdit: Sendable, Equatable {
    public let id: String
    public var date: String
    public var category: String
    public var cash: Double
    public var kaspi: Double
    public var comment: String
    /// Точку можно поменять: расход записали не на ту.
    public var companyID: String
    public var operatorID: String?

    /// `nil`, если у записи нет точки: такую сервер не примет, и лучше не
    /// предлагать правку, чем показать ошибку после ввода.
    public init?(row: ExpenseRow) {
        guard let companyID = row.companyID, !companyID.isEmpty else { return nil }
        id = row.id
        date = row.date
        category = row.category ?? ""
        cash = row.cashAmount
        kaspi = row.kaspiAmount
        comment = row.comment ?? ""
        self.companyID = companyID
        operatorID = row.operatorID
    }

    public var total: Double { cash + kaspi }

    public var problem: String? {
        if date.trimmingCharacters(in: .whitespaces).isEmpty { return "Укажите дату" }
        if category.trimmingCharacters(in: .whitespaces).isEmpty { return "Выберите категорию" }
        if cash < 0 || kaspi < 0 { return "Сумма не может быть меньше нуля" }
        if total <= 0 { return "Укажите сумму" }
        return nil
    }

    func body() throws -> Data {
        let trimmed = comment.trimmingCharacters(in: .whitespacesAndNewlines)
        let payload: [String: Any] = [
            "date": date,
            "company_id": companyID,
            "operator_id": operatorID ?? NSNull(),
            "category": category.trimmingCharacters(in: .whitespaces),
            "cash_amount": cash,
            "kaspi_amount": kaspi,
            "comment": trimmed.isEmpty ? NSNull() : trimmed,
        ]
        return try JSONSerialization.data(withJSONObject: [
            "action": "updateExpense",
            "expenseId": id,
            "payload": payload,
        ])
    }
}

extension BusinessService {
    /// Удалить доход. Не откладывается до связи: удаление подтверждают, глядя
    /// на запись, и оно должно случиться сразу или честно не случиться.
    public func deleteIncome(id: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["action": "deleteIncome", "incomeId": id])
        _ = try await api.send(APIRequest(path: "/api/admin/incomes", method: .post, body: body))
    }

    public func deleteExpense(id: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["action": "deleteExpense", "expenseId": id])
        _ = try await api.send(APIRequest(path: "/api/admin/expenses", method: .post, body: body))
    }
}
