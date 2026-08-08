import OrdaKit
import OrdaUI
import SwiftUI

/// Экран для раздела портала, у которого есть нативная версия.
///
/// Разделы открываются из боковой панели, из списка «Разделы» и по ссылкам с
/// дашборда — все три места разрешают раздел здесь. Забытая ветка в одном из
/// них означала бы, что на iPad раздел нативный, а на iPhone тот же самый в
/// рамке браузера.
///
/// Какие идентификаторы считаются нативными, решает `NativeSection` в OrdaKit:
/// там это данные, покрытые тестом. Здесь остаётся только построение вида —
/// SwiftUI в домен не тянем.
///
/// Всё, чего нет в списке, по-прежнему открывается веб-версией: раздел
/// остаётся рабочим, а не превращается в заглушку до того, как до него
/// дойдут руки.
enum NativePage {
    /// Экран раздела каталога, если он нативный. `nil` — открывать веб.
    @ViewBuilder
    static func screen(pageID: String) -> some View {
        if let section = NativeSection.forPage(id: pageID) {
            view(for: section)
        }
    }

    static func isNative(pageID: String) -> Bool {
        NativeSection.forPage(id: pageID) != nil
    }

    @ViewBuilder
    private static func view(for section: NativeSection) -> some View {
        switch section {
        case .store: StoreScreen()
        case .stock: StockScreen()
        case .requests: RequestsScreen()
        case .movements: MovementsScreen()
        case .operators: OperatorsScreen()
        case .salary: SalaryScreen()
        case .reports: ReportsScreen()
        case .tasks: TeamTasksScreen()
        case .shifts: ScheduleWeekScreen()
        case .customers: CustomersScreen()
        case .incidents: IncidentsScreen()
        case .pointDebts: PointDebtsScreen()
        case .profitability: PnlScreen()
        case .pointDevices: PointDevicesScreen()
        case .revisions: RevisionsScreen()
        case .suppliers: SuppliersScreen()
        case .staff: StaffScreen()
        case .receipts: ReceiptsScreen()
        case .writeoffs: WriteoffsScreen()
        case .shiftReports: ShiftReportsScreen()
        case .birthdays: BirthdaysScreen()
        }
    }
}
