import Foundation

// ── Магазин: /api/admin/store/* ──────────────────────────────────────────────
//
// Сервер отдаёт нормализованные строки Supabase: вложенные связи приходят
// объектами (`item`, `location`, `company`), числа — то строками, то числами.
// Поэтому здесь всюду мягкое декодирование: пустой склад лучше, чем экран
// с ошибкой из-за одного кривого поля.

/// Точка хранения: склад, витрина, кухня.
public struct StoreLocation: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let code: String?
    public let kind: String
    public let isActive: Bool
    public let companyName: String?

    /// Человеческое имя типа.
    ///
    /// Значения — ровно те, что разрешает `inventory_locations_location_type_check`:
    /// `warehouse`, `point_display`, `catalog`, `backroom`. Раньше здесь стояло
    /// `showcase`, которого сервер не присылает никогда, и витрина подписывалась
    /// как «Точка» с иконкой здания.
    public var kindLabel: String {
        switch kind {
        case "warehouse": "Склад"
        case "point_display": "Витрина"
        case "backroom": "Подсобка"
        case "catalog": "Каталог"
        default: "Точка"
        }
    }

    public var icon: String {
        switch kind {
        case "warehouse": "shippingbox"
        case "point_display": "cabinet"
        case "backroom": "archivebox"
        case "catalog": "books.vertical"
        default: "building.2"
        }
    }

    /// Место, где товар лежит физически на складе: сам склад и подсобка.
    /// Витрина и каталог — другое: одна показывает товар покупателю, второй
    /// вообще не место хранения, а справочник.
    public var isStockroom: Bool {
        kind == "warehouse" || kind == "backroom"
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, code
        case kind = "location_type"
        case isActive = "is_active"
        case company
    }

    private struct NamedRef: Decodable { let name: String? }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        name = try c.decodeFlexibleString(forKey: .name) ?? "Без названия"
        code = try c.decodeFlexibleString(forKey: .code)
        kind = try c.decodeFlexibleString(forKey: .kind) ?? "warehouse"
        isActive = try c.decodeIfPresent(Bool.self, forKey: .isActive) ?? true
        companyName = try c.decodeIfPresent(NamedRef.self, forKey: .company)?.name
    }
}

/// Остаток товара в конкретной точке.
public struct StockBalance: Decodable, Sendable, Identifiable, Hashable {
    public let itemID: String
    public let locationID: String
    public let name: String
    public let unit: String
    public let barcode: String?
    public let quantity: Double
    public let lowStockThreshold: Double?
    public let locationName: String?

    public var id: String { "\(locationID)/\(itemID)" }

    /// Ниже порога — товар скоро кончится. Порог задаёт владелец на товаре;
    /// без порога тревожить нечем, поэтому `false`, а не «ноль».
    public var isLow: Bool {
        guard let lowStockThreshold, lowStockThreshold > 0 else { return false }
        return quantity <= lowStockThreshold
    }

    private enum CodingKeys: String, CodingKey {
        case itemID = "item_id"
        case locationID = "location_id"
        case quantity
        case item
        case location
    }

    private struct ItemRef: Decodable {
        let id: String?
        let name: String?
        let unit: String?
        let barcode: String?
        let lowStockThreshold: Double?

        private enum CodingKeys: String, CodingKey {
            case id, name, unit, barcode
            case lowStockThreshold = "low_stock_threshold"
        }

        init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decodeFlexibleString(forKey: .id)
            name = try c.decodeFlexibleString(forKey: .name)
            unit = try c.decodeFlexibleString(forKey: .unit)
            barcode = try c.decodeFlexibleString(forKey: .barcode)
            lowStockThreshold = try c.decodeFlexibleDouble(forKey: .lowStockThreshold)
        }
    }

    private struct LocationRef: Decodable {
        let id: String?
        let name: String?

        init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decodeFlexibleString(forKey: .id)
            name = try c.decodeFlexibleString(forKey: .name)
        }

        private enum CodingKeys: String, CodingKey { case id, name }
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let item = try c.decodeIfPresent(ItemRef.self, forKey: .item)
        let location = try c.decodeIfPresent(LocationRef.self, forKey: .location)

        itemID = try c.decodeFlexibleString(forKey: .itemID) ?? item?.id ?? UUID().uuidString
        locationID = try c.decodeFlexibleString(forKey: .locationID) ?? location?.id ?? ""
        name = item?.name ?? "Товар"
        unit = item?.unit ?? "шт"
        barcode = item?.barcode
        lowStockThreshold = item?.lowStockThreshold
        quantity = try c.decodeFlexibleDouble(forKey: .quantity) ?? 0
        locationName = location?.name
    }
}

