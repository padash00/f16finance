import OrdaKit
import OrdaUI
import SwiftUI

/// Рабочее пространство оператора.
///
/// Раскладка меняется не «по размеру экрана», а по способу работы:
///
/// • **iPhone** — таб-бар снизу под большой палец. Оператор держит телефон
///   одной рукой, часто с товаром в другой.
/// • **iPad** — боковая панель и две колонки: планшет лежит на стойке, и
///   переходы туда-обратно между списком и деталью только мешают.
/// • **Mac** — та же боковая панель, но плотнее: за компьютером сидят и
///   разбирают данные, а не пробивают чеки на бегу.
struct OperatorRootView: View {
    let resolver: AccessResolver

    @Environment(\.api) private var api
    @State private var store: OperatorStore?
    /// Зал живёт отдельным хранилищем: обратный отсчёт тикает каждую секунду,
    /// и пересобирать из-за него весь кабинет незачем.
    @State private var arena: ArenaStore?
    @State private var cabinet: CabinetStore?
    @State private var selection: OperatorSection? = .shift
    @Environment(\.scenePhase) private var scenePhase

    /// Разделы операторского контура.
    enum OperatorSection: String, CaseIterable, Identifiable, Hashable {
        case shift, sale, arena, audit, tasks, checklists, knowledge, chat, messages, money, schedule, profile

        var id: String { rawValue }

        var title: String {
            switch self {
            case .shift: "Смена"
            case .sale: "Продажа"
            case .arena: "Зал"
            case .audit: "Ревизия"
            case .tasks: "Задачи"
            case .checklists: "Чек-листы"
            case .knowledge: "Знания"
            case .chat: "Командный чат"
            case .messages: "Сообщения"
            case .money: "Мои деньги"
            case .schedule: "График"
            case .profile: "Профиль"
            }
        }

        /// Подпись в нижней панели. Там места на слово: «Командный чат» не
        /// влезает и обрезается многоточием.
        var tabTitle: String {
            switch self {
            case .chat: "Чат"
            default: title
            }
        }

        var icon: String {
            switch self {
            case .shift: "square.grid.2x2.fill"
            case .sale: "cart.fill"
            case .arena: "desktopcomputer"
            case .audit: "list.clipboard.fill"
            case .tasks: "checklist"
            case .checklists: "checkmark.seal"
            case .knowledge: "book.closed"
            case .chat: "bubble.left.and.bubble.right"
            case .messages: "envelope"
            case .money: "wallet.bifold"
            case .schedule: "calendar"
            case .profile: "person.crop.circle"
            }
        }

        /// Что видно в таб-баре телефона: пять пунктов, остальное — в профиле.
        /// Что видно в нижней панели.
        ///
        /// Панель не одинакова для всех: оператор компьютерного клуба не
        /// продаёт товар — он обслуживает гостей, и «Продажа» у него только
        /// занимает место. Ревизия ушла из панели у обоих: она нужна не каждый
        /// день и живёт в профиле.
        static func phoneTabs(sellsGoods: Bool, hasArena: Bool) -> [OperatorSection] {
            if sellsGoods { return [.shift, .sale, .chat, .tasks, .profile] }
            // У клуба место «Продажи» занимает зал: за прилавком оператор не
            // стоит, а по залу ходит всю смену.
            if hasArena { return [.shift, .arena, .chat, .tasks, .profile] }
            return [.shift, .chat, .knowledge, .tasks, .profile]
        }

        /// Группировка боковой панели на большом экране.
        /// Боковая панель планшета: места больше, но лишнего всё равно не
        /// показываем — продажа и ревизия у клуба ни к чему.
        static func sidebarGroups(sellsGoods: Bool, hasArena: Bool) -> [(title: String, items: [OperatorSection])] {
            [
                ("Работа", sellsGoods ? [.shift, .sale, .audit] : (hasArena ? [.shift, .arena] : [.shift])),
                ("Задачи", [.tasks, .checklists, .knowledge]),
                ("Общение", [.chat, .messages]),
                ("Личное", [.money, .schedule, .profile]),
            ]
        }
    }

