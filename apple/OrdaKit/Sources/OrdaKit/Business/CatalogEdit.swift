import Foundation

// ── Правка каталога товаров ──────────────────────────────────────────────────
//
// Те же действия, что на странице «Каталог магазина» на сайте:
// - товар заводится `createItem` в `/api/admin/inventory` — обязательно с
//   точкой-магазином (`company_id`), иначе сервер ответит `point-required`;
// - правится `updateItem` в `/api/admin/inventory/catalog` — это полная замена
//   полей карточки, поэтому уходит всё, что сайт шлёт, а не только изменённое;
// - удаляется `deleteItem` (с историей — в архив), возвращается `restoreItem`;
// - фото — отдельным `PATCH /api/admin/store/catalog/{id}`;
// - категории — `createCategory` / `updateCategory` / `deleteCategory`.
// Права — `store-catalog.create / edit / delete`, сервер проверяет их сам.

/// Категория товаров точки.
public struct InventoryCategory: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String

    public init(id: String, name: String) {
        self.id = id
        self.name = name
    }
}

/// Форма товара: новый или правка существующего.
public struct CatalogItemDraft: Sendable, Equatable {
    public var name: String
    public var barcode: String
    public var unit: String
    public var salePrice: Double
    public var purchasePrice: Double
    public var categoryID: String?
    /// `product` — продаётся, `consumable` — расходник, списывается.
    public var itemType: String
    public var notes: String
    public var lowStockThreshold: Double?
    public var requiresExpiry: Bool
    public var imageURL: String

    public init(
        name: String = "",
        barcode: String = "",
        unit: String = "шт",
        salePrice: Double = 0,
        purchasePrice: Double = 0,
        categoryID: String? = nil,
        itemType: String = "product",
        notes: String = "",
        lowStockThreshold: Double? = nil,
        requiresExpiry: Bool = false,
        imageURL: String = ""
    ) {
        self.name = name
        self.barcode = barcode
        self.unit = unit
        self.salePrice = salePrice
        self.purchasePrice = purchasePrice
        self.categoryID = categoryID
        self.itemType = itemType
        self.notes = notes
        self.lowStockThreshold = lowStockThreshold
        self.requiresExpiry = requiresExpiry
        self.imageURL = imageURL
    }

    /// Форма с тем, что уже записано у товара.
    public init(item: CatalogItem) {
        self.init(
            name: item.name,
            barcode: item.barcode ?? "",
            unit: item.unit ?? "шт",
            salePrice: item.salePrice ?? 0,
            purchasePrice: item.purchasePrice ?? 0,
            categoryID: item.categoryID,
            itemType: item.itemType,
            notes: item.notes ?? "",
            lowStockThreshold: item.lowStockThreshold,
            requiresExpiry: item.requiresExpiry,
            imageURL: item.imageURL ?? ""
        )
    }

    /// Почему нельзя сохранить; `nil` — можно. Те же правила, что у сервера.
    public var problem: String? {
        if name.trimmingCharacters(in: .whitespaces).isEmpty { return "Укажите название" }
        if barcode.trimmingCharacters(in: .whitespaces).isEmpty { return "Укажите штрихкод" }
        if salePrice < 0 || purchasePrice < 0 { return "Цена не может быть меньше нуля" }
        return nil
    }

    /// Поля товара в том виде, в каком их шлёт сайт.
    var fields: [String: Any] {
        let trimmedNotes = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedUnit = unit.trimmingCharacters(in: .whitespaces)
        return [
            "name": name.trimmingCharacters(in: .whitespaces),
            "barcode": barcode.trimmingCharacters(in: .whitespaces),
            "unit": trimmedUnit.isEmpty ? "шт" : trimmedUnit,
            "sale_price": salePrice,
            "default_purchase_price": purchasePrice,
            "category_id": categoryID as Any? ?? NSNull(),
            "item_type": itemType,
            "notes": trimmedNotes.isEmpty ? NSNull() : trimmedNotes,
            "low_stock_threshold": lowStockThreshold as Any? ?? NSNull(),
            "requires_expiry": requiresExpiry,
        ]
    }

