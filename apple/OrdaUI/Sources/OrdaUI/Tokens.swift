import SwiftUI

/// Токены оформления. Единственный источник цвета, отступа и радиуса в
/// приложении — экраны не задают их напрямую.
///
/// Палитра ORDA CONTROL (docs/design/ORDA_CONTROL_DESIGN_SYSTEM.md): Deep Navy
/// и кобальт на тёплом белом. Кобальт — только для действия и акцента,
/// основа — нейтральная. Тёмная тема — на глубоком синем, не на чёрном:
/// тот же продукт ночью, а не отдельная «киберпанк»-тема.
public enum Theme {

    // ── Поверхности ──────────────────────────────────────────────────────────

    /// Фон приложения.
    public static let background = Color.adaptive(dark: 0x081830, light: 0xF6F6F3)
    /// Фон приподнятой области (боковая панель, панель инструментов).
    public static let elevated = Color.adaptive(dark: 0x0C1F3C, light: 0xFFFFFF)
    /// Карточка.
    public static let surface = Color.adaptive(dark: 0x0F2544, light: 0xFFFFFF)
    /// Карточка второго уровня (внутри карточки).
    public static let surfaceRaised = Color.adaptive(dark: 0x15305A, light: 0xF3F4F6)
    /// Выбранный сегмент переключателя: в светлой — белый на сером, в тёмной —
    /// светлый navy на глубоком (иначе выбранное темнее дорожки и теряется).
    public static let segmentSelected = Color.adaptive(dark: 0x2A4E86, light: 0xFFFFFF)

    // ── Границы ──────────────────────────────────────────────────────────────

    public static let border = Color.adaptive(dark: 0x1E3A63, light: 0xE5E7EB)
    public static let borderSoft = Color.adaptive(dark: 0x17325A, light: 0xEEF0F3)

    // ── Текст ────────────────────────────────────────────────────────────────

    public static let text = Color.adaptive(dark: 0xF3F4F6, light: 0x111827)
    /// Подписи, вторичная информация.
    public static let textMuted = Color.adaptive(dark: 0xB4BFD0, light: 0x4B5563)
    /// Совсем тихий текст: единицы измерения, служебное.
    public static let textDim = Color.adaptive(dark: 0x8593AA, light: 0x6B7280)

    // ── Бренд и смысловые цвета ──────────────────────────────────────────────

    /// Кобальт — действие, активное, фокус.
    public static let brand = Color.adaptive(dark: 0x3B82F6, light: 0x2563EB)
    public static let brandBright = Color.adaptive(dark: 0x60A5FA, light: 0x3B82F6)
    /// Deep Navy — подложки бренда и главные карточки.
    public static let navy = Color(hex: 0x0B1F3B)
    /// Второй тон navy для градиента главной карточки.
    public static let navyLight = Color(hex: 0x173563)
    /// Кобальт знака — не адаптивный.
    public static let cobalt = Color(hex: 0x2563EB)
    /// Тёплый белый фон бренда.
    public static let warmWhite = Color(hex: 0xFAFAF8)

    /// Главная карточка раздела — Deep Navy. Одна для всех разделов: цвет не
    /// «кодирует» раздел, он говорит «это главная цифра».
    public static let heroGradient: [Color] = [Color(hex: 0x0B1F3B), Color(hex: 0x1B3B6E)]
    /// Главная карточка-акцент — кобальт (вторая карточка рядом с navy).
    public static let heroAccent: [Color] = [Color(hex: 0x2563EB), Color(hex: 0x1D4ED8)]
    /// Главная карточка с плохим итогом: убыток, долг, расходы больше доходов.
    public static let heroNegative: [Color] = [Color(hex: 0xDC2626), Color(hex: 0x991B1B)]

    // Старые имена знака: ведут на новые цвета, чтобы места, где они ещё
    // встречаются, не выбивались из бренда.
    public static let brandMint = Color(hex: 0x2563EB)
    public static let brandDeep = Color(hex: 0x0B1F3B)
    /// Фон заставки. Тот же цвет стоит у системного экрана запуска, поэтому
    /// между ними нет вспышки.
    public static let launchBackground = Color(hex: 0x0B1F3B)
    /// Текст поверх фирменного цвета.
    ///
    /// Отдельным именем, а не `.white` по месту: на плотном зелёном чёрный
    /// текст нечитаем, и однажды кто-нибудь поставит там `Theme.text`.
    public static let onBrand = Color.white
    public static let positive = Color.adaptive(dark: 0x22C55E, light: 0x16A34A)
    public static let negative = Color.adaptive(dark: 0xF87171, light: 0xDC2626)
    public static let warning = Color.adaptive(dark: 0xF59E0B, light: 0xD97706)
    public static let info = Color.adaptive(dark: 0x60A5FA, light: 0x2563EB)
    /// Вспомогательный акцент (платформа, «онлайн»-оплаты) — спокойный
    /// индиго, чтобы не спорить с кобальтом.
    public static let accent = Color.adaptive(dark: 0x818CF8, light: 0x4F46E5)

    /// Акцент рабочего пространства. Роль должна читаться с первого взгляда —
    /// чтобы суперадмин не перепутал чужую организацию со своей.
    public static func accent(for workspace: WorkspaceAccent) -> Color {
        // Одна дизайн-система для всех ролей: активное — кобальт у всех.
        // Роль отличает содержимое и полоса «Смотрите как…», а не цвет кнопок.
        switch workspace {
        case .platform, .owner, .staff, .operator: brand
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
    public static let lg: CGFloat = 20
    public static let xl: CGFloat = 28
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
    /// Подпись над цифрой. Раньше — мелкий капс, как в админках; теперь
    /// обычный текст чуть крупнее: так подписывают суммы банковские приложения.
    public static let label = Font.footnote.weight(.medium)

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

    public init(hex: UInt32) {
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
