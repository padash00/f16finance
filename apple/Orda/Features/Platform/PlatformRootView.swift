import OrdaKit
import OrdaUI
import SwiftUI

/// Рабочее пространство суперадминистратора.
///
/// Отличается от остальных принципиально: это единственная роль, работающая
/// **между** организациями. Поэтому к разделам платформы добавляется весь
/// набор разделов организации — суперадмин должен уметь посмотреть на систему
/// глазами владельца.
struct PlatformRootView: View {
    let resolver: AccessResolver

    @Environment(\.api) private var api
    @Environment(AuthStore.self) private var auth

    @State private var store: PlatformStore?
    @State private var business: BusinessStore?
    @State private var selection: WorkspaceItem?

    #if os(iOS)
    /// Вкладка и путь «Разделов» — на телефоне переход снаружи упирается в них,
    /// а не в боковое меню.
    @State private var phoneTab: PlatformTab = .platform
    @State private var sectionsPath: [SectionRoute] = []
    #endif

    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    var body: some View {
        // Как и в остальных контурах: без этого характер устройства оставался
        // «телефоном», и платформенные сетки на планшете шли в один столбик.
        SurfaceReader { _ in
        Group {
            if let store, let business {
                OwnerAnalyticsScope {
                    VStack(spacing: 0) {
                        OrganizationContextBanner()
                        content
                    }
                }
                .environment(store)
                .environment(business)
                .environment(\.access, resolver)
                // Данные бизнес-разделов зависят от выбранной организации:
                // при переключении их надо перечитать, иначе на экране
                // останутся цифры прошлой.
                .onChange(of: auth.organizationID) { _, id in
                    savedOrganization = id
                    Task { await business.bootstrap() }
                }
            } else {
                LaunchView(message: "Загружаем платформу…")
            }
        }
        .task {
            guard store == nil else { return }
            let platform = PlatformStore(api: api)
            let businessStore = BusinessStore(api: api)
            store = platform
            business = businessStore

            async let platformLoad: Void = platform.load()
            async let businessLoad: Void = businessStore.bootstrap()
            _ = await (platformLoad, businessLoad)

            // Организация из флага запуска, иначе — та, в которой суперадмин
            // был в прошлый раз. Раньше выбор жил только в памяти: iOS
            // выгружала приложение, и оно открывалось во «Всей платформе» —
            // с другими вкладками, будто вернулся старый дизайн.
            // `-ordaOrganization platform` (или `none`) — открыть «Всю
            // платформу», не поднимая сохранённую организацию.
            let requested = LaunchOptions.requestedOrganization
            let forcesPlatform = requested == "platform" || requested == "none"
            if forcesPlatform {
                if auth.organizationID != nil { await auth.setOrganization(nil) }
                savedOrganization = nil
            }
            let wanted = forcesPlatform ? nil : (requested ?? savedOrganization)
            if let wanted,
               let organization = platform.organizations.first(where: { $0.slug == wanted || $0.id == wanted }),
               auth.organizationID != organization.id {
                await auth.setOrganization(organization.id)
                await businessStore.bootstrap()
            }

            if let page = LaunchOptions.requestedPage { openIfAllowed(pageID: page) }
        }
        // Суперадмину уведомления приходят те же, что и остальным, — и вести
        // должны туда же. Раньше нажатие на них здесь не делало ничего.
        .onChange(of: PushManager.shared.pendingRoute) { _, route in
            guard let route else { return }
            PushManager.shared.pendingRoute = nil
            openIfAllowed(pageID: route.pageID)
        }
        .onOpenURL { url in
            guard let pageID = DeepLink.pageID(from: url) else { return }
            openIfAllowed(pageID: pageID)
        }
        }
    }

    /// Последняя выбранная организация — своя запись у каждого аккаунта.
    /// `nil` — суперадмин сам ушёл во «Всю платформу», это тоже помним.
    private var savedOrganization: String? {
        get {
            guard let key = savedOrganizationKey else { return nil }
            return UserDefaults.standard.string(forKey: key)
        }
        nonmutating set {
            guard let key = savedOrganizationKey else { return }
            if let newValue {
                UserDefaults.standard.set(newValue, forKey: key)
            } else {
                UserDefaults.standard.removeObject(forKey: key)
            }
        }
    }

    private var savedOrganizationKey: String? {
        guard let userID = auth.session?.userID else { return nil }
        return "orda.platform.organization.\(userID)"
    }

    /// Открыть раздел по идентификатору страницы каталога.
    private func openIfAllowed(pageID: String) {
        guard let item = sections.lazy.compactMap({ section in
            section.items.first { $0.id == pageID }
        }).first else { return }

        selection = item

        #if os(iOS)
        // Новый кабинет владельца слушает свой маршрутизатор — когда он на
        // экране: телефон и выбранная организация.
        if sizeClass == .compact && auth.organizationID != nil && resolver.canSeeOwnerAnalytics {
            OwnerRouter.shared.open(item.id)
        }
        #endif

        #if os(iOS)
        switch item.id {
        case "platform.overview", "platform.organizations":
            phoneTab = item.id == "platform.overview" ? .platform : .organizations
            sectionsPath = []
        case "business.dashboard", "business.ledger", "business.analytics":
            // Отдельной вкладки аналитики у платформы нет — ведём в «Мою
            // компанию», а не в пустую страницу «Разделов».
            phoneTab = .company
            sectionsPath = []
        default:
            phoneTab = .sections
            sectionsPath = [SectionRoute(pageID: item.id)]
        }
        #endif
    }

