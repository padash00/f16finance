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
    /// Возвращение в приложение — момент, когда права стоит перечитать: их
    /// могли выдать на сайте, пока телефон лежал в кармане.
    @Environment(\.scenePhase) private var scenePhase

    /// Доиграла ли заставка запуска. Пока нет — показываем её поверх всего,
    /// но восстановление сессии при этом уже идёт в фоне.
    ///
    /// Состояние живёт столько же, сколько процесс: возвращение из фона
    /// заставку не повторяет — она проигрывается один раз за запуск.
    @State private var introFinished = false
    /// Общее пространство геометрии заставки и шапки входа: по нему знак
    /// переезжает из центра экрана в шапку, оставаясь тем же объектом.
    @Namespace private var brand

    var body: some View {
        // Заставка — сосед интерфейса в `ZStack`, а не наложение поверх него.
        //
        // Разница не косметическая: интерфейс под ней меняет ветку, когда
        // сессия разбирается (`restoring` → `signedOut`), и наложение,
        // прикреплённое к меняющейся ветке, пересоздавалось вместе с ней. Со
        // сцены это выглядело как заставка, которая крутится по кругу и
        // никогда не заканчивается: её сценарий отменялся на середине и
        // начинался заново.
        ZStack {
            content
                // Нижняя граница размера текста, а не фиксированный размер:
                // более крупный системный шрифт настройка не отменяет.
                //
                // Два шага вверх, а не один: обычный системный размер —
                // «Large», и граница в «xLarge» давала прибавку, которой не
                // видно. Ради незаметного человек настройку не включает.
                .largeTypeIfEnabled()

            // Заставка лежит поверх готового интерфейса, а не вместо него:
            // экран под ней уже собран и уже тянет данные, поэтому к моменту
            // ухода заставки показывать нечего — всё на месте.
            if !introFinished {
                OrdaPointIntroView(
                    namespace: brand,
                    onFinish: { introFinished = true },
                    isReady: { auth.phase != .restoring && auth.phase != .loadingRole },
                    // Вошедшего не задерживаем ради бренда: он открыл
                    // программу работать, а не смотреть на знак.
                    goesToWorkspace: { auth.phase == .signedIn || auth.phase == .locked }
                )
                .transition(.opacity)
                // Страховка от застревания: что бы ни случилось со сценарием,
                // человек не должен остаться наедине с логотипом.
                .task {
                    try? await Task.sleep(for: .seconds(5))
                    introFinished = true
                }
            }
        }
        .animation(Motion.transition, value: introFinished)
    }

    @ViewBuilder
    private var content: some View {
        Group {
            switch auth.phase {
            case .restoring:
                Color.clear

            case .signedOut:
                LoginView(brandNamespace: brand, waitsForIntro: !introFinished)
                    .transition(.opacity.combined(with: .scale(scale: 0.98)))

            case .loadingRole:
                LaunchView(message: "Проверяем доступ…")

            case .locked:
                BiometricLockView()

            case .signedIn:
                workspace
                    .transition(.opacity)
                    .overlay(alignment: .top) { roleErrorBanner }
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
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                // Сессию могли не прочитать при фоновом запуске — связка
                // ключей была закрыта. Пробуем снова: человек уже разблокировал
                // телефон, иначе бы он сюда не смотрел.
                Task { await auth.restoreIfPossible() }
                Task { await auth.refreshRoleIfStale() }
                // Заодно перерегистрируем устройство для уведомлений: адрес у
                // Apple меняется — после переустановки, восстановления из
                // копии, обновления системы. Спрашивать его только при первом
                // разрешении значит однажды остаться без уведомлений и не
                // узнать об этом.
                Task { await PushManager.shared.refreshStatus() }
            case .background:
                // Запираем при уходе в фон, а не при `.inactive`: последнее
                // случается и от шторки уведомлений, и от звонка — замок
                // срабатывал бы десятки раз за день ни за чем.
                auth.lock()
            default:
                break
            }
        }
    }

    /// Ошибка прав поверх работающего интерфейса.
    ///
    /// Раньше неудачная загрузка подменяла весь экран. Но если права уже
    /// загружены, работать можно — сообщение должно мешать, а не блокировать.
    @ViewBuilder
    private var roleErrorBanner: some View {
        if let message = auth.roleError, auth.resolver != nil {
            HStack(spacing: Spacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                Text(message)
                    .font(Typography.caption.weight(.medium))
                    .lineLimit(2)
                Spacer(minLength: Spacing.sm)
                Button("Понятно") { auth.dismissRoleError() }
                    .buttonStyle(.plain)
                    .font(Typography.caption.weight(.bold))
            }
            .foregroundStyle(Color.black.opacity(0.85))
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.sm)
            .frame(maxWidth: 560)
            .background(Theme.warning, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
            .padding(Spacing.md)
            .transition(.move(edge: .top).combined(with: .opacity))
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
                OrdaPointSymbol()
                    .frame(width: 64, height: 64)
                    .scaleEffect(appeared ? 1 : 0.85)
                    .opacity(appeared ? 1 : 0)

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
                message: auth.roleError ?? "Проверьте связь и попробуйте ещё раз.",
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

/// Крупный шрифт за стойкой.
///
/// Отдельным модификатором, а не строкой в корне: листы («Аккаунт», формы
/// ввода) показываются своим контроллером и настройку из корня не наследуют.
/// Человек переключал её в «Аккаунте», вокруг ничего не менялось — и настройка
/// выглядела мёртвой, хотя на экранах под листом уже работала.
private struct LargeTypeModifier: ViewModifier {
    @AppStorage(LargeType.storageKey) private var largeType = false

    func body(content: Content) -> some View {
        // Нижняя граница размера, а не фиксированный размер: более крупный
        // системный шрифт настройка не отменяет. Два шага вверх, а не один:
        // обычный системный размер — «Large», и прибавки в один шаг не видно.
        content.dynamicTypeSize(largeType ? .xxLarge... : .xSmall...)
    }
}

extension View {
    /// Поднять размер текста, если включён крупный шрифт.
    func largeTypeIfEnabled() -> some View {
        modifier(LargeTypeModifier())
    }
}
