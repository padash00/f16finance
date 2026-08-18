import Foundation

// ── Производство и закуп ─────────────────────────────────────────────────────
//
// Четыре раздела, отвечающие на разные денежные вопросы владельца:
//   • техкарты          — сколько стоит блюдо и какая доля выручки уходит в продукт;
//   • план закупа       — сколько взять на следующую неделю и на какую сумму;
//   • заказы поставщикам— что заказано и до сих пор не приехало;
//   • расходники        — где расходник вот-вот кончится.
//
// Декодирование мягкое: Supabase отдаёт идентификаторы то строкой, то числом,
// а суммы — то `Double`, то строкой. Одно кривое поле не должно ронять экран.

// ─────────────────────────────────────────────────────────────────────────────
// MARK: Техкарты — /api/admin/production/recipes
// ─────────────────────────────────────────────────────────────────────────────

/// Техкарта: состав блюда и его себестоимость.
///
/// `recipeCost` и `portionCost` считает сервер (`resolveAllRecipeCosts`): там
/// конвертация единиц (кг↔г, л↔мл) и рекурсия по вложенным полуфабрикатам.
/// Клиент эти числа только показывает — дублировать формулу нельзя, разойдётся.
public struct Recipe: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let category: String?
    /// Сколько порций (или кг) даёт одна закладка.
    public let outputQty: Double
    public let outputUnit: String
    /// Коэффициент выхода: 0.97 = 3 % ужарки. Уже учтён в `portionCost`.
    public let yieldFactor: Double
    /// Товар в чеке, к которому привязана техкарта. Без него цену продажи
    /// взять неоткуда, и food cost посчитать нельзя.
    public let saleItemID: String?
    public let isSemiFinished: Bool
    public let isActive: Bool
    public let notes: String?
    public let recipeCost: Double
    public let portionCost: Double
    public let components: [RecipeComponent]

    /// Чистый выход с учётом потерь — то, на что сервер делит себестоимость.
    public var netOutput: Double { outputQty * yieldFactor }

    /// Потери выхода в процентах. `nil`, когда потерь не заложено.
    public var lossPercent: Double? {
        guard yieldFactor > 0, yieldFactor < 1 else { return nil }
        return (1 - yieldFactor) * 100
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, category, notes, components
        case outputQty = "output_qty"
        case outputUnit = "output_unit"
        case yieldFactor = "yield_factor"
        case saleItemID = "sale_item_id"
        case isSemiFinished = "is_semi_finished"
        case isActive = "is_active"
        case recipeCost = "recipe_cost"
        case portionCost = "portion_cost"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        name = try c.decodeFlexibleString(forKey: .name) ?? "Без названия"
        category = try c.decodeFlexibleString(forKey: .category)
        outputQty = try c.decodeFlexibleDouble(forKey: .outputQty) ?? 1
        outputUnit = try c.decodeFlexibleString(forKey: .outputUnit) ?? "порц"
        yieldFactor = try c.decodeFlexibleDouble(forKey: .yieldFactor) ?? 1
        saleItemID = try c.decodeFlexibleString(forKey: .saleItemID)
        isSemiFinished = try c.decodeIfPresent(Bool.self, forKey: .isSemiFinished) ?? false
        isActive = try c.decodeIfPresent(Bool.self, forKey: .isActive) ?? true
        notes = try c.decodeFlexibleString(forKey: .notes)
        recipeCost = try c.decodeFlexibleDouble(forKey: .recipeCost) ?? 0
        portionCost = try c.decodeFlexibleDouble(forKey: .portionCost) ?? 0
        components = try c.decodeIfPresent([RecipeComponent].self, forKey: .components) ?? []
    }
}

/// Строка состава: ингредиент или вложенный полуфабрикат.
public struct RecipeComponent: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    /// Имя, вписанное руками. Для строк с `ingredientID` обычно пустое —
    /// сервер отдаёт сырую строку `recipe_components`, имя лежит в каталоге.
    public let rawName: String?
    public let ingredientID: String?
    public let componentRecipeID: String?
    public let qty: Double
    public let unit: String
    /// Технологические потери на этой строке (зачистка, обрезь).
    public let wastePct: Double
    public let sortOrder: Int

    private enum CodingKeys: String, CodingKey {
        case id, name, qty, unit
        case ingredientID = "ingredient_id"
        case componentRecipeID = "component_recipe_id"
        case wastePct = "waste_pct"
        case sortOrder = "sort_order"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        rawName = try c.decodeFlexibleString(forKey: .name)
        ingredientID = try c.decodeFlexibleString(forKey: .ingredientID)
        componentRecipeID = try c.decodeFlexibleString(forKey: .componentRecipeID)
        qty = try c.decodeFlexibleDouble(forKey: .qty) ?? 0
        unit = try c.decodeFlexibleString(forKey: .unit) ?? "г"
        wastePct = try c.decodeFlexibleDouble(forKey: .wastePct) ?? 0
        sortOrder = Int(try c.decodeFlexibleDouble(forKey: .sortOrder) ?? 0)
    }
}

/// Ингредиент из каталога сырья.
public struct RecipeIngredient: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let unit: String
    /// Закупочная цена за одну единицу (`unit`).
    public let purchasePrice: Double
    public let category: String?
    public let stockQty: Double?

    private enum CodingKeys: String, CodingKey {
        case id, name, unit, category
        case purchasePrice = "purchase_price"
        case stockQty = "stock_qty"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        name = try c.decodeFlexibleString(forKey: .name) ?? "Ингредиент"
        unit = try c.decodeFlexibleString(forKey: .unit) ?? ""
        purchasePrice = try c.decodeFlexibleDouble(forKey: .purchasePrice) ?? 0
        category = try c.decodeFlexibleString(forKey: .category)
        stockQty = try c.decodeFlexibleDouble(forKey: .stockQty)
    }
}

