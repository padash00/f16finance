import Foundation
import OrdaKit
import SwiftUI

/// Состояние бизнес-пространства: дашборд, деньги, точки.
///
/// Каждая загрузка помнит свою ошибку отдельно: отказ по правам на одном
/// разделе не должен гасить остальные — у сотрудника это норма, а не сбой.
@MainActor
@Observable
final class BusinessStore {
    private(set) var dashboard: BusinessDashboard?
    private(set) var isLoadingDashboard = false
    private(set) var dashboardError: APIError?

    private(set) var pending: [PendingExpense] = []
    private(set) var isLoadingPending = false
    private(set) var pendingError: APIError?

    private(set) var incomes: [IncomeRow] = []
    private(set) var expenses: [ExpenseRow] = []
    private(set) var isLoadingLedger = false
    private(set) var ledgerError: APIError?

    private(set) var companies: [Company] = []

    private(set) var store: StoreOverview?
    private(set) var isLoadingStore = false
    private(set) var storeError: APIError?

    private(set) var operators: [TeamOperator] = []
    private(set) var isLoadingTeam = false
    private(set) var teamError: APIError?

    private(set) var salary: SalaryWeekReport?
    private(set) var isLoadingSalary = false
    private(set) var salaryError: APIError?

    /// Понедельник показываемой недели. Меняется стрелками в шапке зарплаты.
    var salaryWeek: String = PayWeek.start() {
        didSet {
            guard oldValue != salaryWeek else { return }
            Task { await loadSalary() }
        }
    }

    private(set) var report: ReportAggregate?
    private(set) var isLoadingReport = false
    private(set) var reportError: APIError?

    private(set) var tasks: [TeamTask] = []
    private(set) var isLoadingTasks = false
    private(set) var tasksError: APIError?

    private(set) var schedule: ShiftSchedule?
    private(set) var isLoadingSchedule = false
    private(set) var scheduleError: APIError?

    /// Понедельник показываемой недели графика — отдельно от зарплатной:
    /// это разные экраны, и синхронный сдвиг обоих сбивал бы с толку.
    var scheduleWeek: String = PayWeek.start() {
        didSet {
            guard oldValue != scheduleWeek else { return }
            Task { await loadSchedule() }
        }
    }

    private(set) var customers: [Customer] = []
    private(set) var isLoadingCustomers = false
    private(set) var customersError: APIError?

    private(set) var billing: OrganizationBilling?
    private(set) var isLoadingBilling = false
    private(set) var billingError: APIError?

    private(set) var incidents: [Incident] = []
    private(set) var isLoadingIncidents = false
    private(set) var incidentsError: APIError?

    private(set) var debts: PointDebtWeek?
    private(set) var isLoadingDebts = false
    private(set) var debtsError: APIError?

    var debtsWeek: String = PayWeek.start() {
        didSet {
            guard oldValue != debtsWeek else { return }
            Task { await loadDebts() }
        }
    }

    private(set) var pnl: PnlReport?
    private(set) var isLoadingPnl = false
    private(set) var pnlError: APIError?

    /// Сколько месяцев показывать в ОПиУ. Двенадцать — полный год для
    /// сравнения сезонов; меньше не даёт увидеть цикл.
    var pnlMonths = 12 {
        didSet {
            guard oldValue != pnlMonths else { return }
            Task { await loadPnl() }
        }
    }

    private(set) var devices: PointProjectList?
    private(set) var isLoadingDevices = false
    private(set) var devicesError: APIError?

    private(set) var revisions: [Stocktake] = []
    private(set) var isLoadingRevisions = false
    private(set) var revisionsError: APIError?

    private(set) var suppliers: SupplierList?
    private(set) var isLoadingSuppliers = false
    private(set) var suppliersError: APIError?

    private(set) var staff: StaffList?
    private(set) var isLoadingStaff = false
    private(set) var staffError: APIError?

    private(set) var receipts: [Receipt] = []
    private(set) var isLoadingReceipts = false
    private(set) var receiptsError: APIError?

    private(set) var writeoffs: [Writeoff] = []
    private(set) var isLoadingWriteoffs = false
    private(set) var writeoffsError: APIError?

    private(set) var shiftReports: [ShiftReport] = []
    private(set) var isLoadingShiftReports = false
    private(set) var shiftReportsError: APIError?

    private(set) var birthdays: BirthdayList?
    private(set) var isLoadingBirthdays = false
    private(set) var birthdaysError: APIError?

    var range: DateRange = .week {
        didSet {
            guard oldValue != range else { return }
            // Период общий для денег и отчётов: переключив его в одном месте,
            // человек ожидает согласованные цифры в обоих.
            Task { await loadLedger() }
            Task { await loadReport() }
        }
    }

    /// Название точки по идентификатору — строки списков показывают имя,
    /// а не UUID.
    func companyName(_ id: String?) -> String? {
        guard let id else { return nil }
        return companies.first { $0.id == id }?.name
    }

