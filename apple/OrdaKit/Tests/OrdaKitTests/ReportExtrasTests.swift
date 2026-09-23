import Foundation
import Testing
@testable import OrdaKit

@Suite("Отчёты: прогноз, тепловая карта, PDF")
struct ReportExtrasTests {
    private let hints = ReportForecastHints(
        lastFullMonth: .init(from: "2026-08-01", to: "2026-08-31", totalIncome: 3_000_000, totalExpense: 1_200_000, profit: 1_800_000),
        lastMonthMtd: .init(from: "2026-08-01", to: "2026-08-10", totalIncome: 900_000, totalExpense: 350_000, profit: 550_000, days: 10)
    )

    @Test("Гибрид: 1/3 по темпу, 2/3 по хвосту прошлого месяца — те же числа, что forecast-hybrid.ts")
    func hybrid() throws {
        let f = try #require(ReportForecast.monthEnd(
            dateFrom: "2026-09-01", dateTo: "2026-09-30", asOf: "2026-09-10",
            mtdIncome: 1_000_000, mtdExpense: 400_000, hints: hints
        ))
        #expect(f.remainingDays == 20)
        #expect(f.runRateIncome == 3_000_000)
        #expect(f.seasonalIncome == 3_100_000)
        #expect(f.forecastIncome == 3_066_667)
        #expect(f.forecastExpense == 1_233_333)
        #expect(f.forecastProfit == 1_833_334)
        #expect(abs(f.confidence - 64.6667) < 0.001)
        #expect(f.note == "Смешение: 33% по текущему темпу, 67% по «хвосту» 2026-08")
    }

    @Test("Не месяц целиком, нет подсказок или период кончился — гибрида нет")
    func hybridGuards() {
        #expect(ReportForecast.monthEnd(dateFrom: "2026-09-02", dateTo: "2026-09-30", asOf: "2026-09-10", mtdIncome: 1, mtdExpense: 1, hints: hints) == nil)
        #expect(ReportForecast.monthEnd(dateFrom: "2026-09-01", dateTo: "2026-09-30", asOf: "2026-09-10", mtdIncome: 1, mtdExpense: 1, hints: nil) == nil)
        #expect(ReportForecast.monthEnd(dateFrom: "2026-09-01", dateTo: "2026-09-30", asOf: "2026-09-30", mtdIncome: 1, mtdExpense: 1, hints: hints) == nil)
        #expect(ReportForecast.isFullMonthRange("2028-02-01", "2028-02-29"))
        #expect(!ReportForecast.isFullMonthRange("2027-02-01", "2027-02-29"))
    }

    @Test("Не месяц — линейно по факту; прошедший период — без прогноза")
    func linear() throws {
        let f = try #require(ReportForecast.forPeriod(
            dateFrom: "2026-09-21", dateTo: "2026-09-27", asOf: "2026-09-24",
            income: 400, expense: 200, profit: 200, hints: nil
        ))
        #expect(f.remainingDays == 3)
        #expect(f.forecastIncome == 700)
        #expect(f.forecastProfit == 350)
        #expect(f.note == "Линейная экстраполяция по накопленному факту")
        #expect(ReportForecast.forPeriod(dateFrom: "2026-08-01", dateTo: "2026-08-31", asOf: "2026-09-24", income: 1, expense: 1, profit: 0, hints: nil) == nil)
    }

    @Test("Тепловая карта: понедельник первым столбцом, дольше 93 дней — по месяцам")
    func heatmap() {
        // 2026-09-01 — вторник: одна пустая клетка перед ним.
        let week = ProfitHeatmap.build(from: "2026-09-01", to: "2026-09-07", dailyIncome: ["2026-09-01": 100], dailyExpense: ["2026-09-02": 50])
        #expect(week.cells.count == 7)
        #expect(week.leadingBlanks == 1)
        #expect(week.cells[1].profit == -50)
        #expect(week.maxAbsProfit == 100)
        let year = ProfitHeatmap.build(from: "2026-01-01", to: "2026-12-31", dailyIncome: ["2026-03-05": 10, "2026-03-06": 5], dailyExpense: [:])
        #expect(year.byMonth)
        #expect(year.cells.count == 12)
        #expect(year.cells[2].income == 15)
        #expect(year.cells[2].to == "2026-03-31")
    }

    @Test("Тело PDF и разбора ИИ — поля как на сайте")
    func bodies() throws {
        let json = #"{"aggregate":{"dateFrom":"2026-09-01","dateTo":"2026-09-30","totalsCur":{"totalIncome":1000,"totalExpense":400,"profit":600,"incomeCash":300,"incomeKaspi":700,"transactionCount":5,"avgTransaction":200},"totalsPrev":{"totalIncome":800},"expenseByCategory":{"Аренда":300,"Свет":100},"incomeByCompany":{"c1":{"companyId":"c1","name":"Arena","value":1000,"cash":300,"kaspi":700,"online":0,"card":0,"count":5}}},"incomes":[{"id":"1","date":"2026-09-02","company_id":"c1","shift":"day","cash_amount":300,"kaspi_amount":700}],"expenses":[{"id":"2","date":"2026-09-03","company_id":"c1","category":"Аренда","cash_amount":0,"kaspi_amount":300}],"asOf":"2026-09-10","forecastHints":null}"#
        let bundle = try JSONDecoder().decode(ReportBundle.self, from: Data(json.utf8))
        #expect(bundle.asOf == "2026-09-10")
        #expect(bundle.forecastHints == nil)
        let body = try ReportExport.finreportBody(aggregate: bundle.aggregate, operations: bundle.operations, companyLabel: "Все компании", companyName: { _ in "Arena" })
        let root = try #require(JSONSerialization.jsonObject(with: body) as? [String: Any])
        #expect(root["kind"] as? String == "finreport")
        let data = try #require(root["data"] as? [String: Any])
        let ops = try #require(data["operations"] as? [[String: Any]])
        #expect(ops.count == 2)
        #expect(ops[0]["type"] as? String == "Расход")
        #expect(ops[0]["cat"] as? String == "Аренда")
        #expect(ops[1]["cat"] as? String == "day")
        #expect(ops[1]["cashless"] as? Double == 700)
        let byCompany = try #require(data["byCompany"] as? [[String: Any]])
        #expect(byCompany.first?["txns"] as? Int == 5)
        let insight = try #require(JSONSerialization.jsonObject(with: ReportExport.insightBody(aggregate: bundle.aggregate)) as? [String: Any])
        #expect((insight["totals"] as? [String: Any])?["incomeTotal"] as? Double == 1000)
        #expect((insight["topExpense"] as? [[String: Any]])?.first?["name"] as? String == "Аренда")
    }
}
