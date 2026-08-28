import SwiftUI

/// Характер платформы.
///
/// Не «размер экрана», а способ работы. Один и тот же экран на телефоне,
/// планшете и маке решает разные задачи, и растягивать телефонную раскладку на
/// 27 дюймов — значит не решать ни одну.
public enum Surface: Sendable {
    /// Телефон в руке, на ходу, часто одной рукой. Один столбец, крупные цели,
    /// таб-бар снизу под большой палец.
    case handheld
    /// Планшет на стойке или на складе. Две колонки: список и деталь рядом,
    /// работа в две руки без переходов туда-обратно.
    case tablet
    /// Компьютер за столом. Плотность важнее крупности: несколько колонок,
    /// таблицы вместо карточек, клавиатура и меню.
    case desktop

    /// Ширина, за которую содержимое не должно расползаться. На маке колонка
    /// шире: там читают с большего расстояния и ждут плотности.
    public var contentWidth: CGFloat {
        switch self {
        case .handheld: 640
        // Планшет в портрете: колонка шире телефонной, но не во весь экран —
        // строка на 1200 точек уже плохо читается.
        case .tablet: 900
        case .desktop: .infinity
        }
    }

    /// Сколько колонок держит дашборд.
    public var dashboardColumns: Int {
        switch self {
        case .handheld: 1
        case .tablet: 2
        case .desktop: 3
        }
    }

    /// Внутренние поля карточки. На маке теснее — иначе экран пустует.
    public var cardPadding: CGFloat {
        switch self {
        case .handheld: Spacing.lg
        case .tablet: Spacing.lg
        case .desktop: Spacing.md
        }
    }

    /// Отступ от краёв экрана.
    public var screenPadding: CGFloat {
        switch self {
        case .handheld: Spacing.lg
        case .tablet: Spacing.xl
        case .desktop: Spacing.xl
        }
    }

    /// Ширина колонки на низком экране — телефон, повёрнутый набок.
    ///
    /// Телефонные 640 точек оставляли по полторы сотни пустоты с каждой
    /// стороны: экран стал вдвое шире, а содержимое осталось прежним. 900 —
    /// это практически вся ширина за вычетом безопасных зон, и запас на
    /// будущие модели пошире.
    public var landscapeContentWidth: CGFloat {
        self == .handheld ? 900 : contentWidth
    }

    public var isCompact: Bool { self == .handheld }
    public var isWide: Bool { self != .handheld }
}

private struct SurfaceKey: EnvironmentKey {
    static let defaultValue: Surface = {
        #if os(macOS)
        .desktop
        #else
        .handheld
        #endif
    }()
}

extension EnvironmentValues {
    /// Характер текущей платформы. Проставляется один раз в корне.
    public var surface: Surface {
        get { self[SurfaceKey.self] }
        set { self[SurfaceKey.self] = newValue }
    }
}

/// Определяет характер платформы и прокидывает его вниз.
///
/// На iPad решает не модель устройства, а класс размера: в Split View планшет
/// становится узким, и телефонная раскладка там уместнее.
public struct SurfaceReader<Content: View>: View {
    @ViewBuilder private let content: (Surface) -> Content

    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.verticalSizeClass) private var heightClass
    #endif

    public init(@ViewBuilder content: @escaping (Surface) -> Content) {
        self.content = content
    }

    public var body: some View {
        #if os(macOS)
        content(.desktop).environment(\.surface, .desktop)
        #else
        // Решает реальная ширина, а не только класс размера. iPad в альбомной
        // ориентации шире многих маков — держать там колонку в 900 точек
        // значит оставить половину экрана пустой. В Split View тот же iPad
        // становится узким, и телефонная раскладка уместнее.
        GeometryReader { proxy in
            let surface = resolve(width: proxy.size.width)
            content(surface).environment(\.surface, surface)
        }
        #endif
    }

    #if os(iOS)
    private func resolve(width: CGFloat) -> Surface {
        if sizeClass == .compact { return .handheld }
        // Телефон в альбоме — это низкий экран, а не планшет. Большие модели
        // отдают широкий класс размера, и раскладка уезжала в панель с
        // колонками: панель съедала треть и без того короткого экрана, а слева
        // оставалась полоса безопасной зоны под «островом».
        if heightClass == .compact { return .handheld }
        return width >= 1000 ? .desktop : .tablet
    }
    #endif
}

// ── Сетка дашборда ───────────────────────────────────────────────────────────