    private let service: BusinessService

    init(api: APIClient) {
        self.service = BusinessService(api: api)
    }

    // ── Загрузка ─────────────────────────────────────────────────────────────

    func bootstrap() async {
        async let dash: Void = loadDashboard()
        async let approvals: Void = loadPending()
        async let points: Void = loadCompanies()
        _ = await (dash, approvals, points)
    }

    func loadDashboard() async {
        isLoadingDashboard = true
        defer { isLoadingDashboard = false }
        do {
            dashboard = try await service.dashboard()
            dashboardError = nil
        } catch let error as APIError {
            dashboardError = error
        } catch {
            dashboardError = .transport(message: error.localizedDescription)
        }
    }

    func loadPending() async {
        isLoadingPending = true
        defer { isLoadingPending = false }
        do {
            pending = try await service.pendingExpenses()
            pendingError = nil
        } catch let error as APIError {
            // Нет права смотреть очередь — это не ошибка, а настройка доступа.
            pendingError = error
            pending = []
        } catch {
            pendingError = .transport(message: error.localizedDescription)
        }
    }

    func loadCompanies() async {
        companies = (try? await service.companies()) ?? companies
    }

    func loadLedger() async {
        isLoadingLedger = true
        defer { isLoadingLedger = false }
        let bounds = range.bounds
        do {
            async let incomeRows = service.incomes(from: bounds.from, to: bounds.to)
            async let expenseRows = service.expenses(from: bounds.from, to: bounds.to)
            incomes = try await incomeRows
            expenses = try await expenseRows
            ledgerError = nil
        } catch let error as APIError {
            ledgerError = error
        } catch {
            ledgerError = .transport(message: error.localizedDescription)
        }
    }

    func loadStore() async {
        isLoadingStore = true
        defer { isLoadingStore = false }
        do {
            store = try await service.storeOverview()
            storeError = nil
        } catch let error as APIError {
            storeError = error
        } catch {
            storeError = .transport(message: error.localizedDescription)
        }
    }

    func loadTeam() async {
        isLoadingTeam = true
        defer { isLoadingTeam = false }
        do {
            operators = try await service.operators()
            teamError = nil
        } catch let error as APIError {
            teamError = error
            operators = []
        } catch {
            teamError = .transport(message: error.localizedDescription)
        }
    }

    func loadSalary() async {
        isLoadingSalary = true
        defer { isLoadingSalary = false }
        do {
            salary = try await service.salary(weekStart: salaryWeek)
            salaryError = nil
        } catch let error as APIError {
            salaryError = error
        } catch {
            salaryError = .transport(message: error.localizedDescription)
        }
    }

    func loadReport() async {
        isLoadingReport = true
        defer { isLoadingReport = false }
        let bounds = range.bounds
        do {
            report = try await service.report(from: bounds.from, to: bounds.to)
            reportError = nil
        } catch let error as APIError {
            reportError = error
        } catch {
            reportError = .transport(message: error.localizedDescription)
        }
    }

    func loadTasks() async {
        isLoadingTasks = true
        defer { isLoadingTasks = false }
        do {
            tasks = try await service.tasks()
            tasksError = nil
        } catch let error as APIError {
            tasksError = error
            tasks = []
        } catch {
            tasksError = .transport(message: error.localizedDescription)
        }
    }

    func loadSchedule() async {
        isLoadingSchedule = true
        defer { isLoadingSchedule = false }
        do {
            schedule = try await service.schedule(weekStart: scheduleWeek)
            scheduleError = nil
        } catch let error as APIError {
            scheduleError = error
        } catch {
            scheduleError = .transport(message: error.localizedDescription)
        }
    }

    func loadCustomers() async {
        isLoadingCustomers = true
        defer { isLoadingCustomers = false }
        do {
            customers = try await service.customers()
            customersError = nil
        } catch let error as APIError {
            customersError = error
            customers = []
        } catch {
            customersError = .transport(message: error.localizedDescription)
        }
    }

    func loadBilling() async {
        isLoadingBilling = true
        defer { isLoadingBilling = false }
        do {
            billing = try await service.billing()
            billingError = nil
        } catch let error as APIError {
            billingError = error
        } catch {
            billingError = .transport(message: error.localizedDescription)
        }
    }

    func loadIncidents() async {
        isLoadingIncidents = true
        defer { isLoadingIncidents = false }
        do {
            incidents = try await service.incidents()
            incidentsError = nil
        } catch let error as APIError {
            incidentsError = error
            incidents = []
        } catch {
            incidentsError = .transport(message: error.localizedDescription)
        }
    }

    func loadDebts() async {
        isLoadingDebts = true
        defer { isLoadingDebts = false }
        do {
            debts = try await service.pointDebts(weekStart: debtsWeek)
            debtsError = nil
        } catch let error as APIError {
            debtsError = error
        } catch {
            debtsError = .transport(message: error.localizedDescription)
        }
    }

