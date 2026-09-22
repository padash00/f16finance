import OrdaUI
import SwiftUI

/// Заставка запуска ORDA CONTROL: знак появляется → кобальтовый сегмент
/// дотягивается → слово ORDA / CONTROL и слоган → переход в интерфейс.
///
/// Это не ролик и не отдельный экран. Заставка лежит поверх уже собранного
/// интерфейса и в конце не обрывается, а растворяется в нём: фон светлеет,
/// логотип уходит к шапке входа.
///
/// Длительность — около 3,5 секунды: быстрее логотип не успевали рассмотреть.
/// Это деловая программа: брендом можно задержать ровно настолько, чтобы его
/// успели прочитать.
struct OrdaPointIntroView: View {
    /// Общее пространство геометрии с экраном входа.
    let namespace: Namespace.ID
    /// Заставка отработала — можно убирать.
    var onFinish: () -> Void
    /// Приложению больше нечего ждать: сессия и права разобраны.
    var isReady: () -> Bool = { true }
    /// Человек уже вошёл — впереди рабочий экран, а не форма входа.
    var goesToWorkspace: () -> Bool = { false }

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Кольцо знака: 0 — нет, 1 — на месте.
    @State private var ring: CGFloat = 0
    /// Сколько кобальтового сегмента дорисовано.
    @State private var sweep: CGFloat = 0
    @State private var glow: CGFloat = 0
    /// Знак крупно (кадры 1–2) сменяется логотипом (кадр 3).
    @State private var logoShown = false
    @State private var taglineShown = false
    @State private var backgroundLifted = false
    @State private var handedOver = false

    private enum Timing {
        // Спокойный темп: при 2 секундах логотип не успевали рассмотреть.
        static let appear: Duration = .milliseconds(500)
        static let sweep: Duration = .milliseconds(950)
        static let reveal: Duration = .milliseconds(800)
        /// Пауза узнавания: логотип и слоган на экране целиком.
        static let hold: Duration = .milliseconds(550)
        static let handover: Duration = .milliseconds(760)
        /// Сколько ждать готовности данных, прежде чем уступить экран.
        static let maxWait: Duration = .milliseconds(2600)
    }

    /// Мягкая кривая без отскока: бренд спокойный, не игровой.
    private static let ease = Animation.timingCurve(0.4, 0.0, 0.2, 1.0, duration: 0.95)

    private static let markSize: CGFloat = 104
    private static let logoHeight: CGFloat = 66
    /// Во сколько раз логотип уменьшается к шапке входа.
    private static let headoverScale: CGFloat = 0.72

