import Foundation

// ── Обзор: /api/operator/overview ────────────────────────────────────────────

/// Сводка недели по зарплате.
public struct SalaryWeek: Decodable, Sendable, Hashable {
    public let weekStart: String?
    public let weekEnd: String?
    public let grossAmount: Double
    public let bonusAmount: Double
    public let fineAmount: Double
    public let debtAmount: Double
    public let advanceAmount: Double
    public let netAmount: Double
    public let paidAmount: Double
    public let remainingAmount: Double
    public let status: String
    public let shiftsCount: Int?
    /// Автобонус за смены — считается правилами точки и в `bonusAmount` не
    /// входит.
    ///
    /// Его отсутствие и ломало арифметику: «начислено 10 500, аванс −248, итого
    /// 12 252» — разница ровно на автобонус, о котором на экране не было ни
    /// слова.
    public let autoBonusTotal: Double
    /// Надбавка за стаж. Входит в начисление по сменам, показываем справочно.
    public let seniorityBonusTotal: Double
    /// Смены недели. Приходят внутри `week`, поэтому разбираем здесь же:
    /// прошлый вариант доставал их отдельным контейнером и терял из-за
    /// двойной опциональности — график молча оставался пустым.
    public let shifts: [SalaryShift]

    /// Человеческий статус недели.
    public var statusLabel: String {
        switch status {
        case "paid": "выплачено"
        case "partial": "выплачено частично"
        case "locked": "закрыта"
        default: "в расчёте"
        }
    }

    private enum CodingKeys: String, CodingKey {
        case weekStart, weekEnd, grossAmount, bonusAmount, fineAmount
        case debtAmount, advanceAmount, netAmount, paidAmount, remainingAmount
        case status, shiftsCount, shifts, autoBonusTotal, seniorityBonusTotal
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        weekStart = try c.decodeIfPresent(String.self, forKey: .weekStart)
        weekEnd = try c.decodeIfPresent(String.self, forKey: .weekEnd)
        grossAmount = try c.decodeIfPresent(Double.self, forKey: .grossAmount) ?? 0
        bonusAmount = try c.decodeIfPresent(Double.self, forKey: .bonusAmount) ?? 0
        fineAmount = try c.decodeIfPresent(Double.self, forKey: .fineAmount) ?? 0
        debtAmount = try c.decodeIfPresent(Double.self, forKey: .debtAmount) ?? 0
        advanceAmount = try c.decodeIfPresent(Double.self, forKey: .advanceAmount) ?? 0
        netAmount = try c.decodeIfPresent(Double.self, forKey: .netAmount) ?? 0
        paidAmount = try c.decodeIfPresent(Double.self, forKey: .paidAmount) ?? 0
        remainingAmount = try c.decodeIfPresent(Double.self, forKey: .remainingAmount) ?? 0
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? "draft"
        shiftsCount = try c.decodeIfPresent(Int.self, forKey: .shiftsCount)
        autoBonusTotal = try c.decodeIfPresent(Double.self, forKey: .autoBonusTotal) ?? 0
        seniorityBonusTotal = try c.decodeIfPresent(Double.self, forKey: .seniorityBonusTotal) ?? 0
        shifts = try c.decodeIfPresent([SalaryShift].self, forKey: .shifts) ?? []
    }

    /// Что не сошлось.
    ///
    /// Сумма строк должна давать «итого». Если сервер добавит новую
    /// составляющую, а приложение о ней ещё не знает, разница окажется здесь —
    /// лучше строка «прочее», чем цифры, которые не сходятся на экране.
    public var unexplainedAmount: Double {
        let explained = grossAmount + autoBonusTotal + bonusAmount
            - fineAmount - debtAmount - advanceAmount
        return netAmount - explained
    }
}

/// Счётчики на главном экране.
public struct OverviewCounters: Decodable, Sendable, Hashable {
    public let activeTasks: Int
    public let reviewTasks: Int
    public let activeDebts: Int
    public let activeDebtAmount: Double
    public let leadPoints: Int

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        activeTasks = try c.decodeIfPresent(Int.self, forKey: .activeTasks) ?? 0
        reviewTasks = try c.decodeIfPresent(Int.self, forKey: .reviewTasks) ?? 0
        activeDebts = try c.decodeIfPresent(Int.self, forKey: .activeDebts) ?? 0
        activeDebtAmount = try c.decodeIfPresent(Double.self, forKey: .activeDebtAmount) ?? 0
        leadPoints = try c.decodeIfPresent(Int.self, forKey: .leadPoints) ?? 0
    }

    private enum CodingKeys: String, CodingKey {
        case activeTasks, reviewTasks, activeDebts, activeDebtAmount, leadPoints
    }
}

