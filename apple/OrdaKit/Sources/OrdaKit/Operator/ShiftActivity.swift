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

        public init(
            revenue: Double,
            receipts: Int,
            cash: Double,
            kaspi: Double,
            attention: String? = nil
        ) {
            self.revenue = revenue
            self.receipts = receipts
            self.cash = cash
            self.kaspi = kaspi
            self.attention = attention
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
