import Foundation
import Testing

@testable import OrdaKit

// ── Рейтинг ──────────────────────────────────────────────────────────────────

@Suite("Рейтинг операторов")
struct OperatorLeaderboardTests {
    private let alice = AnalyticsOperator(id: "a", name: "Алия")
    private let bogdan = AnalyticsOperator(id: "b", name: "Богдан")

    @Test("Выручка — сумма всех четырёх способов оплаты")
    func revenueSumsEveryPaymentColumn() {
        let entries = OperatorLeaderboard.build(
            incomes: [
                OperatorIncome(
                    date: "2026-08-01", operatorID: "a",
                    cashAmount: 1000, kaspiAmount: 2000, onlineAmount: 300, cardAmount: 700
                )
            ],
            operators: [alice]
        )

        #expect(entries.first?.revenue == 4000)
    }

    /// Смена — строка дохода, рабочий день — дата. За один день человек может
    /// закрыть две точки, и путать эти числа нельзя: на смены делят выручку.
    @Test("Две точки за один день — две смены, но один рабочий день")
    func shiftsCountRowsWhileDaysCountDates() throws {
        let entries = OperatorLeaderboard.build(
            incomes: [
                OperatorIncome(date: "2026-08-01", operatorID: "a", companyID: "arena", cashAmount: 60_000),
                OperatorIncome(date: "2026-08-01", operatorID: "a", companyID: "ramen", cashAmount: 40_000),
            ],
            operators: [alice]
        )

        let alia = try #require(entries.first)
        #expect(alia.shifts == 2)
        #expect(alia.days == 1)
        #expect(alia.avgPerShift == 50_000)
    }

    /// Пустая строка дохода — заготовка смены, а не отработанная смена. Если
    /// считать её, средний чек занижается на ровном месте.
    @Test("Нулевая строка не считается сменой")
    func zeroRowIsNotAShift() {
        let entries = OperatorLeaderboard.build(
            incomes: [
                OperatorIncome(date: "2026-08-01", operatorID: "a", cashAmount: 100_000),
                OperatorIncome(date: "2026-08-02", operatorID: "a"),
            ],
            operators: [alice]
        )

        #expect(entries.first?.shifts == 1)
        #expect(entries.first?.revenue == 100_000)
    }

    @Test("Оператор без смен остаётся в списке с нулём")
    func operatorWithoutShiftsStaysInList() {
        let entries = OperatorLeaderboard.build(
            incomes: [OperatorIncome(date: "2026-08-01", operatorID: "a", cashAmount: 100_000)],
            operators: [alice, bogdan]
        )

        #expect(entries.count == 2)
        #expect(entries.last?.operatorID == "b")
        #expect(entries.last?.revenue == 0)
        #expect(entries.last?.avgPerShift == 0)
    }

    @Test("Доли складываются в сто процентов")
    func sharesAddUpToHundred() {
        let entries = OperatorLeaderboard.build(
            incomes: [
                OperatorIncome(date: "2026-08-01", operatorID: "a", cashAmount: 750_000),
                OperatorIncome(date: "2026-08-01", operatorID: "b", cashAmount: 250_000),
            ],
            operators: [alice, bogdan]
        )

        #expect(entries[0].share == 75)
        #expect(entries[1].share == 25)
    }

    @Test("Список отсортирован по убыванию выручки")
    func sortedByRevenueDescending() {
        let entries = OperatorLeaderboard.build(
            incomes: [
                OperatorIncome(date: "2026-08-01", operatorID: "b", cashAmount: 900_000),
                OperatorIncome(date: "2026-08-01", operatorID: "a", cashAmount: 100_000),
            ],
            operators: [alice, bogdan]
        )

        #expect(entries.map(\.operatorID) == ["b", "a"])
    }

    @Test("Изменение к прошлому периоду")
    func changeAgainstPreviousPeriod() {
        let entries = OperatorLeaderboard.build(
            incomes: [OperatorIncome(date: "2026-08-01", operatorID: "a", cashAmount: 120_000)],
            previousIncomes: [OperatorIncome(date: "2026-07-01", operatorID: "a", cashAmount: 100_000)],
            operators: [alice]
        )

        #expect(entries.first?.change == 20)
    }

    /// Рост «с нуля» не бывает процентным: прошлой базы просто нет.
    @Test("Без прошлой выручки изменение не считается")
    func changeIsNilWithoutBase() {
        let entries = OperatorLeaderboard.build(
            incomes: [OperatorIncome(date: "2026-08-01", operatorID: "a", cashAmount: 120_000)],
            operators: [alice]
        )

        #expect(entries.first?.change == nil)
    }