    var body: some View {
        ZStack {
            background

            ZStack {
                // Кадры 1–2: знак крупно, сегмент дотягивается.
                OrdaControlMark(ringColor: .white, sweep: sweep, ring: ring, glow: glow)
                    .frame(width: Self.markSize, height: Self.markSize)
                    .scaleEffect(0.92 + 0.08 * ring)
                    .opacity(logoShown ? 0 : Double(ring))
                    .scaleEffect(logoShown ? 0.6 : 1)

                // Кадр 3: логотип и слоган.
                VStack(spacing: 18) {
                    OrdaControlLogo(
                        height: Self.logoHeight,
                        color: .white,
                        subtitleColor: .white.opacity(0.7)
                    )
                    Text("Бизнес под контролем.")
                        .font(.system(size: 17, weight: .medium))
                        .foregroundStyle(.white.opacity(0.85))
                        .opacity(taglineShown ? 1 : 0)
                        .offset(y: taglineShown ? 0 : 6)
                }
                .opacity(logoShown ? 1 : 0)
                .scaleEffect(logoShown ? 1 : 1.08)
            }
            .scaleEffect(handedOver ? Self.headoverScale : 1)
            .offset(y: handedOver ? -60 : 0)
            .opacity(handedOver ? 0 : 1)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .ignoresSafeArea()
        .task { await run() }
    }

    // ── Фон ──────────────────────────────────────────────────────────────────

    /// Deep Navy с едва заметными кобальтовыми дугами — они не спорят с
    /// логотипом, только дают глубину.
    private var background: some View {
        ZStack {
            Theme.launchBackground
            GeometryReader { proxy in
                let w = proxy.size.width
                let h = proxy.size.height
                Circle()
                    .stroke(Theme.cobalt.opacity(0.22), lineWidth: w * 0.5)
                    .frame(width: w * 1.9, height: w * 1.9)
                    .position(x: w * 1.15, y: h * 1.05)
                    .blur(radius: 30)
                Circle()
                    .fill(Color(hex: 0x173563).opacity(0.55))
                    .frame(width: w * 1.3, height: w * 1.3)
                    .position(x: -w * 0.2, y: -h * 0.05)
                    .blur(radius: 40)
            }
            RadialGradient(
                colors: [Theme.cobalt.opacity(0.10 + 0.18 * glow), .clear],
                center: .center,
                startRadius: 0,
                endRadius: 260
            )
        }
        .opacity(backgroundLifted ? 0 : 1)
    }

    // ── Сценарий ─────────────────────────────────────────────────────────────

    private func run() async {
        guard !reduceMotion else {
            await runReduced()
            return
        }

        // 0,00–0,30 — знак появляется: мягкое проявление и чуть-чуть масштаба.
        withAnimation(.easeOut(duration: 0.5)) { ring = 1 }
        guard await sleep(Timing.appear) else { return }

        // 0,30–0,90 — кобальтовый сегмент дотягивается до места и один раз
        // вспыхивает: система готова. Не вращение — один проход.
        withAnimation(Self.ease) { sweep = 1 }
        guard await sleep(Timing.sweep) else { return }
        Haptics.tap()
        withAnimation(.easeOut(duration: 0.18)) { glow = 1 }
        withAnimation(.easeInOut(duration: 0.5).delay(0.18)) { glow = 0.3 }

        // 0,90–1,45 — логотип и слоган.
        withAnimation(.easeInOut(duration: 0.55)) { logoShown = true }
        withAnimation(.easeOut(duration: 0.45).delay(0.35)) { taglineShown = true }
        guard await sleep(Timing.reveal) else { return }
        guard await sleep(Timing.hold) else { return }

        guard await waitForReadiness() else { return }

        // 1,45–2,00 — переход без жёсткой склейки: фон светлеет, логотип
        // уходит вверх и растворяется в шапке входа или в главной.
        withAnimation(.timingCurve(0.4, 0.0, 0.2, 1.0, duration: 0.75)) {
            handedOver = true
            backgroundLifted = true
            glow = 0
        }
        guard await sleep(Timing.handover) else { return }
        onFinish()
    }

    /// При «уменьшении движения» — сразу логотип, короткое проявление, уход.
    private func runReduced() async {
        ring = 1
        sweep = 1
        withAnimation(.easeOut(duration: 0.18)) {
            logoShown = true
            taglineShown = true
        }
        guard await sleep(.milliseconds(350)) else { return }
        guard await waitForReadiness() else { return }
        withAnimation(.easeInOut(duration: 0.2)) {
            handedOver = true
            backgroundLifted = true
        }
        guard await sleep(.milliseconds(200)) else { return }
        onFinish()
    }

    /// Ждём данные короткими шагами: заставка уходит сразу, как всё приехало,
    /// а не отстаивает положенное время впустую. Вошедшего не держим вовсе —
    /// его ждёт рабочий экран, а не форма.
    private func waitForReadiness() async -> Bool {
        if goesToWorkspace() { return true }
        var waited: Duration = .zero
        let step: Duration = .milliseconds(60)
        while !isReady(), waited < Timing.maxWait {
            guard await sleep(step) else { return false }
            waited += step
        }
        return true
    }

    /// Пауза, которая честно отвечает на отмену: если экран убрали, сценарий
    /// не должен доигрывать в пустоту и дёргать `onFinish`.
    private func sleep(_ duration: Duration) async -> Bool {
        do {
            try await Task.sleep(for: duration)
            return true
        } catch {
            return false
        }
    }
}

/// Общие имена для перехода знака из заставки в шапку входа.
enum BrandTransition {
    static let symbolID = "orda.point.symbol"
}
