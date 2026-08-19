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
        ///
        /// Подобран так, чтобы внешний край знака почти касался рамки:
        /// `0.40 + 0.17/2 = 0.485` от стороны. Иначе внутри рамки остаётся
        /// невидимый запас, и знак в вёрстке «висит выше», чем кажется —
        /// расстояние до названия на глаз больше заданного.
        static let ringRadius: CGFloat = 0.400
        /// Толщина кольца.
        static let ringWidth: CGFloat = 0.170
        /// Радиус центральной точки.
        static let pointRadius: CGFloat = 0.100
        /// Просвет между сегментами по сторонам света.
        ///
        /// Считается по геометрии дуги, а видно меньше: закруглённые концы
        /// выступают за неё примерно на половину толщины кольца с каждой
        /// стороны — здесь это около 13,5° с каждого конца. Чтобы на глаз
        /// остался узкий просвет в 13°, геометрический должен быть в три раза
        /// шире. Со слишком широким знак распадался на четыре запятые вместо
        /// кольца с прорезями.
        static let gapDegrees: Double = 37
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

/// Знак и название как одна композиция.
///
/// Единственный способ поставить логотип на экран: знак и название всегда в
/// одной стопке с общей осью и заданным расстоянием. До этого заставка и
/// шапка входа складывали их сами — знак оказывался выше и левее, название
/// ниже и правее, между ними зияла дыра. Это не «съехали отступы»: элементы
/// были самостоятельными, и каждый считал своё положение от экрана.
///
/// Здесь у них один родитель, одна система координат и один центр. Всё, что
/// снаружи, двигает композицию целиком — не знак и не текст по отдельности.
public struct OrdaPointLockup: View {
    public var symbolSize: CGFloat
    /// Состояние сборки знака — для заставки.
    public var segments: [CGFloat]
    public var point: CGFloat
    public var glow: CGFloat
    /// Появление названия: 0 — ещё нет.
    public var wordmarkOpacity: Double
    /// Крошечный сдвиг на проявлении. Больше нескольких точек здесь быть не
    /// может: конечное место названия задано вёрсткой, а не анимацией.
    public var wordmarkOffset: CGFloat
    public var wordmarkColor: Color
    /// Строка под названием. В заставке её нет — там только бренд.
    public var descriptor: String?

    public init(
        symbolSize: CGFloat,
        segments: [CGFloat] = [1, 1, 1, 1],
        point: CGFloat = 1,
        glow: CGFloat = 0,
        wordmarkOpacity: Double = 1,
        wordmarkOffset: CGFloat = 0,
        wordmarkColor: Color = Theme.text,
        descriptor: String? = nil
    ) {
        self.symbolSize = symbolSize
        self.segments = segments
        self.point = point
        self.glow = glow
        self.wordmarkOpacity = wordmarkOpacity
        self.wordmarkOffset = wordmarkOffset
        self.wordmarkColor = wordmarkColor
        self.descriptor = descriptor
    }

    /// Расстояние от знака до названия: доля от размера знака, но не выходя
    /// за 12–20 точек. Логотип должен читаться как один блок и на телефоне, и
    /// на планшете.
    public static func spacing(for symbolSize: CGFloat) -> CGFloat {
        // 0,12 доли, а не 0,15: у шрифта есть свой верхний просвет, и на глаз
        // расстояние выходит больше заданного. С этим коэффициентом просвет
        // между знаком и буквами читается как 12–16 точек — то, что нужно.
        min(max(symbolSize * 0.12, 12), 20)
    }

    public var body: some View {
        VStack(spacing: Self.spacing(for: symbolSize)) {
            OrdaPointSymbol(segments: segments, point: point, glow: glow)
                .frame(width: symbolSize, height: symbolSize)

            VStack(spacing: Spacing.xs) {
                Text("Orda Point")
                    .font(.system(size: symbolSize * 0.30, weight: .semibold, design: .rounded))
                    .foregroundStyle(wordmarkColor)

                if let descriptor {
                    // Подпись растёт вместе со знаком, но не ниже обычного
                    // размера: на планшете знак вдвое крупнее, и подпись
                    // прежнего кегля выглядела приписанной сбоку.
                    Text(descriptor)
                        .font(.system(size: max(15, symbolSize * 0.135)))
                        .foregroundStyle(Theme.textDim)
                        .multilineTextAlignment(.center)
                }
            }
            .opacity(wordmarkOpacity)
            .offset(y: wordmarkOffset)
        }
        .frame(maxWidth: .infinity)
    }
}

#Preview("Знак") {
    VStack(spacing: 32) {
        OrdaPointSymbol().frame(width: 120, height: 120)
        OrdaPointSymbol(segments: [1, 0.4, 0, 0.7], point: 1).frame(width: 120, height: 120)
        OrdaPointLockup(symbolSize: 112, descriptor: "Управление клубом и точками продаж")
    }
    .padding(40)
    .background(Theme.background)
}
