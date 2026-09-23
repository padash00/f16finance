import Foundation

/// Чем живёт должность: что у неё на главной, какие быстрые кнопки, какие
/// вкладки и сервисы — в каком порядке.
///
/// Это только порядок и подача. Права не расширяет: всё, что здесь названо,
/// показывается лишь если раздел выдан на `/access` (фильтрует
/// `AccessResolver.playbookPages`). Бухгалтер без права на зарплату не увидит
/// кнопку «Зарплата», даже если она у бухгалтера в списке первой.
public struct StaffRolePlaybook: Sendable, Equatable {
    /// Быстрое действие на главной.
    public enum Action: Sendable, Equatable, Hashable {
        /// Добавить расход — лист, а не раздел.
        case addExpense
        /// Добавить доход.
        case addIncome
        /// Поставить задачу.
        case addTask
        /// Открыть раздел каталога.
        case page(String)
    }

    /// Должность так, как её называют на сайте.
    public let title: String
    /// Одна фраза о смысле работы — подпись на главной карточке.
    public let focus: String
    public let actions: [Action]
    /// Разделы, которые выносятся во вкладки, по важности.
    public let tabPageIDs: [String]
    /// Сервисы на главной, по важности.
    public let favoritePageIDs: [String]

    public init(title: String, focus: String, actions: [Action], tabPageIDs: [String], favoritePageIDs: [String]) {
        self.title = title
        self.focus = focus
        self.actions = actions
        self.tabPageIDs = tabPageIDs
        self.favoritePageIDs = favoritePageIDs
    }

    /// Набор для должности. Незнакомая (свою заводит владелец) — общий набор
    /// сотрудника с её собственным названием.
    public static func forRole(_ staffRole: String?) -> StaffRolePlaybook {
        switch staffRole ?? "" {
        case "owner": owner
        case "manager": manager
        case "accountant": accountant
        case "marketer": marketer
        case "senior_operator": seniorOperator
        case "senior_cashier": seniorCashier
        case "operator": employee(title: "Оператор")
        case "", "other": employee(title: "Сотрудник")
        case let custom: employee(title: custom)
        }
    }

    public static let owner = StaffRolePlaybook(
        title: "Владелец",
        focus: "Весь бизнес на одном экране.",
        actions: [.addExpense, .addIncome, .addTask],
        tabPageIDs: ["team-chat", "tasks"],
        favoritePageIDs: [
            "income", "expenses", "cashflow", "profitability",
            "store-warehouse", "salary", "shifts", "tasks",
            "reports", "operators", "point-debts", "store-catalog",
        ]
    )

    public static let manager = StaffRolePlaybook(
        title: "Управляющий",
        focus: "Точки работают, команда на месте.",
        actions: [.addTask, .addExpense, .page("shifts"), .page("store-requests")],
        tabPageIDs: ["tasks", "shifts", "team-chat"],
        favoritePageIDs: [
            "shifts", "tasks", "operators", "store-warehouse",
            "store-requests", "expenses-pending", "shifts-reports", "incidents",
            "staff", "salary", "store-revisions", "point-debts",
        ]
    )

    public static let accountant = StaffRolePlaybook(
        title: "Бухгалтер",
        focus: "Деньги сходятся до тенге.",
        actions: [.addExpense, .addIncome, .page("expenses-pending"), .page("salary")],
        tabPageIDs: ["expenses-pending", "team-chat", "tasks"],
        favoritePageIDs: [
            "income", "expenses", "expenses-pending", "cashflow",
            "salary", "tax", "point-debts", "profitability",
            "reports", "expense-whitelist", "categories", "store-suppliers",
        ]
    )

    public static let marketer = StaffRolePlaybook(
        title: "Маркетолог",
        focus: "Гости приходят и возвращаются.",
        actions: [.addTask, .page("customers"), .page("store-advertising"), .page("news")],
        tabPageIDs: ["customers", "team-chat", "tasks"],
        favoritePageIDs: [
            "customers", "store-advertising", "news", "messages",
            "sales-kpi", "analytics", "store-analytics", "birthdays",
            "ratings", "moderation", "telegram", "goals",
        ]
    )

    public static let seniorOperator = StaffRolePlaybook(
        title: "Старший оператор",
        focus: "Смены идут по плану.",
        actions: [.addTask, .page("shifts"), .page("store-revisions"), .page("incidents")],
        tabPageIDs: ["shifts", "tasks", "team-chat"],
        favoritePageIDs: [
            "shifts", "shifts-reports", "operators", "store-revisions",
            "store-requests", "store-warehouse", "incidents", "operator-exams",
            "knowledge-admin", "operator-analytics", "store-writeoffs", "tasks",
        ]
    )

    public static let seniorCashier = StaffRolePlaybook(
        title: "Старший кассир",
        focus: "Касса сходится каждую смену.",
        actions: [.page("pos-receipts"), .page("pos-returns"), .page("shifts-reports"), .page("point-debts")],
        tabPageIDs: ["shifts-reports", "tasks", "team-chat"],
        favoritePageIDs: [
            "pos-receipts", "pos-returns", "shifts-reports", "point-debts",
            "income", "customers", "store-showcase", "shifts",
            "store-receipt-settings", "incidents", "tasks", "knowledge-admin",
        ]
    )

    public static func employee(title: String) -> StaffRolePlaybook {
        StaffRolePlaybook(
            title: title,
            focus: "Задачи, график и всё нужное под рукой.",
            actions: [.addTask, .page("shifts"), .page("knowledge-admin"), .page("news")],
            tabPageIDs: ["tasks", "team-chat", "shifts"],
            favoritePageIDs: [
                "tasks", "shifts", "knowledge-admin", "news",
                "team-chat", "birthdays", "operator-achievements", "ratings",
            ]
        )
    }
}

extension AccessResolver {
    /// Набор должности вошедшего.
    public var playbook: StaffRolePlaybook {
        StaffRolePlaybook.forRole(session.staffRole)
    }

    /// Разделы, которые человеку действительно открыты в приложении.
    public var reachablePageIDs: Set<String> {
        Set(nativeGroups().flatMap { $0.pages.map(\.id) })
    }

    /// Оставить из списка только открытые разделы, сохранив порядок.
    public func playbookPages(_ ids: [String]) -> [String] {
        let reachable = reachablePageIDs
        var seen = Set<String>()
        return ids.filter { reachable.contains($0) && seen.insert($0).inserted }
    }
}
