import Foundation
import Testing
@testable import OrdaKit

/// Разбор ответов операторского контура.
///
/// JSON в тестах — копии реальных форм из `app/api/operator/*`, включая
/// неудобные места: `{ "shift": null }` без остальных секций, связь «к одному»
/// объектом или массивом, отсутствующие поля.
@Suite("Контракты операторского API")
struct OperatorContractTests {

    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try APIClient.defaultDecoder.decode(type, from: Data(json.utf8))
    }

    // ── Смена ────────────────────────────────────────────────────────────────

    @Test("Закрытая смена приходит одним полем shift: null")
    func closedShiftDecodes() throws {
        // Сервер в этом случае не присылает ни totals, ни checklists.
        let state = try decode(ShiftState.self, #"{"shift":null}"#)

        #expect(state.shift == nil)
        #expect(state.totals.salesCount == 0)
        #expect(state.templates.isEmpty)
        #expect(state.blockingChecklists.isEmpty)
    }

    @Test("Открытая смена разбирается со всеми секциями")
    func openShiftDecodes() throws {
        let json = """
        {
          "shift": {
            "id": "11111111-1111-1111-1111-111111111111",
            "company_id": "22222222-2222-2222-2222-222222222222",
            "organization_id": "33333333-3333-3333-3333-333333333333",
            "operator_id": "44444444-4444-4444-4444-444444444444",
            "point_device_id": null,
            "status": "open",
            "shift_type": "day",
            "opened_at": "2026-08-08T08:00:00+00:00",
            "closed_at": null,
            "opening_cash": 50000,
            "opening_notes": null,
            "handover_from_shift_id": null,
            "operator": { "id": "44444444-4444-4444-4444-444444444444", "full_name": "Иван Петров", "short_name": "Иван" }
          },
          "totals": {
            "sales_count": 47, "sales_total": 184500, "sales_cash": 92300, "sales_kaspi": 92200,
            "returns_count": 1, "returns_total": 4500, "returns_cash": 4500, "returns_kaspi": 0
          },
          "checklists": {
            "templates": [
              { "id": "t1", "title": "Открытие точки", "blocks_shift": true, "schedule_type": "once" },
              { "id": "t2", "title": "Уборка", "blocks_shift": false, "schedule_type": "once" }
            ],
            "runs": [
              { "id": "r1", "template_id": "t2", "status": "completed", "completed_at": "2026-08-08T09:00:00+00:00" }
            ]
          },
          "knowledge": { "pending_confirmations": [ { "id": "a1", "title": "Правила возврата", "version": 3 } ] }
        }
        """

        let state = try decode(ShiftState.self, json)
        let shift = try #require(state.shift)

        #expect(shift.isOpen)
        #expect(shift.operatorName == "Иван")
        #expect(shift.openingCash == 50000)
        #expect(state.totals.salesCount == 47)
        #expect(state.totals.netTotal == 180_000)
        #expect(state.totals.expectedCash == 87_800)
        #expect(state.pendingKnowledge.count == 1)
    }

    @Test("Незавершённый обязательный чек-лист попадает в блокирующие")
    func blockingChecklistDetected() throws {
        // «Открытие точки» блокирует и не завершено → закрыть смену не дадут.
        let json = """
        {
          "shift": { "id": "s1", "status": "open" },
          "checklists": {
            "templates": [
              { "id": "t1", "title": "Открытие точки", "blocks_shift": true, "schedule_type": "once" },
              { "id": "t3", "title": "Онбординг", "blocks_shift": true, "schedule_type": "onboarding" }
            ],
            "runs": []
          }
        }
        """

        let state = try decode(ShiftState.self, json)
        let blocking = state.blockingChecklists

        #expect(blocking.count == 1)
        #expect(blocking.first?.id == "t1")
        // Онбординг блокирующим не считается — сервер исключает его из проверки.
        #expect(!blocking.contains { $0.id == "t3" })
    }

    @Test("Связь «к одному» принимается и массивом")
    func operatorJoinAsArray() throws {
        // PostgREST при некоторых формулировках select отдаёт массив.
        let json = #"{"shift":{"id":"s1","status":"open","operator":[{"full_name":"Пётр Иванов","short_name":null}]}}"#
        let state = try decode(ShiftState.self, json)
        #expect(state.shift?.operatorName == "Пётр Иванов")
    }

    // ── Продажа ──────────────────────────────────────────────────────────────

    @Test("Каталог витрины разбирается вместе с остатками")
    func saleCatalogDecodes() throws {
        let json = """
        {
          "ok": true,
          "data": {
            "company": { "id": "c1", "name": "Точка на Абая", "code": "AB" },
            "items": [
              { "id": "i1", "name": "Кола 0.5", "barcode": "4870001", "unit": "шт", "sale_price": 700, "display_qty": 12 },
              { "id": "i2", "name": "Чипсы", "barcode": null, "unit": "шт", "sale_price": 900, "display_qty": 0 }
            ]
          }
        }
        """

        let catalog = try decode(SaleCatalog.self, json)
        #expect(catalog.companyName == "Точка на Абая")
        #expect(catalog.items.count == 2)
        #expect(catalog.items[0].isInStock)
        #expect(!catalog.items[1].isInStock)
    }

    @Test("Ответ продажи разбирается, повтор помечается")
    func saleResultDecodes() throws {
        let fresh = try decode(SaleResult.self, #"""
        {"ok":true,"data":{"sale_id":"s9","total_amount":1600,"sold_at":"2026-08-08T10:00:00Z","receipt_url":"https://ordaops.kz/r/s9","loyalty_points_earned":16}}
        """#)
        #expect(fresh.saleID == "s9")
        #expect(fresh.receiptURL?.hasSuffix("/r/s9") == true)
        #expect(!fresh.isIdempotentReplay)

        // Повторная отправка того же local_ref после обрыва сети.
        let replay = try decode(SaleResult.self, #"{"ok":true,"data":{"sale_id":"s9","total_amount":1600,"idempotent":true}}"#)
        #expect(replay.isIdempotentReplay)
    }

    @Test("Черновик продажи считает итог и валидируется")
    func saleDraftValidation() {
        var draft = SaleDraft(saleDate: "2026-08-08", shift: .day)
        #expect(draft.validate() == .noLines)

        draft.lines = [
            SaleLine(itemID: "i1", name: "Кола", quantity: 2, unitPrice: 700),
            SaleLine(itemID: "i2", name: "Чипсы", quantity: 1, unitPrice: 900),
        ]
        #expect(draft.total == 2300)
        #expect(draft.validate() == .zeroPayment, "оплата не указана")

        draft.paymentMethod = .cash
        draft.cashAmount = 2300
        #expect(draft.validate() == nil)
    }

    @Test("Разбивка Kaspi для ночной смены проверяется до отправки")
    func nightShiftKaspiSplit() {
        var draft = SaleDraft(saleDate: "2026-08-08", shift: .night)
        draft.lines = [SaleLine(itemID: "i1", name: "Кола", quantity: 1, unitPrice: 1000)]
        draft.paymentMethod = .kaspi
        draft.kaspiAmount = 1000
        draft.kaspiBeforeMidnight = 600
        draft.kaspiAfterMidnight = 300

        #expect(draft.validate() == .kaspiSplitMismatch, "600 + 300 ≠ 1000")

        draft.kaspiAfterMidnight = 400
        #expect(draft.validate() == nil)
    }

    @Test("Тело запроса продажи содержит ключ идемпотентности")
    func saleRequestBodyCarriesLocalRef() throws {
        var draft = SaleDraft(localRef: "ref-42", saleDate: "2026-08-08", shift: .day)
        draft.lines = [SaleLine(itemID: "i1", name: "Кола", quantity: 3, unitPrice: 700)]
        draft.paymentMethod = .cash
        draft.cashAmount = 2100

        let body = draft.requestBody()
        let payload = try #require(body["payload"] as? [String: Any])

        #expect(body["action"] as? String == "createSale")
        #expect(payload["local_ref"] as? String == "ref-42")
        #expect(payload["sale_date"] as? String == "2026-08-08")

        let items = try #require(payload["items"] as? [[String: Any]])
        #expect(items.count == 1)
        #expect(items[0]["item_id"] as? String == "i1")
        #expect(items[0]["quantity"] as? Double == 3)
    }

    // ── Ревизия ──────────────────────────────────────────────────────────────

    @Test("Список актов оператора разбирается")
    func auditActsDecode() throws {
        let json = """
        {"ok":true,"data":[
          {"act_id":"a1","locationName":"Точка на Абая · Витрина","comment":"Плановая","opened_at":"2026-08-08T07:00:00Z","sectionLabel":"Напитки, Снеки"}
        ]}
        """
        let list = try decode(AuditActList.self, json)
        #expect(list.acts.count == 1)
        #expect(list.acts[0].sectionLabel == "Напитки, Снеки")
    }

    @Test("Лист подсчёта: свои цифры видны, системного остатка нет")
    func auditSheetDecodes() throws {
        let json = """
        {"ok":true,"data":{"act_id":"a1","mode":"single","items":[
          {"item_id":"i1","name":"Кола 0.5","barcode":"4870001","unit":"шт","counted":9,"otherQty":null,"otherBy":null},
          {"item_id":"i2","name":"Чипсы","barcode":null,"unit":"шт","counted":null,"otherQty":4,"otherBy":"Асем"}
        ]}}
        """

        let sheet = try decode(AuditSheet.self, json)
        #expect(sheet.mode == .single)
        #expect(sheet.countedCount == 1)
        #expect(sheet.progress == 0.5)
        #expect(sheet.items[1].isCountedByColleague, "в совместном режиме видно, что коллега уже посчитал")
        #expect(sheet.items[1].otherBy == "Асем")
    }

    @Test("В слепом режиме чужих подсчётов не приходит")
    func auditDoubleBlindHidesOthers() throws {
        let json = """
        {"ok":true,"data":{"act_id":"a1","mode":"double","items":[
          {"item_id":"i1","name":"Кола 0.5","counted":null,"otherQty":null,"otherBy":null}
        ]}}
        """
        let sheet = try decode(AuditSheet.self, json)
        #expect(sheet.mode == .double)
        #expect(!sheet.items[0].isCountedByColleague)
    }

    // ── Ошибки ───────────────────────────────────────────────────────────────

    @Test("Коды отказа переводятся в понятный кассиру текст")
    func operatorErrorMessages() {
        let noShift = APIError.conflict(code: "point-shift-no-open", message: "")
        #expect(noShift.operatorMessage.contains("откройте смену"))

        let checklists = APIError.conflict(code: "point-shift-required-checklists-missing", message: "")
        #expect(checklists.operatorMessage.contains("чек-листы"))

        let cash = APIError.badRequest(code: "opening-cash-required", message: "")
        #expect(cash.operatorMessage.contains("в кассе"))

        // Текст графика сервер формулирует сам и точнее — не подменяем его.
        let schedule = APIError.forbidden(
            capability: nil,
            reason: .unknown,
            message: "Сегодня по графику работаешь не ты."
        )
        #expect(schedule.operatorMessage == "Сегодня по графику работаешь не ты.")
    }
}
