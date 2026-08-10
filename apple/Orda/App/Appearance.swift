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
