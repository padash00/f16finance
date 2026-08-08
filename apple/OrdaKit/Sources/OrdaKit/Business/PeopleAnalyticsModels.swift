import Foundation

// ── Эффективность (PI): /api/admin/performance/ranking ───────────────────────

/// Одна смена внутри рейтинга: сколько принесла и сколько от неё ждали.
public struct PerformanceShift: Decodable, Sendable, Identifiable, Hashable {
    public let date: String
    public let shift: String
    public let companyID: String
    public let actual: Double
    public let expected: Double
    public let pi: Double
    /// Откуда взята норма: `slot (LOO)`, `company-shift (LOO)`, `global`…
    public let source: String

    public var id: String { "\(date)|\(shift)|\(companyID)" }

    public var day: Date? { DateParsing.parseDateOnly(date) }
    public var isNight: Bool { shift == "night" }

    /// Сервер режет PI в [0.5; 2.0]. Смена, упёршаяся в границу, — не рекорд и
    /// не провал, а сигнал проверить данные: чаще всего там сбитая привязка
    /// оператора или разовое событие вроде турнира.
    public var isClipped: Bool { pi >= 1.99 || pi <= 0.51 }

    private enum CodingKeys: String, CodingKey {
        case date, shift, actual, expected, pi, source
        case companyID = "company_id"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        date = try c.decodeFlexibleString(forKey: .date) ?? ""
        shift = try c.decodeFlexibleString(forKey: .shift) ?? "day"
        companyID = try c.decodeFlexibleString(forKey: .companyID) ?? ""
        actual = try c.decodeFlexibleDouble(forKey: .actual) ?? 0
        expected = try c.decodeFlexibleDouble(forKey: .expected) ?? 0
        pi = try c.decodeFlexibleDouble(forKey: .pi) ?? 1
        source = try c.decodeFlexibleString(forKey: .source) ?? ""
    }

    public init(
        date: String, shift: String, companyID: String,
        actual: Double, expected: Double, pi: Double, source: String
    ) {
        self.date = date
        self.shift = shift
        self.companyID = companyID
        self.actual = actual
        self.expected = expected
        self.pi = pi
        self.source = source
    }
}

/// Словесная оценка PI. Границы те же, что на сайте, — иначе один и тот же
/// человек оказался бы «в норме» в вебе и «ниже нормы» в приложении.
public enum PerformanceGrade: Sendable, Hashable {
    case excellent, good, norm, below, weak

    public init(pi: Double) {
        switch pi {
        case 1.15...: self = .excellent
        case 1.05..<1.15: self = .good
        case 0.95..<1.05: self = .norm
        case 0.85..<0.95: self = .below
        default: self = .weak
        }
    }

    public var label: String {
        switch self {
        case .excellent: "Превосходно"
        case .good: "Хорошо"
        case .norm: "Норма"
        case .below: "Ниже нормы"
        case .weak: "Слабо"
        }
    }
}

/// Строка рейтинга эффективности. Все величины считает сервер.
public struct PerformanceRankingItem: Decodable, Sendable, Identifiable, Hashable {
    public let operatorID: String
    public let operatorName: String
    public let operatorShortName: String?
    public let shifts: Int
    public let totalRevenue: Double
    public let avgRevenuePerShift: Double
    public let pi: Double
    /// Смен хватает, чтобы сравнивать честно. Иначе — «холодный старт».
    public let qualifying: Bool
    public let shiftDetails: [PerformanceShift]

    public var id: String { operatorID }

    public var displayName: String {
        let short = operatorShortName?.trimmingCharacters(in: .whitespaces)
        return (short?.isEmpty == false ? short! : operatorName)
    }

    public var grade: PerformanceGrade { PerformanceGrade(pi: pi) }

    /// Сумма норм по всем сменам периода.
    public var expectedTotal: Double { shiftDetails.reduce(0) { $0 + $1.expected } }

    /// Сколько денег человек принёс сверх нормы (или недодал). Это и есть
    /// понятное владельцу обоснование премии — проценты сами по себе ничего
    /// не говорят о деньгах.
    public var aboveNorm: Double { totalRevenue - expectedTotal }

