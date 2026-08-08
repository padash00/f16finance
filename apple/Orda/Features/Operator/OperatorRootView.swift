import OrdaKit
import OrdaUI
import SwiftUI

/// Рабочее пространство оператора.
///
/// Это не урезанный интерфейс владельца, а другой продукт. Оператор держит
/// телефон одной рукой, часто с товаром в другой, в полутьме и при очереди —
/// поэтому здесь крупные цели нажатия, минимум вложенности и главный экран,
/// целиком посвящённый смене.
///
/// Каталог прав к оператору не применяется: у него свой контур
/// `/api/operator/*`, а не `/api/admin/*`.
struct OperatorRootView: View {
    let resolver: AccessResolver

    @Environment(\.api) private var api
    @State private var store: OperatorStore?

    var body: some View {
        Group {
            if let store {
                tabs(store)
            } else {
                LaunchView(message: "Загружаем смену…")
            }
        }
        .task {
            guard store == nil else { return }
            let created = OperatorStore(api: api)
            store = created
            await created.bootstrap()
        }
    }

    private func tabs(_ store: OperatorStore) -> some View {
        TabView {
            NavigationStack { ShiftScreen() }
                .tabItem { Label("Смена", systemImage: "play.circle.fill") }

            NavigationStack { SaleScreen() }
                .tabItem { Label("Продажа", systemImage: "cart.fill") }
                .badge(store.cartCount)

            NavigationStack { AuditScreen() }
                .tabItem { Label("Ревизия", systemImage: "list.clipboard.fill") }

            NavigationStack { OperatorProfileView() }
                .tabItem { Label("Профиль", systemImage: "person.crop.circle") }
        }
        .tint(Theme.accent(for: .operator))
        .environment(store)
    }
}

/// Профиль оператора и выход.
struct OperatorProfileView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(OperatorStore.self) private var store

    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.lg) {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        Text(auth.role?.displayName ?? "Оператор")
                            .font(Typography.title)
                            .foregroundStyle(Theme.text)
                        if let label = auth.role?.roleLabel {
                            Text(label)
                                .font(Typography.callout)
                                .foregroundStyle(Theme.textMuted)
                        }
                    }
                }

                if store.queuedSalesCount > 0 {
                    Card(accent: Theme.warning) {
                        VStack(alignment: .leading, spacing: Spacing.md) {
                            Label(
                                "\(store.queuedSalesCount) неотправленных чеков",
                                systemImage: "arrow.triangle.2.circlepath"
                            )
                            .font(Typography.callout.weight(.semibold))
                            .foregroundStyle(Theme.warning)

                            Text("Продажи сохранены на устройстве. Они уйдут на сервер при связи — не удаляйте приложение.")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textMuted)

                            Button("Отправить сейчас") {
                                Task { await store.flushQueue() }
                            }
                            .buttonStyle(SecondaryButtonStyle())
                        }
                    }
                }

                Button("Выйти") {
                    Task { await auth.signOut() }
                }
                .buttonStyle(SecondaryButtonStyle())
            }
            .padding(Spacing.lg)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.background)
        .navigationTitle("Профиль")
    }
}
