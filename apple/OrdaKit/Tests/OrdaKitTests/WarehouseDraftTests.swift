import Foundation
import Testing

@testable import OrdaKit

/// Складские документы и инциденты: что отсеивается до отправки.
@Suite("Складские заготовки")
struct WarehouseDraftTests {
    // ── Списание ─────────────────────────────────────────────────────────────

    private func writeoff() -> WriteoffDraft {
        var value = WriteoffDraft(writtenAt: "2026-08-10", locationID: "loc-1")
        value.reason = "Разбилось"
        value.lines = [WriteoffLine(itemID: "i-1", name: "Кола", quantity: 2)]
        return value
    }

    @Test("Заполненный акт проходит")
    func validWriteoffPasses() {
        #expect(writeoff().isValid)
    }

    @Test("Акт без места, причины и позиций не отправляется")
    func writeoffRequiresEssentials() {
        var noLocation = writeoff()
        noLocation.locationID = ""
        #expect(noLocation.validationMessage == "Выберите, откуда списываем")

        var noReason = writeoff()
        noReason.reason = "   "
        #expect(noReason.validationMessage == "Причина обязательна")

        var noLines = writeoff()
        noLines.lines = []
        #expect(noLines.validationMessage == "Добавьте хотя бы одну позицию")
    }

    /// Позиция с нулём — забытое поле, а не «списать ноль». Сервер такую
    /// строку примет и создаст документ, который ничего не меняет.
    @Test("Позиция без количества не проходит")
    func zeroQuantityRejected() {
        var draft = writeoff()
        draft.lines[0].quantity = 0
        #expect(draft.validationMessage == "У каждой позиции должно быть количество")
    }

    @Test("Тело акта собирается по контракту сервера")
    func writeoffEncodesContract() throws {
        let body = try JSONEncoder().encode(
            WriteoffCreateRequest(payload: writeoff().payload(), companyID: "co-1")
        )
        let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])

        #expect(json["action"] as? String == "createWriteoff")
        #expect(json["company_id"] as? String == "co-1")

        let payload = try #require(json["payload"] as? [String: Any])
        #expect(payload["location_id"] as? String == "loc-1")
        #expect(payload["written_at"] as? String == "2026-08-10")
        #expect(payload["reason"] as? String == "Разбилось")

        let items = try #require(payload["items"] as? [[String: Any]])
        #expect(items.first?["item_id"] as? String == "i-1")
        #expect(items.first?["quantity"] as? Double == 2)
        // Названия в теле нет: оно нужно только форме, сервер знает товар по id.
        #expect(items.first?["name"] == nil)
    }

    // ── Инцидент ─────────────────────────────────────────────────────────────

    private func incident(kind: IncidentKind = .violation) -> IncidentDraft {
        var value = IncidentDraft(companyID: "co-1")
        value.kind = kind
        value.title = "Опоздание на смену"
        return value
    }

    @Test("Инцидент без точки и названия не отправляется")
    func incidentRequiresEssentials() {
        var noCompany = incident()
        noCompany.companyID = ""
        #expect(noCompany.validationMessage == "Точка обязательна")

        var noTitle = incident()
        noTitle.title = "  "
        #expect(noTitle.validationMessage == "Название обязательно")
    }

    /// Штраф у поощрения — почти всегда промах в поле. Сервер это примет, а
    /// человек потом не поймёт, откуда в зарплате цифра.
    @Test("Штраф поощрению и премия нарушению не проходят")
    func amountMatchesKind() {
        var bonusWithFine = incident(kind: .bonus)
        bonusWithFine.fineAmount = 5000
        #expect(bonusWithFine.validationMessage == "У поощрения не бывает штрафа")

        var violationWithBonus = incident(kind: .violation)
        violationWithBonus.bonusAmount = 5000
        #expect(violationWithBonus.validationMessage == "У нарушения не бывает премии")
    }

    @Test("Нулевые суммы не отправляются вовсе")
    func zeroAmountsOmitted() throws {
        let body = try JSONEncoder().encode(incident().payload())
        let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])

        #expect(json["company_id"] as? String == "co-1")
        #expect(json["kind"] as? String == "violation")
        // Ключей нет вовсе, а не `null`: сервер читает их как `?? null`, и
        // отсутствие означает ровно то же самое. Разница важна там, где идёт
        // слияние с сохранённым — здесь запись создаётся с нуля.
        #expect(json["fine_amount"] == nil)
        #expect(json["bonus_amount"] == nil)
    }

    // ── Ревизия ──────────────────────────────────────────────────────────────

    private func stocktake() -> StocktakeDraft {
        var value = StocktakeDraft(countedAt: "2026-08-10", locationID: "loc-1")
        value.lines = [
            StocktakeLine(itemID: "i-1", name: "Кола", unit: "шт", expected: 8, actual: 6),
            StocktakeLine(itemID: "i-2", name: "Чипсы", unit: "шт", expected: 3),
        ]
        return value
    }

    @Test("Расхождение считается как факт минус учёт")
    func differenceIsFactMinusExpected() {
        let draft = stocktake()
        #expect(draft.lines[0].difference == -2)
        #expect(draft.lines[0].hasMismatch)
        // До непосчитанной позиции не дошли — расхождения у неё нет вовсе.
        #expect(draft.lines[1].difference == nil)
        #expect(!draft.lines[1].hasMismatch)
    }

    @Test("Считается только то, что пересчитали")
    func progressCountsOnlyCounted() {
        let draft = stocktake()
        #expect(draft.countedLines.count == 1)
        #expect(draft.remaining == 1)
        #expect(draft.mismatchedLines.count == 1)
    }

    /// Главное правило ревизии: непосчитанная позиция не уходит на сервер.
    /// Отправить её нулём значит списать товар, которого никто не искал.
    @Test("Непосчитанные позиции в акт не попадают")
    func uncountedLinesAreNotSent() throws {
        let body = try JSONEncoder().encode(
            StocktakeCreateRequest(payload: stocktake().payload(), companyID: nil)
        )
        let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
        let payload = try #require(json["payload"] as? [String: Any])
        let items = try #require(payload["items"] as? [[String: Any]])

        #expect(json["action"] as? String == "createRevision")
        #expect(items.count == 1)
        #expect(items.first?["item_id"] as? String == "i-1")
        #expect(items.first?["actual_qty"] as? Double == 6)
    }

    @Test("Акт без единой пересчитанной позиции не проводится")
    func emptyStocktakeRejected() {
        var draft = stocktake()
        draft.lines = draft.lines.map {
            StocktakeLine(itemID: $0.itemID, name: $0.name, unit: $0.unit, expected: $0.expected)
        }
        #expect(draft.validationMessage == "Ни одна позиция не пересчитана")
    }

    // ── Решение по заявке ────────────────────────────────────────────────────

    @Test("Решение по заявке шлёт requestId тем именем, что читает роут")
    func decisionEncodesContract() throws {
        let body = try JSONEncoder().encode(
            StockRequestDecision(requestID: "r-1", approved: false, comment: "Нет на складе")
        )
        let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])

        #expect(json["action"] as? String == "decideRequest")
        #expect(json["requestId"] as? String == "r-1")
        #expect(json["approved"] as? Bool == false)
        #expect(json["decision_comment"] as? String == "Нет на складе")
    }
}
