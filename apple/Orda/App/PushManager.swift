import Foundation
import OrdaKit
import UserNotifications

#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Регистрация устройства для push-уведомлений.
///
/// Канал на сервере уже есть (`lib/server/apns.ts`), но пока приложение не
/// отдаст токен, отправлять некуда. Здесь: спросить разрешение → получить
/// токен от APNs → передать его на сайт.
///
/// Разрешение спрашиваем **после входа**, а не на первом экране: до входа
/// человек ещё не понимает, о чём его будут уведомлять, и почти всегда
/// отказывает. Отказ в iOS необратим из приложения — второй попытки не будет.
@MainActor
@Observable
final class PushManager {
    enum Status: Equatable {
        case unknown
        case notRequested
        case denied
        case authorized(registered: Bool)
    }

    private(set) var status: Status = .unknown

    /// Куда вести после нажатия на уведомление.
    ///
    /// Уведомление, которое просто открывает приложение на сводке, заставляет
    /// человека искать то, о чём его только что известили. Здесь запоминаем
    /// раздел, а корневой экран его открывает.
    var pendingRoute: PushRoute?

    /// Раздел, на который ведёт уведомление.
    enum PushRoute: Equatable {
        case news
        case directMessages
        case teamChat
        case staff
        case birthdays
        case approvals
        case tasks
        case shifts

        /// Идентификатор страницы каталога — по нему строится и меню.
        var pageID: String {
            switch self {
            case .news: "news"
            case .directMessages: "messages"
            case .teamChat: "team-chat"
            case .staff: "staff"
            case .birthdays: "birthdays"
            case .approvals: "expenses-pending"
            case .tasks: "tasks"
            case .shifts: "shifts"
            }
        }

        /// Что прислал сервер в поле `kind`.
        init?(kind: String) {
            switch kind {
            case "news": self = .news
            case "direct-message": self = .directMessages
            case "team-chat-announcement", "team-chat-mention": self = .teamChat
            case "staff-account-deleted": self = .staff
            case "birthday": self = .birthdays
            case "expense-approval": self = .approvals
            case "task": self = .tasks
            case "shift-request": self = .shifts
            default: return nil
            }
        }
    }

    /// Токен, полученный от APNs. Отправляется, как только появится и сессия.
    private var deviceToken: String?
    private var api: APIClient?
    private var isSignedIn = false

    static let shared = PushManager()

    private init() {}

    func configure(api: APIClient) {
        self.api = api
        registerCategories()
    }

    // ── Действия прямо в уведомлении ─────────────────────────────────────────

    /// Категории с кнопками.
    ///
    /// Смысл в том, чтобы не открывать приложение ради одного касания:
    /// расход одобряют между делом, на сообщение отвечают одной строкой. Обе
    /// категории безопасны — одобрение и ответ не разрушают ничего, что нельзя
    /// поправить, и оба видны в журнале.
    private func registerCategories() {
        let approve = UNNotificationAction(
            identifier: Action.approveExpense.rawValue,
            title: "Одобрить",
            options: [.authenticationRequired]
        )
        let expense = UNNotificationCategory(
            identifier: Category.expenseApproval.rawValue,
            actions: [approve],
            intentIdentifiers: []
        )

        let reply = UNTextInputNotificationAction(
            identifier: Action.replyMessage.rawValue,
            title: "Ответить",
            options: [],
            textInputButtonTitle: "Отправить",
            textInputPlaceholder: "Сообщение"
        )
        let message = UNNotificationCategory(
            identifier: Category.directMessage.rawValue,
            actions: [reply],
            intentIdentifiers: []
        )

        UNUserNotificationCenter.current().setNotificationCategories([expense, message])
    }

    enum Category: String {
        case expenseApproval = "expense-approval"
        case directMessage = "direct-message"
    }

    enum Action: String {
        case approveExpense = "orda.action.approve-expense"
        case replyMessage = "orda.action.reply-message"
    }

    /// Одобрить расход, не открывая приложение.
    func approveExpense(id: String) async {
        guard let api else { return }
        do {
            _ = try await api.send(
                APIRequest(path: "/api/admin/expenses/\(id)/approve", method: .post)
            )
        } catch {
            await reportActionFailure("Расход не одобрен", reason: error)
        }
    }