/// Движение товара: приход, списание, перемещение, продажа.
public struct StockMovement: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let kind: String
    public let quantity: Double
    public let amount: Double
    public let createdAt: Date?
    public let itemName: String
    public let fromName: String?
    public let toName: String?

    public var kindLabel: String {
        switch kind {
        case "receipt", "purchase": "Приход"
        case "transfer": "Перемещение"
        case "writeoff": "Списание"
        case "sale": "Продажа"
        case "revision", "audit": "Ревизия"
        // Незнакомый вид движения показываем нейтрально: английское слово из
        // базы в журнале склада ничего не объясняет.
        default: "Движение"
        }
    }

    public var icon: String {
        switch kind {
        case "receipt", "purchase": "arrow.down.circle"
        case "transfer": "arrow.left.arrow.right.circle"
        case "writeoff": "trash.circle"
        case "sale": "cart.circle"
        case "revision", "audit": "checklist"
        default: "circle"
        }
    }

    /// Приход увеличивает запас, списание и продажа уменьшают. Перемещение
    /// нейтрально — товар остаётся в системе, просто меняет место.
    public var direction: Int {
        switch kind {
        case "receipt", "purchase": 1
        case "writeoff", "sale": -1
        default: 0
        }
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case kind = "movement_type"
        case quantity
        case amount = "total_amount"
        case createdAt = "created_at"
        case item
        case fromLocation = "from_location"
        case toLocation = "to_location"
    }

    private struct NamedRef: Decodable { let name: String? }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        kind = try c.decodeFlexibleString(forKey: .kind) ?? "movement"
        quantity = try c.decodeFlexibleDouble(forKey: .quantity) ?? 0
        amount = try c.decodeFlexibleDouble(forKey: .amount) ?? 0
        createdAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .createdAt))
        itemName = try c.decodeIfPresent(NamedRef.self, forKey: .item)?.name ?? "Товар"
        fromName = try c.decodeIfPresent(NamedRef.self, forKey: .fromLocation)?.name
        toName = try c.decodeIfPresent(NamedRef.self, forKey: .toLocation)?.name
    }
}

/// Заявка точки на товар со склада.
public struct StockRequest: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let status: String
    public let comment: String?
    public let createdAt: Date?
    public let companyName: String?
    public let sourceName: String?
    public let targetName: String?
    public let lines: [Line]

    public struct Line: Decodable, Sendable, Identifiable, Hashable {
        public let id: String
        public let name: String
        public let unit: String
        public let requested: Double
        public let approved: Double?

        private enum CodingKeys: String, CodingKey {
            case id
            case requested = "requested_qty"
            case approved = "approved_qty"
            case item
        }

        private struct ItemRef: Decodable {
            let name: String?
            let unit: String?
        }

        public init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
            let item = try c.decodeIfPresent(ItemRef.self, forKey: .item)
            name = item?.name ?? "Товар"
            unit = item?.unit ?? "шт"
            requested = try c.decodeFlexibleDouble(forKey: .requested) ?? 0
            approved = try c.decodeFlexibleDouble(forKey: .approved)
        }
    }

    public var statusLabel: String {
        switch status {
        case "pending", "new": "Ждёт решения"
        case "approved": "Одобрена"
        case "rejected", "declined": "Отклонена"
        case "fulfilled", "completed": "Выполнена"
        default: StatusText.humanize(status)
        }
    }

    public var isPending: Bool { status == "pending" || status == "new" }

    private enum CodingKeys: String, CodingKey {
        case id, status, comment
        case createdAt = "created_at"
        case company
        case sourceLocation = "source_location"
        case targetLocation = "target_location"
        case items
    }

    private struct NamedRef: Decodable { let name: String? }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        status = try c.decodeFlexibleString(forKey: .status) ?? "pending"
        comment = try c.decodeFlexibleString(forKey: .comment)
        createdAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .createdAt))
        companyName = try c.decodeIfPresent(NamedRef.self, forKey: .company)?.name
        sourceName = try c.decodeIfPresent(NamedRef.self, forKey: .sourceLocation)?.name
        targetName = try c.decodeIfPresent(NamedRef.self, forKey: .targetLocation)?.name
        lines = try c.decodeIfPresent([Line].self, forKey: .items) ?? []
    }
}

