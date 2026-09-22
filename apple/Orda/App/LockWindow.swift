#if os(iOS)
import SwiftUI
import UIKit

/// Экран блокировки в отдельном окне поверх всего приложения.
///
/// Замок лежал наложением на кабинете, а листы («Добавить расход», чек
/// операции) показываются поверх корня — и оставались видны над замком вместе
/// с суммами. Окно уровня выше алертов закрывает всё, что открыто, а сам
/// кабинет под ним не пересоздаётся: после Face ID человек там же, где был.
@MainActor
final class LockWindow {
    static let shared = LockWindow()

    private var window: UIWindow?

    func show(auth: AuthStore) {
        guard window == nil,
              let scene = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .first(where: { $0.activationState != .unattached })
        else { return }

        let host = UIHostingController(rootView: BiometricLockView().environment(auth))
        host.view.backgroundColor = .clear

        let window = UIWindow(windowScene: scene)
        window.windowLevel = .alert + 1
        window.rootViewController = host
        // Тема — как у основного окна: настройка приложения может расходиться
        // с системной.
        if let main = scene.windows.first(where: { $0 !== window }) {
            window.overrideUserInterfaceStyle = main.overrideUserInterfaceStyle
        }
        window.isHidden = false
        self.window = window
    }

    func hide() {
        window?.isHidden = true
        window = nil
    }
}
#endif
