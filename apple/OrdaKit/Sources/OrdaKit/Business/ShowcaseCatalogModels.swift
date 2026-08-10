import Foundation

// ── Витрина и каталог товаров ────────────────────────────────────────────────
//
// Три пункта меню — «Склад», «Витрина», «Каталог товаров» — вели на один
// экран остатков. На сайте это три разные страницы с разными вопросами:
// сколько лежит на складе, что стоит перед покупателем и что вообще заведено
// в номенклатуре с ценой и штрихкодом.

/// Строка витрины: `GET /api/admin/store/showcase`.
///
/// Сервер отдаёт и складское количество тем же ответом — оно нужно, чтобы
/// сразу видеть, есть ли чем пополнить витрину.
public struct ShowcaseRow: Decodable, Sendable, Identifiable, Hashable {
    public let itemID: String
    public let name: String
    public let unit: String?
    public let showcaseQuantity: Double
    public let warehouseQuantity: Double

    public var id: String { itemID }

    /// Витрина пуста, а на складе товар есть — повод сделать заявку.
    public var needsRefill: Bool { showcaseQuantity <= 0 && warehouseQuantity > 0 }

    private enum CodingKeys: String, CodingKey {
        case itemID = "item_id"
        case item
        case showcaseQuantity = "showcase_quantity"
        case warehouseQuantity = "warehouse_quantity"
    }

    private struct ItemRef: Decodable {
        let name: String?
        let unit: String?
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        itemID = try c.decodeFlexibleString(forKey: .itemID) ?? UUID().uuidString
        let item = try c.decodeIfPresent(ItemRef.self, forKey: .item)
        name = item?.name ?? "Без названия"
        unit = item?.unit
        showcaseQuantity = try c.decodeIfPresent(Double.self, forKey: .showcaseQuantity) ?? 0
        warehouseQuantity = try c.decodeIfPresent(Double.self, forKey: .warehouseQuantity) ?? 0
    }
}

/// Ответ витрины целиком: точки для переключателя и строки выбранной точки.
public struct ShowcasePage: Decodable, Sendable {
    public let companies: [Company]
    public let balances: [ShowcaseRow]
    public let selectedCompanyID: String?

    private enum CodingKeys: String, CodingKey {
        case companies, balances
        case selectedCompanyID = "selectedCompanyId"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        companies = try c.decodeIfPresent([Company].self, forKey: .companies) ?? []
        balances = try c.decodeIfPresent([ShowcaseRow].self, forKey: .balances) ?? []
        selectedCompanyID = try c.decodeFlexibleString(forKey: .selectedCompanyID)
    }
}

/// Позиция номенклатуры: `GET /api/admin/inventory/catalog`.
///
/// Это справочник, а не остаток: у позиции есть цена, штрихкод и категория, и
/// она существует, даже когда её нигде нет в наличии.
public struct CatalogItem: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let unit: String?
    public let barcode: String?
    public let salePrice: Double?
    public let categoryName: String?
    public let catalogQuantity: Double
    public let warehouseQuantity: Double
    public let showcaseQuantity: Double
    public let isActive: Bool

    /// Заведена, но нигде не лежит. На складе такие позиции копятся годами.
    public var isOutOfStock: Bool { catalogQuantity <= 0 }

    private enum CodingKeys: String, CodingKey {
        case id, name, unit, barcode, category
        case salePrice = "sale_price"
        case catalogQuantity = "catalog_qty"
        case warehouseQuantity = "warehouse_qty"
        case showcaseQuantity = "showcase_qty"
        case isActive = "is_active"
    }

    private struct CategoryRef: Decodable { let name: String? }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        name = try c.decodeFlexibleString(forKey: .name) ?? "Без названия"
        unit = try c.decodeFlexibleString(forKey: .unit)
        barcode = try c.decodeFlexibleString(forKey: .barcode)
        salePrice = try c.decodeIfPresent(Double.self, forKey: .salePrice)
        categoryName = try c.decodeIfPresent(CategoryRef.self, forKey: .category)?.name
        catalogQuantity = try c.decodeIfPresent(Double.self, forKey: .catalogQuantity) ?? 0
        warehouseQuantity = try c.decodeIfPresent(Double.self, forKey: .warehouseQuantity) ?? 0
        showcaseQuantity = try c.decodeIfPresent(Double.self, forKey: .showcaseQuantity) ?? 0
        isActive = try c.decodeIfPresent(Bool.self, forKey: .isActive) ?? true
    }
}
