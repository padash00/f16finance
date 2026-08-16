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
        isLoadingOverview = true
        defer { isLoadingOverview = false }
        do {
            overview = try await service.overview()
            error = nil
        } catch let apiError as APIError {
            error = apiError.operatorMessage
        } catch {
            self.error = error.localizedDescription
        }
    }

    func loadTasks() async {
        isLoadingTasks = true
        defer { isLoadingTasks = false }
        tasks = (try? await service.tasks()) ?? tasks
    }

    func loadSalary() async {
        salary = (try? await service.salary()) ?? salary
    }

    func loadSchedule() async {
        schedule = (try? await service.schedule()) ?? schedule
    }

    func loadIncidents() async {
        incidents = (try? await service.incidents()) ?? incidents
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

    func startChecklist(_ template: ChecklistTemplate) async -> Result<String, OperationFailure> {
        do {
            let started = try await service.startChecklist(templateID: template.id)
            return .success(started.runID)
        } catch let apiError as APIError {
            return .failure(OperationFailure(message: apiError.operatorMessage))
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
}
