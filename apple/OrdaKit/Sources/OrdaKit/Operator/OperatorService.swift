import Foundation

/// Операторский контур `/api/operator/*`.
///
/// Отдельный от админского: оператор работает по своей сессии и никогда не
/// ходит в `/api/admin/*`. Это тот же серверный контур, что и у десктопной
/// программы кассира — «разница только транспорт», поэтому смена, чеки и
/// остатки везде одни и те же.
public struct OperatorService: Sendable {
    private let api: APIClient
    /// Очередь отложенных действий. Без неё сервис работает как раньше —
    /// нужен, чтобы превью и тесты не тащили за собой файл на диске.
    private let outbox: ActionOutbox?

    public init(api: APIClient, outbox: ActionOutbox? = nil) {
        self.api = api
        self.outbox = outbox
    }

    /// Выполнить идемпотентное действие: сразу или отложив до появления сети.
    ///
    /// Возвращает `true`, если ушло на сервер. `false` — легло в очередь, и
    /// экран обязан сказать об этом словами: молчаливое «сделано» при
    /// оборванной связи хуже честной ошибки.
    @discardableResult
    private func deferrable(
        path: String,
        method: HTTPMethod,
        body: Data,
        title: String,
        mergeKey: String
    ) async throws -> Bool {
        guard let outbox else {
            _ = try await api.send(APIRequest(path: path, method: method, body: body))
            return true
        }
        return try await outbox.perform(
            ActionOutbox.Item(
                path: path,
                method: method.rawValue,
                body: body,
                title: title,
                mergeKey: mergeKey
            )
        )
    }

    // ── Смена ────────────────────────────────────────────────────────────────

    public func currentShift() async throws -> ShiftState {
        try await api.send(APIRequest(path: "/api/operator/shift/current"))
    }

    /// Открыть смену. Сервер проверит, стоит ли оператор в графике на сегодня.
    public func openShift(
        openingCash: Double,
        shiftType: ShiftKind,
        notes: String? = nil
    ) async throws -> ShiftOpenResult {
        var body: [String: Any] = [
            "opening_cash": openingCash,
            "shift_type": shiftType.rawValue,
        ]
        if let notes, !notes.isEmpty { body["opening_notes"] = notes }

        return try await api.send(
            APIRequest(
                path: "/api/operator/shift/open",
                method: .post,
                body: try JSONSerialization.data(withJSONObject: body)
            )
        )
    }

    /// Закрыть смену. Не пройдёт, пока не завершены обязательные чек-листы.
    public func closeShift(
        closingCash: Double,
        closingKaspi: Double,
        kaspiBeforeMidnight: Double = 0,
        kaspiAfterMidnight: Double = 0,
        notes: String? = nil
    ) async throws -> ShiftCloseResult {
        var body: [String: Any] = [
            "closing_cash": closingCash,
            "closing_kaspi": closingKaspi,
            "kaspi_before_midnight": kaspiBeforeMidnight,
            "kaspi_after_midnight": kaspiAfterMidnight,
        ]
        if let notes, !notes.isEmpty { body["closing_notes"] = notes }

        return try await api.send(
            APIRequest(
                path: "/api/operator/shift/close",
                method: .post,
                body: try JSONSerialization.data(withJSONObject: body)
            )
        )
    }

    /// Передать смену сменщику.
    public func handoverShift(toOperatorID: String, notes: String? = nil) async throws {
        var body: [String: Any] = ["to_operator_id": toOperatorID]
        if let notes, !notes.isEmpty { body["notes"] = notes }

        _ = try await api.send(
            APIRequest(
                path: "/api/operator/shift/handover",
                method: .post,
                body: try JSONSerialization.data(withJSONObject: body)
            )
        )
    }

    // ── Продажа ──────────────────────────────────────────────────────────────

    public func saleCatalog() async throws -> SaleCatalog {
        try await api.send(APIRequest(path: "/api/operator/inventory-sales"))
    }

    /// Провести продажу. Идемпотентна по `local_ref`: повтор после обрыва сети
    /// вернёт уже созданный чек, а не создаст второй.
    public func createSale(_ draft: SaleDraft) async throws -> SaleResult {
        try await api.send(
            APIRequest(
                path: "/api/operator/inventory-sales",
                method: .post,
                body: try JSONSerialization.data(withJSONObject: draft.requestBody())
            )
        )
    }

