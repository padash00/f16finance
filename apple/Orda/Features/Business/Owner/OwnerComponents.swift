import OrdaKit
import OrdaUI
import SwiftUI

// ── Детали кабинета владельца ────────────────────────────────────────────────
//
// Язык как у банковских приложений: одна крупная цифра на карточку, круглые
// кнопки действий, сервисы плиткой из иконок, списки строками с иконкой в
// кружке. Меньше рамок и подписей капсом — больше воздуха и цифр.

/// Цвет группы разделов — одна и та же иконка всегда одного цвета, по нему
/// раздел находят быстрее, чем по названию.
enum OwnerTint {
    static func forGroup(_ id: String) -> Color {
        // Спокойная палитра ORDA CONTROL: кобальт, бирюза, янтарь, индиго,
        // небесный и графит — различимы, но не пестрят.
        switch id {
        case "finance": Color(hex: 0x2563EB)
        case "inventory": Color(hex: 0xD97706)
        case "shifts": Color(hex: 0x4F46E5)
        case "staff": Color(hex: 0x0D9488)
        case "points": Color(hex: 0x0284C7)
        case "pos": Color(hex: 0x7C3AED)
        case "operations": Color(hex: 0xEA580C)
        case "system": Color(hex: 0x475569)
        default: Color(hex: 0x0284C7)
        }
    }

    /// Точки красятся по кругу — у каждой свой цвет в списке.
    static let points: [Color] = [
        Color(hex: 0x2563EB), Color(hex: 0x0D9488), Color(hex: 0xD97706),
        Color(hex: 0x4F46E5), Color(hex: 0x0284C7), Color(hex: 0x475569),
    ]

    static func point(_ index: Int) -> Color { points[index % points.count] }
}

/// Иконка в цветном кружке — как у строк и плиток в банковских приложениях.
struct TintedIcon: View {
    let systemName: String
    let tint: Color
    var size: CGFloat = 40
    var corner: CGFloat? = nil

    var body: some View {
        Image(systemName: systemName)
            .font(.system(size: size * 0.42, weight: .semibold))
            .foregroundStyle(tint)
            .frame(width: size, height: size)
            .background(
                tint.opacity(0.14),
                in: RoundedRectangle(cornerRadius: corner ?? size / 2, style: .continuous)
            )
    }
}

/// Кружок с первой буквой — для точек и людей без иконки.
struct LetterBadge: View {
    let text: String
    let tint: Color
    var size: CGFloat = 40

    var body: some View {
        // Буква последнего слова: у «F16 Arena» и «F16 Ramen» первое слово
        // общее, и все кружки были бы «F».
        let word = text.split(separator: " ").last.map(String.init) ?? text
        Text(String(word.prefix(1)).uppercased())
            .font(.system(size: size * 0.42, weight: .bold, design: .rounded))
            .foregroundStyle(tint)
            .frame(width: size, height: size)
            .background(tint.opacity(0.14), in: Circle())
    }
}

/// Круглая кнопка быстрого действия с подписью снизу.
struct RoundAction: View {
    let icon: String
    let title: String
    let tint: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: Spacing.sm) {
                Image(systemName: icon)
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(tint)
                    .frame(width: 56, height: 56)
                    .background(Theme.surface, in: Circle())
                    .shadow(color: .black.opacity(0.06), radius: 8, y: 3)
                Text(title)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.pressable)
    }
}

/// Плитка сервиса: иконка в скруглённом квадрате и название под ней.
struct ServiceTile: View {
    let icon: String
    let title: String
    let tint: Color
    var badge: Int = 0
    var size: CGFloat = 54

    var body: some View {
        VStack(spacing: Spacing.sm) {
            TintedIcon(systemName: icon, tint: tint, size: size, corner: size * 0.3)
                .overlay(alignment: .topTrailing) {
                    if badge > 0 {
                        Text("\(badge)")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 5)
                            .frame(minWidth: 18, minHeight: 18)
                            .background(Theme.negative, in: Capsule())
                            .offset(x: 6, y: -6)
                    }
                }
            Text(title)
                .font(.system(size: size > 60 ? 14 : 12, weight: .medium))
                .foregroundStyle(Theme.text)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.85)
                .frame(height: size > 60 ? 36 : 30, alignment: .top)
        }
        .frame(maxWidth: .infinity)
        .contentShape(Rectangle())
    }
}

/// Белый блок с заголовком — секция главной без рамки и капса.
struct OwnerSection<Content: View, Trailing: View>: View {
    let title: String
    @ViewBuilder let trailing: () -> Trailing
    @ViewBuilder let content: () -> Content

