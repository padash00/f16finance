import Foundation

/// Разделы портала, для которых в приложении есть нативный экран.
///
/// Живёт в OrdaKit, а не рядом с экранами, ради одного: список идентификаторов
/// становится данными, которые можно проверить тестом. Идентификатор, которого
/// нет в каталоге прав, не вызывает ошибки — раздел просто молча открывается
/// веб-версией, и заметить это можно только руками. Тест ловит опечатку сразу.
public enum NativeSection: String, CaseIterable, Sendable {
    case store
    case stock
    case showcase
    case catalog
    case requests
    case requestsJournal
    case movements
    case operators
    case salary
    case reports
    case analytics
    case tasks
    case shifts
    case customers
    case incidents
    case pointDebts
    case profitability
    case pointDevices
    case revisions
    case suppliers
    case staff
    case receipts
    case postings
    case writeoffs
    case shiftReports
    case birthdays
    case categories
    case storeAnalytics
    case storeForecast
    case knowledge
    case settings
    case logs
    case telegram
    case diagnostics
    case production
    case purchasePlan
    case purchaseOrders
    case consumables
    case performance
    case ratings
    case achievements
    case posReceipts
    case posReturns
    case receiptSettings
    case advertising
    case salaryRules
    case hr
    case structure
    case access
    case credentials
    case news
    case teamChat
    case messages
    case moderation
    case tax
    case cashflow
    case goals
    case weeklyReport
    case valuation
    case analysis
    case forecast
    case businessIntelligence
    case aiCfo
    case expenseAnalysis
    case teamAnalysis
    case calendar
    case income
    case expenses
    case approvals
    case expenseWhitelist
    case simulation
    case supplierBilling
    case discounts
    case stations
    case storeSettings
    case storeShifts

    /// Идентификаторы страниц каталога, которые ведут на этот экран.
    public var pageIDs: [String] {
        switch self {
        case .store: ["store"]
        // Склад, витрина и каталог — три разных вопроса, а не один разрез:
        // сколько лежит на складе, что стоит перед покупателем, что вообще
        // заведено в номенклатуре с ценой и штрихкодом. Раньше все три пункта
        // вели на один экран остатков.
        // `inventory` сюда не входит — это группа каталога, а не страница.
        case .stock: ["store-warehouse"]
        case .showcase: ["store-showcase"]
        case .catalog: ["store-catalog"]
        // Заявки — рабочий список того, что ждёт решения; журнал — история,
        // куда заходят разбираться. Раньше журнал был тумблером на том же
        // экране, то есть его как бы и не было.
        case .requests: ["store-requests"]
        case .requestsJournal: ["store-requests-journal"]
        case .movements: ["store-movements"]
        case .operators: ["operators"]
        case .salary: ["salary"]
        case .reports: ["reports"]
        case .analytics: ["analytics"]
        case .tasks: ["tasks"]
        case .shifts: ["shifts"]
        case .customers: ["customers"]
        case .incidents: ["incidents"]
        case .pointDebts: ["point-debts"]
        case .profitability: ["profitability"]
        case .pointDevices: ["point-devices"]
        case .revisions: ["store-revisions"]
        case .suppliers: ["store-suppliers"]
        case .staff: ["staff"]
        // Приёмка и оприходование живут в одном журнале на сервере, но это
        // разные документы: у поставки есть накладная и деньги поставщику, у
        // оприходования нет ни того, ни другого. Разделяет их поле `kind`.
        case .receipts: ["store-receipts"]
        case .postings: ["store-postings"]
        case .writeoffs: ["store-writeoffs"]
        case .shiftReports: ["shifts-reports"]
        case .birthdays: ["birthdays"]
        case .categories: ["categories"]
        // Аналитика отвечает «что продаётся лучше всего», прогноз — «что
        // кончится раньше всего». Один экран на оба вопроса отвечал только на
        // первый.
        case .storeAnalytics: ["store-analytics"]
        case .storeForecast: ["store-forecast"]
        case .knowledge: ["knowledge-admin"]
        case .settings: ["settings"]
        case .logs: ["logs"]
        case .telegram: ["telegram"]
        case .diagnostics: ["debug"]
        case .production: ["production"]
        case .purchasePlan: ["store-purchase-plan"]
        case .purchaseOrders: ["store-purchase-orders"]
        case .consumables: ["store-consumables"]
        case .performance: ["performance"]
        case .ratings: ["ratings"]
        case .achievements: ["operator-achievements"]
        case .posReceipts: ["pos-receipts"]
        case .posReturns: ["pos-returns"]
        case .receiptSettings: ["store-receipt-settings"]
        case .advertising: ["store-advertising"]
        case .salaryRules: ["salary-rules"]
        case .hr: ["hr"]
        case .structure: ["structure"]
        case .access: ["access"]
        case .credentials: ["pass"]
        case .news: ["news"]
        case .teamChat: ["team-chat"]
        case .messages: ["messages"]
        case .moderation: ["moderation"]
        case .tax: ["tax"]
        case .cashflow: ["cashflow"]
        case .goals: ["goals"]
        case .weeklyReport: ["weekly-report"]
        case .valuation: ["valuation"]
        case .analysis: ["analysis"]
        case .forecast: ["forecast"]
        case .aiCfo: ["ai-cfo"]
        case .expenseAnalysis: ["expense-analysis"]
        case .teamAnalysis: ["team-analysis"]
        // Доходы и расходы — разные разделы, как на сайте. Раньше оба пункта
        // меню вели на один экран «Деньги»: нажимаешь «Доходы» — приходишь не
        // туда, где привык, и это читается как «не открывается».
        case .income: ["income"]
        case .expenses: ["expenses"]
        case .approvals: ["expenses-pending"]
        case .expenseWhitelist: ["expense-whitelist"]
        case .simulation: ["simulation"]
        case .supplierBilling: ["store-billing"]
        case .discounts: ["discounts"]
        // Модуль addon.arena проверяет canSee по пути /stations —
        // без него раздел не появится, отдельного условия не нужно.
        case .stations: ["stations"]
        case .storeSettings: ["store-settings"]
        case .storeShifts: ["store-shifts"]
        // Ниже — разделы, которых нет в каталоге прав. Они не
        // capability-gated и на сайте: показываются всем, кто вошёл.
        case .businessIntelligence, .calendar: []
        }
    }

