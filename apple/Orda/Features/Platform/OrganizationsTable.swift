import OrdaKit
import OrdaUI
import SwiftUI

/// Организации таблицей — для Mac и iPad в альбомной.
///
/// Суперадмин сравнивает клиентов между собой: у кого просрочен счёт, кто на
/// триале, где сколько точек. Карточки для этого плохи — глаз не может
/// сопоставить значения, лежащие в разных местах. Таблица ставит их в колонку,
/// и сравнение становится мгновенным.
///
/// Сортировка по любой колонке: «покажи всех с просроченными счетами» —
/// это один клик по заголовку, а не фильтр.
struct OrganizationsTable: View {
    let organizations: [Organization]
    @Binding var selection: Organization.ID?

    @State private var sortOrder = [KeyPathComparator(\Organization.name)]

    var body: some View {
        Table(sorted, selection: $selection, sortOrder: $sortOrder) {
            TableColumn("Организация", value: \.name) { organization in
                VStack(alignment: .leading, spacing: 2) {
                    Text(organization.name)
                        .font(Typography.callout.weight(.medium))
                        .foregroundStyle(Theme.text)
                    Text(organization.slug)
                        .font(Typography.caption)
                        .monospaced()
                        .foregroundStyle(Theme.textDim)
                }
                .padding(.vertical, 2)
            }
            .width(min: 180, ideal: 220)

            TableColumn("Статус", value: \.status) { organization in
                StatusChip(organization.statusLabel, kind: organization.isActive ? .good : .danger)
            }
            .width(min: 110, ideal: 130)

            TableColumn("Подписка") { organization in
                if let subscription = organization.subscription {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(subscription.planName ?? "—")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.text)
                        Text(subscription.statusLabel)
                            .font(Typography.caption)
                            .foregroundStyle(subscriptionColor(subscription.status))
                    }
                } else {
                    Text("нет").font(Typography.caption).foregroundStyle(Theme.textDim)
                }
            }
            .width(min: 110, ideal: 130)

            TableColumn("Точки", value: \.companyCount) { organization in
                Text("\(organization.companyCount) / \(organization.companyLimit)")
                    .font(Typography.caption)
                    .monospacedDigit()
                    .foregroundStyle(
                        organization.companyCount >= organization.companyLimit ? Theme.warning : Theme.textMuted
                    )
            }
            .width(min: 70, ideal: 84)

            TableColumn("Люди", value: \.memberCount) { organization in
                Text("\(organization.memberCount)")
                    .font(Typography.caption)
                    .monospacedDigit()
                    .foregroundStyle(Theme.textMuted)
            }
            .width(min: 60, ideal: 70)

            TableColumn("Счета") { organization in
                if organization.overdueInvoiceCount > 0 {
                    StatusChip("\(organization.overdueInvoiceCount) просрочен", kind: .danger)
                } else if organization.billingExempt {
                    Text("без биллинга")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                } else {
                    Text("в порядке")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.positive)
                }
            }
            .width(min: 120, ideal: 150)
        }
        .tableStyle(.inset)
        .background(Theme.background)
    }

    /// Сортировка применяется к копии: исходный порядок с сервера трогать
    /// незачем, а `Table` требует уже отсортированный массив.
    private var sorted: [Organization] {
        organizations.sorted(using: sortOrder)
    }

    private func subscriptionColor(_ status: String) -> Color {
        switch status {
        case "active": Theme.positive
        case "trialing": Theme.info
        case "past_due": Theme.negative
        default: Theme.textDim
        }
    }
}

/// Организации: таблица на широком экране, карточки на телефоне.
struct OrganizationsScreen: View {
    @Environment(PlatformStore.self) private var store
    @Environment(\.surface) private var surface

    @State private var selectedID: Organization.ID?

    var body: some View {
        @Bindable var bindable = store

        return Group {
            // Отказ загрузки раньше выглядел как «организаций нет» — то есть
            // как приглашение завести первую вместо сообщения о сбое.
            if let error = store.error, store.organizations.isEmpty {
                ErrorStateView(error: error) { Task { await store.load() } }
            } else if store.isLoading && store.organizations.isEmpty {
                LoadingRows(count: 6)
            } else if store.filteredOrganizations.isEmpty {
                WideEmptyState(
                    icon: "building.2",
                    title: store.search.isEmpty ? "Организаций нет" : "Ничего не найдено",
                    message: store.search.isEmpty
                        ? "Создайте первую организацию в веб-панели."
                        : "Попробуйте другой запрос."
                )
            } else if surface.isCompact {
                cardList
            } else {
                splitView
            }
        }
        .background(Theme.background)
        .navigationTitle("Организации")
        .navigationDestination(for: OrganizationRoute.self) { route in
            OrganizationDetailScreen(organization: route.organization)
        }
        .searchable(text: $bindable.search, prompt: "Название или поддомен")
        .toolbar { LogoutToolbarItem() }
        .task {
            if store.data == nil { await store.load() }
            if selectedID == nil { selectedID = store.filteredOrganizations.first?.id }
        }
        .refreshable { await store.load() }
    }

    /// Телефон: карточки с переходом — таблица в 375 точек нечитаема.
    private var cardList: some View {
        ScrollView {
            LazyVStack(spacing: Spacing.md) {
                ForEach(store.filteredOrganizations) { organization in
                    NavigationLink(value: OrganizationRoute(organization: organization)) {
                        OrganizationCard(organization: organization)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(Spacing.lg)
        }
    }

    /// Широкий экран: таблица сверху, карточка выбранной организации снизу.
    /// Так сравнение и работа с конкретным клиентом идут без переходов.
    private var splitView: some View {
        VSplitView {
            OrganizationsTable(organizations: store.filteredOrganizations, selection: $selectedID)
                // Высота под содержимое, а не половина окна: у клиента обычно
                // несколько организаций, и `Table` дорисовывала пустые строки
                // фоном — выглядело как оборванный список.
                .frame(height: tableHeight)

            Group {
                if let selected = store.organizations.first(where: { $0.id == selectedID }) {
                    OrganizationDetailScreen(organization: selected)
                } else {
                    WideEmptyState(
                        icon: "hand.point.up.left",
                        title: "Организация не выбрана",
                        message: "Нажмите строку в таблице выше."
                    )
                }
            }
            .frame(maxHeight: .infinity)
        }
        // Первая организация выбирается сама: пустая нижняя половина на полэкрана
        // ничего не сообщает, а карточка сразу показывает подписку и точки.
        .onChange(of: store.filteredOrganizations.map(\.id)) { _, ids in
            if selectedID == nil || !ids.contains(selectedID!) {
                selectedID = ids.first
            }
        }
    }

    /// Заголовок плюс строки, но не больше половины разумного окна.
    private var tableHeight: CGFloat {
        let rows = CGFloat(store.filteredOrganizations.count)
        return min(44 + rows * 46, 420)
    }
}

#if os(iOS)
/// На iOS вертикального разделителя нет — складываем в стек.
struct VSplitView<Content: View>: View {
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        VStack(spacing: 0) {
            content
        }
    }
}
#endif

/// Адрес карточки организации.
struct OrganizationRoute: Hashable {
    let organization: Organization
}
