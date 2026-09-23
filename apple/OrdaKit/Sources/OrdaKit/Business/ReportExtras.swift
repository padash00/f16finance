import Foundation

// ── Прогноз, тепловая карта, PDF и разбор ИИ для «Отчётов» ──────────────────
//
// Всё — как на странице /reports сайта: прогноз — порт
// `lib/reports/forecast-hybrid.ts` и линейного запасного варианта из
// `page-body.tsx`, тело PDF — то же, что собирает `handleDownloadPdf`, запрос
// разбора ИИ — то же, что шлёт `AIInsightCard`.

/// Подсказки сервера для прогноза: прошлый месяц целиком и его начало той же
/// длины, что прошла в текущем.
public struct ReportForecastHints: Decodable, Sendable, Hashable {
    public struct Range: Decodable, Sendable, Hashable {
        public let from: String
        public let to: String
        public let totalIncome: Double
        public let totalExpense: Double
        public let profit: Double
        public let days: Int

        public init(from: String, to: String, totalIncome: Double, totalExpense: Double, profit: Double, days: Int = 0) {
            self.from = from
            self.to = to
            self.totalIncome = totalIncome
            self.totalExpense = totalExpense
            self.profit = profit
            self.days = days
        }

        public init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            from = try c.decodeFlexibleString(forKey: .from) ?? ""
            to = try c.decodeFlexibleString(forKey: .to) ?? ""
            totalIncome = try c.decodeFlexibleDouble(forKey: .totalIncome) ?? 0
            totalExpense = try c.decodeFlexibleDouble(forKey: .totalExpense) ?? 0
            profit = try c.decodeFlexibleDouble(forKey: .profit) ?? 0
            days = Int(try c.decodeFlexibleDouble(forKey: .days) ?? 0)
        }

        private enum CodingKeys: String, CodingKey { case from, to, totalIncome, totalExpense, profit, days }
    }

    public let lastFullMonth: Range
    public let lastMonthMtd: Range

    public init(lastFullMonth: Range, lastMonthMtd: Range) {
        self.lastFullMonth = lastFullMonth
        self.lastMonthMtd = lastMonthMtd
    }
}

/// Прогноз на конец периода.
public struct ReportForecast: Sendable, Hashable {
    public let remainingDays: Int
    public let forecastIncome: Double
    public let forecastExpense: Double
    public let forecastProfit: Double
    /// Уверенность в процентах, 48…95.
    public let confidence: Double
    public let runRateIncome: Double
    public let seasonalIncome: Double
    public let note: String

    // ── Даты ─────────────────────────────────────────────────────────────────