/// Ближайшая смена по графику.
public struct NextShift: Decodable, Sendable, Hashable {
    public let date: String
    public let shiftType: String?
    public let companyName: String?
    public let label: String?

    private enum CodingKeys: String, CodingKey {
        case date
        case shiftType = "shiftType"
        case companyName, label
    }
}

/// Долг оператора перед точкой.
public struct OperatorDebt: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let amount: Double
    public let comment: String?
    public let weekStart: String?
    public let companyName: String?

    private enum CodingKeys: String, CodingKey {
        case id, amount, comment
        case weekStart = "week_start"
        case companyName
    }
}

/// Точка, где оператор — старший.
public struct LeadAssignment: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let companyName: String?
    public let role: String?
    public let isPrimary: Bool?
}

/// Ответ `GET /api/operator/overview`.
public struct OperatorOverview: Decodable, Sendable {
    public let operatorName: String
    public let week: SalaryWeek?
    public let counters: OverviewCounters?
    public let nextShift: NextShift?
    public let activeTasks: [OperatorTask]
    public let recentDebts: [OperatorDebt]
    public let leadAssignments: [LeadAssignment]

    private enum CodingKeys: String, CodingKey {
        case `operator`, week, counters, nextShift, activeTasks, recentDebts, leadAssignments
    }

    private struct OperatorRef: Decodable {
        let name: String?
        let short_name: String?
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let ref = try c.decodeIfPresent(OperatorRef.self, forKey: .operator)
        operatorName = ref?.short_name ?? ref?.name ?? "Оператор"
        week = try c.decodeIfPresent(SalaryWeek.self, forKey: .week)
        counters = try c.decodeIfPresent(OverviewCounters.self, forKey: .counters)
        nextShift = try c.decodeIfPresent(NextShift.self, forKey: .nextShift)
        activeTasks = try c.decodeIfPresent([OperatorTask].self, forKey: .activeTasks) ?? []
        recentDebts = try c.decodeIfPresent([OperatorDebt].self, forKey: .recentDebts) ?? []
        leadAssignments = try c.decodeIfPresent([LeadAssignment].self, forKey: .leadAssignments) ?? []
    }
}

// ── Задачи: /api/operator/tasks ──────────────────────────────────────────────

/// Задача оператора.
public struct OperatorTask: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let title: String
    public let description: String?
    public let status: String
    public let priority: String
    public let dueDate: String?
    public let companyName: String?

    public var isDone: Bool { status == "done" || status == "completed" }
    public var isOnReview: Bool { status == "review" }

    /// Просрочена ли. Сравниваем по дате, а не по времени: срок задан днём.
    public var isOverdue: Bool {
        guard !isDone, let dueDate, let due = DateParsing.parseDateOnly(dueDate) else { return false }
        return due < Calendar.current.startOfDay(for: Date())
    }

    public var priorityLabel: String {
        switch priority {
        case "high", "urgent": "срочно"
        case "low": "не срочно"
        default: "обычная"
        }
    }

    public var statusLabel: String {
        switch status {
        case "done", "completed": "выполнена"
        case "review": "на проверке"
        case "in_progress": "в работе"
        default: "новая"
        }
    }

    private enum CodingKeys: String, CodingKey {
        case id, title, description, status, priority
        case dueDate = "due_date"
        case companyName = "company_name"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? "Задача"
        description = try c.decodeIfPresent(String.self, forKey: .description)
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? "new"
        priority = try c.decodeIfPresent(String.self, forKey: .priority) ?? "medium"
        dueDate = try c.decodeIfPresent(String.self, forKey: .dueDate)
        companyName = try c.decodeIfPresent(String.self, forKey: .companyName)
    }
}

/// Ответ `GET /api/operator/tasks`.
public struct OperatorTaskList: Decodable, Sendable {
    public let tasks: [OperatorTask]

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tasks = try c.decodeIfPresent([OperatorTask].self, forKey: .tasks) ?? []
    }

    private enum CodingKeys: String, CodingKey { case tasks }
}

