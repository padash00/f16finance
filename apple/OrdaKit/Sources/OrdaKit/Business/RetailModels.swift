import Foundation

// ── Календарные хелперы ──────────────────────────────────────────────────────

/// Даты без времени. Скидки, периоды аналитики и границы смен сервер хранит и
/// сравнивает по календарному дню, а не по моменту UTC: в Казахстане (UTC+5)
/// «сегодня» по Гринвичу до пяти утра — это ещё вчера.
enum RetailDay {
    static func string(_ date: Date, _ calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    /// Разница в календарных днях. Отрицательная — дата в прошлом.
    static func days(from now: Date, to date: Date, _ calendar: Calendar = .current) -> Int {
        let start = calendar.startOfDay(for: now)
        let end = calendar.startOfDay(for: date)
        return calendar.dateComponents([.day], from: start, to: end).day ?? 0
    }
}

// ── Скидки и промокоды: /api/admin/discounts ─────────────────────────────────

/// Чем скидка режет чек.
public enum DiscountKind: String, Sendable, Hashable, CaseIterable, Identifiable {
    case percent
    case fixed
    case promoCode = "promo_code"

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .percent: "Скидка %"
        case .fixed: "Фиксированная"
        case .promoCode: "Промокод"
        }
    }

    public var icon: String {
        switch self {
        case .percent: "percent"
        case .fixed: "banknote.fill"
        case .promoCode: "ticket.fill"
        }
    }

    /// Значение задаётся в процентах у всех типов, кроме фиксированной суммы:
    /// у промокода в `value` тоже лежит процент.
    public var isPercentBased: Bool { self != .fixed }
}

/// Что со скидкой прямо сейчас.
///
/// Одного флага `is_active` мало: скидка бывает включена, но с закончившимся
/// сроком или выбранным лимитом — на чек она уже не влияет, а в списке
/// выглядит рабочей.
public enum DiscountState: String, Sendable, Hashable {
    case live
    case scheduled
    case expired
    case exhausted
    case disabled

    public var title: String {
        switch self {
        case .live: "Действует"
        case .scheduled: "Запланирована"
        case .expired: "Истекла"
        case .exhausted: "Лимит выбран"
        case .disabled: "Выключена"
        }
    }

    /// Влияет ли скидка на чек прямо сейчас.
    public var isWorking: Bool { self == .live }
}

/// Скидка или промокод.
public struct Discount: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    /// `nil` — платформенная скидка на все организации; менять её может только
    /// суперадмин, сервер отвечает `global-discount-forbidden`.
    public let companyID: String?
    public let name: String
    public let kind: DiscountKind
    public let value: Double
    public let promoCode: String?
    public let minOrderAmount: Double
    public let isActive: Bool
    public let validFrom: Date?
    public let validTo: Date?
    /// `nil` — без ограничения по числу применений.
    public let usageLimit: Int?
    public let usageCount: Int
    public let createdAt: Date?

    public var isGlobal: Bool { companyID == nil }

    public var valueLabel: String {
        kind.isPercentBased ? Percent.format(value) : Money.format(value)
    }

    public var isExhausted: Bool {
        guard let usageLimit, usageLimit > 0 else { return false }
        return usageCount >= usageLimit
    }

    /// Насколько выбран лимит. `nil` — лимита нет, и доля ничего не значит.
    public var usageShare: Double? {
        guard let usageLimit, usageLimit > 0 else { return nil }
        return min(Double(usageCount) / Double(usageLimit), 1)
    }

    /// Сколько дней осталось до конца срока. `nil` — срок не задан.
    public var daysLeft: Int? {
        guard let validTo else { return nil }
        return RetailDay.days(from: Date(), to: validTo)
    }

    public var state: DiscountState { Discount.resolveState(of: self, on: Date()) }

    /// Состояние на заданный момент. Порядок проверок повторяет серверный
    /// `validatePromoCode`: сначала выключение, потом срок, потом лимит.
    public static func resolveState(of discount: Discount, on now: Date, calendar: Calendar = .current) -> DiscountState {
        if !discount.isActive { return .disabled }
        if let validTo = discount.validTo, RetailDay.days(from: now, to: validTo, calendar) < 0 { return .expired }
        if let validFrom = discount.validFrom, RetailDay.days(from: now, to: validFrom, calendar) > 0 { return .scheduled }
        if discount.isExhausted { return .exhausted }
        return .live
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        companyID = try c.decodeFlexibleString(forKey: .companyID)
        name = try c.decodeFlexibleString(forKey: .name) ?? "Без названия"
        kind = DiscountKind(rawValue: try c.decodeFlexibleString(forKey: .kind) ?? "") ?? .percent
        value = try c.decodeFlexibleDouble(forKey: .value) ?? 0
        promoCode = try c.decodeFlexibleString(forKey: .promoCode)
        minOrderAmount = try c.decodeFlexibleDouble(forKey: .minOrderAmount) ?? 0
        isActive = try c.decodeIfPresent(Bool.self, forKey: .isActive) ?? true
        validFrom = DateParsing.date(from: try c.decodeFlexibleString(forKey: .validFrom))
        validTo = DateParsing.date(from: try c.decodeFlexibleString(forKey: .validTo))
        let limit = try c.decodeFlexibleDouble(forKey: .usageLimit)
        usageLimit = limit.map { Int($0) }
        usageCount = Int(try c.decodeFlexibleDouble(forKey: .usageCount) ?? 0)
        createdAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .createdAt))
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, value
        case kind = "type"
        case companyID = "company_id"
        case promoCode = "promo_code"
        case minOrderAmount = "min_order_amount"
        case isActive = "is_active"
        case validFrom = "valid_from"
        case validTo = "valid_to"
        case usageLimit = "usage_limit"
        case usageCount = "usage_count"
        case createdAt = "created_at"
    }
}

/// Скидки, разложенные по состоянию.
///
/// Владельца интересует не список, а ответ на вопрос «что сейчас режет мой
/// чек». Поэтому действующие отделены от истёкших и выключенных, а отдельно
/// собраны те, что вот-вот кончатся: продлевать их надо до конца срока, а не
/// после жалобы клиента на кассе.
public struct DiscountBoard: Sendable {
    public let items: [Discount]
    public let live: [Discount]
    public let scheduled: [Discount]
    public let expired: [Discount]
    public let exhausted: [Discount]
    public let disabled: [Discount]
    /// Действующие, у которых срок кончается в ближайшую неделю.
    public let expiringSoon: [Discount]

