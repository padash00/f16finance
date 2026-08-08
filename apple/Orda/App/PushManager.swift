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

// ── Делегат приложения ───────────────────────────────────────────────────────

#if canImport(UIKit)
/// Токен APNs приходит только в делегат приложения — в SwiftUI-сцене его не
/// получить, поэтому минимальный делегат нужен даже в чистом SwiftUI-приложении.
final class OrdaAppDelegate: NSObject, UIApplicationDelegate {
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
