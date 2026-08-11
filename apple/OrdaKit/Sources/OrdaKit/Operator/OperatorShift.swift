import Foundation

/// Смена на точке. Зеркало таблицы `point_shifts`.
///
/// Смена — центральная сущность операторского дня: без открытой смены нельзя
/// продавать (сервер отвечает 409), а при закрытии сходятся деньги.
public struct OperatorShift: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let companyID: String
    public let status: String
    public let shiftType: String?
    public let openedAt: Date?
    public let closedAt: Date?
    public let openingCash: Double?
    public let openingNotes: String?
    public let handoverFromShiftID: String?
    /// Кассир, открывший смену. Закрыть её может только он.
    public let operatorName: String?

    public var isOpen: Bool { status == "open" }

    /// Сколько смена уже идёт.
    public var duration: TimeInterval? {
        guard let openedAt else { return nil }
        return Date().timeIntervalSince(openedAt)
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case companyID = "company_id"
        case status
        case shiftType = "shift_type"
        case openedAt = "opened_at"
        case closedAt = "closed_at"
        case openingCash = "opening_cash"
        case openingNotes = "opening_notes"
        case handoverFromShiftID = "handover_from_shift_id"
        case `operator`
    }

    /// Вложенный кассир из join'а `staff`.
    private struct OperatorRef: Decodable {
        let full_name: String?
        let short_name: String?
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        companyID = try container.decodeIfPresent(String.self, forKey: .companyID) ?? ""
        status = try container.decodeIfPresent(String.self, forKey: .status) ?? "open"
        shiftType = try container.decodeIfPresent(String.self, forKey: .shiftType)
        openedAt = try container.decodeIfPresent(Date.self, forKey: .openedAt)
        closedAt = try container.decodeIfPresent(Date.self, forKey: .closedAt)
        openingCash = try container.decodeIfPresent(Double.self, forKey: .openingCash)
        openingNotes = try container.decodeIfPresent(String.self, forKey: .openingNotes)
        handoverFromShiftID = try container.decodeIfPresent(String.self, forKey: .handoverFromShiftID)

        // PostgREST отдаёт связь «к одному» объектом, но при некоторых
        // формулировках select — массивом. Принимаем оба вида, иначе экран
        // смены падает на ровном месте.
        if let single = try? container.decodeIfPresent(OperatorRef.self, forKey: .operator) {
            operatorName = single.short_name ?? single.full_name
        } else if let many = try? container.decodeIfPresent([OperatorRef].self, forKey: .operator),
                  let first = many.first {
            operatorName = first.short_name ?? first.full_name
        } else {
            operatorName = nil
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(companyID, forKey: .companyID)
        try container.encode(status, forKey: .status)
        try container.encodeIfPresent(shiftType, forKey: .shiftType)
        try container.encodeIfPresent(openedAt, forKey: .openedAt)
        try container.encodeIfPresent(closedAt, forKey: .closedAt)
        try container.encodeIfPresent(openingCash, forKey: .openingCash)
        try container.encodeIfPresent(openingNotes, forKey: .openingNotes)
        try container.encodeIfPresent(handoverFromShiftID, forKey: .handoverFromShiftID)
    }
}

/// Итоги смены. Считает сервер, постранично — иначе на смене с >1000 чеков
/// PostgREST молча обрежет выборку и деньги не сойдутся.
public struct ShiftTotals: Codable, Sendable, Hashable {
    public let salesCount: Int
    public let salesTotal: Double
    public let salesCash: Double
    public let salesKaspi: Double
    public let returnsCount: Int
    public let returnsTotal: Double
    public let returnsCash: Double
    public let returnsKaspi: Double

    /// Выручка за вычетом возвратов — то, что реально заработано.
    public var netTotal: Double { salesTotal - returnsTotal }
    /// Сколько наличных должно быть в кассе сверх стартовой суммы.
    public var expectedCash: Double { salesCash - returnsCash }
    public var expectedKaspi: Double { salesKaspi - returnsKaspi }

