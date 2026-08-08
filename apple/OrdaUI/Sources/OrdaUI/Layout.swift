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
        case .tablet: 760
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
    #endif

    public init(@ViewBuilder content: @escaping (Surface) -> Content) {
        self.content = content
    }

    public var body: some View {
        let surface = resolved
        content(surface).environment(\.surface, surface)
    }

    private var resolved: Surface {
        #if os(macOS)
        return .desktop
        #else
        return sizeClass == .compact ? .handheld : .tablet
        #endif
    }
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

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        if surface.isCompact {
            VStack(spacing: Spacing.lg) { content }
        } else {
            // Колонки фиксированной минимальной ширины: на сверхшироком окне
            // растягиваем не карточки, а их количество.
            LazyVGrid(
                columns: Array(
                    repeating: GridItem(.flexible(minimum: 280), spacing: Spacing.lg, alignment: .top),
                    count: surface.dashboardColumns
                ),
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

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        ScrollView {
            VStack(spacing: Spacing.lg) { content }
                .padding(surface.screenPadding)
                .frame(maxWidth: surface.contentWidth)
                .frame(maxWidth: .infinity, alignment: surface == .desktop ? .topLeading : .top)
        }
        .background(Theme.background)
    }
}