    private static var calendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }

    private static func parse(_ iso: String) -> Date? {
        let parts = iso.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    private static func dayDiff(_ a: Date, _ b: Date) -> Int {
        calendar.dateComponents([.day], from: a, to: b).day ?? 0
    }

    /// Ровно календарный месяц: с 1-го по последнее число одного месяца.
    public static func isFullMonthRange(_ from: String, _ to: String) -> Bool {
        guard let a = parse(from), let b = parse(to) else { return false }
        let ca = calendar.dateComponents([.year, .month, .day], from: a)
        let cb = calendar.dateComponents([.year, .month, .day], from: b)
        guard ca.year == cb.year, ca.month == cb.month, ca.day == 1 else { return false }
        let days = calendar.range(of: .day, in: .month, for: a)?.count ?? 0
        return cb.day == days
    }

    /// «2026-08» — месяц перед месяцем даты.
    static func previousMonthKey(_ anchor: String) -> String {
        guard let d = parse(anchor), let prev = calendar.date(byAdding: .month, value: -1, to: d) else { return "" }
        let c = calendar.dateComponents([.year, .month], from: prev)
        return String(format: "%04d-%02d", c.year ?? 0, c.month ?? 0)
    }

    /// `Math.round` из JS: половинки — вверх, в том числе у отрицательных.
    static func jsRound(_ x: Double) -> Double { (x + 0.5).rounded(.down) }

    // ── Гибрид (lib/reports/forecast-hybrid.ts) ──────────────────────────────

    /// Гибридный прогноз на конец календарного месяца: текущий темп и «хвост»
    /// прошлого месяца, ближе к концу месяца вес у темпа больше.
    public static func monthEnd(
        dateFrom: String,
        dateTo: String,
        asOf: String,
        mtdIncome: Double,
        mtdExpense: Double,
        hints: ReportForecastHints?
    ) -> ReportForecast? {
        guard isFullMonthRange(dateFrom, dateTo), let hints else { return nil }
        guard asOf >= dateFrom, asOf <= dateTo else { return nil }
        guard let start = parse(dateFrom), let asOfD = parse(asOf), let end = parse(dateTo) else { return nil }

        let daysPassed = max(1, dayDiff(start, asOfD) + 1)
        let totalDays = dayDiff(start, end) + 1
        let remainingDays = max(0, totalDays - daysPassed)
        guard remainingDays > 0 else { return nil }

        let last = hints.lastFullMonth
        let lastMtd = hints.lastMonthMtd

        let avgIn = mtdIncome / Double(daysPassed)
        let avgEx = mtdExpense / Double(daysPassed)
        let runRateIncome = mtdIncome + avgIn * Double(remainingDays)
        let runRateExpense = mtdExpense + avgEx * Double(remainingDays)

        let lastMonthRemainingDays = Double(max(1, last.totalIncome > 0 ? totalDays - lastMtd.days : totalDays))
        let tailIncome = last.totalIncome - lastMtd.totalIncome > 0
            ? (last.totalIncome - lastMtd.totalIncome) / lastMonthRemainingDays
            : last.totalIncome / Double(totalDays)
        let tailExpense = last.totalExpense - lastMtd.totalExpense > 0
            ? (last.totalExpense - lastMtd.totalExpense) / lastMonthRemainingDays
            : last.totalExpense / Double(totalDays)

        let seasonalIncome = mtdIncome + tailIncome * Double(remainingDays)
        let seasonalExpense = mtdExpense + tailExpense * Double(remainingDays)

        let w = min(0.85, max(0.25, Double(daysPassed) / Double(totalDays)))
        let forecastIncome = jsRound(w * runRateIncome + (1 - w) * seasonalIncome)
        let forecastExpense = jsRound(w * runRateExpense + (1 - w) * seasonalExpense)
        let confidence = min(92, max(48, 52 + (Double(daysPassed) / Double(totalDays)) * 38))

        return ReportForecast(
            remainingDays: remainingDays,
            forecastIncome: forecastIncome,
            forecastExpense: forecastExpense,
            forecastProfit: forecastIncome - forecastExpense,
            confidence: confidence,
            runRateIncome: runRateIncome,
            seasonalIncome: seasonalIncome,
            note: "Смешение: \(String(format: "%.0f", w * 100))% по текущему темпу, \(String(format: "%.0f", (1 - w) * 100))% по «хвосту» \(previousMonthKey(dateFrom))"
        )
    }

    /// Прогноз для любого идущего сейчас периода: гибрид для календарного
    /// месяца, иначе линейно по накопленному факту — как на сайте.
    public static func forPeriod(
        dateFrom: String,
        dateTo: String,
        asOf: String,
        income: Double,
        expense: Double,
        profit: Double,
        hints: ReportForecastHints?
    ) -> ReportForecast? {
        guard dateFrom <= asOf, asOf < dateTo else { return nil }
        if let hybrid = monthEnd(dateFrom: dateFrom, dateTo: dateTo, asOf: asOf, mtdIncome: income, mtdExpense: expense, hints: hints) {
            return hybrid
        }
        guard let start = parse(dateFrom), let end = parse(dateTo), let asOfD = parse(asOf) else { return nil }
        let daysPassed = max(1, dayDiff(start, asOfD) + 1)
        let totalDays = dayDiff(start, end) + 1
        let remainingDays = max(0, totalDays - daysPassed)
        guard remainingDays > 0 else { return nil }
        let passed = Double(daysPassed)
        let rest = Double(remainingDays)
        return ReportForecast(
            remainingDays: remainingDays,
            forecastIncome: jsRound(income + income / passed * rest),
            forecastExpense: jsRound(expense + expense / passed * rest),
            forecastProfit: jsRound(profit + profit / passed * rest),
            confidence: min(95, max(50, 60 + (passed / Double(totalDays)) * 40)),
            runRateIncome: 0,
            seasonalIncome: 0,
            note: "Линейная экстраполяция по накопленному факту"
        )
    }
}

// ── Тепловая карта прибыли ───────────────────────────────────────────────────

/// Клетка тепловой карты: день или месяц.
public struct ProfitHeatCell: Sendable, Hashable, Identifiable {
    public let key: String
    public let label: String
    public let from: String
    public let to: String
    public var income: Double
    public var expense: Double

