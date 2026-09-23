import Foundation
import Testing
@testable import OrdaKit

@Suite("Исправление доходов и расходов")
struct LedgerEditTests {
    private func income(_ json: String) throws -> IncomeRow {
        try JSONDecoder().decode(IncomeRow.self, from: Data(json.utf8))
    }

    private func expense(_ json: String) throws -> ExpenseRow {
        try JSONDecoder().decode(ExpenseRow.self, from: Data(json.utf8))
    }

    private func object(_ data: Data) throws -> [String: Any] {
        try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    @Test("Правка дохода сохраняет оператора и Kaspi до полуночи — сервер перезаписывает запись целиком")
    func incomeKeepsHiddenFields() throws {
        let row = try income(#"{"id":"i1","date":"2026-09-20","cash_amount":1000,"kaspi_amount":500,"operator_id":"op7","kaspi_before_midnight":200,"comment":"x"}"#)
        var edit = IncomeEdit(row: row)
        edit.cash = 1500
        let body = try object(edit.body())
        #expect(body["action"] as? String == "updateIncome")
        #expect(body["incomeId"] as? String == "i1")
        let payload = try #require(body["payload"] as? [String: Any])
        #expect(payload["operator_id"] as? String == "op7")
        #expect(payload["kaspi_before_midnight"] as? Double == 200)
        #expect(payload["cash_amount"] as? Double == 1500)
    }

    @Test("Правка расхода сохраняет точку и оператора")
    func expenseKeepsHiddenFields() throws {
        let row = try expense(#"{"id":"e1","date":"2026-09-20","category":"Аренда","cash_amount":0,"kaspi_amount":300,"company_id":"c1","operator_id":"op2"}"#)
        let edit = try #require(ExpenseEdit(row: row))
        let payload = try #require(try object(edit.body())["payload"] as? [String: Any])
        #expect(payload["company_id"] as? String == "c1")
        #expect(payload["operator_id"] as? String == "op2")
        #expect(payload["comment"] is NSNull)
    }

    @Test("Нулевую сумму и пустую категорию не отправляем")
    func validation() throws {
        var edit = try #require(ExpenseEdit(row: try expense(#"{"id":"e1","date":"2026-09-20","category":"Аренда","cash_amount":10,"company_id":"c1"}"#)))
        #expect(edit.problem == nil)
        edit.cash = 0
        #expect(edit.problem == "Укажите сумму")
        edit.cash = 5
        edit.category = " "
        #expect(edit.problem == "Выберите категорию")
        #expect(ExpenseEdit(row: try expense(#"{"id":"e2","date":"2026-09-20","cash_amount":10}"#)) == nil)
    }
}

@Suite("Корректировки зарплаты")
struct SalaryAdjustmentDecodingTests {
    @Test("Неделя отдаёт корректировки поштучно — с id для отмены")
    func decodesAdjustments() throws {
        let json = #"{"grossAmount":1000,"netAmount":900,"status":"draft","payments":[],"adjustments":[{"id":"a1","date":"2026-09-20","amount":500,"kind":"fine","comment":"опоздал","companyId":"c1","status":"active"},{"id":"a2","date":"2026-09-21","amount":300,"kind":"bonus","status":"voided"}]}"#
        let week = try JSONDecoder().decode(SalaryRow.Week.self, from: Data(json.utf8))
        #expect(week.adjustments.count == 2)
        #expect(week.adjustments[0].kindLabel == "Штраф")
        #expect(week.adjustments[0].companyID == "c1")
        #expect(!week.adjustments[1].isActive)
        #expect(week.adjustments[1].isAddition)
    }
}
