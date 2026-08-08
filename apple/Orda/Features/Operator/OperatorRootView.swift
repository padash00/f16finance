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
    @State private var cabinet: CabinetStore?
    @State private var selection: OperatorSection? = .shift

    /// Разделы операторского контура.
    enum OperatorSection: String, CaseIterable, Identifiable, Hashable {
        case shift, sale, audit, tasks, checklists, knowledge, money, schedule, profile

        var id: String { rawValue }

        var title: String {
            switch self {
            case .shift: "Смена"
            case .sale: "Продажа"
            case .audit: "Ревизия"
            case .tasks: "Задачи"
            case .checklists: "Чек-листы"
            case .knowledge: "Знания"
            case .money: "Мои деньги"
            case .schedule: "График"
            case .profile: "Профиль"
            }
        }

        var icon: String {
            switch self {
            case .shift: "square.grid.2x2.fill"
            case .sale: "cart.fill"
            case .audit: "list.clipboard.fill"
            case .tasks: "checklist"
            case .checklists: "checkmark.seal"
            case .knowledge: "book.closed"
            case .money: "wallet.bifold"
            case .schedule: "calendar"
            case .profile: "person.crop.circle"
            }
        }

        /// Что видно в таб-баре телефона: пять пунктов, остальное — в профиле.
        static let phoneTabs: [OperatorSection] = [.shift, .sale, .audit, .tasks, .profile]

        /// Группировка боковой панели на большом экране.
        static let sidebarGroups: [(title: String, items: [OperatorSection])] = [
            ("Работа", [.shift, .sale, .audit]),
            ("Задачи", [.tasks, .checklists, .knowledge]),
            ("Личное", [.money, .schedule, .profile]),
        ]
    }

    var body: some View {
        SurfaceReader { surface in
            Group {
                if let store, let cabinet {
                    layout(surface: surface)
                        .environment(store)
                        .environment(cabinet)
                } else {
                    LaunchView(message: "Загружаем смену…")
                }
            }
        }
        .task {
            guard store == nil else { return }
            let operatorStore = OperatorStore(api: api)
            let cabinetStore = CabinetStore(api: api)
            store = operatorStore
            cabinet = cabinetStore

            async let shift: Void = operatorStore.bootstrap()
            async let overview: Void = cabinetStore.bootstrap()
            _ = await (shift, overview)

            await cabinetStore.loadKnowledge()
        }
    }

    @ViewBuilder
    private func layout(surface: Surface) -> some View {
        if surface.isCompact {
            phoneTabs
        } else {
            sidebarLayout
        }
    }

    // ── iPhone ───────────────────────────────────────────────────────────────

    private var phoneTabs: some View {
        TabView {
            ForEach(OperatorSection.phoneTabs) { section in
                NavigationStack { screen(for: section) }
                    .tabItem { Label(section.title, systemImage: section.icon) }
                    .badge(badge(for: section))
            }
        }
        .tint(Theme.accent(for: .operator))
    }

    // ── iPad и Mac ───────────────────────────────────────────────────────────

    private var sidebarLayout: some View {
        NavigationSplitView {
            List(selection: $selection) {
                ForEach(OperatorSection.sidebarGroups, id: \.title) { group in
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
                                            .foregroundStyle(Theme.accent(for: .operator))
                                    }
                                }
                            }
                        }
                    } header: {
                        Text(group.title)
                            .font(Typography.label)
                            .foregroundStyle(Theme.accent(for: .operator))
                    }
                }
            }
            .listStyle(.sidebar)
            .navigationTitle("Смена")
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
        case .audit: AuditScreen()
        case .tasks: TasksScreen()
        case .checklists: ChecklistsScreen()
        case .knowledge: KnowledgeScreen()
        case .money: MoneyScreen()
        case .schedule: ScheduleScreen()
        case .profile: OperatorProfileScreen()
        }
    }

    private func badge(for section: OperatorSection) -> Int {
        switch section {
        case .sale: store?.cartCount ?? 0
        case .tasks: cabinet?.activeTasks.count ?? 0
        case .knowledge, .profile: cabinet?.pendingArticles.count ?? 0
        case .checklists: store?.blockingChecklists.count ?? 0
        default: 0
        }
    }
}