    /// Ответить на личное сообщение прямо из уведомления.
    func replyToMessage(userID: String, text: String) async {
        guard let api, !text.isEmpty else { return }
        // Имена полей — те, что читает роут: `recipientUserId` и `message`.
        let body = try? JSONSerialization.data(
            withJSONObject: ["recipientUserId": userID, "message": text]
        )
        do {
            _ = try await api.send(
                APIRequest(path: "/api/direct-messages", method: .post, body: body)
            )
        } catch {
            await reportActionFailure("Ответ не отправлен", reason: error)
        }
    }

    /// Сказать, что действие из уведомления не прошло.
    ///
    /// Эти два действия человек делает, не открывая приложение: нажал
    /// «Одобрить» — и пошёл дальше, уверенный, что расход одобрен. Отказ здесь
    /// молчал, и узнать о нём было неоткуда: экрана нет, приложение закрыто.
    ///
    /// Поэтому отвечаем тем же способом, каким спросили, — уведомлением.
    private func reportActionFailure(_ title: String, reason: Error) async {
        let message: String
        if let apiError = reason as? APIError {
            message = apiError.userMessage
        } else {
            message = reason.localizedDescription
        }

        let content = UNMutableNotificationContent()
        content.title = title
        content.body = "\(message) Откройте приложение и повторите."
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: "orda.action-failed.\(UUID().uuidString)",
            content: content,
            trigger: nil
        )
        try? await UNUserNotificationCenter.current().add(request)
    }

    // ── Разрешение ───────────────────────────────────────────────────────────

    /// Текущее состояние разрешения, без запроса.
    func refreshStatus() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .notDetermined:
            status = .notRequested
        case .denied:
            status = .denied
        case .authorized, .provisional, .ephemeral:
            status = .authorized(registered: registrationAccepted)
            registerForRemoteNotifications()
        @unknown default:
            status = .unknown
        }
    }

    /// Запросить разрешение и зарегистрироваться. Зовётся после входа.
    @discardableResult
    func request() async -> Bool {
        do {
            let granted = try await UNUserNotificationCenter.current()
                .requestAuthorization(options: [.alert, .badge, .sound])
            status = granted ? .authorized(registered: false) : .denied
            if granted { registerForRemoteNotifications() }
            return granted
        } catch {
            status = .denied
            return false
        }
    }

    private func registerForRemoteNotifications() {
        #if canImport(UIKit)
        UIApplication.shared.registerForRemoteNotifications()
        #elseif canImport(AppKit)
        NSApplication.shared.registerForRemoteNotifications()
        #endif
    }

    // ── Токен ────────────────────────────────────────────────────────────────

    /// Пришёл токен от APNs. Сырые байты переводим в hex — сервер ждёт именно
    /// такую форму (`isApnsToken` проверяет hex-строку).
    func didReceive(deviceToken data: Data) {
        let token = data.map { String(format: "%02x", $0) }.joined()
        deviceToken = token
        // «Зарегистрировано» — это когда адрес принял сервер, а не когда его
        // выдал Apple. Ставим после ответа сервера, ниже.
        status = .authorized(registered: registrationAccepted)
        Task { await sendTokenIfPossible() }
    }

    func didFailToRegister(error: Error) {
        // На симуляторе без настроенного APNs это ожидаемо — не шумим на
        // экране. Но текст ошибки сохраняем: на живом телефоне это
        // единственное место, где Apple объясняет, почему адрес не выдан —
        // например, что у приложения нет права на уведомления. Без этой
        // строчки «уведомления не приходят» неразрешимо: сервер видит только
        // отсутствие устройства и причины назвать не может.
        lastRegistrationError = error.localizedDescription
        status = .authorized(registered: false)
    }

    /// Почему Apple не выдал адрес. Пусто — не выдавал или всё в порядке.
    private(set) var lastRegistrationError: String?

    /// Вход состоялся: отправляем токен, если он уже есть.
    func sessionDidStart() {
        isSignedIn = true
        Task { await sendTokenIfPossible() }
    }

    func sessionDidEnd() {
        isSignedIn = false
    }

    /// Токен уходит на сайт только когда есть и он, и авторизованная сессия:
    /// эндпоинт регистрации требует Bearer-токен.
    private func sendTokenIfPossible() async {
        // Раньше здесь стоял один `guard` на три условия — и при любом из них
        // отправка молча не происходила. Снаружи это выглядело так: разрешение
        // есть, адрес у телефона есть, в базе ноль устройств, в журнале
        // сервера пусто. То есть запрос не уходил, и понять, какое из трёх
        // условий не выполнено, было нельзя ни изнутри, ни снаружи.
        //
        // Теперь каждое молчание называет себя.
        guard let api else {
            lastRegistrationError = "приложение ещё не готово к запросам"
            return
        }
        guard let deviceToken else {
            lastRegistrationError = "адреса от Apple пока нет"
            return
        }
        guard isSignedIn else {
            lastRegistrationError = "вход ещё не подтверждён сервером"
            return
        }

        let body: [String: Any] = ["token": deviceToken, "platform": platformName]
        guard let data = try? JSONSerialization.data(withJSONObject: body) else { return }

        // Провал регистрации не ломает интерфейс — но и не исчезает.
        //
        // Здесь стоял `try?`: отказ сервера уходил в пустоту, адрес не
        // сохранялся, и снаружи это выглядело как «уведомления просто не
        // приходят». В базе — ноль устройств, и причину назвать нечем.
        //
        // Теперь причина остаётся в `lastRegistrationError` — её показывает
        // проверка в настройках. А `registered` ставим только после того, как
        // сервер адрес принял: до этого «зарегистрировано» было обещанием, за
        // которым ничего не стояло.
        do {
            _ = try await api.send(
                APIRequest(path: "/api/mobile/register-push", method: .post, body: data)
            )
            registrationAccepted = true
            lastRegistrationError = nil
            status = .authorized(registered: true)
        } catch let error as APIError {
            registrationAccepted = false
            lastRegistrationError = "Сервер не принял адрес: \(error.userMessage)"
            status = .authorized(registered: false)
        } catch {
            registrationAccepted = false
            lastRegistrationError = "Не удалось отправить адрес: \(error.localizedDescription)"
            status = .authorized(registered: false)
        }
    }

    /// Принял ли сервер адрес. Наличие адреса у Apple ещё не значит, что о нём
    /// знает сервер, — а уведомление шлёт именно он.
    private(set) var registrationAccepted = false

    // ── Проверка ─────────────────────────────────────────────────────────────

    /// Отправить уведомление самому себе и вернуть, что ответил сервер.
    ///
    /// «Не приходит» — это три разные поломки: не спросили разрешение, не
    /// зарегистрировали устройство, не настроен канал у сервера. Снаружи они
    /// неотличимы, и человек остаётся один на один с тишиной. Здесь он нажимает
    /// одну кнопку и читает прямой ответ.
    func sendTest() async -> String {
        guard let api else { return "Приложение ещё не готово, попробуйте через секунду." }

        // Симулятору Apple адрес для уведомлений не выдаёт вовсе — сколько ни
        // разрешай. Без этой оговорки честный ответ сервера «устройств нет»
        // читается как поломка, и её начинают чинить там, где всё исправно.
        #if targetEnvironment(simulator)
        return "Это симулятор — Apple не выдаёт ему адрес для уведомлений. Проверьте на настоящем телефоне со сборкой из TestFlight."
        #else

        // Сначала разрешение: без него уведомление уйдёт и не покажется, а
        // человек решит, что сломан сервер.
        await refreshStatus()
        if case .notRequested = status { _ = await request() }
        if case .denied = status {
            return "Уведомления запрещены в настройках телефона. Откройте «Настройки» → Orda → «Уведомления»."
        }

        // Токен приходит от системы не мгновенно после первого разрешения:
        // ждём его до шести секунд, проверяя каждые полсекунды. Прежние две
        // секунды не покрывали медленную сеть, и человек получал «устройств
        // нет» на исправном телефоне.
        if deviceToken == nil {
            registerForRemoteNotifications()
            for _ in 0..<12 {
                try? await Task.sleep(for: .milliseconds(500))
                if deviceToken != nil { break }
            }
            await sendTokenIfPossible()
        }

        // Адрес так и не пришёл — и Apple объяснил почему. Это чинится не на
        // сервере, поэтому текст показываем как есть.
        if deviceToken == nil, let lastRegistrationError {
            return "Телефон не смог получить адрес для уведомлений у Apple: \(lastRegistrationError)"
        }
        if deviceToken == nil {
            return "Телефон пока не получил адрес для уведомлений у Apple. Проверьте связь и попробуйте ещё раз через минуту."
        }

        // Адрес есть, но сервер о нём не знает.
        //
        // Здесь проверка обрывалась: она шла спрашивать сервер, а тот честно
        // отвечал «ни одно устройство не зарегистрировано» — и настоящая
        // причина (сервер отказался принять адрес) не показывалась никогда.
        // Именно так выглядела поломка снаружи: адрес у телефона есть, в базе
        // пусто, объяснения нет.
        if !registrationAccepted {
            await sendTokenIfPossible()
            if !registrationAccepted {
                return lastRegistrationError.map { "Адрес у телефона есть, но сервер его не принял. \($0)" }
                    ?? "Адрес у телефона есть, но сервер его не принял. Причина неизвестна — попробуйте ещё раз."
            }
        }

        struct Result: Decodable {
            let ok: Bool?
            let message: String?
        }

        do {
            let result: Result = try await api.send(
                APIRequest(path: "/api/me/push-test", method: .post)
            )
            return result.message ?? (result.ok == true ? "Отправлено." : "Не удалось отправить.")
        } catch let error as APIError {
            return error.userMessage
        } catch {
            return error.localizedDescription
        }
        #endif
    }

    private var platformName: String {
        #if os(macOS)
        "macos"
        #else
        UIDevice.current.userInterfaceIdiom == .pad ? "ipados" : "ios"
        #endif
    }
}

