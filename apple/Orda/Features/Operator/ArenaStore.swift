import Foundation
import OrdaKit
import SwiftUI

/// Зал клуба: состояние станций и действия по сессиям.
///
/// Живёт отдельно от смены: зал обновляется чаще всего остального — время
/// уходит каждую секунду, — и тянуть ради этого весь кабинет незачем.
@Observable
@MainActor
final class ArenaStore {
    private let service: OperatorService

    private(set) var hall: ArenaHall?
    private(set) var isLoading = false
    private(set) var error: String?

    /// Часы экрана. Отдельное поле, потому что обратный отсчёт должен идти и
    /// между запросами: гость смотрит не на сеть, а на минуты.
    private(set) var now = Date()

    /// Зал есть не у каждой точки. `false` — сервер сказал, что проекта нет,
    /// и раздел показывать нечего.
    private(set) var isAvailable = true

    private var lastLoadedAt: Date?
    private var isRefreshing = false

    init(service: OperatorService) {
        self.service = service
    }

    func load() async {
        if hall == nil { isLoading = true }
        defer { isLoading = false }

        do {
            hall = try await service.arena()
            now = Date()
            lastLoadedAt = now
            error = nil
            isAvailable = true
        } catch let apiError as APIError {
            // «Нет проекта точки» — не поломка, а устройство бизнеса: у
            // магазина зала нет и быть не должно.
            if apiError.isMissingArena {
                isAvailable = false
                error = nil
            } else {
                error = apiError.operatorMessage
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Тик часов: пересчитать остаток без запроса к серверу.
    ///
    /// Раз в полминуты заодно перечитываем зал: за станцией мог кто-то сесть
    /// или уйти из программы за стойкой, и экран, который врёт полсмены, хуже
    /// отсутствующего.
    func tick() {
        now = Date()
        guard let lastLoadedAt, now.timeIntervalSince(lastLoadedAt) > 30, !isRefreshing else { return }
        isRefreshing = true
        Task {
            await load()
            isRefreshing = false
        }
    }

    // ── Действия ─────────────────────────────────────────────────────────────

    func start(
        stationID: String,
        tariffID: String,
        payment: ArenaPayment,
        cash: Double,
        kaspi: Double,
        discountPercent: Double
    ) async -> String? {
        await run {
            try await service.startArenaSession(
                stationID: stationID,
                tariffID: tariffID,
                payment: payment,
                cash: cash,
                kaspi: kaspi,
                discountPercent: discountPercent
            )
        }
    }

    func end(sessionID: String) async -> String? {
        await run { try await service.endArenaSession(sessionID: sessionID) }
    }

    func refund(sessionID: String) async -> String? {
        await run { try await service.refundArenaSession(sessionID: sessionID) }
    }

    func extend(
        sessionID: String,
        tariffID: String,
        payment: ArenaPayment,
        cash: Double,
        kaspi: Double
    ) async -> String? {
        await run {
            try await service.extendArenaSession(
                sessionID: sessionID,
                tariffID: tariffID,
                payment: payment,
                cash: cash,
                kaspi: kaspi
            )
        }
    }

    func extendByAmount(
        sessionID: String,
        payment: ArenaPayment,
        cash: Double,
        kaspi: Double
    ) async -> String? {
        await run {
            try await service.extendArenaSessionByAmount(
                sessionID: sessionID,
                payment: payment,
                cash: cash,
                kaspi: kaspi
            )
        }
    }

    func logTech(station: ArenaStation?, reason: String, amount: Double) async -> String? {
        await run {
            try await service.logArenaTech(
                stationID: station?.id,
                stationName: station?.name,
                reason: reason,
                amount: amount
            )
        }
    }

    /// Действие и перезагрузка зала. Возвращает текст ошибки или `nil`.
    ///
    /// Перезагружаем всегда: за станцией мог кто-то ещё запустить сессию из
    /// программы за стойкой, и показывать своё представление зала после
    /// действия — верный способ разойтись с реальностью.
    private func run(_ action: () async throws -> Void) async -> String? {
        do {
            try await action()
            await load()
            return nil
        } catch let apiError as APIError {
            await load()
            return apiError.operatorMessage
        } catch {
            await load()
            return error.localizedDescription
        }
    }
}

extension APIError {
    /// У точки нет активного проекта зала — раздел ей просто не нужен.
    ///
    /// Сервер отвечает на это 404 с `no-point-project`, и путать такой ответ с
    /// поломкой нельзя: у магазина зала нет по устройству дела.
    var isMissingArena: Bool {
        guard case let .notFound(message) = self else { return false }
        return message.contains("point-project")
    }
}