    public static let empty = ShiftTotals(
        salesCount: 0, salesTotal: 0, salesCash: 0, salesKaspi: 0,
        returnsCount: 0, returnsTotal: 0, returnsCash: 0, returnsKaspi: 0
    )

    public init(
        salesCount: Int, salesTotal: Double, salesCash: Double, salesKaspi: Double,
        returnsCount: Int, returnsTotal: Double, returnsCash: Double, returnsKaspi: Double
    ) {
        self.salesCount = salesCount
        self.salesTotal = salesTotal
        self.salesCash = salesCash
        self.salesKaspi = salesKaspi
        self.returnsCount = returnsCount
        self.returnsTotal = returnsTotal
        self.returnsCash = returnsCash
        self.returnsKaspi = returnsKaspi
    }

    private enum CodingKeys: String, CodingKey {
        case salesCount = "sales_count"
        case salesTotal = "sales_total"
        case salesCash = "sales_cash"
        case salesKaspi = "sales_kaspi"
        case returnsCount = "returns_count"
        case returnsTotal = "returns_total"
        case returnsCash = "returns_cash"
        case returnsKaspi = "returns_kaspi"
    }
}

/// Шаблон чек-листа смены.
public struct ChecklistTemplate: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let title: String
    public let description: String?
    public let scheduleType: String?
    public let recurrenceMinutes: Int?
    /// Обязательный: без него сервер не даст закрыть смену.
    public let blocksShift: Bool

    private enum CodingKeys: String, CodingKey {
        case id, title, description
        case scheduleType = "schedule_type"
        case recurrenceMinutes = "recurrence_minutes"
        case blocksShift = "blocks_shift"
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = try container.decodeIfPresent(String.self, forKey: .title) ?? "Чек-лист"
        description = try container.decodeIfPresent(String.self, forKey: .description)
        scheduleType = try container.decodeIfPresent(String.self, forKey: .scheduleType)
        recurrenceMinutes = try container.decodeIfPresent(Int.self, forKey: .recurrenceMinutes)
        blocksShift = try container.decodeIfPresent(Bool.self, forKey: .blocksShift) ?? false
    }
}

/// Запуск чек-листа в текущей смене.
public struct ChecklistRun: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let templateID: String
    public let status: String
    public let startedAt: Date?
    public let completedAt: Date?
    public let finesTotal: Double?
    public let bonusesTotal: Double?

    public var isCompleted: Bool { status == "completed" }

    private enum CodingKeys: String, CodingKey {
        case id, status
        case templateID = "template_id"
        case startedAt = "started_at"
        case completedAt = "completed_at"
        case finesTotal = "fines_total"
        case bonusesTotal = "bonuses_total"
    }
}

/// Статья базы знаний, которую оператор обязан подтвердить.
public struct PendingKnowledgeArticle: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let title: String
    public let severity: String?
    public let version: Int?
    public let summary: String?
}

/// Полное состояние смены — ответ `GET /api/operator/shift/current`.
///
/// Когда смена закрыта, сервер отдаёт только `{ "shift": null }`, поэтому все
/// остальные секции опциональны.
public struct ShiftState: Decodable, Sendable {
    public let shift: OperatorShift?
    public let totals: ShiftTotals
    public let templates: [ChecklistTemplate]
    public let runs: [ChecklistRun]
    public let pendingKnowledge: [PendingKnowledgeArticle]
    /// Моя ли это смена.
    ///
    /// Смену на точке открывает один человек, а приложение стоит у каждого:
    /// оператор, зашедший со своего телефона, видел выручку чужой смены и
    /// кнопку «Закрыть». Считает сервер — на клиенте такое не решают.
    public let isMine: Bool

    private enum CodingKeys: String, CodingKey {
        case shift, totals, checklists, knowledge
        case isMine = "is_mine"
    }

    private struct Checklists: Decodable {
        let templates: [ChecklistTemplate]?
        let runs: [ChecklistRun]?
    }

