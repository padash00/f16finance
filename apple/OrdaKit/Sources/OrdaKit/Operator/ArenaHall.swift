import Foundation

/// Зал компьютерного клуба: станции, тарифы и запущенные сессии.
///
/// Зоны, станции и тарифы — те же модели, что у владельца в разделе «Зал»:
/// строки в базе одни и те же, и заводить им вторые описания значило бы
/// чинить разбор дважды.
///
/// Оператор клуба ничего не продаёт за прилавком — его работа это зал: кто где
/// сидит, у кого через десять минут кончается время, кому продлить. До сих пор
/// всё это жило только в программе за стойкой, и стоило отойти — человек
/// переставал видеть зал.
public struct ArenaHall: Decodable, Sendable {
    public let zones: [ArenaZone]
    public let stations: [ArenaStation]
    public let tariffs: [ArenaTariff]
    public let sessions: [ArenaSession]
    public let todayCash: Double
    public let todayKaspi: Double

    public var todayTotal: Double { todayCash + todayKaspi }

    /// Сессия за станцией, если та занята.
    public func session(stationID: String) -> ArenaSession? {
        sessions.first { $0.stationID == stationID && $0.isActive }
    }

    public var busyCount: Int { stations.filter { session(stationID: $0.id) != nil }.count }

    /// Станции зоны в том порядке, в каком они стоят в зале.
    public func stations(zoneID: String?) -> [ArenaStation] {
        stations
            .filter { $0.zoneID == zoneID }
            .sorted { left, right in
                if left.orderIndex != right.orderIndex { return left.orderIndex < right.orderIndex }
                return left.name.localizedStandardCompare(right.name) == .orderedAscending
            }
    }

    /// Тарифы, которые можно предложить на этой станции.
    ///
    /// Тариф зоны — только для станций своей зоны; общий (без зоны) годится
    /// везде. Иначе оператор запускал бы ночной пакет VIP-зоны на обычной
    /// машине, а цена бы не сходилась.
    ///
    /// Сервер уже отсеял те, что сейчас не предлагаются: ночной пакет днём в
    /// список не приходит.
    public func tariffs(for station: ArenaStation) -> [ArenaTariff] {
        tariffs
            .filter { $0.isActive && ($0.zoneID == nil || $0.zoneID == station.zoneID) }
            .sorted { $0.price < $1.price }
    }

    private enum CodingKeys: String, CodingKey {
        case zones, stations, tariffs, sessions
        case todayIncome = "today_income"
    }

    private struct TodayIncome: Decodable {
        let cash: Double?
        let kaspi: Double?
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        zones = try c.decodeIfPresent([ArenaZone].self, forKey: .zones) ?? []
        stations = try c.decodeIfPresent([ArenaStation].self, forKey: .stations) ?? []
        tariffs = try c.decodeIfPresent([ArenaTariff].self, forKey: .tariffs) ?? []
        sessions = try c.decodeIfPresent([ArenaSession].self, forKey: .sessions) ?? []

        let income = try c.decodeIfPresent(TodayIncome.self, forKey: .todayIncome)
        todayCash = income?.cash ?? 0
        todayKaspi = income?.kaspi ?? 0
    }
}

/// Запущенная сессия за станцией.
public struct ArenaSession: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let stationID: String
    public let tariffID: String?
    public let startedAt: Date?
    public let endsAt: Date?
    public let amount: Double
    public let cashAmount: Double
    public let kaspiAmount: Double
    public let status: String

    public var isActive: Bool { status == "active" }

    /// Сколько осталось. Отрицательное — время вышло, а гость ещё сидит: это
    /// не ошибка, а обычное дело, и оператор должен видеть, насколько
    /// просрочено.
    public func remaining(now: Date = Date()) -> TimeInterval {
        guard let endsAt else { return 0 }
        return endsAt.timeIntervalSince(now)
    }

    public func isExpired(now: Date = Date()) -> Bool { remaining(now: now) <= 0 }

    /// Меньше десяти минут — пора подойти и спросить, продлевает ли гость.
    public func isEndingSoon(now: Date = Date()) -> Bool {
        let left = remaining(now: now)
        return left > 0 && left <= 10 * 60
    }

    private enum CodingKeys: String, CodingKey {
        case id, amount, status
        case stationID = "station_id"
        case tariffID = "tariff_id"
        case startedAt = "started_at"
        case endsAt = "ends_at"
        case cashAmount = "cash_amount"
        case kaspiAmount = "kaspi_amount"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? ""
        stationID = try c.decodeFlexibleString(forKey: .stationID) ?? ""
        tariffID = try c.decodeFlexibleString(forKey: .tariffID)
        startedAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .startedAt))
        endsAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .endsAt))
        amount = try c.decodeIfPresent(Double.self, forKey: .amount) ?? 0
        cashAmount = try c.decodeIfPresent(Double.self, forKey: .cashAmount) ?? 0
        kaspiAmount = try c.decodeIfPresent(Double.self, forKey: .kaspiAmount) ?? 0
        status = try c.decodeFlexibleString(forKey: .status) ?? "active"
    }
}

/// Как гость платит. Смешанная оплата — обычное дело: часть налом, остаток
/// переводом, потому что «на карте не хватает».
public enum ArenaPayment: String, Sendable, CaseIterable {
    case cash
    case kaspi
    case mixed

    public var title: String {
        switch self {
        case .cash: "Наличные"
        case .kaspi: "Kaspi"
        case .mixed: "Смешанно"
        }
    }
}
