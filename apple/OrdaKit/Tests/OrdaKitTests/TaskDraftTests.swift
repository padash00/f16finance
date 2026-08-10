import Foundation
import Testing

@testable import OrdaKit

/// Постановка задачи.
@Suite("Заготовка задачи")
struct TaskDraftTests {
    private func draft() -> TaskDraft {
        var value = TaskDraft(companyID: "co-1")
        value.title = "Заменить лампу в зале"
        return value
    }

    @Test("Без названия и без точки не отправляется")
    func requiredFields() {
        var noTitle = draft()
        noTitle.title = "   "
        #expect(noTitle.validationMessage == "Название задачи обязательно")

        var noCompany = draft()
        noCompany.companyID = ""
        #expect(noCompany.validationMessage == "Для задачи нужно выбрать точку")
    }

    @Test("Заполненная задача проходит")
    func validDraftPasses() {
        #expect(draft().isValid)
    }

    /// `in_progress` со снейк-кейсом — то, что принимает сервер. Опечатка в
    /// значении статуса не сломала бы сборку, но задача завелась бы с чужим
    /// состоянием или не завелась вовсе.
    @Test("Значения статусов и приоритетов — серверные")
    func rawValuesMatchServer() {
        #expect(TaskState.inProgress.rawValue == "in_progress")
        #expect(TaskState.selectable.map(\.rawValue) == ["todo", "in_progress", "review", "done"])
        #expect(TaskPriority.allCases.map(\.rawValue) == ["low", "medium", "high", "critical"])
    }

    @Test("Тело запроса собирается по контракту сервера")
    func encodesServerContract() throws {
        var value = draft()
        value.priority = .high
        value.operatorID = "op-1"
        value.dueDate = "2026-08-20"

        let body = try JSONEncoder().encode(TaskCreateRequest(payload: value.payload()))
        let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])

        #expect(json["action"] as? String == "createTask")
        let payload = try #require(json["payload"] as? [String: Any])
        #expect(payload["title"] as? String == "Заменить лампу в зале")
        #expect(payload["company_id"] as? String == "co-1")
        #expect(payload["operator_id"] as? String == "op-1")
        #expect(payload["due_date"] as? String == "2026-08-20")
        #expect(payload["priority"] as? String == "high")
        #expect(payload["status"] as? String == "todo")
    }

    /// Пустые подробности и отсутствие исполнителя уходят как `null`: задача
    /// без исполнителя попадает в общий список точки, и это нормальный случай.
    @Test("Пустые поля уходят как null, а не пустой строкой")
    func blanksBecomeNull() throws {
        let body = try JSONEncoder().encode(TaskCreateRequest(payload: draft().payload()))
        let payload = try #require(
            (try JSONSerialization.jsonObject(with: body) as? [String: Any])?["payload"] as? [String: Any]
        )

        #expect(payload["description"] is NSNull)
        #expect(payload["operator_id"] is NSNull)
        #expect(payload["due_date"] is NSNull)
    }

    @Test("Смена статуса шлёт taskId тем именем, что читает роут")
    func statusRequestContract() throws {
        let body = try JSONEncoder().encode(TaskStatusRequest(taskID: "t-1", status: "done"))
        let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])

        #expect(json["action"] as? String == "changeStatus")
        #expect(json["taskId"] as? String == "t-1")
        #expect(json["status"] as? String == "done")
    }
}
