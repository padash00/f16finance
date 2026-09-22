import Foundation

// ── Общий фильтр аналитики владельца ─────────────────────────────────────────
//
// Период, набор точек и база сравнения выставляются один раз и действуют на
// всех вкладках. Раньше у каждого экрана был свой период: «Отчёты» за неделю,
// ОПиУ за год, касса за сегодня — и цифры на соседних экранах не сходились.

/// Выбранный период.
public enum AnalyticsPeriod: Hashable, Sendable, Codable {
    case today
    case yesterday
    case thisWeek
    case lastWeek
    case thisMonth
    case lastMonth
    case thisQuarter
    case thisYear
    case last30Days
    case custom(from: String, to: String)

    /// Готовые варианты в порядке показа.
    public static let presets: [AnalyticsPeriod] = [
        .today, .yesterday, .thisWeek, .lastWeek, .thisMonth, .lastMonth, .last30Days, .thisQuarter, .thisYear,
    ]

    public var title: String {
        switch self {
        case .today: "Сегодня"
        case .yesterday: "Вчера"
        case .thisWeek: "Эта неделя"
        case .lastWeek: "Прошлая неделя"
        case .thisMonth: "Этот месяц"
        case .lastMonth: "Прошлый месяц"
        case .thisQuarter: "Квартал"
        case .thisYear: "Год"
        case .last30Days: "30 дней"
        case let .custom(from, to): Self.rangeLabel(from: from, to: to)
        }
    }

    /// Календарь владельца: неделя с понедельника, «сегодня» — местное.
    static func calendar(timeZone: TimeZone) -> Calendar {
        var calendar = Calendar(identifier: .iso8601)
        calendar.timeZone = timeZone
        calendar.locale = Locale(identifier: "ru_RU")
        return calendar
    }

    /// Границы периода в формате YYYY-MM-DD, обе включительно.
    ///
    /// Идущий период («этот месяц») кончается последним днём месяца, а не
    /// сегодня: сервер сам знает, что данные есть только по сегодня, и режет
    /// базу сравнения той же длиной.
    public func bounds(now: Date = Date(), timeZone: TimeZone = .current) -> (from: String, to: String) {
        let calendar = Self.calendar(timeZone: timeZone)
        let today = calendar.startOfDay(for: now)
        let iso = { (date: Date) in Self.iso(date, calendar) }
        let add = { (component: Calendar.Component, value: Int, date: Date) in
            calendar.date(byAdding: component, value: value, to: date) ?? date
        }

        switch self {
        case .today:
            return (iso(today), iso(today))
        case .yesterday:
            let day = add(.day, -1, today)
            return (iso(day), iso(day))
        case .thisWeek, .lastWeek:
            let weekday = calendar.component(.weekday, from: today)
            let offset = (weekday + 5) % 7
            var monday = add(.day, -offset, today)
            if self == .lastWeek { monday = add(.day, -7, monday) }
            return (iso(monday), iso(add(.day, 6, monday)))
        case .thisMonth, .lastMonth:
            var first = calendar.date(from: calendar.dateComponents([.year, .month], from: today)) ?? today
            if self == .lastMonth { first = add(.month, -1, first) }
            return (iso(first), iso(add(.day, -1, add(.month, 1, first))))
        case .thisQuarter:
            let month = calendar.component(.month, from: today)
            let year = calendar.component(.year, from: today)
            let startMonth = (month - 1) / 3 * 3 + 1
            let first = calendar.date(from: DateComponents(year: year, month: startMonth, day: 1)) ?? today
            return (iso(first), iso(add(.day, -1, add(.month, 3, first))))
        case .thisYear:
            let year = calendar.component(.year, from: today)
            return ("\(year)-01-01", "\(year)-12-31")
        case .last30Days:
            return (iso(add(.day, -29, today)), iso(today))
        case let .custom(from, to):
            return from <= to ? (from, to) : (to, from)
        }
    }

    static func iso(_ date: Date, _ calendar: Calendar) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// «3–9 сент», «28 авг – 3 сент», «1 янв 2025 – 31 мар 2025».
    public static func rangeLabel(from: String, to: String, currentYear: Int? = nil) -> String {
        guard let a = DateParsing.parseDateOnly(from), let b = DateParsing.parseDateOnly(to) else {
            return "\(from) – \(to)"
        }
        // parseDateOnly ставит полдень в местном поясе — разбираем тем же поясом.
        let calendar = Calendar(identifier: .gregorian)
        let year = currentYear ?? Calendar.current.component(.year, from: Date())
        let ay = calendar.component(.year, from: a)
        let by = calendar.component(.year, from: b)
        let showYear = ay != year || by != year

        func day(_ d: Date) -> String { String(calendar.component(.day, from: d)) }
        func month(_ d: Date) -> String { shortMonths[calendar.component(.month, from: d) - 1] }

        if from == to {
            return "\(day(a)) \(month(a))" + (showYear ? " \(ay)" : "")
        }
        if ay == by, calendar.component(.month, from: a) == calendar.component(.month, from: b) {
            return "\(day(a))–\(day(b)) \(month(b))" + (showYear ? " \(by)" : "")
        }
        if showYear {
            return "\(day(a)) \(month(a)) \(ay) – \(day(b)) \(month(b)) \(by)"
        }
        return "\(day(a)) \(month(a)) – \(day(b)) \(month(b))"
    }

    static let shortMonths = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]
}

/// Фильтр целиком: что владелец выставил и что уйдёт на сервер.
public struct AnalyticsFilter: Hashable, Sendable, Codable {
    public var period: AnalyticsPeriod
    /// Пусто — все точки.
    public var companyIDs: Set<String>
    public var compare: AnalyticsCompare

    public init(period: AnalyticsPeriod = .thisMonth, companyIDs: Set<String> = [], compare: AnalyticsCompare = .previous) {
        self.period = period
        self.companyIDs = companyIDs
        self.compare = compare
    }

    public var isAllCompanies: Bool { companyIDs.isEmpty }
}
