import Foundation

// ── Списание товара ──────────────────────────────────────────────────────────
//
// Списывают у полки: разбилось, испортилось, просрочено. Пока это делалось
// только на сайте, между «разбилось» и записью проходил день — а остаток всё
// это время врал, и ревизия потом искала недостачу, которой никто не помнит.

/// Позиция акта списания.
public struct WriteoffLine: Sendable, Identifiable, Hashable, Encodable {
    public let itemID: String
    /// Название нужно только форме — на сервер уходит идентификатор.
    public let name: String
    public var quantity: Double
    public var comment: String?

    public var id: String { itemID }

    public init(itemID: String, name: String, quantity: Double = 0, comment: String? = nil) {
        self.itemID = itemID
        self.name = name
        self.quantity = quantity
        self.comment = comment
    }

    enum CodingKeys: String, CodingKey {
        case quantity, comment
        case itemID = "item_id"
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(itemID, forKey: .itemID)
        try c.encode(quantity, forKey: .quantity)
        let trimmed = comment?.trimmingCharacters(in: .whitespacesAndNewlines)
        try c.encode(trimmed?.isEmpty == false ? trimmed : nil, forKey: .comment)
    }
}

/// Акт списания целиком.
public struct WriteoffDraft: Sendable, Equatable {
    public var locationID: String
    /// `YYYY-MM-DD`.
    public var writtenAt: String
    public var reason: String
    public var comment: String
    public var lines: [WriteoffLine]

    public init(writtenAt: String, locationID: String = "") {
        self.locationID = locationID
        self.writtenAt = writtenAt
        reason = ""
        comment = ""
        lines = []
    }

    public var totalQuantity: Double {
        lines.reduce(0) { $0 + $1.quantity }
    }

    /// Что мешает отправить.
    public var validationMessage: String? {
        if locationID.isEmpty { return "Выберите, откуда списываем" }
        if reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "Причина обязательна"
        }
        if lines.isEmpty { return "Добавьте хотя бы одну позицию" }
        if lines.contains(where: { $0.quantity <= 0 }) {
            return "У каждой позиции должно быть количество"
        }
        return nil
    }

    public var isValid: Bool { validationMessage == nil }

    func payload() -> WriteoffPayload {
        WriteoffPayload(
            locationID: locationID,
            writtenAt: writtenAt,
            reason: reason.trimmingCharacters(in: .whitespacesAndNewlines),
            comment: comment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? nil
                : comment.trimmingCharacters(in: .whitespacesAndNewlines),
            items: lines
        )
    }
}

struct WriteoffPayload: Encodable {
    let locationID: String
    let writtenAt: String
    let reason: String
    let comment: String?
    let items: [WriteoffLine]

    enum CodingKeys: String, CodingKey {
        case reason, comment, items
        case locationID = "location_id"
        case writtenAt = "written_at"
    }
}

struct WriteoffCreateRequest: Encodable {
    let action = "createWriteoff"
    let payload: WriteoffPayload
    /// Точка нужна серверу отдельно от локации: по ней он проверяет доступ.
    let companyID: String?

    enum CodingKeys: String, CodingKey {
        case action, payload
        case companyID = "company_id"
    }
}
