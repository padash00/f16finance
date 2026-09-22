import Foundation
import Testing

@testable import OrdaKit

@Suite("Период аналитики владельца")
struct AnalyticsPeriodTests {
    private let almaty = TimeZone(identifier: "Asia/Almaty")!

    /// Вторник, 22 сентября 2026, 10:00 по Алматы.
    private var now: Date {
        var c = DateComponents()
        c.year = 2026; c.month = 9; c.day = 22; c.hour = 10
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = almaty
        return calendar.date(from: c)!
    }

    @Test("Неделя начинается с понедельника")
    func weekStartsOnMonday() {
        #expect(AnalyticsPeriod.thisWeek.bounds(now: now, timeZone: almaty) == ("2026-09-21", "2026-09-27"))
        #expect(AnalyticsPeriod.lastWeek.bounds(now: now, timeZone: almaty) == ("2026-09-14", "2026-09-20"))
    }

    @Test("Идущий месяц кончается последним днём месяца, а не сегодня")
    func monthCoversWholeMonth() {
        #expect(AnalyticsPeriod.thisMonth.bounds(now: now, timeZone: almaty) == ("2026-09-01", "2026-09-30"))
        #expect(AnalyticsPeriod.lastMonth.bounds(now: now, timeZone: almaty) == ("2026-08-01", "2026-08-31"))
    }

    @Test("Квартал, год, 30 дней, сегодня и вчера")
    func otherPresets() {
        #expect(AnalyticsPeriod.thisQuarter.bounds(now: now, timeZone: almaty) == ("2026-07-01", "2026-09-30"))
        #expect(AnalyticsPeriod.thisYear.bounds(now: now, timeZone: almaty) == ("2026-01-01", "2026-12-31"))
        #expect(AnalyticsPeriod.last30Days.bounds(now: now, timeZone: almaty) == ("2026-08-24", "2026-09-22"))
        #expect(AnalyticsPeriod.today.bounds(now: now, timeZone: almaty) == ("2026-09-22", "2026-09-22"))
        #expect(AnalyticsPeriod.yesterday.bounds(now: now, timeZone: almaty) == ("2026-09-21", "2026-09-21"))
    }

    @Test("Свои даты в обратном порядке переставляются")
    func customIsOrdered() {
        #expect(AnalyticsPeriod.custom(from: "2026-09-10", to: "2026-09-01").bounds() == ("2026-09-01", "2026-09-10"))
    }

    @Test("Подпись периода короткая и без года для текущего")
    func rangeLabels() {
        #expect(AnalyticsPeriod.rangeLabel(from: "2026-09-03", to: "2026-09-09", currentYear: 2026) == "3–9 сен")
        #expect(AnalyticsPeriod.rangeLabel(from: "2026-08-28", to: "2026-09-03", currentYear: 2026) == "28 авг – 3 сен")
        #expect(AnalyticsPeriod.rangeLabel(from: "2025-01-01", to: "2025-03-31", currentYear: 2026) == "1 янв 2025 – 31 мар 2025")
        #expect(AnalyticsPeriod.rangeLabel(from: "2026-09-22", to: "2026-09-22", currentYear: 2026) == "22 сен")
    }
}

@Suite("Ответ аналитики владельца")
struct OwnerAnalyticsDecodingTests {
    @Test("Разбирается ответ клуба без кассы и без прав на разбивки")
    func decodesMinimalResponse() throws {
        let json = """
        {"ok":true,"data":{
          "period":{"from":"2026-09-01","to":"2026-09-30","through":"2026-09-22","prevFrom":"2026-08-01","prevTo":"2026-08-22","compare":"prev","group":"day","partial":true},
          "companies":[{"id":"c1","name":"F16 Arena","isExtra":false}],
          "selectedCompanyIds":[],
          "kpi":{
            "current":{"revenue":1000,"expense":400,"profit":600,"pnlProfit":650,"cash":300,"kaspi":700,"card":0,"online":0,"shifts":4},
            "previous":{"revenue":800,"expense":400,"profit":400,"pnlProfit":400,"cash":0,"kaspi":800,"card":0,"online":0,"shifts":3}
          },
          "series":[{"date":"2026-09-01","prevDate":"2026-08-01","revenue":1000,"expense":400,"profit":600,"prevRevenue":800,"prevExpense":400,"prevProfit":400}],
          "byCompany":[{"id":"c1","name":"F16 Arena","revenue":1000,"expense":400,"profit":600,"prevRevenue":800,"prevProfit":400}],
          "weekdays":[{"weekday":0,"total":1000,"days":4,"average":250}],
          "expenseCategories":null,"operators":null,"pos":null
        }}
        """
        let decoded = try APIClient.defaultDecoder.decode(Envelope<OwnerAnalytics>.self, from: Data(json.utf8)).data
        #expect(decoded.period.group == .day)
        #expect(decoded.kpi.current.cashless == 700)
        #expect(decoded.kpi.current.marginPercent == 60)
        #expect(decoded.pos == nil)
        #expect(decoded.expenseCategories == nil)
        #expect(decoded.series.first?.prevRevenue == 800)
    }
}
