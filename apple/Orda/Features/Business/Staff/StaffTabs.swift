import OrdaKit
import OrdaUI
import SwiftUI

/// Вкладки сотрудника на телефоне — свои у каждой должности.
///
/// Главная, до двух рабочих вкладок должности (бухгалтеру — решения по
/// расходам, старшему оператору — смены, маркетологу — клиенты), сервисы
/// плиткой и профиль. Рабочие вкладки — из `StaffRolePlaybook`, но только
/// выданные: без права на смены вкладки «Смены» не будет.
///
/// Переходы извне (уведомление, ссылка) приходят через `OwnerRouter`, как и у
/// владельца.
struct StaffTabs: View {
    let resolver: AccessResolver
    let accent: Color

    @Environment(BusinessStore.self) private var business

    private enum Tab: Hashable {
        case home, work(String), services, profile
    }

    @State private var tab: Tab = .home
    @State private var homePath: [SectionRoute] = []
    @State private var servicesPath: [SectionRoute] = []

    /// Рабочие вкладки: первые две выданные из набора должности.
    private var workPages: [String] {
        Array(resolver.playbookPages(resolver.playbook.tabPageIDs).prefix(2))
    }

    var body: some View {
        TabView(selection: $tab) {
            NavigationStack(path: $homePath) {
                StaffHomeScreen(resolver: resolver) { destination in
                    switch destination {
                    case .analytics, .services: tab = .services
                    case let .page(id): open(id)
                    }
                }
                .navigationDestination(for: SectionRoute.self) { route in
                    NativePage.screen(pageID: route.pageID)
                }
            }
            .tabItem { Label("Главная", systemImage: "house.fill") }
            .tag(Tab.home)

            ForEach(workPages, id: \.self) { pageID in
                NavigationStack { NativePage.screen(pageID: pageID) }
                    .tabItem { Label(Self.tabTitle(pageID), systemImage: BusinessRootView.icon(forPage: pageID)) }
                    .badge(pageID == "expenses-pending" ? business.pending.count : 0)
                    .tag(Tab.work(pageID))
            }

            NavigationStack(path: $servicesPath) { OwnerServicesScreen(resolver: resolver) }
                .tabItem { Label("Сервисы", systemImage: "square.grid.2x2.fill") }
                .tag(Tab.services)

            NavigationStack { BusinessProfileScreen(resolver: resolver) }
                .tabItem { Label("Профиль", systemImage: "person.crop.circle.fill") }
                .tag(Tab.profile)
        }
        .tint(accent)
        .task {
            // Путь, выставленный до появления стека, SwiftUI теряет — ждём кадр.
            try? await Task.sleep(for: .milliseconds(400))
            switch UserDefaults.standard.string(forKey: "ordaTab") {
            case "services": tab = .services
            case "profile": tab = .profile
            default: break
            }
            if let request = OwnerRouter.shared.consume() { route(request.pageID) }
        }
        .onChange(of: OwnerRouter.shared.request) { _, request in
            guard request != nil, let request = OwnerRouter.shared.consume() else { return }
            route(request.pageID)
        }
    }

    /// Раздел со своей вкладкой — во вкладке, остальное поверх главной.
    private func open(_ pageID: String) {
        if workPages.contains(pageID) {
            tab = .work(pageID)
        } else {
            homePath.append(SectionRoute(pageID: pageID))
        }
    }

    private func route(_ pageID: String) {
        switch pageID {
        case "home.dashboard", "business.dashboard":
            tab = .home
            homePath = []
        default:
            guard NativePage.isNative(pageID: pageID) else { return }
            if workPages.contains(pageID) {
                tab = .work(pageID)
            } else {
                tab = .home
                homePath = [SectionRoute(pageID: pageID)]
            }
        }
    }

    /// Подпись вкладки — одно слово: длинное iOS обрежет многоточием.
    static func tabTitle(_ pageID: String) -> String {
        switch pageID {
        case "team-chat": "Чат"
        case "tasks": "Задачи"
        default: StaffHomeScreen.shortTitle(pageID)
        }
    }
}
