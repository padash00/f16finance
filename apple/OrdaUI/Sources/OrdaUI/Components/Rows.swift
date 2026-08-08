import SwiftUI

/// Строка «подпись — значение». Основа таблиц в карточках.
public struct StatRow: View {
    private let label: String
    private let value: String
    private let valueColor: Color
    private let icon: String?
    private let isEmphasized: Bool

    public init(
        _ label: String,
        value: String,
        valueColor: Color = Theme.text,
        icon: String? = nil,
        emphasized: Bool = false
    ) {
        self.label = label
        self.value = value
        self.valueColor = valueColor
        self.icon = icon
        self.isEmphasized = emphasized
    }

    public var body: some View {
        HStack(spacing: Spacing.md) {
            if let icon {
                Image(systemName: icon)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
                    .frame(width: 18)
            }
            Text(label)
                .font(isEmphasized ? Typography.callout.weight(.semibold) : Typography.callout)
                .foregroundStyle(isEmphasized ? Theme.text : Theme.textMuted)
            Spacer(minLength: Spacing.md)
            Text(value)
                .font(isEmphasized ? Typography.headline : Typography.callout.weight(.medium))
                .monospacedDigit()
                .foregroundStyle(valueColor)
                .contentTransition(.numericText())
        }
    }
}

/// Разделитель внутри карточки.
public struct RowDivider: View {
    public init() {}
    public var body: some View {
        Rectangle()
            .fill(Theme.borderSoft)
            .frame(height: 1)
    }
}

/// Кликабельная строка-переход: иконка, заголовок, подпись, значок, шеврон.
///
/// Используется как пункт меню раздела — вместо плоского списка ссылок.
public struct NavigationRow: View {
    private let icon: String
    private let iconColor: Color
    private let title: String
    private let subtitle: String?
    private let badge: Int?
    private let badgeColor: Color

    public init(
        icon: String,
        iconColor: Color = Theme.brand,
        title: String,
        subtitle: String? = nil,
        badge: Int? = nil,
        badgeColor: Color = Theme.negative
    ) {
        self.icon = icon
        self.iconColor = iconColor
        self.title = title
        self.subtitle = subtitle
        self.badge = badge
        self.badgeColor = badgeColor
    }

    public var body: some View {
        HStack(spacing: Spacing.md) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(iconColor)
                .frame(width: 34, height: 34)
                .background(iconColor.opacity(0.12), in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(Typography.body)
                    .foregroundStyle(Theme.text)
                if let subtitle {
                    Text(subtitle)
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: Spacing.sm)

            if let badge, badge > 0 {
                Text("\(badge)")
                    .font(Typography.caption.weight(.bold))
                    .monospacedDigit()
                    .foregroundStyle(Color.black.opacity(0.85))
                    .padding(.horizontal, Spacing.sm)
                    .padding(.vertical, 2)
                    .background(badgeColor, in: Capsule())
            }

            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.textDim)
        }
        .padding(.vertical, Spacing.xs)
        .contentShape(Rectangle())
    }
}

/// Плашка состояния: цвет + значок + текст.
///
/// Значок обязателен — статус, различимый только цветом, недоступен тем, кто
/// цвета не различает.
public struct StatusChip: View {
    public enum Kind: Sendable {
        case good, warning, danger, neutral, info

        var color: Color {
            switch self {
            case .good: Theme.positive
            case .warning: Theme.warning
            case .danger: Theme.negative
            case .info: Theme.info
            case .neutral: Theme.textDim
            }
        }

        var icon: String {
            switch self {
            case .good: "checkmark.circle.fill"
            case .warning: "exclamationmark.triangle.fill"
            case .danger: "xmark.octagon.fill"
            case .info: "info.circle.fill"
            case .neutral: "circle.fill"
            }
        }
    }

    private let kind: Kind
    private let text: String

    public init(_ text: String, kind: Kind) {
        self.text = text
        self.kind = kind
    }

    public var body: some View {
        HStack(spacing: Spacing.xs) {
            Image(systemName: kind.icon)
                .font(.system(size: 10, weight: .bold))
            Text(text)
                .font(Typography.caption.weight(.semibold))
        }
        .foregroundStyle(kind.color)
        .padding(.horizontal, Spacing.sm)
        .padding(.vertical, Spacing.xs)
        .background(kind.color.opacity(0.12), in: Capsule())
    }
}

/// Плитка быстрого действия для дашборда.
public struct ActionTile: View {
    private let icon: String
    private let title: String
    private let tint: Color
    private let action: () -> Void

    public init(icon: String, title: String, tint: Color = Theme.brand, action: @escaping () -> Void) {
        self.icon = icon
        self.title = title
        self.tint = tint
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            VStack(spacing: Spacing.sm) {
                Image(systemName: icon)
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(tint)
                Text(title)
                    .font(Typography.caption.weight(.medium))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, Spacing.lg)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.lg, style: .continuous)
                    .strokeBorder(tint.opacity(0.2), lineWidth: 1)
            }
        }
        .buttonStyle(PressableTileStyle())
    }
}

/// Нажатие плитки — лёгкое сжатие, без «мигания» прозрачностью.
public struct PressableTileStyle: ButtonStyle {
    public init() {}
    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(Motion.tap, value: configuration.isPressed)
    }
}
