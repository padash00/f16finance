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

    // ── График владельца ─────────────────────────────────────────────────────

    @Test("Заявки на замену приходят вместе с сеткой смен")
    func scheduleWithIssues() throws {
        let schedule = try decode(
            ShiftSchedule.self,
            """
            {"ok":true,
            "publications":[{"id":"p-1","company_id":"c-1","week_start":"2026-08-17",
            "status":"published","pending_count":1,"confirmed_count":4,"issue_count":1}],
            "responses":[],
            "requests":[{"id":"r-1","publication_id":"p-1","company_id":"c-1",
            "operator_id":"op-2","operator_name":"Алима","shift_date":"2026-08-20",
            "shift_type":"night","status":"open","source":"operator","reason":"Заболела",
            "lead_status":"proposed","lead_action":"replace","lead_note":"Данияр свободен",
            "lead_operator_name":"Сержан","lead_replacement_operator_name":"Данияр",
            "resolution_note":null,"created_at":"2026-08-17T09:00:00.000Z"},
            {"id":"r-0","publication_id":"p-1","company_id":"c-1","operator_id":"op-3",
            "operator_name":"Ержан","shift_date":"2026-08-18","shift_type":"day",
            "status":"resolved","reason":"Учёба","lead_status":null,"lead_action":null,
            "created_at":"2026-08-16T09:00:00.000Z"}],
            "schedule":{"companies":[{"id":"c-1","name":"F16 Arena","code":"ARN"}],
            "shifts":[{"id":"s-1","date":"2026-08-20","operator_name":"Алима",
            "shift_type":"night","company_id":"c-1"}]}}
            """
        )

        #expect(schedule.companies.count == 1)
        #expect(schedule.shifts.count == 1)
        #expect(schedule.requests.count == 2)

        // Решённая заявка не должна попадать в «ждут решения».
        #expect(schedule.openRequests.map(\.id) == ["r-1"])

        let issue = try #require(schedule.openRequests.first)
        #expect(issue.operatorName == "Алима")
        #expect(issue.isNight)
        #expect(issue.hasProposal)
        #expect(issue.proposalLabel == "Старший: заменить на Данияр")
        #expect(issue.statusLabel == "Есть предложение")
        #expect(issue.leadOperatorName == "Сержан")
    }

    @Test("Неделя без заявок не ломает разбор графика")
    func scheduleWithoutIssues() throws {
        let schedule = try decode(
            ShiftSchedule.self,
            #"{"ok":true,"schedule":{"companies":[],"shifts":[]}}"#
        )
        #expect(schedule.requests.isEmpty)
        #expect(schedule.openRequests.isEmpty)
    }

    // ── Зал клуба ────────────────────────────────────────────────────────────

    @Test("Зал: станции, тарифы и активные сессии")
    func arenaHall() throws {
        let hall = try decode(
            DataEnvelope<ArenaHall>.self,
            """
            {"ok":true,"data":{
            "zones":[{"id":"z-1","name":"VIP","is_active":true,"extension_hourly_price":1200}],
            "stations":[{"id":"s-1","name":"PC-01","zone_id":"z-1","order_index":1,"is_active":true},
            {"id":"s-2","name":"PC-02","zone_id":"z-1","order_index":2,"is_active":true},
            {"id":"s-3","name":"PS-01","zone_id":null,"order_index":1,"is_active":true}],
            "tariffs":[{"id":"t-1","name":"1 час","price":900,"duration_minutes":60,
            "zone_id":"z-1","tariff_type":"fixed","is_active":true},
            {"id":"t-2","name":"Ночь","price":4000,"duration_minutes":600,"zone_id":null,
            "tariff_type":"time_window","window_start_time":"22:00:00",
            "window_end_time":"08:00:00","is_active":true}],
            "sessions":[{"id":"ses-1","station_id":"s-1","tariff_id":"t-1",
            "started_at":"2026-08-17T10:00:00.000Z","ends_at":"2026-08-17T11:00:00.000Z",
            "amount":900,"cash_amount":900,"kaspi_amount":0,"status":"active",
            "payment_method":"cash","discount_percent":0}],
            "decorations":[],
            "today_income":{"cash":12500,"kaspi":8000,"rows":[]},
            "today_tech_logs":[]}}
            """
        ).data

        #expect(hall.stations.count == 3)
        #expect(hall.busyCount == 1)
        #expect(hall.todayCash == 12_500)
        #expect(hall.todayKaspi == 8_000)
        #expect(hall.todayTotal == 20_500)

        // Станция занята ровно та, на которой сессия.
        #expect(hall.session(stationID: "s-1") != nil)
        #expect(hall.session(stationID: "s-2") == nil)

        // Станции без зоны не теряются и не приписываются к чужой.
        #expect(hall.stations(zoneID: "z-1").map(\.name) == ["PC-01", "PC-02"])
        #expect(hall.stations(zoneID: nil).map(\.name) == ["PS-01"])

        // Тариф зоны — только своей зоне; общий годится везде.
        let vip = try #require(hall.stations.first { $0.id == "s-1" })
        let console = try #require(hall.stations.first { $0.id == "s-3" })
        #expect(hall.tariffs(for: vip).map(\.id) == ["t-1", "t-2"])
        #expect(hall.tariffs(for: console).map(\.id) == ["t-2"])
    }

    @Test("Остаток времени и просрочка считаются от конца сессии")
    func arenaCountdown() throws {
        let hall = try decode(
            DataEnvelope<ArenaHall>.self,
            """
            {"data":{"stations":[],"zones":[],"tariffs":[],
            "sessions":[{"id":"ses-1","station_id":"s-1","tariff_id":"t-1",
            "started_at":"2026-08-17T10:00:00.000Z","ends_at":"2026-08-17T11:00:00.000Z",
            "amount":900,"cash_amount":0,"kaspi_amount":900,"status":"active"}]}}
            """
        ).data

        let session = try #require(hall.sessions.first)
        let ends = try #require(session.endsAt)

        // За пять минут до конца — «пора подойти», но время ещё не вышло.
        let fiveBefore = ends.addingTimeInterval(-5 * 60)
        #expect(session.isEndingSoon(now: fiveBefore))
        #expect(!session.isExpired(now: fiveBefore))

        // За полчаса — ещё рано.
        #expect(!session.isEndingSoon(now: ends.addingTimeInterval(-30 * 60)))

        // После конца — просрочено, и остаток отрицательный: гость сидит
        // сверх оплаченного, и оператор должен видеть, насколько.
        let after = ends.addingTimeInterval(12 * 60)
        #expect(session.isExpired(now: after))
        #expect(session.remaining(now: after) < 0)
    }

    // ── Стол старшего смены ──────────────────────────────────────────────────

    @Test("Заявки команды и готовность недели")
    func leadDesk() throws {
        let desk = try decode(
            LeadDesk.self,
            """
            {"ok":true,
            "lead":{"operator":{"id":"op-1","name":"Сержан","short_name":"Сержан"}},
            "companies":[{"id":"c-1","name":"F16 Arena","code":"ARN",
            "publication":{"id":"p-1","week_start":"2026-08-17","week_end":"2026-08-23",
            "status":"published"},
            "weeklyStatus":{"state":"published","total":5,"confirmed":3,"pending":2,
            "issues":1,"proposals":0,"resolved":0}}],
            "teamAssignments":[
            {"id":"a-1","operator_id":"op-2","company_id":"c-1","role_in_company":"operator",
            "is_primary":true,"operator_name":"Алима"},
            {"id":"a-2","operator_id":"op-1","company_id":"c-1","role_in_company":"senior_operator",
            "is_primary":true,"operator_name":"Сержан"}],
            "requests":[{"id":"r-1","company_id":"c-1","company_name":"F16 Arena",
            "operator_id":"op-2","operator_name":"Алима","shift_date":"2026-08-20",
            "shift_type":"night","status":"open","reason":"Заболел","source":"operator",
            "lead_status":null,"lead_action":null,"lead_note":null,
            "lead_replacement_operator_name":null,"resolution_note":null,
            "created_at":"2026-08-17T09:00:00.000Z"}]}
            """
        )

        #expect(desk.leadName == "Сержан")
        #expect(desk.companies.first?.pending == 2)
        #expect(desk.companies.first?.confirmed == 3)
        #expect(desk.companies.first?.isDraft == false)
        #expect(desk.companies.first?.weekStart == "2026-08-17")

        // Заявка без предложения — она и ждёт старшего.
        #expect(desk.awaitingProposal.count == 1)
        #expect(desk.awaitingDecision.isEmpty)
        let request = try #require(desk.requests.first)
        #expect(request.operatorName == "Алима")
        #expect(request.isNight)
        #expect(request.reason == "Заболел")
        #expect(request.statusLabel == "Ждёт вашего решения")

        // В кандидаты на замену не должен попасть сам заявитель.
        let candidates = desk.replacements(companyID: "c-1", excluding: "op-2")
        #expect(candidates.map(\.operatorID) == ["op-1"])
        #expect(candidates.first?.roleLabel == "Старший")
    }

    @Test("Предложенная замена ждёт уже руководителя")
    func leadDeskProposed() throws {
        let desk = try decode(
            LeadDesk.self,
            """
            {"requests":[{"id":"r-2","company_id":"c-1","company_name":"F16 Arena",
            "operator_id":"op-2","operator_name":"Алима","shift_date":"2026-08-20",
            "shift_type":"day","status":"open","reason":"Учёба",
            "lead_status":"proposed","lead_action":"replace",
            "lead_replacement_operator_name":"Данияр","created_at":null}]}
            """
        )

        #expect(desk.awaitingProposal.isEmpty)
        #expect(desk.awaitingDecision.count == 1)
        #expect(desk.requests.first?.proposalLabel == "Заменить: Данияр")
        #expect(desk.requests.first?.statusLabel == "Ждёт руководителя")
    }

    /// Обёртка `{ "data": … }` админских ответов. У операторского контура для
    /// этого есть `DataEnvelope`, но он объявлен только там.
    private struct Wrapper<Value: Decodable & Sendable>: Decodable, Sendable {
        let data: Value
    }
}

/// Отправка своих контактов.
///
/// Сервер читает `null` как «стереть», а пропущенное поле — как «не трогать».
/// Синтезированный кодировщик писал `null` вместо пропуска, и сохранение
/// телефона стирало почту.
@Suite("Правка своих контактов")
struct MyProfileChangeTests {
    private func json(_ change: MyProfileChange) throws -> [String: Any] {
        let data = try JSONEncoder().encode(change)
        return try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
    }

    @Test("Незаполненные поля не уходят на сервер")
    func onlyChangedFieldsAreSent() throws {
        var change = MyProfileChange()
        change.phone = "+7 777 123 45 67"

        let body = try json(change)
        #expect(body["phone"] as? String == "+7 777 123 45 67")
        #expect(body["email"] == nil)
        #expect(body["telegram_chat_id"] == nil)
    }

    @Test("Пустая строка уходит: это «стереть»")
    func emptyStringIsSent() throws {
        var change = MyProfileChange()
        change.email = ""

        let body = try json(change)
        #expect(body["email"] as? String == "")
        #expect(body["phone"] == nil)
    }
}