    var body: some View {
        SurfaceReader { surface in
            Group {
                if let store, let cabinet, let arena {
                    layout(surface: surface)
                        .environment(store)
                        .environment(cabinet)
                        .environment(arena)
                        // Отложенное действие обязано сказать о себе. Иначе
                        // человек уходит со смены уверенным, что чек-лист
                        // засчитан, а он лежит на устройстве.
                        .overlay(alignment: .bottom) {
                            if let notice = cabinet.deferredNotice {
                                DeferredNoticeBanner(text: notice) {
                                    cabinet.deferredNotice = nil
                                }
                                .padding(.horizontal, Spacing.md)
                                .padding(.bottom, Spacing.xxl * 2)
                                .transition(.move(edge: .bottom).combined(with: .opacity))
                            }
                        }
                        .animation(Motion.transition, value: cabinet.deferredNotice)
                        // Действие легло в очередь — счётчики и карточка смены
                        // должны узнать об этом сразу, а не после отправки.
                        .task(id: cabinet.deferredNotice) {
                            guard cabinet.deferredNotice != nil else { return }
                            await store.refreshQueuedCounts()
                        }
                } else {
                    LaunchView(message: "Загружаем смену…")
                }
            }
        }
        .task {
            guard store == nil else { return }
            // Очередь отложенных действий одна на оба стора: файл на диске
            // общий, и две очереди поверх него затирали бы друг друга.
            let outbox = ActionOutbox(api: api)
            let operatorStore = OperatorStore(api: api, outbox: outbox)
            let cabinetStore = CabinetStore(api: api, outbox: outbox)
            store = operatorStore
            cabinet = cabinetStore
            let arenaStore = ArenaStore(service: OperatorService(api: api))
            // Зал сообщает свои цифры смене: карточку на экране блокировки
            // ведёт она, потому что знает, открыта ли смена и своя ли она.
            arenaStore.onHallChanged = { [weak operatorStore] hall in
                operatorStore?.updateHall(hall)
            }
            arena = arenaStore

            async let shift: Void = operatorStore.bootstrap()
            async let overview: Void = cabinetStore.bootstrap()
            _ = await (shift, overview)

            await cabinetStore.loadKnowledge()

            #if os(iOS)
            QuickActions.refreshForOperator(sellsGoods: sellsGoods)
            applyQuickAction()
            #endif
        }
        // Нажали на уведомление — открыть то, о чём оно было.
        //
        // У оператора этого не было вовсе: разбор нажатия жил только в
        // кабинете владельца, и человек с телефона попадал туда, где закрыл
        // приложение, и сам искал сообщение или задачу.
        .onChange(of: PushManager.shared.pendingRoute) { _, route in
            guard let route else { return }
            PushManager.shared.pendingRoute = nil
            switch route {
            case .directMessages: selection = .messages
            case .teamChat: selection = .chat
            case .tasks: selection = .tasks
            case .shifts: selection = .schedule
            case .news, .staff, .birthdays, .approvals:
                // Разделы владельца: у оператора их нет, и подменять их
                // случайным экраном хуже, чем оставить как есть.
                break
            }
        }
        #if os(iOS)
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            // Ниша точки могла загрузиться позже, чем собралось меню иконки.
            QuickActions.refreshForOperator(sellsGoods: sellsGoods)
            applyQuickAction()
            // Связь возвращается, пока приложение свёрнуто: в подвале телефон
            // ловит у входа. Очередь отправлялась только при запуске и по
            // кнопке — чек мог пролежать на устройстве всю смену.
            Task { await store?.flushQueue() }
            // Чек-листы, пройденные в подсобке: связь появляется, когда
            // человек возвращается к стойке и открывает приложение.
            Task { await cabinet?.flushChecklists() }
        }
        #endif
    }

    #if os(iOS)
    /// Открыть раздел, выбранный в меню иконки.
    ///
    /// Долгое нажатие на иконку — единственный способ попасть в кассу одним
    /// касанием: за стойкой очередь, и три перехода до «Продажи» человек
    /// проходит по сорок раз за смену.
    private func applyQuickAction() {
        guard let kind = QuickActions.takeOperator() else { return }
        switch kind {
        case .shift: selection = .shift
        case .sale: selection = .sale
        case .audit: selection = .audit
        }
    }
    #endif

    @ViewBuilder
    private func layout(surface: Surface) -> some View {
        if surface.isCompact {
            phoneTabs
        } else {
            sidebarLayout
        }
    }

    // ── iPhone ───────────────────────────────────────────────────────────────

    /// Торгует ли точка. Пока сводка не загрузилась — считаем, что да: убрать
    /// кассу у того, кто ею пользуется, хуже, чем на секунду показать лишнее.
    private var sellsGoods: Bool {
        cabinet?.overview?.points?.sellsGoods ?? true
    }

    /// Есть ли у точки зал. Ниша точки знает об этом раньше сервера зала:
    /// спрашивать «а есть ли проект» ради того, показывать ли вкладку, —
    /// лишний запрос у всех, включая магазины.
    private var hasArena: Bool {
        let industries = cabinet?.overview?.points?.industries ?? []
        return industries.contains("club") || industries.contains("ps_club")
    }

    private var phoneTabs: some View {
        TabView(selection: $selection) {
            ForEach(OperatorSection.phoneTabs(sellsGoods: sellsGoods, hasArena: hasArena)) { section in
                NavigationStack { screen(for: section) }
                    .tabItem { Label(section.tabTitle, systemImage: section.icon) }
                    .badge(badge(for: section))
                    .tag(Optional(section))
            }
        }
        .tint(Theme.accent(for: .operator))
    }

    // ── iPad и Mac ───────────────────────────────────────────────────────────

    private var sidebarLayout: some View {
        NavigationSplitView {
            List(selection: $selection) {
                ForEach(OperatorSection.sidebarGroups(sellsGoods: sellsGoods, hasArena: hasArena), id: \.title) { group in
                    Section {
                        ForEach(group.items) { section in
                            NavigationLink(value: section) {
                                HStack {
                                    Label(section.title, systemImage: section.icon)
                                    if badge(for: section) > 0 {
                                        Spacer()
                                        Text("\(badge(for: section))")
                                            .font(Typography.caption.weight(.bold))
                                            .monospacedDigit()
                                            .foregroundStyle(Theme.textDim)
                                    }
                                }
                            }
                        }
                    } header: {
                        // Заголовки секций — приглушённые: они разделяют, а не
                        // привлекают. Раньше были акцентными и спорили с
                        // выделенным пунктом.
                        Text(group.title)
                            .font(Typography.label)
                            .foregroundStyle(Theme.textDim)
                            .textCase(.uppercase)
                    }
                }
            }
            .listStyle(.sidebar)
            // Заголовок панели — имя приложения, а не раздела: раздел
            // «Смена» и так есть первым пунктом внутри.
            .navigationTitle("Orda")
            .navigationSplitViewColumnWidth(min: 200, ideal: 230, max: 300)
        } detail: {
            NavigationStack { screen(for: selection ?? .shift) }
        }
        .navigationSplitViewStyle(.balanced)
        .tint(Theme.accent(for: .operator))
    }

    // ── Общее ────────────────────────────────────────────────────────────────

    @ViewBuilder
    private func screen(for section: OperatorSection) -> some View {
        switch section {
        case .shift: OperatorHomeScreen()
        case .sale:
            // На широком экране касса другая: сетка товаров и постоянная
            // корзина. Список во всю ширину там оставляет полметра пустоты
            // между названием и кнопкой.
            SurfaceReader { surface in
                if surface.isCompact { SaleScreen() } else { SaleWideScreen() }
            }
        case .arena: ArenaScreen()
        case .audit: AuditScreen()
        case .tasks: TasksScreen()
        case .checklists: ChecklistsScreen()
        case .knowledge: KnowledgeScreen()
        // Те же экраны, что у владельца и сотрудников: чат один на всю
        // организацию, и отдельный «операторский» был бы вторым чатом,
        // в котором половина людей не сидит.
        case .chat: TeamChatScreen()
        case .messages: MessagesScreen()
        case .money: MoneyScreen()
        case .schedule: ScheduleScreen()
        case .profile: OperatorProfileScreen()
        }
    }

    private func badge(for section: OperatorSection) -> Int {
        switch section {
        case .sale: store?.cartCount ?? 0
        case .tasks: cabinet?.activeTasks.count ?? 0
        case .knowledge: cabinet?.pendingArticles.count ?? 0
        case .messages: cabinet?.unreadMessages ?? 0
        // В профиле живут и статьи, и переписка: значок собирает всё, до чего
        // с таб-бара иначе не докопаться.
        case .profile: (cabinet?.pendingArticles.count ?? 0) + (cabinet?.unreadMessages ?? 0)
        case .checklists: store?.blockingChecklists.count ?? 0
        default: 0
        }
    }
}

/// Полоса «сохранено на устройстве».
///
/// Не алерт: действие уже сделано, прерывать работу нечем. Показывается внизу
/// и уходит сама через несколько секунд — как уведомление о сохранении, а не
/// как ошибка.
private struct DeferredNoticeBanner: View {
    let text: String
    var onDismiss: () -> Void

    var body: some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: "arrow.triangle.2.circlepath")
                .foregroundStyle(Theme.warning)
            Text(text)
                .font(Typography.caption)
                .foregroundStyle(Theme.text)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: Spacing.xs)
        }
        .padding(Spacing.md)
        .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.lg, style: .continuous)
                .strokeBorder(Theme.warning.opacity(0.35), lineWidth: 1)
        }
        .shadow(color: .black.opacity(0.25), radius: 18, y: 8)
        .onTapGesture(perform: onDismiss)
        .task {
            try? await Task.sleep(for: .seconds(6))
            onDismiss()
        }
    }
}
