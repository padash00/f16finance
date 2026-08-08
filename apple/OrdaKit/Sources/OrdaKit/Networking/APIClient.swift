import Foundation

/// Источник токена сессии. Реализация живёт в приложении (Supabase + Keychain),
/// чтобы OrdaKit не тянул зависимость на Supabase SDK и оставался тестируемым.
public protocol TokenProvider: Sendable {
    /// Текущий access token, если он есть.
    func currentAccessToken() async -> String?
    /// Обновить сессию. Возвращает новый токен или nil, если обновиться нельзя.
    func refreshAccessToken() async throws -> String?
}

/// HTTP-метод.
public enum HTTPMethod: String, Sendable {
    case get = "GET"
    case post = "POST"
    case patch = "PATCH"
    case put = "PUT"
    case delete = "DELETE"
}

/// Описание запроса к API.
public struct APIRequest: Sendable {
    public var path: String
    public var method: HTTPMethod
    public var query: [String: String]
    public var body: Data?
    /// Не подставлять `x-organization-id` (для платформенных запросов суперадмина).
    public var skipsOrganizationHeader: Bool

    public init(
        path: String,
        method: HTTPMethod = .get,
        query: [String: String] = [:],
        body: Data? = nil,
        skipsOrganizationHeader: Bool = false
    ) {
        self.path = path
        self.method = method
        self.query = query
        self.body = body
        self.skipsOrganizationHeader = skipsOrganizationHeader
    }

    /// Запрос с JSON-телом.
    public static func json(
        _ path: String,
        method: HTTPMethod = .post,
        body: some Encodable,
        encoder: JSONEncoder = APIClient.defaultEncoder
    ) throws -> APIRequest {
        APIRequest(path: path, method: method, body: try encoder.encode(body))
    }
}

/// Клиент Next.js API.
///
/// Авторизация — `Authorization: Bearer <supabase_jwt>`. Это тот же путь,
/// которым ходит веб-портал через `getRequestAccessContext()`, поэтому
/// отдельного мобильного контура на сервере не нужно.
///
/// Активная организация передаётся заголовком `x-organization-id`: сервер
/// возьмёт её только из тех, к которым у пользователя есть доступ.
public actor APIClient {
    public static let defaultDecoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let raw = try container.decode(String.self)
            if let date = DateParsing.parse(raw) { return date }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Неизвестный формат даты: \(raw)")
        }
        return decoder
    }()

    public static let defaultEncoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()

    private let baseURL: URL
    private let session: URLSession
    private let tokenProvider: any TokenProvider
    private let decoder: JSONDecoder

    /// Активная организация. Меняется при переключении в шапке.
    private var organizationID: String?

    /// Сессия по умолчанию.
    ///
    /// У `URLSession.shared` предел запроса — 60 секунд, и этого не хватает
    /// AI-разделам: разбор финдиректора и прогноз считаются моделью и на
    /// большом периоде идут дольше. Обрыв выглядел бы как поломка сети, хотя
    /// сервер в этот момент честно работает.
    ///
    /// Три минуты — с запасом к самому долгому наблюдаемому разбору. Предел
    /// на всю операцию оставляем больше: он покрывает и повтор после
    /// обновления токена.
    public static let defaultSession: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 180
        configuration.timeoutIntervalForResource = 300
        return URLSession(configuration: configuration)
    }()

    public init(
        baseURL: URL,
        tokenProvider: any TokenProvider,
        session: URLSession = APIClient.defaultSession,
        decoder: JSONDecoder = APIClient.defaultDecoder
    ) {
        self.baseURL = baseURL
        self.tokenProvider = tokenProvider
        self.session = session
        self.decoder = decoder
    }

    public func setOrganization(_ id: String?) {
        organizationID = id
    }

    public func currentOrganization() -> String? { organizationID }

    // ── Запросы ──────────────────────────────────────────────────────────────

    /// Выполнить запрос и разобрать ответ.
    public func send<Response: Decodable>(
        _ request: APIRequest,
        as type: Response.Type = Response.self
    ) async throws -> Response {
        let data = try await sendRaw(request)
        if data.isEmpty, let empty = EmptyResponse() as? Response { return empty }
        do {
            return try decoder.decode(Response.self, from: data)
        } catch {
            throw APIError.decoding(message: String(describing: error))
        }
    }

    /// Выполнить запрос, ответ не нужен.
    @discardableResult
    public func send(_ request: APIRequest) async throws -> Data {
        try await sendRaw(request)
    }

    private func sendRaw(_ request: APIRequest, isRetry: Bool = false) async throws -> Data {
        let urlRequest = try await buildURLRequest(request)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: urlRequest)
        } catch let error as URLError {
            throw APIError.transport(message: error.localizedDescription)
        } catch {
            throw APIError.transport(message: error.localizedDescription)
        }

        guard let http = response as? HTTPURLResponse else {
            throw APIError.transport(message: "Некорректный ответ сервера")
        }

        if (200..<300).contains(http.statusCode) {
            return data
        }

        // Протухший токен лечим один раз: форсим refresh и повторяем запрос.
        // Второй 401 подряд означает, что сессия действительно мертва.
        if http.statusCode == 401, !isRetry {
            let refreshed = try? await tokenProvider.refreshAccessToken()
            if let token = refreshed, !token.isEmpty {
                return try await sendRaw(request, isRetry: true)
            }
        }

        throw makeError(status: http.statusCode, data: data, path: request.path)
    }

    private func buildURLRequest(_ request: APIRequest) async throws -> URLRequest {
        guard var components = URLComponents(
            url: baseURL.appendingPathComponent(request.path.hasPrefix("/") ? String(request.path.dropFirst()) : request.path),
            resolvingAgainstBaseURL: false
        ) else {
            throw APIError.badRequest(code: nil, message: "Некорректный путь: \(request.path)")
        }

        if !request.query.isEmpty {
            components.queryItems = request.query
                .sorted { $0.key < $1.key }
                .map { URLQueryItem(name: $0.key, value: $0.value) }
        }

        guard let url = components.url else {
            throw APIError.badRequest(code: nil, message: "Некорректный адрес запроса")
        }

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = request.method.rawValue
        urlRequest.setValue("application/json", forHTTPHeaderField: "Accept")
        urlRequest.httpBody = request.body

        if request.body != nil {
            urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        if let token = await tokenProvider.currentAccessToken() {
            urlRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        if !request.skipsOrganizationHeader, let organizationID {
            urlRequest.setValue(organizationID, forHTTPHeaderField: "x-organization-id")
        }

        return urlRequest
    }

    private func makeError(status: Int, data: Data, path: String) -> APIError {
        let body = try? JSONDecoder().decode(APIErrorBody.self, from: data)
        // Путь в тексте: голое «forbidden» не говорит, какой именно запрос
        // отказал, и разбирательство превращается в угадывание.
        // Сервер различает причины полем `code` (guest-not-linked,
        // host-organization-not-accessible, org-disabled…). Без него все
        // отказы выглядят одинаковым «forbidden», и понять ветку невозможно.
        let detail = [body?.message ?? body?.error, body?.code]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: " / ")
        let message = detail.isEmpty ? path : "\(detail) · \(path)"

        switch status {
        case 401:
            return .unauthorized(message: message)
        case 403:
            let reason: APIError.ForbiddenReason = {
                switch body?.reason {
                case "org-disabled": return .orgDisabled
                case "staff-only": return .staffOnly
                case "feature-locked": return .featureLocked
                default: return body?.capability == nil ? .unknown : .missingCapability
                }
            }()
            return .forbidden(capability: body?.capability, reason: reason, message: message)
        case 404:
            return .notFound(message: message)
        case 409:
            return .conflict(code: body?.error ?? body?.code, message: message)
        case 400, 422:
            return .badRequest(code: body?.error ?? body?.code, message: message)
        default:
            return .server(status: status, message: message)
        }
    }
}

