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
        case birthdays
        case approvals

        /// Идентификатор страницы каталога — по нему строится и меню.
        var pageID: String {
            switch self {
            case .news: "news"
            case .directMessages: "messages"
            case .birthdays: "birthdays"
            case .approvals: "expenses-pending"
            }
        }

        /// Что прислал сервер в поле `kind`.
        init?(kind: String) {
            switch kind {
            case "news": self = .news
            case "direct-message": self = .directMessages
            case "birthday": self = .birthdays
            case "expense-approval": self = .approvals
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
            status = .authorized(registered: deviceToken != nil)
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
        status = .authorized(registered: true)
        Task { await sendTokenIfPossible() }
    }

    func didFailToRegister(error: Error) {
        // На симуляторе без настроенного APNs это ожидаемо. Не шумим.
        status = .authorized(registered: false)
    }

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
        guard isSignedIn, let api, let deviceToken else { return }

        let body: [String: Any] = ["token": deviceToken, "platform": platformName]
        guard let data = try? JSONSerialization.data(withJSONObject: body) else { return }

        // Best-effort: провал регистрации не должен ничего ломать в интерфейсе.
        _ = try? await api.send(
            APIRequest(path: "/api/mobile/register-push", method: .post, body: data)
        )
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
