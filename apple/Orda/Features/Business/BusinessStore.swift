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

    var range: DateRange = .week {
        didSet {
            guard oldValue != range else { return }
            Task { await loadLedger() }
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