    public var id: String { key }
    public var profit: Double { income - expense }
}

public struct ProfitHeatmap: Sendable, Hashable {
    /// Дольше — клетка на месяц, а не на день: 365 крошечных клеток не читаются.
    public static let dailyMaxDays = 93

    public let cells: [ProfitHeatCell]
    public let byMonth: Bool
    /// Пустых клеток перед первым днём, чтобы понедельник стоял в первом столбце.
    public let leadingBlanks: Int
    public let maxAbsProfit: Double

    /// Как `ProfitHeatmap` на сайте: по дням до 93 дней, дальше по месяцам.
    public static func build(from: String, to: String, dailyIncome: [String: Double], dailyExpense: [String: Double]) -> ProfitHeatmap {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let parse: (String) -> Date? = { iso in
            let p = iso.prefix(10).split(separator: "-").compactMap { Int($0) }
            guard p.count == 3 else { return nil }
            return calendar.date(from: DateComponents(year: p[0], month: p[1], day: p[2]))
        }
        guard let start = parse(from), let end = parse(to), start <= end else {
            return ProfitHeatmap(cells: [], byMonth: false, leadingBlanks: 0, maxAbsProfit: 0)
        }
        let total = (calendar.dateComponents([.day], from: start, to: end).day ?? 0) + 1
        let byMonth = total > dailyMaxDays
        var cells: [ProfitHeatCell] = []
        var monthIndex: [String: Int] = [:]
        for offset in 0..<total {
            guard let day = calendar.date(byAdding: .day, value: offset, to: start) else { continue }
            let c = calendar.dateComponents([.year, .month, .day], from: day)
            let iso = String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
            let income = dailyIncome[iso] ?? 0
            let expense = dailyExpense[iso] ?? 0
            if !byMonth {
                cells.append(ProfitHeatCell(key: iso, label: String(c.day ?? 0), from: iso, to: iso, income: income, expense: expense))
                continue
            }
            let key = String(iso.prefix(7))
            if let index = monthIndex[key] {
                cells[index].income += income
                cells[index].expense += expense
                cells[index] = ProfitHeatCell(key: key, label: cells[index].label, from: cells[index].from, to: iso,
                                              income: cells[index].income, expense: cells[index].expense)
            } else {
                monthIndex[key] = cells.count
                cells.append(ProfitHeatCell(key: key, label: monthLabel(c.month ?? 1, year: c.year ?? 0), from: iso, to: iso, income: income, expense: expense))
            }
        }
        let weekday = calendar.component(.weekday, from: start) // 1 — воскресенье
        let blanks = byMonth ? 0 : (weekday + 5) % 7
        let maxAbs = cells.map { abs($0.profit) }.max() ?? 0
        return ProfitHeatmap(cells: cells, byMonth: byMonth, leadingBlanks: blanks, maxAbsProfit: maxAbs)
    }

    private static func monthLabel(_ month: Int, year: Int) -> String {
        let names = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]
        return "\(names[max(0, min(11, month - 1))]) \(year)"
    }
}

// ── PDF и разбор ИИ ──────────────────────────────────────────────────────────

