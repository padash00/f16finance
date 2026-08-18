import Foundation

/// Ошибка обращения к API.
///
/// Отдельный случай для 403 — не косметика. Сервер отвечает структурно
/// (`{ error: "forbidden", capability, reason }`), и приложение обязано
/// показать «У вас нет права X», а не «Ошибка 403». Три причины отказа
/// требуют разных объяснений: право не выдано роли, действие отключено
/// суперадмином для всей организации, или маршрут вообще не для staff.
public enum APIError: Error, Sendable, Equatable {
    /// Нет сети, таймаут, обрыв.
    case transport(message: String)
    /// Сессия истекла и обновиться не удалось.
    case unauthorized(message: String)
    /// Нет права. `capability` есть, если сервер его назвал.
    case forbidden(capability: String?, reason: ForbiddenReason, message: String)
    /// Нет открытой смены, конфликт состояния (409).
    case conflict(code: String?, message: String)
    /// Ошибка валидации (400/422).
    case badRequest(code: String?, message: String)
    /// 404.
    case notFound(message: String)
    /// 5xx.
    case server(status: Int, message: String)
    /// Ответ не разобрался.
    case decoding(message: String)

    public enum ForbiddenReason: String, Sendable {
        /// Право не выдано роли или снято персонально.
        case missingCapability
        /// Суперадмин отключил действие для всей организации.
        case orgDisabled = "org-disabled"
        /// Маршрут только для сотрудников.
        case staffOnly = "staff-only"
        /// Модуль не оплачен организацией.
        case featureLocked
        case unknown
    }

    /// Адрес маршрута в конце сообщения — для журнала, не для человека.
    ///
    /// Клиент дописывает к тексту сервера ` · /api/…`, и это спасает при
    /// разборе полётов. Но оператору в красной строке достаётся «Обратитесь к
    /// администратору · /api/operator/knowledge/confirm», и половина фразы для
    /// него шум.
    static func withoutRoute(_ message: String) -> String {
        guard let range = message.range(of: " · /api") else { return message }
        return String(message[..<range.lowerBound])
    }

    /// Текст для пользователя. Без кодов и технических терминов.
    public var userMessage: String {
        switch self {
        case .transport:
            return "Нет связи с сервером. Проверьте интернет — данные сохранятся и уйдут позже."
        case .unauthorized:
            return "Сессия истекла. Войдите заново."
        case let .forbidden(capability, reason, message):
            switch reason {
            case .orgDisabled:
                return "Это действие отключено для вашей организации. Обратитесь в поддержку Orda."
            case .staffOnly:
                return "Раздел доступен только сотрудникам."
            case .featureLocked:
                return "Модуль не подключён к вашей организации."
            case .missingCapability, .unknown:
                if let capability, let known = CapabilityCatalog.capability(id: capability) {
                    return "Нет доступа: «\(known.label)». Попросите владельца выдать это право."
                }
                return message.isEmpty ? "У вас нет доступа к этому действию." : APIError.withoutRoute(message)
            }
        case let .conflict(_, message):
            return message.isEmpty ? "Действие сейчас невозможно." : APIError.withoutRoute(message)
        case let .badRequest(_, message):
            return message.isEmpty ? "Проверьте введённые данные." : APIError.withoutRoute(message)
        case .notFound:
            return "Не найдено."
        case .server:
            return "Сервер временно недоступен. Попробуйте ещё раз."
        case .decoding:
            return "Не удалось прочитать ответ сервера."
        }
    }

    /// Техническая подпись под сообщением: что именно ответил сервер и какой
    /// запрос отказал.
    ///
    /// Без неё «Сервер временно недоступен» выглядит одинаково для десятка
    /// разных причин, и владелец не может сказать, что сломалось, — а значит,
    /// и починить это по его словам нельзя. Показываем только там, где текст
    /// для человека сам по себе ничего не объясняет.
    public var technicalDetail: String? {
        switch self {
        case let .server(status, message):
            return message.isEmpty ? "HTTP \(status)" : "HTTP \(status) · \(message)"
        case let .decoding(message):
            return message.isEmpty ? nil : message
        case let .transport(message):
            return message.isEmpty ? nil : message
        default:
            // 403/404/409/400 объясняют себя сами: сообщение уже содержит и
            // причину, и путь.
            return nil
        }
    }

    /// Похоже, что раздела на сервере ещё нет.
    ///
    /// Приложение и сайт выкатываются порознь: сборка на устройстве может уже
    /// знать про новый раздел, а сервер — ещё нет. Тогда запрос либо не
    /// находит адрес (404), либо попадает в соседний динамический маршрут и
    /// возвращает разбор чужого параметра — как `invalid userId` у списка
    /// собеседников, где `contacts` приняли за идентификатор.
    ///
    /// Показывать такое человеку как ошибку неправильно: у него ничего не
    /// сломано, просто сайт старше приложения.
    public var looksMissingOnServer: Bool {
        switch self {
        case .notFound: true
        case .badRequest: true
        default: false
        }
    }

    /// Имеет ли смысл повторять запрос автоматически.
    public var isRetryable: Bool {
        switch self {
        case .transport, .server: return true
        default: return false
        }
    }
}

/// Тело ошибки, которое отдаёт Next.js API.
struct APIErrorBody: Decodable {
    let error: String?
    let message: String?
    let capability: String?
    let reason: String?
    let code: String?
}
