import Foundation
import OrdaKit
import SwiftUI

/// Состояние остальных разделов кабинета: обзор, задачи, зарплата, график,
/// знания с чек-листами, инциденты.
///
/// Отдельно от `OperatorStore` намеренно: там живёт смена, корзина и очередь
/// продаж — то, что меняется каждую секунду и должно быть одно на приложение.
/// Здесь — справочные разделы, которые грузятся по мере открытия вкладок.
@MainActor
@Observable
final class CabinetStore {
    // ── Обзор ────────────────────────────────────────────────────────────────

    private(set) var overview: OperatorOverview?
    private(set) var isLoadingOverview = false

    // ── Задачи ───────────────────────────────────────────────────────────────

    private(set) var tasks: [OperatorTask] = []
    private(set) var isLoadingTasks = false

    var activeTasks: [OperatorTask] { tasks.filter { !$0.isDone } }
    var overdueCount: Int { tasks.filter(\.isOverdue).count }

    // ── Деньги ───────────────────────────────────────────────────────────────

    private(set) var salary: OperatorSalary?
    private(set) var incidents: [OperatorIncident] = []

    // ── График ───────────────────────────────────────────────────────────────

    private(set) var schedule: OperatorSchedule?

    // ── Знания и чек-листы ───────────────────────────────────────────────────

    private(set) var knowledge: KnowledgeCenter?
    private(set) var isLoadingKnowledge = false

    /// Незавершённые обязательные чек-листы — их же показывает экран смены.
    var pendingChecklists: [ChecklistTemplate] {
        guard let knowledge else { return [] }
        return knowledge.templates.filter { template in
            template.scheduleType != "onboarding" && knowledge.completedRun(for: template.id) == nil
        }
    }

    var pendingArticles: [KnowledgeArticle] {
        knowledge?.pendingConfirmations ?? []
    }

    // ── Общение ──────────────────────────────────────────────────────────────

    /// Непрочитанные личные сообщения — для значка на вкладке.
    ///
    /// Оператор смотрит в приложение между клиентами, а не сидит в нём: без
    /// значка сообщение от управляющего он увидит в конце смены, когда оно уже
    /// не нужно.
    private(set) var unreadMessages = 0

    /// Сколько экзаменов ждут сдачи.
    private(set) var openExams = 0

    // ── Общее ────────────────────────────────────────────────────────────────

    private(set) var error: String?

    /// Действие легло в очередь вместо отправки.
    ///
    /// Молчаливое «сделано» при оборванной связи хуже честной ошибки: человек
    /// уходит со смены уверенным, что чек-лист засчитан. Поэтому очередь
    /// говорит о себе вслух.
    var deferredNotice: String?

    private static let offlineNotice = "Связи нет — сохранено на устройстве и уйдёт само, как появится сеть."

    private let service: OperatorService
    private let feed: FeedService
    private let exams: ExamService

    init(api: APIClient, outbox: ActionOutbox) {
        self.service = OperatorService(api: api, outbox: outbox)
        self.feed = FeedService(api: api)
        self.exams = ExamService(api: api)
    }

    /// Тихо: у оператора может не быть организации (не назначен на точку), и
    /// ошибка счётчика не должна мешать смене.
    func refreshUnreadMessages() async {
        guard let list = try? await feed.threads() else { return }
        unreadMessages = list.unreadTotal
    }

    /// Тоже тихо: экзаменов может не быть вовсе, и молчаливый ноль здесь
    /// честнее ошибки на весь экран смены.
    func refreshExams() async {
        guard let list = try? await exams.exams() else { return }
        openExams = list.filter(\.isOpen).count
    }

    // ── Загрузка ─────────────────────────────────────────────────────────────

    /// Первое наполнение: обзор и задачи нужны сразу, остальное — лениво.
    func bootstrap() async {
        async let overviewTask: Void = loadOverview()
        async let tasksTask: Void = loadTasks()
        async let unreadTask: Void = refreshUnreadMessages()
        async let examsTask: Void = refreshExams()
        _ = await (overviewTask, tasksTask, unreadTask, examsTask)
    }

