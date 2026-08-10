import Foundation

/// Свои контактные данные: `/api/me/profile`.
///
/// Меняются только контакты — телефон, почта, Telegram. Имя, должность и
/// ставка приходят на чтение: это кадровые данные, на них считается зарплата и
/// строится подчинение, и правит их владелец.
public struct MyProfile: Decodable, Sendable, Equatable {
    /// `staff` или `operator` — от этого зависит, что вообще можно менять.
    public let kind: String
    public let fullName: String?
    public let position: String?
    public let phone: String?
    public let email: String?
    public let telegramChatID: String?

    /// Telegram есть только у операторов: сотрудникам уведомления приходят
    /// иначе, и пустое поле в форме сбивало бы с толку.
    public var supportsTelegram: Bool { kind == "operator" }

    private enum CodingKeys: String, CodingKey {
        case kind, fullName, position, phone, email
        case telegramChatID = "telegramChatId"
    }
}

/// Что уходит на сервер. Отсутствующее поле означает «не трогать», пустое —
/// «стереть»: это разные намерения, и путать их нельзя.
public struct MyProfileChange: Encodable, Sendable {
    public var phone: String?
    public var email: String?
    public var telegramChatID: String?

    public init(phone: String? = nil, email: String? = nil, telegramChatID: String? = nil) {
        self.phone = phone
        self.email = email
        self.telegramChatID = telegramChatID
    }

    private enum CodingKeys: String, CodingKey {
        case phone, email
        case telegramChatID = "telegram_chat_id"
    }

    /// Что мешает сохранить. Правила те же, что на сервере.
    public var validationMessage: String? {
        if let email, !email.isEmpty, !Self.isEmailValid(email) { return "Проверьте почту" }
        if let phone, !phone.isEmpty, phone.filter(\.isNumber).count < 10 { return "Проверьте телефон" }
        return nil
    }

    static func isEmailValid(_ email: String) -> Bool {
        let parts = email.split(separator: "@")
        guard parts.count == 2, !parts[0].isEmpty else { return false }
        let domain = parts[1]
        return domain.contains(".") && !domain.hasPrefix(".") && !domain.hasSuffix(".")
    }
}

public struct MyProfileService: Sendable {
    private let api: APIClient
    public init(api: APIClient) { self.api = api }

    public func load() async throws -> MyProfile {
        let response: Envelope<MyProfile> = try await api.send(APIRequest(path: "/api/me/profile"))
        return response.data
    }

    public func save(_ change: MyProfileChange) async throws {
        let body = try JSONEncoder().encode(change)
        _ = try await api.send(APIRequest(path: "/api/me/profile", method: .patch, body: body))
    }
}