// ── Зарплата: /api/operator/salary ───────────────────────────────────────────

/// Одна смена в расчёте недели.
public struct SalaryShift: Decodable, Sendable, Hashable, Identifiable {
    public let date: String
    public let shift: String?
    public let companyName: String?
    /// Выручка смены — от неё считается процент.
    public let totalIncome: Double
    /// Ставка или процент от выручки — то, что начислено за саму смену.
    public let baseSalary: Double
    /// Надбавка за стаж и её процент.
    public let seniorityBonus: Double
    public let seniorityPercent: Double
    /// Автобонус по правилам точки.
    public let autoBonus: Double
    /// Доплата за роль (старший смены и подобное).
    public let roleBonus: Double
    /// Итог за смену.
    public let salary: Double

    public var id: String { "\(date)-\(shift ?? "")" }

    public var isNight: Bool { shift == "night" }
    public var shiftLabel: String { isNight ? "ночная" : "дневная" }

    /// Сумма за смену. Раньше читалось несуществующее поле `amount`, и график
    /// смен всегда оставался пустым, а «за что начислено» — без единой цифры.
    public var amount: Double? { salary > 0 ? salary : nil }

    private enum CodingKeys: String, CodingKey {
        case date, shift, companyName, totalIncome, baseSalary
        case seniorityBonus, seniorityPercent, autoBonus, roleBonus, salary
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        date = try c.decodeIfPresent(String.self, forKey: .date) ?? ""
        shift = try c.decodeIfPresent(String.self, forKey: .shift)
        companyName = try c.decodeIfPresent(String.self, forKey: .companyName)
        totalIncome = try c.decodeFlexibleDouble(forKey: .totalIncome) ?? 0
        baseSalary = try c.decodeFlexibleDouble(forKey: .baseSalary) ?? 0
        seniorityBonus = try c.decodeFlexibleDouble(forKey: .seniorityBonus) ?? 0
        seniorityPercent = try c.decodeFlexibleDouble(forKey: .seniorityPercent) ?? 0
        autoBonus = try c.decodeFlexibleDouble(forKey: .autoBonus) ?? 0
        roleBonus = try c.decodeFlexibleDouble(forKey: .roleBonus) ?? 0
        salary = try c.decodeFlexibleDouble(forKey: .salary) ?? 0
    }
}

/// Ответ `GET /api/operator/salary`.
public struct OperatorSalary: Decodable, Sendable {
    public let week: SalaryWeek?
    public let shifts: [SalaryShift]

    private enum CodingKeys: String, CodingKey { case week }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        week = try c.decodeIfPresent(SalaryWeek.self, forKey: .week)
        shifts = week?.shifts ?? []
    }
}

// ── График: /api/operator/shifts ─────────────────────────────────────────────

/// Смена в графике.
public struct ScheduledShift: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let date: String
    public let shiftType: String

    public var isNight: Bool { shiftType == "night" }
    public var typeLabel: String { isNight ? "ночная" : "дневная" }

    private enum CodingKeys: String, CodingKey {
        case id, date
        case shiftType = "shift_type"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        date = try c.decodeIfPresent(String.self, forKey: .date) ?? ""
        shiftType = try c.decodeIfPresent(String.self, forKey: .shiftType) ?? "day"
    }
}

/// График по одной точке.
public struct ScheduleGroup: Decodable, Sendable, Identifiable, Hashable {
    public let companyName: String
    public let shifts: [ScheduledShift]

    public var id: String { companyName }

    private enum CodingKeys: String, CodingKey { case company, shifts }
    private struct Company: Decodable { let name: String? }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        companyName = (try c.decodeIfPresent(Company.self, forKey: .company))?.name ?? "Точка"
        shifts = try c.decodeIfPresent([ScheduledShift].self, forKey: .shifts) ?? []
    }
}

/// Ответ `GET /api/operator/shifts`.
public struct OperatorSchedule: Decodable, Sendable {
    public let weekStart: String?
    public let weekEnd: String?
    public let groups: [ScheduleGroup]

    /// Все смены недели одним списком, по датам.
    public var allShifts: [ScheduledShift] {
        groups.flatMap(\.shifts).sorted { $0.date < $1.date }
    }

