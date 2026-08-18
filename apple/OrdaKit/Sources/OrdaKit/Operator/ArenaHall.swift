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
    /// Что уже прошло за сегодня: оплаты и технические заметки.
    ///
    /// Оператор заступает на смену в середине дня и не знает, что было до
    /// него: сколько сдали, какую станцию чинили. Сервер это отдаёт с самого
    /// начала — приложение просто не читало.
    public let todayRows: [ArenaIncomeRow]
    public let techLogs: [ArenaTechLog]

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
        case techLogs = "today_tech_logs"
    }

    private struct TodayIncome: Decodable {
        let cash: Double?
        let kaspi: Double?
        let rows: [ArenaIncomeRow]?
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
        todayRows = income?.rows ?? []
        techLogs = (try? c.decodeIfPresent([ArenaTechLog].self, forKey: .techLogs)) as? [ArenaTechLog] ?? []
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

/// Одна оплата зала за сегодня.
public struct ArenaIncomeRow: Decodable, Sendable, Identifiable, Hashable {
    public let comment: String
    public let cash: Double
    public let kaspi: Double
    public let at: Date?

    public var total: Double { cash + kaspi }
    /// Строки приходят без своих идентификаторов — собираем из времени и текста.
    public var id: String { "\(at?.timeIntervalSince1970 ?? 0)-\(comment)" }

    private enum CodingKeys: String, CodingKey {
        case comment
        case cash = "cash_amount"
        case kaspi = "kaspi_amount"
        case at = "created_at"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        comment = try c.decodeFlexibleString(forKey: .comment) ?? "Арена"
        cash = try c.decodeIfPresent(Double.self, forKey: .cash) ?? 0
        kaspi = try c.decodeIfPresent(Double.self, forKey: .kaspi) ?? 0
        at = DateParsing.date(from: try c.decodeFlexibleString(forKey: .at))
    }
}

/// Техническая заметка по станции за сегодня.
public struct ArenaTechLog: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let stationName: String?
    public let reason: String
    public let amount: Double
    public let at: Date?

    private enum CodingKeys: String, CodingKey {
        case id, reason, amount
        case stationName = "station_name"
        case at = "created_at"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        stationName = try c.decodeFlexibleString(forKey: .stationName)
        reason = try c.decodeFlexibleString(forKey: .reason) ?? "Поломка"
        amount = try c.decodeIfPresent(Double.self, forKey: .amount) ?? 0
        at = DateParsing.date(from: try c.decodeFlexibleString(forKey: .at))
    }
}
