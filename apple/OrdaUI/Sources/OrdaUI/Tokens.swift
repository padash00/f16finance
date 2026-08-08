import SwiftUI

/// Токены оформления. Единственный источник цвета, отступа и радиуса в
/// приложении — экраны не задают их напрямую.
///
/// Палитра унаследована от веб-портала и Expo-версии (глубокий тёмный фон,
/// изумрудный бренд), но пересобрана под нативный контекст: цвета
/// адаптивные, поэтому на Mac в светлой теме приложение не выглядит
/// чужеродным чёрным прямоугольником.
public enum Theme {

    // ── Поверхности ──────────────────────────────────────────────────────────

    /// Фон приложения.
    public static let background = Color.adaptive(dark: 0x070809, light: 0xF6F7F9)
    /// Фон приподнятой области (боковая панель, панель инструментов).
    public static let elevated = Color.adaptive(dark: 0x0D1014, light: 0xFFFFFF)
    /// Карточка.
    public static let surface = Color.adaptive(dark: 0x12161B, light: 0xFFFFFF)
    /// Карточка второго уровня (внутри карточки).
    public static let surfaceRaised = Color.adaptive(dark: 0x181D23, light: 0xF2F4F7)

    // ── Границы ──────────────────────────────────────────────────────────────

    public static let border = Color.adaptive(dark: 0x222831, light: 0xE3E7EC)
    public static let borderSoft = Color.adaptive(dark: 0x191E25, light: 0xEDF0F4)

    // ── Текст ────────────────────────────────────────────────────────────────

    public static let text = Color.adaptive(dark: 0xFFFFFF, light: 0x0B0F14)
    /// Подписи, вторичная информация.
    public static let textMuted = Color.adaptive(dark: 0xB6C0CD, light: 0x5A6673)
    /// Совсем тихий текст: единицы измерения, служебное.
    public static let textDim = Color.adaptive(dark: 0x8B95A4, light: 0x8A94A1)

    // ── Бренд и смысловые цвета ──────────────────────────────────────────────

    public static let brand = Color.adaptive(dark: 0x10B981, light: 0x059669)
    public static let brandBright = Color.adaptive(dark: 0x3DF0B6, light: 0x10B981)
    public static let positive = Color.adaptive(dark: 0x3DF0B6, light: 0x059669)
    public static let negative = Color.adaptive(dark: 0xFB7185, light: 0xE11D48)
    public static let warning = Color.adaptive(dark: 0xFBBF24, light: 0xD97706)
    public static let info = Color.adaptive(dark: 0x60A5FA, light: 0x2563EB)
    public static let accent = Color.adaptive(dark: 0x8B5CF6, light: 0x7C3AED)

    /// Акцент рабочего пространства. Роль должна читаться с первого взгляда —
    /// чтобы суперадмин не перепутал чужую организацию со своей.
    public static func accent(for workspace: WorkspaceAccent) -> Color {
        switch workspace {
        case .platform: accent
        case .owner: brand
        case .staff: info
        // Оператору раньше был назначен янтарный — но это статусный цвет
        // предупреждения. В навигации он спорил с брендом и делал выделение
        // похожим на ошибку. Янтарный остаётся только за статусами.
        case .operator: brand
        }
    }

    public enum WorkspaceAccent: Sendable {
        case platform, owner, staff, `operator`
    }
}

/// Шкала отступов, кратная 4. Произвольные числа в экранах запрещены.
public enum Spacing {
    public static let xxs: CGFloat = 2
    public static let xs: CGFloat = 4
    public static let sm: CGFloat = 8
    public static let md: CGFloat = 12
    public static let lg: CGFloat = 16
    public static let xl: CGFloat = 20
    public static let xxl: CGFloat = 28
    public static let xxxl: CGFloat = 40
}

/// Радиусы скругления.
public enum Radius {
    public static let sm: CGFloat = 10
    public static let md: CGFloat = 14
    public static let lg: CGFloat = 18
    public static let xl: CGFloat = 22
    public static let pill: CGFloat = 999
}

/// Типографика. Везде опирается на системные стили, поэтому уважает
/// «Размер текста» из настроек доступности.
public enum Typography {
    /// Крупная сумма на главном экране.
    public static let hero = Font.system(size: 40, weight: .bold, design: .rounded)
    /// Значение метрики в карточке.
    public static let metric = Font.system(.title, design: .rounded).weight(.bold)
    public static let title = Font.system(.title3, design: .rounded).weight(.semibold)
    public static let headline = Font.headline
    public static let body = Font.body
    public static let callout = Font.callout
    public static let caption = Font.caption
    /// Подпись-ярлык над значением.
    public static let label = Font.caption.weight(.medium)

    /// Моноширинные цифры — чтобы суммы не «прыгали» при обновлении.
    public static func monospacedDigits(_ font: Font) -> Font {
        font.monospacedDigit()
    }
}

// ── Вспомогательное ──────────────────────────────────────────────────────────

extension Color {
    /// Цвет, различающийся в тёмной и светлой теме.
    ///
    /// На iOS это `UIColor` с trait collection, на macOS — `NSColor` с
    /// `NSAppearance`. Обёртка скрывает разницу, чтобы токены выше читались
    /// как обычные константы.
    static func adaptive(dark: UInt32, light: UInt32) -> Color {
        #if canImport(UIKit)
        return Color(UIColor { traits in
            UIColor(hex: traits.userInterfaceStyle == .dark ? dark : light)
        })
        #elseif canImport(AppKit)
        return Color(NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            return NSColor(hex: isDark ? dark : light)
        })
        #else
        return Color(hex: dark)
        #endif
    }

    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}

#if canImport(UIKit)
import UIKit

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1
        )
    }
}
#elseif canImport(AppKit)
import AppKit

extension NSColor {
    convenience init(hex: UInt32) {
        self.init(
            srgbRed: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1
        )
    }
}
#endif