    /// Доход бывает записан на уволенного или переведённого оператора, которого
    /// нет в справочнике. Терять такие деньги нельзя — иначе доли врут.
    @Test("Доход неизвестного оператора не пропадает")
    func unknownOperatorKeepsItsRevenue() throws {
        let entries = OperatorLeaderboard.build(
            incomes: [OperatorIncome(date: "2026-08-01", operatorID: "ghost-1234567", cashAmount: 50_000)],
            operators: [alice]
        )

        let ghost = try #require(entries.first { $0.operatorID == "ghost-1234567" })
        #expect(ghost.revenue == 50_000)
        #expect(ghost.name == "Оператор ghost-")
    }
}

// ── Достижения ───────────────────────────────────────────────────────────────

@Suite("Достижения операторов")
struct OperatorAchievementsTests {
    private let alice = AnalyticsOperator(id: "a", name: "Алия")
    private let bogdan = AnalyticsOperator(id: "b", name: "Богдан")
    private let vera = AnalyticsOperator(id: "v", name: "Вера")

    private func income(_ day: Int, _ operatorID: String, _ amount: Double, company: String = "arena") -> OperatorIncome {
        OperatorIncome(
            date: String(format: "2026-08-%02d", day),
            operatorID: operatorID,
            companyID: company,
            cashAmount: amount
        )
    }

    /// В достижениях «смена» — рабочий день: `incomes` не отдаёт идентификатор
    /// смены, и сайт считает так же. Пороги 20 и 50 выставлены под эту
    /// трактовку, поэтому расхождение с рейтингом здесь намеренное.
    @Test("Смена в достижениях — это рабочий день")
    func shiftsAreWorkingDays() {
        let stats = OperatorAchievements.stats(
            incomes: [
                income(1, "a", 60_000, company: "arena"),
                income(1, "a", 40_000, company: "ramen"),
            ],
            operators: [alice]
        )

        #expect(stats.first?.shifts == 1)
        #expect(stats.first?.avgPerShift == 100_000)
    }

    @Test("Кто не работал — в списке не появляется")
    func peopleWithoutActivityAreHidden() {
        let stats = OperatorAchievements.stats(
            incomes: [income(1, "a", 100_000)],
            operators: [alice, bogdan]
        )

        #expect(stats.map(\.operatorID) == ["a"])
    }

    @Test("Первый по выручке — чемпион, второй и третий — призёры")
    func rankAchievements() {
        let stats = OperatorAchievements.stats(
            incomes: [
                income(1, "a", 300_000),
                income(1, "b", 200_000),
                income(1, "v", 100_000),
            ],
            operators: [alice, bogdan, vera]
        )
        let results = OperatorAchievements.compute(stats)

        #expect(results[0].earned.contains(.champion))
        #expect(!results[0].earned.contains(.top3))
        #expect(results[1].earned.contains(.top3))
        #expect(results[2].earned.contains(.top3))
        #expect(!results[2].earned.contains(.champion))
    }

    @Test("Миллион выручки даёт «Миллионера», но не «Мега»")
    func revenueThresholds() {
        let stats = OperatorAchievements.stats(
            incomes: [income(1, "a", 1_000_000)],
            operators: [alice]
        )
        let earned = OperatorAchievements.compute(stats)[0].earned

        #expect(earned.contains(.millionaire))
        #expect(!earned.contains(.mega))
    }

    @Test("Двадцать рабочих дней делают марафонцем")
    func marathonerThreshold() {
        let stats = OperatorAchievements.stats(
            incomes: (1...20).map { income($0, "a", 10_000) },
            operators: [alice]
        )
        let result = OperatorAchievements.compute(stats)[0]

        #expect(result.stat.shifts == 20)
        #expect(result.earned.contains(.marathoner))
        #expect(!result.earned.contains(.iron))
    }

    /// «Премиум-кассир» — единственное достижение, которое зависит от того, как
    /// сработали остальные. Проверяем обе стороны сравнения.
    @Test("Премиум-кассир: средний чек на 30 % выше общего и не меньше пяти смен")
    func premiumCashier() {
        let stats = OperatorAchievements.stats(
            incomes: (1...5).flatMap { day in
                [income(day, "a", 100_000), income(day, "b", 20_000)]
            },
            operators: [alice, bogdan]
        )
        let results = OperatorAchievements.compute(stats)

        // Средний чек по работавшим = (100 000 + 20 000) / 2 = 60 000.
        #expect(results[0].earned.contains(.premium))
        #expect(!results[1].earned.contains(.premium))
    }

    @Test("Меньше пяти смен — премиум-кассиром не стать")
    func premiumNeedsFiveShifts() {
        let stats = OperatorAchievements.stats(
            incomes: [
                income(1, "a", 400_000),
                income(1, "b", 20_000), income(2, "b", 20_000), income(3, "b", 20_000),
            ],
            operators: [alice, bogdan]
        )
        let results = OperatorAchievements.compute(stats)

        #expect(results[0].stat.shifts == 1)
        #expect(!results[0].earned.contains(.premium))
    }

