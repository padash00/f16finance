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

