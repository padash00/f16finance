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
    /// Отдельная запись под биометрией: по ней возвращаются после выхода.
    private let quickEntry: KeychainStore
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
        quickEntry = KeychainStore(account: "quick-entry", requiresBiometry: true)
        hasQuickEntry = quickEntry.exists()
    }

    // ── Быстрый возврат по Face ID ───────────────────────────────────────────

    /// Есть ли сохранённый быстрый вход.
    ///
    /// Выход из приложения — не редкость: промахнулись по кнопке, сменили
    /// организацию, приложение обновилось. Заново вводить логин и пароль от
    /// рабочей системы стоя за стойкой — то, из-за чего пароли пишут на
    /// стикере и клеят к монитору. Банки решают это одинаково: лицо вместо
    /// пароля.
    private(set) var hasQuickEntry = false
    private(set) var quickEntryError: String?

    /// Запрос лица уже показывали в этом запуске.
    ///
    /// Как в банковском приложении: открыл — сразу Face ID, без нажатия
    /// кнопки. Но ровно один раз: отказался или приложил чужой палец — дальше
    /// экран ведёт себя обычно и ждёт пароль, а не долбит запросом по кругу.
    private(set) var quickEntryOffered = false

    /// Не предлагать лицо автоматически до следующего запуска.
    ///
    /// Ставится после явного выхода: человек вышел осознанно — может, отдаёт
    /// телефон сменщику, — и встречать его тем же лицом было бы издевательством.
    private var suppressAutoQuickEntry = false

    /// Показать ли Face ID сразу при открытии экрана входа.
    var shouldOfferQuickEntry: Bool {
        hasQuickEntry && !quickEntryOffered && !suppressAutoQuickEntry && Biometrics.isAvailable
    }

    /// Автоматический быстрый вход при запуске.
    func offerQuickEntryIfPossible() async {
        guard shouldOfferQuickEntry else { return }
        quickEntryOffered = true
        await signInWithBiometrics()
    }

    /// Сохранить возможность быстрого возврата.
    ///
    /// Храним refresh-токен, а не пароль: пароль в связке ключей — это пароль,
    /// который можно украсть целиком, а токен отзывается на сервере и живёт
    /// ограниченно.
    private func rememberQuickEntry(_ session: SessionClient.Session) {
        guard let data = try? JSONEncoder().encode(session) else { return }
        quickEntry.save(data)
        hasQuickEntry = quickEntry.exists()
    }

    /// Забыть устройство. Вызывается из настроек аккаунта и при удалении.
    func forgetQuickEntry() {
        quickEntry.clear()
        hasQuickEntry = false
    }

    /// Войти по Face ID. Запрос лица покажет сама система — при чтении записи.
    func signInWithBiometrics() async {
        quickEntryError = nil
        quickEntryOffered = true
        guard let data = quickEntry.load(prompt: "Вход в Orda"),
              let stored = try? JSONDecoder().decode(SessionClient.Session.self, from: data)
        else {
            // Отказ Face ID и отсутствие записи выглядят одинаково: и то и
            // другое означает «войдите паролем», без обвинений.
            quickEntryError = "Не удалось подтвердить личность. Войдите логином и паролем."
            return
        }

        isSigningIn = true
        defer { isSigningIn = false }

        do {
            let session = try await auth.refresh(refreshToken: stored.refreshToken)
            persist(session)
            await loadRole()
        } catch {
            // Токен мёртв: пароль сменили, вход отозвали или прошло слишком
            // много времени. Держаться за него незачем.
            forgetQuickEntry()
            quickEntryError = "Быстрый вход устарел — войдите логином и паролем."
        }
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
                await signOutAutomatically(
                    reason: "При запуске сервер отклонил продление сессии — вход нужен заново."
                )
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
            automaticSignOutReason = nil
            suppressAutoQuickEntry = false
            persist(newSession)
            phase = .loadingRole
            await loadRole()
        } catch {
            signInError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            phase = .signedOut
        }
    }

    /// Почему сессия закончилась сама.
    ///
    /// Экран входа выглядел одинаково после «нажал выйти» и после «приложение
    /// вышло само» — и разобраться, почему человека выкидывает, было не по
    /// чему: он видит форму входа и всё. Причина переживает перезапуск и
    /// показывается над формой до первого успешного входа.
    var automaticSignOutReason: String? {
        get { UserDefaults.standard.string(forKey: Self.signOutReasonKey) }
        set {
            if let newValue { UserDefaults.standard.set(newValue, forKey: Self.signOutReasonKey) }
            else { UserDefaults.standard.removeObject(forKey: Self.signOutReasonKey) }
        }
    }

    private static let signOutReasonKey = "auth.automaticSignOutReason"

    /// Выход, которого человек не просил. Причина остаётся на экране входа.
    func signOutAutomatically(reason: String) async {
        automaticSignOutReason = reason
        await signOut()
    }

    func signOut() async {
        // Токен просто выбрасываем: он короткоживущий, а refresh без него
        // бесполезен. Отдельный серверный «выход» ради этого не нужен.
        keychain.clear()
        // Запись быстрого входа переживает выход намеренно: ради неё всё и
        // затевалось. Стереть её можно в настройках аккаунта — «забыть это
        // устройство».
        PushManager.shared.sessionDidEnd()
        #if os(iOS)
        // Иначе карточка смены останется на экране блокировки уже вышедшего
        // человека — с выручкой точки.
        ShiftLiveActivityController.stop()
        #endif
        // Сохранённые ответы — тоже данные точки: следующий вошедший не
        // должен увидеть чужую выручку, пока грузится своя.
        await api.clearCache()
        suppressAutoQuickEntry = true
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
                await signOutAutomatically(
                    reason: "Сервер не принял сессию при загрузке прав — вход нужен заново."
                )
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

    // ── Замок ────────────────────────────────────────────────────────────────

    /// Спрашивать биометрию при возврате в приложение.
    ///
    /// Настройка человека, а не политика: из приложения видно зарплаты и
    /// логины команды, но телефон бывает и рабочим инструментом на стойке, где
    /// замок на каждое переключение мешает.
    var isLockEnabled: Bool {
        get { UserDefaults.standard.bool(forKey: Self.lockKey) }
        set {
            UserDefaults.standard.set(newValue, forKey: Self.lockKey)
            // Включили — замок срабатывает со следующего ухода в фон, а не
            // сразу: запирать человека в момент, когда он это только что
            // настроил, бессмысленно.
        }
    }

    private static let lockKey = "orda.lock.biometrics"

    /// Запереть интерфейс. Сессия остаётся живой — закрывается только вид.
    func lock() {
        guard isLockEnabled, phase == .signedIn, Biometrics.isAvailable else { return }
        phase = .locked
    }

    /// Снять замок после успешной проверки.
    func unlock() {
        guard phase == .locked else { return }
        phase = .signedIn
    }

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
        // Refresh-токен вращается: сохранённый при входе устареет через
        // несколько обновлений, и быстрый вход перестал бы работать сам собой.
        rememberQuickEntry(newSession)
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
            } catch SessionClient.AuthError.invalidCredentials(_) {
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