    /// Разделы вне каталога прав.
    ///
    /// «Бизнес-аналитика» и «Календарь» есть в меню сайта, но страницы в
    /// каталоге у них нет: сервер их правами не закрывает. Через
    /// `nativeGroups()` они не появились бы никогда, поэтому показываются
    /// отдельно — по модулю организации, если он для раздела задан.
    public static var uncatalogued: [NativeSection] {
        allCases.filter { $0.pageIDs.isEmpty }
    }

    /// Подпись и значок для разделов вне каталога — в каталоге их взять неоткуда.
    public var uncataloguedLabel: (title: String, icon: String)? {
        switch self {
        case .businessIntelligence: ("Бизнес-аналитика", "brain")
        case .calendar: ("Календарь", "calendar")
        default: nil
        }
    }

    /// Модуль организации, без которого раздел не показываем.
    public var requiredAddon: String? {
        switch self {
        case .businessIntelligence: "addon.ai"
        default: nil
        }
    }

    /// Разделы, доступные только суперадмину — независимо от прав.
    ///
    /// Право `logs.view` в каталоге есть, но роут `/api/admin/logs` проверяет
    /// `isSuperAdmin` ДО него. Владелец с этим правом получит 403. Показывать
    /// пункт, который гарантированно не откроется, — то же самое, что вести
    /// в браузер: доступ обещан, а его нет.
    ///
    /// Это расхождение сервера и каталога, а не приложения: на сайте владелец
    /// с `logs.view` тоже видит пункт и упирается в отказ.
    public var requiresSuperAdmin: Bool {
        self == .logs
    }

    /// Экран для страницы каталога, если он нативный.
    public static func forPage(id: String) -> NativeSection? {
        lookup[id]
    }

    /// Обратный индекс строится один раз: разделы разрешаются на каждый
    /// переход, а перебор всех случаев на каждом — лишняя работа.
    private static let lookup: [String: NativeSection] = {
        var result: [String: NativeSection] = [:]
        for section in NativeSection.allCases {
            for id in section.pageIDs {
                result[id] = section
            }
        }
        return result
    }()
}
