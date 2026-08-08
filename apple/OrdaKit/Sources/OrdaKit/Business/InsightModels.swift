import Foundation

// ── Общее для AI-разделов ────────────────────────────────────────────────────

/// Карточка разбора «вывод → причина → действие».
///
/// Единая форма для всех AI-роутов: расходы и команда отдают ровно её,
/// а финдиректор — её же по частям. Один тип вместо трёх похожих избавляет
/// экраны от копий одной и той же вёрстки.
public struct AiInsight: Decodable, Sendable, Identifiable, Hashable {
    public let id = UUID()
    public let verdict: String
    public let reason: String
    public let action: String
    public let severity: String

    /// Насколько это тревожно. Модель обещает `high|medium|low`, но за словами
    /// из чужого ответа не следим строго — незнакомое считаем «средним».
    public var isCritical: Bool { severity == "high" }
    public var isPositive: Bool { severity == "low" }

    public var severityLabel: String {
        switch severity {
        case "high": "Требует решения"
        case "low": "Хорошая новость"
        default: "Стоит улучшить"
        }
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        verdict = try c.decodeFlexibleString(forKey: .verdict) ?? ""
        reason = try c.decodeFlexibleString(forKey: .reason) ?? ""
        action = try c.decodeFlexibleString(forKey: .action) ?? ""
        severity = try c.decodeFlexibleString(forKey: .severity) ?? "medium"
    }

    private enum CodingKeys: String, CodingKey { case verdict, reason, action, severity }
}

/// Разбор ответа модели в блоки текста.
///
/// Модель пишет по-разному: прогноз просят в Markdown с заголовками `##`
/// и `**жирным**`, короткий вывод — простым текстом, а часть контента
/// приходит из веб-редактора в HTML. Показывать `**` и `<p>` пользователю
/// нельзя, поэтому приводим всё к тем же блокам, что и `RichText`.
public enum InsightMarkdown {

    /// Разобрать ответ модели. Формат определяем сами: HTML отдаём `RichText`,
    /// остальное считаем Markdown.
    public static func blocks(from text: String?) -> [RichText.Block] {
        guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return [] }
        if looksLikeHTML(text) { return RichText.blocks(from: text) }

        return text
            .components(separatedBy: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .compactMap(block(from:))
    }

    /// Плоский текст — для превью и поделиться.
    public static func plain(from text: String?) -> String {
        blocks(from: text).map(\.text).joined(separator: "\n")
    }

    private static func looksLikeHTML(_ text: String) -> Bool {
        text.range(of: #"<(p|div|br|ul|ol|li|h[1-6]|blockquote|strong|em)\b[^>]*>"#,
                   options: [.regularExpression, .caseInsensitive]) != nil
    }

    private static func block(from line: String) -> RichText.Block? {
        if line.isEmpty { return nil }
        // Горизонтальная линейка ничего не сообщает без вёрстки вокруг.
        if line.allSatisfy({ $0 == "-" || $0 == "*" || $0 == "_" }), line.count >= 3 { return nil }

        if line.hasPrefix("#") {
            let title = inline(line.drop(while: { $0 == "#" }))
            return title.isEmpty ? nil : RichText.Block(kind: .heading, text: title)
        }
        if line.hasPrefix(">") {
            let quote = inline(line.dropFirst())
            return quote.isEmpty ? nil : RichText.Block(kind: .quote, text: quote)
        }
        if let bullet = bulletBody(line) {
            let item = inline(bullet)
            return item.isEmpty ? nil : RichText.Block(kind: .listItem, text: item)
        }
        // Строка целиком в `**` — это подзаголовок раздела, а не абзац.
        if line.hasPrefix("**"), line.hasSuffix("**"), line.count > 4 {
            let title = inline(line.dropFirst(2).dropLast(2))
            return title.isEmpty ? nil : RichText.Block(kind: .heading, text: title)
        }

        let paragraph = inline(line[...])
        return paragraph.isEmpty ? nil : RichText.Block(kind: .paragraph, text: paragraph)
    }

    /// Тело пункта списка, если строка им является: `- `, `* `, `• `, `1. `.
    private static func bulletBody(_ line: String) -> Substring? {
        for marker in ["- ", "* ", "+ ", "• ", "– ", "— "] where line.hasPrefix(marker) {
            return line.dropFirst(marker.count)
        }
        // Нумерованный пункт: цифры, затем точка или скобка.
        let digits = line.prefix(while: \.isNumber)
        guard !digits.isEmpty, digits.count <= 2 else { return nil }
        let rest = line.dropFirst(digits.count)
        guard rest.hasPrefix(". ") || rest.hasPrefix(") ") else { return nil }
        return rest.dropFirst(2)
    }

    /// Снять внутристрочную разметку. Оставлять `**` нельзя, а тащить ради
    /// жирного шрифта разметку в SwiftUI — несоразмерно: смысл в словах.
    private static func inline(_ text: Substring) -> String {
        var result = String(text)
        for marker in ["**", "__", "`", "~~"] {
            result = result.replacingOccurrences(of: marker, with: "")
        }
        return result.trimmingCharacters(in: .whitespaces)
    }
}

// ── AI Разбор: /api/admin/monthly-forecast ───────────────────────────────────

/// Месяц истории в прогнозе: факт, а не предсказание.
public struct ForecastMonth: Decodable, Sendable, Identifiable, Hashable {
    public let month: String
    public let income: Double
    public let fixed: Double
    public let variable: Double
    public let oneOff: Double
    public let expense: Double
    public let profit: Double
    public let marginPct: Double
    /// Текущий месяц ещё не закончился — сравнивать его с полными нельзя.
    public let isPartial: Bool

    public var id: String { month }

    public var date: Date? { DateParsing.parseDateOnly("\(month)-01") }

    /// `2026-08` → `авг 26`.
    public var shortLabel: String {
        guard let date else { return month }
        return date.formatted(.dateTime.month(.abbreviated).year(.twoDigits))
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        month = try c.decodeFlexibleString(forKey: .month) ?? ""
        income = try c.decodeFlexibleDouble(forKey: .income) ?? 0
        fixed = try c.decodeFlexibleDouble(forKey: .fixed) ?? 0
        variable = try c.decodeFlexibleDouble(forKey: .variable) ?? 0
        oneOff = try c.decodeFlexibleDouble(forKey: .oneOff) ?? 0
        expense = try c.decodeFlexibleDouble(forKey: .expense) ?? 0
        profit = try c.decodeFlexibleDouble(forKey: .profit) ?? 0
        marginPct = try c.decodeFlexibleDouble(forKey: .marginPct) ?? 0
        isPartial = ((try? c.decodeIfPresent(Bool.self, forKey: .isPartial)) ?? nil) ?? false
    }

    private enum CodingKeys: String, CodingKey {
        case month, income, fixed, variable, oneOff, expense, profit, marginPct, isPartial
    }
}

/// Ожидаемый доход следующего месяца с вилкой и объяснением, откуда он взялся.
public struct ForecastIncomeOutlook: Decodable, Sendable, Hashable {
    public let expected: Double
    public let low: Double
    public let high: Double
    public let recentAvg: Double
    public let momGrowthPct: Double
    public let seasonalIndex: Double

    public static let zero = ForecastIncomeOutlook(
        expected: 0, low: 0, high: 0, recentAvg: 0, momGrowthPct: 0, seasonalIndex: 1
    )

    public init(expected: Double, low: Double, high: Double, recentAvg: Double, momGrowthPct: Double, seasonalIndex: Double) {
        self.expected = expected
        self.low = low
        self.high = high
        self.recentAvg = recentAvg
        self.momGrowthPct = momGrowthPct
        self.seasonalIndex = seasonalIndex
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        expected = try c.decodeFlexibleDouble(forKey: .expected) ?? 0
        low = try c.decodeFlexibleDouble(forKey: .low) ?? 0
        high = try c.decodeFlexibleDouble(forKey: .high) ?? 0
        recentAvg = try c.decodeFlexibleDouble(forKey: .recentAvg) ?? 0
        momGrowthPct = try c.decodeFlexibleDouble(forKey: .momGrowthPct) ?? 0
        seasonalIndex = try c.decodeFlexibleDouble(forKey: .seasonalIndex) ?? 1
    }

    private enum CodingKeys: String, CodingKey {
        case expected, low, high, recentAvg, momGrowthPct, seasonalIndex
    }
}

/// Ожидаемый расход, разложенный на постоянную и переменную часть.
public struct ForecastExpenseOutlook: Decodable, Sendable, Hashable {
    public let expected: Double
    public let fixed: Double
    public let variable: Double
    public let variableRatePct: Double
    /// Разовые траты в прогноз не входят — но забывать о них нельзя.
    public let oneOffAvg: Double

    public static let zero = ForecastExpenseOutlook(
        expected: 0, fixed: 0, variable: 0, variableRatePct: 0, oneOffAvg: 0
    )

    public init(expected: Double, fixed: Double, variable: Double, variableRatePct: Double, oneOffAvg: Double) {
        self.expected = expected
        self.fixed = fixed
        self.variable = variable
        self.variableRatePct = variableRatePct
        self.oneOffAvg = oneOffAvg
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        expected = try c.decodeFlexibleDouble(forKey: .expected) ?? 0
        fixed = try c.decodeFlexibleDouble(forKey: .fixed) ?? 0
        variable = try c.decodeFlexibleDouble(forKey: .variable) ?? 0
        variableRatePct = try c.decodeFlexibleDouble(forKey: .variableRatePct) ?? 0
        oneOffAvg = try c.decodeFlexibleDouble(forKey: .oneOffAvg) ?? 0
    }

    private enum CodingKeys: String, CodingKey {
        case expected, fixed, variable, variableRatePct, oneOffAvg
    }
}

/// Ожидаемая прибыль с вилкой.
public struct ForecastProfitOutlook: Decodable, Sendable, Hashable {
    public let expected: Double
    public let low: Double
    public let high: Double
    public let marginPct: Double

    public static let zero = ForecastProfitOutlook(expected: 0, low: 0, high: 0, marginPct: 0)

    public init(expected: Double, low: Double, high: Double, marginPct: Double) {
        self.expected = expected
        self.low = low
        self.high = high
        self.marginPct = marginPct
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        expected = try c.decodeFlexibleDouble(forKey: .expected) ?? 0
        low = try c.decodeFlexibleDouble(forKey: .low) ?? 0
        high = try c.decodeFlexibleDouble(forKey: .high) ?? 0
        marginPct = try c.decodeFlexibleDouble(forKey: .marginPct) ?? 0
    }

    private enum CodingKeys: String, CodingKey { case expected, low, high, marginPct }
}

/// Три сценария прибыли на следующий месяц.
public struct ForecastScenarioSet: Decodable, Sendable, Hashable {
    public let best: Double
    public let expected: Double
    public let worst: Double

    public static let zero = ForecastScenarioSet(best: 0, expected: 0, worst: 0)

