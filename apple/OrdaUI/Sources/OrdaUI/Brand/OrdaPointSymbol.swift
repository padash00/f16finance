import SwiftUI

/// Знак Orda Point: четыре сегмента и точка в центре.
///
/// Смысл знака — «все процессы сходятся в одну точку»: четыре внешних дуги
/// приходят с разных сторон и собираются вокруг центра. Поэтому он рисуется
/// геометрией, а не картинкой: сегменты должны уметь двигаться по отдельности,
/// иначе заставку пришлось бы делать роликом, а ролик нельзя ни перекрасить
/// под тему, ни продолжить переходом в экран входа.
///
/// Один знак на всё приложение: заставка, вход, шапки. Второй экземпляр
/// геометрии разошёлся бы с первым на первой же правке — и разошёлся бы
/// незаметно.
public struct OrdaPointSymbol: View {

    /// Насколько собран каждый сегмент: 0 — снаружи и невидим, 1 — на месте.
    ///
    /// Массивом, а не одним числом: в заставке сегменты приходят с задержкой
    /// друг за другом, и это единственное, что отличает сборку от появления.
    public var segments: [CGFloat]
    /// Появление центральной точки: 0 — нет, 1 — на месте.
    public var point: CGFloat
    /// Свечение на «замке» — коротком подтверждении в конце сборки.
    public var glow: CGFloat
    /// Цвет знака.
    public var palette: Palette

    public enum Palette: Sendable, Equatable {
        /// Фирменный градиент: мята → глубокая мята.
        case brand
        /// Одним цветом — для мест, где знак стоит рядом с текстом.
        case solid(Color)
    }

    public init(
        segments: [CGFloat] = [1, 1, 1, 1],
        point: CGFloat = 1,
        glow: CGFloat = 0,
        palette: Palette = .brand
    ) {
        self.segments = segments
        self.point = point
        self.glow = glow
        self.palette = palette
    }

    /// Геометрия знака в долях от стороны. Все числа — здесь, чтобы знак
    /// масштабировался целиком и не «разъезжался» на больших размерах.
    private enum Geometry {
        /// Радиус средней линии кольца.
        static let ringRadius: CGFloat = 0.375
        /// Толщина кольца.
        static let ringWidth: CGFloat = 0.148
        /// Радиус центральной точки.
        static let pointRadius: CGFloat = 0.105
        /// Просвет между сегментами по сторонам света.
        ///
        /// Считается по геометрии дуги, а видно меньше: закруглённые концы
        /// выступают за неё примерно на половину толщины кольца с каждой
        /// стороны. С прежними 20° просвет съедался целиком и знак выглядел
        /// сплошным кольцом со швами.
        static let gapDegrees: Double = 33
        /// Откуда приходит сегмент при сборке — в долях стороны.
        static let entryDistance: CGFloat = 0.62
    }

    /// Четыре сегмента по диагоналям: просветы приходятся на 12, 3, 6 и 9
    /// часов — так знак читается как прицел, а не как разорванное кольцо.
    private var arcs: [Arc] {
        [
            Arc(index: 0, center: 315, entry: -125),
            Arc(index: 1, center: 45, entry: -20),
            Arc(index: 2, center: 135, entry: 70),
            Arc(index: 3, center: 225, entry: 160),
        ]
    }

    private struct Arc: Identifiable {
        /// Порядок появления.
        let index: Int
        /// Середина дуги в градусах (0 — вправо, по часовой).
        let center: Double
        /// Направление, откуда сегмент приходит.
        let entry: Double

        var id: Int { index }
    }

