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
    case requests
    case movements
    case operators
    case salary
    case reports
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
    case writeoffs
    case shiftReports
    case birthdays
    case categories
    case storeAnalytics
    case knowledge

    /// Идентификаторы страниц каталога, которые ведут на этот экран.
    public var pageIDs: [String] {
        switch self {
        case .store: ["store"]
        // Склад, витрина и каталог — один экран с разрезом по точкам:
        // разделять их в приложении незачем, разрез переключается на месте.
        // `inventory` сюда не входит — это группа каталога, а не страница.
        case .stock: ["store-warehouse", "store-showcase", "store-catalog"]
        case .requests: ["store-requests", "store-requests-journal"]
        case .movements: ["store-movements"]
        case .operators: ["operators"]
        case .salary: ["salary"]
        case .reports: ["reports", "analytics"]
        case .tasks: ["tasks"]
        case .shifts: ["shifts"]
        case .customers: ["customers"]
        case .incidents: ["incidents"]
        case .pointDebts: ["point-debts"]
        // Оценка бизнеса строится на той же EBITDA — открываем тем же экраном.
        case .profitability: ["profitability", "valuation"]
        case .pointDevices: ["point-devices"]
        case .revisions: ["store-revisions"]
        case .suppliers: ["store-suppliers"]
        case .staff: ["staff"]
        // Приёмка и оприходование — один журнал документов.
        case .receipts: ["store-receipts", "store-postings"]
        case .writeoffs: ["store-writeoffs"]
        case .shiftReports: ["shifts-reports"]
        case .birthdays: ["birthdays"]
        case .categories: ["categories"]
        case .storeAnalytics: ["store-analytics", "store-forecast"]
        case .knowledge: ["knowledge-admin"]
        }
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