    private enum CodingKeys: String, CodingKey {
        case shifts, pi, qualifying
        case operatorID = "operator_id"
        case operatorName = "operator_name"
        case operatorShortName = "operator_short_name"
        case totalRevenue = "total_revenue"
        case avgRevenuePerShift = "avg_revenue_per_shift"
        case shiftDetails = "shift_details"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        operatorID = try c.decodeFlexibleString(forKey: .operatorID) ?? UUID().uuidString
        operatorName = try c.decodeFlexibleString(forKey: .operatorName) ?? "Оператор"
        operatorShortName = try c.decodeFlexibleString(forKey: .operatorShortName)
        shifts = Int(try c.decodeFlexibleDouble(forKey: .shifts) ?? 0)
        totalRevenue = try c.decodeFlexibleDouble(forKey: .totalRevenue) ?? 0
        avgRevenuePerShift = try c.decodeFlexibleDouble(forKey: .avgRevenuePerShift) ?? 0
        pi = try c.decodeFlexibleDouble(forKey: .pi) ?? 1
        qualifying = try c.decodeIfPresent(Bool.self, forKey: .qualifying) ?? false
        shiftDetails = ((try? c.decodeIfPresent([PerformanceShift].self, forKey: .shiftDetails)) ?? nil) ?? []
    }

    public init(
        operatorID: String, operatorName: String, operatorShortName: String?,
        shifts: Int, totalRevenue: Double, avgRevenuePerShift: Double,
        pi: Double, qualifying: Bool, shiftDetails: [PerformanceShift]
    ) {
        self.operatorID = operatorID
        self.operatorName = operatorName
        self.operatorShortName = operatorShortName
        self.shifts = shifts
        self.totalRevenue = totalRevenue
        self.avgRevenuePerShift = avgRevenuePerShift
        self.pi = pi
        self.qualifying = qualifying
        self.shiftDetails = shiftDetails
    }
}

/// На какой истории построены нормы. Без этого PI выглядит магией.
public struct PerformanceBaseline: Decodable, Sendable, Hashable {
    public let from: String
    public let to: String
    public let shiftsCount: Int
    public let slotsCount: Int
    public let globalMedian: Double

    public static let empty = PerformanceBaseline(
        from: "", to: "", shiftsCount: 0, slotsCount: 0, globalMedian: 0
    )

    public init(from: String, to: String, shiftsCount: Int, slotsCount: Int, globalMedian: Double) {
        self.from = from
        self.to = to
        self.shiftsCount = shiftsCount
        self.slotsCount = slotsCount
        self.globalMedian = globalMedian
    }

    private enum CodingKeys: String, CodingKey {
        case from, to
        case shiftsCount = "shifts_count"
        case slotsCount = "slots_count"
        case globalMedian = "global_median"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        from = try c.decodeFlexibleString(forKey: .from) ?? ""
        to = try c.decodeFlexibleString(forKey: .to) ?? ""
        shiftsCount = Int(try c.decodeFlexibleDouble(forKey: .shiftsCount) ?? 0)
        slotsCount = Int(try c.decodeFlexibleDouble(forKey: .slotsCount) ?? 0)
        globalMedian = try c.decodeFlexibleDouble(forKey: .globalMedian) ?? 0
    }
}

/// Ответ `GET /api/admin/performance/ranking?from=…&to=…`.
public struct PerformanceRanking: Decodable, Sendable {
    public let ranking: [PerformanceRankingItem]
    public let baseline: PerformanceBaseline
    public let minQualifyingShifts: Int

    public var qualified: [PerformanceRankingItem] { ranking.filter(\.qualifying) }
    public var coldStart: [PerformanceRankingItem] { ranking.filter { !$0.qualifying } }

    /// Средний PI по тем, кого вообще можно сравнивать.
    public var averagePI: Double? {
        let people = qualified
        guard !people.isEmpty else { return nil }
        return people.reduce(0) { $0 + $1.pi } / Double(people.count)
    }

