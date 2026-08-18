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
    ///
    /// `nil` в ответе значит «легло в очередь»: связи нет, но пересчёт уже
    /// сделан. Ревизию считают на складе, где сети не бывает, и терять час
    /// работы из-за этого нельзя.
    ///
    /// Пачка всегда полная — всё, что посчитано в этом заходе, — поэтому в
    /// очереди она заменяет предыдущую по тому же акту: последняя версия
    /// вернее прежней, а не дополняет её.
    @discardableResult
    public func saveAuditCounts(actID: String, counts: [AuditCount]) async throws -> AuditSaveResult? {
        let body: [String: Any] = [
            "act_id": actID,
            "counts": counts.map { ["item_id": $0.itemID, "counted_qty": $0.countedQuantity] },
        ]
        let data = try JSONSerialization.data(withJSONObject: body)

        guard let outbox else {
            return try await api.send(
                APIRequest(path: "/api/operator/audit", method: .post, body: data)
            )
        }

        do {
            return try await api.send(
                APIRequest(path: "/api/operator/audit", method: .post, body: data)
            )
        } catch let error as APIError {
            // Только связь. Отказ по существу — закрытый акт, чужая секция —
            // повторять бессмысленно, и очередь его не спасёт.
            guard case .transport = error else { throw error }

            _ = try await outbox.perform(
                ActionOutbox.Item(
                    path: "/api/operator/audit",
                    method: HTTPMethod.post.rawValue,
                    body: data,
                    title: "Подсчёты ревизии",
                    mergeKey: "audit:\(actID)"
                )
            )
            return nil
        }
    }

    // ── Кабинет ──────────────────────────────────────────────────────────────

    /// Сводка дня: неделя по зарплате, счётчики, ближайшая смена, задачи, долги.
    /// Сводка из кэша — то, что человек видел в прошлый раз.
    ///
    /// Экран показывает её мгновенно и тут же обновляется. Ждать сеть, чтобы
    /// нарисовать вчерашние цифры, незачем: они те же самые.
    public func cachedOverview() async -> OperatorOverview? {
        await api.cached(APIRequest(path: "/api/operator/overview"))
    }

    public func overview() async throws -> OperatorOverview {
        try await api.send(APIRequest(path: "/api/operator/overview"))
    }

    public func cachedTasks() async -> [OperatorTask]? {
        let response: OperatorTaskList? = await api.cached(APIRequest(path: "/api/operator/tasks"))
        return response?.tasks
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

    /// Мой график. Пусто — текущая неделя.
    public func schedule(weekStart: String? = nil) async throws -> OperatorSchedule {
        var query: [String: String] = [:]
        if let weekStart, !weekStart.isEmpty { query["weekStart"] = weekStart }
        return try await api.send(APIRequest(path: "/api/operator/shifts", query: query))
    }

    /// Подтвердить, что видел график недели и выходишь.
    ///
    /// Без подтверждения «я не знал про смену» перестаёт быть отговоркой: у
    /// руководителя видно, кто принял неделю, а кто ещё нет.
    public func confirmScheduleWeek(responseID: String) async throws {
        _ = try await api.send(
            APIRequest(
                path: "/api/operator/shifts",
                method: .post,
                body: try JSONSerialization.data(
                    withJSONObject: ["action": "confirmWeek", "responseId": responseID]
                )
            )
        )
    }

    /// Сказать, что на смену выйти не получится.
    ///
    /// Это не отказ и не самовольная замена: заявка уходит руководителю, а
    /// решение и подмену он принимает сам. Молча не выйти — хуже для всех.
    public func reportShiftIssue(
        responseID: String,
        shiftDate: String,
        shiftType: String,
        reason: String
    ) async throws {
        _ = try await api.send(
            APIRequest(
                path: "/api/operator/shifts",
                method: .post,
                body: try JSONSerialization.data(
                    withJSONObject: [
                        "action": "reportIssue",
                        "responseId": responseID,
                        "shiftDate": shiftDate,
                        "shiftType": shiftType,
                        "reason": reason,
                    ]
                )
            )
        )
    }

    // ── Зал клуба ────────────────────────────────────────────────────────────

    /// Зал: станции, тарифы и активные сессии.
    public func arena() async throws -> ArenaHall {
        let response: DataEnvelope<ArenaHall> = try await api.send(APIRequest(path: "/api/operator/arena"))
        return response.data
    }

    /// Посадить гостя за станцию.
    ///
    /// Суммы передаём раздельно: смешанная оплата — обычное дело, и сервер
    /// разносит наличные и Kaspi по разным строкам кассы.
    public func startArenaSession(
        stationID: String,
        tariffID: String,
        payment: ArenaPayment,
        cash: Double,
        kaspi: Double,
        discountPercent: Double = 0
    ) async throws {
        try await arenaAction([
            "action": "startSession",
            "stationId": stationID,
            "tariffId": tariffID,
            "payment_method": payment.rawValue,
            "cash_amount": cash,
            "kaspi_amount": kaspi,
            "discount_percent": discountPercent,
        ])
    }

    /// Завершить сессию: гость ушёл.
    public func endArenaSession(sessionID: String) async throws {
        try await arenaAction(["action": "endSession", "sessionId": sessionID])
    }

    /// Завершить с возвратом за неиспользованное время.
    ///
    /// Долю считает сервер: делить деньги на глазок у стойки — то, из-за чего
    /// потом не сходится смена.
    public func refundArenaSession(sessionID: String) async throws {
        try await arenaAction(["action": "endSessionWithRefund", "sessionId": sessionID])
    }

    /// Продлить пакетом тарифа.
    public func extendArenaSession(
        sessionID: String,
        tariffID: String,
        payment: ArenaPayment,
        cash: Double,
        kaspi: Double
    ) async throws {
        try await arenaAction([
            "action": "extendSession",
            "sessionId": sessionID,
            "tariffId": tariffID,
            "payment_method": payment.rawValue,
            "cash_amount": cash,
            "kaspi_amount": kaspi,
        ])
    }

    /// Продлить на сумму: «добавь на тысячу». Минуты сервер считает сам по
    /// цене часа — так же, как это делает программа за стойкой.
    public func extendArenaSessionByAmount(
        sessionID: String,
        payment: ArenaPayment,
        cash: Double,
        kaspi: Double
    ) async throws {
        try await arenaAction([
            "action": "extendSession",
            "sessionId": sessionID,
            "amount_extension": true,
            "payment_method": payment.rawValue,
            "cash_amount": cash,
            "kaspi_amount": kaspi,
        ])
    }

    /// Техническая заметка по станции: не работает мышь, сгорел монитор.
    public func logArenaTech(
        stationID: String?,
        stationName: String?,
        reason: String,
        amount: Double
    ) async throws {
        var body: [String: Any] = ["action": "techLog", "reason": reason, "amount": amount]
        if let stationID { body["stationId"] = stationID }
        if let stationName { body["stationName"] = stationName }
        try await arenaAction(body)
    }

    private func arenaAction(_ body: [String: Any]) async throws {
        _ = try await api.send(
            APIRequest(
                path: "/api/operator/arena",
                method: .post,
                body: try JSONSerialization.data(withJSONObject: body)
            )
        )
    }

    /// «Объясни проще» по статье регламента.
    ///
    /// Регламент пишет владелец, а читает оператор в свою первую смену:
    /// «материальная ответственность за недостачу» ему ничего не говорит.
    /// Сервер пересказывает тот же текст простыми словами и отвечает строго по
    /// статье — придуманный порядок действий хуже непонятного.
    public func explainArticle(id: String, question: String? = nil) async throws -> String {
        var body: [String: Any] = ["article_id": id]
        if let question, !question.isEmpty { body["question"] = question }

        let response: ExplainResponse = try await api.send(
            APIRequest(
                path: "/api/operator/knowledge/explain",
                method: .post,
                body: try JSONSerialization.data(withJSONObject: body)
            )
        )
        return response.answer
    }

    // ── Старший смены ────────────────────────────────────────────────────────

    /// Стол старшего. 403 значит «этот человек не старший» — не ошибка, а факт,
    /// и экран должен просто не появляться.
    public func leadDesk() async throws -> LeadDesk {
        try await api.send(APIRequest(path: "/api/operator/lead"))
    }

    /// Предложение старшего по заявке: оставить, снять или заменить.
    ///
    /// Именно предложение: последнее слово за руководителем. Старший ближе к
    /// точке и знает, кто отработал две ночи подряд, — но подписывает не он.
    public func submitLeadProposal(
        requestID: String,
        action: String,
        note: String? = nil,
        replacementOperatorID: String? = nil
    ) async throws {
        var body: [String: Any] = [
            "action": "submitLeadProposal",
            "requestId": requestID,
            "proposalAction": action,
        ]
        if let note, !note.isEmpty { body["proposalNote"] = note }
        if let replacementOperatorID, !replacementOperatorID.isEmpty {
            body["replacementOperatorId"] = replacementOperatorID
        }

        _ = try await api.send(
            APIRequest(
                path: "/api/operator/lead",
                method: .post,
                body: try JSONSerialization.data(withJSONObject: body)
            )
        )
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
                return message.isEmpty ? "Действие сейчас невозможно." : APIError.withoutRoute(message)
            }

        case let .forbidden(_, _, message):
            // Отказы графика и чужой смены приходят с 403 и уже содержат
            // человеческий текст от сервера — он точнее общей формулировки.
            return message.isEmpty ? userMessage : APIError.withoutRoute(message)

        case let .badRequest(code, message):
            if code == "opening-cash-required" {
                return "Перед открытием смены укажите, сколько денег в кассе."
            }
            return message.isEmpty ? userMessage : APIError.withoutRoute(message)

        default:
            return userMessage
        }
    }
}