/// Заглушка для запросов без полезного ответа.
public struct EmptyResponse: Codable, Sendable {
    public init() {}
}

// ── Форматы дат ──────────────────────────────────────────────────────────────

/// Разбор дат, приходящих из API.
///
/// Сервер отдаёт три формата: ISO с долями секунды (Postgres timestamptz),
/// ISO без них и голую дату `2026-08-08` (колонки `date` — смены, зарплатные
/// недели). Используем `FormatStyle` вместо `DateFormatter`: он значимого типа
/// и потокобезопасен, что требует Swift 6.
public enum DateParsing {
    /// Голую дату считаем полднем UTC. Полночь съезжала бы на предыдущий день
    /// в отрицательных часовых поясах, а Казахстан — UTC+5.
    private static let dateOnlyCalendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0) ?? .gmt
        return calendar
    }()

    public static func parse(_ raw: String) -> Date? {
        if let date = try? Date(raw, strategy: .iso8601.year().month().day()
            .dateTimeSeparator(.standard)
            .time(includingFractionalSeconds: true)) {
            return date
        }
        if let date = try? Date(raw, strategy: .iso8601) {
            return date
        }
        return parseDateOnly(raw)
    }

    /// То же, но для необязательного поля: в JSON дата часто `null`, и
    /// разворачивать её на каждом месте вызова — лишний шум.
    public static func date(from raw: String?) -> Date? {
        guard let raw, !raw.isEmpty else { return nil }
        return parse(raw)
    }

    /// `2026-08-08` → полдень UTC того же дня.
    public static func parseDateOnly(_ raw: String) -> Date? {
        let parts = raw.split(separator: "-")
        guard parts.count == 3,
              let year = Int(parts[0]),
              let month = Int(parts[1]),
              let day = Int(parts[2].prefix(2))
        else { return nil }

        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = day
        components.hour = 12
        return dateOnlyCalendar.date(from: components)
    }

    /// Обратно в `yyyy-MM-dd` для запросов к API.
    ///
    /// Компоненты берём по **местному** календарю, а не по UTC. Разбор голой
    /// даты идёт в UTC (см. выше) — это верно для строки с сервера, у которой
    /// пояса нет. Но здесь на входе обычно местная дата: «сегодня», начало
    /// местных суток, понедельник недели.
    ///
    /// В UTC+5 (Алматы) местная полночь — это 19:00 предыдущего дня по UTC, и
    /// разбор в UTC сдвигал результат на день назад: «сегодня» превращалось во
    /// вчера, а понедельник зарплатной недели — в воскресенье, которое сервер
    /// как начало недели не принимает.
    ///
    /// Обратный проход не ломается: `parseDateOnly` ставит полдень UTC, а он
    /// попадает в те же сутки в любом поясе от UTC−11 до UTC+11.
    public static func dateOnlyString(from date: Date) -> String {
        let components = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(
            format: "%04d-%02d-%02d",
            components.year ?? 0,
            components.month ?? 0,
            components.day ?? 0
        )
    }
}