    private struct Knowledge: Decodable {
        let pending_confirmations: [PendingKnowledgeArticle]?
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        shift = try container.decodeIfPresent(OperatorShift.self, forKey: .shift)
        totals = try container.decodeIfPresent(ShiftTotals.self, forKey: .totals) ?? .empty

        let checklists = try container.decodeIfPresent(Checklists.self, forKey: .checklists)
        templates = checklists?.templates ?? []
        runs = checklists?.runs ?? []

        let knowledge = try container.decodeIfPresent(Knowledge.self, forKey: .knowledge)
        pendingKnowledge = knowledge?.pending_confirmations ?? []
        // Старый сервер поля не отдаёт: до его обновления считаем смену своей,
        // иначе приложение отберёт кнопку у того, кто смену и открыл.
        isMine = try container.decodeIfPresent(Bool.self, forKey: .isMine) ?? true
    }

    /// Обязательные чек-листы, которые ещё не завершены. Именно они не дадут
    /// закрыть смену — показываем их заранее, а не в момент отказа.
    public var blockingChecklists: [ChecklistTemplate] {
        let completed = Set(runs.filter(\.isCompleted).map(\.templateID))
        return templates.filter { $0.blocksShift && $0.scheduleType != "onboarding" && !completed.contains($0.id) }
    }
}

/// Ответ на открытие смены.
public struct ShiftOpenResult: Decodable, Sendable {
    public let shiftID: String
    public let openingCash: Double?

    private enum CodingKeys: String, CodingKey {
        case shiftID = "shift_id"
        case openingCash = "opening_cash"
    }
}

/// Ответ на закрытие смены. `totals` считает хранимая процедура, состав полей
/// зависит от версии — держим как свободный словарь чисел.
public struct ShiftCloseResult: Decodable, Sendable {
    public let shiftID: String

    private enum CodingKeys: String, CodingKey {
        case shiftID = "shift_id"
    }
}

// ── Отчёт смены ──────────────────────────────────────────────────────────────

/// Отчёт смены — то же, что заполняют в программе на точке.
///
/// Купюры и мелочь врозь: мелочь остаётся в кассе на размен. Долги — это ещё
/// не деньги, но касса без них не сойдётся. Старт кассы вычитается: он был в
/// ящике до смены. Wipon — комиссия сервиса, её вычитают из итога.
public struct ShiftReportDraft: Encodable, Sendable {
    /// `YYYY-MM-DD`.
    public let date: String
    public let shift: String
    public let shiftID: String?
    public let cash: Double
    public let coins: Double
    public let kaspiPOS: Double
    public let kaspiOnline: Double
    public let kaspiBeforeMidnight: Double?
    public let debts: Double
    public let startCash: Double
    public let wipon: Double
    public let comment: String?

    public init(
        date: String,
        shift: String,
        shiftID: String?,
        cash: Double,
        coins: Double,
        kaspiPOS: Double,
        kaspiOnline: Double,
        kaspiBeforeMidnight: Double?,
        debts: Double,
        startCash: Double,
        wipon: Double,
        comment: String?
    ) {
        self.date = date
        self.shift = shift
        self.shiftID = shiftID
        self.cash = cash
        self.coins = coins
        self.kaspiPOS = kaspiPOS
        self.kaspiOnline = kaspiOnline
        self.kaspiBeforeMidnight = kaspiBeforeMidnight
        self.debts = debts
        self.startCash = startCash
        self.wipon = wipon
        self.comment = comment
    }

    /// Сколько получилось по факту: всё, что в кассе и на терминале, минус то,
    /// что лежало там до смены.
    public var fact: Double { cash + coins + kaspiPOS + debts - startCash }

    /// Итог с учётом комиссии сервиса.
    public var total: Double { fact - wipon }

    private enum CodingKeys: String, CodingKey {
        case date, shift, cash, coins, debts, wipon, comment
        case shiftID = "shift_id"
        case kaspiPOS = "kaspi_pos"
        case kaspiOnline = "kaspi_online"
        case kaspiBeforeMidnight = "kaspi_before_midnight"
        case startCash = "start_cash"
    }
}
