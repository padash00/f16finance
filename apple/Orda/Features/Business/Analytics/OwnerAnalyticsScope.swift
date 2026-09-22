import OrdaKit
import OrdaUI
import SwiftUI

/// Кто видит кабинет владельца: те, кому открыты отчёты.
///
/// То же правило, что у сервера (`/api/admin/owner-analytics`): там не только
/// выручка, но и расходы с прибылью, а права на доходы для этого мало.
extension AccessResolver {
    var canSeeOwnerAnalytics: Bool {
        can("reports.view")
    }
}

/// Держит общий фильтр аналитики и отдаёт его всем вкладкам.
///
/// Хранилище пересоздаётся при смене организации: у суперадмина фильтр
/// «Арена за месяц» не должен переехать в чужую компанию, где такой точки нет.
struct OwnerAnalyticsScope<Content: View>: View {
    @ViewBuilder let content: () -> Content

    @Environment(\.api) private var api
    @Environment(AuthStore.self) private var auth
    @State private var store: AnalyticsStore?
    @State private var storeOrganization: String?

    var body: some View {
        Group {
            if let store {
                content().environment(store)
            } else {
                LaunchView(message: "Загружаем аналитику…")
            }
        }
        .task(id: auth.organizationID) {
            guard store == nil || storeOrganization != auth.organizationID else { return }
            storeOrganization = auth.organizationID
            store = AnalyticsStore(api: api, organizationID: auth.organizationID)
        }
    }
}
