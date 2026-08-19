import OrdaUI
import SwiftUI

/// Заставка запуска: точка → сборка → замок → название → вход.
///
/// Это не ролик и не отдельный экран. Заставка лежит поверх уже собранного
/// интерфейса, а знак в конце не исчезает, а переезжает в шапку входа тем же
/// объектом — иначе получилась бы связка «заставка, чернота, другой экран»,
/// то есть две разные программы вместо одной.
///
/// Длительность держим в пределах 1,9 секунды. Это деловая программа: человек
/// открыл её, чтобы работать, и брендом его можно задержать ровно настолько,
/// чтобы он успел его прочитать.
struct OrdaPointIntroView: View {
    /// Общее пространство геометрии с экраном входа: по нему знак и переезжает.
    let namespace: Namespace.ID
    /// Заставка отработала — можно убирать.
    var onFinish: () -> Void
    /// Приложению больше нечего ждать: сессия и права разобраны.
    var isReady: () -> Bool = { true }
    /// Человек уже вошёл — впереди рабочий экран, а не форма входа.
    var goesToWorkspace: () -> Bool = { false }

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var phase: Phase = .initial
    /// Готовность каждого сегмента. Отдельными значениями, потому что они
    /// приходят с задержкой друг за другом.
    @State private var segments: [CGFloat] = [0, 0, 0, 0]
    @State private var pointProgress: CGFloat = 0
    @State private var glow: CGFloat = 0
    @State private var lockScale: CGFloat = 1
    @State private var wordmarkShown = false
    @State private var backgroundLifted = false
    @State private var symbolFlewOut = false

    enum Phase {
        case initial
        /// Появилась центральная точка.
        case point
        /// Сегменты сходятся.
        case converging
        /// Знак собран, идёт короткое подтверждение.
        case assembled
        /// Появилось название.
        case branded
        /// Знак переезжает в шапку входа.
        case transitioning
        case completed
    }

    /// Все длительности — в одном месте: разбросанные по коду числа
    /// расходятся с раскадровкой на первой же правке.
    private enum Motion {
        static let point: Duration = .milliseconds(180)
        static let convergence: Duration = .milliseconds(540)
        static let assembly: Duration = .milliseconds(220)
        static let lock: Duration = .milliseconds(140)
        static let wordmark: Duration = .milliseconds(300)
        static let hold: Duration = .milliseconds(150)
        static let handover: Duration = .milliseconds(420)
        /// Сколько ждать готовности данных, прежде чем уступить экран.
        static let maxWait: Duration = .milliseconds(2600)

        /// Кривая сборки: быстро стартует, мягко приходит. Без пружины —
        /// сегментам нельзя перелетать своё место и возвращаться.
        static let assemble = Animation.timingCurve(0.22, 1.0, 0.36, 1.0, duration: 0.54)
        static let settle = Animation.timingCurve(0.33, 1.0, 0.68, 1.0, duration: 0.3)
        static let travel = Animation.timingCurve(0.32, 0.94, 0.24, 1.0, duration: 0.42)
    }

    /// Размер знака в заставке — от ширины экрана, с разумными границами.
    private func symbolSize(for width: CGFloat) -> CGFloat {
        min(max(width * 0.28, 92), 120)
    }

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                background

