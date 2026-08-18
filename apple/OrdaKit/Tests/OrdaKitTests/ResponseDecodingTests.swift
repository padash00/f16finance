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

    // ── Чек-листы открытых смен ──────────────────────────────────────────────

    @Test("Что держит смену незакрытой")
    func shiftChecklistBoard() throws {
        let board = try decode(
            Envelope<ShiftChecklistBoard>.self,
            """
            {"ok":true,"data":{"shifts":[{"company_id":"c1","company_name":"Абая",
            "shift_id":"s1","shift_type":"night","opened_at":"2026-08-18T20:00:00Z",
            "checklists":[
            {"template_id":"t1","title":"Приём смены","schedule_type":"opening","status":"completed","skip_reason":null},
            {"template_id":"t2","title":"Пересчёт кассы","schedule_type":"closing","status":"missing","skip_reason":null},
            {"template_id":"t3","title":"Обход зала","schedule_type":"closing","status":"skipped","skip_reason":"проверил лично"}]}]}}
            """
        ).data

        let shift = try #require(board.shifts.first)
        #expect(shift.companyName == "Абая")
        #expect(shift.checklists.count == 3)
        // Держит смену только непройденный: прощённый и пройденный — нет.
        #expect(shift.blocking.map(\.title) == ["Пересчёт кассы"])
        #expect(shift.checklists[0].isDone)
        #expect(shift.checklists[2].isSkipped)
        #expect(shift.checklists[2].skipReason == "проверил лично")
        #expect(shift.checklists[1].statusLabel == "не пройден")
    }

    // ── Зарплата админ-состава ───────────────────────────────────────────────

    @Test("Сводка по окладным сотрудникам")
    func staffSalarySummary() throws {
        let summary = try decode(
            Envelope<StaffSalarySummary>.self,
            """
            {"ok":true,"data":{"today":"2026-08-20","slot":"second",
            "period":{"from":"2026-08-16","to":"2026-08-31"},
            "rows":[{"id":"s1","name":"Айгуль","short_name":"Айгуль К.","role":"accountant",
            "monthly_salary":300000,"source_type":"staff","is_active":true,"dismissal_date":null,
            "half":150000,"bonuses":20000,"debts":3000,"fines":5000,"advances":30000,"toPay":132000,
            "paid_this_month":150000,"month_closed":false,"is_me":true}],
            "totals":{"toPay":132000,"paidThisMonth":150000,"people":1},
            "self_only":false,"can_edit":true}}
            """
        ).data

        #expect(summary.slot == "second")
        #expect(!summary.isFirstHalf)
        #expect(summary.periodFrom == "2026-08-16")
        #expect(!summary.selfOnly)
        #expect(summary.toPayTotal == 132_000)
        #expect(summary.paidThisMonthTotal == 150_000)

        let row = try #require(summary.rows.first)
        #expect(row.name == "Айгуль")
        #expect(row.monthlySalary == 300_000)
        #expect(row.half == 150_000)
        #expect(row.toPay == 132_000)
        #expect(row.advances == 30_000)
        #expect(row.paidThisMonth == 150_000)
        #expect(row.isMe)
        #expect(!row.isFromOperator)
        #expect(!row.monthClosed)
    }

    /// Без права «Смотреть зарплату» сервер отдаёт одну строку — свою. Экран
    /// должен понять это по флагу, а не по числу строк: у организации из
    /// одного сотрудника строка тоже одна.
    @Test("Своя зарплата без права смотреть чужие")
    func staffSalarySelfOnly() throws {
        let summary = try decode(
            Envelope<StaffSalarySummary>.self,
            """
            {"ok":true,"data":{"today":"2026-08-04","slot":"first",
            "period":{"from":"2026-08-01","to":"2026-08-15"},
            "rows":[{"id":"s7","name":"Данияр","role":"tech","monthly_salary":0,
            "source_type":"operator","is_active":false,"dismissal_date":"2026-08-02",
            "half":0,"bonuses":0,"debts":0,"fines":0,"advances":0,"toPay":0,
            "paid_this_month":0,"month_closed":true,"is_me":true}],
            "totals":{"toPay":0,"paidThisMonth":0,"people":1},
            "self_only":true,"me_linked":true,"can_edit":false}}
            """
        ).data

        #expect(summary.selfOnly)
        #expect(summary.isFirstHalf)
        #expect(summary.meLinked == true)
        let row = try #require(summary.rows.first)
        #expect(row.isFromOperator)
        #expect(!row.isActive)
        #expect(row.dismissalDate == "2026-08-02")
        #expect(row.monthClosed)
    }

    /// Имя может прийти пустым — строка, собранная из оператора без имени.
    /// Пустая строка в списке зарплат читается как сбой загрузки.
    @Test("Сотрудник без имени не оставляет пустую строку")
    func staffSalaryFallbackName() throws {
        let summary = try decode(
            Envelope<StaffSalarySummary>.self,
            """
            {"ok":true,"data":{"today":"2026-08-04","slot":"first","rows":[
            {"id":"s9","name":"","short_name":"Марат","toPay":1000},
            {"id":"s10","name":"","short_name":null,"toPay":2000}],
            "totals":{"toPay":3000,"paidThisMonth":0,"people":2}}}
            """
        ).data

        #expect(summary.rows.map(\.name) == ["Марат", "Сотрудник"])
        #expect(summary.rows[0].isActive)
        // Старый сервер про связь аккаунта молчит — и приложение не должно
        // выдумывать за него ответ «оклад не заведён».
        #expect(summary.meLinked == nil)
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

    @Test("История движений товара")
    func storeMovements() throws {
        let list = try decode(
            StoreMovementList.self,
            """
            {"ok":true,"data":{"movements":[
            {"id":"m-1","movement_type":"transfer","quantity":20,"total_amount":0,
            "created_at":"2026-08-18T09:00:00.000Z",
            "item":{"id":"i-1","name":"Coca-Cola 0.5","unit":"шт"},
            "from_location":{"id":"l-1","name":"Основной склад","location_type":"warehouse",
            "company":{"id":"c-1","name":"F16 Arena"}},
            "to_location":{"id":"l-2","name":"Витрина","location_type":"point_display",
            "company":{"id":"c-1","name":"F16 Arena"}}},
            {"id":"m-2","movement_type":"sale","quantity":2,"total_amount":1200,
            "created_at":"2026-08-18T10:00:00.000Z",
            "item":{"id":"i-1","name":"Coca-Cola 0.5","unit":"шт"},
            "from_location":{"id":"l-2","name":"Витрина","location_type":"point_display"},
            "to_location":null}],
            "locations":[]}}
            """
        )

        #expect(list.movements.count == 2)

        let transfer = try #require(list.movements.first)
        #expect(transfer.itemName == "Coca-Cola 0.5")
        #expect(transfer.quantity == 20)
        #expect(transfer.kindLabel == "Перемещение")
        // Перенос не меняет запас: товар остаётся в системе, меняя место.
        #expect(transfer.direction == 0)

        let sale = try #require(list.movements.last)
        #expect(sale.kindLabel == "Продажа")
        #expect(sale.direction == -1)
        #expect(sale.toName == nil)
    }

    // ── Ревизии ──────────────────────────────────────────────────────────────

    @Test("Акты пересчёта: статус и доля посчитанного")
    func revisionActs() throws {
        let acts = try decode(
            DataListWrapper<RevisionAct>.self,
            """
            {"data":[
            {"id":"a-1","status":"open","comment":"Ночная","opened_at":"2026-08-18T02:00:00.000Z",
            "closed_at":null,"locationName":"F16 Arena · Витрина","totalItems":40,"countedItems":10},
            {"id":"a-2","status":"closed","comment":null,"opened_at":"2026-08-17T02:00:00.000Z",
            "closed_at":"2026-08-17T05:00:00.000Z","locationName":"F16 Arena · Склад",
            "totalItems":40,"countedItems":40},
            {"id":"a-3","status":"cancelled","opened_at":"2026-08-16T02:00:00.000Z",
            "locationName":"Склад","totalItems":0,"countedItems":0}]}
            """
        ).data

        #expect(acts.count == 3)

        let open = try #require(acts.first)
        #expect(open.isOpen)
        #expect(open.statusLabel == "Идёт пересчёт")
        #expect(open.progress == 0.25)

        #expect(acts[1].isClosed)
        #expect(acts[1].statusLabel == "Проведён")
        #expect(acts[2].isCancelled)
        // Пустой снимок: доли нет, а не ноль — делить не на что.
        #expect(acts[2].progress == nil)
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

    // ── Команда ──────────────────────────────────────────────────────────────

    @Test("Оператор без карточки сотрудника виден по флагу")
    func operatorWithoutStaffLink() throws {
        let list = try decode(
            DataListWrapper<TeamOperator>.self,
            """
            {"data":[
            {"id":"op-1","name":"Алима","short_name":"Алима","is_active":true,
            "role":"operator","telegram_chat_id":null,"has_staff_link":false,
            "operator_profiles":{"full_name":"Алима Кадырова","phone":"+77776054856",
            "position":"Оператор","photo_url":null,"hire_date":"2025-08-16"},
            "auth":{"username":"alima","last_login":null,"user_id":"u-1"},
            "stats":{"totalShifts":12,"totalTurnover":840000,"avgPerShift":70000,
            "totalDebts":0,"totalBonuses":0}},
            {"id":"op-2","name":"Данияр","is_active":true,"role":"operator",
            "has_staff_link":true,"stats":{"totalShifts":0,"totalTurnover":0,
            "avgPerShift":0,"totalDebts":0,"totalBonuses":0}}]}
            """
        ).data

        #expect(list.count == 2)
        #expect(list.first?.hasStaffLink == false)
        #expect(list.last?.hasStaffLink == true)
    }

    @Test("Старый сервер без флага не помечает всех сломанными")
    func staffLinkDefaultsToPresent() throws {
        let list = try decode(
            DataListWrapper<TeamOperator>.self,
            #"{"data":[{"id":"op-3","name":"Ержан","is_active":true,"role":"operator","stats":{"totalShifts":0,"totalTurnover":0,"avgPerShift":0,"totalDebts":0,"totalBonuses":0}}]}"#
        ).data

        #expect(list.first?.hasStaffLink == true)
    }

    /// Списочный ответ `{ "data": [...] }`.
    private struct DataListWrapper<Item: Decodable & Sendable>: Decodable, Sendable {
        let data: [Item]
    }

    // ── Тексты ошибок ────────────────────────────────────────────────────────

    @Test("Адрес маршрута не показывается человеку")
    func errorTextWithoutRoute() {
        let error = APIError.badRequest(
            code: "no-staff-link",
            message: "Ваш профиль оператора не связан с профилем сотрудника. · /api/operator/knowledge/confirm"
        )

        #expect(error.operatorMessage == "Ваш профиль оператора не связан с профилем сотрудника.")
        #expect(!error.userMessage.contains("/api/"))
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

    @Test("Что было сегодня: оплаты и поломки")
    func arenaToday() throws {
        let hall = try decode(
            DataEnvelope<ArenaHall>.self,
            """
            {"data":{"zones":[],"stations":[],"tariffs":[],"sessions":[],
            "today_income":{"cash":12500,"kaspi":8000,"rows":[
            {"cash_amount":2800,"kaspi_amount":0,"comment":"Арена: 801 — Час",
            "created_at":"2026-08-18T09:10:00.000Z"},
            {"cash_amount":0,"kaspi_amount":5600,"comment":"Арена: 705 — 2+1",
            "created_at":"2026-08-18T11:30:00.000Z"}]},
            "today_tech_logs":[{"id":"t-1","station_name":"803","reason":"Не работает мышь",
            "amount":3500,"created_at":"2026-08-18T10:00:00.000Z"}]}}
            """
        ).data

        #expect(hall.todayRows.count == 2)
        #expect(hall.todayTotal == 20_500)

        let first = try #require(hall.todayRows.first)
        #expect(first.comment == "Арена: 801 — Час")
        #expect(first.total == 2_800)

        let log = try #require(hall.techLogs.first)
        #expect(log.stationName == "803")
        #expect(log.reason == "Не работает мышь")
        #expect(log.amount == 3_500)
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

/// Кэш ответов.
///
/// Он показывает данные до того, как придёт свежий ответ, — значит промах в
/// ключе означает чужие цифры на экране. Такое не должно зависеть от удачи.
@Suite("Кэш ответов")
struct ResponseCacheTests {
    private func makeCache() -> ResponseCache {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("orda-cache-test-\(UUID().uuidString)", isDirectory: true)
        return ResponseCache(directory: directory)
    }

    @Test("Ответ возвращается по тому же запросу")
    func storesAndReads() async {
        let cache = makeCache()
        let request = APIRequest(path: "/api/admin/dashboard")

        await cache.store(Data("{\"ok\":true}".utf8), for: request, scope: "org-1")
        let data = await cache.data(for: request, scope: "org-1")

        #expect(data != nil)
    }

    @Test("Чужая организация не видит сохранённое")
    func isolatesOrganizations() async {
        let cache = makeCache()
        let request = APIRequest(path: "/api/admin/dashboard")

        await cache.store(Data("{\"revenue\":1000000}".utf8), for: request, scope: "org-1")

        // Владелец переключил организацию: заголовок другой, адрес тот же.
        // Без организации в ключе он увидел бы выручку соседней.
        let foreign = await cache.data(for: request, scope: "org-2")
        #expect(foreign == nil)
    }

    @Test("Параметры запроса входят в ключ")
    func separatesQueries() async {
        let cache = makeCache()
        let first = APIRequest(path: "/api/operator/salary", query: ["weekStart": "2026-08-10"])
        let second = APIRequest(path: "/api/operator/salary", query: ["weekStart": "2026-08-17"])

        await cache.store(Data("{\"week\":1}".utf8), for: first, scope: nil)

        #expect(await cache.data(for: first, scope: nil) != nil)
        #expect(await cache.data(for: second, scope: nil) == nil)
    }

    @Test("Ответы на POST не сохраняются")
    func ignoresWrites() async {
        let cache = makeCache()
        let request = APIRequest(path: "/api/admin/tasks", method: .post)

        await cache.store(Data("{\"ok\":true}".utf8), for: request, scope: nil)

        // Иначе повторное открытие экрана показывало бы результат чужого
        // действия как состояние системы.
        #expect(await cache.data(for: request, scope: nil) == nil)
    }
}

/// Очередь чек-листов, пройденных без связи.
///
/// Обход точки — двадцать минут работы, и терять её нельзя: телефон может
/// выключиться, приложение — выгрузиться. Поэтому очередь на диске, и на неё
/// есть тесты.
@Suite("Чек-листы без связи")
struct ChecklistOutboxTests {
    private func makeOutbox() -> ChecklistOutbox {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("orda-checklists-\(UUID().uuidString)", isDirectory: true)
        return ChecklistOutbox(directory: directory)
    }

    private func answer(_ id: String) -> ChecklistAnswer {
        ChecklistAnswer(itemID: id, answer: "yes")
    }

    @Test("Пройденное переживает выгрузку приложения")
    func survivesRestart() async {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("orda-checklists-\(UUID().uuidString)", isDirectory: true)

        let first = ChecklistOutbox(directory: directory)
        await first.add(
            ChecklistOutbox.Item(templateID: "t-1", title: "Приём смены", answers: [answer("i-1")])
        )

        // Второй экземпляр — как после перезапуска: память пуста, диск нет.
        let second = ChecklistOutbox(directory: directory)
        let pending = await second.pending()

        #expect(pending.count == 1)
        #expect(pending.first?.title == "Приём смены")
        #expect(pending.first?.answers.count == 1)
    }

    @Test("Повторный проход заменяет прежний, а не копится")
    func replacesSameTemplate() async {
        let outbox = makeOutbox()

        await outbox.add(ChecklistOutbox.Item(templateID: "t-1", title: "Обход", answers: [answer("i-1")]))
        await outbox.add(
            ChecklistOutbox.Item(templateID: "t-1", title: "Обход", answers: [answer("i-1"), answer("i-2")])
        )

        let pending = await outbox.pending()
        #expect(pending.count == 1)
        // Осталась последняя версия: человек прошёл заново, значит первая
        // неверна.
        #expect(pending.first?.answers.count == 2)
    }

    @Test("Отправленное уходит из очереди")
    func removesSent() async {
        let outbox = makeOutbox()
        let item = ChecklistOutbox.Item(templateID: "t-2", title: "Закрытие", answers: [answer("i-9")])

        await outbox.add(item)
        await outbox.remove(id: item.id)

        #expect(await outbox.pending().isEmpty)
    }
}

/// Очередь файлов, не ушедших из-за связи.
///
/// Фото поломки снимают в подсобке, где сети нет. Файл весит мегабайты и
/// живёт на диске — значит за ним надо убирать, иначе память телефона молча
/// заканчивается.
@Suite("Файлы без связи")
struct AttachmentOutboxTests {
    private func makeOutbox() -> AttachmentOutbox {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("orda-attachments-\(UUID().uuidString)", isDirectory: true)
        return AttachmentOutbox(directory: directory)
    }

    private func item(scope: AttachmentOutbox.Item.Scope = .teamChat, to userID: String? = nil) -> AttachmentOutbox.Item {
        AttachmentOutbox.Item(
            scope: scope,
            recipientUserID: userID,
            fileName: "photo.jpg",
            mimeType: "image/jpeg",
            kind: "photo",
            caption: "Сломан монитор 803"
        )
    }

    @Test("Файл и подпись переживают выгрузку приложения")
    func survivesRestart() async {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("orda-attachments-\(UUID().uuidString)", isDirectory: true)

        let first = AttachmentOutbox(directory: directory)
        let entry = item()
        await first.add(entry, data: Data([0x01, 0x02, 0x03]))

        let second = AttachmentOutbox(directory: directory)
        let pending = await second.pending()

        #expect(pending.count == 1)
        #expect(pending.first?.caption == "Сломан монитор 803")
        #expect(await second.data(for: entry.id)?.count == 3)
    }

    @Test("Отправленный файл удаляется с диска")
    func removesFile() async {
        let outbox = makeOutbox()
        let entry = item()

        await outbox.add(entry, data: Data([0x09]))
        await outbox.remove(id: entry.id)

        #expect(await outbox.pending().isEmpty)
        // Иначе снимки копятся в памяти телефона и никто об этом не узнает.
        #expect(await outbox.data(for: entry.id) == nil)
    }

    @Test("Чат и личная переписка не путаются")
    func separatesScopes() async {
        let outbox = makeOutbox()

        await outbox.add(item(scope: .teamChat), data: Data([0x01]))
        await outbox.add(item(scope: .direct, to: "u-1"), data: Data([0x02]))

        let pending = await outbox.pending()
        #expect(pending.filter { $0.scope == .teamChat }.count == 1)
        // У личного файла обязателен адресат: без него отправлять некуда.
        let direct = try? #require(pending.first { $0.scope == .direct })
        #expect(direct?.recipientUserID == "u-1")
    }
}

/// Очереди на общем телефоне.
///
/// Устройство на точке одно, а операторов несколько: смена сдаётся вместе с
/// телефоном. Неотправленная работа одного не должна уйти под именем другого —
/// это чужая смена, чужая касса и чужие штрафы.
@Suite("Очереди и смена человека")
struct QueueOwnershipTests {
    private func makeChecklists() -> ChecklistOutbox {
        ChecklistOutbox(
            directory: FileManager.default.temporaryDirectory
                .appendingPathComponent("orda-owner-\(UUID().uuidString)", isDirectory: true)
        )
    }

    @Test("Сменщик не видит и не отправляет чужое")
    func hidesForeignWork() async {
        let outbox = makeChecklists()

        await outbox.setOwner("op-1")
        await outbox.add(
            ChecklistOutbox.Item(
                templateID: "t-1",
                title: "Приём смены",
                answers: [ChecklistAnswer(itemID: "i-1", answer: "yes")]
            )
        )

        // Пришёл сменщик и вошёл под собой.
        await outbox.setOwner("op-2")
        #expect(await outbox.pending().isEmpty)

        // Первый вернулся — его работа на месте и ждёт отправки.
        await outbox.setOwner("op-1")
        #expect(await outbox.pending().count == 1)
    }

    @Test("Один шаблон у разных людей не затирается")
    func keepsBothOperators() async {
        let outbox = makeChecklists()
        let answers = [ChecklistAnswer(itemID: "i-1", answer: "yes")]

        await outbox.setOwner("op-1")
        await outbox.add(ChecklistOutbox.Item(templateID: "t-1", title: "Обход", answers: answers))

        await outbox.setOwner("op-2")
        await outbox.add(ChecklistOutbox.Item(templateID: "t-1", title: "Обход", answers: answers))

        // У каждого свой обход в свою смену: замена по шаблону работает только
        // внутри одного человека.
        #expect(await outbox.pending().count == 1)
        await outbox.setOwner("op-1")
        #expect(await outbox.pending().count == 1)
    }

    @Test("Записи прошлой версии без хозяина отправляются как раньше")
    func legacyItemsStillSend() async {
        let outbox = makeChecklists()

        // Такие записи появились до правки: у них не было и не могло быть
        // хозяина, и придержать их значило бы потерять работу насовсем.
        await outbox.add(
            ChecklistOutbox.Item(
                templateID: "t-0",
                title: "Старый обход",
                answers: [ChecklistAnswer(itemID: "i-1", answer: "yes")]
            )
        )

        await outbox.setOwner("op-7")
        #expect(await outbox.pending().count == 1)
    }
}
