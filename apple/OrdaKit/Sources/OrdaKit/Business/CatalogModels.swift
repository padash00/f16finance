import Foundation

// ── Категории расходов: /api/admin/expense-categories ────────────────────────

/// Статья расходов с месячным бюджетом и фактом.
public struct ExpenseCategory: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let accountingGroup: String?
    public let monthlyBudget: Double
    public let spentThisMonth: Double

    /// `cogs` — себестоимость. Такие статьи сервер запрещает заводить руками
    /// всем, кроме владельца: их место в приёмке, где есть накладная.
    public var isCogs: Bool {
        accountingGroup?.trimmingCharacters(in: .whitespaces).lowercased() == "cogs"
    }

    /// Задан ли бюджет. Ноль означает «не задан», а не «нельзя тратить»:
    /// иначе любая статья без бюджета выглядела бы перерасходом.
    public var hasBudget: Bool { monthlyBudget > 0 }

    /// Доля израсходованного бюджета. `nil`, когда бюджета нет — считать
    /// «процент от нуля» бессмысленно.
    public var usage: Double? {
        guard hasBudget else { return nil }
        return spentThisMonth / monthlyBudget
    }

    public var isOverBudget: Bool {
        guard hasBudget else { return false }
        return spentThisMonth > monthlyBudget
    }

    /// Приближается к лимиту — от 80 % и до перерасхода.
    public var isNearLimit: Bool {
        guard let usage else { return false }
        return usage >= 0.8 && usage <= 1
    }

    public var remaining: Double {
        max(monthlyBudget - spentThisMonth, 0)
    }

    /// Человеческое имя финансовой группы — той самой, что определяет,
    /// куда статья попадёт в ОПиУ.
    public var groupLabel: String {
        switch accountingGroup {
        case "cogs": "Себестоимость"
        case "operating": "Операционные"
        case "payroll", "payroll_advance": "ФОТ"
        case "payroll_tax": "Налоги с ФОТ"
        case "income_tax": "Налог на прибыль"
        case "pos_commission": "Комиссии эквайринга"
        case "financial_expenses": "Финансовые"
        case "non_operating": "Неоперационные"
        case "depreciation": "Износ"
        case "capex": "Вложения"
        case "profit_distribution": "Распределение прибыли"
        default: "Операционные"
        }
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        name = try c.decodeFlexibleString(forKey: .name) ?? "Без названия"
        accountingGroup = try c.decodeFlexibleString(forKey: .accountingGroup)
        monthlyBudget = try c.decodeFlexibleDouble(forKey: .monthlyBudget) ?? 0
        spentThisMonth = try c.decodeFlexibleDouble(forKey: .spentThisMonth) ?? 0
    }

    private enum CodingKeys: String, CodingKey {
        case id, name
        case accountingGroup = "accounting_group"
        case monthlyBudget = "monthly_budget"
        case spentThisMonth = "spent_this_month"
    }
}

// ── Аналитика магазина: /api/admin/store/analytics ───────────────────────────