    init(_ title: String, @ViewBuilder trailing: @escaping () -> Trailing = { EmptyView() }, @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.trailing = trailing
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            HStack(alignment: .firstTextBaseline) {
                Text(title)
                    .font(.system(size: 20, weight: .bold, design: .rounded))
                    .foregroundStyle(Theme.text)
                Spacer()
                trailing()
            }
            content()
        }
        .padding(Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }
}

/// Строка списка: иконка, название с подписью, сумма и изменение справа,
/// тонкая полоса доли снизу.
struct AmountRow<Leading: View>: View {
    @ViewBuilder let leading: () -> Leading
    let title: String
    var subtitle: String? = nil
    let amount: String
    var change: Double? = nil
    var higherIsBetter = true
    var share: Double? = nil
    var tint: Color = Theme.brand
    var showsChevron = false

    var body: some View {
        HStack(spacing: Spacing.md) {
            leading()
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                    Text(title)
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                    Spacer(minLength: Spacing.sm)
                    Text(amount)
                        .font(.system(size: 16, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                }
                HStack(spacing: Spacing.sm) {
                    if let subtitle {
                        Text(subtitle)
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textDim)
                            .lineLimit(1)
                    }
                    Spacer(minLength: Spacing.sm)
                    if let change {
                        ChangeText(change: change, higherIsBetter: higherIsBetter)
                    }
                }
                if let share {
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Theme.surfaceRaised)
                            Capsule().fill(tint).frame(width: max(3, geo.size.width * min(max(share, 0), 1)))
                        }
                    }
                    .frame(height: 4)
                    .padding(.top, 2)
                }
            }
            if showsChevron {
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.textDim)
            }
        }
        .padding(.vertical, Spacing.xs)
        .contentShape(Rectangle())
    }
}

/// Изменение текстом со стрелкой, без плашки — для строк.
struct ChangeText: View {
    let change: Double
    var higherIsBetter = true

    var body: some View {
        let rising = change >= 0
        let flat = abs(change) < 0.05
        let good = rising == higherIsBetter
        HStack(spacing: 2) {
            Image(systemName: flat ? "minus" : (rising ? "arrow.up" : "arrow.down"))
                .font(.system(size: 10, weight: .bold))
            Text(Percent.format(abs(change)))
                .font(.system(size: 13, weight: .semibold))
                .monospacedDigit()
        }
        .foregroundStyle(flat ? Theme.textDim : (good ? Theme.positive : Theme.negative))
    }
}

/// Сегмент выбора: «День · Неделя · Месяц · Год».
struct PillSegment<Value: Hashable>: View {
    let options: [(value: Value, title: String)]
    @Binding var selection: Value

    var body: some View {
        HStack(spacing: 4) {
            ForEach(options, id: \.value) { option in
                let isOn = option.value == selection
                Button {
                    withAnimation(Motion.tap) { selection = option.value }
                } label: {
                    Text(option.title)
                        .font(.system(size: 14, weight: isOn ? .semibold : .medium))
                        .foregroundStyle(isOn ? Theme.text : Theme.textMuted)
                        // Длинные подписи («Подтверждённые») не переносим по
                        // буквам — ужимаем шрифт.
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .padding(.horizontal, 4)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 9)
                        .background {
                            if isOn {
                                Capsule()
                                    .fill(Theme.segmentSelected)
                                    .shadow(color: .black.opacity(0.08), radius: 4, y: 1)
                            }
                        }
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(4)
        .background(Theme.surfaceRaised, in: Capsule())
    }
}

/// Нижняя подпись-сноска.
struct OwnerFootnote: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 12))
            .foregroundStyle(Theme.textDim)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Spacing.xs)
    }
}

/// Цветная карточка с главной цифрой раздела и парой подписей под ней.
///
/// Заменяет стопку одинаковых плиток: одна цифра — главная, остальные —
/// её расшифровка, как баланс и движения в банковском приложении.
struct HeroSummary: View {
    let title: String
    let value: String
    var caption: String? = nil
    var footer: [(String, String)] = []
    var colors: [Color] = Theme.heroGradient

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text(title)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(.white.opacity(0.85))
            Text(value)
                .font(.system(size: 36, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .contentTransition(.numericText())
            if let caption {
                Text(caption)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.white.opacity(0.85))
            }
            if !footer.isEmpty {
                HStack(alignment: .top, spacing: Spacing.lg) {
                    ForEach(footer, id: \.0) { label, text in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(label)
                                .font(.system(size: 12))
                                .foregroundStyle(.white.opacity(0.7))
                                .lineLimit(1)
                                .minimumScaleFactor(0.75)
                            Text(text)
                                .font(.system(size: 15, weight: .semibold, design: .rounded))
                                .monospacedDigit()
                                .foregroundStyle(.white)
                                .lineLimit(1)
                                .minimumScaleFactor(0.6)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(.top, Spacing.sm)
            }
        }
        .padding(Spacing.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: 28, style: .continuous)
        )
    }
}
