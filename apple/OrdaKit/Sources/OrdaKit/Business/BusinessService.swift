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

    // ── Магазин ──────────────────────────────────────────────────────────────

    /// Склад целиком: точки, остатки, движения, заявки. Требует `store.view`
    /// и модуль `shop.catalog` у организации.
    public func storeOverview() async throws -> StoreOverview {
        let response: Envelope<StoreOverview> = try await api.send(
            APIRequest(path: "/api/admin/store/overview")
        )
        return response.data
    }

    // ── Команда ──────────────────────────────────────────────────────────────

    /// Операторы с профилями и статистикой за 30 дней. Требует `operators.view`.
    public func operators() async throws -> [TeamOperator] {
        let response: DataList<TeamOperator> = try await api.send(
            APIRequest(path: "/api/admin/operators")
        )
        return response.items
    }

    /// Зарплата за неделю. `weekStart` — понедельник в формате `YYYY-MM-DD`;
    /// сервер отвергает произвольные даты, поэтому выравнивание на клиенте
    /// обязательно (см. `DateRange.weekStart`).
    public func salary(weekStart: String) async throws -> SalaryWeekReport {
        let response: Envelope<SalaryWeekReport> = try await api.send(
            APIRequest(path: "/api/admin/salary", query: ["weekStart": weekStart])
        )
        return response.data
    }

    /// График смен на неделю. Требует `shifts.view` либо `dashboard.view`.
    public func schedule(weekStart: String) async throws -> ShiftSchedule {
        try await api.send(
            APIRequest(
                path: "/api/admin/shifts",
                query: ["weekStart": weekStart, "includeSchedule": "1"]
            )
        )
    }

    // ── Отчёты ───────────────────────────────────────────────────────────────

    /// Сводный отчёт за период: итоги, сравнение с прошлым периодом, разрезы.
    public func report(from: String, to: String) async throws -> ReportAggregate {
        let response: Envelope<ReportBundle> = try await api.send(
            APIRequest(path: "/api/admin/reports/bundle", query: ["from": from, "to": to])
        )
        return response.data.aggregate
    }

    // ── Операционная работа ──────────────────────────────────────────────────

    /// Задачи команды. Требует `tasks.view`.
    public func tasks(status: String? = nil) async throws -> [TeamTask] {
        var query: [String: String] = ["pageSize": "200"]
        if let status { query["status"] = status }
        let response: DataList<TeamTask> = try await api.send(
            APIRequest(path: "/api/admin/tasks", query: query)
        )
        return response.items
    }

    /// Клиенты с лояльностью. Требует прав сотрудника.
    public func customers(search: String? = nil) async throws -> [Customer] {
        var query: [String: String] = [:]
        if let search, !search.isEmpty { query["search"] = search }
        let response: DataList<Customer> = try await api.send(
            APIRequest(path: "/api/admin/customers", query: query)
        )
        return response.items
    }
}

// ── Конверт ответа ───────────────────────────────────────────────────────────

/// `{ ok: true, data: … }` — форма ответа большинства админских роутов.
public struct Envelope<Payload: Decodable & Sendable>: Decodable, Sendable {
    public let data: Payload

    private enum CodingKeys: String, CodingKey { case data }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        data = try c.decode(Payload.self, forKey: .data)
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

/// Границы зарплатной недели.
///
/// Сервер хранит недели по понедельникам и отвергает произвольную дату, а
/// `Calendar.current` в Казахстане начинает неделю с воскресенья. Поэтому
/// понедельник считаем сами, а не через `firstWeekday`.
///
/// Имя не `SalaryWeek` — так называется недельная сводка операторского
/// кабинета, и два разных смысла под одним именем путали бы.
public enum PayWeek {
    /// Понедельник недели, в которую попадает дата, в формате API.
    public static func start(containing date: Date = Date()) -> String {
        let calendar = Calendar(identifier: .iso8601)
        let day = calendar.startOfDay(for: date)
        // В ISO-8601 понедельник = 2 в `weekday`; сдвигаем назад на разницу.
        let weekday = calendar.component(.weekday, from: day)
        let offset = (weekday + 5) % 7
        let monday = calendar.date(byAdding: .day, value: -offset, to: day) ?? day
        return DateParsing.dateOnlyString(from: monday)
    }

    /// Сдвиг на `weeks` недель от заданного понедельника.
    public static func shifted(_ weekStart: String, by weeks: Int) -> String {
        guard let date = DateParsing.parseDateOnly(weekStart) else { return weekStart }
        let calendar = Calendar(identifier: .iso8601)
        let moved = calendar.date(byAdding: .day, value: weeks * 7, to: date) ?? date
        return DateParsing.dateOnlyString(from: moved)
    }
}
