import Foundation

// ── Инциденты: регистрация и решение ─────────────────────────────────────────
//
// Инцидент случается на точке и записывается там же: разбитая витрина, опоздание
// на смену, хорошо отработанный конфликт с гостем. Пока это можно было завести
// только на сайте, между событием и записью проходил день — и запись делалась
// по памяти, а половина не делалась вовсе.

/// Что это: нарушение, поощрение или просто отметка.
public enum IncidentKind: String, Sendable, CaseIterable, Identifiable {
    case violation, bonus, note

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .violation: "Нарушение"
        case .bonus: "Поощрение"
        case .note: "Заметка"
        }
    }

    public var icon: String {
        switch self {
        case .violation: "exclamationmark.triangle"
        case .bonus: "star"
        case .note: "note.text"
        }
    }
}

/// Насколько серьёзно.
public enum IncidentSeverity: String, Sendable, CaseIterable, Identifiable {
    case info, normal, warning, critical

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .info: "Мелочь"
        case .normal: "Обычный"
        case .warning: "Серьёзный"
        case .critical: "Критичный"
        }
    }
}

/// Состояние разбора.
public enum IncidentStatus: String, Sendable, CaseIterable, Identifiable {
    case draft, confirmed, disputed, voided

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .draft: "Черновик"
        case .confirmed: "Подтверждён"
        case .disputed: "Оспорен"
        case .voided: "Отменён"
        }
    }

    /// Решения, которые принимают по инциденту. Черновик сюда не входит:
    /// в него не возвращаются, из него выходят.
    public static var decisions: [IncidentStatus] { [.confirmed, .disputed, .voided] }
}

/// Что заполняют при регистрации.
public struct IncidentDraft: Sendable, Equatable {
    public var companyID: String
    public var kind: IncidentKind
    public var title: String
    public var details: String
    public var severity: IncidentSeverity
    public var fineAmount: Double
    public var bonusAmount: Double
    /// Кого касается. Необязателен: бывает инцидент про точку, а не про человека.
    public var subjectStaffID: String?

    public init(companyID: String = "") {
        self.companyID = companyID
        kind = .violation
        title = ""
        details = ""
        severity = .normal
        fineAmount = 0
        bonusAmount = 0
        subjectStaffID = nil
    }

    /// Что мешает отправить. Формулировки серверные.
    public var validationMessage: String? {
        if companyID.isEmpty { return "Точка обязательна" }
        if title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "Название обязательно" }
        if fineAmount < 0 || bonusAmount < 0 { return "Сумма не может быть отрицательной" }
        // Штраф у поощрения и премия у нарушения — почти всегда промах в поле,
        // а не замысел. Сервер это пропустит, человек потом не поймёт цифру.
        if kind == .bonus && fineAmount > 0 { return "У поощрения не бывает штрафа" }
        if kind == .violation && bonusAmount > 0 { return "У нарушения не бывает премии" }
        return nil
    }

    public var isValid: Bool { validationMessage == nil }

    func payload() -> IncidentPayload {
        IncidentPayload(
            companyID: companyID,
            kind: kind.rawValue,
            title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            description: details.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? nil
                : details.trimmingCharacters(in: .whitespacesAndNewlines),
            severity: severity.rawValue,
            fineAmount: fineAmount > 0 ? fineAmount : nil,
            bonusAmount: bonusAmount > 0 ? bonusAmount : nil,
            subjectStaffID: subjectStaffID?.isEmpty == false ? subjectStaffID : nil,
            source: "manual",
            status: "confirmed"
        )
    }
}

struct IncidentPayload: Encodable {
    let companyID: String
    let kind: String
    let title: String
    let description: String?
    let severity: String
    let fineAmount: Double?
    let bonusAmount: Double?
    let subjectStaffID: String?
    let source: String
    let status: String

    enum CodingKeys: String, CodingKey {
        case kind, title, description, severity, source, status
        case companyID = "company_id"
        case fineAmount = "fine_amount"
        case bonusAmount = "bonus_amount"
        case subjectStaffID = "subject_staff_id"
    }
}

struct IncidentStatusChange: Encodable {
    let status: String
}
