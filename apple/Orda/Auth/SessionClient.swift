import Foundation

/// Вход и продление сессии — через сайт, а не через Supabase напрямую.
///
/// Приложение знает ровно один адрес: `ORDA_API_BASE_URL`. Ни адреса Supabase,
/// ни его ключа в сборке нет — обмен пароля на токен делает сервер в
/// `/api/auth/mobile-session`. Дальше полученный токен просто прикладывается
/// к обычным запросам API.
struct SessionClient: Sendable {
    let baseURL: URL
    private let urlSession: URLSession

    init(baseURL: URL, urlSession: URLSession = .shared) {
        self.baseURL = baseURL
        self.urlSession = urlSession
    }

    // ── Модель ───────────────────────────────────────────────────────────────

    struct Session: Codable, Sendable, Equatable {
        let accessToken: String
        let refreshToken: String
        /// Момент истечения. Обновляемся заранее, не дожидаясь 401.
        let expiresAt: Date
        let userID: String
        let email: String?

        var isExpiringSoon: Bool {
            expiresAt.timeIntervalSinceNow < 120
        }
    }

    enum AuthError: LocalizedError, Equatable {
        /// `hint` — как сервер прочитал ввод: по логину или по почте. Операторы
        /// входят по логину, сотрудники по почте, и решает наличие «@».
        /// Оператор, набравший свою почту, получал «неверный логин или пароль»
        /// без единой зацепки — и пробовал то же самое ещё раз.
        case invalidCredentials(hint: String?)
        case rateLimited
        case notConfigured
        /// Сервер отвечает, но эндпоинта входа у него нет.
        case endpointMissing
        case network(String)
        case server(String)

        var errorDescription: String? {
            switch self {
            case let .invalidCredentials(hint):
                hint ?? "Неверный логин или пароль."
            case .rateLimited:
                "Слишком много попыток входа. Подождите пару минут."
            case .notConfigured:
                "Вход временно недоступен: сервер не настроен."
            case .endpointMissing:
                // Единственная причина — на сайте ещё старая версия. «404»
                // пользователю ничего не объясняет, а это состояние реально
                // случится у тех, кто обновил приложение раньше сервера.
                "Сайт ещё не обновлён под это приложение. Обратитесь к администратору."
            case let .network(message):
                "Нет связи с сервером. \(message)"
            case let .server(message):
                message
            }
        }
    }

    // ── Ответы сервера ───────────────────────────────────────────────────────

    private struct SessionResponse: Decodable {
        let session: Payload

        struct Payload: Decodable {
            let access_token: String
            let refresh_token: String
            let expires_at: Double
            let user: User

            struct User: Decodable {
                let id: String
                let email: String?
            }
        }
    }

    private struct ErrorResponse: Decodable {
        let error: String?
        let message: String?
    }

    // ── Операции ─────────────────────────────────────────────────────────────

    /// Вход. `login` — почта сотрудника или логин оператора: различает сервер.
    func signIn(login: String, password: String) async throws -> Session {
        try await post(body: [
            "action": "signIn",
            "login": login.trimmingCharacters(in: .whitespacesAndNewlines),
            "password": password,
        ])
    }

    func refresh(refreshToken: String) async throws -> Session {
        try await post(body: ["action": "refresh", "refresh_token": refreshToken])
    }

    // ── Сброс пароля ─────────────────────────────────────────────────────────
    //
    // Целиком здесь, без ухода на сайт: пароль просят тогда, когда он нужен
    // прямо сейчас, а четыре перехода в браузер и обратно теряют половину
    // людей на середине.

    /// Попросить письмо с кодом. Ответ одинаковый и для заведённой почты, и
    /// для незаведённой — сервер намеренно не говорит, кто есть в компании.
    func requestPasswordReset(email: String) async throws {
        try await postWithoutSession(body: [
            "action": "request",
            "email": email.trimmingCharacters(in: .whitespacesAndNewlines),
        ])
    }

    /// Поставить новый пароль по коду из письма.
    func confirmPasswordReset(email: String, code: String, password: String) async throws {
        try await postWithoutSession(body: [
            "action": "confirm",
            "email": email.trimmingCharacters(in: .whitespacesAndNewlines),
            "code": code.trimmingCharacters(in: .whitespacesAndNewlines),
            "password": password,
        ])
    }

    /// Запрос без сессии в ответе: важен только исход и текст ошибки.
    private func postWithoutSession(body: [String: String]) async throws {
        var request = URLRequest(url: baseURL.appending(path: "api/auth/password-reset"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await urlSession.data(for: request)
        } catch {
            throw AuthError.network(error.localizedDescription)
        }

        guard let http = response as? HTTPURLResponse else {
            throw AuthError.server("Некорректный ответ сервера")
        }
        guard (200..<300).contains(http.statusCode) else {
            let payload = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            switch http.statusCode {
            case 404:
                throw AuthError.endpointMissing
            case 429:
                throw AuthError.rateLimited
            case 503:
                throw AuthError.notConfigured
            default:
                throw AuthError.server(payload?.message ?? payload?.error ?? "Не удалось сбросить пароль")
            }
        }
    }

    private func post(body: [String: String]) async throws -> Session {
        var request = URLRequest(url: baseURL.appending(path: "api/auth/mobile-session"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await urlSession.data(for: request)
        } catch {
            throw AuthError.network(error.localizedDescription)
        }

        guard let http = response as? HTTPURLResponse else {
            throw AuthError.server("Некорректный ответ сервера")
        }

        guard (200..<300).contains(http.statusCode) else {
            let payload = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            switch http.statusCode {
            case 401:
                throw AuthError.invalidCredentials(hint: payload?.message)
            case 404:
                throw AuthError.endpointMissing
            case 429:
                throw AuthError.rateLimited
            case 503:
                throw AuthError.notConfigured
            default:
                throw AuthError.server(payload?.message ?? "Ошибка входа (\(http.statusCode))")
            }
        }

        guard let decoded = try? JSONDecoder().decode(SessionResponse.self, from: data) else {
            throw AuthError.server("Не удалось прочитать ответ сервера")
        }

        return Session(
            accessToken: decoded.session.access_token,
            refreshToken: decoded.session.refresh_token,
            expiresAt: Date(timeIntervalSince1970: decoded.session.expires_at),
            userID: decoded.session.user.id,
            email: decoded.session.user.email
        )
    }
}
