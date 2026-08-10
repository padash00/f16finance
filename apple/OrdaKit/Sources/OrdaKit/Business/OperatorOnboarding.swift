import Foundation

// ── Оформление оператора ─────────────────────────────────────────────────────
//
// Нового человека оформляют в день выхода, часто прямо на точке: он уже стоит
// у кассы, а завести его можно было только с ноутбука. В итоге первую смену
// работали под чужим логином — и вся выручка этой смены записывалась не на
// того.
//
// Шагов три, и они раздельные на сервере: карточка, учётная запись, отправка
// доступов. Раздельные они и здесь — учётку заводят не всем, а доступы шлют не
// всегда через Telegram.

/// Карточка оператора.
public struct OperatorDraft: Sendable, Equatable {
    public var name: String
    public var fullName: String
    public var position: String
    public var phone: String
    public var email: String

    public init() {
        name = ""
        fullName = ""
        position = ""
        phone = ""
        email = ""
    }

    public var validationMessage: String? {
        if name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "Имя обязательно"
        }
        if !email.isEmpty, !MyProfileChange.isEmailValid(email) { return "Проверьте почту" }
        if !phone.isEmpty, phone.filter(\.isNumber).count < 10 { return "Проверьте телефон" }
        return nil
    }

    public var isValid: Bool { validationMessage == nil }

    func payload() -> OperatorPayload {
        func clean(_ value: String) -> String? {
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }
        return OperatorPayload(
            name: name.trimmingCharacters(in: .whitespacesAndNewlines),
            fullName: clean(fullName),
            position: clean(position),
            phone: clean(phone),
            email: clean(email)
        )
    }
}

struct OperatorPayload: Encodable {
    let name: String
    let fullName: String?
    let position: String?
    let phone: String?
    let email: String?

    enum CodingKeys: String, CodingKey {
        case name, position, phone, email
        case fullName = "full_name"
    }
}

struct OperatorCreateRequest: Encodable {
    let action = "createOperator"
    let payload: OperatorPayload

    private enum CodingKeys: String, CodingKey { case action, payload }
}

struct OperatorAccountRequest: Encodable {
    let operatorId: String
    let username: String
    let email: String
    let name: String
}

/// Что вернул сервер, заведя учётную запись.
///
/// Пароль приходит открытым ровно один раз и больше нигде не хранится — его
/// нужно либо показать, либо отправить сразу.
public struct OperatorAccount: Decodable, Sendable {
    public let username: String
    public let password: String
    public let operatorID: String

    private enum CodingKeys: String, CodingKey {
        case username, password
        case operatorID = "operatorId"
    }
}

struct OperatorCredentialsRequest: Encodable {
    let operatorId: String
    let chatId: String
    let username: String
    let password: String
    let name: String
}

/// Логин по имени: латиница, нижний регистр, без пробелов.
///
/// Сервер превращает логин в почту `<логин>@operator.local`, поэтому кириллица
/// и пробелы там недопустимы. Предлагаем готовый вариант, чтобы человек не
/// придумывал его сам и не ошибался.
public enum OperatorUsername {
    private static let map: [Character: String] = [
        "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
        "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
        "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
        "ф": "f", "х": "h", "ц": "c", "ч": "ch", "ш": "sh", "щ": "sch",
        "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
    ]

    public static func suggestion(from name: String) -> String {
        let lowered = name.lowercased()
        var result = ""
        for character in lowered {
            if let replacement = map[character] {
                result += replacement
            } else if character.isLetter || character.isNumber {
                result.append(character)
            } else if character == " " || character == "-" {
                result.append(".")
            }
        }
        // Точка на конце и подряд — след от пробелов, а не часть имени.
        while result.hasSuffix(".") { result.removeLast() }
        return result.replacingOccurrences(of: "..", with: ".")
    }

    /// Что мешает использовать логин.
    public static func validationMessage(for username: String) -> String? {
        if username.count < 3 { return "Логин короче трёх символов" }
        if username.contains(" ") { return "В логине не бывает пробелов" }
        if username.contains(where: { !($0.isASCII && ($0.isLetter || $0.isNumber || $0 == "." || $0 == "_" || $0 == "-")) }) {
            return "Только латиница, цифры, точка и дефис"
        }
        return nil
    }
}
