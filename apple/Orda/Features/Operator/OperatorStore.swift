import Foundation
import OrdaKit
import SwiftUI

/// Состояние операторского рабочего дня: смена, каталог витрины, корзина и
/// очередь неотправленных чеков.
///
/// Один объект на всё пространство оператора — экраны смены, продажи и ревизии
/// смотрят на одну и ту же смену. Разъехавшееся состояние здесь стоило бы
/// расхождения в деньгах.
@MainActor
@Observable
final class OperatorStore {
    // ── Смена ────────────────────────────────────────────────────────────────

    private(set) var shiftState: ShiftState?
    private(set) var isLoadingShift = false
    private(set) var shiftError: String?

    var shift: OperatorShift? { shiftState?.shift }
    var totals: ShiftTotals { shiftState?.totals ?? .empty }
    var hasOpenShift: Bool { shift?.isOpen == true }
    /// Смена открыта, но не мной: на точке стоит сменщик. Смотреть чужую
    /// выручку и закрывать чужую смену нельзя — сервер такой запрос и так
    /// отвергнет, но кнопку показывать незачем.
    var isSomeoneElsesShift: Bool { hasOpenShift && shiftState?.isMine == false }
    var isMyShift: Bool { hasOpenShift && shiftState?.isMine != false }
    var blockingChecklists: [ChecklistTemplate] { shiftState?.blockingChecklists ?? [] }

    // ── Каталог и корзина ────────────────────────────────────────────────────

    private(set) var catalog: [SaleCatalogItem] = []
    private(set) var recentSales: [RecentSale] = []
    private(set) var companyName = "Точка"
    private(set) var isLoadingCatalog = false
    private(set) var catalogError: String?
    /// Почему не сохранился пересчёт, отправленный при уходе с экрана.
    var auditSaveError: String?

    private(set) var cart: [SaleLine] = []
    var cartTotal: Double { cart.reduce(0) { $0 + $1.total } }
    var cartCount: Int { cart.count }

    // ── Очередь ──────────────────────────────────────────────────────────────

    private(set) var queuedSalesCount = 0

    /// Последнее событие продажи — для показа подтверждения и чека.
    private(set) var lastSale: SaleFeedback?

    struct SaleFeedback: Identifiable, Equatable {
        let id = UUID()
        let total: Double
        let receiptURL: String?
        let wasQueued: Bool
    }

    private let service: OperatorService
    private let queue: SaleQueue
    private let outbox: ActionOutbox

    /// Сколько действий смены ждёт сети: чек-листы, подтверждения регламентов,
    /// ответы на задачи. Отдельно от чеков — у них своя очередь и свои деньги.
    private(set) var queuedActionsCount = 0

    init(api: APIClient, outbox: ActionOutbox) {
        let service = OperatorService(api: api, outbox: outbox)
        self.service = service
        self.outbox = outbox
        self.queue = SaleQueue(service: service)

        #if os(iOS)
        // Адрес карточки на блокировке отдаём серверу: продажи пробивают на
        // точке, в операторской программе, и досылать карточке новые цифры
        // может только он. Приложение до этого обновляло её само — то есть
        // лишь пока телефон в руках.
        ShiftLiveActivityController.registerToken = { [weak self] token in
            guard let self else { return }
            Task { await self.sendActivityToken(token) }
        }
        ShiftLiveActivityController.forgetToken = { [weak self] token in
            guard let self else { return }
            Task { await self.forgetActivityToken(token) }
        }
        #endif
    }

    #if os(iOS)
    private func sendActivityToken(_ token: String) async {
        guard let shift, !shift.companyID.isEmpty else { return }
        await service.registerLiveActivityToken(
            token: token,
            companyID: shift.companyID,
            shiftID: shift.id
        )
    }

    private func forgetActivityToken(_ token: String) async {
        await service.forgetLiveActivityToken(token: token)
    }
    #endif

    // ── Загрузка ─────────────────────────────────────────────────────────────