    public init(best: Double, expected: Double, worst: Double) {
        self.best = best
        self.expected = expected
        self.worst = worst
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        best = try c.decodeFlexibleDouble(forKey: .best) ?? 0
        expected = try c.decodeFlexibleDouble(forKey: .expected) ?? 0
        worst = try c.decodeFlexibleDouble(forKey: .worst) ?? 0
    }

    private enum CodingKeys: String, CodingKey { case best, expected, worst }
}

/// Точка безубыточности и запас прочности.
public struct ForecastBreakeven: Decodable, Sendable, Hashable {
    public let revenue: Double
    public let safetyMarginPct: Double

    public static let zero = ForecastBreakeven(revenue: 0, safetyMarginPct: 0)

    public init(revenue: Double, safetyMarginPct: Double) {
        self.revenue = revenue
        self.safetyMarginPct = safetyMarginPct
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        revenue = try c.decodeFlexibleDouble(forKey: .revenue) ?? 0
        safetyMarginPct = try c.decodeFlexibleDouble(forKey: .safetyMarginPct) ?? 0
    }

    private enum CodingKeys: String, CodingKey { case revenue, safetyMarginPct }
}

/// Как идёт текущий, ещё не закрытый месяц.
public struct ForecastCurrentMonth: Decodable, Sendable, Hashable {
    public let month: String
    public let factToDate: Double
    public let projected: Double?
    public let dayOfMonth: Int
    public let daysInMonth: Int

    /// Доля месяца, которая уже прошла — по ней видно, рано ли делать выводы.
    public var elapsedRatio: Double {
        daysInMonth > 0 ? Double(dayOfMonth) / Double(daysInMonth) : 0
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        month = try c.decodeFlexibleString(forKey: .month) ?? ""
        factToDate = try c.decodeFlexibleDouble(forKey: .factToDate) ?? 0
        projected = try c.decodeFlexibleDouble(forKey: .projected)
        dayOfMonth = Int(try c.decodeFlexibleDouble(forKey: .dayOfMonth) ?? 0)
        daysInMonth = Int(try c.decodeFlexibleDouble(forKey: .daysInMonth) ?? 0)
    }

    private enum CodingKeys: String, CodingKey {
        case month, factToDate, projected, dayOfMonth, daysInMonth
    }
}

/// Проверка модели на прошлом месяце: что предсказали и что вышло.
///
/// Самое честное, что есть в прогнозе: без неё «ожидаемый доход» — просто
/// красивое число.
public struct ForecastBacktest: Decodable, Sendable, Hashable {
    public let month: String
    public let predictedIncome: Double
    public let actualIncome: Double
    public let incomeErrorPct: Double

    public var isAccurate: Bool { abs(incomeErrorPct) <= 10 }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        month = try c.decodeFlexibleString(forKey: .month) ?? ""
        predictedIncome = try c.decodeFlexibleDouble(forKey: .predictedIncome) ?? 0
        actualIncome = try c.decodeFlexibleDouble(forKey: .actualIncome) ?? 0
        incomeErrorPct = try c.decodeFlexibleDouble(forKey: .incomeErrorPct) ?? 0
    }

    private enum CodingKeys: String, CodingKey {
        case month, predictedIncome, actualIncome, incomeErrorPct
    }
}

/// Расход по группе учёта с пометкой «постоянный / переменный».
public struct ForecastGroupExpense: Decodable, Sendable, Identifiable, Hashable {
    public let group: String
    public let label: String
    public let amount: Double
    public let bucket: String

    public var id: String { group }
    public var isFixed: Bool { bucket == "fixed" }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        group = try c.decodeFlexibleString(forKey: .group) ?? UUID().uuidString
        label = try c.decodeFlexibleString(forKey: .label) ?? ""
        amount = try c.decodeFlexibleDouble(forKey: .amount) ?? 0
        bucket = try c.decodeFlexibleString(forKey: .bucket) ?? "fixed"
    }

    private enum CodingKeys: String, CodingKey { case group, label, amount, bucket }
}

/// Насколько прогнозу можно верить.
public struct ForecastConfidence: Decodable, Sendable, Hashable {
    public let score: Int
    public let monthsOfData: Int
    public let seasonalityAvailable: Bool
    public let volatilityPct: Double
    public let notes: [String]

    public static let unknown = ForecastConfidence(
        score: 0, monthsOfData: 0, seasonalityAvailable: false, volatilityPct: 0, notes: []
    )

    public init(score: Int, monthsOfData: Int, seasonalityAvailable: Bool, volatilityPct: Double, notes: [String]) {
        self.score = score
        self.monthsOfData = monthsOfData
        self.seasonalityAvailable = seasonalityAvailable
        self.volatilityPct = volatilityPct
        self.notes = notes
    }

    public var label: String {
        switch score {
        case 75...: "Высокая"
        case 45..<75: "Средняя"
        default: "Низкая"
        }
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        score = Int(try c.decodeFlexibleDouble(forKey: .score) ?? 0)
        monthsOfData = Int(try c.decodeFlexibleDouble(forKey: .monthsOfData) ?? 0)
        seasonalityAvailable = ((try? c.decodeIfPresent(Bool.self, forKey: .seasonalityAvailable)) ?? nil) ?? false
        volatilityPct = try c.decodeFlexibleDouble(forKey: .volatilityPct) ?? 0
        notes = ((try? c.decodeIfPresent([String].self, forKey: .notes)) ?? nil) ?? []
    }

    private enum CodingKeys: String, CodingKey {
        case score, monthsOfData, seasonalityAvailable, volatilityPct, notes
    }
}

/// Прогноз на следующий месяц целиком — то, что считает сервер без всякого ИИ.
public struct MonthlyForecastReport: Decodable, Sendable {
    public let months: [ForecastMonth]
    public let targetMonth: String
    public let targetMonthLabel: String
    public let income: ForecastIncomeOutlook
    public let expense: ForecastExpenseOutlook
    public let profit: ForecastProfitOutlook
    public let scenarios: ForecastScenarioSet
    public let breakeven: ForecastBreakeven
    public let current: ForecastCurrentMonth?
    public let backtest: ForecastBacktest?
    public let expenseByGroup: [ForecastGroupExpense]
    public let explanation: [String]
    public let confidence: ForecastConfidence

    /// Полные месяцы — по частичному сравнивать нельзя, он ещё не закончился.
    public var completeMonths: [ForecastMonth] {
        months.filter { !$0.isPartial && $0.income > 0 }
    }

    public var fixedExpenses: [ForecastGroupExpense] {
        expenseByGroup.filter(\.isFixed).sorted { $0.amount > $1.amount }
    }

    public var variableExpenses: [ForecastGroupExpense] {
        expenseByGroup.filter { !$0.isFixed }.sorted { $0.amount > $1.amount }
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        months = ((try? c.decodeIfPresent([ForecastMonth].self, forKey: .months)) ?? nil) ?? []
        targetMonth = try c.decodeFlexibleString(forKey: .targetMonth) ?? ""
        targetMonthLabel = try c.decodeFlexibleString(forKey: .targetMonthLabel) ?? ""
        income = ((try? c.decodeIfPresent(ForecastIncomeOutlook.self, forKey: .income)) ?? nil) ?? .zero
        expense = ((try? c.decodeIfPresent(ForecastExpenseOutlook.self, forKey: .expense)) ?? nil) ?? .zero
        profit = ((try? c.decodeIfPresent(ForecastProfitOutlook.self, forKey: .profit)) ?? nil) ?? .zero
        scenarios = ((try? c.decodeIfPresent(ForecastScenarioSet.self, forKey: .scenarios)) ?? nil) ?? .zero
        breakeven = ((try? c.decodeIfPresent(ForecastBreakeven.self, forKey: .breakeven)) ?? nil) ?? .zero
        current = (try? c.decodeIfPresent(ForecastCurrentMonth.self, forKey: .current)) ?? nil
        backtest = (try? c.decodeIfPresent(ForecastBacktest.self, forKey: .backtest)) ?? nil
        expenseByGroup = ((try? c.decodeIfPresent([ForecastGroupExpense].self, forKey: .expenseByGroup)) ?? nil) ?? []
        explanation = ((try? c.decodeIfPresent([String].self, forKey: .explanation)) ?? nil) ?? []
        confidence = ((try? c.decodeIfPresent(ForecastConfidence.self, forKey: .confidence)) ?? nil) ?? .unknown
    }

    private enum CodingKeys: String, CodingKey {
        case months, targetMonth, targetMonthLabel, income, expense, profit
        case scenarios, breakeven, current, backtest, expenseByGroup, explanation, confidence
    }
}

/// Прогноз по отдельной точке — для сравнения, когда точек несколько.
public struct ForecastCompanyRow: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let income: Double
    public let expense: Double
    public let profit: Double
    public let marginPct: Double

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        name = try c.decodeFlexibleString(forKey: .name) ?? "—"
        income = try c.decodeFlexibleDouble(forKey: .income) ?? 0
        expense = try c.decodeFlexibleDouble(forKey: .expense) ?? 0
        profit = try c.decodeFlexibleDouble(forKey: .profit) ?? 0
        marginPct = try c.decodeFlexibleDouble(forKey: .marginPct) ?? 0
    }

    private enum CodingKeys: String, CodingKey { case id, name, income, expense, profit, marginPct }
}

/// Ответ `GET /api/admin/monthly-forecast`.
public struct MonthlyForecastBundle: Decodable, Sendable {
    public let forecast: MonthlyForecastReport
    public let byCompany: [ForecastCompanyRow]

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        forecast = try c.decode(MonthlyForecastReport.self, forKey: .forecast)
        byCompany = ((try? c.decodeIfPresent([ForecastCompanyRow].self, forKey: .byCompany)) ?? nil) ?? []
    }

    private enum CodingKeys: String, CodingKey { case forecast, byCompany }
}

/// Тело `POST /api/admin/monthly-forecast/ai`.
///
/// Сервер читает из прогноза строго определённые поля и по ним формирует
/// промпт. Пересобираем именно их, а не весь ответ: так видно, что уходит
/// в модель, и лишние данные не покидают устройство.
public struct MonthlyForecastAiRequest: Encodable, Sendable {
    public let targetMonthLabel: String
    public let income: Income
    public let expense: Expense
    public let profit: Profit
    public let scenarios: Scenarios
    public let confidence: Confidence

    public struct Income: Encodable, Sendable {
        public let expected: Double
        public let low: Double
        public let high: Double
        public let recentAvg: Double
        public let momGrowthPct: Double
        public let seasonalIndex: Double
    }

    public struct Expense: Encodable, Sendable {
        public let expected: Double
        public let fixed: Double
        public let variable: Double
        public let variableRatePct: Double
        public let oneOffAvg: Double
    }

    public struct Profit: Encodable, Sendable {
        public let expected: Double
    }

    public struct Scenarios: Encodable, Sendable {
        public let best: Double
        public let worst: Double
    }

