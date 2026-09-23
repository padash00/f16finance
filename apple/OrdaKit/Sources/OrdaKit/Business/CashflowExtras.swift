import Foundation

// ── Движение денег: отметки остатка, разбор ИИ, PDF ─────────────────────────
//
// То же, что на сайте (`app/(main)/cashflow/page-body.tsx`): диалог «Остаток
// денег», кнопка «Разбор ИИ» и выгрузка PDF. Снимок для ИИ и данные PDF
// собираются здесь по тем же правилам, что на странице, — иначе ИИ в
// телефоне отвечал бы по другим цифрам, а PDF расходился бы с сайтом.

extension CashflowAnchor: Identifiable {}

/// Ответ `GET /api/admin/cashflow/balance`.
public struct CashflowAnchorList: Decodable, Sendable {
    public let anchors: [CashflowAnchor]
    /// Указывать и удалять отметки может владелец или управляющий.
    public let canEdit: Bool
    /// Функция включена: без миграции таблицы сервер отвечает `false` и
    /// подсказкой, что сделать.
    public let available: Bool
    public let hint: String?

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        anchors = (try? c.decodeIfPresent([CashflowAnchor].self, forKey: .anchors)) as? [CashflowAnchor] ?? []
        canEdit = (try? c.decodeIfPresent(Bool.self, forKey: .canEdit)) as? Bool ?? false
        available = (try? c.decodeIfPresent(Bool.self, forKey: .available)) as? Bool ?? true
        hint = try? c.decodeIfPresent(String.self, forKey: .hint)
    }

    private enum CodingKeys: String, CodingKey { case anchors, canEdit, available, hint }
}

/// Новая отметка остатка: сколько было денег на утро даты — до движений дня.
public struct CashflowAnchorDraft: Sendable, Equatable {
    /// `nil` — вся организация.
    public var companyID: String?
    public var date: String
    public var cash: Double
    public var cashless: Double
    public var note: String

    public init(companyID: String? = nil, date: String, cash: Double = 0, cashless: Double = 0, note: String = "") {
        self.companyID = companyID
        self.date = date
        self.cash = cash
        self.cashless = cashless
        self.note = note
    }

    /// Тело запроса — ключи ровно как у сайта.
    public func body() throws -> Data {
        try JSONSerialization.data(withJSONObject: [
            "company_id": companyID ?? NSNull(),
            "as_of_date": date,
            "cash_amount": cash,
            "cashless_amount": cashless,
            "note": note.trimmingCharacters(in: .whitespacesAndNewlines),
        ] as [String: Any])
    }
}

/// Ответ `POST /api/ai/assistant`.
struct CashflowAssistantReply: Decodable, Sendable {
    let text: String?
    let error: String?
}

extension CashflowService {
    public func balanceAnchors() async throws -> CashflowAnchorList {
        let response: Envelope<CashflowAnchorList> = try await api.send(
            APIRequest(path: "/api/admin/cashflow/balance")
        )
        return response.data
    }

    public func saveBalanceAnchor(_ draft: CashflowAnchorDraft) async throws {
        _ = try await api.send(APIRequest(path: "/api/admin/cashflow/balance", method: .post, body: try draft.body()))
    }

    public func deleteBalanceAnchor(id: String) async throws {
        _ = try await api.send(APIRequest(path: "/api/admin/cashflow/balance", method: .delete, query: ["id": id]))
    }

    /// Разбор ИИ. Требует `cashflow.ai_analysis`.
    public func aiAnalysis(_ report: CashflowReport, now: Date = Date()) async throws -> String {
        let body = try JSONSerialization.data(withJSONObject: [
            "page": "cashflow",
            "prompt": CashflowExport.aiPrompt,
            "snapshot": CashflowExport.aiSnapshot(report, now: now),
        ] as [String: Any])
        let reply: CashflowAssistantReply = try await api.send(
            APIRequest(path: "/api/ai/assistant", method: .post, body: body)
        )
        guard let text = reply.text, !text.isEmpty else {
            throw APIError.transport(message: reply.error ?? "ИИ не ответил")
        }
        return text
    }

    /// PDF — тот же «premium»-отчёт, что скачивают на сайте. Требует
    /// `cashflow.export`.
    public func pdf(_ report: CashflowReport, now: Date = Date()) async throws -> Data {
        let body = try JSONSerialization.data(withJSONObject: [
            "kind": "premium",
            "data": CashflowExport.pdfData(report, now: now),
        ] as [String: Any])
        return try await api.send(APIRequest(path: "/api/admin/reports/pdf", method: .post, body: body))
    }
}

/// Сборка снимка для ИИ и данных PDF — слово в слово как на сайте.
public enum CashflowExport {
    static let aiPrompt = "Разбери движение денег за период: 3 коротких вывода с цифрами — что хорошо, что тревожит (особенно наличные и крупные выплаты) и одно главное действие. Безналичные оплаты называй «Безналичный»."

    /// Целое с разрядами, как `toLocaleString('ru-RU')`.
    static func grouped(_ value: Double) -> String {
        let rounded = Int((value.isFinite ? value : 0).rounded())
        let digits = String(abs(rounded))
        var out = ""
        for (index, char) in digits.enumerated() {
            if index > 0, (digits.count - index) % 3 == 0 { out.append("\u{00A0}") }
            out.append(char)
        }
        return rounded < 0 ? "-" + out : out
    }

    static func money(_ value: Double) -> String { "\(grouped(value)) ₸" }

    static func signed(_ value: Double) -> String {
        let rounded = value.rounded()
        let sign = rounded > 0 ? "+" : rounded < 0 ? "−" : ""
        return "\(sign)\(grouped(abs(rounded))) ₸"
    }

