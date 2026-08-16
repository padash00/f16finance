import Foundation
import Testing

@testable import OrdaKit

/// Разбор ответов сервера.
///
/// Опечатка в имени ключа не ломает сборку: поле молча приходит нулём или
/// пустым, и экран выглядит рабочим, но врёт. Так уже случалось — загрузчик
/// накладной отдаёт `document_url`, а модель ждала `url`, и приёмка получала
/// пустую ссылку.
///
/// Поэтому у каждой модели, написанной по серверному коду, есть кусок
/// настоящего ответа и проверка, что значения дошли до нужных полей.
@Suite("Разбор ответов сервера")
struct ResponseDecodingTests {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(type, from: Data(json.utf8))
    }

    // ── Личный экран продавца ────────────────────────────────────────────────

    @Test("Оценка продавца за месяц")
    func salesQuality() throws {
        let month = try decode(
            DataEnvelope<SalesQualityMonth>.self,
            """
            {"data":{"available":true,"month":"2026-08","shifts":14,"receipts":612,
            "status":"STRONG","status_label":"Сильный",
            "status_meaning":"Стабильно выше нормы по нескольким показателям.",
            "strengths":["Средний чек"],"weaknesses":["Допродажи"],
            "bonus":{"amount":15000,"paid":false,"next_step":null,"strong":15000,"top":30000}}}
            """
        ).data

        #expect(month.available)
        #expect(month.shifts == 14)
        #expect(month.receipts == 612)
        #expect(month.statusLabel == "Сильный")
        #expect(month.strengths == ["Средний чек"])
        #expect(month.bonus?.amount == 15_000)
        #expect(month.bonus?.paid == false)
        #expect(month.bonus?.top == 30_000)
    }

    @Test("Месяц без продаж не притворяется нулевым результатом")
    func salesQualityUnavailable() throws {
        let month = try decode(
            DataEnvelope<SalesQualityMonth>.self,
            #"{"data":{"available":false,"reason":"no-sales","month":"2026-08"}}"#
        ).data

        #expect(!month.available)
        #expect(month.reason == "no-sales")
        #expect(month.bonus == nil)
    }

    // ── Кому сколько доплатить ───────────────────────────────────────────────

    @Test("Ведомость доплат за качество")
    func salesKpiPayout() throws {
        let payout = try decode(
            Wrapper<SalesKpiPayout>.self,
            """
            {"data":{"month":"2026-08","company_id":"c-1",
            "rows":[{"cashier_id":"op-1","name":"Алима","shifts":12,"revenue":840000,
            "receipts":540,"score":78.5,"status":"STRONG","status_label":"Сильный",
            "amount":15000,"paid":false,"zero_reason":null,
            "strengths":["avg_ticket"],"weaknesses":["attach_rate"]}],
            "totals":{"to_pay":15000,"to_pay_people":1,"already_paid":0,
            "already_paid_people":0,"people":3},
            "settings":{"monthly_bonus_strong":15000,"monthly_bonus_top":30000,
            "min_qualifying_shifts":8,"shift_bonus_paid":true}}}
            """
        ).data

        #expect(payout.rows.count == 1)
        let row = try #require(payout.rows.first)
        #expect(row.cashierID == "op-1")
        #expect(row.name == "Алима")
        #expect(row.amount == 15_000)
        #expect(row.statusLabel == "Сильный")
        #expect(row.weaknesses == ["attach_rate"])
        #expect(payout.totals.toPay == 15_000)
        #expect(payout.totals.people == 3)
        #expect(payout.settings.minQualifyingShifts == 8)

        // Ключи метрик приходят машинными — подписи ищем в словаре, иначе
        // продавцу показалось бы «attach_rate».
        #expect(SalesKpiMetric.label("attach_rate") == "Допродажи")
    }

    // ── Аттестация ───────────────────────────────────────────────────────────

    @Test("Список экзаменов со сводкой")
    func adminExams() throws {
        let overview = try decode(
            Wrapper<AdminExamsOverview>.self,
            """
            {"data":{"exams":[{"id":"e-1","title":"Аттестация","company_ids":["c-1"],
            "question_count":10,"open_count":2,"pass_score":70,
            "deadline_at":"2026-08-20T12:00:00.000Z","status":"sent",
            "created_at":"2026-08-16T09:00:00.000Z",
            "assigned":5,"completed":3,"passed":2,"avg_score":74}],
            "companies":[{"id":"c-1","name":"F16 Ramen","code":"RAM"}],
            "operators":[{"id":"op-1","name":"Алима","company_ids":["c-1"],
            "telegram_chat_id":"1357970983"}]}}
            """
        ).data

        let exam = try #require(overview.exams.first)
        #expect(exam.title == "Аттестация")
        #expect(exam.questionCount == 10)
        #expect(exam.passScore == 70)
        #expect(exam.assigned == 5)
        #expect(exam.averageScore == 74)
        #expect(exam.isSent)
        #expect(exam.deadlineAt != nil)

        let person = try #require(overview.operators.first)
        #expect(person.name == "Алима")
        #expect(person.companyIDs == ["c-1"])
        #expect(person.hasTelegram)
    }

    @Test("Попытка без Telegram помечается")
    func examOperatorWithoutTelegram() throws {
        let overview = try decode(
            Wrapper<AdminExamsOverview>.self,
            #"{"data":{"exams":[],"companies":[],"operators":[{"id":"op-2","name":"Елена","company_ids":[],"telegram_chat_id":null}]}}"#
        ).data
        #expect(overview.operators.first?.hasTelegram == false)
    }

    // ── Команда ──────────────────────────────────────────────────────────────

    @Test("Состав команды собирается из плоских списков")
    func operatorRoster() throws {
        let roster = try decode(
            Wrapper<OperatorRoster>.self,
            """
            {"data":{"companies":[{"id":"c-1","name":"F16 Ramen","code":null}],
            "operators":[{"id":"op-1","name":"Алима","short_name":"Алима","is_active":true}],
            "profiles":[{"operator_id":"op-1","photo_url":null,"position":"Оператор",
            "phone":"+77776054856","email":null,"hire_date":"2025-08-16"}],
            "documents":[{"operator_id":"op-1","expiry_date":"2030-01-01"},
            {"operator_id":"op-1","expiry_date":"2026-08-20"}]}}
            """
        ).data

        let person = try #require(roster.people.first)
        #expect(person.name == "Алима")
        #expect(person.position == "Оператор")
        #expect(person.phone == "+77776054856")
        #expect(person.isActive)
        // Из двух документов берётся ближайший, а не первый в списке.
        let expiry = try #require(person.nearestExpiry)
        #expect(Calendar.current.component(.year, from: expiry) == 2026)
    }

    // ── Накладная ────────────────────────────────────────────────────────────

    @Test("Разобранная накладная делится на сопоставленное и нет")
    func scannedInvoice() throws {
        let invoice = try decode(
            Wrapper<ScannedInvoice>.self,
            """
            {"data":{"supplier_name":"Панда КО","invoice_number":"№ 552",
            "invoice_date":"2026-08-16","total_amount":184500,
            "matched_count":1,"unmatched_count":1,
            "items":[{"invoice_name":"Кола 0.5","quantity":24,"unit_cost":320,
            "total_cost":7680,"barcode":"4870","matched_item_id":"i-1",
            "matched_item_name":"Coca-Cola 0.5","match_source":"barcode",
            "last_unit_cost":300,"last_sale_price":600,"unit_cost_change_pct":6.7},
            {"invoice_name":"Салфетки","quantity":10,"unit_cost":150,
            "total_cost":1500,"barcode":null,"matched_item_id":null,
            "matched_item_name":null,"match_source":null,"last_unit_cost":null,
            "last_sale_price":null,"unit_cost_change_pct":null}]}}
            """
        ).data

        #expect(invoice.invoiceNumber == "№ 552")
        #expect(invoice.totalAmount == 184_500)
        #expect(invoice.items.count == 2)

        let matched = try #require(invoice.items.first)
        #expect(matched.isMatched)
        #expect(matched.matchedItemName == "Coca-Cola 0.5")
        #expect(matched.quantity == 24)
        #expect(matched.unitCost == 320)
        #expect(matched.unitCostChangePct == 6.7)

        let unmatched = try #require(invoice.items.last)
        #expect(!unmatched.isMatched)
        #expect(unmatched.invoiceName == "Салфетки")
    }

    /// Обёртка `{ "data": … }` админских ответов. У операторского контура для
    /// этого есть `DataEnvelope`, но он объявлен только там.
    private struct Wrapper<Value: Decodable & Sendable>: Decodable, Sendable {
        let data: Value
    }
}