    public struct Confidence: Encodable, Sendable {
        public let score: Int
        public let monthsOfData: Int
        public let seasonalityAvailable: Bool
        public let volatilityPct: Double
    }

    public init(report: MonthlyForecastReport) {
        targetMonthLabel = report.targetMonthLabel
        income = Income(
            expected: report.income.expected,
            low: report.income.low,
            high: report.income.high,
            recentAvg: report.income.recentAvg,
            momGrowthPct: report.income.momGrowthPct,
            seasonalIndex: report.income.seasonalIndex
        )
        expense = Expense(
            expected: report.expense.expected,
            fixed: report.expense.fixed,
            variable: report.expense.variable,
            variableRatePct: report.expense.variableRatePct,
            oneOffAvg: report.expense.oneOffAvg
        )
        profit = Profit(expected: report.profit.expected)
        scenarios = Scenarios(best: report.scenarios.best, worst: report.scenarios.worst)
        confidence = Confidence(
            score: report.confidence.score,
            monthsOfData: report.confidence.monthsOfData,
            seasonalityAvailable: report.confidence.seasonalityAvailable,
            volatilityPct: report.confidence.volatilityPct
        )
    }
}

// ── AI Прогноз: /api/ai/forecast ─────────────────────────────────────────────

/// Прогноз на три месяца вперёд. Сервер отдаёт и месяцы, и «недельные»
/// поля `week4/8/13` — это те же месяцы под старыми именами.
public struct AiForecastProjection: Decodable, Sendable, Hashable {
    public let month0Label: String
    public let month0Income: Double
    public let month0Expense: Double
    public let month0FactIncome: Double
    public let month0RemainingDays: Int

    public let month1Label: String
    public let month1Income: Double
    public let month1Expense: Double

    public let month2Label: String
    public let month2Income: Double
    public let month2Expense: Double

    public static let zero = AiForecastProjection()

    public init() {
        month0Label = ""
        month0Income = 0
        month0Expense = 0
        month0FactIncome = 0
        month0RemainingDays = 0
        month1Label = ""
        month1Income = 0
        month1Expense = 0
        month2Label = ""
        month2Income = 0
        month2Expense = 0
    }

    public var month0Profit: Double { month0Income - month0Expense }
    public var month1Profit: Double { month1Income - month1Expense }
    public var month2Profit: Double { month2Income - month2Expense }

    private struct MonthFact: Decodable { let income: Double?; let expense: Double? }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        month0Label = try c.decodeFlexibleString(forKey: .month0Label) ?? ""
        month0Income = try c.decodeFlexibleDouble(forKey: .month0Income) ?? 0
        month0Expense = try c.decodeFlexibleDouble(forKey: .month0Expense) ?? 0
        let fact = (try? c.decodeIfPresent(MonthFact.self, forKey: .month0Fact)) ?? nil
        month0FactIncome = fact?.income ?? 0
        month0RemainingDays = Int(try c.decodeFlexibleDouble(forKey: .month0RemainingDays) ?? 0)
        month1Label = try c.decodeFlexibleString(forKey: .month1Label) ?? ""
        month1Income = try c.decodeFlexibleDouble(forKey: .month1Income) ?? 0
        month1Expense = try c.decodeFlexibleDouble(forKey: .month1Expense) ?? 0
        month2Label = try c.decodeFlexibleString(forKey: .month2Label) ?? ""
        month2Income = try c.decodeFlexibleDouble(forKey: .month2Income) ?? 0
        month2Expense = try c.decodeFlexibleDouble(forKey: .month2Expense) ?? 0
    }

    private enum CodingKeys: String, CodingKey {
        case month0Label, month0Income, month0Expense, month0Fact, month0RemainingDays
        case month1Label, month1Income, month1Expense
        case month2Label, month2Income, month2Expense
    }
}

/// Итоги 30-дневного окна — для сравнения «сейчас против прошлого месяца».
public struct AiForecastPeriodTotals: Decodable, Sendable, Hashable {
    public let income: Double
    public let expense: Double
    public let profit: Double
    public let margin: Double

    public static let zero = AiForecastPeriodTotals(income: 0, expense: 0, profit: 0, margin: 0)

    public init(income: Double, expense: Double, profit: Double, margin: Double) {
        self.income = income
        self.expense = expense
        self.profit = profit
        self.margin = margin
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        income = try c.decodeFlexibleDouble(forKey: .income) ?? 0
        expense = try c.decodeFlexibleDouble(forKey: .expense) ?? 0
        profit = try c.decodeFlexibleDouble(forKey: .profit) ?? 0
        margin = try c.decodeFlexibleDouble(forKey: .margin) ?? 0
    }

    private enum CodingKeys: String, CodingKey { case income, expense, profit, margin }
}

/// Разгон или торможение: последние 30 дней против предыдущих 30.
public struct AiForecastComparison: Decodable, Sendable, Hashable {
    public let last30: AiForecastPeriodTotals
    public let prev30: AiForecastPeriodTotals
    public let incomeMomentum: Double
    public let expenseMomentum: Double
    public let profitMomentum: Double

    public static let zero = AiForecastComparison()

    public init() {
        last30 = .zero
        prev30 = .zero
        incomeMomentum = 0
        expenseMomentum = 0
        profitMomentum = 0
    }

    private struct Momentum: Decodable {
        let income: Double?
        let expense: Double?
        let profit: Double?
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        last30 = ((try? c.decodeIfPresent(AiForecastPeriodTotals.self, forKey: .last30)) ?? nil) ?? .zero
        prev30 = ((try? c.decodeIfPresent(AiForecastPeriodTotals.self, forKey: .prev30)) ?? nil) ?? .zero
        let momentum = (try? c.decodeIfPresent(Momentum.self, forKey: .momentum)) ?? nil
        incomeMomentum = momentum?.income ?? 0
        expenseMomentum = momentum?.expense ?? 0
        profitMomentum = momentum?.profit ?? 0
    }

    private enum CodingKeys: String, CodingKey { case last30, prev30, momentum }
}

/// Категория расходов с трендом «последние 30 дней против более ранних».
public struct AiForecastCategory: Decodable, Sendable, Identifiable, Hashable {
    public let category: String
    public let total: Double
    public let count: Int
    public let recent: Double
    public let older: Double
    public let share: Double

    public var id: String { category }

    /// Рост категории. `nil`, когда сравнивать не с чем.
    public var trendPct: Double? { Percent.change(current: recent, previous: older) }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        category = try c.decodeFlexibleString(forKey: .category) ?? "Без категории"
        total = try c.decodeFlexibleDouble(forKey: .total) ?? 0
        count = Int(try c.decodeFlexibleDouble(forKey: .count) ?? 0)
        recent = try c.decodeFlexibleDouble(forKey: .recent) ?? 0
        older = try c.decodeFlexibleDouble(forKey: .older) ?? 0
        share = try c.decodeFlexibleDouble(forKey: .share) ?? 0
    }

    private enum CodingKeys: String, CodingKey { case category, total, count, recent, older, share }
}

/// Крупная разовая трата, выбивающаяся из общего ряда.
public struct AiForecastOutlier: Decodable, Sendable, Identifiable, Hashable {
    public let id = UUID()
    public let date: String
    public let category: String
    public let amount: Double
    public let comment: String?

    public var day: Date? { DateParsing.parseDateOnly(date) }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        date = try c.decodeFlexibleString(forKey: .date) ?? ""
        category = try c.decodeFlexibleString(forKey: .category) ?? "Без категории"
        amount = try c.decodeFlexibleDouble(forKey: .amount) ?? 0
        comment = try c.decodeFlexibleString(forKey: .comment)
    }

    private enum CodingKeys: String, CodingKey { case date, category, amount, comment }
}

/// Средняя выручка дня недели.
public struct AiForecastDayAverage: Decodable, Sendable, Identifiable, Hashable {
    public let name: String
    public let avg: Double

    public var id: String { name }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decodeFlexibleString(forKey: .name) ?? ""
        avg = try c.decodeFlexibleDouble(forKey: .avg) ?? 0
    }

    private enum CodingKeys: String, CodingKey { case name, avg }
}

/// Сезонность по дням недели.
public struct AiForecastSeasonality: Decodable, Sendable, Hashable {
    public let byDay: [AiForecastDayAverage]
    public let best: AiForecastDayAverage?
    public let worst: AiForecastDayAverage?

    public static let empty = AiForecastSeasonality()

    public init() {
        byDay = []
        best = nil
        worst = nil
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        byDay = ((try? c.decodeIfPresent([AiForecastDayAverage].self, forKey: .byDay)) ?? nil) ?? []
        best = (try? c.decodeIfPresent(AiForecastDayAverage.self, forKey: .best)) ?? nil
        worst = (try? c.decodeIfPresent(AiForecastDayAverage.self, forKey: .worst)) ?? nil
    }

    private enum CodingKeys: String, CodingKey { case byDay, best, worst }
}

/// План KPI на текущий месяц и факт по нему.
public struct AiForecastKpi: Decodable, Sendable, Hashable {
    public let plan: Double
    public let actual: Double
    public let progress: Double

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        plan = try c.decodeFlexibleDouble(forKey: .plan) ?? 0
        actual = try c.decodeFlexibleDouble(forKey: .actual) ?? 0
        progress = try c.decodeFlexibleDouble(forKey: .progress) ?? 0
    }

    private enum CodingKeys: String, CodingKey { case plan, actual, progress }
}

/// Ответ `POST /api/ai/forecast` без стрима: цифры и текст разбора вместе.
public struct AiForecastReport: Decodable, Sendable {
    public let text: String
    public let dateFrom: String
    public let dateTo: String
    public let weekLabels: [String]
    public let weeklyIncome: [Double]
    public let weeklyExpense: [Double]
    public let projected: AiForecastProjection
    public let avgWeeklyIncome: Double
    public let avgWeeklyExpense: Double
    public let comparison: AiForecastComparison
    public let categories: [AiForecastCategory]
    public let outliers: [AiForecastOutlier]
    public let seasonality: AiForecastSeasonality
    public let kpi: AiForecastKpi?

    /// Разбор модели, разложенный в блоки: сырой Markdown показывать нельзя.
    public var blocks: [RichText.Block] { InsightMarkdown.blocks(from: text) }

