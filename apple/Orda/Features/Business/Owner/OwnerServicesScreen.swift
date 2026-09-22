import OrdaKit
import OrdaUI
import SwiftUI

/// Раздел в плитке сервисов.
struct OwnerServiceItem: Identifiable, Hashable {
    let pageID: String
    let title: String
    let icon: String
    let tint: Color

    var id: String { pageID }
}

enum OwnerServices {
    /// Что владелец открывает чаще всего — на главную, в этом порядке.
    /// Берутся только выданные разделы; пусто — добираем из остальных.
    static let favoriteIDs = [
        "income", "expenses", "cashflow", "profitability",
        "store-warehouse", "salary", "shifts", "tasks",
        "reports", "operators", "point-debts", "store-catalog",
    ]

    static func all(resolver: AccessResolver) -> [(group: CapabilityGroup, items: [OwnerServiceItem])] {
        resolver.nativeGroups().map { group, pages in
            (group, pages.map { page in
                OwnerServiceItem(
                    pageID: page.id,
                    title: shortTitle(page.label),
                    icon: BusinessRootView.icon(forPage: page.id),
                    tint: OwnerTint.forGroup(group.id)
                )
            })
        }
    }

    static func favorites(resolver: AccessResolver, count: Int = 8) -> [OwnerServiceItem] {
        let every = all(resolver: resolver).flatMap(\.items)
        let byID = Dictionary(every.map { ($0.pageID, $0) }, uniquingKeysWith: { a, _ in a })
        var result = favoriteIDs.compactMap { byID[$0] }
        if result.count < count {
            result += every.filter { !result.contains($0) }.prefix(count - result.count)
        }
        return Array(result.prefix(count))
    }

    /// Названия из каталога прав бывают длинными — в плитку влезает два слова.
    static func shortTitle(_ label: String) -> String {
        let replacements = [
            "Рентабельность (ОПиУ)": "ОПиУ",
            "Денежные потоки": "Движение денег",
            "Ожидающие расходы": "На согласовании",
            "Доверенные поставщики": "Поставщики",
            "Еженедельный отчёт": "Отчёт недели",
        ]
        return replacements[label] ?? label
    }
}

/// Все сервисы плиткой по группам — вместо списка на восемьдесят строк.
struct OwnerServicesScreen: View {
    let resolver: AccessResolver

    @Environment(BusinessStore.self) private var business
    @State private var query = ""

    private var groups: [(group: CapabilityGroup, items: [OwnerServiceItem])] {
        let all = OwnerServices.all(resolver: resolver)
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !needle.isEmpty else { return all }
        return all.compactMap { group, items in
            let found = items.filter { $0.title.lowercased().contains(needle) }
            return found.isEmpty ? nil : (group, found)
        }
    }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: Spacing.lg) {
                let groups = groups
                if groups.isEmpty {
                    EmptyStateView(icon: "magnifyingglass", title: "Ничего не нашлось", message: "Попробуйте другое слово.")
                }
                ForEach(groups, id: \.group.id) { group, items in
                    OwnerSection(group.label) {
                        EmptyView()
                    } content: {
                        // По три в ряд: крупнее иконки и названия в две строки без переносов.
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: Spacing.md), count: 3), spacing: Spacing.xl) {
                            ForEach(items) { item in
                                NavigationLink(value: SectionRoute(pageID: item.pageID)) {
                                    ServiceTile(
                                        icon: item.icon,
                                        title: item.title,
                                        tint: item.tint,
                                        badge: item.pageID == "expenses-pending" ? business.pending.count : 0,
                                        size: 64
                                    )
                                }
                                .buttonStyle(.pressable)
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.bottom, Spacing.xxl)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.background)
        .navigationTitle("Сервисы")
        .searchable(text: $query, prompt: "Найти сервис")
        .navigationDestination(for: SectionRoute.self) { route in
            NativePage.screen(pageID: route.pageID)
        }
    }
}