    private enum CodingKeys: String, CodingKey { case ranking, baseline, config }
    private enum ConfigKeys: String, CodingKey { case minQualifyingShifts = "min_qualifying_shifts" }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ranking = ((try? c.decodeIfPresent([PerformanceRankingItem].self, forKey: .ranking)) ?? nil) ?? []
        baseline = ((try? c.decodeIfPresent(PerformanceBaseline.self, forKey: .baseline)) ?? nil) ?? .empty

        // Порог «сколько смен нужно, чтобы попасть в рейтинг» задаёт сервер.
        // Своё значение здесь означало бы, что в приложении и в вебе в рейтинг
        // попадают разные люди.
        var minimum = 3
        if let config = try? c.nestedContainer(keyedBy: ConfigKeys.self, forKey: .config),
           let value = ((try? config.decodeFlexibleDouble(forKey: .minQualifyingShifts)) ?? nil) {
            minimum = Int(value)
        }
        minQualifyingShifts = minimum
    }
}

// ── Сырьё для рейтинга и достижений ──────────────────────────────────────────

/// Доход смены с привязкой к оператору.
///
/// Отдельный тип, а не `IncomeRow`: тот не несёт `operator_id`, а без него
/// всё, что здесь считается, теряет смысл.
public struct OperatorIncome: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let date: String
    public let operatorID: String?
    public let companyID: String?
    public let shift: String?
    public let cashAmount: Double
    public let kaspiAmount: Double
    public let onlineAmount: Double
    public let cardAmount: Double

    public var total: Double { cashAmount + kaspiAmount + onlineAmount + cardAmount }

    private enum CodingKeys: String, CodingKey {
        case id, date, shift
        case operatorID = "operator_id"
        case companyID = "company_id"
        case cashAmount = "cash_amount"
        case kaspiAmount = "kaspi_amount"
        case onlineAmount = "online_amount"
        case cardAmount = "card_amount"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        date = try c.decodeFlexibleString(forKey: .date) ?? ""
        operatorID = try c.decodeFlexibleString(forKey: .operatorID)
        companyID = try c.decodeFlexibleString(forKey: .companyID)
        shift = try c.decodeFlexibleString(forKey: .shift)
        cashAmount = try c.decodeFlexibleDouble(forKey: .cashAmount) ?? 0
        kaspiAmount = try c.decodeFlexibleDouble(forKey: .kaspiAmount) ?? 0
        onlineAmount = try c.decodeFlexibleDouble(forKey: .onlineAmount) ?? 0
        cardAmount = try c.decodeFlexibleDouble(forKey: .cardAmount) ?? 0
    }

    public init(
        id: String = UUID().uuidString,
        date: String,
        operatorID: String?,
        companyID: String? = nil,
        shift: String? = nil,
        cashAmount: Double = 0,
        kaspiAmount: Double = 0,
        onlineAmount: Double = 0,
        cardAmount: Double = 0
    ) {
        self.id = id
        self.date = date
        self.operatorID = operatorID
        self.companyID = companyID
        self.shift = shift
        self.cashAmount = cashAmount
        self.kaspiAmount = kaspiAmount
        self.onlineAmount = onlineAmount
        self.cardAmount = cardAmount
    }
}

/// Оператор в том минимуме, который нужен рейтингу и достижениям.
///
/// `TeamOperator` тянет за собой учётку, документы и статистику за 30 дней —
/// в расчёте они не участвуют и мешали бы собирать данные в тестах.
public struct AnalyticsOperator: Sendable, Hashable, Identifiable {
    public let id: String
    public let name: String
    public let photoURL: String?
    public let isActive: Bool

    public init(id: String, name: String, photoURL: String? = nil, isActive: Bool = true) {
        self.id = id
        self.name = name
        self.photoURL = photoURL
        self.isActive = isActive
    }

    public init(_ member: TeamOperator) {
        self.init(
            id: member.id,
            name: member.displayName,
            photoURL: member.photoURL,
            isActive: member.isActive
        )
    }
}

// ── Рейтинг операторов ───────────────────────────────────────────────────────