    /// Недели, где хоть что-то было. Пустые головные недели появляются, когда
    /// точка открылась позже начала 13-недельного окна, и рисовать их незачем.
    ///
    /// Собрано циклом, а не цепочкой `zip`/`map`/`drop`: на кортеже с тремя
    /// подписанными полями вывод типов у компилятора не сходится за разумное
    /// время и сборка падает.
    public var activeWeeks: [(label: String, income: Double, expense: Double)] {
        var result: [(label: String, income: Double, expense: Double)] = []
        result.reserveCapacity(weeklyIncome.count)

        for index in weeklyIncome.indices {
            let income = weeklyIncome[index]
            let expense = index < weeklyExpense.count ? weeklyExpense[index] : 0
            let label = index < weekLabels.count ? weekLabels[index] : "\(index + 1)"
            result.append((label: label, income: income, expense: expense))
        }

        // Пустые недели отбрасываем только с начала: провал в середине окна —
        // это факт, а не отсутствие данных, и скрывать его нельзя.
        let firstActive = result.firstIndex { $0.income != 0 || $0.expense != 0 }
        guard let firstActive else { return [] }
        return Array(result[firstActive...])
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        text = try c.decodeFlexibleString(forKey: .text) ?? ""
        dateFrom = try c.decodeFlexibleString(forKey: .dateFrom) ?? ""
        dateTo = try c.decodeFlexibleString(forKey: .dateTo) ?? ""
        weekLabels = ((try? c.decodeIfPresent([String].self, forKey: .weekLabels)) ?? nil) ?? []
        weeklyIncome = ((try? c.decodeIfPresent([Double].self, forKey: .weeklyIncome)) ?? nil) ?? []
        weeklyExpense = ((try? c.decodeIfPresent([Double].self, forKey: .weeklyExpense)) ?? nil) ?? []
        projected = ((try? c.decodeIfPresent(AiForecastProjection.self, forKey: .projected)) ?? nil) ?? .zero
        avgWeeklyIncome = try c.decodeFlexibleDouble(forKey: .avgWeeklyIncome) ?? 0
        avgWeeklyExpense = try c.decodeFlexibleDouble(forKey: .avgWeeklyExpense) ?? 0
        comparison = ((try? c.decodeIfPresent(AiForecastComparison.self, forKey: .comparison)) ?? nil) ?? .zero
        categories = ((try? c.decodeIfPresent([AiForecastCategory].self, forKey: .categories)) ?? nil) ?? []
        outliers = ((try? c.decodeIfPresent([AiForecastOutlier].self, forKey: .outliers)) ?? nil) ?? []
        seasonality = ((try? c.decodeIfPresent(AiForecastSeasonality.self, forKey: .seasonality)) ?? nil) ?? .empty
        kpi = (try? c.decodeIfPresent(AiForecastKpi.self, forKey: .kpi)) ?? nil
    }

    private enum CodingKeys: String, CodingKey {
        case text, dateFrom, dateTo, weekLabels, weeklyIncome, weeklyExpense
        case projected, avgWeeklyIncome, avgWeeklyExpense, comparison
        case categories, outliers, seasonality, kpi
    }
}

// ── Бизнес-аналитика: /api/admin/business-intelligence ───────────────────────

/// Слагаемое оценки здоровья бизнеса.
public struct BiHealthFactor: Decodable, Sendable, Identifiable, Hashable {
    public let id = UUID()
    public let label: String
    public let score: Int
    public let note: String

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        label = try c.decodeFlexibleString(forKey: .label) ?? ""
        score = Int(try c.decodeFlexibleDouble(forKey: .score) ?? 0)
        note = try c.decodeFlexibleString(forKey: .note) ?? ""
    }

    private enum CodingKeys: String, CodingKey {
        case label, note
        case score = "score0to100"
    }
}

/// Общая оценка здоровья бизнеса, 0–100.
public struct BiHealthSection: Decodable, Sendable, Hashable {
    public let score: Int
    public let factors: [BiHealthFactor]

    public static let empty = BiHealthSection(score: 0, factors: [])

    public init(score: Int, factors: [BiHealthFactor]) {
        self.score = score
        self.factors = factors
    }

    public var band: String {
        switch score {
        case 80...: "Здоровый"
        case 60..<80: "Требует внимания"
        default: "Проблемный"
        }
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        score = Int(try c.decodeFlexibleDouble(forKey: .score) ?? 0)
        factors = ((try? c.decodeIfPresent([BiHealthFactor].self, forKey: .factors)) ?? nil) ?? []
    }

    private enum CodingKeys: String, CodingKey { case score, factors }
}

/// День, выбившийся из статистического коридора выручки.
public struct BiAnomalyDay: Decodable, Sendable, Identifiable, Hashable {
    public let id = UUID()
    public let company: String
    public let date: String
    public let revenue: Double
    public let z: Double
    public let direction: String

    public var isAbove: Bool { direction == "above" }
    public var day: Date? { DateParsing.parseDateOnly(date) }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        company = try c.decodeFlexibleString(forKey: .company) ?? "—"
        date = try c.decodeFlexibleString(forKey: .date) ?? ""
        revenue = try c.decodeFlexibleDouble(forKey: .revenue) ?? 0
        z = try c.decodeFlexibleDouble(forKey: .z) ?? 0
        direction = try c.decodeFlexibleString(forKey: .direction) ?? "above"
    }

    private enum CodingKeys: String, CodingKey { case company, date, revenue, z, direction }
}

public struct BiAnomalySection: Decodable, Sendable, Hashable {
    public let available: Bool
    public let note: String?
    public let days: Int
    public let anomalies: [BiAnomalyDay]

    public static let empty = BiAnomalySection(available: false, note: nil, days: 0, anomalies: [])

    public init(available: Bool, note: String?, days: Int, anomalies: [BiAnomalyDay]) {
        self.available = available
        self.note = note
        self.days = days
        self.anomalies = anomalies
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        available = ((try? c.decodeIfPresent(Bool.self, forKey: .available)) ?? nil) ?? false
        note = try c.decodeFlexibleString(forKey: .note)
        days = Int(try c.decodeFlexibleDouble(forKey: .days) ?? 0)
        anomalies = ((try? c.decodeIfPresent([BiAnomalyDay].self, forKey: .anomalies)) ?? nil) ?? []
    }

    private enum CodingKeys: String, CodingKey { case available, note, days, anomalies }
}

/// Класс ABC: сколько позиций и какую долю выручки они дают.
public struct BiAbcClass: Decodable, Sendable, Identifiable, Hashable {
    public let cls: String
    public let itemCount: Int
    public let itemSharePct: Double
    public let revenue: Double
    public let revenueSharePct: Double

    public var id: String { cls }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        cls = try c.decodeFlexibleString(forKey: .cls) ?? "C"
        itemCount = Int(try c.decodeFlexibleDouble(forKey: .itemCount) ?? 0)
        itemSharePct = try c.decodeFlexibleDouble(forKey: .itemSharePct) ?? 0
        revenue = try c.decodeFlexibleDouble(forKey: .revenue) ?? 0
        revenueSharePct = try c.decodeFlexibleDouble(forKey: .revenueSharePct) ?? 0
    }

    private enum CodingKeys: String, CodingKey {
        case cls, itemCount, itemSharePct, revenue, revenueSharePct
    }
}

/// Позиция класса A — та, ради которой всё и работает.
public struct BiAbcItem: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let revenue: Double
    public let cumulativePct: Double

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        name = try c.decodeFlexibleString(forKey: .name) ?? "—"
        revenue = try c.decodeFlexibleDouble(forKey: .revenue) ?? 0
        cumulativePct = try c.decodeFlexibleDouble(forKey: .cumulativePct) ?? 0
    }

    private enum CodingKeys: String, CodingKey {
        case name, revenue, cumulativePct
        case id = "item_id"
    }
}

public struct BiAbcSection: Decodable, Sendable, Hashable {
    public let available: Bool
    public let note: String?
    public let totalRevenue: Double
    public let totalItems: Int
    public let classes: [BiAbcClass]
    public let vital: [BiAbcItem]

    public static let empty = BiAbcSection(
        available: false, note: nil, totalRevenue: 0, totalItems: 0, classes: [], vital: []
    )

    public init(available: Bool, note: String?, totalRevenue: Double, totalItems: Int, classes: [BiAbcClass], vital: [BiAbcItem]) {
        self.available = available
        self.note = note
        self.totalRevenue = totalRevenue
        self.totalItems = totalItems
        self.classes = classes
        self.vital = vital
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        available = ((try? c.decodeIfPresent(Bool.self, forKey: .available)) ?? nil) ?? false
        note = try c.decodeFlexibleString(forKey: .note)
        totalRevenue = try c.decodeFlexibleDouble(forKey: .totalRevenue) ?? 0
        totalItems = Int(try c.decodeFlexibleDouble(forKey: .totalItems) ?? 0)
        classes = ((try? c.decodeIfPresent([BiAbcClass].self, forKey: .classes)) ?? nil) ?? []
        vital = ((try? c.decodeIfPresent([BiAbcItem].self, forKey: .vital)) ?? nil) ?? []
    }

    private enum CodingKeys: String, CodingKey {
        case available, note, totalRevenue, totalItems, classes, vital
    }
}

public struct BiRfmSegment: Decodable, Sendable, Identifiable, Hashable {
    public let segment: String
    public let count: Int
    public let monetary: Double

    public var id: String { segment }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        segment = try c.decodeFlexibleString(forKey: .segment) ?? "—"
        count = Int(try c.decodeFlexibleDouble(forKey: .count) ?? 0)
        monetary = try c.decodeFlexibleDouble(forKey: .monetary) ?? 0
    }

    private enum CodingKeys: String, CodingKey { case segment, count, monetary }
}

public struct BiRfmCustomer: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let recencyDays: Int
    public let frequency: Int
    public let monetary: Double
    public let segment: String

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        name = try c.decodeFlexibleString(forKey: .name) ?? "—"
        recencyDays = Int(try c.decodeFlexibleDouble(forKey: .recencyDays) ?? 0)
        frequency = Int(try c.decodeFlexibleDouble(forKey: .frequency) ?? 0)
        monetary = try c.decodeFlexibleDouble(forKey: .monetary) ?? 0
        segment = try c.decodeFlexibleString(forKey: .segment) ?? "—"
    }

    private enum CodingKeys: String, CodingKey {
        case name, recencyDays, frequency, monetary, segment
        case id = "customer_id"
    }
}

public struct BiRfmSection: Decodable, Sendable, Hashable {
    public let available: Bool
    public let note: String?
    public let segments: [BiRfmSegment]
    public let customers: [BiRfmCustomer]

    public static let empty = BiRfmSection(available: false, note: nil, segments: [], customers: [])

    public init(available: Bool, note: String?, segments: [BiRfmSegment], customers: [BiRfmCustomer]) {
        self.available = available
        self.note = note
        self.segments = segments
        self.customers = customers
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        available = ((try? c.decodeIfPresent(Bool.self, forKey: .available)) ?? nil) ?? false
        note = try c.decodeFlexibleString(forKey: .note)
        segments = ((try? c.decodeIfPresent([BiRfmSegment].self, forKey: .segments)) ?? nil) ?? []
        customers = ((try? c.decodeIfPresent([BiRfmCustomer].self, forKey: .customers)) ?? nil) ?? []
    }

    private enum CodingKeys: String, CodingKey { case available, note, segments, customers }
}