/// Продажи и движение товара за окно.
public struct StoreAnalytics: Decodable, Sendable {
    public let locations: [StoreLocation]
    public let balances: [StockBalance]
    public let movements: [StockMovement]

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        locations = (try? c.decodeIfPresent([StoreLocation].self, forKey: .locations)) ?? []
        balances = (try? c.decodeIfPresent([StockBalance].self, forKey: .balances)) ?? []
        movements = (try? c.decodeIfPresent([StockMovement].self, forKey: .movements)) ?? []
    }

    private enum CodingKeys: String, CodingKey { case locations, balances, movements }

    /// Топ проданного за окно — по количеству и выручке.
    public var topSold: [SoldItem] {
        var totals: [String: SoldItem] = [:]
        for movement in movements where movement.kind == "sale" {
            let key = movement.itemName
            if var existing = totals[key] {
                existing.quantity += abs(movement.quantity)
                existing.amount += abs(movement.amount)
                totals[key] = existing
            } else {
                totals[key] = SoldItem(
                    id: key,
                    name: movement.itemName,
                    quantity: abs(movement.quantity),
                    amount: abs(movement.amount)
                )
            }
        }
        return totals.values.sorted { $0.amount > $1.amount }
    }

    public struct SoldItem: Sendable, Identifiable, Hashable {
        public let id: String
        public let name: String
        public var quantity: Double
        public var amount: Double
    }

    /// Товары с остатком, но без единой продажи за окно — деньги, лежащие
    /// мёртвым грузом. Это и есть главный вопрос к аналитике склада.
    public var stale: [StoreOverview.ItemTotal] {
        let sold = Set(movements.filter { $0.kind == "sale" }.map(\.itemName))

        var totals: [String: StoreOverview.ItemTotal] = [:]
        for balance in balances where !sold.contains(balance.name) && balance.quantity > 0 {
            if var existing = totals[balance.itemID] {
                existing.quantity += balance.quantity
                existing.locationCount += 1
                totals[balance.itemID] = existing
            } else {
                totals[balance.itemID] = StoreOverview.ItemTotal(
                    id: balance.itemID,
                    name: balance.name,
                    unit: balance.unit,
                    quantity: balance.quantity,
                    threshold: balance.lowStockThreshold,
                    locationCount: 1
                )
            }
        }
        return totals.values.sorted { $0.quantity > $1.quantity }
    }

    /// Выручка по дням для графика.
    public var salesByDay: [(date: Date, amount: Double)] {
        var sums: [Date: Double] = [:]
        let calendar = Calendar.current
        for movement in movements where movement.kind == "sale" {
            guard let created = movement.createdAt else { continue }
            let day = calendar.startOfDay(for: created)
            sums[day, default: 0] += abs(movement.amount)
        }
        return sums.keys.sorted().map { ($0, sums[$0] ?? 0) }
    }

    public var totalSales: Double {
        movements.filter { $0.kind == "sale" }.reduce(0) { $0 + abs($1.amount) }
    }

    public var salesCount: Int {
        movements.filter { $0.kind == "sale" }.count
    }
}

// ── База знаний: /api/admin/knowledge ────────────────────────────────────────

/// Статья базы знаний в админском виде.
///
/// Не `KnowledgeArticle` — так называется статья в кабинете оператора: там
/// у неё есть текст и отметка о прочтении, здесь — черновик, аудитория и
/// связанные штраф с бонусом. Разные наборы полей под одним именем путали бы.
public struct AdminArticle: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let title: String
    public let summary: String?
    public let tags: [String]
    public let audience: String?
    public let severity: String?
    public let categoryID: String?
    public let isPublished: Bool
    public let requiresConfirmation: Bool
    public let version: Int
    public let updatedAt: Date?
    public let fineAmount: Double
    public let bonusAmount: Double

    public var audienceLabel: String {
        switch audience {
        case "operator": "Операторам"
        case "staff": "Сотрудникам"
        case "all": "Всем"
        default: audience ?? "Всем"
        }
    }

    /// Статья с последствием — за нарушение штраф либо за соблюдение бонус.
    public var hasConsequence: Bool { fineAmount > 0 || bonusAmount > 0 }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        title = try c.decodeFlexibleString(forKey: .title) ?? "Без названия"
        summary = try c.decodeFlexibleString(forKey: .summary)
        tags = (try? c.decodeIfPresent([String].self, forKey: .tags)) ?? []
        audience = try c.decodeFlexibleString(forKey: .audience)
        severity = try c.decodeFlexibleString(forKey: .severity)
        categoryID = try c.decodeFlexibleString(forKey: .categoryID)
        isPublished = try c.decodeIfPresent(Bool.self, forKey: .isPublished) ?? false
        requiresConfirmation = try c.decodeIfPresent(Bool.self, forKey: .requiresConfirmation) ?? false
        version = Int(try c.decodeFlexibleDouble(forKey: .version) ?? 1)
        updatedAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .updatedAt))
        fineAmount = try c.decodeFlexibleDouble(forKey: .fineAmount) ?? 0
        bonusAmount = try c.decodeFlexibleDouble(forKey: .bonusAmount) ?? 0
    }

    private enum CodingKeys: String, CodingKey {
        case id, title, summary, tags, audience, severity, version
        case categoryID = "category_id"
        case isPublished = "is_published"
        case requiresConfirmation = "requires_confirmation"
        case updatedAt = "updated_at"
        case fineAmount = "related_fine_amount"
        case bonusAmount = "related_bonus_amount"
    }
}