    public var livePromoCodes: [Discount] { live.filter { $0.kind == .promoCode } }

    /// Самая глубокая процентная скидка среди действующих — верхняя граница
    /// того, сколько сейчас можно снять с чека.
    public var deepestPercent: Discount? {
        live.filter { $0.kind.isPercentBased }.max { $0.value < $1.value }
    }

    public init(_ items: [Discount], now: Date = Date()) {
        self.items = items
        var live: [Discount] = []
        var scheduled: [Discount] = []
        var expired: [Discount] = []
        var exhausted: [Discount] = []
        var disabled: [Discount] = []

        for item in items {
            switch Discount.resolveState(of: item, on: now) {
            case .live: live.append(item)
            case .scheduled: scheduled.append(item)
            case .expired: expired.append(item)
            case .exhausted: exhausted.append(item)
            case .disabled: disabled.append(item)
            }
        }

        self.live = live.sorted { $0.value > $1.value }
        self.scheduled = scheduled.sorted { ($0.validFrom ?? .distantFuture) < ($1.validFrom ?? .distantFuture) }
        self.expired = expired.sorted { ($0.validTo ?? .distantPast) > ($1.validTo ?? .distantPast) }
        self.exhausted = exhausted
        self.disabled = disabled
        self.expiringSoon = live
            .filter { discount in
                guard let days = discount.daysLeft else { return false }
                return days >= 0 && days <= 7
            }
            .sorted { ($0.daysLeft ?? 0) < ($1.daysLeft ?? 0) }
    }
}

/// Черновик скидки — то, что уходит в `createDiscount` / `updateDiscount`.
public struct DiscountDraft: Sendable {
    public var name: String
    public var kind: DiscountKind
    /// Держим строкой: поле ввода допускает пустоту и запятую, а `Double`
    /// заставил бы подставлять ноль там, где человек ещё ничего не написал.
    public var value: String
    public var promoCode: String
    public var minOrderAmount: String
    public var validFrom: Date?
    public var validTo: Date?
    public var usageLimit: String
    public var companyID: String?

    public init(
        name: String = "",
        kind: DiscountKind = .percent,
        value: String = "",
        promoCode: String = "",
        minOrderAmount: String = "",
        validFrom: Date? = nil,
        validTo: Date? = nil,
        usageLimit: String = "",
        companyID: String? = nil
    ) {
        self.name = name
        self.kind = kind
        self.value = value
        self.promoCode = promoCode
        self.minOrderAmount = minOrderAmount
        self.validFrom = validFrom
        self.validTo = validTo
        self.usageLimit = usageLimit
        self.companyID = companyID
    }

    public init(editing discount: Discount) {
        self.init(
            name: discount.name,
            kind: discount.kind,
            value: Quantity.format(discount.value),
            promoCode: discount.promoCode ?? "",
            minOrderAmount: discount.minOrderAmount > 0 ? Quantity.format(discount.minOrderAmount) : "",
            validFrom: discount.validFrom,
            validTo: discount.validTo,
            usageLimit: discount.usageLimit.map { String($0) } ?? "",
            companyID: discount.companyID
        )
    }

    private static func number(_ raw: String) -> Double? {
        let cleaned = raw
            .replacingOccurrences(of: ",", with: ".")
            .replacingOccurrences(of: "\u{202F}", with: "")
            .replacingOccurrences(of: " ", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty else { return nil }
        return Double(cleaned)
    }

    public var amount: Double? { Self.number(value) }

    /// Почему сохранять нельзя. Повторяет серверные проверки, чтобы человек
    /// узнал об ошибке до нажатия кнопки, а не из 400-го ответа.
    public var validationError: String? {
        if name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "Название скидки обязательно"
        }
        guard let amount, amount >= 0 else { return "Укажите размер скидки" }
        if kind.isPercentBased, amount > 100 { return "Процент не может быть больше 100" }
        if kind == .promoCode, promoCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "Введите промокод"
        }
        if let from = validFrom, let to = validTo, RetailDay.days(from: from, to: to) < 0 {
            return "Дата окончания раньше даты начала"
        }
        return nil
    }

    private func payload() -> [String: Any] {
        var payload: [String: Any] = [
            "name": name.trimmingCharacters(in: .whitespacesAndNewlines),
            "type": kind.rawValue,
            "value": amount ?? 0,
            "min_order_amount": Self.number(minOrderAmount) ?? 0,
        ]
        let code = promoCode.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        payload["promo_code"] = kind == .promoCode && !code.isEmpty ? code : NSNull()
        payload["valid_from"] = validFrom.map { RetailDay.string($0) } ?? NSNull()
        payload["valid_to"] = validTo.map { RetailDay.string($0) } ?? NSNull()
        if let limit = Self.number(usageLimit), limit >= 1 {
            payload["usage_limit"] = Int(limit)
        } else {
            payload["usage_limit"] = NSNull()
        }
        return payload
    }

    public func createBody() -> [String: Any] {
        var payload = payload()
        payload["company_id"] = companyID ?? NSNull()
        return ["action": "createDiscount", "payload": payload]
    }

    public func updateBody(id: String) -> [String: Any] {
        // company_id серверу не отдаём: перевесить скидку на другую точку
        // роут не умеет, а лишнее поле в payload молча проигнорируется —
        // и это выглядело бы как «сохранилось».
        ["action": "updateDiscount", "discountId": id, "payload": payload()]
    }

    /// Код в стиле веб-кабинета: без нуля, единицы, I и O — их путают
    /// в рукописной записи и по телефону.
    public static func generatedPromoCode() -> String {
        let alphabet = Array("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")
        return String((0..<8).compactMap { _ in alphabet.randomElement() })
    }
}

// ── Арена: /api/admin/arena (модуль addon.arena) ─────────────────────────────

/// Игровой проект в списке. Точки внутри — те, где арена включена флагом.
public struct ArenaProjectRef: Decodable, Sendable, Identifiable, Hashable {
    public struct PointRef: Decodable, Sendable, Identifiable, Hashable {
        public let id: String
        public let name: String

        public init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
            name = try c.decodeFlexibleString(forKey: .name) ?? "Точка"
        }

