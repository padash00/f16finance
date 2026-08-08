import OrdaKit
import SwiftUI

/// Плитка метрики: подпись, крупное значение, изменение к прошлому периоду.
///
/// Значение прокручивается по разрядам при изменении (`.numericText`), а не
/// подменяется целиком — так глаз замечает, что цифра ожила, и не приходится
/// смотреть на спиннер.
public struct MetricTile: View {
    private let label: String
    private let value: String
    private let change: Double?
    private let icon: String?
    private let accent: Color

    public init(
        label: String,
        value: String,
        change: Double? = nil,
        icon: String? = nil,
        accent: Color = Theme.brand
    ) {
        self.label = label
        self.value = value
        self.change = change
        self.icon = icon
        self.accent = accent
    }

    public var body: some View {
        Card(accent: accent) {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                HStack(spacing: Spacing.sm) {
                    if let icon {
                        Image(systemName: icon)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(accent)
                    }
                    Text(label)
                        .font(Typography.label)
                        .foregroundStyle(Theme.textDim)
                        .textCase(.uppercase)
                }

                Text(value)
                    .font(Typography.monospacedDigits(Typography.metric))
                    .foregroundStyle(Theme.text)
                    .contentTransition(.numericText())
                    .animation(Motion.value, value: value)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)

                if let change {
                    ChangeBadge(change: change)
                }
            }
        }
    }
}

/// Изменение к прошлому периоду. Направление читается цветом и стрелкой —
/// одного цвета мало, дальтонизм встречается у каждого двенадцатого мужчины.
public struct ChangeBadge: View {
    private let change: Double

    public init(change: Double) {
        self.change = change
    }

    public var body: some View {
        let isPositive = change >= 0
        HStack(spacing: Spacing.xs) {
            Image(systemName: isPositive ? "arrow.up.right" : "arrow.down.right")
                .font(.system(size: 10, weight: .bold))
            Text(Percent.format(change, signed: true))
                .font(Typography.caption.weight(.semibold))
                .monospacedDigit()
        }
        .foregroundStyle(isPositive ? Theme.positive : Theme.negative)
        .padding(.horizontal, Spacing.sm)
        .padding(.vertical, Spacing.xs)
        .background(
            (isPositive ? Theme.positive : Theme.negative).opacity(0.12),
            in: Capsule()
        )
        .accessibilityLabel(isPositive ? "рост на \(Percent.format(change))" : "падение на \(Percent.format(change))")
    }
}
