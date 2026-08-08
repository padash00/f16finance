import Foundation

/// Админский контур `/api/admin/*` — владелец и сотрудники.
///
/// В отличие от операторского, здесь каждое действие защищено правом на
/// сервере (`requireCapability`). Приложение прячет кнопки заранее, но это
/// только удобство: отказ 403 всё равно нужно уметь показать по-человечески.
public struct BusinessService: Sendable {
    private let api: APIClient

    public init(api: APIClient) {
        self.api = api
    }

    // ── Дашборд ──────────────────────────────────────────────────────────────

    public func dashboard() async throws -> BusinessDashboard {
        try await api.send(APIRequest(path: "/api/admin/dashboard"))
    }

    public func companies() async throws -> [Company] {
        let response: DataList<Company> = try await api.send(APIRequest(path: "/api/admin/companies"))
        return response.items
    }

    // ── Деньги ───────────────────────────────────────────────────────────────

    /// Расходы, ожидающие решения. Требует `expenses-pending.view`.
    public func pendingExpenses() async throws -> [PendingExpense] {
        let response: DataList<PendingExpense> = try await api.send(
            APIRequest(path: "/api/admin/expenses/pending")
        )
        return response.items
    }

    /// Одобрить расход. Требует `expenses-pending.approve`.
    public func approveExpense(id: String) async throws {
        _ = try await api.send(
            APIRequest(path: "/api/admin/expenses/\(id)/approve", method: .post)
        )
    }

    /// Отклонить расход. Требует `expenses-pending.decline`.
    public func declineExpense(id: String, reason: String? = nil) async throws {
        var body: [String: Any] = [:]
        if let reason, !reason.isEmpty { body["reason"] = reason }
        _ = try await api.send(
            APIRequest(
                path: "/api/admin/expenses/\(id)/decline",
                method: .post,
                body: body.isEmpty ? nil : try JSONSerialization.data(withJSONObject: body)
            )
        )
    }

    /// Доходы за период. Даты в формате `YYYY-MM-DD`.
    public func incomes(from: String, to: String) async throws -> [IncomeRow] {
        let response: DataList<IncomeRow> = try await api.send(
            APIRequest(path: "/api/admin/incomes", query: ["dateFrom": from, "dateTo": to])
        )
        return response.items
    }

    public func expenses(from: String, to: String) async throws -> [ExpenseRow] {
        let response: DataList<ExpenseRow> = try await api.send(
            APIRequest(path: "/api/admin/expenses", query: ["dateFrom": from, "dateTo": to])
        )
        return response.items
    }
}

// ── Периоды ──────────────────────────────────────────────────────────────────

/// Диапазон дат для фильтров отчётов.
public enum DateRange: String, CaseIterable, Sendable, Identifiable {
    case week
    case month
    case quarter

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .week: "Неделя"
        case .month: "Месяц"
        case .quarter: "Квартал"
        }
    }

    /// Границы периода в формате API. Считаем от начала сегодняшнего дня —
    /// иначе граница «съезжает» в течение суток и суммы прыгают.
    public var bounds: (from: String, to: String) {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        let days: Int = switch self {
        case .week: 6
        case .month: 29
        case .quarter: 89
        }
        let start = calendar.date(byAdding: .day, value: -days, to: today) ?? today
        return (DateParsing.dateOnlyString(from: start), DateParsing.dateOnlyString(from: today))
    }
}