/// Оценка пожизненной ценности клиента.
public struct BiClvRow: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let clv: Double
    public let avgOrder: Double
    public let frequency: Int

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        name = try c.decodeFlexibleString(forKey: .name) ?? "—"
        clv = try c.decodeFlexibleDouble(forKey: .clv) ?? 0
        avgOrder = try c.decodeFlexibleDouble(forKey: .avgOrder) ?? 0
        frequency = Int(try c.decodeFlexibleDouble(forKey: .frequency) ?? 0)
    }

    private enum CodingKeys: String, CodingKey {
        case name, clv, avgOrder, frequency
        case id = "customer_id"
    }
}

public struct BiClvSection: Decodable, Sendable, Hashable {
    public let available: Bool
    public let note: String?
    public let rows: [BiClvRow]

    public static let empty = BiClvSection(available: false, note: nil, rows: [])

    public init(available: Bool, note: String?, rows: [BiClvRow]) {
        self.available = available
        self.note = note
        self.rows = rows
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        available = ((try? c.decodeIfPresent(Bool.self, forKey: .available)) ?? nil) ?? false
        note = try c.decodeFlexibleString(forKey: .note)
        rows = ((try? c.decodeIfPresent([BiClvRow].self, forKey: .rows)) ?? nil) ?? []
    }

    private enum CodingKeys: String, CodingKey { case available, note, rows }
}

/// Вероятность недостачи у кассира — сглаженная, а не «сколько раз попался».
public struct BiCashierRisk: Decodable, Sendable, Identifiable, Hashable {
    public let cashier: String
    public let shortfallEvents: Int
    public let totalEvents: Int
    public let posteriorPct: Double

    public var id: String { cashier }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        cashier = try c.decodeFlexibleString(forKey: .cashier) ?? "—"
        shortfallEvents = Int(try c.decodeFlexibleDouble(forKey: .shortfallEvents) ?? 0)
        totalEvents = Int(try c.decodeFlexibleDouble(forKey: .totalEvents) ?? 0)
        posteriorPct = try c.decodeFlexibleDouble(forKey: .posteriorPct) ?? 0
    }

    private enum CodingKeys: String, CodingKey {
        case cashier, shortfallEvents, totalEvents, posteriorPct
    }
}

public struct BiCashierSection: Decodable, Sendable, Hashable {
    public let available: Bool
    public let note: String?
    public let rows: [BiCashierRisk]

    public static let empty = BiCashierSection(available: false, note: nil, rows: [])

    public init(available: Bool, note: String?, rows: [BiCashierRisk]) {
        self.available = available
        self.note = note
        self.rows = rows
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        available = ((try? c.decodeIfPresent(Bool.self, forKey: .available)) ?? nil) ?? false
        note = try c.decodeFlexibleString(forKey: .note)
        rows = ((try? c.decodeIfPresent([BiCashierRisk].self, forKey: .rows)) ?? nil) ?? []
    }

    private enum CodingKeys: String, CodingKey { case available, note, rows }
}

/// Страховой запас и точка заказа по позиции.
public struct BiSafetyRow: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let avgWeeklyDemand: Double
    public let safetyStock: Double
    public let reorderPoint: Double
    public let stock: Double
    public let belowReorder: Bool

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        name = try c.decodeFlexibleString(forKey: .name) ?? "—"
        avgWeeklyDemand = try c.decodeFlexibleDouble(forKey: .avgWeeklyDemand) ?? 0
        safetyStock = try c.decodeFlexibleDouble(forKey: .safetyStock) ?? 0
        reorderPoint = try c.decodeFlexibleDouble(forKey: .reorderPoint) ?? 0
        stock = try c.decodeFlexibleDouble(forKey: .stock) ?? 0
        belowReorder = ((try? c.decodeIfPresent(Bool.self, forKey: .belowReorder)) ?? nil) ?? false
    }

    private enum CodingKeys: String, CodingKey {
        case name, avgWeeklyDemand, safetyStock, reorderPoint, stock, belowReorder
        case id = "item_id"
    }
}

public struct BiSafetySection: Decodable, Sendable, Hashable {
    public let available: Bool
    public let note: String?
    public let leadTimeWeeks: Double
    public let rows: [BiSafetyRow]

    public static let empty = BiSafetySection(available: false, note: nil, leadTimeWeeks: 0, rows: [])

    public init(available: Bool, note: String?, leadTimeWeeks: Double, rows: [BiSafetyRow]) {
        self.available = available
        self.note = note
        self.leadTimeWeeks = leadTimeWeeks
        self.rows = rows
    }

    /// Позиции, которые пора заказывать.
    public var needsOrder: [BiSafetyRow] { rows.filter(\.belowReorder) }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        available = ((try? c.decodeIfPresent(Bool.self, forKey: .available)) ?? nil) ?? false
        note = try c.decodeFlexibleString(forKey: .note)
        leadTimeWeeks = try c.decodeFlexibleDouble(forKey: .leadTimeWeeks) ?? 0
        rows = ((try? c.decodeIfPresent([BiSafetyRow].self, forKey: .rows)) ?? nil) ?? []
    }

    private enum CodingKeys: String, CodingKey { case available, note, leadTimeWeeks, rows }
}

/// Экономичный размер заказа по позиции.
public struct BiEoqRow: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let eoq: Double
    public let stock: Double
    public let annualDemand: Double

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        name = try c.decodeFlexibleString(forKey: .name) ?? "—"
        eoq = try c.decodeFlexibleDouble(forKey: .eoq) ?? 0
        stock = try c.decodeFlexibleDouble(forKey: .stock) ?? 0
        annualDemand = try c.decodeFlexibleDouble(forKey: .annualDemand) ?? 0
    }

    private enum CodingKeys: String, CodingKey {
        case name, eoq, stock, annualDemand
        case id = "item_id"
    }
}

public struct BiEoqSection: Decodable, Sendable, Hashable {
    public let available: Bool
    public let note: String?
    public let rows: [BiEoqRow]

    public static let empty = BiEoqSection(available: false, note: nil, rows: [])

    public init(available: Bool, note: String?, rows: [BiEoqRow]) {
        self.available = available
        self.note = note
        self.rows = rows
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        available = ((try? c.decodeIfPresent(Bool.self, forKey: .available)) ?? nil) ?? false
        note = try c.decodeFlexibleString(forKey: .note)
        rows = ((try? c.decodeIfPresent([BiEoqRow].self, forKey: .rows)) ?? nil) ?? []
    }

    private enum CodingKeys: String, CodingKey { case available, note, rows }
}

/// Сколько держать скоропортящегося товара, чтобы не переплатить за списание.
public struct BiNewsvendorRow: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let recommendedStock: Double
    public let stock: Double
    public let criticalFractilePct: Double

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        name = try c.decodeFlexibleString(forKey: .name) ?? "—"
        recommendedStock = try c.decodeFlexibleDouble(forKey: .recommendedStock) ?? 0
        stock = try c.decodeFlexibleDouble(forKey: .stock) ?? 0
        criticalFractilePct = try c.decodeFlexibleDouble(forKey: .criticalFractilePct) ?? 0
    }

    private enum CodingKeys: String, CodingKey {
        case name, recommendedStock, stock, criticalFractilePct
        case id = "item_id"
    }
}

public struct BiNewsvendorSection: Decodable, Sendable, Hashable {
    public let available: Bool
    public let note: String?
    public let rows: [BiNewsvendorRow]

    public static let empty = BiNewsvendorSection(available: false, note: nil, rows: [])

    public init(available: Bool, note: String?, rows: [BiNewsvendorRow]) {
        self.available = available
        self.note = note
        self.rows = rows
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        available = ((try? c.decodeIfPresent(Bool.self, forKey: .available)) ?? nil) ?? false
        note = try c.decodeFlexibleString(forKey: .note)
        rows = ((try? c.decodeIfPresent([BiNewsvendorRow].self, forKey: .rows)) ?? nil) ?? []
    }

    private enum CodingKeys: String, CodingKey { case available, note, rows }
}

/// Ответ `GET /api/admin/business-intelligence` — набор формул на своих данных.
///
/// Ни одного обращения к ИИ: всё считает сервер. Поэтому раздел можно грузить
/// при открытии, не спрашивая владельца.
public struct BusinessIntelligence: Decodable, Sendable {
    public let generatedAt: Date?
    public let healthScore: BiHealthSection
    public let anomalies: BiAnomalySection
    public let abc: BiAbcSection
    public let rfm: BiRfmSection
    public let clv: BiClvSection
    public let cashierRisk: BiCashierSection
    public let safetyStock: BiSafetySection
    public let eoq: BiEoqSection
    public let newsvendor: BiNewsvendorSection

    /// Есть ли вообще что показывать. Пустая организация не должна получать
    /// девять карточек с надписью «нет данных».
    public var hasAnything: Bool {
        healthScore.score > 0 || anomalies.available || abc.available || rfm.available
            || clv.available || cashierRisk.available || safetyStock.available
            || eoq.available || newsvendor.available
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        generatedAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .generatedAt))
        healthScore = ((try? c.decodeIfPresent(BiHealthSection.self, forKey: .healthScore)) ?? nil) ?? .empty
        anomalies = ((try? c.decodeIfPresent(BiAnomalySection.self, forKey: .anomalies)) ?? nil) ?? .empty
        abc = ((try? c.decodeIfPresent(BiAbcSection.self, forKey: .abc)) ?? nil) ?? .empty
        rfm = ((try? c.decodeIfPresent(BiRfmSection.self, forKey: .rfm)) ?? nil) ?? .empty
        clv = ((try? c.decodeIfPresent(BiClvSection.self, forKey: .clv)) ?? nil) ?? .empty
        cashierRisk = ((try? c.decodeIfPresent(BiCashierSection.self, forKey: .cashierRisk)) ?? nil) ?? .empty
        safetyStock = ((try? c.decodeIfPresent(BiSafetySection.self, forKey: .safetyStock)) ?? nil) ?? .empty
        eoq = ((try? c.decodeIfPresent(BiEoqSection.self, forKey: .eoq)) ?? nil) ?? .empty
        newsvendor = ((try? c.decodeIfPresent(BiNewsvendorSection.self, forKey: .newsvendor)) ?? nil) ?? .empty
    }

    private enum CodingKeys: String, CodingKey {
        case generatedAt, healthScore, anomalies, abc, rfm, clv
        case cashierRisk, safetyStock, eoq, newsvendor
    }
}

/// Ответ `POST /api/ai/business-intelligence` — короткий список приоритетов.
public struct BiPriorityActions: Decodable, Sendable {
    public let actions: [String]

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        actions = ((try? c.decodeIfPresent([String].self, forKey: .actions)) ?? nil) ?? []
    }

    private enum CodingKeys: String, CodingKey { case actions }
}

// ── AI Финдиректор: /api/ai/cfo ──────────────────────────────────────────────

/// Ключевые цифры периода. Считает сервер, ИИ их только объясняет.
public struct CfoExecutive: Decodable, Sendable, Hashable {
    public let revenue: Double
    public let revenueDeltaPct: Double
    public let expenses: Double
    public let expensesDeltaPct: Double
    public let profit: Double
    public let profitDeltaPct: Double
    public let margin: Double
    public let marginDeltaPp: Double