/// Товар каталога продаж — источник цены, с которой сравнивают себестоимость.
public struct RecipeSaleItem: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let salePrice: Double?

    private enum CodingKeys: String, CodingKey {
        case id, name
        case salePrice = "sale_price"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        name = try c.decodeFlexibleString(forKey: .name) ?? "Товар"
        salePrice = try c.decodeFlexibleDouble(forKey: .salePrice)
    }
}

/// Ответ `GET /api/admin/production/recipes` — поля лежат в корне, без конверта.
public struct ProductionCatalog: Decodable, Sendable {
    public let recipes: [Recipe]
    public let ingredients: [RecipeIngredient]
    public let saleItems: [RecipeSaleItem]

    private enum CodingKeys: String, CodingKey {
        case recipes, ingredients, saleItems
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        recipes = try c.decodeIfPresent([Recipe].self, forKey: .recipes) ?? []
        ingredients = try c.decodeIfPresent([RecipeIngredient].self, forKey: .ingredients) ?? []
        saleItems = try c.decodeIfPresent([RecipeSaleItem].self, forKey: .saleItems) ?? []
    }

    /// Техкарты, склеенные с ценой продажи и именами компонентов.
    ///
    /// Склейка живёт здесь, а не во вью: она одинакова для списка и карточки,
    /// а строить словари на каждый кадр — лишняя работа.
    public func economics() -> [RecipeEconomics] {
        let priceByItem = Dictionary(saleItems.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let ingredientByID = Dictionary(ingredients.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let recipeNameByID = Dictionary(recipes.map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first })

        return recipes.map { recipe in
            let saleItem = recipe.saleItemID.flatMap { priceByItem[$0] }
            let lines = recipe.components
                .sorted { $0.sortOrder < $1.sortOrder }
                .map { component -> RecipeComponentLine in
                    let resolved: String? = {
                        if let raw = component.rawName, !raw.isEmpty { return raw }
                        if let id = component.ingredientID { return ingredientByID[id]?.name }
                        if let id = component.componentRecipeID { return recipeNameByID[id] }
                        return nil
                    }()
                    return RecipeComponentLine(
                        id: component.id,
                        name: resolved ?? "Компонент",
                        qty: component.qty,
                        unit: component.unit,
                        wastePct: component.wastePct,
                        isSemiFinished: component.componentRecipeID != nil
                    )
                }
            return RecipeEconomics(
                recipe: recipe,
                salePrice: saleItem?.salePrice,
                saleItemName: saleItem?.name,
                lines: lines
            )
        }
    }
}

/// Строка состава с разрешённым именем.
///
/// Стоимости строки здесь нет намеренно: сервер отдаёт только итог по
/// техкарте, а считать её на клиенте значит повторить конвертацию единиц и
/// рекурсию по полуфабрикатам — две реализации разойдутся на первой же правке.
public struct RecipeComponentLine: Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let qty: Double
    public let unit: String
    public let wastePct: Double
    public let isSemiFinished: Bool

    public init(id: String, name: String, qty: Double, unit: String, wastePct: Double, isSemiFinished: Bool) {
        self.id = id
        self.name = name
        self.qty = qty
        self.unit = unit
        self.wastePct = wastePct
        self.isSemiFinished = isSemiFinished
    }
}

/// Техкарта глазами владельца: во что обходится порция и что остаётся с неё.
public struct RecipeEconomics: Sendable, Identifiable, Hashable {
    public let recipe: Recipe
    public let salePrice: Double?
    public let saleItemName: String?
    public let lines: [RecipeComponentLine]

    public var id: String { recipe.id }
    public var name: String { recipe.name }
    public var portionCost: Double { recipe.portionCost }

    /// Цены нет — либо техкарта не привязана к блюду, либо блюдо бесплатное.
    /// Такую позицию нельзя оценить: food cost неизвестен, а не «нулевой».
    public var isUnpriced: Bool {
        guard let salePrice else { return true }
        return salePrice <= 0
    }

    /// Доля себестоимости в цене продажи — тот самый food cost.
    public var foodCostShare: Double? {
        guard let salePrice, salePrice > 0 else { return nil }
        return recipe.portionCost / salePrice * 100
    }

    /// Сколько остаётся с порции до всех прочих расходов.
    public var marginPerPortion: Double? {
        guard let salePrice, salePrice > 0 else { return nil }
        return salePrice - recipe.portionCost
    }

    /// Порог тревоги — 35 %, как на портале. Выше него блюдо съедает маржу.
    public var isFoodCostHigh: Bool {
        guard let share = foodCostShare else { return false }
        return share > 35
    }
}

// ── Факт: /api/admin/production/analysis ─────────────────────────────────────

/// Теоретический food cost за период — по фактическим продажам блюд.
public struct ProductionAnalysis: Decodable, Sendable {
    public let from: String
    public let to: String
    public let rows: [ProductionAnalysisRow]
    public let ingredients: [ProductionIngredientUsage]
    public let totals: ProductionTotals

    private enum CodingKeys: String, CodingKey {
        case from, to, rows, ingredients, totals
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        from = try c.decodeFlexibleString(forKey: .from) ?? ""
        to = try c.decodeFlexibleString(forKey: .to) ?? ""
        rows = try c.decodeIfPresent([ProductionAnalysisRow].self, forKey: .rows) ?? []
        ingredients = try c.decodeIfPresent([ProductionIngredientUsage].self, forKey: .ingredients) ?? []
        totals = ((try? c.decodeIfPresent(ProductionTotals.self, forKey: .totals)) ?? nil) ?? .empty
    }

    /// Быстрый доступ к факту по конкретной техкарте.
    public func row(recipeID: String) -> ProductionAnalysisRow? {
        rows.first { $0.recipeID == recipeID }
    }
}

/// Блюдо за период: продано, во что обошлось, сколько принесло.
public struct ProductionAnalysisRow: Decodable, Sendable, Identifiable, Hashable {
    public let recipeID: String
    public let name: String
    public let soldQty: Double
    public let portionCost: Double
    public let foodCost: Double
    public let revenue: Double
    public let margin: Double
    public let foodCostPercent: Double

