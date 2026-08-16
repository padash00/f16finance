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
    ///
    /// Параметры именно `from`/`to`: роут читает эти имена. Раньше здесь
    /// слались `dateFrom`/`dateTo`, роут их не видел и молча отдавал последние
    /// 2000 строк независимо от периода — переключатель «Неделя / Месяц /
    /// Квартал» не менял ничего, а суммы были не за выбранный период.
    public func incomes(from: String, to: String) async throws -> [IncomeRow] {
        let response: DataList<IncomeRow> = try await api.send(
            APIRequest(
                path: "/api/admin/incomes",
                query: ["from": from, "to": to, "page_size": String(Self.pageSize)]
            )
        )
        return response.items
    }

    /// Завести доход за смену.
    ///
    /// `force` — согласие завести запись, совпадающую с уже существующей по
    /// дате, смене и всем суммам. Сервер отвечает на такую 409 и описанием
    /// дубликата: две одинаковые выручки за одну смену почти всегда ошибка
    /// ввода, но иногда правда.
    public func createIncome(_ draft: IncomeDraft, force: Bool = false) async throws {
        let body = try JSONEncoder().encode(IncomeCreateRequest(payload: draft, force: force))
        _ = try await api.send(
            APIRequest(path: "/api/admin/incomes", method: .post, body: body)
        )
    }

    public func expenses(from: String, to: String) async throws -> [ExpenseRow] {
        let response: DataList<ExpenseRow> = try await api.send(
            APIRequest(
                path: "/api/admin/expenses",
                query: ["from": from, "to": to, "page_size": String(Self.pageSize)]
            )
        )
        return response.items
    }

    /// Потолок страницы у роутов доходов и расходов. Просим максимум: признака
    /// «есть ещё» они не отдают, и на длинном периоде молчаливая обрезка
    /// занизила бы итоги.
    private static let pageSize = 5000

    // ── Магазин ──────────────────────────────────────────────────────────────

    /// Склад целиком: точки, остатки, движения, заявки. Требует `store.view`
    /// и модуль `shop.catalog` у организации.
    public func storeOverview() async throws -> StoreOverview {
        let response: Envelope<StoreOverview> = try await api.send(
            APIRequest(path: "/api/admin/store/overview")
        )
        return response.data
    }

    /// Витрина выбранной точки. Требует `store-showcase.view`.
    ///
    /// Без `companyID` сервер сам берёт первую доступную точку и возвращает её
    /// идентификатор — переключатель точек строится по тому же ответу.
    public func showcase(companyID: String? = nil) async throws -> ShowcasePage {
        var query: [String: String] = [:]
        if let companyID, !companyID.isEmpty { query["company_id"] = companyID }
        let response: Envelope<ShowcasePage> = try await api.send(
            APIRequest(path: "/api/admin/store/showcase", query: query)
        )
        return response.data
    }

    /// Прогноз запаса: что и через сколько дней закончится.
    /// Требует `store-forecast.view`.
    public func stockForecast(companyID: String? = nil) async throws -> [StockForecastRow] {
        var query: [String: String] = [:]
        if let companyID, !companyID.isEmpty { query["company_id"] = companyID }
        let response: DataList<StockForecastRow> = try await api.send(
            APIRequest(path: "/api/admin/inventory/forecast", query: query)
        )
        return response.items
    }

    /// Номенклатура: что вообще заведено, с ценой и штрихкодом. Остаток здесь —
    /// следствие, а не суть. Требует `store-catalog.view`.
    public func catalogItems(companyID: String? = nil) async throws -> [CatalogItem] {
        var query: [String: String] = [:]
        if let companyID, !companyID.isEmpty { query["company_id"] = companyID }
        let response: DataList<CatalogItem> = try await api.send(
            APIRequest(path: "/api/admin/inventory/catalog", query: query)
        )
        return response.items
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
    ///
    /// `view` обязателен: роут обслуживает три разных представления
    /// (`weekly`, `operatorWeekly`, `operatorDetail`) и без него отвечает
    /// `unsupported-view` 400. Раздел зарплат не открывался вовсе.
    public func salary(weekStart: String) async throws -> SalaryWeekReport {
        let response: Envelope<SalaryWeekReport> = try await api.send(
            APIRequest(
                path: "/api/admin/salary",
                query: ["view": "weekly", "weekStart": weekStart]
            )
        )
        return response.data
    }

    /// Выдать аванс оператору.
    ///
    /// Аванс просят у стойки, посреди смены, — это одно из немногих денежных
    /// действий, которое делают именно с телефона. Сервер сам заводит расход и
    /// корректировку недели: приложению остаётся собрать форму.
    ///
    /// Дата выплаты и неделя — разные вещи: аванс за текущую неделю могут
    /// выдать в понедельник следующей.
    public func createSalaryAdvance(
        operatorID: String,
        companyID: String,
        weekStart: String,
        paymentDate: String,
        cashAmount: Double,
        kaspiAmount: Double,
        comment: String?
    ) async throws {
        var payload: [String: Any] = [
            "operator_id": operatorID,
            "company_id": companyID,
            "week_start": weekStart,
            "payment_date": paymentDate,
            "cash_amount": cashAmount,
            "kaspi_amount": kaspiAmount,
        ]
        if let comment, !comment.isEmpty { payload["comment"] = comment }

        _ = try await api.send(
            APIRequest(
                path: "/api/admin/salary",
                method: .post,
                body: try JSONSerialization.data(
                    withJSONObject: ["action": "createAdvance", "payload": payload]
                )
            )
        )
    }

    /// Корректировка зарплаты: премия или штраф по факту смены.
    ///
    /// Решение о премии принимают в тот же день, когда её заслужили, — иначе
    /// оно тонет в списке недели и до сайта не доходит.
    ///
    /// `kind` — `bonus` или `fine`. Сумму сервер ждёт положительной: знак
    /// задаёт вид, а не минус в поле.
    public func createSalaryAdjustment(
        operatorID: String,
        companyID: String?,
        date: String,
        amount: Double,
        kind: String,
        comment: String?
    ) async throws {
        var payload: [String: Any] = [
            "operator_id": operatorID,
            "date": date,
            "amount": amount,
            "kind": kind,
        ]
        if let companyID, !companyID.isEmpty { payload["company_id"] = companyID }
        if let comment, !comment.isEmpty { payload["comment"] = comment }

        _ = try await api.send(
            APIRequest(
                path: "/api/admin/salary",
                method: .post,
                body: try JSONSerialization.data(
                    withJSONObject: ["action": "createAdjustment", "payload": payload]
                )
            )
        )
    }

    /// Отметить долги оператора за неделю погашенными.
    ///
    /// Долг возвращают наличными у стойки, и до сайта эта запись доезжала
    /// в лучшем случае к вечеру.
    public func markOperatorDebtsPaid(operatorID: String, weekStart: String) async throws {
        _ = try await api.send(
            APIRequest(
                path: "/api/admin/salary",
                method: .post,
                body: try JSONSerialization.data(
                    withJSONObject: [
                        "action": "markDebtsPaid",
                        "operatorId": operatorID,
                        "weekStart": weekStart,
                    ]
                )
            )
        )
    }

    /// Корректировка бонусов клиента.
    ///
    /// Спор на кассе решается на месте: «начислите, у меня не прошло». Идти
    /// ради этого к компьютеру — значит отпустить человека недовольным.
    ///
    /// `delta` со знаком: плюс начисляет, минус списывает. Ноль сервер
    /// отвергает — это не корректировка, а опечатка.
    public func adjustLoyaltyPoints(customerID: String, delta: Int, reason: String?) async throws {
        var payload: [String: Any] = [
            "action": "adjustPoints",
            "customerId": customerID,
            "delta": delta,
        ]
        if let reason, !reason.isEmpty { payload["reason"] = reason }

        _ = try await api.send(
            APIRequest(
                path: "/api/admin/customers",
                method: .post,
                body: try JSONSerialization.data(withJSONObject: payload)
            )
        )
    }

    /// Включить или отключить оператора.
    ///
    /// Человек уволился в середине смены — доступ надо снять сразу, а не
    /// «когда дойду до сайта». Записи и история остаются: это не удаление.
    public func setOperatorActive(operatorID: String, isActive: Bool) async throws {
        _ = try await api.send(
            APIRequest(
                path: "/api/admin/operators",
                method: .post,
                body: try JSONSerialization.data(
                    withJSONObject: [
                        "action": "toggleOperatorActive",
                        "operatorId": operatorID,
                        "is_active": isActive,
                    ]
                )
            )
        )
    }

    /// Заявка на перенос со склада на витрину.
    ///
    /// Товар кончается на полке — это видно, стоя у полки, а не за столом.
    /// Заявку одобряет управляющий, и только тогда остаток уходит со склада:
    /// сервер делает это одной операцией, иначе при обрыве связи товар
    /// пропадал бы из обоих мест.
    public func requestToShowcase(
        companyID: String,
        itemID: String,
        quantity: Double,
        comment: String?
    ) async throws {
        var item: [String: Any] = ["item_id": itemID, "requested_qty": quantity]
        if let comment, !comment.isEmpty { item["comment"] = comment }

        _ = try await api.send(
            APIRequest(
                path: "/api/admin/store/showcase",
                method: .post,
                body: try JSONSerialization.data(
                    withJSONObject: [
                        "action": "createRequest",
                        "company_id": companyID,
                        "items": [item],
                    ]
                )
            )
        )
    }

    /// Возврат с витрины на склад.
    ///
    /// Обратная дорога нужна не реже прямой: товар не пошёл, витрину
    /// перебрали, освободили место под сезонное.
    public func returnFromShowcase(
        companyID: String,
        itemID: String,
        quantity: Double
    ) async throws {
        _ = try await api.send(
            APIRequest(
                path: "/api/admin/store/showcase",
                method: .post,
                body: try JSONSerialization.data(
                    withJSONObject: [
                        "action": "returnToWarehouse",
                        "company_id": companyID,
                        "items": [["item_id": itemID, "quantity": quantity]],
                    ]
                )
            )
        )
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

    /// Аналитика по месяцам года. Требует `analytics.view`.
    ///
    /// Отдельно от `report(from:to:)`: тот считает выбранный период, этот —
    /// год помесячно и прошлый год для сравнения.
    public func monthlyAnalytics(year: Int) async throws -> MonthlyAnalytics {
        let response: Envelope<MonthlyAnalytics> = try await api.send(
            APIRequest(path: "/api/admin/analytics/monthly", query: ["year": String(year)])
        )
        return response.data
    }

    /// Ручные вводы ОПиУ за период. Требует `profitability.view`.
    ///
    /// Границы — `YYYY-MM`: роут сам достраивает их до первого числа месяца.
    public func profitabilityInputs(from: String, to: String) async throws -> [ProfitabilityInput] {
        let response: ProfitabilityInputList = try await api.send(
            APIRequest(path: "/api/admin/profitability", query: ["from": from, "to": to])
        )
        return response.items
    }

    /// Сохранить ручные вводы месяца. Требует `profitability.edit`.
    ///
    /// Сервер перезаписывает строку месяца целиком, поэтому отправлять нужно
    /// весь набор, а не изменённое поле: иначе остальные обнулятся.
    public func saveProfitabilityInput(_ input: ProfitabilityInput) async throws {
        let body = try JSONEncoder().encode(
            ProfitabilitySaveRequest(month: input.month, payload: input)
        )
        _ = try await api.send(
            APIRequest(path: "/api/admin/profitability", method: .post, body: body)
        )
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

    /// Поставить задачу. Требует `tasks.create`.
    public func createTask(_ draft: TaskDraft) async throws {
        let body = try JSONEncoder().encode(TaskCreateRequest(payload: draft.payload()))
        _ = try await api.send(APIRequest(path: "/api/admin/tasks", method: .post, body: body))
    }

    /// Правка задачи. Шлём только изменённые поля: пропущенный ключ сервер
    /// трактует как «не трогать», и правка срока не должна стирать исполнителя.
    public func updateTask(taskID: String, patch: TaskPatch) async throws {
        let body = try JSONEncoder().encode(TaskUpdateRequest(taskID: taskID, payload: patch))
        _ = try await api.send(APIRequest(path: "/api/admin/tasks", method: .post, body: body))
    }

    public func deleteTask(taskID: String) async throws {
        let body = try JSONEncoder().encode(TaskDeleteRequest(taskID: taskID))
        _ = try await api.send(APIRequest(path: "/api/admin/tasks", method: .post, body: body))
    }

    /// Переписка по задаче: вопросы, уточнения, ответы оператора.
    public func taskComments(taskID: String) async throws -> [TaskComment] {
        let response: TaskCommentList = try await api.send(
            APIRequest(path: "/api/admin/tasks", query: ["comments": "1", "taskId": taskID])
        )
        return response.comments
    }

    public func addTaskComment(taskID: String, content: String) async throws {
        let body = try JSONEncoder().encode(TaskCommentRequest(taskID: taskID, content: content))
        _ = try await api.send(APIRequest(path: "/api/admin/tasks", method: .post, body: body))
    }

    /// Перевести задачу в другое состояние. Требует `tasks.complete` для
    /// завершения и `tasks.edit` для остальных переходов — решает сервер.
    public func changeTaskStatus(taskID: String, status: TaskState) async throws {
        let body = try JSONEncoder().encode(
            TaskStatusRequest(taskID: taskID, status: status.rawValue)
        )
        _ = try await api.send(APIRequest(path: "/api/admin/tasks", method: .post, body: body))
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

    /// Завести карточку оператора. Требует `operators.create`.
    public func createOperator(_ draft: OperatorDraft) async throws {
        let body = try JSONEncoder().encode(OperatorCreateRequest(payload: draft.payload()))
        _ = try await api.send(APIRequest(path: "/api/admin/operators", method: .post, body: body))
    }

    /// Завести учётную запись оператору. Требует `operators.create_account`.
    ///
    /// Пароль возвращается открытым ровно один раз и больше нигде не хранится:
    /// его нужно либо показать человеку, либо сразу отправить.
    public func createOperatorAccount(
        operatorID: String,
        username: String,
        name: String
    ) async throws -> OperatorAccount {
        let body = try JSONEncoder().encode(
            OperatorAccountRequest(
                operatorId: operatorID,
                username: username,
                // Почта нужна серверу как признак «завести вход»; настоящий
                // адрес входа он собирает сам из логина.
                email: "\(username)@operator.local",
                name: name
            )
        )
        return try await api.send(
            APIRequest(path: "/api/admin/create-operator-account", method: .post, body: body)
        )
    }

    /// Отправить логин и пароль в Telegram.
    /// Требует `operators.send_credentials_telegram`.
    public func sendOperatorCredentials(
        operatorID: String,
        chatID: String,
        username: String,
        password: String,
        name: String
    ) async throws {
        let body = try JSONEncoder().encode(
            OperatorCredentialsRequest(
                operatorId: operatorID,
                chatId: chatID,
                username: username,
                password: password,
                name: name
            )
        )
        _ = try await api.send(
            APIRequest(path: "/api/admin/send-operator-credentials", method: .post, body: body)
        )
    }

    /// Провести приёмку от поставщика. Требует `store-receipts.create`.
    public func createReceipt(_ draft: ReceiptDraft, companyID: String?) async throws {
        let body = try JSONEncoder().encode(
            ReceiptCreateRequest(payload: draft.payload(), companyID: companyID)
        )
        _ = try await api.send(
            APIRequest(path: "/api/admin/store/receipts", method: .post, body: body)
        )
    }

    /// Провести ревизию. Требует `store-revisions.commit`.
    public func createStocktake(_ draft: StocktakeDraft, companyID: String?) async throws {
        let body = try JSONEncoder().encode(
            StocktakeCreateRequest(payload: draft.payload(), companyID: companyID)
        )
        _ = try await api.send(
            APIRequest(path: "/api/admin/store/revisions", method: .post, body: body)
        )
    }

    /// Создать акт списания. Требует `store-writeoffs.create`.
    public func createWriteoff(_ draft: WriteoffDraft, companyID: String?) async throws {
        let body = try JSONEncoder().encode(
            WriteoffCreateRequest(payload: draft.payload(), companyID: companyID)
        )
        _ = try await api.send(
            APIRequest(path: "/api/admin/store/writeoffs", method: .post, body: body)
        )
    }

    /// Решение по заявке склада: одобрить или отклонить.
    ///
    /// Сервер делает это одной атомарной функцией — минусует со склада и
    /// плюсует на витрину, — поэтому решение нельзя разложить на два запроса.
    /// Требует `store-requests.approve` либо `store-requests.reject`.
    public func decideStockRequest(id: String, approved: Bool, comment: String? = nil) async throws {
        let body = try JSONEncoder().encode(
            StockRequestDecision(requestID: id, approved: approved, comment: comment)
        )
        _ = try await api.send(
            APIRequest(path: "/api/admin/inventory/requests", method: .post, body: body)
        )
    }

    /// Зарегистрировать инцидент. Требует `incidents.create`.
    public func createIncident(_ draft: IncidentDraft) async throws {
        let body = try JSONEncoder().encode(draft.payload())
        _ = try await api.send(APIRequest(path: "/api/admin/incidents", method: .post, body: body))
    }

    /// Решение по инциденту: подтвердить, оспорить, отменить.
    /// Требует `incidents.update`.
    public func setIncidentStatus(id: String, status: IncidentStatus) async throws {
        let body = try JSONEncoder().encode(IncidentStatusChange(status: status.rawValue))
        _ = try await api.send(
            APIRequest(path: "/api/admin/incidents/\(id)", method: .patch, body: body)
        )
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
