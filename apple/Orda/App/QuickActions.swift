#if os(iOS)
import OrdaKit
import SwiftUI
import UIKit

/// Быстрые действия по долгому нажатию на иконку приложения.
///
/// Смысл в том, чтобы попасть в нужное место, минуя открытие и навигацию:
/// выручку сдают в конце смены, задачу ставят на ходу, расход согласовывают
/// между делом. Три нажатия против одного.
///
/// Список собирается по правам, а не задаётся в Info.plist: пункт «Добавить
/// доход» у того, кому доходы не открывали, ведёт в отказ ещё до входа в
/// приложение.
enum QuickActions {
    /// Что предлагает меню иконки.
    enum Kind: String, CaseIterable {
        case addIncome = "orda.action.income"
        case addTask = "orda.action.task"
        case approvals = "orda.action.approvals"

        var title: String {
            switch self {
            case .addIncome: "Добавить доход"
            case .addTask: "Новая задача"
            case .approvals: "Согласовать расходы"
            }
        }

        var icon: UIApplicationShortcutIcon {
            switch self {
            case .addIncome: UIApplicationShortcutIcon(systemImageName: "arrow.down.circle")
            case .addTask: UIApplicationShortcutIcon(systemImageName: "checklist")
            case .approvals: UIApplicationShortcutIcon(systemImageName: "checkmark.seal")
            }
        }

        /// Право, без которого пункт не показываем.
        var capability: String {
            switch self {
            case .addIncome: "income.create"
            case .addTask: "tasks.create"
            case .approvals: "expenses-pending.view"
            }
        }

        /// Раздел, который нужно открыть.
        var pageID: String {
            switch self {
            case .addIncome: "income"
            case .addTask: "tasks"
            case .approvals: "expenses-pending"
            }
        }
    }

    /// Что выбрали в меню иконки. Читает корневой экран, когда построит меню.
    @MainActor private(set) static var pending: Kind?

    @MainActor static func take() -> Kind? {
        defer { pending = nil }
        return pending
    }

    @MainActor static func handle(_ item: UIApplicationShortcutItem) {
        // Два контура, два набора: какой именно пришёл, видно по префиксу.
        if let operatorKind = OperatorKind(rawValue: item.type) {
            pendingOperator = operatorKind
            return
        }
        pending = Kind(rawValue: item.type)
    }

    /// Быстрые действия оператора.
    ///
    /// У оператора прав в админском смысле нет — у него пять вкладок и смена.
    /// Поэтому список фиксированный: то, ради чего он вообще достаёт телефон
    /// за стойкой.
    enum OperatorKind: String, CaseIterable {
        case shift = "orda.operator.shift"
        case sale = "orda.operator.sale"
        case audit = "orda.operator.audit"

        var title: String {
            switch self {
            case .shift: "Смена"
            case .sale: "Продажа"
            case .audit: "Ревизия"
            }
        }

        var icon: UIApplicationShortcutIcon {
            switch self {
            case .shift: UIApplicationShortcutIcon(systemImageName: "clock")
            case .sale: UIApplicationShortcutIcon(systemImageName: "cart")
            case .audit: UIApplicationShortcutIcon(systemImageName: "list.clipboard")
            }
        }
    }

    @MainActor private(set) static var pendingOperator: OperatorKind?

    @MainActor static func takeOperator() -> OperatorKind? {
        defer { pendingOperator = nil }
        return pendingOperator
    }

    /// Собрать меню оператора.
    @MainActor static func refreshForOperator() {
        UIApplication.shared.shortcutItems = OperatorKind.allCases.map { kind in
            UIApplicationShortcutItem(
                type: kind.rawValue,
                localizedTitle: kind.title,
                localizedSubtitle: nil,
                icon: kind.icon,
                userInfo: nil
            )
        }
    }

    /// Пересобрать меню под текущие права.
    ///
    /// Вызывается после загрузки прав и после каждого их обновления: список
    /// должен таять и расти вместе с доступом, а не застывать таким, каким был
    /// в день установки.
    @MainActor static func refresh(for resolver: AccessResolver?) {
        guard let resolver else {
            UIApplication.shared.shortcutItems = []
            return
        }

        UIApplication.shared.shortcutItems = Kind.allCases
            .filter { resolver.can($0.capability) }
            .map { kind in
                UIApplicationShortcutItem(
                    type: kind.rawValue,
                    localizedTitle: kind.title,
                    localizedSubtitle: nil,
                    icon: kind.icon,
                    userInfo: nil
                )
            }
    }
}
#endif