    public var id: String { recipeID }

    public var isFoodCostHigh: Bool { foodCostPercent > 35 }

    private enum CodingKeys: String, CodingKey {
        case name, revenue, margin
        case recipeID = "recipe_id"
        case soldQty = "sold_qty"
        case portionCost = "portion_cost"
        case foodCost = "food_cost"
        case foodCostPercent = "food_cost_pct"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        recipeID = try c.decodeFlexibleString(forKey: .recipeID) ?? UUID().uuidString
        name = try c.decodeFlexibleString(forKey: .name) ?? "Блюдо"
        soldQty = try c.decodeFlexibleDouble(forKey: .soldQty) ?? 0
        portionCost = try c.decodeFlexibleDouble(forKey: .portionCost) ?? 0
        foodCost = try c.decodeFlexibleDouble(forKey: .foodCost) ?? 0
        revenue = try c.decodeFlexibleDouble(forKey: .revenue) ?? 0
        margin = try c.decodeFlexibleDouble(forKey: .margin) ?? 0
        foodCostPercent = try c.decodeFlexibleDouble(forKey: .foodCostPercent) ?? 0
    }
}

/// Сколько сырья ушло за период и на какую сумму.
public struct ProductionIngredientUsage: Decodable, Sendable, Identifiable, Hashable {
    public let ingredientID: String
    public let name: String
    public let unit: String
    public let qty: Double
    public let cost: Double

    public var id: String { ingredientID }

    private enum CodingKeys: String, CodingKey {
        case name, unit, qty, cost
        case ingredientID = "ingredient_id"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ingredientID = try c.decodeFlexibleString(forKey: .ingredientID) ?? UUID().uuidString
        name = try c.decodeFlexibleString(forKey: .name) ?? "Ингредиент"
        unit = try c.decodeFlexibleString(forKey: .unit) ?? ""
        qty = try c.decodeFlexibleDouble(forKey: .qty) ?? 0
        cost = try c.decodeFlexibleDouble(forKey: .cost) ?? 0
    }
}

/// Итог по периоду. `foodCostPercent` — та самая доля выручки, ушедшая в продукт.
public struct ProductionTotals: Decodable, Sendable, Hashable {
    public let sold: Double
    public let foodCost: Double
    public let revenue: Double
    public let margin: Double
    public let foodCostPercent: Double

    public static let empty = ProductionTotals(sold: 0, foodCost: 0, revenue: 0, margin: 0, foodCostPercent: 0)

    public init(sold: Double, foodCost: Double, revenue: Double, margin: Double, foodCostPercent: Double) {
        self.sold = sold
        self.foodCost = foodCost
        self.revenue = revenue
        self.margin = margin
        self.foodCostPercent = foodCostPercent
    }

    private enum CodingKeys: String, CodingKey {
        case sold, revenue, margin
        case foodCost = "food_cost"
        case foodCostPercent = "food_cost_pct"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        sold = try c.decodeFlexibleDouble(forKey: .sold) ?? 0
        foodCost = try c.decodeFlexibleDouble(forKey: .foodCost) ?? 0
        revenue = try c.decodeFlexibleDouble(forKey: .revenue) ?? 0
        // Маржа и доля приходят не во всех ветках ответа — досчитываем сами:
        // это вычитание и деление, а не бизнес-формула сервера.
        let decodedMargin = try c.decodeFlexibleDouble(forKey: .margin)
        margin = decodedMargin ?? (revenue - foodCost)
        let decodedShare = try c.decodeFlexibleDouble(forKey: .foodCostPercent)
        foodCostPercent = decodedShare ?? (revenue > 0 ? foodCost / revenue * 100 : 0)
    }

    public var isHigh: Bool { foodCostPercent > 35 }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: План закупа — /api/admin/store/purchase-plan/suggest
// ─────────────────────────────────────────────────────────────────────────────

/// План закупа на следующую неделю по одной точке.
///
/// Всё содержимое считает сервер (`computePurchasePlan`): спрос за 28 дней,
/// целевой запас на 2 недели, округление до целых упаковок, последняя
/// закупочная цена. Здесь только представление.
public struct PurchasePlan: Decodable, Sendable {
    public let companyID: String
    /// Понедельник недели, на которую составлен план.
    public let weekStart: Date?
    public let weekStartRaw: String
    public let generatedAt: Date?
    /// Сумма закупа по всем поставщикам.
    public let total: Double
    /// Выручка точки за последнюю неделю — база для сравнения.
    public let weeklyRevenue: Double
    public let bySupplier: [PurchasePlanSupplier]
    /// Затоваренные позиции: брать не нужно, деньги уже лежат на полке.
    public let doNotBuy: [PurchasePlanSkip]

    private enum CodingKeys: String, CodingKey {
        case total, bySupplier, doNotBuy
        case companyID = "company_id"
        case weekStart
        case generatedAt
        case weeklyRevenue = "revenue4wPerWeek"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        companyID = try c.decodeFlexibleString(forKey: .companyID) ?? ""
        weekStartRaw = try c.decodeFlexibleString(forKey: .weekStart) ?? ""
        weekStart = DateParsing.date(from: weekStartRaw)
        generatedAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .generatedAt))
        total = try c.decodeFlexibleDouble(forKey: .total) ?? 0
        weeklyRevenue = try c.decodeFlexibleDouble(forKey: .weeklyRevenue) ?? 0
        bySupplier = try c.decodeIfPresent([PurchasePlanSupplier].self, forKey: .bySupplier) ?? []
        doNotBuy = try c.decodeIfPresent([PurchasePlanSkip].self, forKey: .doNotBuy) ?? []
    }

    public var lines: [PurchasePlanLine] { bySupplier.flatMap(\.items) }

    public var positionCount: Int { lines.count }

    /// Позиции, которых сейчас нет на полке: спрос был, товара нет — реальный
    /// спрос выше расчётного, и заказ по нему занижен.
    public var outOfStock: [PurchasePlanLine] { lines.filter(\.wasOutOfStock) }

    /// Какую долю недельной выручки съест этот закуп. `nil`, когда сравнивать
    /// не с чем — за неделю не продано ничего.
    public var shareOfRevenue: Double? {
        guard weeklyRevenue > 0 else { return nil }
        return total / weeklyRevenue * 100
    }

    public var isEmpty: Bool { bySupplier.isEmpty && doNotBuy.isEmpty }
}