        private enum CodingKeys: String, CodingKey { case id, name }
    }

    public let id: String
    public let name: String
    public let points: [PointRef]

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        name = try c.decodeFlexibleString(forKey: .name) ?? "Проект"
        points = (try? c.decodeIfPresent([PointRef].self, forKey: .companies)) ?? []
    }

    private enum CodingKeys: String, CodingKey { case id, name, companies }
}

/// Ответ списочного режима: `{ data: { projects: [...] } }`.
public struct ArenaProjectList: Decodable, Sendable {
    public let projects: [ArenaProjectRef]

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        projects = (try? c.decodeIfPresent([ArenaProjectRef].self, forKey: .projects)) ?? []
    }

    private enum CodingKeys: String, CodingKey { case projects }
}

/// Зона зала: «PS5», «VIP», «Симуляторы».
public struct ArenaZone: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let isActive: Bool
    /// Цена часа продления. Сервер подставляет её из тарифов, если у зоны
    /// своей нет, — считать самим нечего.
    public let extensionHourlyPrice: Double?

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        name = try c.decodeFlexibleString(forKey: .name) ?? "Зона"
        isActive = try c.decodeIfPresent(Bool.self, forKey: .isActive) ?? true
        extensionHourlyPrice = try c.decodeFlexibleDouble(forKey: .extensionHourlyPrice)
    }

    private enum CodingKeys: String, CodingKey {
        case id, name
        case isActive = "is_active"
        case extensionHourlyPrice = "extension_hourly_price"
    }
}

/// Станция: приставка, ПК или симулятор.
public struct ArenaStation: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let zoneID: String?
    public let name: String
    public let orderIndex: Int
    public let isActive: Bool
    public let stationCode: String?
    public let deviceIP: String?
    public let deviceMAC: String?
    /// Последний сигнал от киоска на станции. `nil` — киоск на ней ни разу
    /// не поднимался (или это станция без киоска).
    public let lastHeartbeatAt: Date?
    public let kioskStatus: String?
    public let activeSessionID: String?
    public let activeSessionEndsAt: Date?

    public var isBusy: Bool { activeSessionID != nil }

    /// Сколько минут осталось у текущей сессии. Отрицательное — время вышло,
    /// а сессию никто не закрыл: клиент играет бесплатно.
    public func remainingMinutes(now: Date = Date()) -> Int? {
        guard let activeSessionEndsAt else { return nil }
        return Int((activeSessionEndsAt.timeIntervalSince(now) / 60).rounded())
    }

    public func isOverdue(now: Date = Date()) -> Bool {
        guard let remaining = remainingMinutes(now: now) else { return false }
        return remaining < 0
    }

    /// Киоск молчит дольше пятнадцати минут. Порог с запасом к обычному
    /// интервалу heartbeat — короткая сетевая заминка не должна выглядеть
    /// как погасшая станция.
    public func isSilent(now: Date = Date()) -> Bool {
        guard let lastHeartbeatAt else { return false }
        return now.timeIntervalSince(lastHeartbeatAt) > 15 * 60
    }

    /// Станция вообще не привязана к киоску: ни IP, ни MAC. Такую нельзя
    /// запустить удалённо — только вручную.
    public var isUnbound: Bool {
        (deviceIP ?? "").isEmpty && (deviceMAC ?? "").isEmpty
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        zoneID = try c.decodeFlexibleString(forKey: .zoneID)
        name = try c.decodeFlexibleString(forKey: .name) ?? "Станция"
        orderIndex = Int(try c.decodeFlexibleDouble(forKey: .orderIndex) ?? 0)
        isActive = try c.decodeIfPresent(Bool.self, forKey: .isActive) ?? true
        stationCode = try c.decodeFlexibleString(forKey: .stationCode)
        deviceIP = try c.decodeFlexibleString(forKey: .deviceIP)
        deviceMAC = try c.decodeFlexibleString(forKey: .deviceMAC)
        lastHeartbeatAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .lastHeartbeatAt))
        kioskStatus = try c.decodeFlexibleString(forKey: .kioskStatus)
        activeSessionID = try c.decodeFlexibleString(forKey: .activeSessionID)
        activeSessionEndsAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .activeSessionEndsAt))
    }

    private enum CodingKeys: String, CodingKey {
        case id, name
        case zoneID = "zone_id"
        case orderIndex = "order_index"
        case isActive = "is_active"
        case stationCode = "station_code"
        case deviceIP = "device_ip"
        case deviceMAC = "device_mac"
        case lastHeartbeatAt = "last_heartbeat_at"
        case kioskStatus = "kiosk_status"
        case activeSessionID = "active_session_id"
        case activeSessionEndsAt = "active_session_ends_at"
    }
}

/// Тариф зоны: «час», «три часа», «ночь».
public struct ArenaTariff: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let zoneID: String?
    public let name: String
    public let durationMinutes: Int
    public let price: Double
    public let isActive: Bool
    public let tariffType: String
    public let windowStart: String?
    public let windowEnd: String?

    /// Тариф действует только в окно времени (ночной, дневной).
    public var isWindowed: Bool { tariffType == "time_window" }

    public var windowLabel: String? {
        guard isWindowed, let windowStart, let windowEnd else { return nil }
        return "\(windowStart.prefix(5))–\(windowEnd.prefix(5))"
    }

    /// Цена часа. `nil` у тарифа нулевой длительности — делить не на что.
    public var hourlyPrice: Double? {
        guard durationMinutes > 0 else { return nil }
        return price / (Double(durationMinutes) / 60)
    }

    public var durationLabel: String {
        let hours = durationMinutes / 60
        let minutes = durationMinutes % 60
        if hours > 0 && minutes > 0 { return "\(hours) ч \(minutes) мин" }
        if hours > 0 { return "\(hours) ч" }
        return "\(minutes) мин"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        zoneID = try c.decodeFlexibleString(forKey: .zoneID)
        name = try c.decodeFlexibleString(forKey: .name) ?? "Тариф"
        durationMinutes = Int(try c.decodeFlexibleDouble(forKey: .durationMinutes) ?? 60)
        price = try c.decodeFlexibleDouble(forKey: .price) ?? 0
        isActive = try c.decodeIfPresent(Bool.self, forKey: .isActive) ?? true
        tariffType = try c.decodeFlexibleString(forKey: .tariffType) ?? "fixed"
        windowStart = try c.decodeFlexibleString(forKey: .windowStart)
        windowEnd = try c.decodeFlexibleString(forKey: .windowEnd)
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, price
        case zoneID = "zone_id"
        case durationMinutes = "duration_minutes"
        case isActive = "is_active"
        case tariffType = "tariff_type"
        case windowStart = "window_start_time"
        case windowEnd = "window_end_time"
    }
}