    public static let zero = CfoExecutive()

    public init() {
        revenue = 0
        revenueDeltaPct = 0
        expenses = 0
        expensesDeltaPct = 0
        profit = 0
        profitDeltaPct = 0
        margin = 0
        marginDeltaPp = 0
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        revenue = try c.decodeFlexibleDouble(forKey: .revenue) ?? 0
        revenueDeltaPct = try c.decodeFlexibleDouble(forKey: .revenueDeltaPct) ?? 0
        expenses = try c.decodeFlexibleDouble(forKey: .expenses) ?? 0
        expensesDeltaPct = try c.decodeFlexibleDouble(forKey: .expensesDeltaPct) ?? 0
        profit = try c.decodeFlexibleDouble(forKey: .profit) ?? 0
        profitDeltaPct = try c.decodeFlexibleDouble(forKey: .profitDeltaPct) ?? 0
        margin = try c.decodeFlexibleDouble(forKey: .margin) ?? 0
        marginDeltaPp = try c.decodeFlexibleDouble(forKey: .marginDeltaPp) ?? 0
    }

    private enum CodingKeys: String, CodingKey {
        case revenue, revenueDeltaPct, expenses, expensesDeltaPct
        case profit, profitDeltaPct, margin, marginDeltaPp
    }
}

/// Структура затрат: точка безубыточности и запас прочности.
public struct CfoCostStructure: Decodable, Sendable, Hashable {
    public let variableExpenses: Double
    public let fixedExpenses: Double
    public let capex: Double
    public let incomeTax: Double
    public let profitDistribution: Double
    public let contributionRatePct: Double
    public let breakevenRevenue: Double
    public let safetyMarginPct: Double
    public let operatingProfit: Double

    public static let zero = CfoCostStructure()

    public init() {
        variableExpenses = 0
        fixedExpenses = 0
        capex = 0
        incomeTax = 0
        profitDistribution = 0
        contributionRatePct = 0
        breakevenRevenue = 0
        safetyMarginPct = 0
        operatingProfit = 0
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        variableExpenses = try c.decodeFlexibleDouble(forKey: .variableExpenses) ?? 0
        fixedExpenses = try c.decodeFlexibleDouble(forKey: .fixedExpenses) ?? 0
        capex = try c.decodeFlexibleDouble(forKey: .capex) ?? 0
        incomeTax = try c.decodeFlexibleDouble(forKey: .incomeTax) ?? 0
        profitDistribution = try c.decodeFlexibleDouble(forKey: .profitDistribution) ?? 0
        contributionRatePct = try c.decodeFlexibleDouble(forKey: .contributionRatePct) ?? 0
        breakevenRevenue = try c.decodeFlexibleDouble(forKey: .breakevenRevenue) ?? 0
        safetyMarginPct = try c.decodeFlexibleDouble(forKey: .safetyMarginPct) ?? 0
        operatingProfit = try c.decodeFlexibleDouble(forKey: .operatingProfit) ?? 0
    }

    private enum CodingKeys: String, CodingKey {
        case variableExpenses, fixedExpenses, capex, incomeTax, profitDistribution
        case contributionRatePct, breakevenRevenue, safetyMarginPct, operatingProfit
    }
}

/// Точка в разрезе финдиректора.
public struct CfoCompanyRow: Decodable, Sendable, Identifiable, Hashable {
    public let id = UUID()
    public let name: String
    public let revenue: Double
    public let expenses: Double
    public let profit: Double
    public let margin: Double
    public let profitShare: Double
    public let revenueDeltaPct: Double

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decodeFlexibleString(forKey: .name) ?? "—"
        revenue = try c.decodeFlexibleDouble(forKey: .revenue) ?? 0
        expenses = try c.decodeFlexibleDouble(forKey: .expenses) ?? 0
        profit = try c.decodeFlexibleDouble(forKey: .profit) ?? 0
        margin = try c.decodeFlexibleDouble(forKey: .margin) ?? 0
        profitShare = try c.decodeFlexibleDouble(forKey: .profitShare) ?? 0
        revenueDeltaPct = try c.decodeFlexibleDouble(forKey: .revenueDeltaPct) ?? 0
    }

    private enum CodingKeys: String, CodingKey {
        case name, revenue, expenses, profit, margin, profitShare, revenueDeltaPct
    }
}

/// Кто лидер и кто отстаёт.
public struct CfoRanking: Decodable, Sendable, Hashable {
    public let profitLeader: String?
    public let worst: String?
    public let efficiencyLeader: String?
    public let growthLeader: String?

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        profitLeader = try c.decodeFlexibleString(forKey: .profitLeader)
        worst = try c.decodeFlexibleString(forKey: .worst)
        efficiencyLeader = try c.decodeFlexibleString(forKey: .efficiencyLeader)
        growthLeader = try c.decodeFlexibleString(forKey: .growthLeader)
    }

    private enum CodingKeys: String, CodingKey {
        case profitLeader, worst, efficiencyLeader, growthLeader
    }
}

/// Категория расходов, которая заметно сдвинулась к прошлому периоду.
public struct CfoExpenseChange: Decodable, Sendable, Identifiable, Hashable {
    public let id = UUID()
    public let label: String
    public let current: Double
    public let previous: Double
    public let deltaPct: Double

    public var delta: Double { current - previous }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        label = try c.decodeFlexibleString(forKey: .label) ?? "—"
        current = try c.decodeFlexibleDouble(forKey: .current) ?? 0
        previous = try c.decodeFlexibleDouble(forKey: .prev) ?? 0
        deltaPct = try c.decodeFlexibleDouble(forKey: .deltaPct) ?? 0
    }

    private enum CodingKeys: String, CodingKey { case label, current, prev, deltaPct }
}

/// Полнота данных: без неё любые выводы — гадание.
public struct CfoDataQuality: Decodable, Sendable, Hashable {
    public let percent: Int
    public let daysInPeriod: Int
    public let daysWithSales: Int
    public let daysWithExpenses: Int

    public static let unknown = CfoDataQuality()

    public init() {
        percent = 0
        daysInPeriod = 0
        daysWithSales = 0
        daysWithExpenses = 0
    }

    public var label: String {
        switch percent {
        case 90...: "Данные надёжные"
        case 70..<90: "Есть пробелы"
        default: "Данных мало"
        }
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        percent = Int(try c.decodeFlexibleDouble(forKey: .percent) ?? 0)
        daysInPeriod = Int(try c.decodeFlexibleDouble(forKey: .daysInPeriod) ?? 0)
        daysWithSales = Int(try c.decodeFlexibleDouble(forKey: .daysWithSales) ?? 0)
        daysWithExpenses = Int(try c.decodeFlexibleDouble(forKey: .daysWithExpenses) ?? 0)
    }

    private enum CodingKeys: String, CodingKey {
        case percent, daysInPeriod, daysWithSales, daysWithExpenses
    }
}

/// Утверждение модели с пометкой, факт это или гипотеза.
public struct CfoStatement: Decodable, Sendable, Identifiable, Hashable {
    public let id = UUID()
    public let text: String
    public let status: String

    /// Гипотезу нельзя показывать так же, как факт: иначе владелец примет
    /// догадку модели за посчитанное число.
    public var isFact: Bool { status.uppercased().contains("ФАКТ") }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        text = try c.decodeFlexibleString(forKey: .text) ?? ""
        status = try c.decodeFlexibleString(forKey: .status) ?? ""
    }

    private enum CodingKeys: String, CodingKey { case text, status }
}

/// Риск с оценкой вероятности и влияния.
public struct CfoRisk: Decodable, Sendable, Identifiable, Hashable {
    public let id = UUID()
    public let risk: String
    public let probability: String
    public let impact: String
    public let level: String

    public var isCritical: Bool { level == "critical" || level == "high" }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        risk = try c.decodeFlexibleString(forKey: .risk) ?? ""
        probability = try c.decodeFlexibleString(forKey: .probability) ?? ""
        impact = try c.decodeFlexibleString(forKey: .impact) ?? ""
        level = try c.decodeFlexibleString(forKey: .level) ?? "medium"
    }

    private enum CodingKeys: String, CodingKey { case risk, probability, impact, level }
}

/// Строка «где утекают деньги» или «где недозарабатываем».
///
/// Суммы приходят строками («≈120 000 ₸/мес»), потому что модель обязана
/// указывать единицу и оговорку — форматировать их заново нельзя.
public struct CfoMoneyLine: Decodable, Sendable, Identifiable, Hashable {
    public let id = UUID()
    public let text: String
    public let amount: String
    public let status: String

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        text = try c.decodeFlexibleString(forKey: .text) ?? ""
        amount = try c.decodeFlexibleString(forKey: .amount)
            ?? c.decodeFlexibleString(forKey: .potential) ?? ""
        status = try c.decodeFlexibleString(forKey: .status) ?? ""
    }

    private enum CodingKeys: String, CodingKey { case text, amount, potential, status }
}

/// Возможность: что сделать и что это даст.
public struct CfoOpportunity: Decodable, Sendable, Identifiable, Hashable {
    public let id = UUID()
    public let title: String
    public let action: String
    public let effect: String
    public let status: String

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        title = try c.decodeFlexibleString(forKey: .title) ?? ""
        action = try c.decodeFlexibleString(forKey: .action) ?? ""
        effect = try c.decodeFlexibleString(forKey: .effect) ?? ""
        status = try c.decodeFlexibleString(forKey: .status) ?? ""
    }

    private enum CodingKeys: String, CodingKey { case title, action, effect, status }
}

/// Прогноз прибыли тремя полосами.
public struct CfoForecast: Decodable, Sendable, Hashable {
    public let band: String
    public let text: String
    public let base: String
    public let optimistic: String
    public let pessimistic: String
    public let warning: String?

    public var bandLabel: String {
        switch band {
        case "high": "Уверенность высокая"
        case "low": "Уверенность низкая"
        default: "Уверенность средняя"
        }
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        band = try c.decodeFlexibleString(forKey: .band) ?? "medium"
        text = try c.decodeFlexibleString(forKey: .text) ?? ""
        base = try c.decodeFlexibleString(forKey: .base) ?? ""
        optimistic = try c.decodeFlexibleString(forKey: .optimistic) ?? ""
        pessimistic = try c.decodeFlexibleString(forKey: .pessimistic) ?? ""
        warning = try c.decodeFlexibleString(forKey: .warning)
    }

    private enum CodingKeys: String, CodingKey {
        case band, text, base, optimistic, pessimistic, warning
    }
}

/// Сценарий «что если».
public struct CfoScenario: Decodable, Sendable, Identifiable, Hashable {
    public let id = UUID()
    public let name: String
    public let assumption: String
    public let effect: String
    public let note: String
    public let status: String

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decodeFlexibleString(forKey: .name) ?? ""
        assumption = try c.decodeFlexibleString(forKey: .assumption) ?? ""
        effect = try c.decodeFlexibleString(forKey: .effect) ?? ""
        note = try c.decodeFlexibleString(forKey: .note) ?? ""
        status = try c.decodeFlexibleString(forKey: .status) ?? ""
    }

    private enum CodingKeys: String, CodingKey { case name, assumption, effect, note, status }
}