/// Группа плана: один поставщик и его позиции.
public struct PurchasePlanSupplier: Decodable, Sendable, Identifiable, Hashable {
    public let supplier: String
    public let total: Double
    public let items: [PurchasePlanLine]

    public var id: String { supplier }

    /// Сервер ставит «—», когда товар ни разу не приходил по накладной.
    public var isUnknownSupplier: Bool { supplier == "—" || supplier.isEmpty }

    public var displayName: String { isUnknownSupplier ? "Поставщик не определён" : supplier }

    private enum CodingKeys: String, CodingKey { case supplier, total, items }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        supplier = try c.decodeFlexibleString(forKey: .supplier) ?? "—"
        total = try c.decodeFlexibleDouble(forKey: .total) ?? 0
        items = try c.decodeIfPresent([PurchasePlanLine].self, forKey: .items) ?? []
    }
}

/// Позиция плана: сколько взять и на какую сумму.
public struct PurchasePlanLine: Decodable, Sendable, Identifiable, Hashable {
    public let itemID: String
    public let name: String
    public let barcode: String
    /// Средний недельный спрос по продажам за 28 дней.
    public let weeklyDemand: Double
    /// Изменение спроса: последние 14 дней против предыдущих 14.
    public let trendPercent: Double
    public let stock: Double
    /// Сколько единиц заказать (уже кратно упаковке).
    public let order: Double
    public let unitCost: Double
    public let amount: Double
    public let salePrice: Double
    public let marginPercent: Double
    /// На сколько недель хватит текущего остатка.
    public let coverageWeeks: Double
    public let wasOutOfStock: Bool
    public let packSize: Double
    public let packs: Double

    public var id: String { itemID }

    /// Упаковка больше единицы — заказ имеет смысл называть коробками.
    public var isPacked: Bool { packSize > 1 }

    public var isRising: Bool { trendPercent >= 20 }
    public var isFalling: Bool { trendPercent <= -20 }

    private enum CodingKeys: String, CodingKey {
        case name, barcode, weeklyDemand, stock, order, unitCost, amount, salePrice, coverageWeeks, packSize, packs
        case itemID = "item_id"
        case trendPercent = "trendPct"
        case marginPercent = "marginPct"
        case wasOutOfStock
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        itemID = try c.decodeFlexibleString(forKey: .itemID) ?? UUID().uuidString
        name = try c.decodeFlexibleString(forKey: .name) ?? "Товар"
        barcode = try c.decodeFlexibleString(forKey: .barcode) ?? ""
        weeklyDemand = try c.decodeFlexibleDouble(forKey: .weeklyDemand) ?? 0
        trendPercent = try c.decodeFlexibleDouble(forKey: .trendPercent) ?? 0
        stock = try c.decodeFlexibleDouble(forKey: .stock) ?? 0
        order = try c.decodeFlexibleDouble(forKey: .order) ?? 0
        unitCost = try c.decodeFlexibleDouble(forKey: .unitCost) ?? 0
        amount = try c.decodeFlexibleDouble(forKey: .amount) ?? 0
        salePrice = try c.decodeFlexibleDouble(forKey: .salePrice) ?? 0
        marginPercent = try c.decodeFlexibleDouble(forKey: .marginPercent) ?? 0
        coverageWeeks = try c.decodeFlexibleDouble(forKey: .coverageWeeks) ?? 0
        wasOutOfStock = try c.decodeIfPresent(Bool.self, forKey: .wasOutOfStock) ?? false
        packSize = try c.decodeFlexibleDouble(forKey: .packSize) ?? 1
        packs = try c.decodeFlexibleDouble(forKey: .packs) ?? 0
    }
}

/// Затоваренная позиция: остатка хватит надолго, деньги вкладывать не надо.
public struct PurchasePlanSkip: Decodable, Sendable, Identifiable, Hashable {
    public let itemID: String
    public let name: String
    public let stock: Double
    public let weeklyDemand: Double
    public let coverageWeeks: Double

    public var id: String { itemID }

    private enum CodingKeys: String, CodingKey {
        case name, stock, weeklyDemand, coverageWeeks
        case itemID = "item_id"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        itemID = try c.decodeFlexibleString(forKey: .itemID) ?? UUID().uuidString
        name = try c.decodeFlexibleString(forKey: .name) ?? "Товар"
        stock = try c.decodeFlexibleDouble(forKey: .stock) ?? 0
        weeklyDemand = try c.decodeFlexibleDouble(forKey: .weeklyDemand) ?? 0
        coverageWeeks = try c.decodeFlexibleDouble(forKey: .coverageWeeks) ?? 0
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: Заказы поставщикам — /api/admin/store/purchase-orders
// ─────────────────────────────────────────────────────────────────────────────

/// Заявка поставщику.
///
/// Список и карточка приходят одним типом: карточка добавляет состав,
/// контакты представителя и причину отмены, список — только счётчик позиций.
public struct PurchaseOrder: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let status: String
    /// Заявку собрал автомат по остаткам, а не человек.
    public let isAuto: Bool
    public let comment: String?
    public let cancelReason: String?
    public let createdAt: Date?
    public let sentAt: Date?
    public let receivedAt: Date?
    public let cancelledAt: Date?
    public let supplierName: String
    public let supplierPhone: String?
    public let repName: String?
    public let repPhone: String?
    /// Обещанный поставщиком срок поставки в днях.
    public let leadTimeDays: Int?
    public let itemCount: Int
    public let lines: [PurchaseOrderLine]

