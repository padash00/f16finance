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
                return message.isEmpty ? "У вас нет доступа к этому действию." : message
            }
        case let .conflict(_, message):
            return message.isEmpty ? "Действие сейчас невозможно." : message
        case let .badRequest(_, message):
            return message.isEmpty ? "Проверьте введённые данные." : message
        case .notFound:
            return "Не найдено."
        case .server:
            return "Сервер временно недоступен. Попробуйте ещё раз."
        case .decoding:
            return "Не удалось прочитать ответ сервера."
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
