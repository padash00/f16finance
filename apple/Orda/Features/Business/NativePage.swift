import OrdaKit
import OrdaUI
import SwiftUI

/// Разделы портала, у которых есть нативный экран.
///
/// Список ведётся здесь, а не в каждой точке навигации: разделы открываются
/// из боковой панели, из списка «Разделы» и по ссылкам с дашборда, и все три
/// места должны согласованно выбирать нативный экран вместо веба. Забытая
/// ветка в одном из них означала бы, что на iPad раздел нативный, а на
/// iPhone — тот же самый в рамке браузера.
///
/// Всё, чего здесь нет, по-прежнему открывается веб-версией: раздел остаётся
/// рабочим, а не превращается в заглушку до того, как до него дойдут руки.
enum NativePage: String, CaseIterable {
    case store
    case storeStock
    case operators
    case salary

    /// Сопоставление с идентификаторами каталога прав.
    init?(pageID: String) {
        switch pageID {
        case "store", "store-overview": self = .store
        case "store-stock", "inventory": self = .storeStock
        case "operators": self = .operators
        case "salary": self = .salary
        default: return nil
        }
    }

    @ViewBuilder
    var screen: some View {
        switch self {
        case .store: StoreScreen()
        case .storeStock: StockScreen()
        case .operators: OperatorsScreen()
        case .salary: SalaryScreen()
        }
    }
}
