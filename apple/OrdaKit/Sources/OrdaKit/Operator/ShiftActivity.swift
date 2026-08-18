#if os(iOS)
import ActivityKit
import Foundation

/// Идущая смена на экране блокировки.
///
/// Оператор за стойкой достаёт телефон не ради приложения, а ради одного
/// вопроса: сколько уже наторговали и сколько времени до конца. Ради этого он
/// разблокирует телефон, ищет иконку, ждёт загрузку — и так двадцать раз за
/// смену. Живая активность отвечает на этот вопрос без единого касания.
///
/// Модель лежит в OrdaKit, потому что её должны видеть оба: приложение,
/// которое активность заводит, и расширение, которое её рисует. Копия в двух
/// местах разошлась бы при первой же правке, а расхождение здесь означает
/// молча пустой виджет.
public struct ShiftActivityAttributes: ActivityAttributes, Sendable {
    /// То, что меняется по ходу смены.
    public struct ContentState: Codable, Hashable, Sendable {
        public var revenue: Double
        public var receipts: Int
        public var cash: Double
        public var kaspi: Double
        /// Что требует внимания прямо сейчас: непройденный чек-лист,
        /// неотправленные чеки. Пусто — всё в порядке.
        public var attention: String?

        // ── Зал клуба ────────────────────────────────────────────────────────
        //
        // У клуба нет чеков, и карточка «выручка и чеки» показывала бы там два
        // нуля. Оператор клуба смотрит в телефон ради другого: сколько станций
        // занято и у кого вот-вот кончится время.

        /// Занято станций из скольких. `nil` — точка без зала.
        public var busyStations: Int?
        public var totalStations: Int?
        /// Когда закончится ближайшая сессия. Прошедшее время значит, что
        /// гость сидит сверх оплаченного.
        public var nextSessionEndsAt: Date?

        public var hasHall: Bool { totalStations != nil }

        public init(
            revenue: Double,
            receipts: Int,
            cash: Double,
            kaspi: Double,
            attention: String? = nil,
            busyStations: Int? = nil,
            totalStations: Int? = nil,
            nextSessionEndsAt: Date? = nil
        ) {
            self.revenue = revenue
            self.receipts = receipts
            self.cash = cash
            self.kaspi = kaspi
            self.attention = attention
            self.busyStations = busyStations
            self.totalStations = totalStations
            self.nextSessionEndsAt = nextSessionEndsAt
        }
    }

    /// Неизменное за смену.
    public let pointName: String
    public let openedAt: Date
    /// Дневная или ночная — от этого зависит подпись.
    public let isNight: Bool

    public init(pointName: String, openedAt: Date, isNight: Bool) {
        self.pointName = pointName
        self.openedAt = openedAt
        self.isNight = isNight
    }
}
#endif
