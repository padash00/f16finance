import Foundation
import Testing
@testable import OrdaKit

@Suite("Отчёт: разбор bundle и параметры")
struct ReportBundleTests {
    /// Форма ответа — как у `serializeAggregate` и `groupExpensesByArticle`
    /// в `app/api/admin/reports/bundle/route.ts`.
    private let json = #"""
    {"ok":true,"data":{
      "asOf":"2026-09-24","impreciseNightKaspiCount":2,
      "incomes":[{"id":"i1","date":"2026-09-20","company_id":"c1","shift":"night","zone":null,"cash_amount":1000,"kaspi_amount":500,"kaspi_before_midnight":200,"online_amount":0,"card_amount":0,"comment":null}],
      "expenses":[{"id":"e1","date":"2026-09-21","company_id":"c1","category":"Аренда","cash_amount":0,"kaspi_amount":300,"comment":"сентябрь"}],
      "aggregate":{
        "dateFrom":"2026-09-01","dateTo":"2026-09-30","prevFrom":"2025-09-01","prevTo":"2025-09-30",
        "totalsCur":{"incomeCash":1000,"incomeKaspi":500,"incomeOnline":0,"incomeCard":0,"totalIncome":1500,"totalExpense":300,"profit":1200,"transactionCount":1,"avgTransaction":1500},
        "totalsPrev":{"totalIncome":1000,"totalExpense":500,"profit":500},
        "chartData":[{"key":"2026-09-20","label":"20.09","sortISO":"2026-09-20","income":1500,"expense":0,"profit":1500,"count":1}],
        "expenseByCategory":{"Аренда":300},
        "incomeByCompany":{"c1":{"companyId":"c1","name":"F16 Arena","value":1500,"cash":1000,"kaspi":500,"online":0,"card":0,"count":1}},
        "companyStats":{"c1":{"income":1500,"expense":300,"profit":1200,"cashIncome":1000,"kaspiIncome":500,"onlineIncome":0,"cardIncome":0,"cashExpense":0,"kaspiExpense":300,"transactions":1}},
        "companyStatsPrev":{"c1":{"income":1000,"expense":500,"profit":500}},
        "anomalies":[],"dailyIncome":{},"dailyExpense":{},"companyDaily":{}
      },
      "expenseByGroup":[{"group":"operating","label":"Операционные","offChain":false,"amount":300,"prevAmount":450,"categories":[{"name":"Аренда","amount":300}]}],
      "forecastHints":null,
      "meta":{"prevFrom":"2025-09-01","prevTo":"2025-09-30"}
    }}
    """#

    @Test("Выручка точек — объектами, а не числами; итоги точек и статьи расходов")
    func decodes() throws {
        let bundle = try JSONDecoder().decode(Envelope<ReportBundle>.self, from: Data(json.utf8)).data
        let aggregate = bundle.aggregate
        #expect(aggregate.companyIncome.first?.name == "F16 Arena")
        #expect(aggregate.companyIncome.first?.amount == 1500)
        #expect(aggregate.companyStats["c1"]?.expense == 300)
        #expect(aggregate.companyStats["c1"]?.margin == 0.8)
        #expect(aggregate.companyStatsPrev["c1"]?.profit == 500)
        #expect(aggregate.prevFrom == "2025-09-01")
        #expect(bundle.expenseArticles.first?.categories.first?.name == "Аренда")
        #expect(bundle.expenseArticles.first?.prevAmount == 450)
        #expect(bundle.impreciseNightKaspiCount == 2)
        #expect(bundle.operations.count == 2)
        #expect(bundle.operations.first?.kind == .expense)
        #expect(bundle.operations.last?.title == "Ночная смена")
        #expect(bundle.operations.last?.amount == 1500)
    }

    @Test("Параметры: без строк, авто-шаг по длине периода, фильтры")
    func query() {
        var q = ReportQuery(from: "2026-09-01", to: "2026-09-30")
        var items = q.queryItems(rows: "0", asOf: "2026-09-24")
        #expect(items["rows"] == "0")
        #expect(items["group"] == "day")
        #expect(items["as_of"] == "2026-09-24")
        #expect(items["company_id"] == nil && items["shift"] == nil && items["compare"] == nil)

        q.to = "2026-11-30"
        #expect(q.resolvedGroup == "week")
        q.from = "2026-01-01"; q.to = "2026-12-31"
        #expect(q.resolvedGroup == "month")

        q.grouping = .day
        q.companyID = "c1"
        q.shift = .night
        q.compareYear = true
        q.includeExtra = true
        items = q.queryItems(rows: "current", asOf: "2026-09-24")
        #expect(items["group"] == "day")
        #expect(items["company_id"] == "c1")
        #expect(items["shift"] == "night")
        #expect(items["compare"] == "year")
        #expect(items["include_extra"] == "1")
        #expect(items["rows"] == "current")
    }
}
