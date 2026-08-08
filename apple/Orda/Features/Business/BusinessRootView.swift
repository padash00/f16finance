import OrdaKit
import OrdaUI
import SwiftUI

/// Рабочее пространство владельца и сотрудника.
///
/// Меню здесь не задано в коде — оно **выводится из прав**. Причина в том, что
/// роли в системе динамические: владелец создаёт свои через `/access` и даёт
/// им любой набор из 397 прав. Захардкоженный «экран менеджера» разошёлся бы
/// с реальностью на первой же нестандартной роли.
struct BusinessRootView: View {
    let resolver: AccessResolver

    @Environment(AuthStore.self) private var auth
    @State private var selection: WorkspaceItem?

    var body: some View {
        AdaptiveWorkspace(
            sections: sections,
            accent: accent,
            title: auth.role?.roleLabel ?? "Orda",
            selection: $selection
        ) { item in
            destination(for: item)
        }
        .onAppear {
            // На широком экране пустая правая колонка выглядит поломкой —
            // открываем первый доступный раздел.
            if selection == nil { selection = sections.first?.items.first }
        }
    }

    private var accent: Color {
        resolver.workspace == .owner
            ? Theme.accent(for: .owner)
            : Theme.accent(for: .staff)
    }

    /// Разделы = группы каталога прав, в которых есть хоть одна видимая
    /// страница. Пустые группы не показываем вовсе.
    private var sections: [WorkspaceSection] {
        resolver.visibleGroups().map { group, pages in
            WorkspaceSection(
                id: group.id,
                title: group.label,
                icon: Self.icon(forGroup: group.id),
                items: pages.map { page in
                    WorkspaceItem(
                        id: page.id,
                        title: page.label,
                        icon: Self.icon(forPage: page.id)
                    )
                }
            )
        }
    }

    @ViewBuilder
    private func destination(for item: WorkspaceItem?) -> some View {
        if let item, let page = CapabilityCatalog.page(id: item.id) {
            PageScaffold(page: page, resolver: resolver)
        } else {
            EmptyStateView(
                icon: "square.grid.2x2",
                title: "Выберите раздел",
                message: "Слева — то, к чему у вас есть доступ."
            )
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

/// Каркас страницы раздела.
///
/// Показывает, какие действия доступны пользователю на этой странице — то
/// есть делает видимой работу резолвера прав. Содержательные экраны
/// подключаются сюда по одному, не меняя навигацию.
struct PageScaffold: View {
    let page: CapabilityPage
    let resolver: AccessResolver

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                SectionHeader(page.label, subtitle: page.path)

                let actions = resolver.availableActions(on: page)

                if actions.isEmpty {
                    EmptyStateView(
                        icon: "lock",
                        title: "Только просмотр",
                        message: "Действий на этой странице вам не выдано."
                    )
                } else {
                    Card {
                        VStack(alignment: .leading, spacing: Spacing.md) {
                            Text("Доступные действия")
                                .font(Typography.label)
                                .foregroundStyle(Theme.textDim)
                                .textCase(.uppercase)

                            ForEach(Array(actions.enumerated()), id: \.element.id) { index, action in
                                HStack(spacing: Spacing.md) {
                                    Image(systemName: action.severity == .high ? "exclamationmark.shield.fill" : "checkmark.circle")
                                        .foregroundStyle(action.severity == .high ? Theme.negative : Theme.positive)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(action.label)
                                            .font(Typography.body)
                                            .foregroundStyle(Theme.text)
                                        Text(action.id)
                                            .font(Typography.caption)
                                            .foregroundStyle(Theme.textDim)
                                            .monospaced()
                                    }
                                    Spacer()
                                }
                                .staggeredAppear(index: index)
                            }
                        }
                    }
                }

                // Явная отметка о незавершённости — чтобы каркас не выдавали
                // за готовый экран.
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
        .navigationTitle(page.label)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}
