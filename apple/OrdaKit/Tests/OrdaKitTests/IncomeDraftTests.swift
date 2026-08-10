import Foundation
import Testing

@testable import OrdaKit

/// Проверки заготовки дохода.
///
/// Смысл теста не в арифметике, а в том, что форма отсеивает ровно то же, что
/// отвергает сервер. Разойдись они — и владелец получит отказ уже после
/// отправки, с формулировкой, которой не было в форме.
@Suite("Заготовка дохода")
struct IncomeDraftTests {
    private func draft(
        cash: Double = 0,
        kaspi: Double = 0,
        card: Double = 0,
        online: Double = 0,
        company: String = "c1",
        operatorID: String? = "o1",
        shift: String = "day",
        date: String = "2026-08-10"
    ) -> IncomeDraft {
        IncomeDraft(
            date: date,
            companyID: company,
            operatorID: operatorID,
            shift: shift,
            cashAmount: cash,
            kaspiAmount: kaspi,
            cardAmount: card,
            onlineAmount: online
        )
    }

    @Test("Полностью нулевая выручка не отправляется")
    func zeroTotalIsRejected() {
        #expect(draft().validationMessage == "Сумма дохода обязательна")
    }

    @Test("Хватает одной ненулевой суммы")
    func anySingleAmountIsEnough() {
        #expect(draft(cash: 1000).isValid)
        #expect(draft(kaspi: 1000).isValid)
        #expect(draft(card: 1000).isValid)
        #expect(draft(online: 1000).isValid)
    }

    @Test("Обязательные поля названы по отдельности")
    func requiredFields() {
        #expect(draft(cash: 1, date: "").validationMessage == "Дата обязательна")
        #expect(draft(cash: 1, company: "").validationMessage == "Точка обязательна")
        #expect(draft(cash: 1, operatorID: nil).validationMessage == "Оператор обязателен")
        #expect(draft(cash: 1, operatorID: "").validationMessage == "Оператор обязателен")
        #expect(draft(cash: 1, shift: "evening").validationMessage == "Смена обязательна")
    }

    /// Отрицательную сумму сервер тоже отвергает, но не в этом дело: минус в
    /// выручке — это почти всегда попытка «исправить» прошлую запись новой.
    @Test("Отрицательные суммы не проходят")
    func negativeIsRejected() {
        #expect(draft(cash: 5000, kaspi: -1000).validationMessage == "Сумма не может быть отрицательной")
    }

    @Test("Итог складывается из всех способов оплаты")
    func totalSumsEveryMethod() {
        #expect(draft(cash: 1, kaspi: 2, card: 3, online: 4).total == 10)
    }

    /// Ключи в теле запроса — снейк-кейс сервера. Опечатка здесь означала бы
    /// молча потерянную сумму: неизвестное поле сервер просто не увидит.
    @Test("Тело запроса собирается по контракту сервера")
    func encodesServerContract() throws {
        let body = try JSONEncoder().encode(
            IncomeCreateRequest(payload: draft(cash: 1500, kaspi: 500, operatorID: "op-7"), force: true)
        )
        let json = try #require(
            try JSONSerialization.jsonObject(with: body) as? [String: Any]
        )

        #expect(json["action"] as? String == "createIncome")
        #expect(json["force"] as? Bool == true)

        let payload = try #require(json["payload"] as? [String: Any])
        #expect(payload["company_id"] as? String == "c1")
        #expect(payload["operator_id"] as? String == "op-7")
        #expect(payload["cash_amount"] as? Double == 1500)
        #expect(payload["kaspi_amount"] as? Double == 500)
        #expect(payload["card_amount"] as? Double == 0)
        #expect(payload["online_amount"] as? Double == 0)
        #expect(payload["shift"] as? String == "day")
    }

    /// Пустой комментарий уходит как `null`, а не как пустая строка: иначе в
    /// журнале появляются записи с «комментарием», в котором ничего нет.
    @Test("Пустой комментарий не превращается в пустую строку")
    func blankCommentBecomesNull() throws {
        var value = draft(cash: 100)
        value.comment = "   "
        let body = try JSONEncoder().encode(IncomeCreateRequest(payload: value, force: false))
        let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
        let payload = try #require(json["payload"] as? [String: Any])
        #expect(payload["comment"] is NSNull)
    }
}