/// Игра из каталога проекта — то, что киоск показывает на станции.
public struct ArenaGameCard: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let title: String
    public let logoURL: String?
    public let isActive: Bool
    /// `game` / `browser` / `app` — киоск рисует их по-разному.
    public let category: String

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        title = try c.decodeFlexibleString(forKey: .title) ?? "Без названия"
        logoURL = try c.decodeFlexibleString(forKey: .logoURL)
        isActive = try c.decodeIfPresent(Bool.self, forKey: .isActive) ?? true
        category = try c.decodeFlexibleString(forKey: .category) ?? "game"
    }

    private enum CodingKeys: String, CodingKey {
        case id, title, category
        case logoURL = "logo_url"
        case isActive = "is_active"
    }
}

/// Привязка игры к станции. Сама по себе неинтересна — важно только, есть ли
/// у станции хоть одна: без привязок киоск покажет пустой экран.
public struct ArenaStationGame: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let stationID: String
    public let gameID: String
    public let isActive: Bool

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        stationID = try c.decodeFlexibleString(forKey: .stationID) ?? ""
        gameID = try c.decodeFlexibleString(forKey: .gameID) ?? ""
        isActive = try c.decodeIfPresent(Bool.self, forKey: .isActive) ?? true
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case stationID = "station_id"
        case gameID = "game_id"
        case isActive = "is_active"
    }
}

/// Зона вместе со своими станциями и тарифами.
public struct ArenaZoneGroup: Sendable, Identifiable, Hashable {
    public let zone: ArenaZone?
    public let stations: [ArenaStation]
    public let tariffs: [ArenaTariff]

    /// Станции без зоны собираются в отдельную группу — потерять их нельзя,
    /// но и приписывать к чужой зоне тоже.
    public var id: String { zone?.id ?? "unzoned" }
    public var title: String { zone?.name ?? "Без зоны" }

    public var busy: [ArenaStation] { stations.filter(\.isBusy) }

    /// Занятость зоны прямо сейчас. `nil` — работающих станций нет, и доля
    /// была бы делением на ноль.
    public var load: Double? {
        let working = stations.filter(\.isActive)
        guard !working.isEmpty else { return nil }
        return Double(busy.count) / Double(working.count)
    }

    public var activeTariffs: [ArenaTariff] {
        tariffs.filter(\.isActive).sorted { $0.price < $1.price }
    }
}

/// Зал проекта: зоны, станции, тарифы, каталог игр.
public struct ArenaBoard: Decodable, Sendable {
    public struct ProjectInfo: Decodable, Sendable, Hashable {
        public let id: String
        public let name: String
        public let description: String?
        public let logoURL: String?

        public init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decodeFlexibleString(forKey: .id) ?? ""
            name = try c.decodeFlexibleString(forKey: .name) ?? "Проект"
            description = try c.decodeFlexibleString(forKey: .description)
            logoURL = try c.decodeFlexibleString(forKey: .logoURL)
        }

        private enum CodingKeys: String, CodingKey {
            case id, name
            case description = "arena_description"
            case logoURL = "arena_logo_url"
        }
    }

    public let project: ProjectInfo?
    public let zones: [ArenaZone]
    public let stations: [ArenaStation]
    public let tariffs: [ArenaTariff]
    public let games: [ArenaGameCard]
    public let stationGames: [ArenaStationGame]

    // ── Срез зала ────────────────────────────────────────────────────────────

    public var workingStations: [ArenaStation] { stations.filter(\.isActive) }
    public var busyStations: [ArenaStation] { stations.filter(\.isBusy) }

    /// Доля занятых станций. `nil` — включённых станций нет вовсе.
    public var load: Double? {
        guard !workingStations.isEmpty else { return nil }
        return Double(busyStations.count) / Double(workingStations.count)
    }

    /// Сессии, у которых время вышло, а станцию никто не освободил.
    public func overdueStations(now: Date = Date()) -> [ArenaStation] {
        busyStations.filter { $0.isOverdue(now: now) }
    }

    /// Киоски, которые перестали выходить на связь.
    public func silentStations(now: Date = Date()) -> [ArenaStation] {
        workingStations.filter { $0.isSilent(now: now) }
    }

    /// Станции без привязанных игр: киоск на них покажет пустой список.
    public var stationsWithoutGames: [ArenaStation] {
        let bound = Set(stationGames.filter(\.isActive).map(\.stationID))
        return workingStations.filter { !bound.contains($0.id) }
    }

    /// Зоны с их станциями. Порядок станций — как в зале: сначала явный
    /// `order_index`, дальше по имени.
    public var groups: [ArenaZoneGroup] {
        let stationsByZone = Dictionary(grouping: stations) { $0.zoneID ?? "" }
        let tariffsByZone = Dictionary(grouping: tariffs) { $0.zoneID ?? "" }

        var result = zones.map { zone in
            ArenaZoneGroup(
                zone: zone,
                stations: (stationsByZone[zone.id] ?? []).sorted(by: Self.stationOrder),
                tariffs: tariffsByZone[zone.id] ?? []
            )
        }

        let unzoned = (stationsByZone[""] ?? []).sorted(by: Self.stationOrder)
        if !unzoned.isEmpty {
            result.append(ArenaZoneGroup(zone: nil, stations: unzoned, tariffs: []))
        }
        return result
    }

    /// Тарифы конкретной станции — те, что заданы её зоне.
    public func zoneTariffs(for station: ArenaStation) -> [ArenaTariff] {
        guard let zoneID = station.zoneID else { return [] }
        return tariffs.filter { $0.zoneID == zoneID && $0.isActive }.sorted { $0.price < $1.price }
    }

    private static func stationOrder(_ lhs: ArenaStation, _ rhs: ArenaStation) -> Bool {
        if lhs.orderIndex != rhs.orderIndex { return lhs.orderIndex < rhs.orderIndex }
        return lhs.name.localizedStandardCompare(rhs.name) == .orderedAscending
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        project = (try? c.decodeIfPresent(ProjectInfo.self, forKey: .project)) ?? nil
        zones = (try? c.decodeIfPresent([ArenaZone].self, forKey: .zones)) ?? []
        stations = (try? c.decodeIfPresent([ArenaStation].self, forKey: .stations)) ?? []
        tariffs = (try? c.decodeIfPresent([ArenaTariff].self, forKey: .tariffs)) ?? []
        games = (try? c.decodeIfPresent([ArenaGameCard].self, forKey: .gamesCatalog)) ?? []
        stationGames = (try? c.decodeIfPresent([ArenaStationGame].self, forKey: .stationGames)) ?? []
    }

    private enum CodingKeys: String, CodingKey {
        case project, zones, stations, tariffs, gamesCatalog, stationGames
    }
}

