import OrdaKit
import OrdaUI
import SwiftUI

@main
struct OrdaApp: App {
    // Токен APNs приходит только в делегат приложения — в SwiftUI-сцене его
    // не получить, поэтому минимальный делегат нужен даже здесь.
    #if os(iOS)
    @UIApplicationDelegateAdaptor(OrdaAppDelegate.self) private var appDelegate
    #else
    @NSApplicationDelegateAdaptor(OrdaAppDelegate.self) private var appDelegate
    #endif

    @State private var auth: AuthStore
    private let api: APIClient

    /// Выбранное оформление. Хранится на устройстве: это настройка глаз, а не
    /// учётной записи — на планшете в тёмном зале и на телефоне в кармане
    /// удобно по-разному.
    @AppStorage(Appearance.storageKey) private var appearance: Appearance = .system

    init() {
        let configuration = AppConfiguration.current
        let provider = AuthTokenProvider()
        let api = APIClient(baseURL: configuration.apiBaseURL, tokenProvider: provider)
        let store = AuthStore(
            auth: SessionClient(baseURL: configuration.apiBaseURL),
            keychain: KeychainStore(),
            api: api
        )

        // Замыкаем цикл синхронно: первый же запрос при восстановлении сессии
        // должен уйти с токеном, иначе 401 выкинет пользователя на логин.
        provider.connect(store)
        PushManager.shared.configure(api: api)

        self.api = api
        _auth = State(initialValue: store)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(auth)
                .environment(\.api, api)
                .tint(Theme.brand)
                // nil — не вмешиваемся: цвета адаптивные и перекрашиваются
                // вслед за системой сами.
                .preferredColorScheme(appearance.colorScheme)
                #if os(iOS)
                // Листы («Аккаунт», формы ввода) показываются отдельным
                // контроллером и тему берут у окна, а не отсюда. Ставим её и
                // окну — иначе выбранная светлая доходила не везде.
                .task(id: appearance) { appearance.applyToWindows() }
                #endif
        }
        #if os(macOS)
        .defaultSize(width: 1180, height: 760)
        .commands {
            OrdaCommands()
        }
        #endif
    }
}

// ── Внедрение сетевого клиента ───────────────────────────────────────────────

private struct APIClientKey: EnvironmentKey {
    // Значение по умолчанию нужно только для превью — реальный клиент всегда
    // приходит из сцены.
    static let defaultValue = APIClient(
        baseURL: URL(string: "https://www.ordaops.kz")!,
        tokenProvider: PreviewTokenProvider()
    )
}

private struct PreviewTokenProvider: TokenProvider {
    func currentAccessToken() async -> String? { nil }
    func refreshAccessToken() async throws -> String? { nil }
}

extension EnvironmentValues {
    var api: APIClient {
        get { self[APIClientKey.self] }
        set { self[APIClientKey.self] = newValue }
    }
}
