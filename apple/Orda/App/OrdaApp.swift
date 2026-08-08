import OrdaKit
import OrdaUI
import SwiftUI

@main
struct OrdaApp: App {
    @State private var auth: AuthStore
    private let api: APIClient

    init() {
        let configuration = AppConfiguration.current
        let provider = AuthTokenProvider()
        let api = APIClient(baseURL: configuration.apiBaseURL, tokenProvider: provider)
        let store = AuthStore(
            auth: SessionClient(baseURL: configuration.apiBaseURL),
            keychain: KeychainStore(),
            api: api
        )

        // Замыкаем цикл: провайдер отдаёт токен из хранилища, хранилище шлёт
        // запросы через клиента.
        Task { await provider.connect(store) }

        self.api = api
        _auth = State(initialValue: store)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(auth)
                .environment(\.api, api)
                .tint(Theme.brand)
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