/// Игровая сессия из аналитики проекта.
public struct ArenaSessionRow: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let stationID: String?
    public let tariffID: String?
    public let stationName: String?
    public let tariffName: String?
    public let tariffMinutes: Int
    public let startedAt: Date?
    public let endedAt: Date?
    public let amount: Double
    public let status: String
    public let cashAmount: Double
    public let kaspiAmount: Double
    public let discountPercent: Double

    public var isCompleted: Bool { status == "completed" }

    private struct StationRef: Decodable {
        let name: String?
        init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            name = try c.decodeFlexibleString(forKey: .name)
        }
        private enum CodingKeys: String, CodingKey { case name }
    }

    private struct TariffRef: Decodable {
        let name: String?
        let durationMinutes: Double?
        init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            name = try c.decodeFlexibleString(forKey: .name)
            durationMinutes = try c.decodeFlexibleDouble(forKey: .durationMinutes)
        }
        private enum CodingKeys: String, CodingKey {
            case name
            case durationMinutes = "duration_minutes"
        }
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        stationID = try c.decodeFlexibleString(forKey: .stationID)
        tariffID = try c.decodeFlexibleString(forKey: .tariffID)

        // Связь приходит то объектом, то массивом — PostgREST решает это сам.
        let stationOne = (try? c.decodeIfPresent(StationRef.self, forKey: .station)) ?? nil
        let stationMany = (try? c.decodeIfPresent([StationRef].self, forKey: .station)) ?? nil
        stationName = stationOne?.name ?? stationMany?.first?.name

        let tariffOne = (try? c.decodeIfPresent(TariffRef.self, forKey: .tariff)) ?? nil
        let tariffMany = (try? c.decodeIfPresent([TariffRef].self, forKey: .tariff)) ?? nil
        let tariff = tariffOne ?? tariffMany?.first
        tariffName = tariff?.name
        tariffMinutes = Int(tariff?.durationMinutes ?? 0)

        startedAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .startedAt))
        endedAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .endedAt))
        amount = try c.decodeFlexibleDouble(forKey: .amount) ?? 0
        status = try c.decodeFlexibleString(forKey: .status) ?? "completed"
        cashAmount = try c.decodeFlexibleDouble(forKey: .cashAmount) ?? 0
        kaspiAmount = try c.decodeFlexibleDouble(forKey: .kaspiAmount) ?? 0
        discountPercent = try c.decodeFlexibleDouble(forKey: .discountPercent) ?? 0
    }

    private enum CodingKeys: String, CodingKey {
        case id, amount, status, station, tariff
        case stationID = "station_id"
        case tariffID = "tariff_id"
        case startedAt = "started_at"
        case endedAt = "ended_at"
        case cashAmount = "cash_amount"
        case kaspiAmount = "kaspi_amount"
        case discountPercent = "discount_percent"
    }
}

/// Ответ `getAnalytics`: `{ data: { sessions: [...] } }`.
public struct ArenaSessionList: Decodable, Sendable {
    public let sessions: [ArenaSessionRow]

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        sessions = (try? c.decodeIfPresent([ArenaSessionRow].self, forKey: .sessions)) ?? []
    }

    private enum CodingKeys: String, CodingKey { case sessions }
}

/// Выручка проекта за период.
///
/// Считаем по завершённым сессиям — так же, как страница арены в вебе:
/// у активной сессии деньги ещё не обязательно взяты, и включать её в кассу
/// значит показывать выручку, которой пока нет.
public struct ArenaRevenue: Sendable {
    public struct StationShare: Identifiable, Sendable, Hashable {
        public let id: String
        public let name: String
        public let amount: Double
        public let count: Int
        /// Проданных минут — из длительности тарифа, а не из фактического
        /// времени: продление и досрочный выход сервер в сессии не пишет.
        public let minutes: Int
    }

    public struct DayShare: Identifiable, Sendable, Hashable {
        public let day: Date
        public let amount: Double
        public var id: Date { day }
    }

    public let amount: Double
    public let count: Int
    public let cash: Double
    public let kaspi: Double
    public let minutes: Int
    public let byStation: [StationShare]
    public let byDay: [DayShare]

    public var averageCheck: Double { count > 0 ? amount / Double(count) : 0 }

    /// Средняя загрузка станций за период: проданные часы против календарных.
    /// `nil` — если станций или дней нет, доля бессмысленна.
    public func occupancy(stationCount: Int, days: Int) -> Double? {
        guard stationCount > 0, days > 0 else { return nil }
        let available = Double(stationCount * days * 24 * 60)
        guard available > 0 else { return nil }
        return min(Double(minutes) / available, 1)
    }

    public init(_ sessions: [ArenaSessionRow], calendar: Calendar = .current) {
        let completed = sessions.filter(\.isCompleted)
        amount = completed.reduce(0) { $0 + $1.amount }
        count = completed.count
        cash = completed.reduce(0) { $0 + $1.cashAmount }
        kaspi = completed.reduce(0) { $0 + $1.kaspiAmount }
        minutes = completed.reduce(0) { $0 + $1.tariffMinutes }

        var amounts: [String: Double] = [:]
        var counts: [String: Int] = [:]
        var stationMinutes: [String: Int] = [:]
        var names: [String: String] = [:]
        for session in completed {
            let key = session.stationID ?? "—"
            amounts[key, default: 0] += session.amount
            counts[key, default: 0] += 1
            stationMinutes[key, default: 0] += session.tariffMinutes
            if names[key] == nil { names[key] = session.stationName ?? "Станция" }
        }
        byStation = amounts
            .map { key, value in
                StationShare(
                    id: key,
                    name: names[key] ?? "Станция",
                    amount: value,
                    count: counts[key] ?? 0,
                    minutes: stationMinutes[key] ?? 0
                )
            }
            .sorted { $0.amount > $1.amount }

        var days: [Date: Double] = [:]
        for session in completed {
            guard let startedAt = session.startedAt else { continue }
            days[calendar.startOfDay(for: startedAt), default: 0] += session.amount
        }
        byDay = days.keys.sorted().map { DayShare(day: $0, amount: days[$0] ?? 0) }
    }
}

