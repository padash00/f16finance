import OrdaKit
import OrdaUI
import SwiftUI

/// Права текущего пользователя, доступные любому экрану.
///
/// Через окружение, а не протаскиванием параметром: гейт нужен глубоко внутри
/// карточек и кнопок, и тянуть резолвер через десять уровней было бы шумом.
private struct AccessResolverEnvironmentKey: EnvironmentKey {
    static let defaultValue: AccessResolver? = nil
}

extension EnvironmentValues {
    var access: AccessResolver? {
        get { self[AccessResolverEnvironmentKey.self] }
        set { self[AccessResolverEnvironmentKey.self] = newValue }
    }
}

/// Рабочее пространство владельца и сотрудника.
///
/// Разделы выводятся из прав, а не задаются в коде: роли в системе
/// динамические, владелец создаёт свои через `/access` с любым набором из 397
/// прав. Захардкоженный «экран менеджера» разошёлся бы с реальностью на первой
/// же нестандартной роли.
struct BusinessRootView: View {
    let resolver: AccessResolver

    @Environment(\.api) private var api
    @State private var store: BusinessStore?
    @State private var selection: WorkspaceItem?

    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    var body: some View {
        Group {
            if let store {
                content
                    .environment(store)
                    .environment(\.access, resolver)
            } else {
                LaunchView(message: "Загружаем данные…")
            }
        }
        .task {
            guard store == nil else { return }
            let created = BusinessStore(api: api)
            store = created
            await created.bootstrap()
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

    // ── iPhone ───────────────────────────────────────────────────────────────

    private var phoneTabs: some View {
        TabView {
            NavigationStack { BusinessDashboardScreen(resolver: resolver) }
                .tabItem { Label("Обзор", systemImage: "square.grid.2x2.fill") }

            NavigationStack { LedgerScreen() }
                .tabItem { Label("Деньги", systemImage: "chart.line.uptrend.xyaxis") }

            if resolver.can("expenses-pending.view") {
                NavigationStack { ApprovalsScreen() }
                    .tabItem { Label("Решения", systemImage: "checkmark.circle") }
                    .badge(store?.pending.count ?? 0)
            }

            NavigationStack { BusinessSectionsScreen(resolver: resolver) }
                .tabItem { Label("Разделы", systemImage: "list.bullet") }

            NavigationStack { BusinessProfileScreen(resolver: resolver) }
                .tabItem { Label("Профиль", systemImage: "person.crop.circle") }
        }
        .tint(accent)
    }

    // ── iPad и Mac ───────────────────────────────────────────────────────────

    private var splitLayout: some View {
        AdaptiveWorkspace(
            sections: sections,
            accent: accent,
            title: workspaceTitle,
            selection: Binding(
                get: { selection },
                set: { selection = $0 }
            )
        ) { item in
            destination(for: item)
        }
        .onAppear {
            if selection == nil { selection = sections.first?.items.first }
        }
    }

    private var accent: Color {
        resolver.workspace == .owner ? Theme.accent(for: .owner) : Theme.accent(for: .staff)
    }

    private var workspaceTitle: String {
        resolver.workspace == .owner ? "Бизнес" : "Работа"
    }

    /// Раздел «Главное» плюс группы каталога прав.
    private var sections: [WorkspaceSection] {
        var result: [WorkspaceSection] = [
            WorkspaceSection(
                id: "home",
                title: "Главное",
                icon: "square.grid.2x2",
                items: [
                    WorkspaceItem(id: "home.dashboard", title: "Обзор", icon: "chart.bar.fill"),
                    WorkspaceItem(id: "home.ledger", title: "Деньги", icon: "chart.line.uptrend.xyaxis"),
                ] + (resolver.can("expenses-pending.view")
                     ? [WorkspaceItem(id: "home.approvals", title: "Решения", icon: "checkmark.circle", badge: store?.pending.count)]
                     : [])
                // Подписки нет в каталоге прав — это владельческий раздел,
                // и через каталог он не появится ни у кого.
                + (resolver.workspace == .owner
                   ? [WorkspaceItem(id: "home.subscription", title: "Подписка", icon: "creditcard")]
                   : [])
            )
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
        case "home.dashboard", .none:
            BusinessDashboardScreen(resolver: resolver)
        case "home.ledger":
            LedgerScreen()
        case "home.approvals":
            ApprovalsScreen()
        case "home.subscription":
            SubscriptionScreen()
        default:
            if let item, NativePage.isNative(pageID: item.id) {
                NativePage.screen(pageID: item.id)
            } else {
                EmptyStateView(
                    icon: "square.grid.2x2",
                    title: "Выберите раздел",
                    message: "Слева — то, к чему у вас есть доступ."
                )
            }
        }
    }

    // ── Иконки ───────────────────────────────────────────────────────────────

    static func icon(forGroup id: String) -> String {
        switch id {
        case "finance": "chart.line.uptrend.xyaxis"
        case "inventory": "shippingbox"
        case "shifts": "clock"
        case "staff": "person.2"
        case "points": "building.2"
        case "pos": "creditcard"
        case "operations": "checklist"
        case "system": "gearshape"
        default: "square.grid.2x2"
        }
    }

    static func icon(forPage id: String) -> String {
        switch id {
        case "income": "arrow.down.circle"
        case "expenses", "expense-whitelist": "arrow.up.circle"
        case "expenses-pending": "clock.badge.exclamationmark"
        case "cashflow": "banknote"
        case "profitability", "valuation": "chart.pie"
        case "tax": "building.columns"
        case "salary", "salary-rules": "wallet.bifold"
        case "operators", "staff", "hr": "person.2"
        case "shifts", "shifts-reports": "calendar.badge.clock"
        case "tasks": "checklist"
        case "incidents": "exclamationmark.triangle"
        case "pos", "pos-receipts", "pos-returns": "creditcard"
        case "customers": "person.crop.circle"
        case "discounts": "tag"
        case "access": "lock.shield"
        case "settings": "gearshape"
        case "logs": "list.bullet.rectangle"
        case "dashboard": "square.grid.2x2"
        default:
            id.hasPrefix("store") ? "shippingbox" : "doc.text"
        }
    }
}

/// Список всех доступных разделов — то же, что боковая панель на iPad.
struct BusinessSectionsScreen: View {
    let resolver: AccessResolver

    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.lg) {
                ForEach(resolver.nativeGroups(), id: \.group.id) { group, pages in
                    Card {
                        VStack(spacing: Spacing.sm) {
                            HStack(spacing: Spacing.sm) {
                                Image(systemName: BusinessRootView.icon(forGroup: group.id))
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(Theme.brand)
                                Text(group.label)
                                    .font(Typography.label)
                                    .foregroundStyle(Theme.textDim)
                                    .textCase(.uppercase)
                                Spacer()
                                Text("\(pages.count)")
                                    .font(Typography.caption)
                                    .monospacedDigit()
                                    .foregroundStyle(Theme.textDim)
                            }

                            ForEach(Array(pages.enumerated()), id: \.element.id) { index, page in
                                if index > 0 { RowDivider() }
                                NavigationLink {
                                    NativePage.screen(pageID: page.id)
                                } label: {
                                    NavigationRow(
                                        icon: BusinessRootView.icon(forPage: page.id),
                                        iconColor: Theme.brand,
                                        title: page.label,
                                        subtitle: "\(resolver.availableActions(on: page).count) \(pluralize(resolver.availableActions(on: page).count, "действие", "действия", "действий"))"
                                    )
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }

                if resolver.nativeGroups().isEmpty {
                    EmptyStateView(
                        icon: "lock",
                        title: "Разделов нет",
                        message: "Вам пока не выдали доступ ни к одному разделу."
                    )
                }
            }
            .padding(Spacing.lg)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.background)
        .navigationTitle("Разделы")
        .toolbar { LogoutToolbarItem() }
    }
}

/// Профиль владельца или сотрудника.
struct BusinessProfileScreen: View {
    let resolver: AccessResolver

    @Environment(AuthStore.self) private var auth
    @State private var confirmingLogout = false

    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.lg) {
                Card {
                    HStack(spacing: Spacing.lg) {
                        Image(systemName: "person.crop.circle.fill")
                            .font(.system(size: 44))
                            .foregroundStyle(Theme.brand)
                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            Text(auth.role?.displayName ?? "Пользователь")
                                .font(Typography.title)
                                .foregroundStyle(Theme.text)
                            if let label = auth.role?.roleLabel {
                                Text(label)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.textMuted)
                            }
                        }
                        Spacer()
                    }
                }

                Card {
                    VStack(spacing: Spacing.md) {
                        Text("Доступ")
                            .font(Typography.label)
                            .foregroundStyle(Theme.textDim)
                            .textCase(.uppercase)
                            .frame(maxWidth: .infinity, alignment: .leading)

                        StatRow("Разделов открыто", value: "\(resolver.nativeGroups().count)")
                        StatRow("Страниц доступно", value: "\(resolver.nativeGroups().reduce(0) { $0 + $1.pages.count })")
                        if resolver.isAllAccess {
                            RowDivider()
                            StatusChip("полный доступ", kind: .info)
                        }
                    }
                }

                Button("Выйти из аккаунта") { confirmingLogout = true }
                    .buttonStyle(DestructiveButtonStyle())
            }
            .padding(Spacing.lg)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.background)
        .navigationTitle("Профиль")
        .confirmationDialog("Выйти из аккаунта?", isPresented: $confirmingLogout, titleVisibility: .visible) {
            Button("Выйти", role: .destructive) { Task { await auth.signOut() } }
            Button("Отмена", role: .cancel) {}
        }
    }
}