    public var statusLabel: String {
        switch status {
        case "draft": "Черновик"
        case "sent": "Отправлена"
        case "received": "Получена"
        case "cancelled": "Отменена"
        default: status
        }
    }

    public var icon: String {
        switch status {
        case "draft": "square.and.pencil"
        case "sent": "paperplane.fill"
        case "received": "checkmark.circle.fill"
        case "cancelled": "xmark.circle"
        default: "doc.text"
        }
    }

    public var isDraft: Bool { status == "draft" }
    public var isCancelled: Bool { status == "cancelled" }
    public var isReceived: Bool { status == "received" }

    /// Отправлена и не приехала — ровно то, ради чего владелец сюда заходит.
    public var isInTransit: Bool { status == "sent" }

    /// Заявка ещё в работе: либо не отправлена, либо не приехала.
    public var isOpen: Bool { isDraft || isInTransit }

    /// Сколько дней прошло с отправки.
    public var daysSinceSent: Int? {
        guard let sentAt else { return nil }
        let days = Calendar.current.dateComponents([.day], from: sentAt, to: Date()).day
        return days.map { max(0, $0) }
    }

    /// Просрочка. Срок берём из карточки поставщика; если он не задан, считаем
    /// нормой три дня — молчащий поставщик через неделю всё равно проблема.
    public var isOverdue: Bool {
        guard isInTransit, let days = daysSinceSent else { return false }
        return days > (leadTimeDays ?? 3)
    }

    private enum CodingKeys: String, CodingKey {
        case id, status, comment, supplier, items
        case isAuto = "is_auto"
        case cancelReason = "cancel_reason"
        case createdAt = "created_at"
        case sentAt = "sent_at"
        case receivedAt = "received_at"
        case cancelledAt = "cancelled_at"
        case itemCount = "item_count"
    }

    private struct SupplierRef: Decodable {
        let name: String?
        let organizationName: String?
        let phone: String?
        let repName: String?
        let repPhone: String?
        let leadTimeDays: Double?

        private enum CodingKeys: String, CodingKey {
            case name, phone
            case organizationName = "organization_name"
            case repName = "sales_rep_name"
            case repPhone = "sales_rep_phone"
            case leadTimeDays = "lead_time_days"
        }

        init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            name = try c.decodeFlexibleString(forKey: .name)
            organizationName = try c.decodeFlexibleString(forKey: .organizationName)
            phone = try c.decodeFlexibleString(forKey: .phone)
            repName = try c.decodeFlexibleString(forKey: .repName)
            repPhone = try c.decodeFlexibleString(forKey: .repPhone)
            leadTimeDays = try c.decodeFlexibleDouble(forKey: .leadTimeDays)
        }
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        status = try c.decodeFlexibleString(forKey: .status) ?? "draft"
        isAuto = try c.decodeIfPresent(Bool.self, forKey: .isAuto) ?? false
        comment = try c.decodeFlexibleString(forKey: .comment)
        cancelReason = try c.decodeFlexibleString(forKey: .cancelReason)
        createdAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .createdAt))
        sentAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .sentAt))
        receivedAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .receivedAt))
        cancelledAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .cancelledAt))

        let supplier = (try? c.decodeIfPresent(SupplierRef.self, forKey: .supplier)) ?? nil
        // Юрлицо приоритетнее «народного» имени: в заявке важно, кому платить.
        let organization = supplier?.organizationName?.trimmingCharacters(in: .whitespaces)
        let plain = supplier?.name?.trimmingCharacters(in: .whitespaces)
        supplierName = [organization, plain].compactMap { $0 }.first { !$0.isEmpty } ?? "Поставщик"
        supplierPhone = supplier?.phone
        repName = supplier?.repName
        repPhone = supplier?.repPhone
        leadTimeDays = supplier?.leadTimeDays.map { Int($0) }

        // В списке приходит `item_count`, в карточке — сам состав.
        let decodedLines = ((try? c.decodeIfPresent([PurchaseOrderLine].self, forKey: .items)) ?? nil) ?? []
        lines = decodedLines
        let count = try c.decodeFlexibleDouble(forKey: .itemCount)
        itemCount = count.map { Int($0) } ?? decodedLines.count
    }
}

/// Строка заявки: что и сколько заказано.
public struct PurchaseOrderLine: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let itemID: String
    public let name: String
    public let barcode: String?
    public let unit: String
    public let suggestedQty: Double
    /// Остаток на момент составления заявки.
    public let currentQty: Double
    public let threshold: Double?
    public let comment: String?

    private enum CodingKeys: String, CodingKey {
        case id, comment, item, threshold
        case itemID = "item_id"
        case suggestedQty = "suggested_qty"
        case currentQty = "current_qty"
    }

    private struct ItemRef: Decodable {
        let name: String?
        let barcode: String?
        let unit: String?

        init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            name = try c.decodeFlexibleString(forKey: .name)
            barcode = try c.decodeFlexibleString(forKey: .barcode)
            unit = try c.decodeFlexibleString(forKey: .unit)
        }

        private enum CodingKeys: String, CodingKey { case name, barcode, unit }
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        itemID = try c.decodeFlexibleString(forKey: .itemID) ?? ""
        let item = (try? c.decodeIfPresent(ItemRef.self, forKey: .item)) ?? nil
        name = item?.name ?? "Товар"
        barcode = item?.barcode
        unit = item?.unit ?? "шт"
        suggestedQty = try c.decodeFlexibleDouble(forKey: .suggestedQty) ?? 0
        currentQty = try c.decodeFlexibleDouble(forKey: .currentQty) ?? 0
        threshold = try c.decodeFlexibleDouble(forKey: .threshold)
        comment = try c.decodeFlexibleString(forKey: .comment)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: Расходники — /api/admin/inventory/consumables
// ─────────────────────────────────────────────────────────────────────────────