/// Период, за который смотрят арену.
public enum ArenaPeriod: String, CaseIterable, Identifiable, Sendable {
    case today, week, month

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .today: "Сегодня"
        case .week: "7 дней"
        case .month: "30 дней"
        }
    }

    public var days: Int {
        switch self {
        case .today: 1
        case .week: 7
        case .month: 30
        }
    }

    /// Границы периода полными моментами времени.
    ///
    /// Сервер фильтрует по `started_at` — это timestamp. Голая дата в верхней
    /// границе отрезала бы весь последний день: `started_at <= "2026-08-09"`
    /// не пропускает ничего, что произошло после полуночи.
    public func bounds(now: Date = Date(), calendar: Calendar = .current) -> (from: String, to: String) {
        let today = calendar.startOfDay(for: now)
        let start = calendar.date(byAdding: .day, value: -(days - 1), to: today) ?? today
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return (formatter.string(from: start), formatter.string(from: now))
    }
}

// ── Настройки магазина: /api/admin/store/config ──────────────────────────────

/// Точка организации в настройках магазина.
public struct RetailPoint: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let code: String?
    /// Точка работает как магазин: свой каталог, склад, витрина и касса.
    public let isStore: Bool

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        name = try c.decodeFlexibleString(forKey: .name) ?? "Точка"
        code = try c.decodeFlexibleString(forKey: .code)
        isStore = try c.decodeIfPresent(Bool.self, forKey: .isStore) ?? false
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, code
        case isStore = "store_enabled"
    }
}

/// Конфигурация модуля «Магазин».
public struct RetailConfig: Decodable, Sendable {
    /// Точка, которая открывается в модуле по умолчанию.
    public let defaultPointID: String?
    public let storePointIDs: [String]
    public let points: [RetailPoint]
    /// Право менять настройки по мнению сервера: владелец или менеджер.
    /// Отдельно от `store-settings.edit` — сервер проверяет оба.
    public let canManage: Bool

    public var storePoints: [RetailPoint] {
        let enabled = Set(storePointIDs)
        return points.filter { enabled.contains($0.id) || $0.isStore }
    }

    public var defaultPoint: RetailPoint? {
        guard let defaultPointID else { return nil }
        return points.first { $0.id == defaultPointID }
    }

    /// Магазины есть, а стартовая точка не выбрана — модуль откроется пустым,
    /// и разделы вроде смен магазина не поймут, чью кассу показывать.
    public var needsDefaultPoint: Bool {
        !storePoints.isEmpty && defaultPoint == nil
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        defaultPointID = try c.decodeFlexibleString(forKey: .defaultPointID)
        storePointIDs = (try? c.decodeIfPresent([String].self, forKey: .storePointIDs)) ?? []
        points = (try? c.decodeIfPresent([RetailPoint].self, forKey: .points)) ?? []
        canManage = try c.decodeIfPresent(Bool.self, forKey: .canManage) ?? false
    }

    private enum CodingKeys: String, CodingKey {
        case defaultPointID = "store_company_id"
        case storePointIDs = "store_enabled_ids"
        case points = "companies"
        case canManage = "can_manage"
    }
}

// ── Z-отчёт смены: /api/admin/shifts/z-report ────────────────────────────────

/// Строка товарного отчёта смены.
public struct ZReportPosition: Decodable, Sendable, Identifiable, Hashable {
    public let name: String
    public let unit: String
    public let sold: Double
    /// Остаток по всем локациям точки на момент запроса отчёта.
    public let stock: Double
    public let amount: Double

    public var id: String { "\(name)#\(unit)" }

    /// Товар продали в ноль. Не ошибка, но следующей смене продавать нечего.
    public var isOutOfStock: Bool { stock <= 0 }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decodeFlexibleString(forKey: .name) ?? "—"
        unit = try c.decodeFlexibleString(forKey: .unit) ?? ""
        sold = try c.decodeFlexibleDouble(forKey: .sold) ?? 0
        stock = try c.decodeFlexibleDouble(forKey: .stock) ?? 0
        amount = try c.decodeFlexibleDouble(forKey: .amount) ?? 0
    }

    private enum CodingKeys: String, CodingKey { case name, unit, sold, stock, amount }
}

/// Товар, взятый в долг на смене. В выручку не входит.
public struct ZReportDebt: Decodable, Sendable, Identifiable, Hashable {
    public let debtor: String
    public let item: String
    public let quantity: Double
    public let amount: Double

    public var id: String { "\(debtor)#\(item)#\(amount)" }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        debtor = try c.decodeFlexibleString(forKey: .debtor) ?? "Должник"
        item = try c.decodeFlexibleString(forKey: .item) ?? "—"
        quantity = try c.decodeFlexibleDouble(forKey: .quantity) ?? 0
        amount = try c.decodeFlexibleDouble(forKey: .amount) ?? 0
    }

    private enum CodingKeys: String, CodingKey { case debtor, item, quantity, amount }
}

/// Z-отчёт смены — то, что владелец печатает на A4 в веб-кабинете.
///
/// Все суммы считает сервер (`computeShiftReport`): продажи, возвраты, товарный
/// разрез и долги собираются по `shift_id` одним проходом. Здесь только
/// показываем — пересчитывать нечего.
public struct ZReport: Decodable, Sendable, Identifiable, Hashable {
    public struct Requisites: Decodable, Sendable, Hashable {
        public let name: String
        public let bin: String
        public let address: String
        public let kkmRegistration: String
        public let ofd: String

        public var isFilled: Bool { !name.isEmpty && !bin.isEmpty }

        /// Реквизитов может не быть вовсе — точка без карточки ККМ. Пустой
        /// набор честнее, чем провал разбора всего отчёта из-за одного поля.
        public static let empty = Requisites(name: "", bin: "", address: "", kkmRegistration: "", ofd: "")

