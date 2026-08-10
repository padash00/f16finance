import Foundation

// ── Конфигурация симуляции выручки ───────────────────────────────────────────
//
// Модель точки: какие зоны есть, сколько в них устройств, сколько часов в
// сутки они заняты и по каким тарифам. Из этого считается потенциал — сколько
// точка может зарабатывать, если предположения верны.
//
// Раньше приложение эту модель только показывало, а править её можно было
// исключительно на сайте — экран так и сообщал: «зоны и тарифы задают на
// сайте». Владелец, который хочет прикинуть «а если поднять цену часа»,
// упирался в ноутбук.

/// Тариф: сколько стоит пакет и сколько часов в него входит.
public struct SimulationTariffConfig: Sendable, Identifiable, Hashable, Codable {
    /// Идентификатор задаёт клиент: сервер по нему связывает доли зон, а при
    /// сохранении полностью заменяет конфиг точки.
    public var id: String
    public var name: String
    /// Оплаченные часы пакета.
    public var paidHours: Double
    /// Бонусные часы сверху — они удешевляют фактический час.
    public var bonusHours: Double
    public var price: Double
    public var sortOrder: Int

    public init(
        id: String = UUID().uuidString.lowercased(),
        name: String = "",
        paidHours: Double = 0,
        bonusHours: Double = 0,
        price: Double = 0,
        sortOrder: Int = 0
    ) {
        self.id = id
        self.name = name
        self.paidHours = paidHours
        self.bonusHours = bonusHours
        self.price = price
        self.sortOrder = sortOrder
    }

    /// Цена фактического часа: бонусные часы входят в знаменатель, поэтому
    /// «3+2 за 3600» дешевле в час, чем «3 за 3600».
    public var ratePerHour: Double {
        let hours = paidHours + bonusHours
        guard hours > 0 else { return 0 }
        return price / hours
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, price
        case paidHours = "paid_hours"
        case bonusHours = "bonus_hours"
        case sortOrder = "sort_order"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString.lowercased()
        name = try c.decodeFlexibleString(forKey: .name) ?? "Тариф"
        paidHours = try c.decodeFlexibleDouble(forKey: .paidHours) ?? 0
        bonusHours = try c.decodeFlexibleDouble(forKey: .bonusHours) ?? 0
        price = try c.decodeFlexibleDouble(forKey: .price) ?? 0
        sortOrder = Int(try c.decodeFlexibleDouble(forKey: .sortOrder) ?? 0)
    }
}

/// Доля тарифа в зоне: сколько процентов времени играют по этому пакету.
public struct SimulationMixEntry: Sendable, Hashable, Codable {
    public var tariffID: String
    public var sharePct: Double

    public init(tariffID: String, sharePct: Double) {
        self.tariffID = tariffID
        self.sharePct = sharePct
    }

    private enum CodingKeys: String, CodingKey {
        case tariffID = "tariff_id"
        case sharePct = "share_pct"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tariffID = try c.decodeFlexibleString(forKey: .tariffID) ?? ""
        sharePct = try c.decodeFlexibleDouble(forKey: .sharePct) ?? 0
    }
}

/// Зона: группа однотипных устройств с общей загрузкой и миксом тарифов.
public struct SimulationZoneConfig: Sendable, Identifiable, Hashable, Codable {
    /// Локальный идентификатор для списка. Сервер зоны пересоздаёт, поэтому
    /// при сохранении он не отправляется.
    public var id: String
    public var name: String
    public var deviceType: String
    public var deviceCount: Int
    /// Сколько часов в сутки устройство занято по предположению владельца.
    public var assumedOccupancyHours: Double
    public var tariffMix: [SimulationMixEntry]
    public var sortOrder: Int

    public init(
        id: String = UUID().uuidString.lowercased(),
        name: String = "",
        deviceType: String = "pc",
        deviceCount: Int = 0,
        assumedOccupancyHours: Double = 0,
        tariffMix: [SimulationMixEntry] = [],
        sortOrder: Int = 0
    ) {
        self.id = id
        self.name = name
        self.deviceType = deviceType
        self.deviceCount = deviceCount
        self.assumedOccupancyHours = assumedOccupancyHours
        self.tariffMix = tariffMix
        self.sortOrder = sortOrder
    }

