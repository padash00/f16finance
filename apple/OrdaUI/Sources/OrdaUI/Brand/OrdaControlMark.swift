import SwiftUI

// ── Знак ORDA CONTROL ────────────────────────────────────────────────────────
//
// Круглое «O»: толстое кольцо и кобальтовый сегмент справа сверху, чуть шире
// кольца — «система включилась». Геометрия общая с иконкой
// (`Tools/GenerateAppIcon.swift`) и описана в
// docs/design/ORDA_CONTROL_DESIGN_SYSTEM.md: поле 100×100, кольцо r=29 и
// толщиной 15, сегмент толщиной 19 от −104° до −14°.

/// Знак без подложки.
public struct OrdaControlMark: View {
    /// Цвет кольца: на тёмном — белый, на светлом — navy.
    public var ringColor: Color
    /// Сколько сегмента дорисовано: 0 — нет, 1 — на месте. Для заставки.
    public var sweep: CGFloat
    /// Видимость кольца: 0 — нет, 1 — целиком.
    public var ring: CGFloat
    /// Мягкое свечение сегмента на «щелчке» готовности.
    public var glow: CGFloat

    public init(ringColor: Color = Theme.navy, sweep: CGFloat = 1, ring: CGFloat = 1, glow: CGFloat = 0) {
        self.ringColor = ringColor
        self.sweep = sweep
        self.ring = ring
        self.glow = glow
    }

    enum Geometry {
        static let ringRadius: CGFloat = 0.29
        static let ringWidth: CGFloat = 0.15
        static let arcWidth: CGFloat = 0.19
        static let arcFrom: Double = -104
        static let arcTo: Double = -14
    }

    public var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width, proxy.size.height)
            ZStack {
                Circle()
                    .inset(by: side * (0.5 - Geometry.ringRadius))
                    .stroke(ringColor, lineWidth: side * Geometry.ringWidth)
                    .opacity(ring)
                    .scaleEffect(0.9 + 0.1 * ring)

                // Сегмент растёт по дуге от начала к концу — как стрелка,
                // дошедшая до места, а не крутящийся индикатор.
                OrdaControlArc(
                    from: Geometry.arcFrom,
                    to: Geometry.arcFrom + (Geometry.arcTo - Geometry.arcFrom) * Double(sweep),
                    radius: side * Geometry.ringRadius
                )
                .stroke(Theme.cobalt, style: StrokeStyle(lineWidth: side * Geometry.arcWidth, lineCap: .round))
                .opacity(sweep > 0.001 ? 1 : 0)
                .shadow(color: Theme.cobalt.opacity(0.75 * glow), radius: side * 0.12 * glow)
            }
            .frame(width: side, height: side)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityLabel("ORDA CONTROL")
    }
}

/// Дуга с центром в середине рамки. Углы — в градусах, 0 — вправо, по часовой.
public struct OrdaControlArc: Shape {
    public var from: Double
    public var to: Double
    public var radius: CGFloat

    public init(from: Double, to: Double, radius: CGFloat) {
        self.from = from
        self.to = to
        self.radius = radius
    }

    public var animatableData: AnimatablePair<Double, Double> {
        get { AnimatablePair(from, to) }
        set { from = newValue.first; to = newValue.second }
    }

    public func path(in rect: CGRect) -> Path {
        var path = Path()
        path.addArc(
            center: CGPoint(x: rect.midX, y: rect.midY),
            radius: radius,
            startAngle: .degrees(from),
            endAngle: .degrees(to),
            clockwise: false
        )
        return path
    }
}

/// Иконка: знак на navy-подложке со скруглением iOS.
public struct OrdaControlAppIcon: View {
    public var size: CGFloat

    public init(size: CGFloat = 64) { self.size = size }

    public var body: some View {
        OrdaControlMark(ringColor: .white)
            .padding(size * 0.14)
            .frame(width: size, height: size)
            .background(
                LinearGradient(colors: [Color(hex: 0x173563), Theme.navy], startPoint: .top, endPoint: .bottom),
                in: RoundedRectangle(cornerRadius: size * 0.2237, style: .continuous)
            )
            .shadow(color: Theme.navy.opacity(0.25), radius: size * 0.12, y: size * 0.06)
    }
}

/// Логотип: знак вместо «O», затем «RDA»; под ним CONTROL разрядкой.
public struct OrdaControlLogo: View {
    public var height: CGFloat
    public var color: Color
    public var subtitleColor: Color
    public var showsControl: Bool
    /// Для заставки: насколько видно слово и CONTROL.
    public var wordOpacity: Double
    public var controlOpacity: Double
    public var sweep: CGFloat

    public init(
        height: CGFloat = 44,
        color: Color = Theme.navy,
        subtitleColor: Color = Color(hex: 0x6B7280),
        showsControl: Bool = true,
        wordOpacity: Double = 1,
        controlOpacity: Double = 1,
        sweep: CGFloat = 1
    ) {
        self.height = height
        self.color = color
        self.subtitleColor = subtitleColor
        self.showsControl = showsControl
        self.wordOpacity = wordOpacity
        self.controlOpacity = controlOpacity
        self.sweep = sweep
    }

    public var body: some View {
        let word = height * (showsControl ? 0.74 : 1)
        VStack(spacing: height * 0.1) {
            HStack(spacing: word * 0.02) {
                OrdaControlMark(ringColor: color, sweep: sweep)
                    .frame(width: word * 1.12, height: word * 1.12)
                Text("RDA")
                    .font(.system(size: word, weight: .heavy, design: .rounded))
                    .tracking(-word * 0.02)
                    .foregroundStyle(color)
                    .opacity(wordOpacity)
            }
            if showsControl {
                Text("CONTROL")
                    .font(.system(size: height * 0.2, weight: .medium))
                    .tracking(height * 0.2 * 0.62)
                    .foregroundStyle(subtitleColor)
                    .padding(.leading, height * 0.2 * 0.62)
                    .opacity(controlOpacity)
            }
        }
        .fixedSize()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("ORDA CONTROL")
    }
}

#Preview("ORDA CONTROL") {
    VStack(spacing: 32) {
        OrdaControlAppIcon(size: 120)
        OrdaControlLogo(height: 64)
        OrdaControlLogo(height: 64, color: .white, subtitleColor: .white.opacity(0.7))
            .padding()
            .background(Theme.navy)
    }
    .padding(40)
    .background(Theme.warmWhite)
}