// ── Показ и нажатие ──────────────────────────────────────────────────────────

/// Делегат центра уведомлений.
///
/// Нужен ради двух вещей, которых iOS сам не делает. Первое: уведомление,
/// пришедшее при открытом приложении, по умолчанию не показывается вовсе —
/// человек пишет в личные сообщения, адресат сидит в приложении и не узнаёт об
/// этом. Второе: нажатие на уведомление открывает приложение там, где его
/// закрыли, и о чём было уведомление — искать самому.
final class PushDelegate: NSObject, UNUserNotificationCenterDelegate, @unchecked Sendable {
    /// Состояния у делегата нет — он только разбирает полезную нагрузку и
    /// передаёт её в `PushManager`, который живёт на главном потоке.
    static let shared = PushDelegate()

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound, .badge]
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let payload = response.notification.request.content.userInfo

        // Сначала кнопки: нажали «Одобрить» — приложение открывать незачем.
        switch response.actionIdentifier {
        case PushManager.Action.approveExpense.rawValue:
            if let id = payload["expenseId"] as? String, !id.isEmpty {
                await PushManager.shared.approveExpense(id: id)
            }
            return
        case PushManager.Action.replyMessage.rawValue:
            if let textResponse = response as? UNTextInputNotificationResponse,
               let from = payload["from"] as? String {
                await PushManager.shared.replyToMessage(
                    userID: from,
                    text: textResponse.userText.trimmingCharacters(in: .whitespacesAndNewlines)
                )
            }
            return
        default:
            break
        }

        guard let kind = payload["kind"] as? String,
              let route = PushManager.PushRoute(kind: kind) else { return }
        await MainActor.run { PushManager.shared.pendingRoute = route }
    }
}