/// Строка лидерборда за период.
public struct LeaderboardEntry: Sendable, Hashable, Identifiable {
    public let operatorID: String
    public let name: String
    public let photoURL: String?
    public let revenue: Double
    /// Смен = строк дохода: одна запись = одна закрытая смена оператора.
    public let shifts: Int
    /// Рабочих дней — различных дат. Меньше смен, если человек за день закрывал
    /// две точки.
    public let days: Int
    public let avgPerShift: Double
    /// Доля в общей выручке периода, проценты.
    public let share: Double
    public let previousRevenue: Double

    public var id: String { operatorID }

    /// Изменение к прошлому периоду. `nil` — сравнивать не с чем.
    public var change: Double? { Percent.change(current: revenue, previous: previousRevenue) }

    public init(
        operatorID: String, name: String, photoURL: String?,
        revenue: Double, shifts: Int, days: Int,
        avgPerShift: Double, share: Double, previousRevenue: Double
    ) {
        self.operatorID = operatorID
        self.name = name
        self.photoURL = photoURL
        self.revenue = revenue
        self.shifts = shifts
        self.days = days
        self.avgPerShift = avgPerShift
        self.share = share
        self.previousRevenue = previousRevenue
    }
}

/// Лидерборд по выручке.
///
/// Расчёт живёт здесь, а не на сервере, потому что весь он — сумма четырёх
/// колонок оплаты и деление на число смен. Такое повторить один в один можно;
/// PI из раздела «Эффективность» — уже нельзя, и его мы только показываем.
public enum OperatorLeaderboard {
    public static func build(
        incomes: [OperatorIncome],
        previousIncomes: [OperatorIncome] = [],
        operators: [AnalyticsOperator]
    ) -> [LeaderboardEntry] {
        var revenue: [String: Double] = [:]
        var shifts: [String: Int] = [:]
        var days: [String: Set<String>] = [:]

        for row in incomes {
            guard let id = row.operatorID else { continue }
            // Нулевую строку не считаем сменой: это заготовка, а не работа.
            let total = row.total
            guard total != 0 else { continue }
            revenue[id, default: 0] += total
            shifts[id, default: 0] += 1
            days[id, default: []].insert(row.date)
        }

        var previous: [String: Double] = [:]
        for row in previousIncomes {
            guard let id = row.operatorID else { continue }
            let total = row.total
            guard total != 0 else { continue }
            previous[id, default: 0] += total
        }

        // Люди без выручки тоже в списке: их отсутствие в лидерборде читалось бы
        // как «данных нет», хотя данные есть и они нулевые.
        var ids = Array(revenue.keys)
        var known = Set(ids)
        for person in operators where !known.contains(person.id) {
            ids.append(person.id)
            known.insert(person.id)
        }

        let byID = Dictionary(operators.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let total = revenue.values.reduce(0, +)

        return ids.map { id in
            let earned = revenue[id] ?? 0
            let count = shifts[id] ?? 0
            let person = byID[id]
            return LeaderboardEntry(
                operatorID: id,
                name: person?.name ?? "Оператор \(id.prefix(6))",
                photoURL: person?.photoURL,
                revenue: earned,
                shifts: count,
                days: days[id]?.count ?? 0,
                avgPerShift: count > 0 ? earned / Double(count) : 0,
                share: total > 0 ? earned / total * 100 : 0,
                previousRevenue: previous[id] ?? 0
            )
        }
        .sorted { left, right in
            if left.revenue != right.revenue { return left.revenue > right.revenue }
            return left.name < right.name
        }
    }
}

// ── Достижения операторов ────────────────────────────────────────────────────

/// Каталог достижений. Пороговые правила — те же, что в `lib/achievements.ts`.
public enum OperatorAchievement: String, CaseIterable, Sendable, Identifiable {
    case champion, top3, millionaire, mega, marathoner, iron, premium, major

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .champion: "Чемпион"
        case .top3: "Призёр"
        case .millionaire: "Миллионер"
        case .mega: "Мега-миллионер"
        case .marathoner: "Марафонец"
        case .iron: "Железный"
        case .premium: "Премиум-кассир"
        case .major: "Тяжеловес"
        }
    }

    public var detail: String {
        switch self {
        case .champion: "1-е место по выручке за период"
        case .top3: "Вошёл в топ-3 по выручке"
        case .millionaire: "Выручка превысила 1 000 000 ₸"
        case .mega: "Выручка превысила 5 000 000 ₸"
        case .marathoner: "Отработал 20+ смен за период"
        case .iron: "Отработал 50+ смен за период"
        case .premium: "Средний чек выше среднего на 30%+"
        case .major: "Доля выручки больше 20%"
        }
    }

    func isEarned(_ stat: AchievementStat, rank: Int, averagePerShift: Double) -> Bool {
        switch self {
        case .champion: rank == 1
        case .top3: rank > 1 && rank <= 3
        case .millionaire: stat.revenue >= 1_000_000
        case .mega: stat.revenue >= 5_000_000
        case .marathoner: stat.shifts >= 20
        case .iron: stat.shifts >= 50
        case .premium: stat.shifts >= 5 && averagePerShift > 0 && stat.avgPerShift > averagePerShift * 1.3
        case .major: stat.share >= 20
        }
    }

    /// Насколько человек близок к достижению. `nil` — прогресс не считается:
    /// место в рейтинге и сравнение со средним чеком зависят от остальных,
    /// и полоска «73 % до чемпиона» врала бы.
    public func progress(for stat: AchievementStat) -> AchievementProgress? {
        switch self {
        case .champion, .top3, .premium:
            nil
        case .millionaire:
            AchievementProgress(current: min(stat.revenue, 1_000_000), target: 1_000_000, unit: "₸")
        case .mega:
            AchievementProgress(current: min(stat.revenue, 5_000_000), target: 5_000_000, unit: "₸")
        case .marathoner:
            AchievementProgress(current: min(Double(stat.shifts), 20), target: 20, unit: "см")
        case .iron:
            AchievementProgress(current: min(Double(stat.shifts), 50), target: 50, unit: "см")
        case .major:
            AchievementProgress(current: min(stat.share, 20), target: 20, unit: "%")
        }
    }
}