    @ViewBuilder
    private var content: some View {
        #if os(iOS)
        if sizeClass == .compact {
            phoneTabs
        } else {
            splitLayout
        }
        #else
        splitLayout
        #endif
    }

    #if os(iOS)
    @ViewBuilder
    private var phoneTabs: some View {
        // Выбрана организация — суперадмин смотрит как её владелец: тот же
        // кабинет, плюс вкладка платформы первой.
        if auth.organizationID != nil && resolver.canSeeOwnerAnalytics {
            OwnerTabs(resolver: resolver, accent: Theme.accent(for: .platform), hasPlatform: true) {
                PlatformOverviewScreen()
                    .toolbar { OrganizationSwitcher() }
            }
        } else {
            platformPhoneTabs
        }
    }

    private var platformPhoneTabs: some View {
        TabView(selection: $phoneTab) {
            NavigationStack {
                PlatformOverviewScreen()
                    .toolbar { OrganizationSwitcher() }
            }
            .tabItem { Label("Платформа", systemImage: "building.columns.fill") }
            .tag(PlatformTab.platform)

            NavigationStack { OrganizationsScreen() }
                .tabItem { Label("Организации", systemImage: "building.2.fill") }
                .badge(store?.attention.count ?? 0)
                .tag(PlatformTab.organizations)

            NavigationStack {
                companyHome
                    .toolbar { OrganizationSwitcher() }
            }
            .tabItem { Label("Моя компания", systemImage: "house.fill") }
            .tag(PlatformTab.company)

            // Та же плитка сервисов, что у владельца, — а не старый список.
            NavigationStack(path: $sectionsPath) {
                OwnerServicesScreen(resolver: resolver)
            }
            .tabItem { Label("Сервисы", systemImage: "square.grid.2x2.fill") }
            .tag(PlatformTab.sections)

            NavigationStack { BusinessProfileScreen(resolver: resolver) }
                .tabItem { Label("Профиль", systemImage: "person.crop.circle.fill") }
                .tag(PlatformTab.profile)
        }
        .tint(Theme.accent(for: .platform))
    }
    #endif

    /// «Моя компания» — тот же кабинет, что у владельца.
    @ViewBuilder
    private var companyHome: some View {
        if resolver.canSeeOwnerAnalytics {
            OwnerHomeScreen(resolver: resolver) { destination in
                switch destination {
                case .analytics: openIfAllowed(pageID: "business.analytics")
                case .services:
                    #if os(iOS)
                    phoneTab = .sections
                    sectionsPath = []
                    #endif
                case let .page(id): openIfAllowed(pageID: id)
                }
            }
        } else {
            BusinessDashboardScreen(resolver: resolver)
        }
    }

    private var splitLayout: some View {
        AdaptiveWorkspace(
            sections: sections,
            accent: Theme.accent(for: .platform),
            title: "Платформа",
            selection: Binding(get: { selection }, set: { selection = $0 })
        ) { item in
            destination(for: item)
        }
        .toolbar { OrganizationSwitcher() }
        .onAppear {
            if selection == nil { selection = sections.first?.items.first }
        }
    }

    private var sections: [WorkspaceSection] {
        var result: [WorkspaceSection] = [
            WorkspaceSection(
                id: "platform",
                title: "Платформа",
                icon: "building.2.crop.circle",
                items: [
                    WorkspaceItem(id: "platform.overview", title: "Обзор", icon: "chart.bar.doc.horizontal"),
                    WorkspaceItem(
                        id: "platform.organizations",
                        title: "Организации",
                        icon: "building.2",
                        badge: store?.attention.count
                    ),
                ]
            ),
            WorkspaceSection(
                id: "business",
                title: "Моя компания",
                icon: "square.grid.2x2",
                items: [
                    WorkspaceItem(id: "business.dashboard", title: "Главная", icon: "house.fill"),
                    WorkspaceItem(id: "business.analytics", title: "Аналитика", icon: "chart.pie.fill"),
                    WorkspaceItem(id: "business.ledger", title: "Деньги", icon: "chart.line.uptrend.xyaxis"),
                ]
            ),
        ]

        result.append(contentsOf: resolver.nativeGroups().map { group, pages in
            WorkspaceSection(
                id: group.id,
                title: group.label,
                icon: BusinessRootView.icon(forGroup: group.id),
                items: pages.map { page in
                    WorkspaceItem(id: page.id, title: page.label, icon: BusinessRootView.icon(forPage: page.id))
                }
            )
        })

        return result
    }

    @ViewBuilder
    private func destination(for item: WorkspaceItem?) -> some View {
        switch item?.id {
        case "platform.overview", .none:
            PlatformOverviewScreen()
        case "platform.organizations":
            OrganizationsScreen()
        case "business.dashboard":
            companyHome
        case "business.analytics":
            OwnerAnalyticsScreen(resolver: resolver)
        case "business.ledger":
            LedgerScreen()
        default:
            if let item, NativePage.isNative(pageID: item.id) {
                NativePage.screen(pageID: item.id)
            } else {
                EmptyStateView(
                    icon: "building.2",
                    title: "Платформа Orda",
                    message: "Выберите раздел слева."
                )
            }
        }
    }
}

#if os(iOS)
/// Вкладки суперадмина.
enum PlatformTab: Hashable {
    case platform, organizations, company, sections, profile
}
#endif
