import Foundation

// ── Ревизия: пересчёт остатков ───────────────────────────────────────────────
//
// Единственный документ, который по определению делают с телефоном в руках:
// человек стоит у стеллажа и считает банки. Пока ревизию можно было завести
// только на сайте, счёт вели на бумаге, а вечером переносили — и переносили с
// ошибками, потому что почерк, потому что устал, потому что «кажется, было
// восемь».

/// Строка пересчёта: сколько числится и сколько насчитали.
public struct StocktakeLine: Sendable, Identifiable, Hashable {
    public let itemID: String
    public let name: String
    public let unit: String
    /// Сколько числится в системе на момент начала пересчёта.
    public let expected: Double
    /// Сколько насчитали. `nil` — до позиции ещё не дошли.
    public var actual: Double?
    public var comment: String?

    public var id: String { itemID }

    public init(
        itemID: String,
        name: String,
        unit: String,
        expected: Double,
        actual: Double? = nil,
        comment: String? = nil
    ) {
        self.itemID = itemID
        self.name = name
        self.unit = unit
        self.expected = expected
        self.actual = actual
        self.comment = comment
    }

    public var isCounted: Bool { actual != nil }

    /// Расхождение. Отрицательное — недостача.
    public var difference: Double? {
        guard let actual else { return nil }
        return actual - expected
    }

    public var hasMismatch: Bool {
        guard let difference else { return false }
        return abs(difference) > 0.0001
    }
}

/// Акт ревизии целиком.
public struct StocktakeDraft: Sendable, Equatable {
    public var locationID: String
    /// `YYYY-MM-DD`.
    public var countedAt: String
    public var comment: String
    public var lines: [StocktakeLine]

    public init(countedAt: String, locationID: String = "") {
        self.locationID = locationID
        self.countedAt = countedAt
        comment = ""
        lines = []
    }

    public var countedLines: [StocktakeLine] { lines.filter(\.isCounted) }
    public var mismatchedLines: [StocktakeLine] { lines.filter(\.hasMismatch) }

    /// Сколько позиций осталось пересчитать.
    public var remaining: Int { lines.count - countedLines.count }

    /// Что мешает провести.
    public var validationMessage: String? {
        if locationID.isEmpty { return "Выберите, что пересчитываем" }
        if countedLines.isEmpty { return "Ни одна позиция не пересчитана" }
        if lines.contains(where: { ($0.actual ?? 0) < 0 }) {
            return "Количество не может быть отрицательным"
        }
        return nil
    }

    public var isValid: Bool { validationMessage == nil }

    /// В акт уходят только пересчитанные строки.
    ///
    /// Непосчитанная позиция — не «ноль на полке», а «до неё не дошли».
    /// Отправить её нулём значит списать товар, которого никто не искал.
    func payload() -> StocktakePayload {
        StocktakePayload(
            locationID: locationID,
            countedAt: countedAt,
            comment: comment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? nil
                : comment.trimmingCharacters(in: .whitespacesAndNewlines),
            items: countedLines.map {
                StocktakeItemPayload(itemID: $0.itemID, actualQty: $0.actual ?? 0, comment: $0.comment)
            }
        )
    }
}

struct StocktakeItemPayload: Encodable {
    let itemID: String
    let actualQty: Double
    let comment: String?

    enum CodingKeys: String, CodingKey {
        case comment
        case itemID = "item_id"
        case actualQty = "actual_qty"
    }

    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(itemID, forKey: .itemID)
        try c.encode(actualQty, forKey: .actualQty)
        let trimmed = comment?.trimmingCharacters(in: .whitespacesAndNewlines)
        try c.encode(trimmed?.isEmpty == false ? trimmed : nil, forKey: .comment)
    }
}

struct StocktakePayload: Encodable {
    let locationID: String
    let countedAt: String
    let comment: String?
    let items: [StocktakeItemPayload]

    enum CodingKeys: String, CodingKey {
        case comment, items
        case locationID = "location_id"
        case countedAt = "counted_at"
    }
}

struct StocktakeCreateRequest: Encodable {
    let action = "createRevision"
    let payload: StocktakePayload
    let companyID: String?

    enum CodingKeys: String, CodingKey {
        case action, payload
        case companyID = "company_id"
    }
}
