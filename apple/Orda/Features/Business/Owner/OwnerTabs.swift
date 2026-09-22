import OrdaKit
import OrdaUI
import SwiftUI

/// Вкладки кабинета владельца на телефоне.
///
/// Пять вкладок по смыслу, а не по страницам сайта: главная, аналитика,
/// сервисы плиткой, общение, профиль. Суперадмину первой вкладкой
/// подставляется платформа — вместо общения, чтобы не уйти за пять.
struct OwnerTabs<Platform: View>: View {
    let resolver: AccessResolver
    let accent: Color
    @ViewBuilder var platform: () -> Platform
    var hasPlatform: Bool

    @Environment(BusinessStore.self) private var business

    enum Tab: Hashable { case platform, home, analytics, services, talk, profile }

    @State private var tab: Tab = .home
    @State private var homePath: [SectionRoute] = []
    @State private var servicesPath: [SectionRoute] = []

    init(
        resolver: AccessResolver,
        accent: Color,
        hasPlatform: Bool = false,
        @ViewBuilder platform: @escaping () -> Platform = { EmptyView() }
    ) {
        self.resolver = resolver
        self.accent = accent
        self.hasPlatform = hasPlatform
        self.platform = platform
    }

    /// Общение: чат команды, если он выдан, иначе задачи.
    private var talk: (title: String, icon: String, view: AnyView)? {
        if hasPlatform { return nil }
        if resolver.can("team-chat.view") {
            return ("Чат", "bubble.left.and.bubble.right.fill", AnyView(TeamChatScreen()))
        }
        if resolver.can("tasks.view") {
            return ("Задачи", "checklist", AnyView(TeamTasksScreen()))
        }
        return nil
    }

    var body: some View {
        TabView(selection: $tab) {
            if hasPlatform {
                NavigationStack { platform() }
                    .tabItem { Label("Платформа", systemImage: "building.2.crop.circle") }
                    .tag(Tab.platform)
            }

            NavigationStack(path: $homePath) {
                OwnerHomeScreen(resolver: resolver) { destination in
                    switch destination {
                    case .analytics: tab = .analytics
                    case .services: tab = .services
                    case let .page(id): homePath.append(SectionRoute(pageID: id))
                    }
                }
                .navigationDestination(for: SectionRoute.self) { route in
                    NativePage.screen(pageID: route.pageID)
                }
            }
            .tabItem { Label("Главная", systemImage: "house.fill") }
            .tag(Tab.home)

            NavigationStack { OwnerAnalyticsScreen(resolver: resolver) }
                .tabItem { Label("Аналитика", systemImage: "chart.pie.fill") }
                .tag(Tab.analytics)

            NavigationStack(path: $servicesPath) { OwnerServicesScreen(resolver: resolver) }
                .tabItem { Label("Сервисы", systemImage: "square.grid.2x2.fill") }
                .badge(business.pending.count)
                .tag(Tab.services)

            if let talk {
                NavigationStack { talk.view }
                    .tabItem { Label(talk.title, systemImage: talk.icon) }
                    .tag(Tab.talk)
            }

            NavigationStack { BusinessProfileScreen(resolver: resolver) }
                .tabItem { Label("Профиль", systemImage: "person.crop.circle.fill") }
                .tag(Tab.profile)
        }
        .tint(accent)
        .task {
            // Вкладка и раздел при запуске: `-ordaTab analytics`,
            // `-ordaPage expenses` — для снимков экрана. Ждём первый кадр:
            // путь, выставленный до появления стека, SwiftUI теряет.
            try? await Task.sleep(for: .milliseconds(400))
            switch UserDefaults.standard.string(forKey: "ordaTab") {
            case "analytics": tab = .analytics
            case "services": tab = .services
            case "profile": tab = .profile
            default: break
            }
            if let page = LaunchOptions.requestedPage, homePath.isEmpty {
                tab = .home
                homePath = [SectionRoute(pageID: page)]
            }
        }
    }
}
