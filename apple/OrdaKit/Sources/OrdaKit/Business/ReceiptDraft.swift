import Foundation

// ── Приёмка товара ───────────────────────────────────────────────────────────
//
// Товар принимают у машины: коробки на полу, водитель ждёт, накладная в руках.
// Пока приёмку заводили только на сайте, между поставкой и записью проходил
// день — и всё это время склад показывал вчерашние остатки, а продавать уже
// начинали сегодня.

/// Позиция накладной.
public struct ReceiptLine: Sendable, Identifiable, Hashable {
    public let itemID: String
    public let name: String
    public let unit: String
    public var quantity: Double
    /// Цена закупки за единицу.
    public var unitCost: Double
    /// Новая цена продажи. `nil` — оставить прежнюю.
    public var salePrice: Double?
    /// Бонусная позиция: пришла бесплатно, в деньги не идёт.
    public var isBonus: Bool
    /// `YYYY-MM-DD`, если у товара есть срок.
    public var expiryDate: String?

    public var id: String { itemID }

    public init(
        itemID: String,
        name: String,
        unit: String,
        quantity: Double = 0,
        unitCost: Double = 0,
        salePrice: Double? = nil,
        isBonus: Bool = false,
        expiryDate: String? = nil
    ) {
        self.itemID = itemID
        self.name = name
        self.unit = unit
        self.quantity = quantity
        self.unitCost = unitCost
        self.salePrice = salePrice
        self.isBonus = isBonus
        self.expiryDate = expiryDate
    }

    /// Сколько стоит строка. Бонус не стоит ничего — это подарок поставщика,
    /// и включать его в сумму накладной значит завысить себестоимость.
    public var total: Double { isBonus ? 0 : quantity * unitCost }

    /// Наценка к закупочной цене.
    public var markup: Double? {
        guard let salePrice, unitCost > 0 else { return nil }
        return (salePrice - unitCost) / unitCost * 100
    }
}

/// Как платим поставщику.
public enum ReceiptPayment: String, Sendable, CaseIterable, Identifiable {
    /// Сразу, наличными или переводом.
    case now
    /// В долг: счёт попадёт в «Долги поставщикам».
    case deferred

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .now: "Оплачено"
        case .deferred: "В долг"
        }
    }
}

/// Накладная целиком.
public struct ReceiptDraft: Sendable, Equatable {
    public var locationID: String
    public var supplierID: String
    /// `YYYY-MM-DD`.
    public var receivedAt: String
    public var invoiceNumber: String
    public var payment: ReceiptPayment
    /// Наличные или перевод — только для оплаченных сразу.
    public var paymentMethod: String
    /// Срок оплаты для долга, `YYYY-MM-DD`.
    public var dueDate: String?
    /// Реализация: платим по мере продажи.
    public var isConsignment: Bool
    public var comment: String
    public var lines: [ReceiptLine]

    public init(receivedAt: String, locationID: String = "") {
        self.locationID = locationID
        supplierID = ""
        self.receivedAt = receivedAt
        invoiceNumber = ""
        payment = .now
        paymentMethod = "cash"
        dueDate = nil
        isConsignment = false
        comment = ""
        lines = []
    }

    /// Сумма накладной без бонусных позиций.
    public var total: Double { lines.reduce(0) { $0 + $1.total } }

    public var bonusCount: Int { lines.filter(\.isBonus).count }

    /// Что мешает провести.
    public var validationMessage: String? {
        if locationID.isEmpty { return "Выберите, куда принимаем" }
        if supplierID.isEmpty { return "Поставщик обязателен" }
        if lines.isEmpty { return "Добавьте хотя бы одну позицию" }
        if lines.contains(where: { $0.quantity <= 0 }) {
            return "У каждой позиции должно быть количество"
        }
        // Бонус по определению бесплатный, у остального цена обязана быть:
        // приёмка по нулевой цене обнуляет себестоимость товара.
        if lines.contains(where: { !$0.isBonus && $0.unitCost <= 0 }) {
            return "У платных позиций должна быть цена закупки"
        }
        if payment == .deferred, (dueDate ?? "").isEmpty, !isConsignment {
            return "У долга должен быть срок оплаты"
        }
        return nil
    }

    public var isValid: Bool { validationMessage == nil }

    func payload() -> ReceiptPayload {
        ReceiptPayload(
            locationID: locationID,
            supplierID: supplierID,
            receivedAt: receivedAt,
            invoiceNumber: invoiceNumber.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? nil
                : invoiceNumber.trimmingCharacters(in: .whitespacesAndNewlines),
            paymentMethod: payment == .now ? paymentMethod : nil,
            paymentMode: payment.rawValue,
            isConsignment: isConsignment,
            dueDate: payment == .deferred ? dueDate : nil,
            comment: comment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? nil
                : comment.trimmingCharacters(in: .whitespacesAndNewlines),
            items: lines.map {
                ReceiptItemPayload(
                    itemID: $0.itemID,
                    quantity: $0.quantity,
                    unitCost: $0.isBonus ? 0 : $0.unitCost,
                    salePrice: $0.salePrice,
                    isBonus: $0.isBonus,
                    expiryDate: $0.expiryDate
                )
            }
        )
    }
}

struct ReceiptItemPayload: Encodable {
    let itemID: String
    let quantity: Double
    let unitCost: Double
    let salePrice: Double?
    let isBonus: Bool
    let expiryDate: String?

    enum CodingKeys: String, CodingKey {
        case quantity
        case itemID = "item_id"
        case unitCost = "unit_cost"
        case salePrice = "sale_price"
        case isBonus = "is_bonus"
        case expiryDate = "expiry_date"
    }
}

struct ReceiptPayload: Encodable {
    let locationID: String
    let supplierID: String
    let receivedAt: String
    let invoiceNumber: String?
    let paymentMethod: String?
    let paymentMode: String
    let isConsignment: Bool
    let dueDate: String?
    let comment: String?
    let items: [ReceiptItemPayload]

    enum CodingKeys: String, CodingKey {
        case comment, items
        case locationID = "location_id"
        case supplierID = "supplier_id"
        case receivedAt = "received_at"
        case invoiceNumber = "invoice_number"
        case paymentMethod = "payment_method"
        case paymentMode = "payment_mode"
        case isConsignment = "is_consignment"
        case dueDate = "due_date"
    }
}

struct ReceiptCreateRequest: Encodable {
    let action = "createReceipt"
    let payload: ReceiptPayload
    let companyID: String?

    enum CodingKeys: String, CodingKey {
        case action, payload
        case companyID = "company_id"
    }
}