    /// Сумма долей микса. Заметное отклонение от 100 означает, что конфиг
    /// заполнен небрежно, и потенциал занижен или завышен на ту же долю.
    public var shareSum: Double {
        tariffMix.reduce(0) { $0 + $1.sharePct }
    }

    private enum CodingKeys: String, CodingKey {
        case id, name
        case deviceType = "device_type"
        case deviceCount = "device_count"
        case assumedOccupancyHours = "assumed_occupancy_hours"
        case tariffMix = "tariff_mix"
        case sortOrder = "sort_order"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString.lowercased()
        name = try c.decodeFlexibleString(forKey: .name) ?? "Зона"
        deviceType = try c.decodeFlexibleString(forKey: .deviceType) ?? "pc"
        deviceCount = Int(try c.decodeFlexibleDouble(forKey: .deviceCount) ?? 0)
        assumedOccupancyHours = try c.decodeFlexibleDouble(forKey: .assumedOccupancyHours) ?? 0
        tariffMix = (try? c.decodeIfPresent([SimulationMixEntry].self, forKey: .tariffMix)) as? [SimulationMixEntry] ?? []
        sortOrder = Int(try c.decodeFlexibleDouble(forKey: .sortOrder) ?? 0)
    }

    /// Зона уходит на сервер без идентификатора: он там свой.
    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(name, forKey: .name)
        try c.encode(deviceType, forKey: .deviceType)
        try c.encode(deviceCount, forKey: .deviceCount)
        try c.encode(assumedOccupancyHours, forKey: .assumedOccupancyHours)
        try c.encode(tariffMix, forKey: .tariffMix)
        try c.encode(sortOrder, forKey: .sortOrder)
    }
}

/// Что уходит в `POST /api/admin/simulation`.
///
/// Сервер заменяет конфиг точки целиком: удаляет прежние зоны и тарифы и
/// вставляет присланные. Отправлять поэтому нужно весь набор.
struct SimulationSaveRequest: Encodable {
    let companyID: String
    let zones: [SimulationZoneConfig]
    let tariffs: [SimulationTariffConfig]

    private enum CodingKeys: String, CodingKey {
        case zones, tariffs
        case companyID = "company_id"
    }
}

/// Проверки конфигурации до отправки.
public enum SimulationConfigCheck {
    /// Что мешает сохранить. `nil` — можно.
    ///
    /// Сервер молча выбрасывает тарифы без часов и доли несуществующих
    /// тарифов. Молча — значит владелец сохранит, вернётся и не найдёт своей
    /// строки, не понимая почему.
    public static func blocker(zones: [SimulationZoneConfig], tariffs: [SimulationTariffConfig]) -> String? {
        if tariffs.isEmpty && zones.isEmpty { return nil }
        if tariffs.contains(where: { $0.paidHours + $0.bonusHours <= 0 }) {
            return "У каждого тарифа должны быть часы: иначе он не сохранится."
        }
        if tariffs.contains(where: { $0.price <= 0 }) {
            return "У каждого тарифа должна быть цена."
        }
        if zones.contains(where: { $0.deviceCount <= 0 }) {
            return "В каждой зоне должно быть хотя бы одно устройство."
        }
        return nil
    }

    /// Предупреждения — сохранить можно, но результат будет странным.
    public static func warnings(zones: [SimulationZoneConfig], tariffs: [SimulationTariffConfig]) -> [String] {
        var result: [String] = []

        for zone in zones where zone.tariffMix.isEmpty && zone.deviceCount > 0 {
            result.append("В зоне «\(zone.name.isEmpty ? "Без названия" : zone.name)» не задан ни один тариф — она даст ноль.")
        }
        for zone in zones where !zone.tariffMix.isEmpty && abs(zone.shareSum - 100) > 1 {
            result.append("Доли в зоне «\(zone.name.isEmpty ? "Без названия" : zone.name)» дают \(Int(zone.shareSum.rounded())) % вместо 100 %.")
        }
        for zone in zones where zone.assumedOccupancyHours > 24 {
            result.append("Загрузка зоны «\(zone.name)» больше 24 часов в сутки.")
        }
        return result
    }
}
