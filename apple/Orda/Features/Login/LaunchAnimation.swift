import OrdaUI
import SwiftUI

/// Заставка запуска.
///
/// Знак Orda — шестиугольник, собранный из трёх ромбов. Он рисуется здесь
/// вручную, а не берётся из SF Symbols: системная иконка узнаваема как чужая,
/// а фирменный знак должен быть свой.
///
/// Анимация укладывается в ~1.1 с и **не задерживает** приложение: пока она
/// идёт, сессия уже восстанавливается в фоне. Если восстановление закончится
/// раньше — заставка доиграет и уступит место; если позже — покажется
/// состояние загрузки.
struct LaunchAnimationView: View {
    /// Вызывается, когда анимация доиграла.
    var onFinish: () -> Void

    @State private var phase: Phase = .idle
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private enum Phase {
        /// Ничего не видно.
        case idle
        /// Ромбы слетаются в знак.
        case assembling
        /// Знак собран, идёт вспышка и появляется название.
        case revealed
        /// Уходим.
        case finishing
    }

    var body: some View {
        ZStack {
            AuroraBackground()

            VStack(spacing: Spacing.xl) {
                OrdaMark(
                    assembled: phase != .idle,
                    glowing: phase == .revealed || phase == .finishing
                )
                .frame(width: 96, height: 108)

                Text("Orda")
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                    .foregroundStyle(Theme.text)
                    .opacity(phase == .revealed || phase == .finishing ? 1 : 0)
                    .offset(y: phase == .revealed || phase == .finishing ? 0 : 10)
                    .blur(radius: phase == .revealed || phase == .finishing ? 0 : 6)
            }
            .scaleEffect(phase == .finishing ? 1.06 : 1)
            .opacity(phase == .finishing ? 0 : 1)
        }
        .task { await run() }
    }

    private func run() async {
        guard !reduceMotion else {
            // При «уменьшении движения» показываем знак сразу и коротко —
            // задерживать человека ради эффекта нельзя.
            phase = .revealed
            try? await Task.sleep(for: .milliseconds(300))
            onFinish()
            return
        }

        withAnimation(.spring(response: 0.55, dampingFraction: 0.72)) {
            phase = .assembling
        }
        try? await Task.sleep(for: .milliseconds(480))

        withAnimation(.spring(response: 0.45, dampingFraction: 0.8)) {
            phase = .revealed
        }
        try? await Task.sleep(for: .milliseconds(520))

        withAnimation(.easeIn(duration: 0.28)) {
            phase = .finishing
        }
        try? await Task.sleep(for: .milliseconds(280))

        onFinish()
    }
}

/// Фирменный знак: шестиугольник из трёх ромбов.
///
/// В разобранном состоянии ромбы разлетаются от центра и повёрнуты — при
/// сборке они «схлопываются» в цельную фигуру. Каждый ромб получает свою
/// задержку, поэтому сборка читается как движение, а не как одно появление.
struct OrdaMark: View {
    let assembled: Bool
    let glowing: Bool

    /// Три грани куба: верхняя и две боковые.
    private let facets: [Facet] = [
        Facet(index: 0, angle: -90, tint: 0.0),
        Facet(index: 1, angle: 30, tint: 0.18),
        Facet(index: 2, angle: 150, tint: 0.34),
    ]

    struct Facet: Identifiable {
        let index: Int
        /// Направление разлёта в разобранном состоянии.
        let angle: Double
        /// Насколько грань светлее базового цвета — даёт объём.
        let tint: Double

        var id: Int { index }

        var offset: CGSize {
            let radians = angle * .pi / 180
            return CGSize(width: cos(radians) * 46, height: sin(radians) * 46)
        }
    }

    var body: some View {
        ZStack {
            ForEach(facets) { facet in
                RhombusFacet(index: facet.index)
                    .fill(
                        LinearGradient(
                            colors: [
                                Theme.brandBright.opacity(0.95 - facet.tint * 0.5),
                                Theme.brand.opacity(0.9 - facet.tint * 0.3),
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .offset(assembled ? .zero : facet.offset)
                    .rotationEffect(.degrees(assembled ? 0 : Double(facet.index) * 22 - 22))
                    .opacity(assembled ? 1 : 0)
                    .animation(
                        .spring(response: 0.55, dampingFraction: 0.72)
                            .delay(Double(facet.index) * 0.07),
                        value: assembled
                    )
            }
        }
        .shadow(color: Theme.brand.opacity(glowing ? 0.55 : 0), radius: glowing ? 28 : 0)
        .animation(.easeOut(duration: 0.4), value: glowing)
    }
}

/// Одна грань изометрического куба.
///
/// Шестиугольник делится на три ромба, сходящихся в центре. Точки считаются
/// от габаритов, поэтому знак масштабируется без искажений.
struct RhombusFacet: Shape {
    /// 0 — верхняя грань, 1 — правая, 2 — левая.
    let index: Int

    func path(in rect: CGRect) -> Path {
        let width = rect.width
        let height = rect.height
        let centerX = rect.midX
        let centerY = rect.midY

        // Вершины правильного шестиугольника, «острым верхом».
        let top = CGPoint(x: centerX, y: 0)
        let topRight = CGPoint(x: width, y: height * 0.25)
        let bottomRight = CGPoint(x: width, y: height * 0.75)
        let bottom = CGPoint(x: centerX, y: height)
        let bottomLeft = CGPoint(x: 0, y: height * 0.75)
        let topLeft = CGPoint(x: 0, y: height * 0.25)
        let center = CGPoint(x: centerX, y: centerY)

        var path = Path()
        switch index {
        case 0:
            // Верхняя грань: левый верх → верх → правый верх → центр.
            path.move(to: topLeft)
            path.addLine(to: top)
            path.addLine(to: topRight)
            path.addLine(to: center)
        case 1:
            // Правая грань.
            path.move(to: topRight)
            path.addLine(to: bottomRight)
            path.addLine(to: bottom)
            path.addLine(to: center)
        default:
            // Левая грань.
            path.move(to: topLeft)
            path.addLine(to: center)
            path.addLine(to: bottom)
            path.addLine(to: bottomLeft)
        }
        path.closeSubpath()
        return path
    }
}
