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

    /// ОПиУ по месяцам. Требует `profitability.view`.
    ///
    /// Величины приходят посчитанными: формула живёт на сервере, чтобы сайт и
    /// приложение показывали одну и ту же EBITDA.
    public func pnl(from: String, to: String) async throws -> PnlReport {
        let response: Envelope<PnlReport> = try await api.send(
            APIRequest(path: "/api/admin/profitability/summary", query: ["from": from, "to": to])
        )
        return response.data
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

    /// Штрафы, бонусы и заметки по сотрудникам. Требует `incidents.view`.
    public func incidents() async throws -> [Incident] {
        let response: Envelope<IncidentList> = try await api.send(
            APIRequest(path: "/api/admin/incidents")
        )
        return response.data.incidents
    }

    /// Долги клиентов, записанные на точке за неделю.
    public func pointDebts(weekStart: String) async throws -> PointDebtWeek {
        let response: Envelope<PointDebtWeek> = try await api.send(
            APIRequest(path: "/api/admin/point-debts", query: ["weekStart": weekStart])
        )
        return response.data
    }

    /// Статьи расходов с бюджетом и фактом за месяц.
    public func expenseCategories() async throws -> [ExpenseCategory] {
        let response: DataList<ExpenseCategory> = try await api.send(
            APIRequest(path: "/api/admin/expense-categories")
        )
        return response.items
    }

    /// Аналитика магазина за окно в днях. `0` — за всё время.
    public func storeAnalytics(days: Int) async throws -> StoreAnalytics {
        let response: Envelope<StoreAnalytics> = try await api.send(
            APIRequest(path: "/api/admin/store/analytics", query: ["days": String(days)])
        )
        return response.data
    }

    /// База знаний: разделы и статьи. Требует `knowledge-admin.view`.
    public func knowledge() async throws -> KnowledgeBase {
        let response: Envelope<KnowledgeBase> = try await api.send(
            APIRequest(path: "/api/admin/knowledge")
        )
        return response.data
    }

    /// Приёмки от поставщиков. Требует `store-receipts.view`.
    public func receipts() async throws -> [Receipt] {
        let response: Envelope<ReceiptList> = try await api.send(
            APIRequest(path: "/api/admin/store/receipts")
        )
        return response.data.receipts
    }

    /// Списания. Требует `store-writeoffs.view`.
    public func writeoffs() async throws -> [Writeoff] {
        let response: Envelope<WriteoffList> = try await api.send(
            APIRequest(path: "/api/admin/store/writeoffs")
        )
        return response.data.writeoffs
    }

    /// Отчёты смен точек. Требует `shifts-reports.view`.
    public func shiftReports(limit: Int = 100) async throws -> [ShiftReport] {
        let response: Envelope<ShiftReportList> = try await api.send(
            APIRequest(path: "/api/admin/shifts/reports", query: ["limit": String(limit)])
        )
        return response.data.shifts
    }

    /// Ближайшие дни рождения команды. Требует `birthdays.view`.
    public func birthdays() async throws -> BirthdayList {
        let response: Envelope<BirthdayList> = try await api.send(
            APIRequest(path: "/api/admin/birthdays")
        )
        return response.data
    }

    /// Ревизии склада и витрин. Требует `store-revisions.view`.
    public func revisions() async throws -> [Stocktake] {
        let response: Envelope<RevisionList> = try await api.send(
            APIRequest(path: "/api/admin/store/revisions")
        )
        return response.data.stocktakes
    }

    /// Поставщики с историей приёмок и долгами. Требует `store-suppliers.view`.
    public func suppliers() async throws -> SupplierList {
        let response: Envelope<SupplierList> = try await api.send(
            APIRequest(path: "/api/admin/store/suppliers")
        )
        return response.data
    }

    /// Административные сотрудники и выплаты. Требует `staff.view`.
    ///
    /// Ответ без конверта `data` — роут отдаёт поля в корне.
    public func staff() async throws -> StaffList {
        try await api.send(APIRequest(path: "/api/admin/staff"))
    }

    /// Программы точек и их состояние. Требует `point-devices.view`.
    public func pointProjects() async throws -> PointProjectList {
        let response: Envelope<PointProjectList> = try await api.send(
            APIRequest(path: "/api/admin/point-devices")
        )
        return response.data
    }

    // ── Подписка ─────────────────────────────────────────────────────────────

    /// Тариф своей организации, модули и счета.
    ///
    /// Возвращает `nil`, когда организация не выбрана: сервер в этом случае
    /// отдаёт `data: null`, и это не ошибка, а «нечего показывать».
    public func billing() async throws -> OrganizationBilling? {
        let response: OptionalEnvelope<OrganizationBilling> = try await api.send(
            APIRequest(path: "/api/admin/my-subscription")
        )
        return response.data
    }
}

/// `{ data: … | null }` — для роутов, где отсутствие данных законно.
public struct OptionalEnvelope<Payload: Decodable & Sendable>: Decodable, Sendable {
    public let data: Payload?

    private enum CodingKeys: String, CodingKey { case data }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        data = try c.decodeIfPresent(Payload.self, forKey: .data)
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
