import OrdaKit
import OrdaUI
import SwiftUI

/// Рабочее пространство оператора.
///
/// Это не урезанный интерфейс владельца, а другой продукт. Оператор держит
/// телефон одной рукой, часто с товаром в другой, в полутьме и при очереди —
/// поэтому крупные цели нажатия, минимум вложенности и главный экран, целиком
/// посвящённый смене.
///
/// Каталог прав к оператору не применяется: у него свой контур
/// `/api/operator/*`, а не `/api/admin/*`.
struct OperatorRootView: View {
    let resolver: AccessResolver

    @Environment(\.api) private var api
    @State private var store: OperatorStore?
    @State private var cabinet: CabinetStore?

    var body: some View {
        Group {
            if let store, let cabinet {
                tabs(store: store, cabinet: cabinet)
            } else {
                LaunchView(message: "Загружаем смену…")
            }
        }
        .task {
            guard store == nil else { return }
            let operatorStore = OperatorStore(api: api)
            let cabinetStore = CabinetStore(api: api)
            store = operatorStore
            cabinet = cabinetStore

            // Смена и обзор грузятся параллельно: экран не должен ждать,
            // пока отработает более медленный из двух запросов.
            async let shift: Void = operatorStore.bootstrap()
            async let overview: Void = cabinetStore.bootstrap()
            _ = await (shift, overview)

            // Чек-листы и знания нужны для блока «требует внимания» на главной.
            await cabinetStore.loadKnowledge()
        }
    }

    private func tabs(store: OperatorStore, cabinet: CabinetStore) -> some View {
        TabView {
            NavigationStack { OperatorHomeScreen() }
                .tabItem { Label("Смена", systemImage: "square.grid.2x2.fill") }

            NavigationStack { SaleScreen() }
                .tabItem { Label("Продажа", systemImage: "cart.fill") }
                .badge(store.cartCount)

            NavigationStack { AuditScreen() }
                .tabItem { Label("Ревизия", systemImage: "list.clipboard.fill") }

            NavigationStack { TasksScreen() }
                .tabItem { Label("Задачи", systemImage: "checklist") }
                .badge(cabinet.activeTasks.count)

            NavigationStack { OperatorProfileScreen() }
                .tabItem { Label("Профиль", systemImage: "person.crop.circle") }
                .badge(cabinet.pendingArticles.count)
        }
        .tint(Theme.accent(for: .operator))
        .environment(store)
        .environment(cabinet)
    }
}
