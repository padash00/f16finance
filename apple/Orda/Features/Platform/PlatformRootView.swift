import OrdaKit
import OrdaUI
import SwiftUI

/// Рабочее пространство суперадминистратора.
///
/// Отличается от остальных принципиально: это единственная роль, работающая
/// **между** организациями. Поэтому к разделам платформы добавляется весь
/// набор разделов организации — суперадмин должен уметь посмотреть на систему
/// глазами владельца, переключив организацию в шапке.
struct PlatformRootView: View {
    let resolver: AccessResolver

    @Environment(AuthStore.self) private var auth
    @State private var selection: WorkspaceItem?

    var body: some View {
        AdaptiveWorkspace(
            sections: sections,
            accent: Theme.accent(for: .platform),
            title: "Платформа",
            selection: $selection
        ) { item in
            destination(for: item)
        }
        .safeAreaInset(edge: .top) {
            // Постоянная отметка режима: суперадмин не должен спутать чужую
            // организацию со своей — цена ошибки слишком высока.
            if auth.organizationID != nil {
                observerBanner
            }
        }
        .onAppear {
            if selection == nil { selection = sections.first?.items.first }
        }
    }

    private var observerBanner: some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: "eye.fill")
            Text("Просмотр чужой организации")
                .font(Typography.caption.weight(.semibold))
            Spacer()
            Button("Выйти") {
                Task { await auth.setOrganization(nil) }
            }
            .buttonStyle(.plain)
            .font(Typography.caption.weight(.bold))
        }
        .foregroundStyle(Color.black.opacity(0.85))
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.sm)
        .background(Theme.accent(for: .platform))
    }

    private var sections: [WorkspaceSection] {
        var result: [WorkspaceSection] = [
            WorkspaceSection(
                id: "platform",
                title: "Платформа",
                icon: "building.2.crop.circle",
                items: [
                    WorkspaceItem(id: "platform.overview", title: "Обзор", icon: "chart.bar.doc.horizontal"),
                    WorkspaceItem(id: "platform.organizations", title: "Организации", icon: "building.2"),
                    WorkspaceItem(id: "platform.packages", title: "Пакеты и модули", icon: "shippingbox.circle"),
                    WorkspaceItem(id: "platform.billing", title: "Биллинг", icon: "creditcard"),
                    WorkspaceItem(id: "platform.invoices", title: "Счета", icon: "doc.text"),
                    WorkspaceItem(id: "platform.analytics", title: "Аналитика", icon: "chart.xyaxis.line"),
                    WorkspaceItem(id: "platform.audit", title: "Аудит", icon: "list.bullet.rectangle.portrait"),
                    WorkspaceItem(id: "platform.health", title: "Здоровье системы", icon: "waveform.path.ecg"),
                ]
            )
        ]

        // Суперадмину доступны все разделы организации — сервер отдаёт ему
        // `["*"]`, поэтому резолвер вернёт все девять групп.
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
        if let item {
            if item.id.hasPrefix("platform.") {
                PlatformPlaceholderView(item: item)
            } else if let page = CapabilityCatalog.page(id: item.id) {
                PageScaffold(page: page, resolver: resolver)
            } else {
                EmptyStateView(title: "Раздел недоступен", message: "Страница не найдена в каталоге.")
            }
        } else {
            EmptyStateView(
                icon: "building.2",
                title: "Платформа Orda",
                message: "Выберите раздел слева."
            )
        }
    }
}

/// Каркас экрана платформы до подключения данных.
struct PlatformPlaceholderView: View {
    let item: WorkspaceItem

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                SectionHeader(item.title, subtitle: endpoint)

                Card(accent: Theme.warning) {
                    Label("Экран данных подключается на следующем этапе", systemImage: "hammer")
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textMuted)
                }
            }
            .padding(Spacing.lg)
            .frame(maxWidth: 720, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .background(Theme.background)
        .navigationTitle(item.title)
    }

    /// Источник данных экрана — чтобы связь с бэкендом была видна сразу.
    private var endpoint: String {
        switch item.id {
        case "platform.overview": "/api/admin/platform"
        case "platform.organizations": "/api/admin/organizations"
        case "platform.packages": "/api/admin/platform/packages"
        case "platform.billing": "/api/admin/platform/billing"
        case "platform.invoices": "/api/admin/platform/invoices"
        case "platform.analytics": "/api/admin/platform/analytics"
        case "platform.audit": "/api/admin/platform/audit"
        case "platform.health": "/api/admin/health"
        default: ""
        }
    }
}
