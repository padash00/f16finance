import Foundation

// ── Правка карточки оператора ────────────────────────────────────────────────
//
// Так же, как на сайте (карточка оператора → «Редактировать»):
// - профиль — `PATCH /api/admin/operators/profile` с `profile` и
//   `telegram_chat_id`. Сервер перезаписывает Telegram всегда, даже если его
//   не прислали, — поэтому текущий уходит обратно, иначе правка телефона
//   отвязала бы человека от уведомлений;
// - имя и короткое имя — `updateOperator` в `/api/admin/operators`. Этот
//   запрос заодно перезаписывает ФИО, должность, телефон и почту в профиле,
//   поэтому уходят те же значения, что и в профиль.
// Право — `operators.edit`; сервер проверяет его в обоих роутах.

/// Карточка оператора целиком: `GET /api/admin/operators/profile`.
public struct OperatorCard: Decodable, Sendable {
    public let operatorID: String
    public let name: String
    public let shortName: String?
    public let telegramChatID: String?
    public let isActive: Bool
    public let profile: Profile

    public struct Profile: Sendable, Equatable {
        public var fullName: String?
        public var phone: String?
        public var email: String?
        public var position: String?
        public var hireDate: String?
        public var birthDate: String?
        public var address: String?
        public var photoURL: String?
        public var emergencyName: String?
        public var emergencyPhone: String?
        public var notes: String?
    }

    private enum RootKeys: String, CodingKey { case data }
    private enum DataKeys: String, CodingKey { case `operator`, profile }
    private enum OperatorKeys: String, CodingKey {
        case id, name
        case shortName = "short_name"
        case telegramChatID = "telegram_chat_id"
        case isActive = "is_active"
    }
    private enum ProfileKeys: String, CodingKey {
        case phone, email, position, address, notes
        case fullName = "full_name"
        case hireDate = "hire_date"
        case birthDate = "birth_date"
        case photoURL = "photo_url"
        case emergencyName = "emergency_contact_name"
        case emergencyPhone = "emergency_contact_phone"
    }

    public init(from decoder: any Decoder) throws {
        let root = try decoder.container(keyedBy: RootKeys.self)
        let data = try root.nestedContainer(keyedBy: DataKeys.self, forKey: .data)
        let op = try data.nestedContainer(keyedBy: OperatorKeys.self, forKey: .operator)
        operatorID = try op.decodeFlexibleString(forKey: .id) ?? ""
        name = try op.decodeFlexibleString(forKey: .name) ?? ""
        shortName = try op.decodeFlexibleString(forKey: .shortName)
        telegramChatID = try op.decodeFlexibleString(forKey: .telegramChatID)
        isActive = (try? op.decodeIfPresent(Bool.self, forKey: .isActive)) ?? true

        var profile = Profile()
        if (try? data.decodeNil(forKey: .profile)) == false,
           let p = try? data.nestedContainer(keyedBy: ProfileKeys.self, forKey: .profile) {
            profile.fullName = try p.decodeFlexibleString(forKey: .fullName)
            profile.phone = try p.decodeFlexibleString(forKey: .phone)
            profile.email = try p.decodeFlexibleString(forKey: .email)
            profile.position = try p.decodeFlexibleString(forKey: .position)
            profile.hireDate = try p.decodeFlexibleString(forKey: .hireDate)
            profile.birthDate = try p.decodeFlexibleString(forKey: .birthDate)
            profile.address = try p.decodeFlexibleString(forKey: .address)
            profile.photoURL = try p.decodeFlexibleString(forKey: .photoURL)
            profile.emergencyName = try p.decodeFlexibleString(forKey: .emergencyName)
            profile.emergencyPhone = try p.decodeFlexibleString(forKey: .emergencyPhone)
            profile.notes = try p.decodeFlexibleString(forKey: .notes)
        }
        self.profile = profile
    }
}

/// Что меняем в карточке.
public struct OperatorEdit: Sendable, Equatable {
    public let operatorID: String
    public var name: String
    public var shortName: String
    public var telegramChatID: String
    public var profile: OperatorCard.Profile

    public init(card: OperatorCard) {
        operatorID = card.operatorID
        name = card.name
        shortName = card.shortName ?? ""
        telegramChatID = card.telegramChatID ?? ""
        profile = card.profile
    }

    public var problem: String? {
        name.trimmingCharacters(in: .whitespaces).isEmpty ? "Укажите имя" : nil
    }

    private static func clean(_ value: String?) -> Any {
        let trimmed = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? NSNull() : trimmed
    }

    func profileBody() throws -> Data {
        let p = profile
        let payload: [String: Any] = [
            "full_name": Self.clean(p.fullName),
            "phone": Self.clean(p.phone),
            "email": Self.clean(p.email),
            "position": Self.clean(p.position),
            "hire_date": Self.clean(p.hireDate),
            "birth_date": Self.clean(p.birthDate),
            "address": Self.clean(p.address),
            "photo_url": Self.clean(p.photoURL),
            "emergency_contact_name": Self.clean(p.emergencyName),
            "emergency_contact_phone": Self.clean(p.emergencyPhone),
            "notes": Self.clean(p.notes),
        ]
        return try JSONSerialization.data(withJSONObject: [
            "operator_id": operatorID,
            "telegram_chat_id": Self.clean(telegramChatID),
            "profile": payload,
        ])
    }

    func operatorBody() throws -> Data {
        try JSONSerialization.data(withJSONObject: [
            "action": "updateOperator",
            "operatorId": operatorID,
            "payload": [
                "name": name.trimmingCharacters(in: .whitespaces),
                "short_name": Self.clean(shortName),
                "full_name": Self.clean(profile.fullName),
                "position": Self.clean(profile.position),
                "phone": Self.clean(profile.phone),
                "email": Self.clean(profile.email),
            ] as [String: Any],
        ])
    }
}

extension BusinessService {
    /// Карточка оператора целиком. Требует `operators.view`.
    public func operatorCard(id: String) async throws -> OperatorCard {
        try await api.send(APIRequest(path: "/api/admin/operators/profile", query: ["operator_id": id]))
    }

    /// Сохранить карточку: сначала профиль, затем имя.
    public func saveOperator(_ edit: OperatorEdit) async throws {
        _ = try await api.send(APIRequest(path: "/api/admin/operators/profile", method: .patch, body: try edit.profileBody()))
        _ = try await api.send(APIRequest(path: "/api/admin/operators", method: .post, body: try edit.operatorBody()))
    }
}