    public static func aiSnapshot(_ report: CashflowReport, now: Date = Date()) -> [String: Any] {
        let f = report.flows
        var summary = [
            "Пришло \(money(f.total.inflow)), ушло \(money(f.total.outflow)), чистый поток \(signed(f.total.net))",
            "Наличные: пришло \(money(f.cash.inflow)), ушло \(money(f.cash.outflow)); безналичный: пришло \(money(f.cashless.inflow)), ушло \(money(f.cashless.outflow))",
        ]
        if let balance = report.balance, let end = balance.end {
            let lowest = balance.lowest.map { " \(money($0.total)) \($0.date)" } ?? ""
            summary.append("Остаток на конец периода \(money(end.total)) (нал \(money(end.cash)), безнал \(money(end.cashless))), минимум\(lowest)")
        } else {
            summary.append("Остаток денег не указан")
        }
        summary.append("Прошлый период: пришло \(money(report.previous.total.inflow)), ушло \(money(report.previous.total.outflow))")

        return [
            "page": "cashflow",
            "title": "Движение денег",
            "generatedAt": ISO8601DateFormatter().string(from: now),
            "route": "/cashflow",
            "period": ["from": report.dateFrom, "to": report.dateTo],
            "summary": summary,
            "sections": [
                ["title": "Куда ушли деньги", "bullets": report.activities.map { "\($0.label): \(money($0.amount)) (было \(money($0.previous)))" }],
                ["title": "Крупные статьи", "bullets": report.categories.prefix(8).map { "\($0.name): \(money($0.amount))" }],
                ["title": "Дни, когда наличных ушло больше", "bullets": report.cashDeficitDays.prefix(6).map { "\($0.date): \(signed($0.net))" }],
            ],
        ]
    }

    public static func pdfData(_ report: CashflowReport, now: Date = Date()) -> [String: Any] {
        let f = report.flows
        let nf = { (value: Double) in grouped(value) }
        let generated: String = {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "ru_RU")
            formatter.dateFormat = "dd.MM.yyyy, HH:mm:ss"
            return formatter.string(from: now)
        }()
        let hasBalance = report.balance?.end != nil

        var kpis: [[String: Any]] = [
            ["label": "Пришло", "value": "\(nf(f.total.inflow)) тг", "sub": "нал \(nf(f.cash.inflow)) · безнал \(nf(f.cashless.inflow))"],
            ["label": "Ушло", "value": "\(nf(f.total.outflow)) тг", "sub": "нал \(nf(f.cash.outflow)) · безнал \(nf(f.cashless.outflow))"],
        ]
        var net: [String: Any] = ["label": "Чистый поток", "value": "\(nf(f.total.net)) тг"]
        if f.total.net < 0 { net["tone"] = "bad" }
        kpis.append(net)
        if let end = report.balance?.end {
            var item: [String: Any] = ["label": "Остаток на конец", "value": "\(nf(end.total)) тг", "sub": "нал \(nf(end.cash)) · безнал \(nf(end.cashless))"]
            if end.total < 0 { item["tone"] = "bad" }
            kpis.append(item)
        } else {
            kpis.append(["label": "Накоплено за период", "value": "\(nf(report.totals.endingBalance)) тг", "sub": "остаток не указан"])
        }

        let maxActivity = max(1, report.activities.map(\.amount).max() ?? 1)
        let columns: [[String: Any]] = [
            ["key": "date", "label": "Дата", "w": "16%"],
            ["key": "income", "label": "Пришло", "align": "right", "w": "17%"],
            ["key": "expenses", "label": "Ушло", "align": "right", "w": "17%"],
            ["key": "profit", "label": "Поток за день", "align": "right", "signed": true, "w": "17%"],
            ["key": "balance", "label": hasBalance ? "Остаток" : "Накоплено", "align": "right", "signed": true, "w": "17%"],
            ["key": "cash", "label": "Нал за день", "align": "right", "signed": true, "w": "16%"],
        ]
        let rows: [[String: Any]] = report.days.map { day in
            [
                "date": day.date,
                "income": day.income,
                "expenses": day.expense,
                "profit": day.net,
                "balance": day.onHand?.total ?? day.balance,
                "cash": day.cashIn - day.cashOut,
            ]
        }

        return [
            "meta": [
                "title": "Движение денег",
                "period": "\(report.dateFrom) — \(report.dateTo)",
                "generated": generated,
                "brandNote": "поступления, расходы и остаток",
            ],
            "kpis": kpis,
            "sections": [
                [
                    "type": "bars",
                    "title": "Куда ушли деньги",
                    "hint": "по назначению",
                    "items": report.activities.map { activity -> [String: Any] in
                        ["label": activity.label, "amount": activity.amount, "ratio": activity.amount / maxActivity, "color": "#f97316"]
                    },
                ] as [String: Any],
            ],
            "detail": [
                "title": "По дням",
                "subtitle": "поступления, расходы, поток и остаток",
                "columns": columns,
                "rows": rows,
                "total": [
                    "date": NSNull(),
                    "income": f.total.inflow,
                    "expenses": f.total.outflow,
                    "profit": f.total.net,
                    "balance": report.balance?.end?.total ?? report.totals.endingBalance,
                    "cash": f.cash.net,
                ] as [String: Any],
            ] as [String: Any],
        ]
    }

    /// Имя файла как на сайте: `Dvizhenie_deneg_<from>_<to>.pdf`.
    public static func pdfFileName(_ report: CashflowReport) -> String {
        "Dvizhenie_deneg_\(report.dateFrom)_\(report.dateTo).pdf"
    }
}