    // ── Ревизия ──────────────────────────────────────────────────────────────

    /// Открытые акты, на которые назначен этот оператор.
    public func auditActs() async throws -> [AuditAct] {
        let response: AuditActList = try await api.send(APIRequest(path: "/api/operator/audit"))
        return response.acts
    }

    /// Позиции моей секции в акте.
    public func auditSheet(actID: String) async throws -> AuditSheet {
        try await api.send(APIRequest(path: "/api/operator/audit", query: ["act": actID]))
    }

    /// Сохранить подсчёты. Отправляем пачкой: по одному запросу на позицию
    /// ревизия на 800 наименований превратилась бы в 800 запросов.
    @discardableResult
    public func saveAuditCounts(actID: String, counts: [AuditCount]) async throws -> AuditSaveResult {
        let body: [String: Any] = [
            "act_id": actID,
            "counts": counts.map { ["item_id": $0.itemID, "counted_qty": $0.countedQuantity] },
        ]
        return try await api.send(
            APIRequest(
                path: "/api/operator/audit",
                method: .post,
                body: try JSONSerialization.data(withJSONObject: body)
            )
        )
    }

    // ── Кабинет ──────────────────────────────────────────────────────────────

    /// Сводка дня: неделя по зарплате, счётчики, ближайшая смена, задачи, долги.
    public func overview() async throws -> OperatorOverview {
        try await api.send(APIRequest(path: "/api/operator/overview"))
    }

    public func tasks() async throws -> [OperatorTask] {
        let response: OperatorTaskList = try await api.send(APIRequest(path: "/api/operator/tasks"))
        return response.tasks
    }

    /// Ответ оператора по задаче.
    ///
    /// Сервер принимает не «статус», а ответ человека: принял, нужны
    /// уточнения, не могу выполнить, уже сделано, завершил. Статус он выводит
    /// сам и заодно пишет комментарий в историю задачи — чтобы потом было
    /// видно, кто и когда что сказал. Приложение слало «updateStatus», и
    /// сервер честно отвечал «Неизвестное действие».
    @discardableResult
    public func respondToTask(id: String, response: TaskResponse, note: String? = nil) async throws -> Bool {
        var body: [String: Any] = ["action": "respondTask", "taskId": id, "response": response.rawValue]
        if let note, !note.isEmpty { body["note"] = note }
        // Ответ на задачу — установка статуса: повтор приводит к тому же
        // результату, поэтому его можно отложить до сети.
        return try await deferrable(
            path: "/api/operator/tasks",
            method: .post,
            body: try JSONSerialization.data(withJSONObject: body),
            title: "Ответ на задачу",
            mergeKey: "task:\(id)"
        )
    }

    public func addTaskComment(taskID: String, content: String) async throws {
        let body: [String: Any] = ["action": "addComment", "taskId": taskID, "content": content]
        _ = try await api.send(
            APIRequest(
                path: "/api/operator/tasks",
                method: .post,
                body: try JSONSerialization.data(withJSONObject: body)
            )
        )
    }

    /// Отчёт смены: создаёт доход за смену.
    ///
    /// Закрытие смены фиксирует пересчёт кассы, а выручка дня берётся отсюда.
    /// Из приложения смену можно было закрыть, но доход за неё никуда не
    /// записывался — в ОПиУ и в зарплате её просто не было.
    public func sendShiftReport(_ report: ShiftReportDraft) async throws {
        _ = try await api.send(
            APIRequest(
                path: "/api/operator/shift-report",
                method: .post,
                body: try JSONEncoder().encode(report)
            )
        )
    }

    /// Мой расчёт за неделю. Пусто — текущая.
    ///
    /// «Сколько я заработала в прошлом месяце» посмотреть было негде: экран
    /// всегда показывал текущую неделю, и прошлые расчёты человек знал только
    /// по выпискам.
    public func salary(weekStart: String? = nil) async throws -> OperatorSalary {
        var query: [String: String] = [:]
        if let weekStart, !weekStart.isEmpty { query["weekStart"] = weekStart }
        return try await api.send(APIRequest(path: "/api/operator/salary", query: query))
    }

