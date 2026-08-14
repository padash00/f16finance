import Foundation

/// Товар витрины, доступный к продаже.
public struct SaleCatalogItem: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let barcode: String?
    public let unit: String?
    public let salePrice: Double?
    public let imageURL: String?
    /// Остаток на витрине. Сервер считает его отдельно от складского.
    public let displayQuantity: Double

    public var isInStock: Bool { displayQuantity > 0 }

    private enum CodingKeys: String, CodingKey {
        case id, name, barcode, unit
        case salePrice = "sale_price"
        case imageURL = "image_url"
        case displayQuantity = "display_qty"
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        name = try container.decodeIfPresent(String.self, forKey: .name) ?? "Без названия"
        barcode = try container.decodeIfPresent(String.self, forKey: .barcode)
        unit = try container.decodeIfPresent(String.self, forKey: .unit)
        salePrice = try container.decodeIfPresent(Double.self, forKey: .salePrice)
        imageURL = try container.decodeIfPresent(String.self, forKey: .imageURL)
        displayQuantity = try container.decodeIfPresent(Double.self, forKey: .displayQuantity) ?? 0
    }

    public init(
        id: String,
        name: String,
        barcode: String? = nil,
        unit: String? = nil,
        salePrice: Double? = nil,
        imageURL: String? = nil,
        displayQuantity: Double = 0
    ) {
        self.id = id
        self.name = name
        self.barcode = barcode
        self.unit = unit
        self.salePrice = salePrice
        self.imageURL = imageURL
        self.displayQuantity = displayQuantity
    }
}

/// Проведённый чек — для истории и графика выручки.
public struct RecentSale: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let totalAmount: Double
    public let cashAmount: Double
    public let kaspiAmount: Double
    public let soldAt: Date?
    public let paymentMethod: String?
    public let itemCount: Int

    private enum CodingKeys: String, CodingKey {
        case id, items
        case totalAmount = "total_amount"
        case cashAmount = "cash_amount"
        case kaspiAmount = "kaspi_amount"
        case soldAt = "sold_at"
        case paymentMethod = "payment_method"
    }

    private struct LineRef: Decodable {}

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        totalAmount = try c.decodeIfPresent(Double.self, forKey: .totalAmount) ?? 0
        cashAmount = try c.decodeIfPresent(Double.self, forKey: .cashAmount) ?? 0
        kaspiAmount = try c.decodeIfPresent(Double.self, forKey: .kaspiAmount) ?? 0
        soldAt = try c.decodeIfPresent(Date.self, forKey: .soldAt)
        paymentMethod = try c.decodeIfPresent(String.self, forKey: .paymentMethod)
        itemCount = (try c.decodeIfPresent([LineRef].self, forKey: .items))?.count ?? 0
    }

    public var paymentLabel: String {
        switch paymentMethod {
        case "cash": "наличные"
        case "kaspi": "Kaspi"
        case "mixed": "смешанная"
        default: "оплата"
        }
    }
}

/// Каталог точки — ответ `GET /api/operator/inventory-sales`.
public struct SaleCatalog: Decodable, Sendable {
    public let companyName: String
    public let items: [SaleCatalogItem]
    /// Последние чеки точки. Сервер отдаёт 20 штук — этого хватает и на
    /// историю, и на график выручки за смену.
    public let recentSales: [RecentSale]

    private enum RootKeys: String, CodingKey { case data }
    private enum DataKeys: String, CodingKey { case company, items, sales }
    private struct Company: Decodable { let name: String? }

    public init(from decoder: any Decoder) throws {
        let root = try decoder.container(keyedBy: RootKeys.self)
        let data = try root.nestedContainer(keyedBy: DataKeys.self, forKey: .data)
        companyName = (try data.decodeIfPresent(Company.self, forKey: .company))?.name ?? "Точка"
        items = try data.decodeIfPresent([SaleCatalogItem].self, forKey: .items) ?? []
        recentSales = try data.decodeIfPresent([RecentSale].self, forKey: .sales) ?? []
    }
}

