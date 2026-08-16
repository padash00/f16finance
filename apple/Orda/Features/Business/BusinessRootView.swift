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
    /// Вкладка и путь внутри «Разделов». Нужны, чтобы открыть раздел извне:
    /// на телефоне выбор бокового меню ни на что не влияет — там вкладки.
    @State private var phoneTab: PhoneTab = .home
    @State private var sectionsPath: [SectionRoute] = []
    #endif

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
            // Раздел из аргумента запуска: так снимки экрана обходят разделы
            // без подтверждения «Открыть в приложении?», которое iOS показывает
            // на внешнюю ссылку.
            if let page = LaunchOptions.requestedPage { openIfAllowed(pageID: page) }
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active, let store else { return }
            Task { await store.bootstrap() }
        }
        // Ссылка вида orda://page/finance.income. Ею пользуются снимки экрана
        // для App Store и служебные переходы; для человека это тот же способ
        // попасть в раздел из письма или заметки.
        .onOpenURL { url in
            guard let pageID = DeepLink.pageID(from: url) else { return }
            openIfAllowed(pageID: pageID)
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
        TabView(selection: $phoneTab) {
            if resolver.can("dashboard.view") {
                NavigationStack { BusinessDashboardScreen(resolver: resolver) }
                    .tabItem { Label("Обзор", systemImage: "square.grid.2x2.fill") }
                    .tag(PhoneTab.home)
            }

            if resolver.can("expenses-pending.view") {
                NavigationStack { ApprovalsScreen() }
                    .tabItem { Label("Решения", systemImage: "checkmark.circle") }
                    .badge(store?.pending.count ?? 0)
                    .tag(PhoneTab.approvals)
            }

            NavigationStack(path: $sectionsPath) {
                BusinessSectionsScreen(resolver: resolver)
            }
            .tabItem { Label("Разделы", systemImage: "list.bullet") }
            .tag(PhoneTab.sections)

            NavigationStack { BusinessProfileScreen(resolver: resolver) }
                .tabItem { Label("Профиль", systemImage: "person.crop.circle") }
                .tag(PhoneTab.profile)
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
    ///
    /// Раздел открывают не только пальцем: по уведомлению, из быстрого действия
    /// на иконке, по ссылке `orda://page/<страница>`. На планшете это выбор в
    /// боковом меню, на телефоне — вкладка «Разделы» и переход внутри неё.
    private func openIfAllowed(pageID: String) {
        guard let item = sections.lazy.compactMap({ section in
            section.items.first { $0.id == pageID }
        }).first else { return }

        selection = item

        #if os(iOS)
        if item.id == "home.dashboard" {
            phoneTab = .home
            sectionsPath = []
        } else {
            phoneTab = .sections
            sectionsPath = [SectionRoute(pageID: item.id)]
        }
        #endif
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

#if os(iOS)
/// Вкладки телефона.
enum PhoneTab: Hashable {
    case home, approvals, sections, profile
}
#endif

/// Адрес раздела в списке «Разделы».
struct SectionRoute: Hashable {
    let pageID: String
}

/// Раздел, заданный при запуске: `Orda.app -ordaPage income`.
///
/// `UserDefaults` сам разбирает аргументы командной строки, поэтому отдельного
/// парсера не нужно.
enum LaunchOptions {
    static var requestedPage: String? {
        let value = UserDefaults.standard.string(forKey: "ordaPage")?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return value.isEmpty ? nil : value
    }
}

/// Разбор ссылок `orda://page/<страница>`.
///
/// Идентификатор страницы — из каталога прав (`finance.income`,
/// `native.stocktake`), тот же, что в уведомлениях и быстрых действиях.
enum DeepLink {
    static func pageID(from url: URL) -> String? {
        guard url.scheme == "orda", url.host == "page" else { return nil }
        let path = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        return path.isEmpty ? nil : path
    }
}

/// Список всех доступных разделов — то же, что боковая панель на iPad.
struct BusinessSectionsScreen: View {
    let resolver: AccessResolver

    @Environment(AuthStore.self) private var auth

    /// Поиск по разделам и действиям.
    ///
    /// Разделов под восемьдесят, и человек помнит не название страницы, а что
    /// хочет сделать: «списать», «пересчитать», «начислить». Поэтому ищем и по
    /// названиям разделов, и по названиям действий внутри них — «списание»
    /// приводит на склад, хотя такого раздела нет.
    @State private var query = ""

    /// Группы считаются один раз на построение экрана.
    ///
    /// `nativeGroups()` перебирает весь каталог — 82 страницы, — а вызывался он
    /// и в списке, и в проверке на пустоту, и заново при каждом обновлении
    /// экрана.
    private var groups: [(group: CapabilityGroup, pages: [CapabilityPage])] {
        resolver.nativeGroups()
    }

    /// Разделы, подходящие под запрос, с подсказкой — чем именно подошли.
    private func matches(in groups: [(group: CapabilityGroup, pages: [CapabilityPage])]) -> [(page: CapabilityPage, hint: String?)] {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !needle.isEmpty else { return [] }

        var found: [(page: CapabilityPage, hint: String?)] = []
        for (_, pages) in groups {
            for page in pages {
                if page.label.lowercased().contains(needle) {
                    found.append((page, nil))
                    continue
                }
                // Нашлось не название раздела, а действие внутри — покажем
                // какое: иначе непонятно, почему «Склад» в ответ на «списать».
                let action = resolver.availableActions(on: page)
                    .first { $0.label.lowercased().contains(needle) }
                if let action {
                    found.append((page, action.label))
                }
            }
        }
        return found
    }

    var body: some View {
        let groups = groups
        return ScrollView {
            // Лениво: разделов бывает под восемьдесят, и строить их все разом
            // ради первого экрана незачем.
            LazyVStack(spacing: Spacing.lg) {
                if !query.trimmingCharacters(in: .whitespaces).isEmpty {
                    let found = matches(in: groups)
                    if found.isEmpty {
                        EmptyStateView(
                            icon: "magnifyingglass",
                            title: "Ничего не нашлось",
                            message: "Поиск идёт по разделам и действиям внутри них — и только по тем, что вам открыты."
                        )
                    } else {
                        Card {
                            VStack(spacing: Spacing.sm) {
                                ForEach(Array(found.enumerated()), id: \.element.page.id) { index, item in
                                    if index > 0 { RowDivider() }
                                    NavigationLink(value: SectionRoute(pageID: item.page.id)) {
                                        NavigationRow(
                                            icon: BusinessRootView.icon(forPage: item.page.id),
                                            iconColor: Theme.brand,
                                            title: item.page.label,
                                            subtitle: item.hint
                                        )
                                    }
                                    .buttonStyle(.pressable)
                                }
                            }
                        }
                    }
                } else {
                ForEach(groups, id: \.group.id) { group, pages in
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
                                // Каскад по строкам группы: восемьдесят
                                // пунктов, возникающих разом, читаются как
                                // вспышка.
                                Group {
                                NavigationLink(value: SectionRoute(pageID: page.id)) {
                                    NavigationRow(
                                        icon: BusinessRootView.icon(forPage: page.id),
                                        iconColor: Theme.brand,
                                        title: page.label,
                                        subtitle: "\(resolver.availableActions(on: page).count) \(pluralize(resolver.availableActions(on: page).count, "действие", "действия", "действий"))"
                                    )
                                }
                                .buttonStyle(.pressable)
                                }
                                .staggeredAppear(index: index)
                            }
                        }
                    }
                }

                if groups.isEmpty {
                    EmptyStateView(
                        icon: "lock",
                        title: "Разделов нет",
                        message: "Доступ пока не выдали. Потяните вниз — список обновится, когда его выдадут."
                    )
                }
                }
            }
            .padding(Spacing.lg)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.background)
        // По значению, а не по замыканию: только так на раздел можно перейти
        // извне — из уведомления, из быстрого действия иконки, по ссылке.
        // Свой тип маршрута, а не голая строка: внутри этого же стека
        // открываются экраны с `MasterDetail`, и второй
        // `navigationDestination(for: String.self)` заставлял SwiftUI выбирать
        // не тот адрес.
        .navigationDestination(for: SectionRoute.self) { route in
            NativePage.screen(pageID: route.pageID)
        }
        .navigationTitle("Разделы")
        .searchable(text: $query, prompt: "Раздел или действие")
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

                AppearancePicker()
                BiometricLockToggle()

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