    private enum CodingKeys: String, CodingKey {
        case weekStart, weekEnd, schedule
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        weekStart = try c.decodeIfPresent(String.self, forKey: .weekStart)
        weekEnd = try c.decodeIfPresent(String.self, forKey: .weekEnd)
        groups = try c.decodeIfPresent([ScheduleGroup].self, forKey: .schedule) ?? []
    }
}

// ── База знаний и чек-листы: /api/operator/knowledge ─────────────────────────

/// Статья базы знаний.
public struct KnowledgeArticle: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let title: String
    public let summary: String?
    public let body: String?
    public let severity: String?
    public let version: Int
    public let requiresConfirmation: Bool

    public var isCritical: Bool { severity == "critical" || severity == "high" }

    private enum CodingKeys: String, CodingKey {
        case id, title, summary, body, severity, version
        case content
        case requiresConfirmation = "requires_confirmation"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? "Статья"
        summary = try c.decodeIfPresent(String.self, forKey: .summary)
        // Текст статьи в разных версиях схемы лежит то в body, то в content.
        body = try c.decodeIfPresent(String.self, forKey: .body)
            ?? c.decodeIfPresent(String.self, forKey: .content)
        severity = try c.decodeIfPresent(String.self, forKey: .severity)
        version = try c.decodeIfPresent(Int.self, forKey: .version) ?? 1
        requiresConfirmation = try c.decodeIfPresent(Bool.self, forKey: .requiresConfirmation) ?? false
    }
}

/// Пункт чек-листа.
public struct ChecklistItem: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let templateID: String
    public let title: String
    public let description: String?
    public let answerType: String
    public let isRequired: Bool
    public let requiresPhoto: Bool
    public let fineAmount: Double?
    public let bonusAmount: Double?

    private enum CodingKeys: String, CodingKey {
        case id, title, description
        case templateID = "template_id"
        case answerType = "answer_type"
        case isRequired = "is_required"
        case requiresPhoto = "requires_photo"
        case fineAmount = "fine_amount"
        case bonusAmount = "bonus_amount"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        templateID = try c.decodeIfPresent(String.self, forKey: .templateID) ?? ""
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? "Пункт"
        description = try c.decodeIfPresent(String.self, forKey: .description)
        answerType = try c.decodeIfPresent(String.self, forKey: .answerType) ?? "yes_no"
        isRequired = try c.decodeIfPresent(Bool.self, forKey: .isRequired) ?? false
        requiresPhoto = try c.decodeIfPresent(Bool.self, forKey: .requiresPhoto) ?? false
        fineAmount = try c.decodeIfPresent(Double.self, forKey: .fineAmount)
        bonusAmount = try c.decodeIfPresent(Double.self, forKey: .bonusAmount)
    }
}

/// Ответ `GET /api/operator/knowledge` — знания и чек-листы одним запросом.
public struct KnowledgeCenter: Decodable, Sendable {
    public let articles: [KnowledgeArticle]
    public let pendingConfirmations: [KnowledgeArticle]
    public let templates: [ChecklistTemplate]
    public let items: [ChecklistItem]
    public let runs: [ChecklistRun]
    public let hasOpenShift: Bool

    private enum RootKeys: String, CodingKey { case data }
    private enum DataKeys: String, CodingKey {
        case articles, pending_confirmations, checklist_templates, checklist_items, checklist_runs, open_shift
    }
    private struct OpenShift: Decodable { let id: String? }

    public init(from decoder: any Decoder) throws {
        let root = try decoder.container(keyedBy: RootKeys.self)
        let data = try root.nestedContainer(keyedBy: DataKeys.self, forKey: .data)
        articles = try data.decodeIfPresent([KnowledgeArticle].self, forKey: .articles) ?? []
        pendingConfirmations = try data.decodeIfPresent([KnowledgeArticle].self, forKey: .pending_confirmations) ?? []
        templates = try data.decodeIfPresent([ChecklistTemplate].self, forKey: .checklist_templates) ?? []
        items = try data.decodeIfPresent([ChecklistItem].self, forKey: .checklist_items) ?? []
        runs = try data.decodeIfPresent([ChecklistRun].self, forKey: .checklist_runs) ?? []
        hasOpenShift = (try? data.decodeIfPresent(OpenShift.self, forKey: .open_shift))??.id != nil
    }

