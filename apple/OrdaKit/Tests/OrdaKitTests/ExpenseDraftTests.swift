import Foundation
import Testing

@testable import OrdaKit

/// Проверки расхода перед отправкой.
///
/// Мастер отвергает расход последним шагом — уже после того, как человек снял
/// чек и заполнил форму. Поэтому правила повторены на клиенте слово в слово:
/// разойдись формулировки, и владелец получил бы отказ, которого в форме не
/// было, потратив на это фотографию и минуту.
@Suite("Заготовка расхода")
struct ExpenseDraftTests {
    private func draft(
        kind: ExpenseDocumentKind = .receipt,
        cash: Double = 5000,
        kaspi: Double = 0
    ) -> ExpenseDraft {
        var value = ExpenseDraft(date: "2026-08-10", companyID: "co-1")
        value.categoryID = "cat-1"
        value.categoryName = "Хозтовары"
        value.itemName = "Картриджи"
        value.comment = "Купили картриджи для принтера на стойке"
        value.amountCash = cash
        value.amountKaspi = kaspi
        value.documentKind = kind
        if kind.requiresFile { value.documentURLs = ["https://example.com/receipt.jpg"] }
        if kind == .whitelist { value.whitelistVendorID = "v-1" }
        if kind == .oneOff {
            value.oneOffPayee = "Иван"
            value.oneOffReason = "Мастер починил дверь и уехал без документов вовсе"
        }
        return value
    }

    @Test("Заполненный расход проходит для каждого типа документа")
    func validForEveryKind() {
        for kind in ExpenseDocumentKind.allCases {
            #expect(draft(kind: kind).isValid, "\(kind.title) не прошёл")
        }
    }

    @Test("Короткое название и короткий комментарий не проходят")
    func lengthsAreEnforced() {
        var short = draft()
        short.itemName = "Кар"
        #expect(short.validationMessage?.contains("Краткое название") == true)

        var terse = draft()
        terse.comment = "Купили"
        #expect(terse.validationMessage?.contains("Комментарий") == true)
    }

    /// Пробелы не считаются: иначе двадцать пробелов проходили бы как
    /// комментарий, а сервер отверг бы их последним шагом.
    @Test("Пробелы не заменяют текст")
    func whitespaceDoesNotCount() {
        var padded = draft()
        padded.comment = String(repeating: " ", count: 30)
        #expect(padded.validationMessage?.contains("Комментарий") == true)
    }

    @Test("Нулевая сумма не проходит")
    func zeroAmountRejected() {
        #expect(draft(cash: 0, kaspi: 0).validationMessage == "Сумма расхода обязательна")
    }

    @Test("Документ обязателен там, где его требует сервер")
    func documentRequirements() {
        var noFile = draft(kind: .receipt)
        noFile.documentURLs = []
        #expect(noFile.validationMessage == "Прикрепите чек/накладную")

        var noVendor = draft(kind: .whitelist)
        noVendor.whitelistVendorID = nil
        #expect(noVendor.validationMessage == "Выберите доверенного поставщика")

        var shortReason = draft(kind: .oneOff)
        shortReason.oneOffReason = "Не дали чек"
        #expect(shortReason.validationMessage?.contains("причину") == true)

        var shortPayee = draft(kind: .oneOff)
        shortPayee.oneOffPayee = "И"
        #expect(shortPayee.validationMessage?.contains("получателя") == true)
    }

    /// Неделя — граница, после которой сервер требует подтверждения. Проверяем
    /// обе стороны от неё, а не только «давно».
    @Test("Задним числом считается старше недели")
    func backdatedBoundary() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        #expect(!ExpenseDraft.isBackdated(now.addingTimeInterval(-6 * 86_400), now: now))
        #expect(ExpenseDraft.isBackdated(now.addingTimeInterval(-8 * 86_400), now: now))
    }

    @Test("Тело шага собирается по контракту сервера")
    func encodesServerContract() throws {
        let body = try JSONEncoder().encode(
            ExpenseWizardStepRequest(sessionID: "s-1", step: 3, payload: draft(kind: .oneOff).payload())
        )
        let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])

        #expect(json["session_id"] as? String == "s-1")
        #expect(json["step"] as? Int == 3)

        let payload = try #require(json["payload"] as? [String: Any])
        #expect(payload["company_id"] as? String == "co-1")
        #expect(payload["category_id"] as? String == "cat-1")
        #expect(payload["category_name"] as? String == "Хозтовары")
        #expect(payload["amount_cash"] as? Double == 5000)
        #expect(payload["document_kind"] as? String == "one_off")
        #expect(payload["one_off_payee"] as? String == "Иван")
    }

    /// Поля чужого типа документа не должны уезжать на сервер: получатель у
    /// расхода с чеком — мусор, который потом читают при разборе.
    @Test("Поля другого типа документа не отправляются")
    func foreignFieldsAreDropped() throws {
        var value = draft(kind: .receipt)
        value.oneOffPayee = "Иван"
        value.oneOffReason = "Причина, которой здесь быть не должно вообще"
        value.whitelistVendorID = "v-1"

        let body = try JSONEncoder().encode(value.payload())
        let payload = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])

        #expect(payload["one_off_payee"] is NSNull)
        #expect(payload["one_off_reason"] is NSNull)
        #expect(payload["whitelist_vendor_id"] is NSNull)
    }
}