/// Раскладка дашборда: один столбец на телефоне, несколько колонок на большом
/// экране.
///
/// Карточки распределяются по колонкам по очереди, а не режутся пополам:
/// содержимое разной высоты иначе оставляет рваные пустоты. Порядок чтения
/// сохраняется — важное всё равно попадает в первую колонку.
public struct DashboardGrid<Content: View>: View {
    private let content: Content
    @Environment(\.surface) private var surface
    #if os(iOS)
    @Environment(\.verticalSizeClass) private var heightClass
    #endif

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    /// Телефон набок: экран вдвое шире портретного, и столбец карточек шириной
    /// в треть его оставлял две трети пустыми.
    private var isShort: Bool {
        #if os(iOS)
        heightClass == .compact
        #else
        false
        #endif
    }

    public var body: some View {
        if surface.isCompact && !isShort {
            VStack(spacing: Spacing.lg) { content }
        } else {
            // Колонки подбираются по фактической ширине, а не по классу
            // устройства.
            //
            // Раньше число колонок брали у `Surface`, а его определяет ширина
            // всего окна. Внутри `NavigationSplitView` правая часть уже окна на
            // ширину боковой панели — и на iPad в портрете две колонки по 280
            // просто не помещались: карточки уезжали за правый край экрана.
            // На низком экране порог шире: 380 даёт две колонки примерно той
            // ширины, под которую карточки рисовались в портрете. С порогом в
            // 280 их стало бы три, и цифры в них начали бы переноситься.
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: isShort ? 380 : 280), spacing: Spacing.lg, alignment: .top)],
                alignment: .leading,
                spacing: Spacing.lg
            ) {
                content
            }
        }
    }
}

/// Контейнер экрана: прокрутка, отступы и предел ширины по характеру платформы.
public struct ScreenScroll<Content: View>: View {
    private let content: Content
    @Environment(\.surface) private var surface
    #if os(iOS)
    @Environment(\.verticalSizeClass) private var heightClass
    #endif

    /// Низкий экран — телефон набок. Там ширины вдвое больше, чем в портрете,
    /// и держать содержимое в телефонной колонке значит показывать половину.
    private var maxWidth: CGFloat {
        #if os(iOS)
        heightClass == .compact ? surface.landscapeContentWidth : surface.contentWidth
        #else
        surface.contentWidth
        #endif
    }

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        ScrollView {
            // Лениво: экраны здесь длинные — два десятка карточек, каждая со
            // своими запросами и графиками. Обычный VStack строит их все сразу,
            // включая те, до которых человек не долистает.
            LazyVStack(spacing: Spacing.lg) { content }
                .padding(surface.screenPadding)
                .frame(maxWidth: maxWidth)
                .frame(maxWidth: .infinity, alignment: surface == .desktop ? .topLeading : .top)
        }
        .background(Theme.background)
    }
}

/// Дашборд из двух осмысленных колонок.
///
/// `DashboardGrid` раскладывает карточки потоком, и при разной высоте край
/// получается рваным: одна колонка обрывается, соседние пустуют. Здесь
/// содержимое распределяет автор — главное слева, сопровождающее справа, —
/// поэтому обе колонки идут до низа и выглядят собранными.
public struct SplitDashboard<Main: View, Side: View>: View {
    private let main: Main
    private let side: Side
    /// Доля ширины под главную колонку.
    private let mainRatio: CGFloat

    @Environment(\.surface) private var surface

    public init(
        mainRatio: CGFloat = 0.62,
        @ViewBuilder main: () -> Main,
        @ViewBuilder side: () -> Side
    ) {
        self.mainRatio = mainRatio
        self.main = main()
        self.side = side()
    }

    public var body: some View {
        if surface.isCompact {
            // На телефоне колонки складываются в одну: сначала главное.
            VStack(spacing: Spacing.lg) {
                main
                side
            }
        } else {
            // Ширину боковой колонки берём у контейнера через
            // `containerRelativeFrame`, а не через `GeometryReader`.
            //
            // `GeometryReader` не имеет собственной высоты: внутри `ScrollView`
            // он схлопывался, и приходилось подпирать его `minHeight: 420` —
            // отчего колонка выше 420 точек обрезалась, а на коротких экранах
            // снизу оставалась пустота. Здесь высота естественная, по
            // содержимому.
            // Узкой области две колонки не по размеру: на iPad в портрете
            // правая часть сплита — около пятисот точек, и главная колонка
            // ужималась до нечитаемой полосы, а боковая уезжала за край.
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: Spacing.lg) {
                    VStack(spacing: Spacing.lg) { main }
                        .frame(minWidth: 320, maxWidth: .infinity, alignment: .top)

                    VStack(spacing: Spacing.lg) { side }
                        .frame(width: 320, alignment: .top)
                }

                VStack(spacing: Spacing.lg) {
                    main
                    side
                }
            }
        }
    }
}