/// Позиция в чеке.
public struct SaleLine: Codable, Sendable, Identifiable, Hashable {
    public let itemID: String
    public let name: String
    public var quantity: Double
    public let unitPrice: Double

    public var id: String { itemID }
    public var total: Double { quantity * unitPrice }

    public init(itemID: String, name: String, quantity: Double, unitPrice: Double) {
        self.itemID = itemID
        self.name = name
        self.quantity = quantity
        self.unitPrice = unitPrice
    }
}

/// Способ оплаты.
public enum PaymentMethod: String, Codable, Sendable, CaseIterable {
    case cash
    case kaspi
    case mixed

    public var label: String {
        switch self {
        case .cash: "Наличные"
        case .kaspi: "Kaspi"
        case .mixed: "Смешанная"
        }
    }
}

/// Тип смены. Для ночной смены Kaspi делится на «до» и «после» полуночи —
/// иначе выручка уедет в соседний день.
public enum ShiftKind: String, Codable, Sendable {
    case day
    case night
}

/// Черновик продажи. Одна структура и для отправки, и для офлайн-очереди.
public struct SaleDraft: Codable, Sendable, Identifiable, Hashable {
    /// Ключ идемпотентности. Сервер по нему дедуплицирует: если сеть пропала
    /// после отправки, но до ответа, повтор не создаст второй чек.
    public let localRef: String
    public let saleDate: String
    public let shift: ShiftKind
    public var lines: [SaleLine]
    public var paymentMethod: PaymentMethod
    public var cashAmount: Double
    public var kaspiAmount: Double
    public var kaspiBeforeMidnight: Double
    public var kaspiAfterMidnight: Double
    public var comment: String?
    public var customerID: String?
    /// Когда чек создан на устройстве — для порядка в очереди отправки.
    public let createdAt: Date

    public var id: String { localRef }

    public var total: Double {
        lines.reduce(0) { $0 + $1.total }
    }

    public var paymentTotal: Double { cashAmount + kaspiAmount }

    public init(
        localRef: String = UUID().uuidString,
        saleDate: String,
        shift: ShiftKind,
        lines: [SaleLine] = [],
        paymentMethod: PaymentMethod = .cash,
        cashAmount: Double = 0,
        kaspiAmount: Double = 0,
        kaspiBeforeMidnight: Double = 0,
        kaspiAfterMidnight: Double = 0,
        comment: String? = nil,
        customerID: String? = nil,
        createdAt: Date = Date()
    ) {
        self.localRef = localRef
        self.saleDate = saleDate
        self.shift = shift
        self.lines = lines
        self.paymentMethod = paymentMethod
        self.cashAmount = cashAmount
        self.kaspiAmount = kaspiAmount
        self.kaspiBeforeMidnight = kaspiBeforeMidnight
        self.kaspiAfterMidnight = kaspiAfterMidnight
        self.comment = comment
        self.customerID = customerID
        self.createdAt = createdAt
    }

    /// Проверки, которые сервер выполнит всё равно — но лучше не гонять
    /// заведомо плохой чек по сети, особенно когда её нет.
    public enum ValidationIssue: String, Sendable {
        case noLines
        case zeroPayment
        case kaspiSplitMismatch

        public var message: String {
            switch self {
            case .noLines: "Добавьте хотя бы один товар."
            case .zeroPayment: "Сумма оплаты должна быть больше нуля."
            case .kaspiSplitMismatch: "Kaspi до и после полуночи в сумме должны давать общую сумму Kaspi."
            }
        }
    }

    public func validate() -> ValidationIssue? {
        if lines.isEmpty { return .noLines }
        if paymentTotal <= 0 { return .zeroPayment }
        // Сервер сверяет с точностью до копейки — повторяем тот же допуск.
        if abs(kaspiAmount - (kaspiBeforeMidnight + kaspiAfterMidnight)) > 0.01 {
            return .kaspiSplitMismatch
        }
        return nil
    }

