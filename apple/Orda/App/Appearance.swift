import SwiftUI

/// Оформление: по системе, светлое или тёмное.
///
/// Цвета в приложении и так адаптивные — при смене системной темы всё
/// перекрашивается само. Выбор нужен для другого случая: телефон стоит на
/// автопереключении и к вечеру уходит в тёмное, а работать с цифрами человеку
/// удобнее на светлом. Или наоборот — в клубе темно, а система светлая.
enum Appearance: String, CaseIterable, Identifiable {
    case system, light, dark

    var id: String { rawValue }

    var title: String {
        switch self {
        case .system: "Как в системе"
        case .light: "Светлая"
        case .dark: "Тёмная"
        }
    }

    var icon: String {
        switch self {
        case .system: "iphone"
        case .light: "sun.max"
        case .dark: "moon"
        }
    }

    /// `nil` — не вмешиваемся, решает система.
    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }

    static let storageKey = "orda.appearance"
}

#if os(iOS)
import UIKit

extension Appearance {
    var interfaceStyle: UIUserInterfaceStyle {
        switch self {
        case .system: .unspecified
        case .light: .light
        case .dark: .dark
        }
    }

    /// Ставит тему самому окну.
    ///
    /// `preferredColorScheme` действует только внутри своего дерева
    /// представлений, а лист показывается отдельным контроллером поверх окна —
    /// и тему берёт у окна, а не у того, кто его открыл. Поэтому «Аккаунт»
    /// оставался тёмным, когда выбрана светлая: сам экран настроек и был
    /// листом. Окну тему видят все — и листы, и системные алерты.
    @MainActor
    func applyToWindows() {
        for scene in UIApplication.shared.connectedScenes {
            guard let windowScene = scene as? UIWindowScene else { continue }
            for window in windowScene.windows {
                window.overrideUserInterfaceStyle = interfaceStyle
            }
        }
    }
}
#endif