    @Test("Доля больше двадцати процентов делает тяжеловесом")
    func majorShare() {
        let stats = OperatorAchievements.stats(
            incomes: [income(1, "a", 800_000), income(1, "b", 200_000)],
            operators: [alice, bogdan]
        )
        let results = OperatorAchievements.compute(stats)

        #expect(results[0].earned.contains(.major))
        #expect(results[1].earned.contains(.major)) // ровно 20 % — порог включительный
    }

    @Test("Полученное и недостающее вместе дают весь каталог")
    func earnedAndLockedCoverCatalog() {
        let stats = OperatorAchievements.stats(incomes: [income(1, "a", 100_000)], operators: [alice])
        let result = OperatorAchievements.compute(stats)[0]

        #expect(result.earned.count + result.locked.count == OperatorAchievement.allCases.count)
        #expect(Set(result.earned).isDisjoint(with: Set(result.locked)))
    }

    /// Место в рейтинге и сравнение со средним чеком зависят от остальных
    /// людей, поэтому полоска прогресса там врала бы.
    @Test("У ранговых достижений прогресса нет")
    func rankAchievementsHaveNoProgress() {
        let stat = AchievementStat(
            operatorID: "a", name: "Алия", photoURL: nil,
            revenue: 500_000, shifts: 10, avgPerShift: 50_000, share: 40
        )

        #expect(OperatorAchievement.champion.progress(for: stat) == nil)
        #expect(OperatorAchievement.top3.progress(for: stat) == nil)
        #expect(OperatorAchievement.premium.progress(for: stat) == nil)
        #expect(OperatorAchievement.millionaire.progress(for: stat)?.ratio == 0.5)
    }

    @Test("Сводка считает, сколько человек получило каждое достижение")
    func summaryCountsHolders() {
        let stats = OperatorAchievements.stats(
            incomes: [income(1, "a", 300_000), income(1, "b", 200_000)],
            operators: [alice, bogdan]
        )
        let summary = OperatorAchievements.summary(OperatorAchievements.compute(stats))

        #expect(summary[.champion] == 1)
        #expect(summary[.top3] == 1)
        #expect(summary[.iron] == 0)
    }
}

// ── Периоды ──────────────────────────────────────────────────────────────────

@Suite("Периоды разделов по людям")
struct PeoplePeriodTests {
    /// Середина месяца — чтобы сдвиг часового пояса на тестовой машине не
    /// перебросил дату на соседний месяц или неделю.
    private let wednesday = DateParsing.parseDateOnly("2026-01-14")!

    @Test("Неделя — с понедельника по воскресенье")
    func weekBounds() {
        let bounds = PeoplePeriod.thisWeek.bounds(now: wednesday)
        #expect(bounds.from == "2026-01-12")
        #expect(bounds.to == "2026-01-18")
    }

    @Test("Прошлая неделя вплотную предшествует текущей")
    func lastWeekBounds() {
        let bounds = PeoplePeriod.lastWeek.bounds(now: wednesday)
        #expect(bounds.from == "2026-01-05")
        #expect(bounds.to == "2026-01-11")
    }

    @Test("Месяц — календарный, целиком")
    func monthBounds() {
        let bounds = PeoplePeriod.thisMonth.bounds(now: wednesday)
        #expect(bounds.from == "2026-01-01")
        #expect(bounds.to == "2026-01-31")
    }

    /// Январь — единственное место, где «прошлый месяц» меняет год.
    @Test("Прошлый месяц в январе уезжает в прошлый год")
    func lastMonthCrossesYear() {
        let bounds = PeoplePeriod.lastMonth.bounds(now: wednesday)
        #expect(bounds.from == "2025-12-01")
        #expect(bounds.to == "2025-12-31")
    }

    @Test("Год — с первого января по тридцать первое декабря")
    func yearBounds() {
        let bounds = PeoplePeriod.thisYear.bounds(now: wednesday)
        #expect(bounds.from == "2026-01-01")
        #expect(bounds.to == "2026-12-31")
    }

    @Test("Прошлый период равен текущему по длине и стоит вплотную перед ним")
    func previousPeriodMatchesLength() {
        let month = PeoplePeriod.previous(from: "2026-08-01", to: "2026-08-31")
        #expect(month.from == "2026-07-01")
        #expect(month.to == "2026-07-31")

        let week = PeoplePeriod.previous(from: "2026-08-03", to: "2026-08-09")
        #expect(week.from == "2026-07-27")
        #expect(week.to == "2026-08-02")
    }

