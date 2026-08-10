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

    /// Экран раздела вне каталога прав.
    @ViewBuilder
    static func screen(section: NativeSection) -> some View {
        view(for: section)
    }

    @ViewBuilder
    private static func view(for section: NativeSection) -> some View {
        switch section {
        case .store: StoreScreen()
        case .stock: StockScreen()
        case .showcase: ShowcaseScreen()
        case .catalog: CatalogScreen()
        case .requests: RequestsScreen(scope: .pending)
        case .requestsJournal: RequestsScreen(scope: .journal)
        case .movements: MovementsScreen()
        case .operators: OperatorsScreen()
        case .salary: SalaryScreen()
        case .reports: ReportsScreen()
        case .analytics: MonthlyAnalyticsScreen()
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
        case .receipts: ReceiptsScreen(kind: .supplier)
        case .postings: ReceiptsScreen(kind: .posting)
        case .writeoffs: WriteoffsScreen()
        case .shiftReports: ShiftReportsScreen()
        case .birthdays: BirthdaysScreen()
        case .categories: ExpenseCategoriesScreen()
        case .storeAnalytics: StoreAnalyticsScreen()
        case .storeForecast: StockForecastScreen()
        case .knowledge: KnowledgeAdminScreen()
        case .settings: SettingsScreen()
        case .logs: LogsScreen()
        case .telegram: TelegramScreen()
        case .diagnostics: DiagnosticsScreen()
        case .production: ProductionScreen()
        case .purchasePlan: PurchasePlanScreen()
        case .purchaseOrders: PurchaseOrdersScreen()
        case .consumables: ConsumablesScreen()
        case .performance: PerformanceScreen()
        case .ratings: RatingsScreen()
        case .achievements: AchievementsScreen()
        case .posReceipts: ReceiptsListScreen()
        case .posReturns: ReturnsScreen()
        case .receiptSettings: ReceiptSettingsScreen()
        case .advertising: AdvertisingScreen()
        case .salaryRules: SalaryRulesScreen()
        case .hr: HRScreen()
        case .structure: StructureScreen()
        case .access: AccessScreen()
        case .credentials: CredentialsScreen()
        case .news: NewsScreen()
        case .teamChat: TeamChatScreen()
        case .messages: MessagesScreen()
        case .moderation: ModerationScreen()
        case .tax: TaxScreen()
        case .cashflow: CashflowScreen()
        case .goals: GoalsScreen()
        case .weeklyReport: WeeklyReportScreen()
        case .valuation: ValuationScreen()
        case .analysis: AnalysisScreen()
        case .forecast: ForecastScreen()
        case .businessIntelligence: BusinessIntelligenceScreen()
        case .aiCfo: AiCfoScreen()
        case .expenseAnalysis: ExpenseAnalysisScreen()
        case .teamAnalysis: TeamAnalysisScreen()
        case .calendar: CalendarScreen()
        case .income: IncomeScreen()
        case .expenses: ExpensesScreen()
        case .approvals: ApprovalsScreen()
        case .expenseWhitelist: ExpenseWhitelistScreen()
        case .simulation: SimulationScreen()
        case .supplierBilling: SupplierBillingScreen()
        case .discounts: DiscountsScreen()
        case .stations: StationsScreen()
        case .storeSettings: StoreSettingsScreen()
        case .storeShifts: StoreShiftsScreen()
        }
    }
}