/// План действий по горизонтам.
public struct CfoActionPlan: Decodable, Sendable, Hashable {
    public let today: [String]
    public let week: [String]
    public let month: [String]

    public var isEmpty: Bool { today.isEmpty && week.isEmpty && month.isEmpty }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        today = ((try? c.decodeIfPresent([String].self, forKey: .today)) ?? nil) ?? []
        week = ((try? c.decodeIfPresent([String].self, forKey: .week)) ?? nil) ?? []
        month = ((try? c.decodeIfPresent([String].self, forKey: .month)) ?? nil) ?? []
    }

    private enum CodingKeys: String, CodingKey { case today, week, month }
}

/// Итог одной страницей.
public struct CfoSummary: Decodable, Sendable, Hashable {
    public let whereLosing: String
    public let whereEarn: String
    public let mainRisk: String
    public let mainOpportunity: String
    public let extraProfit: String
    public let threeActions: [String]

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        whereLosing = try c.decodeFlexibleString(forKey: .whereLosing) ?? ""
        whereEarn = try c.decodeFlexibleString(forKey: .whereEarn) ?? ""
        mainRisk = try c.decodeFlexibleString(forKey: .mainRisk) ?? ""
        mainOpportunity = try c.decodeFlexibleString(forKey: .mainOpportunity) ?? ""
        extraProfit = try c.decodeFlexibleString(forKey: .extraProfit) ?? ""
        threeActions = ((try? c.decodeIfPresent([String].self, forKey: .threeActions)) ?? nil) ?? []
    }

    private enum CodingKeys: String, CodingKey {
        case whereLosing = "where_losing"
        case whereEarn = "where_earn"
        case mainRisk = "main_risk"
        case mainOpportunity = "main_opportunity"
        case extraProfit = "extra_profit"
        case threeActions = "three_actions"
    }
}

/// Оценка здоровья бизнеса глазами модели.
public struct CfoHealthScore: Decodable, Sendable, Hashable {
    public let score: Int
    public let band: String
    public let breakdown: [(label: String, value: Int)]
    public let missing: [String]

    public var bandLabel: String {
        switch band {
        case "healthy": "Здоровый"
        case "problem": "Проблемный"
        default: "Требует внимания"
        }
    }

    public static func == (lhs: CfoHealthScore, rhs: CfoHealthScore) -> Bool {
        lhs.score == rhs.score && lhs.band == rhs.band && lhs.missing == rhs.missing
            && lhs.breakdown.map(\.label) == rhs.breakdown.map(\.label)
            && lhs.breakdown.map(\.value) == rhs.breakdown.map(\.value)
    }

    public func hash(into hasher: inout Hasher) {
        hasher.combine(score)
        hasher.combine(band)
    }

    private struct Breakdown: Decodable {
        let profitability: Double?
        let money: Double?
        let risks: Double?
        let dynamics: Double?
        let data: Double?
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        score = Int(try c.decodeFlexibleDouble(forKey: .score) ?? 0)
        band = try c.decodeFlexibleString(forKey: .band) ?? "attention"
        missing = ((try? c.decodeIfPresent([String].self, forKey: .missing)) ?? nil) ?? []

        let raw = (try? c.decodeIfPresent(Breakdown.self, forKey: .breakdown)) ?? nil
        // Порядок фиксирован: у оценки есть смысловая последовательность,
        // и прыгающие местами строки читались бы как разные разборы.
        breakdown = [
            ("Рентабельность", raw?.profitability),
            ("Деньги", raw?.money),
            ("Риски", raw?.risks),
            ("Динамика", raw?.dynamics),
            ("Данные", raw?.data),
        ].compactMap { label, value in
            guard let value else { return nil }
            return (label: label, value: Int(value))
        }
    }

    private enum CodingKeys: String, CodingKey { case score, band, breakdown, missing }
}

/// Разбор модели целиком. Любой блок может отсутствовать — модель отвечает
/// свободно, и отсутствующий раздел это не ошибка, а «нечего сказать».
public struct CfoAnalysis: Decodable, Sendable {
    public let state: String
    public let healthScore: CfoHealthScore?
    public let changes: [CfoStatement]
    public let rootCauses: [CfoStatement]
    public let risks: [CfoRisk]
    public let losses: [CfoMoneyLine]
    public let missedProfit: [CfoMoneyLine]
    public let opportunities: [CfoOpportunity]
    public let forecast: CfoForecast?
    public let scenarios: [CfoScenario]
    public let actionPlan: CfoActionPlan?
    public let summary: CfoSummary?
    /// Сервер кладёт сюда причину, если модель не ответила разбором.
    public let error: String?

    public var isEmpty: Bool {
        state.isEmpty && changes.isEmpty && risks.isEmpty && opportunities.isEmpty && summary == nil
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        state = try c.decodeFlexibleString(forKey: .state) ?? ""
        healthScore = (try? c.decodeIfPresent(CfoHealthScore.self, forKey: .healthScore)) ?? nil
        changes = ((try? c.decodeIfPresent([CfoStatement].self, forKey: .changes)) ?? nil) ?? []
        rootCauses = ((try? c.decodeIfPresent([CfoStatement].self, forKey: .rootCauses)) ?? nil) ?? []
        risks = ((try? c.decodeIfPresent([CfoRisk].self, forKey: .risks)) ?? nil) ?? []
        losses = ((try? c.decodeIfPresent([CfoMoneyLine].self, forKey: .losses)) ?? nil) ?? []
        missedProfit = ((try? c.decodeIfPresent([CfoMoneyLine].self, forKey: .missedProfit)) ?? nil) ?? []
        opportunities = ((try? c.decodeIfPresent([CfoOpportunity].self, forKey: .opportunities)) ?? nil) ?? []
        forecast = (try? c.decodeIfPresent(CfoForecast.self, forKey: .forecast)) ?? nil
        scenarios = ((try? c.decodeIfPresent([CfoScenario].self, forKey: .scenarios)) ?? nil) ?? []
        actionPlan = (try? c.decodeIfPresent(CfoActionPlan.self, forKey: .actionPlan)) ?? nil
        summary = (try? c.decodeIfPresent(CfoSummary.self, forKey: .summary)) ?? nil
        error = try c.decodeFlexibleString(forKey: .error)
    }

    private enum CodingKeys: String, CodingKey {
        case state, healthScore, changes, rootCauses, risks, losses
        case missedProfit, opportunities, forecast, scenarios, actionPlan, summary, error
    }
}

/// Ответ `POST /api/ai/cfo`: посчитанные цифры плюс разбор модели.
public struct CfoReport: Decodable, Sendable {
    public let days: Int
    public let dateFrom: String
    public let dateTo: String
    public let executive: CfoExecutive
    public let fot: Double
    public let fotShare: Double
    public let concentrationPct: Double
    public let costStructure: CfoCostStructure
    public let companies: [CfoCompanyRow]
    public let ranking: CfoRanking?
    public let expenseChanges: [CfoExpenseChange]
    public let dataQuality: CfoDataQuality
    public let analysis: CfoAnalysis?

    public var periodLabel: String {
        guard let from = DateParsing.parseDateOnly(dateFrom),
              let to = DateParsing.parseDateOnly(dateTo) else { return "" }
        return "\(from.formatted(.dateTime.day().month(.abbreviated))) — \(to.formatted(.dateTime.day().month(.abbreviated)))"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        days = Int(try c.decodeFlexibleDouble(forKey: .days) ?? 0)
        dateFrom = try c.decodeFlexibleString(forKey: .dateFrom) ?? ""
        dateTo = try c.decodeFlexibleString(forKey: .dateTo) ?? ""
        executive = ((try? c.decodeIfPresent(CfoExecutive.self, forKey: .executive)) ?? nil) ?? .zero
        fot = try c.decodeFlexibleDouble(forKey: .fot) ?? 0
        fotShare = try c.decodeFlexibleDouble(forKey: .fotShare) ?? 0
        concentrationPct = try c.decodeFlexibleDouble(forKey: .concentrationPct) ?? 0
        costStructure = ((try? c.decodeIfPresent(CfoCostStructure.self, forKey: .costStructure)) ?? nil) ?? .zero
        companies = ((try? c.decodeIfPresent([CfoCompanyRow].self, forKey: .companies)) ?? nil) ?? []
        ranking = (try? c.decodeIfPresent(CfoRanking.self, forKey: .ranking)) ?? nil
        expenseChanges = ((try? c.decodeIfPresent([CfoExpenseChange].self, forKey: .expenseChanges)) ?? nil) ?? []
        dataQuality = ((try? c.decodeIfPresent(CfoDataQuality.self, forKey: .dataQuality)) ?? nil) ?? .unknown
        analysis = (try? c.decodeIfPresent(CfoAnalysis.self, forKey: .ai)) ?? nil
    }

    private enum CodingKeys: String, CodingKey {
        case days, dateFrom, dateTo, executive, fot, fotShare, concentrationPct
        case costStructure, companies, ranking, expenseChanges, dataQuality, ai
    }
}

// ── AI Разбор расходов: /api/ai/expense-analysis ─────────────────────────────

/// Категория расходов за период против такого же прошлого.
///
/// Не `ExpenseCategory` — так называется справочник категорий в настройках,
/// а здесь агрегат за период.
public struct ExpenseAnalysisCategory: Decodable, Sendable, Identifiable, Hashable {
    public let category: String
    public let amount: Double
    public let previous: Double
    public let sharePct: Double
    public let changePct: Double

    public var id: String { category }

    /// Заметный скачок — то, что стоит проверить в первую очередь.
    public var isSpike: Bool { changePct >= 40 && amount > previous }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        category = try c.decodeFlexibleString(forKey: .category) ?? "Прочее"
        amount = try c.decodeFlexibleDouble(forKey: .amount) ?? 0
        previous = try c.decodeFlexibleDouble(forKey: .prev) ?? 0
        sharePct = try c.decodeFlexibleDouble(forKey: .sharePct) ?? 0
        changePct = try c.decodeFlexibleDouble(forKey: .changePct) ?? 0
    }

    private enum CodingKeys: String, CodingKey { case category, amount, prev, sharePct, changePct }
}

/// Ответ `GET /api/ai/expense-analysis`.
public struct ExpenseAnalysisReport: Decodable, Sendable {
    public let categories: [ExpenseAnalysisCategory]
    public let total: Double
    public let totalChangePct: Double
    public let insights: [AiInsight]
    public let summary: String

    /// Категории, где реально были траты в этом периоде.
    public var spentCategories: [ExpenseAnalysisCategory] {
        categories.filter { $0.amount > 0 }
    }