/// Расходник: пакеты, перчатки, чековая лента — то, что не продают.
public struct ConsumableItem: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let barcode: String?
    public let unit: String
    public let categoryName: String?

    private enum CodingKeys: String, CodingKey {
        case id, name, barcode, unit, category
    }

    private struct NamedRef: Decodable { let name: String? }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        name = try c.decodeFlexibleString(forKey: .name) ?? "Расходник"
        barcode = try c.decodeFlexibleString(forKey: .barcode)
        unit = try c.decodeFlexibleString(forKey: .unit) ?? "шт"
        categoryName = ((try? c.decodeIfPresent(NamedRef.self, forKey: .category)) ?? nil)?.name
    }
}

/// Норма расхода: сколько уходит в месяц в конкретной точке.
public struct ConsumptionNorm: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let itemID: String
    public let locationID: String
    public let monthlyQty: Double
    /// За сколько дней до нуля начинать тревожиться.
    public let alertDays: Int

    private enum CodingKeys: String, CodingKey {
        case id
        case itemID = "item_id"
        case locationID = "location_id"
        case monthlyQty = "monthly_qty"
        case alertDays = "alert_days"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        itemID = try c.decodeFlexibleString(forKey: .itemID) ?? ""
        locationID = try c.decodeFlexibleString(forKey: .locationID) ?? ""
        monthlyQty = try c.decodeFlexibleDouble(forKey: .monthlyQty) ?? 0
        alertDays = Int(try c.decodeFlexibleDouble(forKey: .alertDays) ?? 14)
    }
}

/// Месячный лимит выдачи расходника на точку.
public struct ConsumableLimit: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let itemID: String
    public let companyID: String
    public let monthlyLimitQty: Double

    private enum CodingKeys: String, CodingKey {
        case id
        case itemID = "item_id"
        case companyID = "company_id"
        case monthlyLimitQty = "monthly_limit_qty"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        itemID = try c.decodeFlexibleString(forKey: .itemID) ?? ""
        companyID = try c.decodeFlexibleString(forKey: .companyID) ?? ""
        monthlyLimitQty = try c.decodeFlexibleDouble(forKey: .monthlyLimitQty) ?? 0
    }
}

/// Остаток расходника в точке хранения.
public struct ConsumableBalance: Decodable, Sendable, Identifiable, Hashable {
    public let itemID: String
    public let locationID: String
    public let itemName: String?
    public let locationName: String?
    public let locationType: String?
    public let companyID: String?
    public let quantity: Double

    public var id: String { "\(locationID)/\(itemID)" }

    private enum CodingKeys: String, CodingKey {
        case quantity, item, location
        case itemID = "item_id"
        case locationID = "location_id"
    }

    private struct ItemRef: Decodable {
        let name: String?
        init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            name = try c.decodeFlexibleString(forKey: .name)
        }
        private enum CodingKeys: String, CodingKey { case name }
    }

    private struct LocationRef: Decodable {
        let name: String?
        let locationType: String?
        let companyID: String?

        init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            name = try c.decodeFlexibleString(forKey: .name)
            locationType = try c.decodeFlexibleString(forKey: .locationType)
            companyID = try c.decodeFlexibleString(forKey: .companyID)
        }

        private enum CodingKeys: String, CodingKey {
            case name
            case locationType = "location_type"
            case companyID = "company_id"
        }
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        itemID = try c.decodeFlexibleString(forKey: .itemID) ?? ""
        locationID = try c.decodeFlexibleString(forKey: .locationID) ?? ""
        quantity = try c.decodeFlexibleDouble(forKey: .quantity) ?? 0
        itemName = ((try? c.decodeIfPresent(ItemRef.self, forKey: .item)) ?? nil)?.name
        let location = (try? c.decodeIfPresent(LocationRef.self, forKey: .location)) ?? nil
        locationName = location?.name
        locationType = location?.locationType
        companyID = location?.companyID
    }
}

/// Место хранения расходников.
public struct ConsumableLocation: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let locationType: String
    public let companyID: String?
    public let companyName: String?

    public var isPoint: Bool { locationType == "point_display" }

    private enum CodingKeys: String, CodingKey {
        case id, name, company
        case locationType = "location_type"
        case companyID = "company_id"
    }

    private struct NamedRef: Decodable { let name: String? }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        name = try c.decodeFlexibleString(forKey: .name) ?? "Склад"
        locationType = try c.decodeFlexibleString(forKey: .locationType) ?? "warehouse"
        companyID = try c.decodeFlexibleString(forKey: .companyID)
        companyName = ((try? c.decodeIfPresent(NamedRef.self, forKey: .company)) ?? nil)?.name
    }
}

/// Запись журнала выдач расходников на точку.
public struct ConsumableIssue: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let status: String
    public let rawComment: String?
    public let createdAt: Date?
    public let issuedAt: Date?
    public let receivedAt: Date?
    public let companyName: String?
    public let locationName: String?
    public let items: [ConsumableIssueLine]

    /// Сервер помечает выдачи маркером в комментарии — в интерфейсе он лишний.
    public var comment: String? {
        guard let rawComment else { return nil }
        let cleaned = rawComment
            .replacingOccurrences(of: "[consumable-issue]", with: "")
            .trimmingCharacters(in: .whitespaces)
        return cleaned.isEmpty ? nil : cleaned
    }

    /// Дата выдачи вписана человеком в тот же комментарий, отдельного поля нет.
    public var issueDate: Date? {
        guard let comment else { return issuedAt ?? createdAt }
        let first = comment.split(separator: " ").first.map(String.init) ?? ""
        return DateParsing.parseDateOnly(first) ?? issuedAt ?? createdAt
    }

    /// Расхождение при приёмке — точка получила меньше, чем выдали.
    public var isDisputed: Bool { status == "disputed" }

    public var statusLabel: String {
        switch status {
        case "issued": "Выдано"
        case "received": "Получено"
        case "disputed": "Расхождение"
        case "approved_full", "approved_partial": "Одобрено"
        default: status
        }
    }

    public var totalQty: Double {
        items.reduce(0) { $0 + ($1.approvedQty > 0 ? $1.approvedQty : $1.requestedQty) }
    }

    private enum CodingKeys: String, CodingKey {
        case id, status, comment, items, company
        case createdAt = "created_at"
        case issuedAt = "issued_at"
        case receivedAt = "received_at"
        case targetLocation = "target_location"
    }

    private struct NamedRef: Decodable { let name: String? }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        status = try c.decodeFlexibleString(forKey: .status) ?? ""
        rawComment = try c.decodeFlexibleString(forKey: .comment)
        createdAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .createdAt))
        issuedAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .issuedAt))
        receivedAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .receivedAt))
        companyName = ((try? c.decodeIfPresent(NamedRef.self, forKey: .company)) ?? nil)?.name
        locationName = ((try? c.decodeIfPresent(NamedRef.self, forKey: .targetLocation)) ?? nil)?.name
        items = try c.decodeIfPresent([ConsumableIssueLine].self, forKey: .items) ?? []
    }
}