                // Знак стоит ровно в середине экрана, а название висит под
                // ним на постоянном расстоянии.
                //
                // Не `VStack`: в нём по центру оказывается пара «знак плюс
                // название», то есть сам знак уезжает выше середины, а текст
                // ниже — на глаз это читается как отсутствие выравнивания. К
                // тому же при появлении названия знак не должен шевелиться:
                // он в этот момент уже стоит на своём месте.
                let size = symbolSize(for: proxy.size.width)
                ZStack {
                    symbol(size: size)

                    Text("Orda Point")
                        .font(.system(size: size * 0.30, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white)
                        .opacity(wordmarkShown ? 1 : 0)
                        .offset(y: wordmarkShown ? size * 0.86 : size * 0.86 + 7)
                        .blur(radius: wordmarkShown ? 0 : 3)
                        .opacity(symbolFlewOut ? 0 : 1)
                }
            }
            .ignoresSafeArea()
        }
        .task { await run() }
    }

    // ── Куски ────────────────────────────────────────────────────────────────

    private var background: some View {
        ZStack {
            Theme.launchBackground
            // Слабый свет из центра — он же готовит переход: к концу заставки
            // фон светлеет, а не сменяется рывком.
            RadialGradient(
                colors: [Theme.brandMint.opacity(0.16 + 0.12 * glow), .clear],
                center: .center,
                startRadius: 0,
                endRadius: 320
            )
        }
        .opacity(backgroundLifted ? 0 : 1)
    }

    @ViewBuilder
    private func symbol(size: CGFloat) -> some View {
        // Знак — тот же объект, что и в шапке входа: на переходе он не
        // исчезает и не создаётся заново, а переезжает.
        OrdaPointSymbol(segments: segments, point: pointProgress, glow: glow)
            .frame(width: size, height: size)
            .scaleEffect(lockScale)
            .matchedGeometryEffect(id: BrandTransition.symbolID, in: namespace, isSource: !symbolFlewOut)
            .opacity(symbolFlewOut ? 0.999 : 1)
    }

    // ── Сценарий ─────────────────────────────────────────────────────────────

    private func run() async {
        guard !reduceMotion else {
            await runReduced()
            return
        }

        // 0,000–0,180 — центральная точка.
        phase = .point
        withAnimation(.easeOut(duration: 0.18)) { pointProgress = 1 }
        guard await sleep(Motion.point) else { return }

        // 0,180–0,720 — сегменты сходятся, каждый со своей задержкой.
        phase = .converging
        for index in segments.indices {
            withAnimation(Motion.assemble.delay(Double(index) * 0.035)) {
                segments[index] = 1
            }
        }
        guard await sleep(Motion.convergence) else { return }

        // 0,720–0,940 — знак встал.
        phase = .assembled
        guard await sleep(Motion.assembly) else { return }

        // Замок: одно короткое подтверждение и свет из центра.
        Haptics.tap()
        withAnimation(.easeOut(duration: 0.07)) { lockScale = 1.015; glow = 1 }
        guard await sleep(Motion.lock) else { return }
        withAnimation(.easeInOut(duration: 0.22)) { lockScale = 1; glow = 0.35 }

        // 0,980–1,280 — название.
        phase = .branded
        withAnimation(Motion.settle) { wordmarkShown = true }
        guard await sleep(Motion.wordmark) else { return }

        // Пауза узнавания — и заодно последний шанс догрузиться данным.
        guard await sleep(Motion.hold) else { return }
        guard await waitForReadiness() else { return }

        // 1,430–1,850 — знак уезжает в шапку входа, фон светлеет.
        phase = .transitioning
        withAnimation(Motion.travel) {
            symbolFlewOut = true
            backgroundLifted = true
            glow = 0
        }
        guard await sleep(Motion.handover) else { return }

        phase = .completed
        onFinish()
    }

    /// При «уменьшении движения» показываем знак и уходим: сборку из четырёх
    /// сегментов человек в этом режиме видеть не должен.
    private func runReduced() async {
        withAnimation(.easeOut(duration: 0.17)) {
            pointProgress = 1
            segments = [1, 1, 1, 1]
        }
        guard await sleep(.milliseconds(170)) else { return }
        withAnimation(.easeOut(duration: 0.14)) { wordmarkShown = true }
        guard await sleep(.milliseconds(160)) else { return }
        guard await waitForReadiness() else { return }
        withAnimation(.easeInOut(duration: 0.2)) {
            symbolFlewOut = true
            backgroundLifted = true
        }
        guard await sleep(.milliseconds(200)) else { return }
        phase = .completed
        onFinish()
    }

    /// Ждём данные короткими шагами: заставка уходит сразу, как всё приехало,
    /// а не отстаивает положенное время впустую. Вошедшего не держим вовсе —
    /// его ждёт рабочий экран, а не форма.
    private func waitForReadiness() async -> Bool {
        if goesToWorkspace() { return true }
        var waited: Duration = .zero
        let step: Duration = .milliseconds(60)
        while !isReady(), waited < Motion.maxWait {
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
