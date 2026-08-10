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
    /// Возврат в приложение — момент обновить сводку: экран мог пролежать
    /// открытым час, а смена за это время закрылась.
    @Environment(\.scenePhase) private var scenePhase
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
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active, let store else { return }
            Task { await store.bootstrap() }
        }
        // Нажали на уведомление — открываем тот раздел, о котором оно было.
        // Если права на него нет, ничего не делаем: уведомление могло прийти
        // раньше, чем доступ отобрали.
        .onChange(of: PushManager.shared.pendingRoute) { _, route in
            guard let route else { return }
            PushManager.shared.pendingRoute = nil
            openIfAllowed(pageID: route.pageID)
        }
        #if os(iOS)
        // Меню иконки собирается по правам — и пересобирается, когда права
        // меняются: список должен таять и расти вместе с доступом, а не
        // застывать таким, каким был в день установки.
        .task(id: resolver.session.capabilities) {
            QuickActions.refresh(for: resolver)
            if let pending = QuickActions.take() {
                openIfAllowed(pageID: pending.pageID)
            }
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active, let pending = QuickActions.take() else { return }
            openIfAllowed(pageID: pending.pageID)
        }
        #endif
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

    /// Вкладки — то же правило, что и в боковом меню: только выданное.
    ///
    /// «Разделы» и «Профиль» остаются всегда: первое — навигация по тому же
    /// выданному списку, второе — сам человек и выход. Это не бизнес-страницы,
    /// правами они не закрываются ни на сайте, ни здесь.
    private var phoneTabs: some View {
        TabView {
            if resolver.can("dashboard.view") {
                NavigationStack { BusinessDashboardScreen(resolver: resolver) }
                    .tabItem { Label("Обзор", systemImage: "square.grid.2x2.fill") }
            }

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

    /// Меню — это ровно то, что выдано на `/access`, и ничего сверх того.
    ///
    /// Раньше здесь была своя группа «Главное»: «Обзор», «Деньги», «Решения»,
    /// «Подписка», «Бизнес-аналитика», «Календарь». Половина из них не
    /// существует в каталоге прав, то есть владелец не мог их ни выдать, ни
    /// отобрать, а «Деньги» и «Решения» вдобавок дублировали настоящие разделы
    /// каталога. Пункт, которого нет в `/access`, — обещание мимо той системы
    /// прав, которую владелец настраивает.
    ///
    /// Осталась только сводка, и та по праву `dashboard.view` — это настоящая
    /// страница каталога, её видно и на `/access`.
    private var sections: [WorkspaceSection] {
        var result: [WorkspaceSection] = []

        if resolver.can("dashboard.view") {
            result.append(
                WorkspaceSection(
                    id: "home",
                    title: "Главное",
                    icon: "square.grid.2x2",
                    items: [WorkspaceItem(id: "home.dashboard", title: "Обзор", icon: "chart.bar.fill")]
                )
            )
        }

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

    /// Перевести выбор на раздел, если он есть в меню.
    private func openIfAllowed(pageID: String) {
        for section in sections {
            if let item = section.items.first(where: { $0.id == pageID }) {
                selection = item
                return
            }
        }
    }

    @ViewBuilder
    private func destination(for item: WorkspaceItem?) -> some View {
        switch item?.id {
        case "home.dashboard":
            BusinessDashboardScreen(resolver: resolver)
        default:
            if let item, item.id.hasPrefix("native."),
               let section = NativeSection(rawValue: String(item.id.dropFirst("native.".count))) {
                NativePage.screen(section: section)
            } else if let item, NativePage.isNative(pageID: item.id) {
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

    /// Значок раздела.
    ///
    /// Своя иконка у каждого — не украшение. В боковой панели семьдесят
    /// пунктов, и пятьдесят восемь из них рисовались одним и тем же листом:
    /// глазу не за что зацепиться, и нужный раздел приходилось читать
    /// построчно. Значок ищут раньше, чем текст.
    static func icon(forPage id: String) -> String {
        switch id {
        // ── Деньги ───────────────────────────────────────────────────────────
        case "income": "arrow.down.circle"
        case "expenses": "arrow.up.circle"
        case "expense-whitelist": "checkmark.seal"
        case "expenses-pending": "clock.badge.exclamationmark"
        case "expense-analysis": "chart.bar.doc.horizontal"
        case "categories": "folder"
        case "cashflow": "banknote"
        case "profitability": "chart.pie"
        case "valuation": "building.2.crop.circle"
        case "simulation": "slider.horizontal.3"
        case "tax": "building.columns"
        case "point-debts": "creditcard.trianglebadge.exclamationmark"
        case "goals": "target"

        // ── Отчёты и аналитика ───────────────────────────────────────────────
        case "reports": "doc.richtext"
        case "analytics": "chart.xyaxis.line"
        case "weekly-report": "calendar.badge.checkmark"
        case "forecast": "chart.line.uptrend.xyaxis"
        case "analysis": "magnifyingglass.circle"
        case "ai-cfo": "brain.head.profile"
        case "team-analysis": "person.3.sequence"

        // ── Склад и магазин ──────────────────────────────────────────────────
        case "store": "storefront"
        case "store-warehouse": "shippingbox"
        case "store-showcase": "cabinet"
        case "store-catalog": "books.vertical"
        case "store-receipts": "arrow.down.doc"
        case "store-postings": "square.and.arrow.down"
        case "store-writeoffs": "trash"
        case "store-requests": "tray.and.arrow.down"
        case "store-requests-journal": "clock.arrow.circlepath"
        case "store-movements": "arrow.left.arrow.right"
        case "store-revisions": "checklist.checked"
        case "store-suppliers": "truck.box"
        case "store-billing": "doc.plaintext"
        case "store-purchase-plan": "cart.badge.plus"
        case "store-purchase-orders": "cart"
        case "store-consumables": "drop"
        case "store-analytics": "chart.bar"
        case "store-forecast": "chart.line.downtrend.xyaxis"
        case "store-advertising": "megaphone"
        case "store-settings": "gearshape.2"
        case "store-shifts": "clock.badge.checkmark"
        case "store-receipt-settings": "printer"
        case "production": "frying.pan"

        // ── Люди ─────────────────────────────────────────────────────────────
        case "operators": "person.2"
        case "staff": "person.text.rectangle"
        case "hr": "briefcase"
        case "structure": "chart.bar.doc.horizontal"
        case "salary": "wallet.bifold"
        case "salary-rules": "list.bullet.rectangle.portrait"
        case "pass": "key"
        case "performance": "speedometer"
        case "ratings": "star"
        case "operator-achievements": "rosette"
        case "birthdays": "gift"

        // ── Смены и операционка ──────────────────────────────────────────────
        case "shifts": "calendar.badge.clock"
        case "shifts-reports": "doc.badge.clock"
        case "tasks": "checklist"
        case "incidents": "exclamationmark.triangle"

        // ── Касса и клиенты ──────────────────────────────────────────────────
        case "pos", "pos-receipts": "creditcard"
        case "pos-returns": "arrow.uturn.backward.circle"
        case "customers": "person.crop.circle"
        case "discounts": "tag"

        // ── Точки и оборудование ─────────────────────────────────────────────
        case "point-devices": "desktopcomputer"
        case "stations": "gamecontroller"

        // ── Общение ──────────────────────────────────────────────────────────
        case "news": "newspaper"
        case "team-chat": "bubble.left.and.bubble.right"
        case "messages": "envelope"
        case "moderation": "shield.lefthalf.filled"
        case "telegram": "paperplane"

        // ── Системное ────────────────────────────────────────────────────────
        case "access": "lock.shield"
        case "settings": "gearshape"
        case "logs": "list.bullet.rectangle"
        case "debug": "stethoscope"
        case "knowledge-admin": "book"
        case "dashboard": "square.grid.2x2"

        default:
            // Сюда попадают только новые страницы каталога, для которых значок
            // ещё не подобрали. Раньше здесь оказывались почти все.
            id.hasPrefix("store") ? "shippingbox" : "doc.text"
        }
    }
}

/// Список всех доступных разделов — то же, что боковая панель на iPad.
struct BusinessSectionsScreen: View {
    let resolver: AccessResolver

    @Environment(AuthStore.self) private var auth

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
                        message: "Доступ пока не выдали. Потяните вниз — список обновится, когда его выдадут."
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
        // Права выдают на сайте, пока человек ждёт с телефоном в руках.
        // Потянуть список — самый очевидный способ спросить «ну что, дали?».
        .refreshable { await auth.reloadRole() }
    }
}

/// Профиль владельца или сотрудника.
struct BusinessProfileScreen: View {
    let resolver: AccessResolver

    @Environment(AuthStore.self) private var auth
    @State private var confirmingLogout = false
    @State private var isLockEnabled = false
    @State private var didLoadSettings = false
    @AppStorage(Appearance.storageKey) private var appearance: Appearance = .system

    /// Выбор оформления.
    ///
    /// Приложение и так следует за системной темой — этот переключатель нужен,
    /// чтобы её перебить: телефон уходит в тёмное по расписанию, а смотреть
    /// цифры кому-то удобнее на светлом.
    private var appearanceCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                FieldLabel("Оформление")
                Picker("Оформление", selection: $appearance) {
                    ForEach(Appearance.allCases) { option in
                        Label(option.title, systemImage: option.icon).tag(option)
                    }
                }
                .pickerStyle(.segmented)
            }
        }
    }

    /// Замок по биометрии. Из приложения видно зарплаты и логины всей
    /// команды — телефон, оставленный на стойке разблокированным, не должен
    /// давать к этому доступ. Но и запирать каждое переключение незачем,
    /// поэтому это настройка, а не правило.
    @ViewBuilder
    private var lockCard: some View {
        if Biometrics.isAvailable {
            Card {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    Toggle(isOn: $isLockEnabled) {
                        Label("Запрашивать \(Biometrics.displayName)", systemImage: Biometrics.iconName)
                            .font(Typography.callout)
                            .foregroundStyle(Theme.text)
                    }
                    Text("При возврате в приложение. Сессия при этом остаётся — заново входить не придётся.")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                }
            }
            .onChange(of: isLockEnabled) { _, value in
                auth.isLockEnabled = value
            }
        }
    }

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

                lockCard
                appearanceCard

                Button("Выйти из аккаунта") { confirmingLogout = true }
                    .buttonStyle(DestructiveButtonStyle())
            }
            .padding(Spacing.lg)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.background)
        .navigationTitle("Профиль")
        .task {
            guard !didLoadSettings else { return }
            didLoadSettings = true
            isLockEnabled = auth.isLockEnabled
        }
        .confirmationDialog("Выйти из аккаунта?", isPresented: $confirmingLogout, titleVisibility: .visible) {
            Button("Выйти", role: .destructive) { Task { await auth.signOut() } }
            Button("Отмена", role: .cancel) {}
        }
    }
}