/// Прогресс к достижению.
public struct AchievementProgress: Sendable, Hashable {
    public let current: Double
    public let target: Double
    public let unit: String

    public var ratio: Double { target > 0 ? min(max(current / target, 0), 1) : 0 }

    public init(current: Double, target: Double, unit: String) {
        self.current = current
        self.target = target
        self.unit = unit
    }
}

/// Показатели оператора, по которым выдаются достижения.
public struct AchievementStat: Sendable, Hashable, Identifiable {
    public let operatorID: String
    public let name: String
    public let photoURL: String?
    public let revenue: Double
    public let shifts: Int
    public let avgPerShift: Double
    /// Доля в общей выручке периода, проценты.
    public let share: Double

    public var id: String { operatorID }

    public init(
        operatorID: String, name: String, photoURL: String?,
        revenue: Double, shifts: Int, avgPerShift: Double, share: Double
    ) {
        self.operatorID = operatorID
        self.name = name
        self.photoURL = photoURL
        self.revenue = revenue
        self.shifts = shifts
        self.avgPerShift = avgPerShift
        self.share = share
    }
}

/// Что человек получил и что ещё нет.
public struct AchievementResult: Sendable, Hashable, Identifiable {
    public let stat: AchievementStat
    public let rank: Int
    public let earned: [OperatorAchievement]
    public let locked: [OperatorAchievement]

    public var id: String { stat.operatorID }

    public init(stat: AchievementStat, rank: Int, earned: [OperatorAchievement], locked: [OperatorAchievement]) {
        self.stat = stat
        self.rank = rank
        self.earned = earned
        self.locked = locked
    }
}

