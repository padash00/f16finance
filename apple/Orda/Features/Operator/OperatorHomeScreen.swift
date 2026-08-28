import OrdaKit
import OrdaUI
import SwiftUI

/// Главный экран оператора — дашборд смены.
///
/// Порядок блоков задан тем, что нужно человеку за стойкой: сначала состояние
/// смены и выручка, потом быстрые действия, потом всё, что «требует меня»,
/// и только затем справочное.
/// Куда ведут плитки быстрых действий.
///
/// По значению, а не замыканием: экран смены обновляется сам — приходят чеки,
/// меняется выручка, — и переход, созданный замыканием, схлопывался вместе с
/// пересборкой экрана.
enum OperatorHomeRoute: Hashable {
    case sale, audit, checklists, knowledge, tasks, money
}

struct OperatorHomeScreen: View {
    @Environment(OperatorStore.self) private var store
    @Environment(CabinetStore.self) private var cabinet
    @Environment(AuthStore.self) private var auth

    @Environment(\.surface) private var surface

    @State private var showOpenSheet = false
    @State private var showCloseSheet = false

    var body: some View {
        ScreenScroll {
            // Баннер офлайна и состояние смены — всегда во всю ширину: это
            // не «одна из карточек», а заголовок экрана.
            if store.queuedSalesCount > 0 { offlineBanner }
            shiftCard

            // Две осмысленные колонки вместо потока: слева ход смены,
            // справа то, что требует решения и денег. Поток из карточек
            // разной высоты давал рваный край и пустые колонки.
            // Две колонки — только когда левой есть что показать. График
            // выручки и разбивка по оплатам это деньги смены, и на чужой смене
            // их видеть нечего. Без них левая колонка оставалась пустой
            // половиной экрана, а карточки жались к правому краю.
            if store.isMyShift {
                SplitDashboard {
                    revenueChart
                    paymentSplit
                } side: {
                    sideCards
                }
            } else {
                DashboardGrid { sideCards }
            }

            // Быстрые действия внизу на большом экране: там есть боковая
            // панель, и дублировать её плитками сверху незачем.
            if surface.isCompact { quickActions }
        }
        .navigationTitle(greeting)
        .navigationDestination(for: OperatorHomeRoute.self) { route in
            switch route {
            case .sale: SaleScreen()
            case .audit: AuditScreen()
            case .checklists: ChecklistsScreen()
            case .knowledge: KnowledgeScreen()
            case .tasks: TasksScreen()
            case .money: MoneyScreen()
            }
        }
        #if os(iOS)
        .navigationBarTitleDisplayMode(.large)
        #endif
        .toolbar { LogoutToolbarItem() }
        .refreshable {
            await store.loadShift()
            await cabinet.loadOverview()
            await cabinet.loadTasks()
            // Каталог нужен только кассе: у клуба его незачем даже тянуть.
            if store.hasOpenShift, sellsGoods { await store.loadCatalog() }
        }
        .sheet(isPresented: $showOpenSheet) { OpenShiftSheet() }
        .sheet(isPresented: $showCloseSheet) { CloseShiftSheet() }
        .task {
            if store.hasOpenShift, sellsGoods, store.recentSales.isEmpty { await store.loadCatalog() }
        }
        // Сводку кабинета догоняет этот экран, саму смену — хранилище: её
        // состояние нужно на всех вкладках, а не только здесь.
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                if Task.isCancelled { break }
                await cabinet.loadOverview()
            }
        }
    }

    /// То, что требует внимания, и деньги недели.
    @ViewBuilder
    private var sideCards: some View {
        if needsAttention { attentionSection }
        weekCard
        if let next = cabinet.overview?.nextShift, !store.hasOpenShift {
            nextShiftCard(next)
        }
    }

    private var greeting: String {
        let name = cabinet.overview?.operatorName ?? auth.role?.displayName ?? "Смена"
        return name
    }

    // ── Смена ────────────────────────────────────────────────────────────────

    @ViewBuilder
    private var shiftCard: some View {
        if store.isLoadingShift && store.shiftState == nil {
            Skeleton(height: 150, cornerRadius: Radius.lg)
        } else if store.isSomeoneElsesShift {
            // Чужая смена: имя того, кто стоит, и ничего больше. Раньше здесь
            // была выручка сменщика и кнопка «Закрыть смену» — оператор со
            // своего телефона видел чужие деньги и мог попробовать закрыть
            // смену, стоя дома.
            Card(accent: Theme.info) {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    StatusChip("на смене другой", kind: .info)
                    Text(store.shift?.operatorName ?? "Сменщик")
                        .font(Typography.metric)
                        .foregroundStyle(Theme.text)
                    if let opened = store.shift?.openedAt {
                        Text("на смене \(elapsed(since: opened))")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                    }
                    Text("Выручку и закрытие смены видит тот, кто её открыл.")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textMuted)
                }
            }
        } else if store.hasOpenShift {
            Card(accent: Theme.positive) {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    HStack {
                        StatusChip("смена открыта", kind: .good)
                        Spacer()
                        if let opened = store.shift?.openedAt {
                            Text(elapsed(since: opened))
                                .font(Typography.caption.weight(.semibold))
                                .monospacedDigit()
                                .foregroundStyle(Theme.textDim)
                        }
                    }

                    Text(Money.format(store.totals.netTotal))
                        .font(Typography.monospacedDigits(Typography.hero))
                        .foregroundStyle(Theme.text)
                        .contentTransition(.numericText())
                        .animation(Motion.value, value: store.totals.netTotal)
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)

                    Text("выручка смены · \(store.totals.salesCount) \(pluralize(store.totals.salesCount, "чек", "чека", "чеков"))")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)

                    Button("Закрыть смену") { showCloseSheet = true }
                        .buttonStyle(SecondaryButtonStyle())
                        .padding(.top, Spacing.xs)
                }
            }
        } else {
            Card(accent: Theme.accent(for: .operator)) {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    StatusChip("смена закрыта", kind: .neutral)

                    Text("Начните смену")
                        .font(Typography.metric)
                        .foregroundStyle(Theme.text)

                    Text("Пока смена не открыта, продавать нельзя. Открытие проверит, стоите ли вы сегодня в графике.")
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textMuted)

                    Button("Открыть смену") { showOpenSheet = true }
                        .buttonStyle(PrimaryButtonStyle(tint: Theme.accent(for: .operator)))
                }
            }
        }
    }

    // ── Выручка ──────────────────────────────────────────────────────────────

    private var revenueChart: some View {
        TrendChart(
            title: "Выручка по чекам",
            subtitle: "последние продажи смены",
            points: revenuePoints,
            color: ChartPalette.series1
        )
    }

    /// Накопленная выручка по времени чеков — видно темп смены, а не отдельные
    /// суммы. Сервер отдаёт последние 20 продаж в обратном порядке.
    private var revenuePoints: [TimePoint] {
        let sales = store.recentSales
            .compactMap { sale -> (Date, Double)? in
                guard let at = sale.soldAt else { return nil }
                return (at, sale.totalAmount)
            }
            .sorted { $0.0 < $1.0 }

        var running = 0.0
        return sales.map { at, amount in
            running += amount
            return TimePoint(label: Self.timeFormatter.string(from: at), date: at, value: running)
        }
    }

    private var paymentSplit: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                Text("Чем платили")
                    .font(Typography.label)
                    .foregroundStyle(Theme.textDim)
                    .textCase(.uppercase)

                SplitBar(segments: [
                    .init(label: "Наличные", value: store.totals.expectedCash, color: ChartPalette.series1),
                    .init(label: "Kaspi", value: store.totals.expectedKaspi, color: ChartPalette.series2),
                ])

                if store.totals.returnsCount > 0 {
                    RowDivider()
                    StatRow(
                        "Возвраты",
                        value: "\(store.totals.returnsCount) · \(Money.format(store.totals.returnsTotal))",
                        valueColor: Theme.warning,
                        icon: "arrow.uturn.backward"
                    )
                }
            }
        }
    }

    // ── Быстрые действия ─────────────────────────────────────────────────────

    /// Плитки быстрых действий.
    ///
    /// Продажа и ревизия — работа магазина. Оператору клуба они не нужны: он
    /// обслуживает гостей за компьютерами, и вместо кассы ему полезнее
    /// регламенты и чат.
    private var quickActions: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: Spacing.md) {
            if sellsGoods {
                NavigationLink(value: OperatorHomeRoute.sale) {
                    ActionTileLabel(icon: "barcode.viewfinder", title: "Продать", tint: Theme.accent(for: .operator))
                }
                .buttonStyle(PressableTileStyle())

                NavigationLink(value: OperatorHomeRoute.audit) {
                    ActionTileLabel(icon: "list.clipboard", title: "Ревизия", tint: ChartPalette.series2)
                }
                .buttonStyle(PressableTileStyle())
            } else {
                NavigationLink(value: OperatorHomeRoute.knowledge) {
                    ActionTileLabel(icon: "book.closed", title: "Регламенты", tint: ChartPalette.series2)
                }
                .buttonStyle(PressableTileStyle())

                NavigationLink(value: OperatorHomeRoute.tasks) {
                    ActionTileLabel(icon: "checklist", title: "Задачи", tint: Theme.accent(for: .operator))
                }
                .buttonStyle(PressableTileStyle())
            }

            NavigationLink(value: OperatorHomeRoute.checklists) {
                ActionTileLabel(icon: "checklist", title: "Чек-листы", tint: ChartPalette.series3)
            }
            .buttonStyle(PressableTileStyle())
        }
    }

    /// Торгует ли точка. Пока сводка не пришла — считаем, что да.
    private var sellsGoods: Bool {
        cabinet.overview?.points?.sellsGoods ?? true
    }

    // ── Требует внимания ─────────────────────────────────────────────────────

    private var needsAttention: Bool {
        !store.blockingChecklists.isEmpty
            || !cabinet.pendingArticles.isEmpty
            || cabinet.overdueCount > 0
            || (cabinet.overview?.counters?.activeDebts ?? 0) > 0
    }

    /// Что требует внимания.
    ///
    /// Пункты разделены линиями: без них четыре строки с иконками и значками
    /// сливаются в сплошную стену, и понять, где кончается одна и начинается
    /// другая, можно только по цвету значка.
    private var attentionSection: some View {
        Card(accent: Theme.warning) {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Text("Требует внимания")
                    .font(Typography.label)
                    .foregroundStyle(Theme.warning)
                    .textCase(.uppercase)
                    .padding(.bottom, Spacing.xs)

                if !store.blockingChecklists.isEmpty {
                    NavigationLink(value: OperatorHomeRoute.checklists) {
                        NavigationRow(
                            icon: "checklist.unchecked",
                            iconColor: Theme.warning,
                            title: "Обязательные чек-листы",
                            subtitle: "без них смену не закрыть",
                            badge: store.blockingChecklists.count,
                            badgeColor: Theme.warning
                        )
                    }
                    .buttonStyle(.pressable)
                }

                if !cabinet.pendingArticles.isEmpty {
                    if !store.blockingChecklists.isEmpty { RowDivider() }
                    NavigationLink(value: OperatorHomeRoute.knowledge) {
                        NavigationRow(
                            icon: "book.closed",
                            iconColor: Theme.info,
                            title: "Подтвердить прочтение",
                            subtitle: "новые правила в базе знаний",
                            badge: cabinet.pendingArticles.count,
                            badgeColor: Theme.info
                        )
                    }
                    .buttonStyle(.pressable)
                }

                if cabinet.overdueCount > 0 {
                    if !store.blockingChecklists.isEmpty || !cabinet.pendingArticles.isEmpty { RowDivider() }
                    NavigationLink(value: OperatorHomeRoute.tasks) {
                        NavigationRow(
                            icon: "clock.badge.exclamationmark",
                            iconColor: Theme.negative,
                            title: "Просроченные задачи",
                            badge: cabinet.overdueCount
                        )
                    }
                    .buttonStyle(.pressable)
                }

                if let counters = cabinet.overview?.counters, counters.activeDebts > 0 {
                    if !store.blockingChecklists.isEmpty || !cabinet.pendingArticles.isEmpty || cabinet.overdueCount > 0 {
                        RowDivider()
                    }
                    NavigationLink(value: OperatorHomeRoute.money) {
                        NavigationRow(
                            icon: "creditcard.trianglebadge.exclamationmark",
                            iconColor: Theme.negative,
                            title: "Долг перед точкой",
                            subtitle: Money.format(counters.activeDebtAmount),
                            badge: counters.activeDebts
                        )
                    }
                    .buttonStyle(.pressable)
                }
            }
        }
    }

    // ── Неделя ───────────────────────────────────────────────────────────────

    @ViewBuilder
    private var weekCard: some View {
        if let week = cabinet.overview?.week {
            NavigationLink(value: OperatorHomeRoute.money) {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        HStack {
                            Text("Заработано за неделю")
                                .font(Typography.label)
                                .foregroundStyle(Theme.textDim)
                                .textCase(.uppercase)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(Theme.textDim)
                        }

                        Text(Money.format(week.netAmount))
                            .font(Typography.monospacedDigits(Typography.metric))
                            .foregroundStyle(Theme.text)
                            .contentTransition(.numericText())

                        HStack(spacing: Spacing.sm) {
                            StatusChip(week.statusLabel, kind: week.status == "paid" ? .good : .neutral)
                            // Остаток показываем, только если часть уже
                            // выплачена. Пока не платили, «к выплате» равно
                            // заработанному — и рядом стояли две одинаковые по
                            // смыслу суммы, которые читались как расхождение.
                            if week.paidAmount > 0, week.remainingAmount > 0 {
                                Text("осталось \(Money.format(week.remainingAmount))")
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.textDim)
                            }
                        }
                    }
                }
            }
            .buttonStyle(.pressable)
        } else if cabinet.isLoadingOverview {
            Skeleton(height: 110, cornerRadius: Radius.lg)
        }
    }

    private func nextShiftCard(_ next: NextShift) -> some View {
        Card(accent: ChartPalette.series2) {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Text("Ближайшая смена")
                    .font(Typography.label)
                    .foregroundStyle(Theme.textDim)
                    .textCase(.uppercase)
                Text(next.label ?? next.date)
                    .font(Typography.title)
                    .foregroundStyle(Theme.text)
            }
        }
    }

    // ── Офлайн ───────────────────────────────────────────────────────────────

    private var offlineBanner: some View {
        Card(accent: Theme.warning) {
            HStack(spacing: Spacing.md) {
                Image(systemName: "arrow.triangle.2.circlepath")
                    .foregroundStyle(Theme.warning)
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(store.queuedSalesCount) \(pluralize(store.queuedSalesCount, "чек", "чека", "чеков")) ждёт отправки")
                        .font(Typography.callout.weight(.semibold))
                        .foregroundStyle(Theme.text)
                    Text("Продажи сохранены на устройстве.")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                }
                Spacer()
                Button("Отправить") { Task { await store.flushQueue() } }
                    .buttonStyle(.pressable)
                    .font(Typography.caption.weight(.bold))
                    .foregroundStyle(Theme.warning)
            }
        }
    }

    // ── Вспомогательное ──────────────────────────────────────────────────────

    private static let timeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        return f
    }()

    private func elapsed(since date: Date) -> String {
        let seconds = Int(Date().timeIntervalSince(date))
        let hours = seconds / 3600
        let minutes = (seconds % 3600) / 60
        return hours > 0 ? "\(hours) ч \(minutes) мин" : "\(minutes) мин"
    }
}