    public var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width, proxy.size.height)

            ZStack {
                ForEach(arcs) { arc in
                    let progress = progress(for: arc.index)
                    let radians = arc.entry * .pi / 180
                    let distance = Geometry.entryDistance * side * (1 - progress)

                    ArcSegment(
                        centerDegrees: arc.center,
                        spanDegrees: 90 - Geometry.gapDegrees,
                        radius: Geometry.ringRadius,
                        width: Geometry.ringWidth
                    )
                    .fill(fill(for: arc.index))
                    .offset(x: cos(radians) * distance, y: sin(radians) * distance)
                    // Небольшой доворот на подлёте: сегмент входит в своё
                    // место, а не подставляется к нему готовым.
                    .rotationEffect(.degrees((1 - Double(progress)) * (arc.index.isMultiple(of: 2) ? 11 : -11)))
                    .scaleEffect(0.92 + 0.08 * progress)
                    .opacity(Double(progress))
                }

                Circle()
                    .fill(pointFill)
                    .frame(width: side * Geometry.pointRadius * 2, height: side * Geometry.pointRadius * 2)
                    .scaleEffect(0.55 + 0.45 * point)
                    .opacity(Double(point))
                    .blur(radius: 4 * (1 - point))
            }
            .frame(width: side, height: side)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            // Свечение — один слой и ненадолго: знак должен выглядеть точным,
            // а не неоновым.
            .shadow(color: glowColor.opacity(0.42 * Double(glow)), radius: side * 0.17 * glow)
        }
        .aspectRatio(1, contentMode: .fit)
        // Знак ничего не сообщает голосом: рядом всегда есть название.
        .accessibilityHidden(true)
    }

    private func progress(for index: Int) -> CGFloat {
        guard index < segments.count else { return 1 }
        return min(max(segments[index], 0), 1)
    }

    private func fill(for index: Int) -> AnyShapeStyle {
        switch palette {
        case .solid(let color):
            return AnyShapeStyle(color)
        case .brand:
            // Верхние сегменты светлее нижних: знак получает объём, оставаясь
            // плоским — так он выглядит на светлом и на тёмном одинаково.
            let light = index == 0 || index == 1
            return AnyShapeStyle(
                LinearGradient(
                    colors: light
                        ? [Theme.brandMint, Theme.brandMint.opacity(0.86)]
                        : [Theme.brandMint.opacity(0.92), Theme.brandDeep],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
        }
    }

    private var pointFill: AnyShapeStyle {
        switch palette {
        case .solid(let color):
            AnyShapeStyle(color)
        case .brand:
            // Точка тоже с переходом: сплошная глубокая мята на тёмном фоне
            // заставки читалась как дырка в кольце.
            AnyShapeStyle(
                LinearGradient(
                    colors: [Theme.brandMint, Theme.brandDeep],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
        }
    }

    private var glowColor: Color {
        switch palette {
        case .solid(let color): color
        case .brand: Theme.brandMint
        }
    }
}

/// Один сегмент кольца — дуга с закруглёнными концами.
///
/// Считается от габаритов, поэтому знак одинаков на 24 и на 120 точках.
public struct ArcSegment: Shape {
    /// Середина дуги в градусах: 0 — вправо, по часовой стрелке.
    public var centerDegrees: Double
    /// Угловая длина дуги.
    public var spanDegrees: Double
    /// Радиус средней линии в долях стороны.
    public var radius: CGFloat
    /// Толщина в долях стороны.
    public var width: CGFloat

    public init(centerDegrees: Double, spanDegrees: Double, radius: CGFloat, width: CGFloat) {
        self.centerDegrees = centerDegrees
        self.spanDegrees = spanDegrees
        self.radius = radius
        self.width = width
    }

    public func path(in rect: CGRect) -> Path {
        let side = min(rect.width, rect.height)
        let center = CGPoint(x: rect.midX, y: rect.midY)
        let lineWidth = side * width

        var path = Path()
        path.addArc(
            center: center,
            radius: side * radius,
            startAngle: .degrees(centerDegrees - spanDegrees / 2),
            endAngle: .degrees(centerDegrees + spanDegrees / 2),
            clockwise: false
        )
        return path.strokedPath(StrokeStyle(lineWidth: lineWidth, lineCap: .round))
    }
}

/// Знак и название рядом — то, что стоит в шапке входа.
public struct OrdaPointLogo: View {
    public var symbolSize: CGFloat
    public var layout: Layout
    public var showsDescriptor: Bool

    public enum Layout: Sendable { case stacked, horizontal }

    public init(symbolSize: CGFloat, layout: Layout = .stacked, showsDescriptor: Bool = true) {
        self.symbolSize = symbolSize
        self.layout = layout
        self.showsDescriptor = showsDescriptor
    }

    public var body: some View {
        switch layout {
        case .stacked:
            VStack(spacing: Spacing.md) {
                OrdaPointSymbol()
                    .frame(width: symbolSize, height: symbolSize)
                wordmark
                    .multilineTextAlignment(.center)
            }
        case .horizontal:
            HStack(spacing: Spacing.md) {
                OrdaPointSymbol()
                    .frame(width: symbolSize, height: symbolSize)
                wordmark
            }
        }
    }

    @ViewBuilder
    private var wordmark: some View {
        VStack(alignment: layout == .stacked ? .center : .leading, spacing: Spacing.xxs) {
            Text("Orda Point")
                .font(.system(size: symbolSize * 0.52, weight: .semibold, design: .rounded))
                .foregroundStyle(Theme.text)
            if showsDescriptor {
                Text("Управление клубом и точками продаж")
                    .font(Typography.callout)
                    .foregroundStyle(Theme.textDim)
            }
        }
    }
}

#Preview("Знак") {
    VStack(spacing: 32) {
        OrdaPointSymbol().frame(width: 120, height: 120)
        OrdaPointSymbol(segments: [1, 0.4, 0, 0.7], point: 1).frame(width: 120, height: 120)
        OrdaPointLogo(symbolSize: 72)
    }
    .padding(40)
    .background(Theme.background)
}