/// Строка выдачи.
public struct ConsumableIssueLine: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let unit: String
    public let requestedQty: Double
    public let approvedQty: Double

    private enum CodingKeys: String, CodingKey {
        case id, item
        case requestedQty = "requested_qty"
        case approvedQty = "approved_qty"
    }

    private struct ItemRef: Decodable {
        let name: String?
        let unit: String?

        init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            name = try c.decodeFlexibleString(forKey: .name)
            unit = try c.decodeFlexibleString(forKey: .unit)
        }

        private enum CodingKeys: String, CodingKey { case name, unit }
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        let item = (try? c.decodeIfPresent(ItemRef.self, forKey: .item)) ?? nil
        name = item?.name ?? "Расходник"
        unit = item?.unit ?? "шт"
        requestedQty = try c.decodeFlexibleDouble(forKey: .requestedQty) ?? 0
        approvedQty = try c.decodeFlexibleDouble(forKey: .approvedQty) ?? 0
    }
}

/// Ответ `GET /api/admin/inventory/consumables` (в конверте `data`).
public struct ConsumablesDashboard: Decodable, Sendable {
    public let items: [ConsumableItem]
    public let norms: [ConsumptionNorm]
    public let limits: [ConsumableLimit]
    public let balances: [ConsumableBalance]
    public let locations: [ConsumableLocation]
    public let companies: [Company]
    public let issues: [ConsumableIssue]

    private enum CodingKeys: String, CodingKey {
        case items, norms, limits, balances, locations, companies, issues
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        items = try c.decodeIfPresent([ConsumableItem].self, forKey: .items) ?? []
        norms = try c.decodeIfPresent([ConsumptionNorm].self, forKey: .norms) ?? []
        limits = try c.decodeIfPresent([ConsumableLimit].self, forKey: .limits) ?? []
        balances = try c.decodeIfPresent([ConsumableBalance].self, forKey: .balances) ?? []
        locations = try c.decodeIfPresent([ConsumableLocation].self, forKey: .locations) ?? []
        companies = try c.decodeIfPresent([Company].self, forKey: .companies) ?? []
        issues = try c.decodeIfPresent([ConsumableIssue].self, forKey: .issues) ?? []
    }