public enum ReportExport {
    /// Тело `POST /api/admin/reports/pdf` с `kind: finreport` — поля как у
    /// `handleDownloadPdf` на сайте.
    public static func finreportBody(
        aggregate: ReportAggregate,
        operations: [ReportOperation],
        companyLabel: String,
        companyName: (String?) -> String,
        generated: Date = Date()
    ) throws -> Data {
        let cur = aggregate.current
        let prev = aggregate.previous
        let generatedFormatter = DateFormatter()
        generatedFormatter.locale = Locale(identifier: "ru_RU")
        generatedFormatter.dateFormat = "dd.MM.yyyy, HH:mm:ss"
        let round: (Double) -> Double = { ReportForecast.jsRound($0) }

        let rows = operations
            .filter { $0.amount != 0 }
            .sorted { $0.date > $1.date }
            .map { op -> [String: Any] in
                let isIncome = op.kind == .income
                return [
                    "date": op.date,
                    "type": isIncome ? "Доход" : "Расход",
                    "company": companyName(op.companyID),
                    "cat": (isIncome ? nil : op.title) ?? op.shift ?? "",
                    "amount": round(op.amount),
                    "cash": round(op.cash),
                    "cashless": round(op.kaspi + (isIncome ? op.online + op.card : 0)),
                    "online": isIncome ? round(op.online) : 0,
                    "card": isIncome ? round(op.card) : 0,
                    "note": op.zone ?? op.comment ?? "",
                ]
            }

        let data: [String: Any] = [
            "meta": [
                "title": "Финансовый отчёт",
                "period": "\(aggregate.dateFrom) — \(aggregate.dateTo)",
                "company": companyLabel,
                "generated": generatedFormatter.string(from: generated),
            ],
            "kpi": [
                "revenue": cur.totalIncome,
                "revenuePrev": prev.totalIncome,
                "expense": cur.totalExpense,
                "expensePrev": prev.totalExpense,
                "profit": cur.profit,
                "profitPrev": prev.profit,
                "avgCheck": cur.avgTransaction,
                "txns": cur.transactionCount,
            ],
            "summary": [
                ["section": "ОСНОВНЫЕ ПОКАЗАТЕЛИ"],
                ["label": "Выручка", "cur": cur.totalIncome, "prev": prev.totalIncome],
                ["label": "Расходы", "cur": cur.totalExpense, "prev": prev.totalExpense],
                ["label": "Прибыль", "cur": cur.profit, "prev": prev.profit, "strong": true],
                ["section": "СТРУКТУРА ДОХОДОВ"],
                ["label": "Наличные", "cur": cur.incomeCash, "prev": prev.incomeCash],
                ["label": "Безналичный доход", "cur": cur.incomeNonCash, "prev": prev.incomeNonCash],
                ["label": "Онлайн", "cur": cur.incomeOnline, "prev": prev.incomeOnline],
                ["label": "Карта", "cur": cur.incomeCard, "prev": prev.incomeCard],
            ] as [[String: Any]],
            "byCompany": aggregate.companyIncome.map { c -> [String: Any] in
                [
                    "name": c.name,
                    "revenue": c.amount,
                    "cash": c.cash,
                    "cashless": c.kaspi + c.online + c.card,
                    "online": c.online,
                    "card": c.card,
                    "txns": c.count,
                ]
            },
            "expenses": aggregate.expenseCategories.map { ["name": $0.name, "amount": $0.amount] as [String: Any] },
            "operations": rows,
        ]
        return try JSONSerialization.data(withJSONObject: ["kind": "finreport", "data": data])
    }

    /// Тело `POST /api/admin/reports/insight` — как у `AIInsightCard`.
    public static func insightBody(aggregate: ReportAggregate, cashlessLabel: String = "Kaspi") throws -> Data {
        let cur = aggregate.current
        let prev = aggregate.previous
        let body: [String: Any] = [
            "dateFrom": aggregate.dateFrom,
            "dateTo": aggregate.dateTo,
            "totals": [
                "incomeTotal": cur.totalIncome,
                "expenseTotal": cur.totalExpense,
                "profit": cur.profit,
                "incomeCash": cur.incomeCash,
                "incomeKaspi": cur.incomeKaspi,
                "incomeOnline": cur.incomeOnline,
                "incomeCard": cur.incomeCard,
            ],
            "totalsPrev": [
                "incomeTotal": prev.totalIncome,
                "expenseTotal": prev.totalExpense,
                "profit": prev.profit,
            ],
            "topIncome": aggregate.companyIncome.prefix(3).map { ["name": $0.name, "value": $0.amount] as [String: Any] },
            "topExpense": aggregate.expenseCategories.prefix(3).map { ["name": $0.name, "value": $0.amount] as [String: Any] },
            "cashlessLabel": cashlessLabel,
        ]
        return try JSONSerialization.data(withJSONObject: body)
    }
}

/// Ответ разбора ИИ: `{ text }`.
public struct ReportInsight: Decodable, Sendable {
    public let text: String
}

extension BusinessService {
    /// PDF финансового отчёта. Сервер собирает его из присланных цифр.
    public func reportPDF(body: Data) async throws -> Data {
        try await api.send(APIRequest(path: "/api/admin/reports/pdf", method: .post, body: body))
    }

    /// Короткий разбор периода ИИ. Платный вызов — только по кнопке.
    public func reportInsight(body: Data) async throws -> String {
        let response: ReportInsight = try await api.send(APIRequest(path: "/api/admin/reports/insight", method: .post, body: body))
        return response.text
    }
}