/// Оформление плитки быстрого действия внутри NavigationLink.
struct ActionTileLabel: View {
    let icon: String
    let title: String
    let tint: Color

    var body: some View {
        VStack(spacing: Spacing.sm) {
            Image(systemName: icon)
                .font(.system(size: 20, weight: .medium))
                .foregroundStyle(tint)
            Text(title)
                .font(Typography.caption.weight(.medium))
                .foregroundStyle(Theme.text)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Spacing.lg)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.lg, style: .continuous)
                .strokeBorder(tint.opacity(0.2), lineWidth: 1)
        }
    }
}

/// Кнопка выхода в панели навигации — одна на все экраны.
struct LogoutToolbarItem: ToolbarContent {
    @Environment(AuthStore.self) private var auth
    @State private var confirming = false
    @State private var showingAccount = false

    var body: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            Menu {
                // Настройки живут здесь, а не только во вкладке «Профиль»:
                // вкладка есть лишь на телефоне, и на планшете с Mac до
                // оформления и замка было не добраться вовсе.
                Button {
                    showingAccount = true
                } label: {
                    Label("Настройки аккаунта", systemImage: "gearshape")
                }

                Divider()

                Button(role: .destructive) {
                    confirming = true
                } label: {
                    Label("Выйти из аккаунта", systemImage: "rectangle.portrait.and.arrow.right")
                }
            } label: {
                Image(systemName: "person.crop.circle")
            }
            .sheet(isPresented: $showingAccount) { AccountSheet() }
            // Окно, а не подсказка у кнопки: подсказка сжимается под размер
            // якоря в панели, и длинный текст в ней обрезался.
            .alert("Выйти из аккаунта?", isPresented: $confirming) {
                Button("Выйти", role: .destructive) {
                    Task { await auth.signOut() }
                }
                Button("Отмена", role: .cancel) {}
            } message: {
                Text("Неотправленные чеки останутся на устройстве и уйдут после следующего входа.")
            }
        }
    }
}

/// Русское склонение по числу.
func pluralize(_ count: Int, _ one: String, _ few: String, _ many: String) -> String {
    let mod100 = count % 100
    if (11...14).contains(mod100) { return many }
    switch count % 10 {
    case 1: return one
    case 2, 3, 4: return few
    default: return many
    }
}
