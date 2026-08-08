import Foundation
import OrdaKit
import SwiftUI

/// Состояние сессии приложения.
///
/// Держит токены, роль и активную организацию. Отсюда же берёт токен
/// `APIClient` — через `TokenProvider`, поэтому сетевой слой ничего не знает
/// об устройстве аутентификации.
@MainActor
@Observable
final class AuthStore {
    enum Phase: Equatable {
        /// Восстанавливаем сессию из Keychain.
        case restoring
        case signedOut
        /// Есть токен, но роль ещё не загружена.
        case loadingRole
        case signedIn
        /// Сессия есть, но интерфейс закрыт биометрией.
        case locked
    }

    private(set) var phase: Phase = .restoring
    private(set) var session: SessionClient.Session?
    private(set) var role: SessionRole?
    private(set) var signInError: String?
    private(set) var isSigningIn = false

    /// Активная организация. Для мультиорганизационных владельцев и суперадмина.
    private(set) var organizationID: String?

    var resolver: AccessResolver? {
        role.map(AccessResolver.init(session:))
    }

    private let auth: SessionClient
    private let keychain: KeychainStore
    private let api: APIClient
    /// Защищает от гонки, когда несколько запросов одновременно получили 401.
    private var refreshTask: Task<String?, Never>?

    init(auth: SessionClient, keychain: KeychainStore, api: APIClient) {
        self.auth = auth
        self.keychain = keychain
        self.api = api
    }

    // ── Жизненный цикл ───────────────────────────────────────────────────────

    /// Восстановить сессию при запуске.
    func restore() async {
        guard
            let data = keychain.load(),
            let stored = try? JSONDecoder().decode(SessionClient.Session.self, from: data)
        else {
            phase = .signedOut
            return
        }

        session = stored

        // Протухший токен обновляем до первого запроса — иначе главный экран
        // встретит пользователя ошибкой вместо данных.
        if stored.isExpiringSoon {
            guard await performRefresh() != nil else {
                await signOut()
                return
            }
        }

        phase = .loadingRole
        await loadRole()
    }

    func signIn(login: String, password: String) async {
        guard !isSigningIn else { return }
        isSigningIn = true
        signInError = nil
        defer { isSigningIn = false }

        do {
            let newSession = try await auth.signIn(login: login, password: password)
            persist(newSession)
            phase = .loadingRole
            await loadRole()
        } catch {
            signInError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            phase = .signedOut
        }
    }

    func signOut() async {
        // Токен просто выбрасываем: он короткоживущий, а refresh без него
        // бесполезен. Отдельный серверный «выход» ради этого не нужен.
        keychain.clear()
        PushManager.shared.sessionDidEnd()
        session = nil
        role = nil
        organizationID = nil
        await api.setOrganization(nil)
        phase = .signedOut
    }

    func setOrganization(_ id: String?) async {
        organizationID = id
        await api.setOrganization(id)
        // Права зависят от организации: суперадмин, переключившись, получает
        // другой набор модулей и другой рубильник.
        await loadRole()
    }

    // ── Роль ─────────────────────────────────────────────────────────────────

    private func loadRole() async {
        do {
            let loaded: SessionRole = try await api.send(APIRequest(path: "/api/auth/session-role"))
            role = loaded
            phase = .signedIn
            // Токен push отправляется только при живой сессии — эндпоинт
            // регистрации требует Bearer.
            PushManager.shared.sessionDidStart()
        } catch {
            // Роль не загрузилась при живом токене — чаще всего сеть. Оставляем
            // пользователя внутри, экраны сами покажут ошибку и предложат
            // повтор; выкидывать на логин было бы грубо.
            if case APIError.unauthorized = error {
                await signOut()
            } else {
                role = nil
                phase = .signedIn
            }
        }
    }

    func reloadRole() async {
        await loadRole()
    }

    // ── Токены ───────────────────────────────────────────────────────────────

    private func persist(_ newSession: SessionClient.Session) {
        session = newSession
        if let data = try? JSONEncoder().encode(newSession) {
            keychain.save(data)
        }
    }

    /// Обновление с защитой от параллельных вызовов: несколько запросов,
    /// получивших 401 одновременно, должны использовать один refresh, иначе
    /// сервер отзовёт refresh-токен как переиспользованный.
    fileprivate func performRefresh() async -> String? {
        if let existing = refreshTask {
            return await existing.value
        }

        guard let refreshToken = session?.refreshToken else { return nil }

        let task = Task<String?, Never> { [auth] in
            do {
                let refreshed = try await auth.refresh(refreshToken: refreshToken)
                await MainActor.run { self.persist(refreshed) }
                return refreshed.accessToken
            } catch {
                return nil
            }
        }

        refreshTask = task
        let result = await task.value
        refreshTask = nil
        return result
    }

    fileprivate var currentToken: String? { session?.accessToken }
}

/// Мост между хранилищем сессии и сетевым слоем OrdaKit.
///
/// Ссылка на хранилище проставляется после создания: `APIClient` нужен
/// `AuthStore`, а `AuthStore` нужен `APIClient` — разрываем цикл здесь, а не
/// протаскиванием опционалов через весь сетевой слой.
///
/// Класс с замком, а не актор: связывание обязано быть **синхронным**. Пока
/// оно шло через `Task { await connect(...) }`, восстановление сессии успевало
/// уйти в сеть раньше — запрос летел без заголовка Authorization, возвращался
/// 401, и приложение разлогинивало само себя при каждом запуске.
final class AuthTokenProvider: TokenProvider, @unchecked Sendable {
    private let lock = NSLock()
    private weak var _store: AuthStore?

    /// Связать с хранилищем. Синхронно и до первого запроса.
    func connect(_ store: AuthStore) {
        lock.lock()
        defer { lock.unlock() }
        _store = store
    }

    private var store: AuthStore? {
        lock.lock()
        defer { lock.unlock() }
        return _store
    }

    func currentAccessToken() async -> String? {
        await store?.currentToken
    }

    func refreshAccessToken() async throws -> String? {
        await store?.performRefresh()
    }
}
