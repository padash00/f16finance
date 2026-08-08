import Foundation
import Testing

@testable import OrdaKit

/// Даты — тихая часть приложения: ошибка здесь не падает, а просто показывает
/// цифры за соседний день, и заметить это можно только сверив с сайтом.
@Suite("Разбор и запись дат")
struct DateParsingTests {
    /// Календарь Алматы (UTC+5) — там, где работают все клиенты.
    private var almaty: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Almaty") ?? .gmt
        return calendar
    }

    private func date(_ year: Int, _ month: Int, _ day: Int, hour: Int = 12) -> Date {
        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = day
        components.hour = hour
        return almaty.date(from: components) ?? Date()
    }

    // ── Запись ───────────────────────────────────────────────────────────────

    @Test("Начало местных суток записывается тем же днём, а не предыдущим")
    func localMidnightKeepsItsDay() {
        // Главный случай. В UTC+5 местная полночь — 19:00 прошлого дня по UTC.
        // Пока компоненты брались в UTC, «сегодня» уезжало во вчера: отчёты
        // считались за не тот день, а зарплатный понедельник становился
        // воскресеньем, которое сервер не принимает как начало недели.
        let midnight = almaty.startOfDay(for: date(2026, 8, 8, hour: 1))
        #expect(DateParsing.dateOnlyString(from: midnight) == "2026-08-08")
    }

    @Test("Поздний вечер тоже остаётся своим днём")
    func lateEveningKeepsItsDay() {
        #expect(DateParsing.dateOnlyString(from: date(2026, 8, 8, hour: 23)) == "2026-08-08")
    }

    @Test("Переход через год не сдвигает дату")
    func newYearBoundary() {
        let midnight = almaty.startOfDay(for: date(2026, 1, 1, hour: 2))
        #expect(DateParsing.dateOnlyString(from: midnight) == "2026-01-01")
    }

    // ── Круговой проход ──────────────────────────────────────────────────────

    @Test("Дата с сервера возвращается в том же виде")
    func roundTripIsStable() {
        // Разбор ставит полдень UTC — он попадает в те же сутки в любом поясе
        // от UTC−11 до UTC+11, поэтому запись возвращает исходную строку.
        for raw in ["2026-01-01", "2026-06-15", "2026-08-08", "2026-12-31"] {
            let parsed = try! #require(DateParsing.parseDateOnly(raw))
            #expect(DateParsing.dateOnlyString(from: parsed) == raw)
        }
    }

    @Test("Разбор понимает и голую дату, и ISO со временем")
    func parsesBothForms() {
        #expect(DateParsing.parseDateOnly("2026-08-08") != nil)
        #expect(DateParsing.parse("2026-08-08T10:30:00Z") != nil)
        #expect(DateParsing.parse("2026-08-08T10:30:00.123Z") != nil)
        #expect(DateParsing.date(from: nil) == nil)
        #expect(DateParsing.date(from: "") == nil)
        #expect(DateParsing.date(from: "не дата") == nil)
    }
}

/// Зарплатная неделя всегда начинается с понедельника — сервер отвергает
/// любую другую дату как начало недели.
@Suite("Зарплатная неделя")
struct PayWeekTests {
    @Test("Начало недели — всегда понедельник")
    func startIsAlwaysMonday() {
        let calendar = Calendar(identifier: .iso8601)

        // Проверяем каждый день недели: воскресенье — самый опасный, потому
        // что Calendar.current в Казахстане начинает неделю именно с него.
        for offset in 0..<14 {
            let day = calendar.date(byAdding: .day, value: offset, to: Date()) ?? Date()
            let weekStart = PayWeek.start(containing: day)

            let parsed = try! #require(DateParsing.parseDateOnly(weekStart))
            // В ISO-8601 понедельник — второй день недели.
            #expect(calendar.component(.weekday, from: parsed) == 2, "\(weekStart) не понедельник")
        }
    }

    @Test("Сдвиг на неделю даёт понедельник ровно через семь дней")
    func shiftKeepsMonday() {
        let start = PayWeek.start()
        let next = PayWeek.shifted(start, by: 1)
        let previous = PayWeek.shifted(start, by: -1)

        let calendar = Calendar(identifier: .iso8601)
        let startDate = try! #require(DateParsing.parseDateOnly(start))
        let nextDate = try! #require(DateParsing.parseDateOnly(next))
        let previousDate = try! #require(DateParsing.parseDateOnly(previous))

        #expect(calendar.dateComponents([.day], from: startDate, to: nextDate).day == 7)
        #expect(calendar.dateComponents([.day], from: previousDate, to: startDate).day == 7)
    }

    @Test("Нулевой сдвиг ничего не меняет")
    func zeroShiftIsIdentity() {
        let start = PayWeek.start()
        #expect(PayWeek.shifted(start, by: 0) == start)
    }

    @Test("Испорченная строка возвращается как есть, а не превращается в мусор")
    func brokenInputSurvives() {
        #expect(PayWeek.shifted("не дата", by: 1) == "не дата")
    }
}
