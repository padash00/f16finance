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
    /// Точка, которой принадлежит место хранения.
    ///
    /// Сервер присылал его всегда, а приложение не читало — и правка остатка
    /// была невозможна: серверу нужна точка, чтобы найти её склад.
    public let companyID: String?

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
        case companyID = "company_id"
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
        companyID = try c.decodeFlexibleString(forKey: .companyID)
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

    /// Одобрена, но со склада ещё не выдана.
    public var isApproved: Bool { status == "approved_full" || status == "approved_partial" }
    /// Выдана со склада, точкой ещё не принята.
    public var isIssued: Bool { status == "issued" }

    /// Следующий шаг цепочки. `nil` — заявка своё прошла.
    public var nextStage: StockRequestStage? {
        if isApproved { return .issued }
        if isIssued { return .received }
        return nil
    }

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

// ── Поиск по складу и заведение товара ───────────────────────────────────────

/// Находка глобального поиска: товар, приёмка, списание, заявка.
///
/// «Где эта банка» — вопрос, который задают стоя у полки, а не за столом.
/// На сайте поиск есть, в приложении не было: телефон умел искать только
/// внутри открытого списка.
public struct StoreSearchHit: Decodable, Sendable, Identifiable, Hashable {
    public let type: String
    public let title: String
    public let subtitle: String?

    public var id: String { "\(type)|\(title)|\(subtitle ?? "")" }

    /// Человеческое имя раздела — по нему видно, где находка лежит.
    public var kindLabel: String {
        switch type {
        case "item": "Товар"
        case "receipt": "Приёмка"
        case "writeoff": "Списание"
        case "request": "Заявка"
        case "supplier": "Поставщик"
        case "revision": "Ревизия"
        default: "Склад"
        }
    }
}

/// Товар, найденный по штрихкоду.
public struct BarcodeLookup: Decodable, Sendable {
    public let item: Item?

    public struct Item: Decodable, Sendable, Hashable {
        public let id: String
        public let name: String
        public let unit: String?
        public let salePrice: Double?

        private enum CodingKeys: String, CodingKey {
            case id, name, unit
            case salePrice = "sale_price"
        }
    }
}

/// Новый товар: имя, штрихкод и цены.
///
/// Заводится камерой, стоя у полки. Поэтому обязательного минимума ровно два
/// поля — имя и штрихкод; остальное можно дописать позже на сайте.
public struct NewStoreItem: Encodable, Sendable {
    public let action = "createItem"
    public let companyID: String
    public let name: String
    public let barcode: String
    public let unit: String
    public let salePrice: Double
    public let purchasePrice: Double

    public init(
        companyID: String,
        name: String,
        barcode: String,
        unit: String = "шт",
        salePrice: Double = 0,
        purchasePrice: Double = 0
    ) {
        self.companyID = companyID
        self.name = name
        self.barcode = barcode
        self.unit = unit
        self.salePrice = salePrice
        self.purchasePrice = purchasePrice
    }

    enum CodingKeys: String, CodingKey {
        case action, name, barcode, unit
        case companyID = "company_id"
        case salePrice = "sale_price"
        case purchasePrice = "purchase_price"
    }
}


/// Куда двигать заявку. Порядок — тот же, что на складе: одобрили, выдали,
/// приняли.
public enum StockRequestStage: String, Sendable {
    case issued
    case received

    public var actionLabel: String {
        switch self {
        case .issued: "Отметить выдачу"
        case .received: "Отметить получение"
        }
    }
}

// ── Остатки по локациям ──────────────────────────────────────────────────────

/// Остатки точки: что лежит на складе и что стоит на витрине.
///
/// В приложении была только номенклатура — что заведено, с ценой и штрихкодом.
/// Сколько чего лежит и где, приходилось смотреть с ноутбука; поправить
/// остаток после пересчёта — тем более.
public struct WarehouseStock: Decodable, Sendable {
    public let balances: [Balance]
    public let companies: [StockCompany]
    public let selectedCompanyID: String?

    public struct StockCompany: Decodable, Sendable, Identifiable, Hashable {
        public let id: String
        public let name: String
    }

    public struct Balance: Decodable, Sendable, Identifiable, Hashable {
        public let itemID: String
        public let name: String
        public let barcode: String?
        public let unit: String
        /// Сколько на складе всего.
        public let warehouse: Double
        /// Из них отложено под заявки — трогать нельзя.
        public let reserved: Double
        /// Сколько стоит на витрине.
        public let showcase: Double

        public var id: String { itemID }

        /// Свободный остаток склада: общий минус отложенное.
        public var available: Double { max(0, warehouse - reserved) }

        private enum CodingKeys: String, CodingKey {
            case itemID = "item_id"
            case item
            case warehouse = "warehouse_quantity"
            case reserved = "warehouse_reserved"
            case showcase = "showcase_quantity"
        }

        private struct ItemRef: Decodable {
            let name: String?
            let barcode: String?
            let unit: String?
        }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            itemID = try c.decodeFlexibleString(forKey: .itemID) ?? ""
            let item = (try? c.decodeIfPresent(ItemRef.self, forKey: .item)) ?? nil
            name = item?.name ?? "Без названия"
            barcode = item?.barcode
            unit = item?.unit ?? "шт"
            warehouse = try c.decodeFlexibleDouble(forKey: .warehouse) ?? 0
            reserved = try c.decodeFlexibleDouble(forKey: .reserved) ?? 0
            showcase = try c.decodeFlexibleDouble(forKey: .showcase) ?? 0
        }
    }

    private enum CodingKeys: String, CodingKey {
        case balances, companies
        case selectedCompanyID = "selectedCompanyId"
    }
}
