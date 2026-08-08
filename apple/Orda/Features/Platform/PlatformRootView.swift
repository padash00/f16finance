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
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    var body: some View {
        Group {
            if let store, let business {
                content
                    .environment(store)
                    .environment(business)
                    .environment(\.access, resolver)
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
        }
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

    private var phoneTabs: some View {
        TabView {
            NavigationStack { PlatformOverviewScreen() }
                .tabItem { Label("Платформа", systemImage: "chart.bar.doc.horizontal") }

            NavigationStack { OrganizationsScreen() }
                .tabItem { Label("Организации", systemImage: "building.2") }
                .badge(store?.attention.count ?? 0)

            NavigationStack { BusinessDashboardScreen(resolver: resolver) }
                .tabItem { Label("Бизнес", systemImage: "square.grid.2x2.fill") }

            NavigationStack { BusinessSectionsScreen(resolver: resolver) }
                .tabItem { Label("Разделы", systemImage: "list.bullet") }

            NavigationStack { BusinessProfileScreen(resolver: resolver) }
                .tabItem { Label("Профиль", systemImage: "person.crop.circle") }
        }
        .tint(Theme.accent(for: .platform))
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
                title: "Бизнес",
                icon: "square.grid.2x2",
                items: [
                    WorkspaceItem(id: "business.dashboard", title: "Обзор точек", icon: "chart.bar.fill"),
                    WorkspaceItem(id: "business.ledger", title: "Деньги", icon: "chart.line.uptrend.xyaxis"),
                ]
            ),
        ]

        result.append(contentsOf: resolver.visibleGroups().map { group, pages in
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
            BusinessDashboardScreen(resolver: resolver)
        case "business.ledger":
            LedgerScreen()
        default:
            if let item, let page = CapabilityCatalog.page(id: item.id) {
                PageScaffold(page: page, resolver: resolver)
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
