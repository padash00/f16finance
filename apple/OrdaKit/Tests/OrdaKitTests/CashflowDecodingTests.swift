import Foundation
import Testing
@testable import OrdaKit

@Suite("Движение денег — разбор ответа")
struct CashflowDecodingTests {
    private let summary = #"""
    {"from":"2026-09-01","to":"2026-09-30","prevFrom":"2026-08-02","prevTo":"2026-08-31",
     "days":[{"date":"2026-09-01","cashIn":1000,"cashOut":300,"cashlessIn":5000,"cashlessOut":0,"income":6000,"expense":300,"net":5700,"balance":5700,"onHand":{"cash":1700,"cashless":5000,"total":6700}}],
     "totals":{"income":6000,"expense":300,"net":5700,"margin":95,"negativeDays":0,"endingBalance":5700,"daysCount":30},
     "flows":{"cash":{"in":1000,"out":300,"net":700},"cashless":{"in":5000,"out":0,"net":5000},"total":{"in":6000,"out":300,"net":5700}},
     "previous":{"cash":{"in":800,"out":100,"net":700},"cashless":{"in":4000,"out":0,"net":4000},"total":{"in":4800,"out":100,"net":4700}},
     "activities":[{"key":"operating","label":"Текущие расходы","amount":300,"cash":300,"cashless":0,"previous":100}],
     "categories":[{"name":"Аренда","group":"opex","activity":"operating","amount":300,"cash":300,"cashless":0,"previous":100}],
     "companies":[{"id":"c1","name":"F16 Arena","isExtra":false,"inTotals":true,"flows":{"cash":{"in":1000,"out":300,"net":700},"cashless":{"in":5000,"out":0,"net":5000},"total":{"in":6000,"out":300,"net":5700}},"previousNet":4700}],
     "largestExpenses":[{"date":"2026-09-01","company":"F16 Arena","category":"Аренда","payee":"","amount":300,"cash":300,"cashless":0,"pending":false}],
     "pending":{"count":2,"total":1500},
     "cashDeficitDays":[{"date":"2026-09-03","net":-200}],
     "balance":{"scope":"organization","anchor":{"id":"a1","company_id":null,"as_of_date":"2026-09-01","cash_amount":1000,"cashless_amount":0,"note":null},"start":{"cash":1000,"cashless":0,"total":1000},"end":{"cash":1700,"cashless":5000,"total":6700},"lowest":{"date":"2026-09-01","total":6700,"cash":1700}},
     "extra":{"names":["F16 Extra"],"included":false},"balanceAvailable":true}
    """#

    @Test("Полный ответ сводки — каналы, остаток, точки, статьи")
    func fullSummary() throws {
        let report = try JSONDecoder().decode(CashflowReport.self, from: Data(summary.utf8))
        #expect(report.flows.cash.inflow == 1000)
        #expect(report.flows.total.net == 5700)
        #expect(report.previous.total.net == 4700)
        #expect(report.days.first?.cashlessIn == 5000)
        #expect(report.days.first?.onHand?.total == 6700)
        #expect(report.activities.first?.label == "Текущие расходы")
        #expect(report.companies.first?.flows.cash.net == 700)
        #expect(report.pendingCount == 2)
        #expect(report.pendingTotal == 1500)
        #expect(report.cashDeficitDays.first?.net == -200)
        #expect(report.balance?.end?.total == 6700)
        #expect(report.balance?.anchor?.asOfDate == "2026-09-01")
        #expect(report.balance?.anchor?.companyID == nil)
        #expect(report.extraNames == ["F16 Extra"])
        #expect(report.prevFrom == "2026-08-02")
    }

    @Test("Пустой период и старый ответ не ломают разбор")
    func emptyAndLegacy() throws {
        let empty = try JSONDecoder().decode(CashflowReport.self, from: Data(#"{"from":"2026-09-01","to":"2026-09-30","days":[],"totals":null}"#.utf8))
        #expect(empty.balance == nil)
        #expect(empty.companies.isEmpty)
        #expect(empty.flows.total.net == 0)
    }

    @Test("Платежи вперёд и прогноз до конца месяца")
    func outlook() throws {
        let json = #"""
        {"today":"2026-09-24","payments":[{"date":"2026-09-25","templateId":"t1","name":"Аренда","category":"Аренда","amount":200000,"cashless":true,"companyId":"c1","company":"F16 Arena"}],
         "projection":{"monthEnd":"2026-09-30","source":"model","incomeLeft":500000,"paymentsLeft":200000,"otherSpendLeft":50000,"netLeft":250000,"balanceStart":100000,"balanceEnd":350000,"lowest":{"date":"2026-09-25","balance":-20000},
           "days":[{"date":"2026-09-24","income":70000,"payments":0,"other":7000,"balance":163000},{"date":"2026-09-25","income":70000,"payments":200000,"other":7000,"balance":null}]},
         "balanceToday":{"cash":50000,"cashless":50000,"total":100000},"anchor":null}
        """#
        let outlook = try JSONDecoder().decode(CashflowOutlook.self, from: Data(json.utf8))
        #expect(outlook.payments.first?.cashless == true)
        #expect(outlook.payments.first?.companyID == "c1")
        #expect(outlook.projection?.lowestBalance == -20000)
        #expect(outlook.projection?.days.last?.balance == nil)
        #expect(outlook.balanceToday?.total == 100000)
        #expect(outlook.anchor == nil)
    }
}