    func bootstrap() async {
        #if os(iOS)
        // Активность переживает выгрузку процесса: не подобрав её, приложение
        // завело бы вторую карточку поверх первой.
        ShiftLiveActivityController.adopt()
        #endif
        await queue.load()
        await outbox.load()
        await refreshQueueCount()
        await loadShift()
        // Накопленные офлайн-чеки уходят при первой же возможности — деньги
        // не должны лежать на устройстве дольше необходимого.
        await flushQueue()
    }

    func loadShift() async {
        isLoadingShift = true
        shiftError = nil
        defer { isLoadingShift = false }

        do {
            shiftState = try await service.currentShift()
            syncLiveActivity()
        } catch let error as APIError {
            shiftError = error.operatorMessage
        } catch {
            shiftError = error.localizedDescription
        }
    }

    /// Держать карточку на экране блокировки в согласии со сменой.
    ///
    /// Одна точка сборки вместо вызовов из каждого места: смена открывается,
    /// закрывается и перезагружается из полудюжины экранов, и забытая ветка
    /// оставила бы на блокировке карточку закрытой смены — с чужими деньгами.
    ///
    /// Карточку показываем только на своей смене: на чужой оператор и в
    /// приложении не видит ни выручки, ни закрытия.
    private func syncLiveActivity() {
        #if os(iOS)
        guard hasOpenShift, isMyShift, let shift, let openedAt = shift.openedAt else {
            ShiftLiveActivityController.stop()
            return
        }

        let state = ShiftActivityAttributes.ContentState(
            revenue: hall == nil ? totals.netTotal : (hall?.todayTotal ?? 0),
            receipts: totals.salesCount,
            cash: totals.expectedCash,
            kaspi: totals.expectedKaspi,
            attention: liveActivityAttention,
            busyStations: hall?.busyCount,
            totalStations: hall.map { $0.stations.count },
            nextSessionEndsAt: nextSessionEnd
        )
        ShiftLiveActivityController.start(
            pointName: companyName,
            openedAt: openedAt,
            isNight: shift.shiftType == "night",
            state: state
        )
        #endif
    }

    /// Состояние зала, если точка с залом. Приносит `ArenaStore`: считать зал
    /// здесь значило бы завести второй источник тех же цифр.
    private(set) var hall: ArenaHall?

    func updateHall(_ hall: ArenaHall?) {
        self.hall = hall
        syncLiveActivity()
    }

    /// Когда освободится ближайшая занятая станция.
    ///
    /// Именно за этим оператор клуба и смотрит в телефон: подойти до того, как
    /// время кончится, а не после.
    private var nextSessionEnd: Date? {
        guard let hall else { return nil }
        return hall.sessions
            .filter(\.isActive)
            .compactMap(\.endsAt)
            .min()
    }

    /// Что показать строкой предупреждения. Пусто — всё в порядке.
    private var liveActivityAttention: String? {
        if queuedSalesCount > 0 {
            return "\(queuedSalesCount) \(pluralize(queuedSalesCount, "чек", "чека", "чеков")) не отправлен"
        }
        if queuedActionsCount > 0 {
            return "\(queuedActionsCount) \(pluralize(queuedActionsCount, "действие ждёт", "действия ждут", "действий ждут")) сети"
        }
        return nil
    }

    /// Сохранить подсчёты ревизии.
    ///
    /// Через хранилище, а не напрямую из экрана: здесь живёт сервис с очередью
    /// отложенных действий, и без неё пересчёт на складе без связи просто
    /// пропал бы. `nil` — легло в очередь.
    func saveAuditCounts(actID: String, counts: [AuditCount]) async throws -> AuditSaveResult? {
        let result = try await service.saveAuditCounts(actID: actID, counts: counts)
        await refreshQueuedCounts()
        auditSaveError = nil
        return result
    }

    /// Досылка пересчёта, когда экрана уже нет.
    ///
    /// Уходя с подсчёта, отправить остаток надо, а показать отказ негде: экран
    /// закрывается. Поэтому причина ложится сюда и ждёт на списке актов —
    /// иначе час работы пропадал бы молча.
    func flushAuditCounts(actID: String, counts: [AuditCount]) async {
        guard !counts.isEmpty else { return }
        do {
            _ = try await saveAuditCounts(actID: actID, counts: counts)
        } catch let error as APIError {
            auditSaveError = error.operatorMessage
        } catch {
            auditSaveError = error.localizedDescription
        }
    }