        public init(name: String, bin: String, address: String, kkmRegistration: String, ofd: String) {
            self.name = name
            self.bin = bin
            self.address = address
            self.kkmRegistration = kkmRegistration
            self.ofd = ofd
        }

        public init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            name = try c.decodeFlexibleString(forKey: .name) ?? ""
            bin = try c.decodeFlexibleString(forKey: .bin) ?? ""
            address = try c.decodeFlexibleString(forKey: .address) ?? ""
            kkmRegistration = try c.decodeFlexibleString(forKey: .kkmRegistration) ?? ""
            ofd = try c.decodeFlexibleString(forKey: .ofd) ?? ""
        }

        private enum CodingKeys: String, CodingKey {
            case name, bin, address, ofd
            case kkmRegistration = "kkmReg"
        }
    }

    public let shiftID: String
    public let pointName: String
    public let shiftNumber: Int
    public let cashier: String
    public let openedAt: Date?
    public let closedAt: Date?
    public let requisites: Requisites
    public let cashSales: Double
    public let cashCount: Int
    public let kaspiSales: Double
    public let kaspiCount: Int
    public let returns: Double
    public let checkCount: Int
    public let total: Double
    public let openingCash: Double
    public let closingCash: Double
    public let positions: [ZReportPosition]
    public let goodsTotal: Double
    public let debts: [ZReportDebt]
    public let debtsTotal: Double
    /// Публичная страница онлайн-чека смены на поддомене организации.
    public let onlineURL: String

    public var id: String { shiftID }

    public var averageCheck: Double { checkCount > 0 ? total / Double(checkCount) : 0 }

    public var soldUnits: Double { positions.reduce(0) { $0 + $1.sold } }

    /// Сколько смена шла. `nil` у ещё не закрытой.
    public var duration: TimeInterval? {
        guard let openedAt, let closedAt else { return nil }
        let seconds = closedAt.timeIntervalSince(openedAt)
        return seconds > 0 ? seconds : nil
    }

    public var durationLabel: String? {
        guard let duration else { return nil }
        let hours = Int(duration) / 3600
        let minutes = (Int(duration) % 3600) / 60
        return "\(hours) ч \(minutes) мин"
    }

    /// Сколько наличных должно было остаться в ящике: старт плюс наличная
    /// выручка минус возвраты наличными. Возвраты сервер отдаёт одной суммой
    /// без разбивки по способу оплаты, поэтому вычитаем их целиком —
    /// расхождение здесь ориентир, а не приговор кассиру.
    public var expectedCash: Double { openingCash + cashSales - returns }

    public var cashDifference: Double { closingCash - expectedCash }

    /// Отчёт по закрытой смене. У открытой `closing_cash` ещё нулевой,
    /// и «недостача» на середине смены недостачей не является.
    public var isClosed: Bool { closedAt != nil }

    public var topPositions: [ZReportPosition] {
        positions.sorted { $0.amount > $1.amount }
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        shiftID = try c.decodeFlexibleString(forKey: .shiftID) ?? ""
        pointName = try c.decodeFlexibleString(forKey: .pointName) ?? "Точка"
        shiftNumber = Int(try c.decodeFlexibleDouble(forKey: .shiftNumber) ?? 0)
        cashier = try c.decodeFlexibleString(forKey: .cashier) ?? "—"
        openedAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .openedAt))
        closedAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .closedAt))
        requisites = (try? c.decode(Requisites.self, forKey: .requisites)) ?? .empty
        cashSales = try c.decodeFlexibleDouble(forKey: .cashSales) ?? 0
        cashCount = Int(try c.decodeFlexibleDouble(forKey: .cashCount) ?? 0)
        kaspiSales = try c.decodeFlexibleDouble(forKey: .kaspiSales) ?? 0
        kaspiCount = Int(try c.decodeFlexibleDouble(forKey: .kaspiCount) ?? 0)
        returns = try c.decodeFlexibleDouble(forKey: .returns) ?? 0
        checkCount = Int(try c.decodeFlexibleDouble(forKey: .checkCount) ?? 0)
        total = try c.decodeFlexibleDouble(forKey: .total) ?? 0
        openingCash = try c.decodeFlexibleDouble(forKey: .openingCash) ?? 0
        closingCash = try c.decodeFlexibleDouble(forKey: .closingCash) ?? 0
        positions = (try? c.decodeIfPresent([ZReportPosition].self, forKey: .positions)) ?? []
        goodsTotal = try c.decodeFlexibleDouble(forKey: .goodsTotal) ?? 0
        debts = (try? c.decodeIfPresent([ZReportDebt].self, forKey: .debts)) ?? []
        debtsTotal = try c.decodeFlexibleDouble(forKey: .debtsTotal) ?? 0
        onlineURL = try c.decodeFlexibleString(forKey: .onlineURL) ?? ""
    }

    private enum CodingKeys: String, CodingKey {
        case shiftID = "shiftId"
        case pointName, shiftNumber, cashier, openedAt, closedAt, requisites
        case cashSales, cashCount, kaspiSales, kaspiCount, returns, checkCount, total
        case openingCash, closingCash, positions, goodsTotal, debts, debtsTotal
        case onlineURL = "onlineUrl"
    }
}

/// Ответ Z-отчёта: поле лежит в корне под именем `report`, а не в `data`.
public struct ZReportEnvelope: Decodable, Sendable {
    public let report: ZReport?

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        report = (try? c.decodeIfPresent(ZReport.self, forKey: .report)) ?? nil
    }

    private enum CodingKeys: String, CodingKey { case report }
}

/// Какие смены показывать в списке.
public enum ShiftFilter: String, CaseIterable, Identifiable, Sendable {
    case closed, open, all

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .closed: "Закрытые"
        case .open: "Открытые"
        case .all: "Все"
        }
    }
}

// ── Сервис ───────────────────────────────────────────────────────────────────

/// Скидки, арена, настройки магазина и сменные отчёты магазина.
public struct RetailService: Sendable {
    private let api: APIClient

    public init(api: APIClient) {
        self.api = api
    }

    // ── Скидки ───────────────────────────────────────────────────────────────

    /// Скидки и промокоды доступных точек. Требует `discounts.view`.
    public func discounts() async throws -> [Discount] {
        let response: DataList<Discount> = try await api.send(APIRequest(path: "/api/admin/discounts"))
        return response.items
    }

