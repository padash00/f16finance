import Foundation

// ── Задачи: создание и статус ────────────────────────────────────────────────
//
// Экран задач умел только показывать. Задачу ставят, когда о ней вспомнили —
// на обходе точки, в разговоре, по дороге, — и телефон здесь единственное, что
// под рукой. Отложить «до ноутбука» означает не поставить вовсе.

/// Приоритет задачи. Значения — те, что принимает сервер.
public enum TaskPriority: String, Sendable, CaseIterable, Identifiable {
    case low, medium, high, critical

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .low: "Низкий"
        case .medium: "Обычный"
        case .high: "Высокий"
        case .critical: "Срочно"
        }
    }
}

/// Состояние задачи.
public enum TaskState: String, Sendable, CaseIterable, Identifiable {
    case backlog, todo, inProgress = "in_progress", review, done, archived

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .backlog: "Копилка"
        case .todo: "К выполнению"
        case .inProgress: "В работе"
        case .review: "На проверке"
        case .done: "Готово"
        case .archived: "В архиве"
        }
    }

    /// Состояния, между которыми переключают руками. `archived` сюда не
    /// входит: архив — это уборка, а не ход работы.
    public static var selectable: [TaskState] {
        [.todo, .inProgress, .review, .done]
    }
}

/// Что заполняют при постановке задачи.
public struct TaskDraft: Sendable, Equatable {
    public var title: String
    public var details: String
    public var priority: TaskPriority
    public var status: TaskState
    public var companyID: String
    /// Исполнитель — либо оператор, либо сотрудник: сервер кладёт в запись
    /// одно из полей, второе всегда пустое.
    public var operatorID: String?
    /// `YYYY-MM-DD` или пусто.
    public var dueDate: String?

    public init(companyID: String = "") {
        title = ""
        details = ""
        priority = .medium
        status = .todo
        self.companyID = companyID
        operatorID = nil
        dueDate = nil
    }

    /// Что мешает отправить. Формулировки серверные.
    public var validationMessage: String? {
        if title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "Название задачи обязательно"
        }
        if companyID.isEmpty { return "Для задачи нужно выбрать точку" }
        return nil
    }

    public var isValid: Bool { validationMessage == nil }

    func payload() -> TaskPayload {
        TaskPayload(
            title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            description: details.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? nil
                : details.trimmingCharacters(in: .whitespacesAndNewlines),
            priority: priority.rawValue,
            status: status.rawValue,
            operatorID: operatorID?.isEmpty == false ? operatorID : nil,
            companyID: companyID,
            dueDate: dueDate?.isEmpty == false ? dueDate : nil
        )
    }
}

struct TaskPayload: Encodable {
    let title: String
    let description: String?
    let priority: String
    let status: String
    let operatorID: String?
    let companyID: String
    let dueDate: String?

    enum CodingKeys: String, CodingKey {
        case title, description, priority, status
        case operatorID = "operator_id"
        case companyID = "company_id"
        case dueDate = "due_date"
    }

    /// Пустые поля пишем явным `null`: сервер кладёт их в запись как есть, и
    /// пропущенный ключ читался бы как «не трогать».
    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(title, forKey: .title)
        try c.encode(description, forKey: .description)
        try c.encode(priority, forKey: .priority)
        try c.encode(status, forKey: .status)
        try c.encode(operatorID, forKey: .operatorID)
        try c.encode(companyID, forKey: .companyID)
        try c.encode(dueDate, forKey: .dueDate)
    }
}

struct TaskCreateRequest: Encodable {
    let action = "createTask"
    let payload: TaskPayload

    private enum CodingKeys: String, CodingKey { case action, payload }
}

struct TaskStatusRequest: Encodable {
    let action = "changeStatus"
    let taskID: String
    let status: String

    private enum CodingKeys: String, CodingKey {
        case action, status
        case taskID = "taskId"
    }
}

// ── Правка, комментарии, удаление ────────────────────────────────────────────
//
// С телефона задачу можно было только поставить и закрыть. А живёт она иначе:
// уточняют срок, переназначают исполнителя, спрашивают «что там». Всё это
// делалось с ноутбука или не делалось вовсе — и задача повисала.

struct TaskUpdateRequest: Encodable {
    let action = "updateTask"
    let taskID: String
    let payload: TaskPatch

    private enum CodingKeys: String, CodingKey {
        case action, payload
        case taskID = "taskId"
    }
}

/// Частичная правка: переданы только изменённые поля.
///
/// Пропущенный ключ сервер трактует как «не трогать» — поэтому здесь всё
/// необязательное, и лишнего мы не шлём. Иначе правка одного срока стирала бы
/// исполнителя.
public struct TaskPatch: Encodable, Sendable {
    public var title: String?
    public var description: String?
    public var priority: String?
    public var status: String?
    public var operatorID: String?
    public var companyID: String?
    public var dueDate: String?

    public init(
        title: String? = nil,
        description: String? = nil,
        priority: String? = nil,
        status: String? = nil,
        operatorID: String? = nil,
        companyID: String? = nil,
        dueDate: String? = nil
    ) {
        self.title = title
        self.description = description
        self.priority = priority
        self.status = status
        self.operatorID = operatorID
        self.companyID = companyID
        self.dueDate = dueDate
    }

    enum CodingKeys: String, CodingKey {
        case title, description, priority, status
        case operatorID = "operator_id"
        case companyID = "company_id"
        case dueDate = "due_date"
    }
}

struct TaskCommentRequest: Encodable {
    let action = "addComment"
    let taskID: String
    let content: String

    private enum CodingKeys: String, CodingKey {
        case action, content
        case taskID = "taskId"
    }
}

struct TaskDeleteRequest: Encodable {
    let action = "deleteTask"
    let taskID: String

    private enum CodingKeys: String, CodingKey {
        case action
        case taskID = "taskId"
    }
}

/// Комментарий к задаче.
public struct TaskComment: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let content: String
    public let createdAt: Date?
    public let operatorID: String?
    public let staffID: String?

    private enum CodingKeys: String, CodingKey {
        case id, content
        case createdAt = "created_at"
        case operatorID = "operator_id"
        case staffID = "staff_id"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        content = try c.decodeFlexibleString(forKey: .content) ?? ""
        createdAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .createdAt))
        operatorID = try c.decodeFlexibleString(forKey: .operatorID)
        staffID = try c.decodeFlexibleString(forKey: .staffID)
    }

    /// Кто написал: оператор или кто-то из офиса. Имён сервер не отдаёт —
    /// показываем роль, это честнее выдуманного имени.
    public var authorLabel: String {
        operatorID != nil ? "Оператор" : "Сотрудник"
    }
}

struct TaskCommentList: Decodable, Sendable {
    let comments: [TaskComment]
}