/// Раздел базы знаний.
public struct AdminArticleCategory: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let sortOrder: Int

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        name = try c.decodeFlexibleString(forKey: .name)
            ?? c.decodeFlexibleString(forKey: .title) ?? "Раздел"
        sortOrder = Int(try c.decodeFlexibleDouble(forKey: .sortOrder) ?? 0)
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, title
        case sortOrder = "sort_order"
    }
}

/// Ответ `GET /api/admin/knowledge`.
public struct KnowledgeBase: Decodable, Sendable {
    public let categories: [AdminArticleCategory]
    public let articles: [AdminArticle]

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        categories = (try? c.decodeIfPresent([AdminArticleCategory].self, forKey: .categories)) ?? []
        articles = (try? c.decodeIfPresent([AdminArticle].self, forKey: .articles)) ?? []
    }

    private enum CodingKeys: String, CodingKey { case categories, articles }

    /// Черновики — написаны, но команда их не видит.
    public var drafts: [AdminArticle] {
        articles.filter { !$0.isPublished }
    }

    public func articles(in categoryID: String?) -> [AdminArticle] {
        articles.filter { $0.categoryID == categoryID }
    }

    /// Статьи без раздела — иначе они потерялись бы при группировке.
    public var uncategorized: [AdminArticle] {
        let known = Set(categories.map(\.id))
        return articles.filter { $0.categoryID == nil || !known.contains($0.categoryID!) }
    }
}

// ── Чек-листы открытых смен ──────────────────────────────────────────────────
//
// Владельцу звонят ночью: «не могу закрыть смену». Причина всегда одна —
// блокирующий чек-лист не пройден, — но какой именно, из телефона было не
// узнать. Оставалось верить на слово и либо гнать проходить, либо выключать
// чек-лист совсем, то есть навсегда и для всех.

/// Состояние обязательных чек-листов в открытой смене точки.
public struct ShiftChecklistStatus: Decodable, Sendable, Identifiable, Hashable {
    public let companyID: String
    public let companyName: String
    public let shiftID: String
    public let openedAt: Date?
    public let checklists: [Item]

    public var id: String { shiftID }

    /// Что мешает закрыть смену прямо сейчас.
    public var blocking: [Item] { checklists.filter { $0.status == "missing" } }

    public struct Item: Decodable, Sendable, Identifiable, Hashable {
        public let templateID: String
        public let title: String
        /// `completed` — пройден, `skipped` — прощён руководителем,
        /// `in_progress` — начат, `missing` — не начат.
        public let status: String
        public let skipReason: String?

        public var id: String { templateID }
        public var isDone: Bool { status == "completed" }
        public var isSkipped: Bool { status == "skipped" }
        public var isMissing: Bool { status == "missing" }

        public var statusLabel: String {
            switch status {
            case "completed": "пройден"
            case "skipped": "прощён"
            case "in_progress": "проходят"
            default: "не пройден"
            }
        }

        public init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            templateID = try c.decodeFlexibleString(forKey: .templateID) ?? UUID().uuidString
            title = try c.decodeFlexibleString(forKey: .title) ?? "Чек-лист"
            status = try c.decodeFlexibleString(forKey: .status) ?? "missing"
            skipReason = try c.decodeFlexibleString(forKey: .skipReason)
        }

        private enum CodingKeys: String, CodingKey {
            case title, status
            case templateID = "template_id"
            case skipReason = "skip_reason"
        }
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        companyID = try c.decodeFlexibleString(forKey: .companyID) ?? ""
        companyName = try c.decodeFlexibleString(forKey: .companyName) ?? "Точка"
        shiftID = try c.decodeFlexibleString(forKey: .shiftID) ?? UUID().uuidString
        openedAt = DateParsing.parse(try c.decodeFlexibleString(forKey: .openedAt) ?? "")
        checklists = try c.decodeIfPresent([Item].self, forKey: .checklists) ?? []
    }

    private enum CodingKeys: String, CodingKey {
        case checklists
        case companyID = "company_id"
        case companyName = "company_name"
        case shiftID = "shift_id"
        case openedAt = "opened_at"
    }
}

/// Ответ `GET /api/admin/knowledge?view=shift-status`.
public struct ShiftChecklistBoard: Decodable, Sendable {
    public let shifts: [ShiftChecklistStatus]

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        shifts = try c.decodeIfPresent([ShiftChecklistStatus].self, forKey: .shifts) ?? []
    }

    private enum CodingKeys: String, CodingKey { case shifts }
}