    /// Кто вошёл. Очереди на диске общие для устройства, а телефон на точке
    /// общий тоже: без хозяина неотправленный чек сменщика ушёл бы в смену
    /// того, кто сейчас в приложении.
    func setQueueOwner(_ userID: String?) async {
        await queue.setOwner(userID)
        await outbox.setOwner(userID)
        await refreshQueuedCounts()
    }

    func loadCatalog() async {
        isLoadingCatalog = true
        catalogError = nil
        defer { isLoadingCatalog = false }

        do {
            let loaded = try await service.saleCatalog()
            catalog = loaded.items
            recentSales = loaded.recentSales
            companyName = loaded.companyName
        } catch let error as APIError {
            catalogError = error.operatorMessage
        } catch {
            catalogError = error.localizedDescription
        }
    }

    // ── Смена ────────────────────────────────────────────────────────────────

    func openShift(openingCash: Double, kind: ShiftKind) async -> String? {
        do {
            _ = try await service.openShift(openingCash: openingCash, shiftType: kind)
            await loadShift()
            return nil
        } catch let error as APIError {
            return error.operatorMessage
        } catch {
            return error.localizedDescription
        }
    }

    /// Закрытие смены.
    ///
    /// Kaspi ночной смены сервер хранит раздельно: часть выручки проходит до
    /// полуночи, часть после, и в ОПиУ они попадают в разные дни. В программе
    /// на точке это два поля, здесь было одно — и вся ночная выручка ложилась
    /// на дату закрытия.
    /// Сегодняшняя дата в формате отчёта.
    static func today() -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: Date())
    }

    func closeShift(
        cash: Double,
        kaspi: Double,
        kaspiBeforeMidnight: Double = 0,
        kaspiAfterMidnight: Double = 0,
        notes: String?,
        report: ShiftReportDraft? = nil
    ) async -> String? {
        // Отправлять закрытие с неотправленными чеками нельзя: их суммы ещё не
        // попали в итоги смены, и касса не сойдётся.
        if queuedSalesCount > 0 {
            await flushQueue()
            if queuedSalesCount > 0 {
                return "Осталось \(queuedSalesCount) неотправленных чеков. Подключитесь к сети — смена закроется с верными суммами."
            }
        }

        do {
            let shiftID = shift?.id
            let shiftType = shift?.shiftType ?? "day"

            _ = try await service.closeShift(
                closingCash: cash,
                closingKaspi: kaspi,
                kaspiBeforeMidnight: kaspiBeforeMidnight,
                kaspiAfterMidnight: kaspiAfterMidnight,
                notes: notes
            )

            // Отчёт — отдельным шагом после закрытия: закрытие фиксирует
            // пересчёт кассы, а выручка дня берётся из отчёта. Раньше из
            // приложения уходило только закрытие, и смены не было ни в ОПиУ,
            // ни в зарплате.
            if let report {
                do {
                    try await service.sendShiftReport(
                        ShiftReportDraft(
                            date: Self.today(),
                            shift: shiftType,
                            shiftID: shiftID,
                            cash: report.cash,
                            coins: report.coins,
                            kaspiPOS: report.kaspiPOS,
                            kaspiOnline: report.kaspiOnline,
                            kaspiBeforeMidnight: report.kaspiBeforeMidnight,
                            debts: report.debts,
                            startCash: report.startCash,
                            wipon: report.wipon,
                            comment: notes
                        )
                    )
                } catch {
                    // Смена уже закрыта — молчать об этом нельзя, но и
                    // «не удалось закрыть» сказать неправда.
                    await loadShift()
                    return "Смена закрыта, но отчёт не ушёл. Отправьте его из программы на точке или повторите позже."
                }
            }

            await loadShift()
            return nil
        } catch let error as APIError {
            return error.operatorMessage
        } catch {
            return error.localizedDescription
        }
    }

    // ── Корзина ──────────────────────────────────────────────────────────────

    /// Добавить товар. Повторное добавление увеличивает количество — при
    /// сканировании одинаковых позиций подряд это единственное разумное
    /// поведение.
    func add(_ item: SaleCatalogItem, quantity: Double = 1) {
        guard let price = item.salePrice, price > 0 else { return }

        if let index = cart.firstIndex(where: { $0.itemID == item.id }) {
            cart[index].quantity += quantity
        } else {
            cart.append(SaleLine(itemID: item.id, name: item.name, quantity: quantity, unitPrice: price))
        }
    }

    func setQuantity(_ quantity: Double, for itemID: String) {
        guard let index = cart.firstIndex(where: { $0.itemID == itemID }) else { return }
        if quantity <= 0 {
            cart.remove(at: index)
        } else {
            cart[index].quantity = quantity
        }
    }

    func remove(itemID: String) {
        cart.removeAll { $0.itemID == itemID }
    }

    func clearCart() {
        cart.removeAll()
    }

    /// Найти товар по штрихкоду. Сравниваем без пробелов: сканер иногда
    /// добавляет их по краям.
    func item(barcode: String) -> SaleCatalogItem? {
        let needle = barcode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !needle.isEmpty else { return nil }
        return catalog.first { ($0.barcode ?? "").trimmingCharacters(in: .whitespacesAndNewlines) == needle }
    }

    // ── Продажа ──────────────────────────────────────────────────────────────

    func checkout(
        method: PaymentMethod,
        cash: Double,
        kaspi: Double,
        customerID: String? = nil
    ) async -> String? {
        guard !cart.isEmpty else { return "Корзина пуста." }

        let kind: ShiftKind = shift?.shiftType == "night" ? .night : .day
        var draft = SaleDraft(
            saleDate: DateParsing.dateOnlyString(from: Date()),
            shift: kind,
            lines: cart,
            paymentMethod: method,
            cashAmount: cash,
            kaspiAmount: kaspi,
            // Без клиента бонусы не начисляются: карта на брелке есть, а чек
            // уходит «в никуда». Сервер принимал клиента с самого начала —
            // приложение просто не умело его выбрать.
            customerID: customerID
        )

        // Для ночной смены Kaspi обязан делиться на «до» и «после» полуночи.
        // Определяем по текущему времени: продажа проводится сейчас.
        if kind == .night, kaspi > 0 {
            let hour = Calendar.current.component(.hour, from: Date())
            if hour < 12 {
                draft.kaspiAfterMidnight = kaspi
            } else {
                draft.kaspiBeforeMidnight = kaspi
            }
        }

        switch await queue.submit(draft) {
        case let .sent(result):
            lastSale = SaleFeedback(total: result.totalAmount, receiptURL: result.receiptURL, wasQueued: false)
            clearCart()
            await loadShift()
            return nil

        case .queued:
            await refreshQueueCount()
            lastSale = SaleFeedback(total: draft.total, receiptURL: nil, wasQueued: true)
            clearCart()
            return nil

        case let .failed(error):
            return error.operatorMessage

        case let .rejected(issue):
            return issue.message
        }
    }

    func dismissLastSale() {
        lastSale = nil
    }

    // ── Очередь ──────────────────────────────────────────────────────────────

    func flushQueue() async {
        let result = await queue.flush()
        // Отложенные действия уходят вместе с чеками: связь появилась —
        // отправляем всё, что накопилось, а не только деньги.
        let actions = await outbox.flush()
        await refreshQueueCount()
        if result.sent > 0 || actions.sent > 0 {
            await loadShift()
        }
    }

    /// Пересчитать очереди.
    ///
    /// Не только после отправки: действие может лечь в очередь посреди смены —
    /// чек-лист сохранили без связи, — и до следующей отправки полоса в
    /// профиле об этом молчала.
    func refreshQueuedCounts() async {
        await refreshQueueCount()
        // Строка предупреждения на экране блокировки считается отсюда же.
        syncLiveActivity()
    }

    private func refreshQueueCount() async {
        queuedSalesCount = await queue.pendingCount
        queuedActionsCount = await outbox.pendingCount
    }
}