    public func schedule() async throws -> OperatorSchedule {
        try await api.send(APIRequest(path: "/api/operator/shifts"))
    }

    public func incidents() async throws -> [OperatorIncident] {
        let response: OperatorIncidentList = try await api.send(APIRequest(path: "/api/operator/incidents"))
        return response.incidents
    }

    // ── Знания и чек-листы ───────────────────────────────────────────────────

    /// Статьи, чек-листы, их пункты и запуски — одним запросом.
    public func knowledge() async throws -> KnowledgeCenter {
        try await api.send(APIRequest(path: "/api/operator/knowledge"))
    }

    /// Подтвердить прочтение статьи. Версию передаём обязательно: подтверждение
    /// привязано к версии, иначе правка текста осталась бы незамеченной.
    @discardableResult
    public func confirmArticle(id: String, version: Int) async throws -> Bool {
        let body: [String: Any] = ["article_id": id, "version": version]
        return try await deferrable(
            path: "/api/operator/knowledge/confirm",
            method: .post,
            body: try JSONSerialization.data(withJSONObject: body),
            title: "Подтверждение прочтения",
            mergeKey: "knowledge:\(id):\(version)"
        )
    }

    /// Запустить чек-лист в текущей смене. Без открытой смены сервер ответит 409.
    public func startChecklist(templateID: String) async throws -> ChecklistRunStart {
        let body: [String: Any] = ["template_id": templateID]
        return try await api.send(
            APIRequest(
                path: "/api/operator/checklist/run",
                method: .post,
                body: try JSONSerialization.data(withJSONObject: body)
            )
        )
    }

    /// Сохранить ответы. Отправляем целиком, а не по одному: так прогресс
    /// переживает выход из приложения посреди чек-листа.
    @discardableResult
    public func saveChecklistAnswers(runID: String, answers: [ChecklistAnswer]) async throws -> Bool {
        let body: [String: Any] = ["answers": answers.map { $0.requestPayload() }]
        // Ответы шлём целиком, поэтому повтор просто перезаписывает их теми
        // же значениями. По этой же причине в очереди хватает одной записи на
        // запуск — новая заменяет прежнюю.
        return try await deferrable(
            path: "/api/operator/checklist/run/\(runID)",
            method: .patch,
            body: try JSONSerialization.data(withJSONObject: body),
            title: "Ответы чек-листа",
            mergeKey: "checklist:\(runID)"
        )
    }

    /// Завершить чек-лист. В ответ приходят начисленные штрафы и бонусы.
    public func completeChecklist(runID: String) async throws -> ChecklistRunResult {
        try await api.send(
            APIRequest(
                path: "/api/operator/checklist/run/\(runID)/complete",
                method: .post,
                body: try JSONSerialization.data(withJSONObject: ["status": "completed"])
            )
        )
    }
}

// ── Ошибки операторского контура ─────────────────────────────────────────────

extension APIError {
    /// Понятная причина отказа в операторских сценариях.
    ///
    /// Сервер отвечает кодами вроде `not-on-schedule` или
    /// `point-shift-required-checklists-missing`. Показывать их кассиру нельзя —
    /// переводим в объяснение, из которого понятно, что делать.
    public var operatorMessage: String {
        switch self {
        case let .conflict(code, message):
            switch code {
            case "point-shift-no-open":
                return "Сначала откройте смену — без неё продавать нельзя."
            case "point-shift-already-open":
                return "На точке уже открыта смена."
            case "point-shift-required-checklists-missing":
                return "Перед закрытием завершите обязательные чек-листы."
            case "act-not-open":
                return "Акт ревизии уже закрыт."
            default:
                return message.isEmpty ? "Действие сейчас невозможно." : message
            }

        case let .forbidden(_, _, message):
            // Отказы графика и чужой смены приходят с 403 и уже содержат
            // человеческий текст от сервера — он точнее общей формулировки.
            return message.isEmpty ? userMessage : message

        case let .badRequest(code, message):
            if code == "opening-cash-required" {
                return "Перед открытием смены укажите, сколько денег в кассе."
            }
            return message.isEmpty ? userMessage : message

        default:
            return userMessage
        }
    }
}