    /// Остатки, склеенные с нормой расхода и лимитом точки.
    ///
    /// Сервер отдаёт `balances` по всему складу, не только по расходникам, —
    /// фильтруем по каталогу расходников, иначе в списке окажется товар.
    public func stock() -> [ConsumableStock] {
        let itemByID = Dictionary(items.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let locationByID = Dictionary(locations.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        var normByKey: [String: ConsumptionNorm] = [:]
        for norm in norms { normByKey["\(norm.locationID)/\(norm.itemID)"] = norm }
        var limitByKey: [String: ConsumableLimit] = [:]
        for limit in limits { limitByKey["\(limit.companyID)/\(limit.itemID)"] = limit }

        return balances.compactMap { balance -> ConsumableStock? in
            guard let item = itemByID[balance.itemID] else { return nil }
            let location = locationByID[balance.locationID]
            let companyID = location?.companyID ?? balance.companyID
            let norm = normByKey["\(balance.locationID)/\(balance.itemID)"]
            let limit = companyID.flatMap { limitByKey["\($0)/\(balance.itemID)"] }
            return ConsumableStock(
                id: balance.id,
                itemName: item.name,
                unit: item.unit,
                categoryName: item.categoryName,
                locationName: location?.name ?? balance.locationName ?? "Склад",
                companyName: location?.companyName,
                quantity: balance.quantity,
                monthlyNorm: norm?.monthlyQty,
                alertDays: norm?.alertDays ?? 14,
                monthlyLimit: limit?.monthlyLimitQty
            )
        }
        .sorted { left, right in
            // Сначала то, что кончается: если запас считается, наверх идёт
            // меньший. Позиции без нормы уходят в конец — по ним тревоги нет.
            switch (left.daysLeft, right.daysLeft) {
            case let (l?, r?) where l != r: return l < r
            case (nil, .some): return false
            case (.some, nil): return true
            default: return left.itemName.localizedCaseInsensitiveCompare(right.itemName) == .orderedAscending
            }
        }
    }
}

/// Остаток расходника с прогнозом «на сколько хватит».
public struct ConsumableStock: Sendable, Identifiable, Hashable {
    public let id: String
    public let itemName: String
    public let unit: String
    public let categoryName: String?
    public let locationName: String
    public let companyName: String?
    public let quantity: Double
    /// Месячная норма расхода. Без неё прогноз построить не на чем.
    public let monthlyNorm: Double?
    public let alertDays: Int
    public let monthlyLimit: Double?

    public init(
        id: String,
        itemName: String,
        unit: String,
        categoryName: String?,
        locationName: String,
        companyName: String?,
        quantity: Double,
        monthlyNorm: Double?,
        alertDays: Int,
        monthlyLimit: Double?
    ) {
        self.id = id
        self.itemName = itemName
        self.unit = unit
        self.categoryName = categoryName
        self.locationName = locationName
        self.companyName = companyName
        self.quantity = quantity
        self.monthlyNorm = monthlyNorm
        self.alertDays = alertDays
        self.monthlyLimit = monthlyLimit
    }

    /// На сколько дней хватит остатка при текущей норме. Месяц = 30 дней —
    /// так же считает портал, расхождение в прогнозе сбивало бы с толку.
    public var daysLeft: Int? {
        guard let monthlyNorm, monthlyNorm > 0 else { return nil }
        return Int((quantity / (monthlyNorm / 30)).rounded(.down))
    }

    public enum Urgency: Sendable {
        /// Норма не задана — прогноза нет.
        case unknown
        case ok
        case soon
        case critical
    }

    public var urgency: Urgency {
        guard let daysLeft else { return .unknown }
        if daysLeft > alertDays * 2 { return .ok }
        if daysLeft > alertDays { return .soon }
        return .critical
    }

    public var isRunningOut: Bool { urgency == .soon || urgency == .critical }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: Сервисы
// ─────────────────────────────────────────────────────────────────────────────

/// Техкарты и их себестоимость.
public struct ProductionService: Sendable {
    private let api: APIClient

    public init(api: APIClient) { self.api = api }

    /// Каталог техкарт. `companyID` сужает выборку до одной точки-магазина.
    public func catalog(companyID: String? = nil) async throws -> ProductionCatalog {
        var query: [String: String] = [:]
        if let companyID, !companyID.isEmpty { query["company_id"] = companyID }
        return try await api.send(APIRequest(path: "/api/admin/production/recipes", query: query))
    }

    /// Фактический food cost за период. Даты в формате `YYYY-MM-DD`.
    public func analysis(from: String, to: String) async throws -> ProductionAnalysis {
        try await api.send(
            APIRequest(path: "/api/admin/production/analysis", query: ["from": from, "to": to])
        )
    }
}

/// План закупа на следующую неделю.
public struct PurchasePlanService: Sendable {
    private let api: APIClient

    public init(api: APIClient) { self.api = api }

    /// Точки, по которым можно построить план. План считается для одной точки:
    /// спрос и остатки у каждой свои.
    public func companies() async throws -> [Company] {
        let response: DataList<Company> = try await api.send(APIRequest(path: "/api/admin/companies"))
        return response.items
    }

    public func plan(companyID: String) async throws -> PurchasePlan {
        let response: Envelope<PurchasePlan> = try await api.send(
            APIRequest(path: "/api/admin/store/purchase-plan/suggest", query: ["company_id": companyID])
        )
        return response.data
    }
}

/// Заявки поставщикам.
public struct PurchaseOrdersService: Sendable {
    private let api: APIClient

    public init(api: APIClient) { self.api = api }

    public func orders(status: String? = nil) async throws -> [PurchaseOrder] {
        var query: [String: String] = [:]
        if let status, !status.isEmpty { query["status"] = status }
        let response: Envelope<PurchaseOrderListPayload> = try await api.send(
            APIRequest(path: "/api/admin/store/purchase-orders", query: query)
        )
        return response.data.orders
    }

    /// Отправить заявку поставщику.
    ///
    /// Позиции берём из плана закупа: он уже посчитал спрос за месяц, целевой
    /// запас и округление до упаковок. Заявка, набранная на глаз с телефона,
    /// разошлась бы с этим расчётом — и завтра на витрине снова не хватило бы
    /// того же товара.
    public func createOrder(
        supplierID: String,
        comment: String?,
        lines: [(itemID: String, quantity: Double, stock: Double)]
    ) async throws {
        let items = lines.map { line in
            [
                "item_id": line.itemID,
                "suggested_qty": line.quantity,
                "current_qty": line.stock,
            ] as [String: Any]
        }

        var body: [String: Any] = ["supplier_id": supplierID, "items": items]
        if let comment, !comment.isEmpty { body["comment"] = comment }

        _ = try await api.send(
            APIRequest(
                path: "/api/admin/store/purchase-orders",
                method: .post,
                body: try JSONSerialization.data(withJSONObject: body)
            )
        )
    }

    /// Перевести заявку в другое состояние.
    ///
    /// Три перехода: отправить поставщику, отметить полученной, отменить. Это
    /// не «правка статуса», а разные события: отправленную ждут, полученная
    /// закрывает потребность, отменённую поставщик не повезёт. Причина нужна
    /// только отмене — по ней потом и разбираются, почему товара нет.
    public func changeStatus(id: String, status: String, cancelReason: String? = nil) async throws {
        var body: [String: Any] = ["status": status]
        if let cancelReason, !cancelReason.isEmpty { body["cancel_reason"] = cancelReason }

        _ = try await api.send(
            APIRequest(
                path: "/api/admin/store/purchase-orders/\(id)",
                method: .patch,
                body: try JSONSerialization.data(withJSONObject: body)
            )
        )
    }

    /// Карточка заявки: состав и контакты поставщика. В списке их нет.
    public func order(id: String) async throws -> PurchaseOrder {
        let response: Envelope<PurchaseOrderPayload> = try await api.send(
            APIRequest(path: "/api/admin/store/purchase-orders/\(id)")
        )
        return response.data.order
    }
}

struct PurchaseOrderListPayload: Decodable, Sendable {
    let orders: [PurchaseOrder]

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        orders = try c.decodeIfPresent([PurchaseOrder].self, forKey: .orders) ?? []
    }

    private enum CodingKeys: String, CodingKey { case orders }
}

struct PurchaseOrderPayload: Decodable, Sendable {
    let order: PurchaseOrder

    private enum CodingKeys: String, CodingKey { case order }
}

/// Расходники: нормы, остатки, журнал выдач.
public struct ConsumablesService: Sendable {
    private let api: APIClient

    public init(api: APIClient) { self.api = api }

    public func dashboard() async throws -> ConsumablesDashboard {
        let response: Envelope<ConsumablesDashboard> = try await api.send(
            APIRequest(path: "/api/admin/inventory/consumables")
        )
        return response.data
    }
}