public enum OperatorAchievements {
    /// Свернуть доходы в показатели по людям.
    ///
    /// «Смена» здесь — рабочий день, а не строка дохода: сайт считает так же,
    /// потому что `incomes` не отдаёт идентификатор смены. Разъезд с рейтингом
    /// (там смены — строки) намеренный: пороги 20/50 смен выставлены под эту
    /// трактовку.
    public static func stats(
        incomes: [OperatorIncome],
        operators: [AnalyticsOperator]
    ) -> [AchievementStat] {
        guard !operators.isEmpty else { return [] }

        var revenue: [String: Double] = [:]
        var days: [String: Set<String>] = [:]
        let known = Set(operators.map(\.id))

        for row in incomes {
            guard let id = row.operatorID, known.contains(id) else { continue }
            revenue[id, default: 0] += row.total
            if !row.date.isEmpty { days[id, default: []].insert(row.date) }
        }

        let total = revenue.values.reduce(0, +)

        return operators.compactMap { person in
            let earned = revenue[person.id] ?? 0
            let shifts = days[person.id]?.count ?? 0
            // Кто не работал и не заработал — не «оператор с нулём достижений»,
            // а человек вне периода. Такие строки только удлиняют список.
            guard earned > 0 || shifts > 0 else { return nil }
            return AchievementStat(
                operatorID: person.id,
                name: person.name,
                photoURL: person.photoURL,
                revenue: earned,
                shifts: shifts,
                avgPerShift: shifts > 0 ? earned / Double(shifts) : 0,
                share: total > 0 ? earned / total * 100 : 0
            )
        }
    }

    /// Раздать достижения. Возвращает людей в порядке убывания выручки — ранг
    /// и есть место в этом порядке.
    public static func compute(_ stats: [AchievementStat]) -> [AchievementResult] {
        let sorted = stats.sorted { left, right in
            if left.revenue != right.revenue { return left.revenue > right.revenue }
            return left.name < right.name
        }

        // Средний чек считаем только по работавшим: нули отработавших ноль смен
        // занижали бы планку «премиум-кассира» до бессмысленной.
        let working = stats.filter { $0.shifts > 0 }
        let averagePerShift = working.isEmpty
            ? 0
            : working.reduce(0) { $0 + $1.avgPerShift } / Double(working.count)

        return sorted.enumerated().map { index, stat in
            let rank = index + 1
            var earned: [OperatorAchievement] = []
            var locked: [OperatorAchievement] = []
            for achievement in OperatorAchievement.allCases {
                if achievement.isEarned(stat, rank: rank, averagePerShift: averagePerShift) {
                    earned.append(achievement)
                } else {
                    locked.append(achievement)
                }
            }
            return AchievementResult(stat: stat, rank: rank, earned: earned, locked: locked)
        }
    }

    /// Сколько человек получило каждое достижение.
    public static func summary(_ results: [AchievementResult]) -> [OperatorAchievement: Int] {
        var counts: [OperatorAchievement: Int] = [:]
        for achievement in OperatorAchievement.allCases { counts[achievement] = 0 }
        for result in results {
            for achievement in result.earned { counts[achievement, default: 0] += 1 }
        }
        return counts
    }
}

// ── Периоды ──────────────────────────────────────────────────────────────────