    func createBody(companyID: String) throws -> Data {
        try JSONSerialization.data(withJSONObject: [
            "action": "createItem",
            "company_id": companyID,
            "payload": fields,
        ])
    }

    func updateBody(itemID: String) throws -> Data {
        try JSONSerialization.data(withJSONObject: [
            "action": "updateItem",
            "item_id": itemID,
            "fields": fields,
        ])
    }
}

/// Ответ на создание товара — нужен id, чтобы поставить фото.
private struct CreatedItem: Decodable, Sendable {
    let id: String
}

extension BusinessService {
    /// Завести товар в точке-магазине. Возвращает id нового товара.
    ///
    /// Запрос один: ответ разбираем сами. Повторять создание при непонятном
    /// ответе нельзя — у сервера нет ключа повтора, и товар завёлся бы дважды.
    @discardableResult
    public func createCatalogItem(_ draft: CatalogItemDraft, companyID: String) async throws -> String? {
        let raw = try await api.send(
            APIRequest(path: "/api/admin/inventory", method: .post, body: try draft.createBody(companyID: companyID))
        )
        let id = (try? JSONDecoder().decode(Envelope<CreatedItem>.self, from: raw))?.data.id
        let photo = draft.imageURL.trimmingCharacters(in: .whitespaces)
        if let id, !photo.isEmpty { try? await setCatalogPhoto(itemID: id, url: photo) }
        return id
    }

    /// Сохранить карточку товара целиком.
    public func updateCatalogItem(id: String, draft: CatalogItemDraft, previousImageURL: String?) async throws {
        _ = try await api.send(
            APIRequest(path: "/api/admin/inventory/catalog", method: .post, body: try draft.updateBody(itemID: id))
        )
        let photo = draft.imageURL.trimmingCharacters(in: .whitespaces)
        if photo != (previousImageURL ?? "") {
            try await setCatalogPhoto(itemID: id, url: photo.isEmpty ? nil : photo)
        }
    }

    /// Фото товара — ссылкой.
    public func setCatalogPhoto(itemID: String, url: String?) async throws {
        let value: Any = url ?? NSNull()
        let body = try JSONSerialization.data(withJSONObject: ["image_url": value])
        _ = try await api.send(APIRequest(path: "/api/admin/store/catalog/\(itemID)", method: .patch, body: body))
    }

    /// Удалить товар. С историей движений сервер отправит его в архив, с
    /// остатком — откажет.
    public func deleteCatalogItem(id: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["action": "deleteItem", "item_id": id])
        _ = try await api.send(APIRequest(path: "/api/admin/inventory/catalog", method: .post, body: body))
    }

    /// Вернуть товар из архива.
    public func restoreCatalogItem(id: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["action": "restoreItem", "item_id": id])
        _ = try await api.send(APIRequest(path: "/api/admin/inventory/catalog", method: .post, body: body))
    }

    /// Категории: точки — если она передана, иначе все в организации.
    public func inventoryCategories(companyID: String? = nil) async throws -> [InventoryCategory] {
        var query: [String: String] = [:]
        if let companyID { query["company_id"] = companyID }
        let response: Envelope<[InventoryCategory]> = try await api.send(
            APIRequest(path: "/api/admin/inventory/categories", query: query)
        )
        return response.data
    }

    public func createInventoryCategory(name: String, companyID: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: [
            "action": "createCategory",
            "company_id": companyID,
            "payload": ["name": name.trimmingCharacters(in: .whitespaces)],
        ])
        _ = try await api.send(APIRequest(path: "/api/admin/inventory", method: .post, body: body))
    }

    public func renameInventoryCategory(id: String, name: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: [
            "action": "updateCategory",
            "id": id,
            "payload": ["name": name.trimmingCharacters(in: .whitespaces)],
        ])
        _ = try await api.send(APIRequest(path: "/api/admin/inventory", method: .post, body: body))
    }

    /// Удалить категорию: товары останутся «Без категории».
    public func deleteInventoryCategory(id: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["action": "deleteCategory", "id": id])
        _ = try await api.send(APIRequest(path: "/api/admin/inventory", method: .post, body: body))
    }
}