    /// Создать скидку. Требует `discounts.create`.
    public func createDiscount(_ draft: DiscountDraft) async throws -> Discount {
        try await post(body: try JSONSerialization.data(withJSONObject: draft.createBody()))
    }

    /// Изменить скидку. Требует `discounts.edit`.
    public func updateDiscount(id: String, draft: DiscountDraft) async throws -> Discount {
        try await post(body: try JSONSerialization.data(withJSONObject: draft.updateBody(id: id)))
    }

    /// Включить или выключить скидку. Требует `discounts.edit`.
    public func setDiscountActive(id: String, isActive: Bool) async throws -> Discount {
        let body: [String: Any] = [
            "action": "updateDiscount",
            "discountId": id,
            "payload": ["is_active": isActive],
        ]
        return try await post(body: try JSONSerialization.data(withJSONObject: body))
    }

    /// Удалить скидку. Сервер не стирает строку, а гасит `is_active`: чеки,
    /// пробитые по этой скидке, должны сохранить ссылку на неё.
    /// Требует `discounts.delete`.
    public func deleteDiscount(id: String) async throws {
        _ = try await api.send(
            APIRequest(
                path: "/api/admin/discounts",
                method: .post,
                body: try JSONSerialization.data(withJSONObject: ["action": "deleteDiscount", "discountId": id])
            )
        )
    }

    private func post(body: Data) async throws -> Discount {
        let response: Envelope<Discount> = try await api.send(
            APIRequest(path: "/api/admin/discounts", method: .post, body: body)
        )
        return response.data
    }

    // ── Арена ────────────────────────────────────────────────────────────────

    /// Игровые проекты, где включена арена. Требует `stations.view`
    /// и модуль `addon.arena`.
    public func arenaProjects() async throws -> [ArenaProjectRef] {
        let response: Envelope<ArenaProjectList> = try await api.send(
            APIRequest(path: "/api/admin/arena")
        )
        return response.data.projects
    }

    /// Зал проекта. Без `pointID` сервер отдаёт зоны и станции всех точек
    /// проекта. Требует `stations.view`.
    public func arenaBoard(projectID: String, pointID: String? = nil) async throws -> ArenaBoard {
        var query = ["projectId": projectID]
        if let pointID, !pointID.isEmpty { query["companyId"] = pointID }
        let response: Envelope<ArenaBoard> = try await api.send(
            APIRequest(path: "/api/admin/arena", query: query)
        )
        return response.data
    }

    /// Сессии за период. Требует `stations.get_analytics`.
    public func arenaSessions(
        projectID: String,
        pointID: String?,
        period: ArenaPeriod
    ) async throws -> [ArenaSessionRow] {
        let bounds = period.bounds()
        var body: [String: Any] = [
            "action": "getAnalytics",
            "projectId": projectID,
            "from": bounds.from,
            "to": bounds.to,
        ]
        if let pointID, !pointID.isEmpty { body["companyId"] = pointID }

        let response: Envelope<ArenaSessionList> = try await api.send(
            APIRequest(
                path: "/api/admin/arena",
                method: .post,
                body: try JSONSerialization.data(withJSONObject: body)
            )
        )
        return response.data.sessions
    }

    /// Запустить сессию на станции. Требует `stations.admin_start_session`.
    public func startArenaSession(
        stationID: String,
        tariffID: String,
        projectID: String,
        pointID: String?
    ) async throws {
        var body: [String: Any] = [
            "action": "adminStartSession",
            "stationId": stationID,
            "tariffId": tariffID,
            "projectId": projectID,
        ]
        if let pointID, !pointID.isEmpty { body["companyId"] = pointID }

        _ = try await api.send(
            APIRequest(
                path: "/api/admin/arena",
                method: .post,
                body: try JSONSerialization.data(withJSONObject: body)
            )
        )
    }

    /// Завершить сессию. Киоск получит команду и погасит экран.
    /// Требует `stations.admin_end_session`.
    public func endArenaSession(stationID: String) async throws {
        _ = try await api.send(
            APIRequest(
                path: "/api/admin/arena",
                method: .post,
                body: try JSONSerialization.data(
                    withJSONObject: ["action": "adminEndSession", "stationId": stationID]
                )
            )
        )
    }

    // ── Настройки магазина ───────────────────────────────────────────────────

    /// Конфигурация модуля «Магазин». Требует `store.view`.
    public func storeConfig() async throws -> RetailConfig {
        let response: Envelope<RetailConfig> = try await api.send(
            APIRequest(path: "/api/admin/store/config")
        )
        return response.data
    }

    /// Задать, какие точки работают как магазин.
    ///
    /// Список полный, а не добавочный: точки организации, которых в нём нет,
    /// сервер выключит. Требует `store-settings.edit` и роль владельца
    /// или менеджера.
    public func saveStorePoints(ids: [String]) async throws {
        _ = try await api.send(
            APIRequest(
                path: "/api/admin/store/config",
                method: .put,
                body: try JSONSerialization.data(withJSONObject: ["store_enabled_ids": ids])
            )
        )
    }

    /// Стартовая точка модуля.
    public func setDefaultStorePoint(id: String?) async throws {
        let payload: [String: Any] = ["store_company_id": id ?? NSNull()]
        _ = try await api.send(
            APIRequest(
                path: "/api/admin/store/config",
                method: .put,
                body: try JSONSerialization.data(withJSONObject: payload)
            )
        )
    }

    // ── Смены магазина ───────────────────────────────────────────────────────

    /// Смены точки-магазина. Требует `shifts-reports.view` — роут списка общий
    /// со страницей «Отчёты смен», отдельного права у него нет.
    public func storeShifts(pointID: String, filter: ShiftFilter, limit: Int = 200) async throws -> [ShiftReport] {
        let response: Envelope<ShiftReportList> = try await api.send(
            APIRequest(
                path: "/api/admin/shifts/reports",
                query: ["company_id": pointID, "status": filter.rawValue, "limit": String(limit)]
            )
        )
        return response.data.shifts
    }

    /// Z-отчёт смены. Требует `store-shifts.view`.
    public func zReport(shiftID: String) async throws -> ZReport? {
        let response: ZReportEnvelope = try await api.send(
            APIRequest(path: "/api/admin/shifts/z-report", query: ["shift_id": shiftID])
        )
        return response.report
    }
}
