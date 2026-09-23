import Foundation
import Testing
@testable import OrdaKit

@Suite("Движение денег — остаток, ИИ, PDF")
struct CashflowExtrasTests {
    private let summary = #"""
    {"from":"2026-09-01","to":"2026-09-30",
     "days":[{"date":"2026-09-01","cashIn":1000,"cashOut":300,"cashlessIn":5000,"cashlessOut":0,"income":6000,"expense":300,"net":5700,"balance":5700,"onHand":{"cash":1700,"cashless":5000,"total":6700}}],
     "totals":{"income":6000,"expense":300,"net":5700,"margin":95,"negativeDays":0,"endingBalance":5700,"daysCount":30},
     "flows":{"cash":{"in":1000,"out":300,"net":700},"cashless":{"in":5000,"out":0,"net":5000},"total":{"in":6000,"out":300,"net":5700}},
     "previous":{"cash":{"in":800,"out":100,"net":700},"cashless":{"in":4000,"out":0,"net":4000},"total":{"in":4800,"out":100,"net":4700}},
     "activities":[{"key":"operating","label":"Текущие расходы","amount":300,"cash":300,"cashless":0,"previous":100}],
     "categories":[{"name":"Аренда","amount":300,"cash":300,"cashless":0,"previous":100}],
     "cashDeficitDays":[{"date":"2026-09-03","net":-200}],
     "balance":{"scope":"organization","anchor":{"id":"a1","company_id":null,"as_of_date":"2026-09-01","cash_amount":1000,"cashless_amount":0},"start":{"cash":1000,"cashless":0,"total":1000},"end":{"cash":1700,"cashless":5000,"total":6700},"lowest":{"date":"2026-09-01","total":6700,"cash":1700}},
     "extra":{"names":[],"included":false}}
    """#

    private func report() throws -> CashflowReport {
        try JSONDecoder().decode(CashflowReport.self, from: Data(summary.utf8))
    }

    @Test("Список отметок остатка: права и подсказка без миграции")
    func anchorList() throws {
        let json = #"{"anchors":[{"id":"a1","company_id":"c1","as_of_date":"2026-09-01","cash_amount":"1500","cashless_amount":200,"note":"пересчёт"}],"canEdit":true,"available":true}"#
        let list = try JSONDecoder().decode(CashflowAnchorList.self, from: Data(json.utf8))
        #expect(list.anchors.first?.cash == 1500)
        #expect(list.anchors.first?.companyID == "c1")
        #expect(list.canEdit)
        let off = try JSONDecoder().decode(CashflowAnchorList.self, from: Data(#"{"anchors":[],"canEdit":false,"available":false,"hint":"примените миграцию"}"#.utf8))
        #expect(!off.available)
        #expect(off.hint == "примените миграцию")
    }

    @Test("Тело отметки — ключи как у сайта, вся организация — null")
    func anchorBody() throws {
        let draft = CashflowAnchorDraft(date: "2026-09-20", cash: 1000, cashless: 2500, note: " касса ")
        let object = try #require(JSONSerialization.jsonObject(with: draft.body()) as? [String: Any])
        #expect(object["company_id"] is NSNull)
        #expect(object["as_of_date"] as? String == "2026-09-20")
        #expect(object["cashless_amount"] as? Double == 2500)
        #expect(object["note"] as? String == "касса")
    }

    @Test("Снимок для ИИ — те же строки, что на сайте")
    func aiSnapshot() throws {
        let snapshot = CashflowExport.aiSnapshot(try report())
        let lines = try #require(snapshot["summary"] as? [String])
        #expect(lines[0] == "Пришло 6\u{00A0}000 ₸, ушло 300 ₸, чистый поток +5\u{00A0}700 ₸")
        #expect(lines[2].hasPrefix("Остаток на конец периода 6\u{00A0}700 ₸"))
        let sections = try #require(snapshot["sections"] as? [[String: Any]])
        #expect((sections[2]["bullets"] as? [String])?.first == "2026-09-03: −200 ₸")
        #expect(JSONSerialization.isValidJSONObject(snapshot))
    }

    @Test("Данные PDF — premium: показатели, разделы, таблица по дням")
    func pdfData() throws {
        let data = CashflowExport.pdfData(try report())
        #expect(JSONSerialization.isValidJSONObject(data))
        let kpis = try #require(data["kpis"] as? [[String: Any]])
        #expect(kpis.count == 4)
        #expect(kpis[3]["label"] as? String == "Остаток на конец")
        let detail = try #require(data["detail"] as? [String: Any])
        let rows = try #require(detail["rows"] as? [[String: Any]])
        #expect(rows.first?["balance"] as? Double == 6700)
        #expect(rows.first?["cash"] as? Double == 700)
        let columns = try #require(detail["columns"] as? [[String: Any]])
        #expect(columns[4]["label"] as? String == "Остаток")
    }
}