    /// Пункты конкретного чек-листа, по порядку.
    public func items(for templateID: String) -> [ChecklistItem] {
        items.filter { $0.templateID == templateID }
    }

    /// Текущий незавершённый запуск чек-листа, если он есть.
    public func activeRun(for templateID: String) -> ChecklistRun? {
        runs.first { $0.templateID == templateID && !$0.isCompleted }
    }

    public func completedRun(for templateID: String) -> ChecklistRun? {
        runs.first { $0.templateID == templateID && $0.isCompleted }
    }
}

/// Ответ на запуск чек-листа.
public struct ChecklistRunStart: Decodable, Sendable {
    public let runID: String
    /// Сервер вернул уже существующий запуск вместо нового.
    public let reused: Bool

    private enum CodingKeys: String, CodingKey {
        case runID = "run_id"
        case reused
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        runID = try c.decodeIfPresent(String.self, forKey: .runID) ?? ""
        reused = try c.decodeIfPresent(Bool.self, forKey: .reused) ?? false
    }
}

/// Итог завершения чек-листа: штрафы и бонусы начисляются сразу.
public struct ChecklistRunResult: Decodable, Sendable {
    public let status: String
    public let finesTotal: Double
    public let bonusesTotal: Double

    private enum CodingKeys: String, CodingKey {
        case status
        case finesTotal = "fines_total"
        case bonusesTotal = "bonuses_total"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? "completed"
        finesTotal = try c.decodeIfPresent(Double.self, forKey: .finesTotal) ?? 0
        bonusesTotal = try c.decodeIfPresent(Double.self, forKey: .bonusesTotal) ?? 0
    }
}

/// Ответ на пункт чек-листа.
public struct ChecklistAnswer: Sendable, Hashable {
    public let itemID: String
    public var answer: String
    public var comment: String?
    /// Фото как data URL — сервер сохраняет его в ответах запуска.
    public var photoDataURL: String?

    public init(itemID: String, answer: String, comment: String? = nil, photoDataURL: String? = nil) {
        self.itemID = itemID
        self.answer = answer
        self.comment = comment
        self.photoDataURL = photoDataURL
    }

    public var isPositive: Bool { answer == "yes" || answer == "ok" }

    public func requestPayload() -> [String: Any] {
        var payload: [String: Any] = ["item_id": itemID, "answer": answer]
        if let comment, !comment.isEmpty { payload["comment"] = comment }
        if let photoDataURL { payload["photo_base64"] = photoDataURL }
        return payload
    }
}

// ── Инциденты: /api/operator/incidents ───────────────────────────────────────

/// Инцидент по оператору: штраф, бонус или заметка.
public struct OperatorIncident: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let title: String?
    public let description: String?
    public let kind: String?
    public let amount: Double?
    public let occurredAt: Date?
    public let photoURLs: [String]

    /// Штраф это или поощрение — определяет цвет карточки.
    public var isPenalty: Bool {
        (amount ?? 0) < 0 || kind == "fine" || kind == "penalty"
    }

    private enum CodingKeys: String, CodingKey {
        case id, title, description, amount
        case kind, type
        case occurredAt = "occurred_at"
        case photoURLs = "photo_urls"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = try c.decodeIfPresent(String.self, forKey: .title)
        description = try c.decodeIfPresent(String.self, forKey: .description)
        kind = try c.decodeIfPresent(String.self, forKey: .kind)
            ?? c.decodeIfPresent(String.self, forKey: .type)
        amount = try c.decodeIfPresent(Double.self, forKey: .amount)
        occurredAt = try c.decodeIfPresent(Date.self, forKey: .occurredAt)
        photoURLs = try c.decodeIfPresent([String].self, forKey: .photoURLs) ?? []
    }
}

/// Ответ `GET /api/operator/incidents`.
public struct OperatorIncidentList: Decodable, Sendable {
    public let incidents: [OperatorIncident]

    private enum CodingKeys: String, CodingKey { case incidents, data }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // Разные роуты контура называют корневой ключ по-разному — принимаем оба.
        incidents = try c.decodeIfPresent([OperatorIncident].self, forKey: .incidents)
            ?? c.decodeIfPresent([OperatorIncident].self, forKey: .data)
            ?? []
    }
}