    private struct Metrics: Decodable {
        let categories: [ExpenseAnalysisCategory]?
        let total: Double?
        let totalPrevPct: Double?
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let metrics = (try? c.decodeIfPresent(Metrics.self, forKey: .metrics)) ?? nil
        categories = metrics?.categories ?? []
        total = metrics?.total ?? 0
        totalChangePct = metrics?.totalPrevPct ?? 0
        insights = ((try? c.decodeIfPresent([AiInsight].self, forKey: .insights)) ?? nil) ?? []
        summary = try c.decodeFlexibleString(forKey: .summary) ?? ""
    }

    private enum CodingKeys: String, CodingKey { case metrics, insights, summary }
}

// ── AI Разбор команды: /api/ai/team-analysis ─────────────────────────────────

/// Оператор в разрезе разбора команды.
///
/// Не `TeamOperator` — тот описывает карточку сотрудника, а здесь только
/// показатели за период.
public struct TeamAnalysisOperator: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let shifts: Int
    public let turnover: Double
    public let revenuePerShift: Double
    public let net: Double
    public let remaining: Double
    public let bonus: Double
    public let fine: Double
    public let debt: Double
    /// Сколько выручки приходится на 1 ₸ зарплаты.
    public let revenuePerSalary: Double

    public var hasProblems: Bool { fine > 0 || debt > 0 }

    public var initials: String {
        let parts = name.split(separator: " ").prefix(2)
        return parts.compactMap(\.first).map(String.init).joined().uppercased()
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        name = try c.decodeFlexibleString(forKey: .name) ?? "Без имени"
        shifts = Int(try c.decodeFlexibleDouble(forKey: .shifts) ?? 0)
        turnover = try c.decodeFlexibleDouble(forKey: .turnover) ?? 0
        revenuePerShift = try c.decodeFlexibleDouble(forKey: .revenuePerShift) ?? 0
        net = try c.decodeFlexibleDouble(forKey: .net) ?? 0
        remaining = try c.decodeFlexibleDouble(forKey: .remaining) ?? 0
        bonus = try c.decodeFlexibleDouble(forKey: .bonus) ?? 0
        fine = try c.decodeFlexibleDouble(forKey: .fine) ?? 0
        debt = try c.decodeFlexibleDouble(forKey: .debt) ?? 0
        revenuePerSalary = try c.decodeFlexibleDouble(forKey: .revenuePerSalary) ?? 0
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, shifts, turnover, revenuePerShift, net, remaining
        case bonus, fine, debt, revenuePerSalary
    }
}

/// Разброс зарплат: во сколько раз старший получает больше младшего.
public struct TeamSalarySpread: Decodable, Sendable, Hashable {
    public let minNet: Double
    public let maxNet: Double
    public let ratio: Double

    public static let zero = TeamSalarySpread(minNet: 0, maxNet: 0, ratio: 0)

    public init(minNet: Double, maxNet: Double, ratio: Double) {
        self.minNet = minNet
        self.maxNet = maxNet
        self.ratio = ratio
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        minNet = try c.decodeFlexibleDouble(forKey: .minNet) ?? 0
        maxNet = try c.decodeFlexibleDouble(forKey: .maxNet) ?? 0
        ratio = try c.decodeFlexibleDouble(forKey: .ratio) ?? 0
    }

    private enum CodingKeys: String, CodingKey { case minNet, maxNet, ratio }
}

/// Итоги по команде за период.
public struct TeamAnalysisAggregates: Decodable, Sendable, Hashable {
    public let dateFrom: String
    public let dateTo: String
    public let operatorsCount: Int
    public let activeCount: Int
    public let totalTurnover: Double
    public let totalNet: Double
    public let avgRevenuePerShift: Double
    public let salarySpread: TeamSalarySpread

    public static let zero = TeamAnalysisAggregates()

    public init() {
        dateFrom = ""
        dateTo = ""
        operatorsCount = 0
        activeCount = 0
        totalTurnover = 0
        totalNet = 0
        avgRevenuePerShift = 0
        salarySpread = .zero
    }

    /// Доля зарплаты в обороте команды. Главный ориентир справедливости оплаты.
    public var salaryShare: Double? {
        totalTurnover > 0 ? totalNet / totalTurnover * 100 : nil
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        dateFrom = try c.decodeFlexibleString(forKey: .dateFrom) ?? ""
        dateTo = try c.decodeFlexibleString(forKey: .dateTo) ?? ""
        operatorsCount = Int(try c.decodeFlexibleDouble(forKey: .operatorsCount) ?? 0)
        activeCount = Int(try c.decodeFlexibleDouble(forKey: .activeCount) ?? 0)
        totalTurnover = try c.decodeFlexibleDouble(forKey: .totalTurnover) ?? 0
        totalNet = try c.decodeFlexibleDouble(forKey: .totalNet) ?? 0
        avgRevenuePerShift = try c.decodeFlexibleDouble(forKey: .avgRevenuePerShift) ?? 0
        salarySpread = ((try? c.decodeIfPresent(TeamSalarySpread.self, forKey: .salarySpread)) ?? nil) ?? .zero
    }

    private enum CodingKeys: String, CodingKey {
        case dateFrom, dateTo, operatorsCount, activeCount
        case totalTurnover, totalNet, avgRevenuePerShift, salarySpread
    }
}

/// Ответ `GET /api/ai/team-analysis`.
public struct TeamAnalysisReport: Decodable, Sendable {
    public let operators: [TeamAnalysisOperator]
    public let aggregates: TeamAnalysisAggregates
    public let insights: [AiInsight]
    public let summary: String

    private struct Metrics: Decodable {
        let operators: [TeamAnalysisOperator]?
        let aggregates: TeamAnalysisAggregates?
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let metrics = (try? c.decodeIfPresent(Metrics.self, forKey: .metrics)) ?? nil
        operators = metrics?.operators ?? []
        aggregates = metrics?.aggregates ?? .zero
        insights = ((try? c.decodeIfPresent([AiInsight].self, forKey: .insights)) ?? nil) ?? []
        summary = try c.decodeFlexibleString(forKey: .summary) ?? ""
    }

    private enum CodingKeys: String, CodingKey { case metrics, insights, summary }
}

// ── Сервис ───────────────────────────────────────────────────────────────────

/// Периоды, которые принимают AI-роуты. Значения не произвольные: сервер
/// сверяет их со списком и молча заменяет чужое на своё умолчание.
public enum InsightPeriod: Int, Sendable, CaseIterable, Identifiable {
    case week = 7
    case twoWeeks = 14
    case month = 30
    case twoMonths = 60
    case quarter = 90
    case halfYear = 180
    case year = 365

    public var id: Int { rawValue }

    public var label: String {
        switch self {
        case .week: "7 дней"
        case .twoWeeks: "14 дней"
        case .month: "30 дней"
        case .twoMonths: "60 дней"
        case .quarter: "90 дней"
        case .halfYear: "180 дней"
        case .year: "Год"
        }
    }

    public static let cfoOptions: [InsightPeriod] = [.week, .month, .quarter, .year]
    public static let expenseOptions: [InsightPeriod] = [.month, .quarter, .halfYear, .year]
    public static let teamOptions: [InsightPeriod] = [.week, .twoWeeks, .month, .twoMonths, .quarter]
}

/// Доступ к AI-аналитике.
///
/// Разделяем два вида запросов. Одни считает сервер формулами — они дешёвые
/// и быстрые. Другие уходят в языковую модель: это десятки секунд ожидания
/// и деньги владельца за каждый вызов, поэтому такие методы вызываются
/// только по явному действию, а не при открытии экрана.
public struct InsightService: Sendable {
    private let api: APIClient

    public init(api: APIClient) { self.api = api }

    // ── Считает сервер, ИИ не участвует ──────────────────────────────────────

    /// Прогноз на следующий месяц по закономерностям прошлых.
    public func monthlyForecast(companyID: String? = nil) async throws -> MonthlyForecastBundle {
        var query: [String: String] = [:]
        if let companyID, !companyID.isEmpty { query["company_id"] = companyID }
        return try await api.send(APIRequest(path: "/api/admin/monthly-forecast", query: query))
    }

    /// Набор управленческих формул на данных организации.
    public func businessIntelligence(days: Int? = nil) async throws -> BusinessIntelligence {
        var query: [String: String] = [:]
        if let days { query["days"] = String(days) }
        let response: Envelope<BusinessIntelligence> = try await api.send(
            APIRequest(path: "/api/admin/business-intelligence", query: query)
        )
        return response.data
    }

    // ── Обращается к языковой модели ─────────────────────────────────────────

    /// Короткий вывод по месячному прогнозу.
    public func explainForecast(_ report: MonthlyForecastReport) async throws -> String {
        struct Reply: Decodable, Sendable { let text: String? }
        let request = try APIRequest.json(
            "/api/admin/monthly-forecast/ai",
            body: MonthlyForecastAiRequest(report: report)
        )
        let reply: Reply = try await api.send(request)
        return reply.text ?? ""
    }

    /// Прогноз на 30/60/90 дней с разбором.
    ///
    /// Стрим не используем: сервер отдаёт тот же результат обычным JSON, а
    /// текст по кусочкам нужен там, где его читают по мере набора.
    public func aiForecast(companyID: String? = nil) async throws -> AiForecastReport {
        struct Body: Encodable, Sendable {
            let company_id: String?
            let stream: Bool
        }
        let request = try APIRequest.json(
            "/api/ai/forecast",
            body: Body(company_id: companyID?.isEmpty == false ? companyID : nil, stream: false)
        )
        return try await api.send(request)
    }

    /// Приоритеты на сегодня по бизнес-аналитике.
    public func priorityActions(days: Int? = nil) async throws -> [String] {
        struct Body: Encodable, Sendable { let days: Int? }
        let request = try APIRequest.json("/api/ai/business-intelligence", body: Body(days: days))
        let reply: BiPriorityActions = try await api.send(request)
        return reply.actions
    }

    /// Полный финансовый аудит за период.
    public func cfo(days: InsightPeriod) async throws -> CfoReport {
        struct Body: Encodable, Sendable { let days: Int }
        let request = try APIRequest.json("/api/ai/cfo", body: Body(days: days.rawValue))
        return try await api.send(request)
    }

    /// Разбор расходов по категориям.
    public func expenseAnalysis(days: InsightPeriod, companyID: String? = nil) async throws -> ExpenseAnalysisReport {
        var query = ["days": String(days.rawValue)]
        if let companyID, !companyID.isEmpty { query["company_id"] = companyID }
        return try await api.send(APIRequest(path: "/api/ai/expense-analysis", query: query))
    }

    /// Разбор команды по операторам.
    public func teamAnalysis(days: InsightPeriod, companyID: String? = nil) async throws -> TeamAnalysisReport {
        var query = ["days": String(days.rawValue)]
        if let companyID, !companyID.isEmpty { query["company_id"] = companyID }
        return try await api.send(APIRequest(path: "/api/ai/team-analysis", query: query))
    }
}