/// Ответ `GET /api/admin/store/overview`.
public struct StoreOverview: Decodable, Sendable {
    public let locations: [StoreLocation]
    public let balances: [StockBalance]
    public let movements: [StockMovement]
    public let requests: [StockRequest]

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        locations = try c.decodeIfPresent([StoreLocation].self, forKey: .locations) ?? []
        balances = try c.decodeIfPresent([StockBalance].self, forKey: .balances) ?? []
        movements = try c.decodeIfPresent([StockMovement].self, forKey: .movements) ?? []
        requests = try c.decodeIfPresent([StockRequest].self, forKey: .requests) ?? []
    }

    private enum CodingKeys: String, CodingKey {
        case locations, balances, movements, requests
    }

    // ── Производные сводки ───────────────────────────────────────────────────

    /// Позиции ниже порога — то, ради чего владелец открывает склад.
    public var lowStock: [StockBalance] {
        balances.filter(\.isLow).sorted { $0.quantity < $1.quantity }
    }

    public var pendingRequests: [StockRequest] {
        requests.filter(\.isPending)
    }

    /// Остатки, свёрнутые по товару: одна строка на позицию, количество
    /// суммой по всем точкам. Владельцу важен общий запас, а не где лежит.
    public var totalsByItem: [ItemTotal] {
        Self.totals(of: balances)
    }

    /// То же свёртывание, но по произвольному набору строк: раздел «Склад»
    /// считает итог только по местам хранения, без витрины.
    public static func totals(of balances: [StockBalance]) -> [ItemTotal] {
        var totals: [String: ItemTotal] = [:]
        for balance in balances {
            if var existing = totals[balance.itemID] {
                existing.quantity += balance.quantity
                existing.locationCount += 1
                totals[balance.itemID] = existing
            } else {
                totals[balance.itemID] = ItemTotal(
                    id: balance.itemID,
                    name: balance.name,
                    unit: balance.unit,
                    quantity: balance.quantity,
                    threshold: balance.lowStockThreshold,
                    locationCount: 1
                )
            }
        }
        return totals.values.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    public struct ItemTotal: Sendable, Identifiable, Hashable {
        public let id: String
        public let name: String
        public let unit: String
        public var quantity: Double
        public let threshold: Double?
        public var locationCount: Int

        public var isLow: Bool {
            guard let threshold, threshold > 0 else { return false }
            return quantity <= threshold
        }
    }
}

// ── Мягкое декодирование ─────────────────────────────────────────────────────

extension KeyedDecodingContainer {
    /// Supabase отдаёт идентификаторы то строкой, то числом (bigint), а
    /// количества — то `Double`, то строкой `"12.5"`. Строгий декодер на этом
    /// падает и роняет весь экран ради одного поля.
    func decodeFlexibleString(forKey key: Key) throws -> String? {
        if let value = try? decodeIfPresent(String.self, forKey: key) { return value }
        if let value = try? decodeIfPresent(Int.self, forKey: key) { return String(value) }
        if let value = try? decodeIfPresent(Double.self, forKey: key) { return String(value) }
        return nil
    }

    func decodeFlexibleDouble(forKey key: Key) throws -> Double? {
        if let value = try? decodeIfPresent(Double.self, forKey: key) { return value }
        if let value = try? decodeIfPresent(Int.self, forKey: key) { return Double(value) }
        if let value = try? decodeIfPresent(String.self, forKey: key) { return Double(value) }
        return nil
    }
}
