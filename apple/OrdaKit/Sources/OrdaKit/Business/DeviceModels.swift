import Foundation

// ── Точки и устройства: /api/admin/point-devices ─────────────────────────────

/// Программа точки: операторская или киоск, с токеном и списком точек.
public struct PointProject: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let mode: String
    public let isActive: Bool
    public let notes: String?
    public let lastSeenAt: Date?
    public let hasReportChat: Bool
    public let companies: [Assignment]

    /// Точка, закреплённая за программой.
    public struct Assignment: Decodable, Sendable, Identifiable, Hashable {
        public let id: String
        public let name: String
        public let mode: String?

        public init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
            name = try c.decodeFlexibleString(forKey: .name) ?? "Точка"
            mode = try c.decodeFlexibleString(forKey: .mode)
        }

        private enum CodingKeys: String, CodingKey {
            case id, name
            case mode = "point_mode"
        }
    }

    public var modeLabel: String {
        switch mode {
        case "operator": "Операторская"
        case "kiosk": "Киоск"
        case "pos": "Касса"
        default: mode
        }
    }

    public var icon: String {
        switch mode {
        case "operator": "desktopcomputer"
        case "kiosk": "rectangle.inset.filled"
        case "pos": "creditcard"
        default: "square.stack"
        }
    }

    /// На связи ли устройство. Порог в сутки: программа отмечается при каждом
    /// обращении к серверу, и суточное молчание означает, что точка не
    /// работает — короткий порог давал бы ложные тревоги при закрытии на ночь.
    public var isOnline: Bool {
        guard let lastSeenAt else { return false }
        return Date().timeIntervalSince(lastSeenAt) < 86_400
    }

    /// Никогда не выходила на связь — обычно значит, что токен не прописан.
    public var neverSeen: Bool { lastSeenAt == nil }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        name = try c.decodeFlexibleString(forKey: .name) ?? "Без названия"
        mode = try c.decodeFlexibleString(forKey: .mode) ?? "operator"
        isActive = try c.decodeIfPresent(Bool.self, forKey: .isActive) ?? true
        notes = try c.decodeFlexibleString(forKey: .notes)
        lastSeenAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .lastSeenAt))
        hasReportChat = (try c.decodeFlexibleString(forKey: .reportChatID))?.isEmpty == false
        companies = (try? c.decodeIfPresent([Assignment].self, forKey: .companies)) ?? []
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, notes, companies
        case mode = "point_mode"
        case isActive = "is_active"
        case lastSeenAt = "last_seen_at"
        case reportChatID = "shift_report_chat_id"
    }
}

/// Ответ `GET /api/admin/point-devices`.
///
/// Токен программы приходит с сервера, но в модель не попадает намеренно:
/// он даёт полный доступ к продажам точки, а показывать его в приложении
/// незачем — прописывают токен один раз при установке, с компьютера.
public struct PointProjectList: Decodable, Sendable {
    public let projects: [PointProject]
    public let companies: [Company]

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        projects = (try? c.decodeIfPresent([PointProject].self, forKey: .projects)) ?? []
        companies = (try? c.decodeIfPresent([Company].self, forKey: .companies)) ?? []
    }

    private enum CodingKeys: String, CodingKey { case projects, companies }

    /// Программы, не выходившие на связь сутки, — то, ради чего открывают
    /// этот раздел.
    public var offline: [PointProject] {
        projects.filter { $0.isActive && !$0.isOnline }
    }
}