    func loadOverview() async {
        // Экран смены открывается на вчерашних цифрах и обновляется через
        // мгновение. Пустой экран со скелетом при каждом запуске — то, из-за
        // чего приложение кажется медленнее, чем оно есть.
        if overview == nil, let cached = await service.cachedOverview() {
            overview = cached
        }

        isLoadingOverview = overview == nil
        defer { isLoadingOverview = false }
        do {
            overview = try await service.overview()
            error = nil
            if !didProbeLead {
                didProbeLead = true
                Task { await loadLeadDesk() }
            }
        } catch let apiError as APIError {
            error = apiError.operatorMessage
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Загрузка, которая не должна ронять экран, но и не должна молчать.
    ///
    /// Здесь стояло `try?`: отказ сервера — нет права, устаревшая сборка,
    /// сломанный запрос — превращался в пустой экран без единого слова. Человек
    /// видел «ничего нет» и не мог отличить это от «сервер отказал», а сказать,
    /// что именно не работает, было нечем.
    ///
    /// Старые данные при отказе остаются на месте — это по-прежнему важнее
    /// пустоты, — но причина теперь доходит до экрана.
    private func attempt<T>(_ work: () async throws -> T) async -> T? {
        do {
            let value = try await work()
            error = nil
            return value
        } catch let apiError as APIError {
            error = apiError.operatorMessage
            return nil
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }

    func loadTasks() async {
        isLoadingTasks = true
        defer { isLoadingTasks = false }
        tasks = await attempt { try await service.tasks() } ?? tasks
    }

    /// Какую неделю смотрим. Понедельник, «2026-08-17».
    var salaryWeek: String = CabinetStore.currentWeekStart() {
        didSet {
            guard salaryWeek != oldValue else { return }
            Task { await loadSalary() }
        }
    }

    /// Начало текущей недели — понедельник, как считает сервер.
    static func currentWeekStart(from date: Date = Date()) -> String {
        var calendar = Calendar(identifier: .iso8601)
        calendar.timeZone = .current
        let start = calendar.dateInterval(of: .weekOfYear, for: date)?.start ?? date
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: start)
    }

    /// Сдвинуть неделю: минус — назад.
    func shiftSalaryWeek(by weeks: Int) {
        guard let current = DateParsing.parseDateOnly(salaryWeek) else { return }
        let moved = current.addingTimeInterval(Double(weeks) * 7 * 86_400)
        // Вперёд дальше текущей недели ходить некуда: там ещё не работали.
        let next = CabinetStore.currentWeekStart(from: moved)
        guard next <= CabinetStore.currentWeekStart() else { return }
        salaryWeek = next
    }

    func loadSalary() async {
        salary = await attempt { try await service.salary(weekStart: salaryWeek) } ?? salary
    }

    /// Какую неделю графика смотрим.
    var scheduleWeek: String = CabinetStore.currentWeekStart() {
        didSet {
            guard scheduleWeek != oldValue else { return }
            Task { await loadSchedule() }
        }
    }

    /// Шаг по неделям графика. Вперёд ходить можно: график публикуют заранее.
    func shiftScheduleWeek(by weeks: Int) {
        guard let current = DateParsing.parseDateOnly(scheduleWeek) else { return }
        let moved = current.addingTimeInterval(Double(weeks) * 7 * 86_400)
        scheduleWeek = CabinetStore.currentWeekStart(from: moved)
    }

    func loadSchedule() async {
        schedule = await attempt { try await service.schedule(weekStart: scheduleWeek) } ?? schedule
    }

    /// Объяснение правила или текст ошибки — одним значением, чтобы экран не
    /// гадал, что показывать при пустом ответе.
    enum Explanation {
        case answer(String)
        case failure(String)
    }

    /// «Объясни проще».
    func explainArticle(id: String, question: String?) async -> Explanation {
        do {
            return .answer(try await service.explainArticle(id: id, question: question))
        } catch let error as APIError {
            return .failure(error.operatorMessage)
        } catch {
            return .failure(error.localizedDescription)
        }
    }

    // ── Старший смены ────────────────────────────────────────────────────────

    /// Стол старшего. `nil` — человек не старший, и раздела для него нет.
    private(set) var leadDesk: LeadDesk?

    /// Старшинство не меняется по ходу дня, и спрашивать о нём при каждом
    /// обновлении экрана — лишний запрос, который у большинства вернёт отказ.
    private var didProbeLead = false

    var isLead: Bool { leadDesk != nil }

    /// Сколько заявок ждёт именно его решения — число для значка в меню.
    var leadPendingCount: Int { leadDesk?.awaitingProposal.count ?? 0 }

    /// Молча: отказ здесь означает «не старший», и жаловаться не на что.
    func loadLeadDesk() async {
        leadDesk = await attempt { try await service.leadDesk() } ?? leadDesk
    }

    func submitLeadProposal(
        requestID: String,
        action: String,
        note: String?,
        replacementOperatorID: String?
    ) async -> String? {
        do {
            try await service.submitLeadProposal(
                requestID: requestID,
                action: action,
                note: note,
                replacementOperatorID: replacementOperatorID
            )
            await loadLeadDesk()
            return nil
        } catch let error as APIError {
            return error.operatorMessage
        } catch {
            return error.localizedDescription
        }
    }

    /// Подтвердить неделю. Возвращает текст ошибки, если не вышло.
    func confirmScheduleWeek(responseID: String) async -> String? {
        do {
            try await service.confirmScheduleWeek(responseID: responseID)
            await loadSchedule()
            return nil
        } catch let error as APIError {
            return error.operatorMessage
        } catch {
            return error.localizedDescription
        }
    }

    /// Сообщить, что не получится выйти.
    func reportShiftIssue(
        responseID: String,
        shiftDate: String,
        shiftType: String,
        reason: String
    ) async -> String? {
        do {
            try await service.reportShiftIssue(
                responseID: responseID,
                shiftDate: shiftDate,
                shiftType: shiftType,
                reason: reason
            )
            await loadSchedule()
            return nil
        } catch let error as APIError {
            return error.operatorMessage
        } catch {
            return error.localizedDescription
        }
    }

    func loadIncidents() async {
        incidents = await attempt { try await service.incidents() } ?? incidents
    }

    func loadKnowledge() async {
        isLoadingKnowledge = true
        defer { isLoadingKnowledge = false }
        do {
            knowledge = try await service.knowledge()
        } catch let apiError as APIError {
            error = apiError.operatorMessage
        } catch {
            self.error = error.localizedDescription
        }
    }

    // ── Действия ─────────────────────────────────────────────────────────────

    /// Ответ по задаче.
    ///
    /// Оператор не закрывает задачу сам — «выполнено» ставит руководитель.
    /// Остальные ответы («принял», «нужны уточнения», «не могу») тоже нужны:
    /// без них единственным способом сказать «не получится» был звонок.
    func respondToTask(_ task: OperatorTask, response: TaskResponse, note: String? = nil) async -> String? {
        do {
            let sent = try await service.respondToTask(id: task.id, response: response, note: note)
            deferredNotice = sent ? nil : Self.offlineNotice
            await loadTasks()
            await loadOverview()
            return nil
        } catch let apiError as APIError {
            return apiError.operatorMessage
        } catch {
            return error.localizedDescription
        }
    }

    func completeTask(_ task: OperatorTask) async -> String? {
        await respondToTask(task, response: .alreadyDone)
    }

    func confirmArticle(_ article: KnowledgeArticle) async -> String? {
        do {
            let sent = try await service.confirmArticle(id: article.id, version: article.version)
            deferredNotice = sent ? nil : Self.offlineNotice
            await loadKnowledge()
            return nil
        } catch let apiError as APIError {
            return apiError.operatorMessage
        } catch {
            return error.localizedDescription
        }
    }

    // ── Чек-листы ────────────────────────────────────────────────────────────

    /// Чек-листы, пройденные без связи.
    private let checklistOutbox = ChecklistOutbox()
    /// Файлы, не ушедшие из-за связи. Та же очередь, что у чатов: файл на
    /// диске один, и профиль должен показывать именно его, а не свою копию.
    private let attachmentOutbox = AttachmentOutbox()

    private(set) var undeliveredFiles: [AttachmentOutbox.Item] = []

    /// Кто вошёл: чужая работа не должна уйти под его именем.
    func setQueueOwner(_ userID: String?) async {
        await checklistOutbox.setOwner(userID)
        await attachmentOutbox.setOwner(userID)
        await refreshUndeliveredChecklists()
        await refreshUndeliveredFiles()
    }

    func refreshUndeliveredFiles() async {
        undeliveredFiles = await attachmentOutbox.pending()
    }

    /// Отправить всё отложенное этим человеком: чек-листы и файлы.
    ///
    /// Чеки и действия смены живут в хранилище смены — их шлёт оно.
    @discardableResult
    func flushEverything() async -> Int {
        var sent = await flushChecklists()
        sent += await attachmentOutbox.flush(using: feed)
        await refreshUndeliveredFiles()
        return sent
    }

    /// Пройденные, но не отправленные: строка «ждёт связи» на экране.
    ///
    /// Имя не `pendingChecklists` намеренно — так называются ещё не
    /// пройденные шаблоны, и спутать «не сделан» с «сделан, но не ушёл» значит
    /// показать человеку ровно наоборот.
    private(set) var undeliveredChecklists: [ChecklistOutbox.Item] = []

    func refreshUndeliveredChecklists() async {
        undeliveredChecklists = await checklistOutbox.pending()
    }

    /// Отложить пройденный чек-лист до связи.
    ///
    /// Кладём целиком — шаблон и ответы: без связи нет запуска, а значит и
    /// идентификатора, к которому ответы можно привязать. Сыграем всю тройку
    /// (запуск, ответы, завершение), когда сеть вернётся.
    func deferChecklist(template: ChecklistTemplate, answers: [ChecklistAnswer]) async {
        await checklistOutbox.add(
            ChecklistOutbox.Item(
                templateID: template.id,
                title: template.title,
                answers: answers
            )
        )
        await refreshUndeliveredChecklists()
        deferredNotice = "Чек-лист сохранён на устройстве и уйдёт при связи."
    }

    /// Проиграть отложенное. Возвращает, сколько ушло.
    ///
    /// Порядок внутри одного чек-листа обязателен: запуск даёт идентификатор,
    /// без него ответы принять некуда. Если сорвалось на середине — оставляем
    /// запись и пробуем в следующий раз: повторный запуск того же шаблона
    /// сервер отдаёт тем же запуском смены, дублей не будет.
    @discardableResult
    func flushChecklists() async -> Int {
        let queue = await checklistOutbox.pending()
        guard !queue.isEmpty else { return 0 }

        var sent = 0
        for item in queue {
            do {
                let started = try await service.startChecklist(templateID: item.templateID)
                _ = try await service.saveChecklistAnswers(runID: started.runID, answers: item.answers)
                _ = try await service.completeChecklist(runID: started.runID)
                await checklistOutbox.remove(id: item.id)
                sent += 1
            } catch {
                // Связь снова пропала — остальное подождёт своей очереди.
                break
            }
        }

        await refreshUndeliveredChecklists()
        if sent > 0 { await loadKnowledge() }
        return sent
    }

    func startChecklist(_ template: ChecklistTemplate) async -> Result<String, OperationFailure> {
        do {
            let started = try await service.startChecklist(templateID: template.id)
            return .success(started.runID)
        } catch let apiError as APIError {
            var offline = false
            if case .transport = apiError { offline = true }
            return .failure(OperationFailure(message: apiError.operatorMessage, isOffline: offline))
        } catch {
            return .failure(OperationFailure(message: error.localizedDescription))
        }
    }

    func saveChecklist(runID: String, answers: [ChecklistAnswer]) async -> String? {
        do {
            let sent = try await service.saveChecklistAnswers(runID: runID, answers: answers)
            deferredNotice = sent ? nil : Self.offlineNotice
            return nil
        } catch let apiError as APIError {
            return apiError.operatorMessage
        } catch {
            return error.localizedDescription
        }
    }

    func completeChecklist(runID: String) async -> Result<ChecklistRunResult, OperationFailure> {
        do {
            let result = try await service.completeChecklist(runID: runID)
            await loadKnowledge()
            return .success(result)
        } catch let apiError as APIError {
            return .failure(OperationFailure(message: apiError.operatorMessage))
        } catch {
            return .failure(OperationFailure(message: error.localizedDescription))
        }
    }
}

/// Ошибка операции кабинета с готовым текстом для пользователя.
///
/// Отдельный тип, а не голая строка: `Result` требует, чтобы ошибка
/// соответствовала `Error`, и заодно так виднее, что текст уже переведён
/// в человеческий вид.
struct OperationFailure: Error, Equatable {
    let message: String
    /// Отказ из-за связи, а не по существу.
    ///
    /// Различие важное: «нет сети» значит «подожди и повторим сами», а «нет
    /// права» или «смена закрыта» — что повторять бессмысленно.
    var isOffline: Bool = false
}