    func loadPnl() async {
        isLoadingPnl = true
        defer { isLoadingPnl = false }
        let bounds = PnlPeriod.lastMonths(pnlMonths)
        do {
            pnl = try await service.pnl(from: bounds.from, to: bounds.to)
            pnlError = nil
        } catch let error as APIError {
            pnlError = error
        } catch {
            pnlError = .transport(message: error.localizedDescription)
        }
    }

    func loadDevices() async {
        isLoadingDevices = true
        defer { isLoadingDevices = false }
        do {
            devices = try await service.pointProjects()
            devicesError = nil
        } catch let error as APIError {
            devicesError = error
        } catch {
            devicesError = .transport(message: error.localizedDescription)
        }
    }

    func loadRevisions() async {
        isLoadingRevisions = true
        defer { isLoadingRevisions = false }
        do {
            revisions = try await service.revisions()
            revisionsError = nil
        } catch let error as APIError {
            revisionsError = error
            revisions = []
        } catch {
            revisionsError = .transport(message: error.localizedDescription)
        }
    }

    func loadSuppliers() async {
        isLoadingSuppliers = true
        defer { isLoadingSuppliers = false }
        do {
            suppliers = try await service.suppliers()
            suppliersError = nil
        } catch let error as APIError {
            suppliersError = error
        } catch {
            suppliersError = .transport(message: error.localizedDescription)
        }
    }

    func loadStaff() async {
        isLoadingStaff = true
        defer { isLoadingStaff = false }
        do {
            staff = try await service.staff()
            staffError = nil
        } catch let error as APIError {
            staffError = error
        } catch {
            staffError = .transport(message: error.localizedDescription)
        }
    }

    func loadReceipts() async {
        isLoadingReceipts = true
        defer { isLoadingReceipts = false }
        do {
            receipts = try await service.receipts()
            receiptsError = nil
        } catch let error as APIError {
            receiptsError = error
            receipts = []
        } catch {
            receiptsError = .transport(message: error.localizedDescription)
        }
    }

    func loadWriteoffs() async {
        isLoadingWriteoffs = true
        defer { isLoadingWriteoffs = false }
        do {
            writeoffs = try await service.writeoffs()
            writeoffsError = nil
        } catch let error as APIError {
            writeoffsError = error
            writeoffs = []
        } catch {
            writeoffsError = .transport(message: error.localizedDescription)
        }
    }

    func loadShiftReports() async {
        isLoadingShiftReports = true
        defer { isLoadingShiftReports = false }
        do {
            shiftReports = try await service.shiftReports()
            shiftReportsError = nil
        } catch let error as APIError {
            shiftReportsError = error
            shiftReports = []
        } catch {
            shiftReportsError = .transport(message: error.localizedDescription)
        }
    }

    func loadBirthdays() async {
        isLoadingBirthdays = true
        defer { isLoadingBirthdays = false }
        do {
            birthdays = try await service.birthdays()
            birthdaysError = nil
        } catch let error as APIError {
            birthdaysError = error
        } catch {
            birthdaysError = .transport(message: error.localizedDescription)
        }
    }

    // ── Действия ─────────────────────────────────────────────────────────────

    func approve(_ expense: PendingExpense) async -> String? {
        do {
            try await service.approveExpense(id: expense.id)
            pending.removeAll { $0.id == expense.id }
            return nil
        } catch let error as APIError {
            return error.userMessage
        } catch {
            return error.localizedDescription
        }
    }

    func decline(_ expense: PendingExpense, reason: String?) async -> String? {
        do {
            try await service.declineExpense(id: expense.id, reason: reason)
            pending.removeAll { $0.id == expense.id }
            return nil
        } catch let error as APIError {
            return error.userMessage
        } catch {
            return error.localizedDescription
        }
    }

    // ── Производные показатели ───────────────────────────────────────────────

    var incomeTotal: Double { incomes.reduce(0) { $0 + $1.total } }
    var expenseTotal: Double { expenses.reduce(0) { $0 + $1.total } }
    var profit: Double { incomeTotal - expenseTotal }

    /// Расходы по категориям, от крупных к мелким.
    var expensesByCategory: [(name: String, amount: Double)] {
        var sums: [String: Double] = [:]
        for row in expenses {
            let key = row.category?.isEmpty == false ? row.category! : "Без категории"
            sums[key, default: 0] += row.total
        }
        return sums
            .map { (name: $0.key, amount: $0.value) }
            .sorted { $0.amount > $1.amount }
    }

    /// Доходы по дням периода — для графика.
    var incomeSeries: [(date: String, amount: Double)] {
        var sums: [String: Double] = [:]
        for row in incomes where !row.date.isEmpty {
            sums[row.date, default: 0] += row.total
        }
        return sums.keys.sorted().map { ($0, sums[$0] ?? 0) }
    }
}