    @Test("Однодневный период сдвигается на день назад")
    func previousOfSingleDay() {
        let bounds = PeoplePeriod.previous(from: "2026-03-01", to: "2026-03-01")
        #expect(bounds.from == "2026-02-28")
        #expect(bounds.to == "2026-02-28")
    }
}

// ── Эффективность (PI) ───────────────────────────────────────────────────────

@Suite("Эффективность (PI)")
struct PerformanceRankingTests {
    /// Приложение не считает PI — оно его показывает. Единственное, что здесь
    /// может сломаться, это разбор ответа и производные от него величины.
    private let payload = """
    {
      "data": {
        "ranking": [
          {
            "operator_id": "a",
            "operator_name": "Алия Кабдешева",
            "operator_short_name": "Алия К.",
            "shifts": 2,
            "total_revenue": 260000,
            "avg_revenue_per_shift": 130000,
            "pi": 1.184,
            "qualifying": true,
            "shift_details": [
              { "date": "2026-08-01", "shift": "day", "company_id": "arena",
                "actual": 140000, "expected": 120000, "pi": 1.167, "source": "slot (LOO)" },
              { "date": "2026-08-02", "shift": "night", "company_id": "arena",
                "actual": 120000, "expected": 100000, "pi": 1.2, "source": "company-shift (LOO)" }
            ]
          },
          {
            "operator_id": "b",
            "operator_name": "Богдан",
            "operator_short_name": null,
            "shifts": 1,
            "total_revenue": 50000,
            "avg_revenue_per_shift": 50000,
            "pi": 0.5,
            "qualifying": false,
            "shift_details": []
          }
        ],
        "baseline": { "from": "2025-01-01", "to": "2026-07-31", "shifts_count": 812, "slots_count": 42, "global_median": 98000 },
        "period": { "from": "2026-08-01", "to": "2026-08-31" },
        "config": { "min_qualifying_shifts": 3, "pi_clip": [0.5, 2.0] }
      }
    }
    """

    private func decode() throws -> PerformanceRanking {
        let data = Data(payload.utf8)
        return try JSONDecoder().decode(Envelope<PerformanceRanking>.self, from: data).data
    }

    @Test("Ответ роута разбирается целиком")
    func decodesRoutePayload() throws {
        let report = try decode()

        #expect(report.ranking.count == 2)
        #expect(report.minQualifyingShifts == 3)
        #expect(report.baseline.shiftsCount == 812)
        #expect(report.baseline.globalMedian == 98_000)
    }

    /// Сверх нормы — деньги, а не проценты: именно эту сумму владелец кладёт в
    /// основание премии.
    @Test("Сверх нормы = выручка минус сумма норм по сменам")
    func aboveNormIsMoney() throws {
        let leader = try #require(decode().ranking.first)
        #expect(leader.expectedTotal == 220_000)
        #expect(leader.aboveNorm == 40_000)
    }

    @Test("Оценка PI совпадает с границами сайта")
    func gradeMatchesWeb() {
        #expect(PerformanceGrade(pi: 1.20) == .excellent)
        #expect(PerformanceGrade(pi: 1.15) == .excellent)
        #expect(PerformanceGrade(pi: 1.05) == .good)
        #expect(PerformanceGrade(pi: 1.00) == .norm)
        #expect(PerformanceGrade(pi: 0.95) == .norm)
        #expect(PerformanceGrade(pi: 0.90) == .below)
        #expect(PerformanceGrade(pi: 0.70) == .weak)
    }

    @Test("В рейтинг идут только те, у кого хватает смен")
    func qualifiedSeparatedFromColdStart() throws {
        let report = try decode()
        #expect(report.qualified.map(\.operatorID) == ["a"])
        #expect(report.coldStart.map(\.operatorID) == ["b"])
        #expect(report.averagePI == 1.184)
    }

    /// PI, упёршийся в границу клипа, — почти всегда битые данные, а не рекорд.
    @Test("Смена на границе клипа помечается")
    func clippedShiftIsFlagged() {
        let normal = PerformanceShift(
            date: "2026-08-01", shift: "day", companyID: "arena",
            actual: 140_000, expected: 120_000, pi: 1.167, source: "slot"
        )
        let clipped = PerformanceShift(
            date: "2026-08-02", shift: "day", companyID: "arena",
            actual: 900_000, expected: 100_000, pi: 2.0, source: "slot"
        )

        #expect(!normal.isClipped)
        #expect(clipped.isClipped)
    }

    @Test("Короткое имя предпочтительнее полного")
    func shortNameWins() throws {
        let report = try decode()
        #expect(report.ranking[0].displayName == "Алия К.")
        #expect(report.ranking[1].displayName == "Богдан")
    }
}
