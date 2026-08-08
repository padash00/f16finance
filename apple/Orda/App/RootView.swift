import OrdaKit
import OrdaUI
import SwiftUI

/// Корень приложения: решает, какой интерфейс показать.
///
/// Ветвление идёт по `AccessResolver.workspace`, а не по флагам вида
/// `isOwner`. Роли в системе динамические — владелец создаёт свои через
/// `/access`, — поэтому единственный устойчивый признак это набор прав.
struct RootView: View {
    @Environment(AuthStore.self) private var auth

    /// Доиграла ли заставка запуска. Пока нет — показываем её поверх всего,
    /// но восстановление сессии при этом уже идёт в фоне.
    @State private var introFinished = false

    var body: some View {
        Group {
            switch auth.phase {
            case .restoring:
                LaunchAnimationView { introFinished = true }

            case .signedOut:
                if introFinished {
                    LoginView()
                        .transition(.opacity.combined(with: .scale(scale: 0.98)))
                } else {
                    LaunchAnimationView { introFinished = true }
                }

            case .loadingRole:
                LaunchView(message: "Проверяем доступ…")

            case .locked:
                BiometricLockView()

            case .signedIn:
                workspace
                    .transition(.opacity)
                    .task {
                        // Разрешение спрашиваем здесь, а не на экране входа:
                        // до входа человек не понимает, о чём его будут
                        // уведомлять, и почти всегда отказывает. Отказ в iOS
                        // необратим из приложения — второй попытки не будет.
                        await PushManager.shared.refreshStatus()
                        if PushManager.shared.status == .notRequested {
                            await PushManager.shared.request()
                        }
                    }
            }
        }
        .animation(Motion.transition, value: auth.phase)
        .background(Theme.background)
        .task {
            guard auth.phase == .restoring else { return }
            await auth.restore()
        }
    }

    @ViewBuilder
    private var workspace: some View {
        if let resolver = auth.resolver {
            switch resolver.workspace {
            case .platform:
                PlatformRootView(resolver: resolver)
            case .owner, .staff:
                BusinessRootView(resolver: resolver)
            case .operator:
                OperatorRootView(resolver: resolver)
            case .customer:
                NoAccessView(
                    title: "Клиентский кабинет",
                    message: "Гостевой раздел пока доступен только на сайте."
                )
            case .none:
                NoAccessView(
                    title: "Доступ не настроен",
                    message: "Ваша учётная запись есть, но прав пока нет. Попросите владельца открыть нужные разделы."
                )
            }
        } else {
            // Роль не загрузилась (обычно сеть). Даём повторить, не выкидывая
            // из аккаунта.
            RoleUnavailableView()
        }
    }
}

/// Экран запуска. Держится ровно столько, сколько идёт восстановление сессии.
struct LaunchView: View {
    var message: String?

    @State private var appeared = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()

            VStack(spacing: Spacing.xl) {
                Image(systemName: "cube.transparent.fill")
                    .font(.system(size: 56, weight: .light))
                    .foregroundStyle(Theme.brand)
                    .scaleEffect(appeared ? 1 : 0.85)
                    .opacity(appeared ? 1 : 0)
                    .shadow(color: Theme.brand.opacity(0.4), radius: appeared ? 24 : 0)

                if let message {
                    Text(message)
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textDim)
                        .opacity(appeared ? 1 : 0)
                }
            }
        }
        .onAppear {
            guard !reduceMotion else {
                appeared = true
                return
            }
            withAnimation(Motion.appear) { appeared = true }
        }
    }
}

/// Роль не загрузилась. Отдельный экран, а не молчаливый выброс на логин.
struct RoleUnavailableView: View {
    @Environment(AuthStore.self) private var auth

    var body: some View {
        VStack(spacing: Spacing.lg) {
            EmptyStateView(
                icon: "antenna.radiowaves.left.and.right.slash",
                title: "Не удалось получить доступы",
                message: "Проверьте связь и попробуйте ещё раз.",
                actionTitle: "Повторить"
            ) {
                Task { await auth.reloadRole() }
            }

            Button("Выйти из аккаунта") {
                Task { await auth.signOut() }
            }
            .buttonStyle(.plain)
            .font(Typography.callout)
            .foregroundStyle(Theme.negative)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background)
    }
}

/// Прав нет вовсе. Объясняем, а не показываем пустой таб-бар.
struct NoAccessView: View {
    let title: String
    let message: String

    @Environment(AuthStore.self) private var auth

    var body: some View {
        VStack(spacing: Spacing.lg) {
            EmptyStateView(icon: "lock.fill", title: title, message: message)

            if let name = auth.role?.displayName {
                Text("Вы вошли как \(name)")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
            }

            Button("Выйти") {
                Task { await auth.signOut() }
            }
            .buttonStyle(SecondaryButtonStyle())
            .frame(maxWidth: 220)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background)
    }
}