// ── Делегат приложения ───────────────────────────────────────────────────────

#if canImport(UIKit)
/// Токен APNs приходит только в делегат приложения — в SwiftUI-сцене его не
/// получить, поэтому минимальный делегат нужен даже в чистом SwiftUI-приложении.
final class OrdaAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = PushDelegate.shared
        // Холодный запуск из меню иконки: система кладёт выбранный пункт сюда,
        // и другого способа его увидеть нет.
        if let item = options?[.shortcutItem] as? UIApplicationShortcutItem {
            Task { @MainActor in QuickActions.handle(item) }
        }
        return true
    }

    /// Нажали пункт меню, когда приложение уже было запущено.
    func application(
        _ application: UIApplication,
        performActionFor shortcutItem: UIApplicationShortcutItem
    ) async -> Bool {
        await MainActor.run { QuickActions.handle(shortcutItem) }
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { @MainActor in PushManager.shared.didReceive(deviceToken: deviceToken) }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        Task { @MainActor in PushManager.shared.didFailToRegister(error: error) }
    }
}
#elseif canImport(AppKit)
final class OrdaAppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        UNUserNotificationCenter.current().delegate = PushDelegate.shared
    }

    func application(
        _ application: NSApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { @MainActor in PushManager.shared.didReceive(deviceToken: deviceToken) }
    }

    func application(
        _ application: NSApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        Task { @MainActor in PushManager.shared.didFailToRegister(error: error) }
    }
}
#endif
