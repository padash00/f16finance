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
    /// Последняя ошибка загрузки прав. Показывается поверх интерфейса, не
    /// подменяя его: работать по прежним правам всё ещё можно.
    private(set) var roleError: String?
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
    private var refreshTask: Task<RefreshOutcome, Never>?

    /// Чем закончилась попытка продлить сессию.
    ///
    /// Разница принципиальная. `rejected` — сервер сказал, что этот
    /// refresh-токен больше не действителен: сессия мертва, и держаться за неё
    /// нечего. `temporary` — до сервера не дошли или он сам не в себе: токен,
    /// возможно, живой, и выбрасывать человека из аккаунта не за что.
    private enum RefreshOutcome {
        case token(String)
        case rejected
        case temporary
    }

    /// Последнее продление отвергнуто сервером. Только в этом случае 401
    /// означает конец сессии, а не оборванную связь.
    private var lastRefreshRejected = false

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
        //
        // Но неудача продления сама по себе не повод разлогинивать. Раньше
        // здесь стоял безусловный `signOut()`, и приложение, открытое в метро
        // или при моргнувшем сервере, стирало сессию из Keychain — человек
        // закрывал приложение вошедшим, а открывал на экране входа. Выходим
        // только когда сервер прямо сказал, что токен недействителен.
        if stored.isExpiringSoon {
            if case .rejected = await refreshSession() {
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

    /// Переключить активную организацию.
    ///
    /// При неудаче откатываемся: оставить приложение с выбранной организацией,
    /// права по которой не загрузились, — значит показать пустой интерфейс без
    /// объяснения, что произошло.
    func setOrganization(_ id: String?) async {
        let previous = organizationID
        organizationID = id
        await api.setOrganization(id)

        if await loadRole() { return }

        organizationID = previous
        await api.setOrganization(previous)
        _ = await loadRole()
        roleError = "Не удалось открыть организацию. Вернулись к прежней."
    }

    // ── Роль ─────────────────────────────────────────────────────────────────

    /// Загрузить права. Возвращает `true`, если получилось.
    ///
    /// Ключевое: при неудаче **уже загруженная роль сохраняется**. Раньше она
    /// обнулялась, и одна неудачная попытка выбрасывала пользователя на экран
    /// «не удалось получить доступы» — хотя рабочие права были на руках, и
    /// приложение могло продолжать работать.
    @discardableResult
    private func loadRole() async -> Bool {
        do {
            let loaded: SessionRole = try await api.send(APIRequest(path: "/api/auth/session-role"))
            role = loaded
            roleLoadedAt = Date()
            roleError = nil
            phase = .signedIn
            // Токен push отправляется только при живой сессии — эндпоинт
            // регистрации требует Bearer.
            PushManager.shared.sessionDidStart()
            return true
        } catch {
            // Истёкшая сессия — единственный случай, когда выход оправдан. Но
            // 401 при оборванном продлении означает лишь, что старый токен не
            // успели обменять: сессия могла остаться живой. Выходим, только
            // если сервер сам отверг refresh-токен.
            if case APIError.unauthorized = error, lastRefreshRejected {
                await signOut()
                return false
            }

            roleError = (error as? APIError)?.userMessage ?? error.localizedDescription
            phase = .signedIn
            return false
        }
    }

    func reloadRole() async {
        await loadRole()
    }

    /// Когда права загружались в последний раз.
    private var roleLoadedAt: Date?

    /// Перечитать права, если они устарели.
    ///
    /// Права выдают на сайте, пока человек держит приложение в кармане. Раньше
    /// набор прав брался один раз при входе и жил до выхода из аккаунта: чтобы
    /// увидеть только что выданный раздел, приходилось выходить и заходить
    /// заново. Теперь достаточно вернуться в приложение или потянуть список.
    ///
    /// Порог нужен, чтобы каждое переключение между приложениями не тянуло
    /// сеть: права меняются раз в недели, а в фон и обратно человек уходит
    /// десятки раз за день.
    func refreshRoleIfStale(minInterval: TimeInterval = 60) async {
        guard phase == .signedIn else { return }
        if let roleLoadedAt, Date().timeIntervalSince(roleLoadedAt) < minInterval { return }
        await loadRole()
    }

    // ── Токены ───────────────────────────────────────────────────────────────

    private func persist(_ newSession: SessionClient.Session) {
        session = newSession
        lastRefreshRejected = false
        if let data = try? JSONEncoder().encode(newSession) {
            keychain.save(data)
        }
    }

    fileprivate func performRefresh() async -> String? {
        if case let .token(value) = await refreshSession() { return value }
        return nil
    }

    /// Обновление с защитой от параллельных вызовов: несколько запросов,
    /// получивших 401 одновременно, должны использовать один refresh, иначе
    /// сервер отзовёт refresh-токен как переиспользованный.
    private func refreshSession() async -> RefreshOutcome {
        if let existing = refreshTask {
            return await existing.value
        }

        guard let refreshToken = session?.refreshToken else {
            // Токена нет вовсе — продлевать нечего, и это именно конец сессии.
            lastRefreshRejected = true
            return .rejected
        }

        let task = Task<RefreshOutcome, Never> { [auth] in
            do {
                let refreshed = try await auth.refresh(refreshToken: refreshToken)
                await MainActor.run { self.persist(refreshed) }
                return .token(refreshed.accessToken)
            } catch SessionClient.AuthError.invalidCredentials {
                // 401 на продлении: сервер отозвал refresh-токен.
                return .rejected
            } catch {
                // Сеть, 429, 5xx, неготовый сервер — сессию не трогаем.
                return .temporary
            }
        }

        refreshTask = task
        let result = await task.value
        refreshTask = nil

        if case .rejected = result {
            lastRefreshRejected = true
        } else {
            lastRefreshRejected = false
        }
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

extension AuthStore {
    /// Скрыть сообщение об ошибке прав.
    func dismissRoleError() {
        roleError = nil
    }
}