    /// Тело запроса `POST /api/operator/inventory-sales`.
    public func requestBody() -> [String: Any] {
        [
            "action": "createSale",
            "payload": [
                "sale_date": saleDate,
                "shift": shift.rawValue,
                "payment_method": paymentMethod.rawValue,
                "cash_amount": cashAmount,
                "kaspi_amount": kaspiAmount,
                "kaspi_before_midnight_amount": kaspiBeforeMidnight,
                "kaspi_after_midnight_amount": kaspiAfterMidnight,
                "customer_id": customerID as Any,
                "comment": comment as Any,
                "local_ref": localRef,
                "items": lines.map { line in
                    [
                        "item_id": line.itemID,
                        "quantity": line.quantity,
                        "unit_price": line.unitPrice,
                    ]
                },
            ],
        ]
    }
}

/// Результат проведённой продажи.
public struct SaleResult: Decodable, Sendable {
    public let saleID: String?
    public let totalAmount: Double
    public let receiptURL: String?
    public let loyaltyPointsEarned: Int
    /// Сервер вернул ранее созданный чек по тому же `local_ref`.
    public let isIdempotentReplay: Bool

    private enum RootKeys: String, CodingKey { case data }
    private enum DataKeys: String, CodingKey {
        case sale_id, total_amount, receipt_url, loyalty_points_earned, idempotent
    }

    public init(from decoder: any Decoder) throws {
        let root = try decoder.container(keyedBy: RootKeys.self)
        let data = try root.nestedContainer(keyedBy: DataKeys.self, forKey: .data)
        saleID = try data.decodeIfPresent(String.self, forKey: .sale_id)
        totalAmount = try data.decodeIfPresent(Double.self, forKey: .total_amount) ?? 0
        receiptURL = try data.decodeIfPresent(String.self, forKey: .receipt_url)
        loyaltyPointsEarned = try data.decodeIfPresent(Int.self, forKey: .loyalty_points_earned) ?? 0
        isIdempotentReplay = try data.decodeIfPresent(Bool.self, forKey: .idempotent) ?? false
    }
}

// ── Клиент в чеке ────────────────────────────────────────────────────────────

/// Клиент точки: карта лояльности, бонусы, история.
///
/// Продажа без клиента — это продажа, за которую не начислены бонусы. Карта
/// на брелке у человека есть, а привязать её было нечем: приложение о клиентах
/// не знало вовсе, хотя сервер принимает `customer_id` в чеке с самого начала.
public struct PointCustomer: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let phone: String?
    public let cardNumber: String?
    public let loyaltyPoints: Double
    public let totalSpent: Double
    public let visitsCount: Int

    private enum CodingKeys: String, CodingKey {
        case id, name, phone
        case cardNumber = "card_number"
        case loyaltyPoints = "loyalty_points"
        case totalSpent = "total_spent"
        case visitsCount = "visits_count"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? ""
        name = try c.decodeFlexibleString(forKey: .name) ?? "Клиент"
        phone = try c.decodeFlexibleString(forKey: .phone)
        cardNumber = try c.decodeFlexibleString(forKey: .cardNumber)
        loyaltyPoints = try c.decodeFlexibleDouble(forKey: .loyaltyPoints) ?? 0
        totalSpent = try c.decodeFlexibleDouble(forKey: .totalSpent) ?? 0
        visitsCount = Int(try c.decodeFlexibleDouble(forKey: .visitsCount) ?? 0)
    }

    /// Чем подписать в списке: карта или телефон — по ним и ищут.
    public var subtitle: String {
        [cardNumber, phone].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

/// Клиенты точки: поиск для чека.
public struct CustomerService: Sendable {
    private let api: APIClient

    public init(api: APIClient) { self.api = api }

    /// Поиск клиента точки. Пустой запрос — самые частые.
    public func customers(search: String = "") async throws -> [PointCustomer] {
        var query: [String: String] = [:]
        if !search.isEmpty { query["search"] = search }
        let response: DataList<PointCustomer> = try await api.send(
            APIRequest(path: "/api/operator/customers", query: query)
        )
        return response.items
    }
}