/// Периоды разделов «по людям». Те же пять, что на сайте: рядом с вебом должны
/// сходиться не только цифры, но и границы, по которым их считали.
///
/// Отдельно от `DateRange` (там скользящие «последние 7/30/90 дней») —
/// календарные месяц и неделя дают другие суммы.
public enum PeoplePeriod: String, CaseIterable, Sendable, Identifiable {
    case thisWeek, lastWeek, thisMonth, lastMonth, thisYear

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .thisWeek: "Эта неделя"
        case .lastWeek: "Прошлая"
        case .thisMonth: "Месяц"
        case .lastMonth: "Прошлый месяц"
        case .thisYear: "Год"
        }
    }

    /// Календарь считаем в местном поясе: «сегодня» для владельца в Алматы —
    /// это его сегодня, а не UTC.
    private static var calendar: Calendar {
        var calendar = Calendar(identifier: .iso8601)
        calendar.timeZone = .current
        return calendar
    }

    public func bounds(now: Date = Date()) -> (from: String, to: String) {
        let calendar = Self.calendar
        let today = calendar.startOfDay(for: now)

        switch self {
        case .thisWeek, .lastWeek:
            let weekday = calendar.component(.weekday, from: today)
            let offset = (weekday + 5) % 7 // ISO: понедельник — начало недели
            let thisMonday = calendar.date(byAdding: .day, value: -offset, to: today) ?? today
            let monday = self == .thisWeek
                ? thisMonday
                : (calendar.date(byAdding: .day, value: -7, to: thisMonday) ?? thisMonday)
            let sunday = calendar.date(byAdding: .day, value: 6, to: monday) ?? monday
            return (Self.iso(monday, calendar), Self.iso(sunday, calendar))

        case .thisMonth, .lastMonth:
            let components = calendar.dateComponents([.year, .month], from: today)
            let currentFirst = calendar.date(from: components) ?? today
            let first = self == .thisMonth
                ? currentFirst
                : (calendar.date(byAdding: .month, value: -1, to: currentFirst) ?? currentFirst)
            let next = calendar.date(byAdding: .month, value: 1, to: first) ?? first
            let last = calendar.date(byAdding: .day, value: -1, to: next) ?? first
            return (Self.iso(first, calendar), Self.iso(last, calendar))

        case .thisYear:
            let year = calendar.component(.year, from: today)
            return ("\(year)-01-01", "\(year)-12-31")
        }
    }

    /// Такой же по длине период вплотную перед заданным — для стрелок «± к
    /// прошлому периоду».
    public static func previous(from: String, to: String) -> (from: String, to: String) {
        guard let start = DateParsing.parseDateOnly(from),
              let end = DateParsing.parseDateOnly(to)
        else { return (from, to) }

        // Обе границы — полдень UTC (так их разбирает `DateParsing`), поэтому
        // считаем в секундах: перевода часов в UTC не бывает, и сдвиг не съедет.
        let day: TimeInterval = 86_400
        let length = max(1, Int((end.timeIntervalSince(start) / day).rounded()) + 1)
        let previousEnd = start.addingTimeInterval(-day)
        let previousStart = previousEnd.addingTimeInterval(-day * Double(length - 1))
        return (DateParsing.dateOnlyString(from: previousStart), DateParsing.dateOnlyString(from: previousEnd))
    }

    private static func iso(_ date: Date, _ calendar: Calendar) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 1970, c.month ?? 1, c.day ?? 1)
    }
}

// ── Сервис ───────────────────────────────────────────────────────────────────

public struct PeopleAnalyticsService: Sendable {
    private let api: APIClient

    public init(api: APIClient) { self.api = api }

    public func performance(from: String, to: String, companyID: String? = nil) async throws -> PerformanceRanking {
        var query = ["from": from, "to": to]
        if let companyID, !companyID.isEmpty { query["company_id"] = companyID }
        let response: Envelope<PerformanceRanking> = try await api.send(
            APIRequest(path: "/api/admin/performance/ranking", query: query)
        )
        return response.data
    }

    public func operators() async throws -> [AnalyticsOperator] {
        let response: DataList<TeamOperator> = try await api.send(
            APIRequest(path: "/api/admin/operators")
        )
        return response.items.map(AnalyticsOperator.init)
    }

    public func companies() async throws -> [Company] {
        let response: DataList<Company> = try await api.send(APIRequest(path: "/api/admin/companies"))
        return response.items
    }

    /// Доходы за период постранично.
    ///
    /// Роут по умолчанию отдаёт 2000 строк и молча обрезает остальное — на
    /// годовом периоде это занизило бы выручку лидера в разы. Поэтому просим
    /// максимум и добираем страницы, пока они полные.
    public func incomes(from: String, to: String) async throws -> [OperatorIncome] {
        let pageSize = 5000
        let maxPages = 20 // страховка от бесконечного цикла, если сервер не убывает
        var rows: [OperatorIncome] = []

        for page in 0..<maxPages {
            let response: DataList<OperatorIncome> = try await api.send(
                APIRequest(
                    path: "/api/admin/incomes",
                    query: [
                        "from": from,
                        "to": to,
                        "page": String(page),
                        "page_size": String(pageSize),
                    ]
                )
            )
            rows.append(contentsOf: response.items)
            if response.items.count < pageSize { break }
        }

        return rows
    }
}
