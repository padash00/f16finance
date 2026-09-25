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
    /// Куда ушли с главной. Значением, а не стопкой адресов: стек вкладки
    /// принадлежит корню, и своя стопка здесь его бы не видела.
    @State private var route: OperatorHomeRoute?
    #if DEBUG
    @State private var debugSheet: DebugSheet?
    #endif

    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.lg) {
                header
                if store.queuedSalesCount > 0 { offlineBanner }
                shiftHero
                quickActions
                attention
                if store.isMyShift, !store.recentSales.isEmpty { shiftMoney }
                weekCard
                if let next = cabinet.overview?.nextShift, !store.hasOpenShift {
                    nextShiftRow(next)
                }
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.bottom, Spacing.xxl)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.background)
        .navigationTitle("Смена")
        #if os(iOS)
        .toolbar(surface.isCompact ? .hidden : .visible, for: .navigationBar)
        #endif
        .toolbar { if !surface.isCompact { LogoutToolbarItem() } }
        .navigationDestination(item: $route) { route in
            switch route {
            case .sale: SaleScreen()
            case .audit: AuditScreen()
            case .checklists: ChecklistsScreen()
            case .knowledge: KnowledgeScreen()
            case .tasks: TasksScreen()
            case .money: MoneyScreen()
            }
        }
        .refreshable {
            await store.loadShift()
            await cabinet.loadOverview()
            await cabinet.loadTasks()
            // Каталог нужен только кассе: у клуба его незачем даже тянуть.
            if store.hasOpenShift, sellsGoods { await store.loadCatalog() }
        }
        .sheet(isPresented: $showOpenSheet) { OpenShiftSheet() }
        .sheet(isPresented: $showCloseSheet) { CloseShiftSheet() }
        #if DEBUG
        .sheet(item: $debugSheet) { kind in
            if kind.id == "checkout" { CheckoutSheet() } else { CartSheet {} }
        }
        .task {
            // Снимки экрана: `-ordaOperatorSheet open|close|checkout|cart`.
            guard let kind = UserDefaults.standard.string(forKey: "ordaOperatorSheet") else { return }
            try? await Task.sleep(for: .seconds(1))
            switch kind {
            case "open": showOpenSheet = true
            case "close": showCloseSheet = true
            default:
                if store.catalog.isEmpty { await store.loadCatalog() }
                for item in store.catalog.filter(\.isInStock).prefix(3) { store.add(item) }
                debugSheet = DebugSheet(id: kind)
            }
        }
        #endif
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

    // ── Шапка ────────────────────────────────────────────────────────────────

    private var fullName: String {
        cabinet.overview?.operatorName ?? auth.role?.displayName ?? "Оператор"
    }

    /// Имя, а не фамилия: «Сарсенгазинова Али…» крупным заголовком не
    /// помещалось и читалось как обрыв.
    private var firstName: String { PersonName.firstName(fullName) ?? fullName }

    private var initials: String {
        let letters = fullName.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined()
        return letters.isEmpty ? "О" : letters.uppercased()
    }

    private var greeting: String {
        switch Calendar.current.component(.hour, from: Date()) {
        case 5..<12: "Доброе утро"
        case 12..<18: "Добрый день"
        case 18..<23: "Добрый вечер"
        default: "Доброй ночи"
        }
    }

    private var header: some View {
        HStack(spacing: Spacing.md) {
            Text(initials)
                .font(.system(size: 16, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .frame(width: 44, height: 44)
                .background(
                    LinearGradient(colors: Theme.heroAccent, startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: Circle()
                )
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(greeting)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
                Text(firstName)
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
            }
            .accessibilityElement(children: .combine)
            Spacer(minLength: Spacing.sm)
            if let role = auth.role?.roleLabel, !role.isEmpty {
                Text(role)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.brand)
                    .lineLimit(1)
                    .padding(.horizontal, 12)
                    .frame(height: 32)
                    .background(Theme.brand.opacity(0.12), in: Capsule())
            }
        }
        .padding(.top, Spacing.md)
    }

    // ── Карточка смены ───────────────────────────────────────────────────────

    @ViewBuilder
    private var shiftHero: some View {
        if store.isLoadingShift && store.shiftState == nil {
            Skeleton(height: 180, cornerRadius: Radius.xl)
        } else if store.isSomeoneElsesShift {
            // Чужая смена: имя того, кто стоит, и ничего больше — ни выручки,
            // ни кнопки закрытия: их видит тот, кто открыл смену.
            hero(colors: Theme.heroGradient) {
                heroLabel("На смене другой", icon: "person.fill.checkmark")
                Text(store.shift?.operatorName ?? "Сменщик")
                    .font(.system(size: 30, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)
                    .padding(.top, Spacing.sm)
                if let opened = store.shift?.openedAt {
                    Text("на смене \(elapsed(since: opened))")
                        .font(.system(size: 14))
                        .foregroundStyle(.white.opacity(0.75))
                        .padding(.top, 2)
                }
                Text("Выручку и закрытие смены видит тот, кто её открыл.")
                    .font(.system(size: 13))
                    .foregroundStyle(.white.opacity(0.6))
                    .padding(.top, Spacing.md)
            }
        } else if store.hasOpenShift {
            hero(colors: Theme.heroAccent) {
                HStack {
                    heroLabel("Смена идёт", icon: "circle.fill")
                    Spacer()
                    if let opened = store.shift?.openedAt {
                        Text(elapsed(since: opened))
                            .font(.system(size: 14, weight: .semibold))
                            .monospacedDigit()
                            .foregroundStyle(.white.opacity(0.85))
                    }
                }
                Text(Money.format(store.totals.netTotal))
                    .font(.system(size: 40, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(.white)
                    .contentTransition(.numericText())
                    .animation(Motion.value, value: store.totals.netTotal)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                    .padding(.top, Spacing.sm)
                Text("выручка смены")
                    .font(.system(size: 14))
                    .foregroundStyle(.white.opacity(0.75))
                HStack(spacing: Spacing.xl) {
                    heroStat("Чеков", "\(store.totals.salesCount)")
                    heroStat("Наличные", Money.format(store.totals.expectedCash))
                    heroStat("Kaspi", Money.format(store.totals.expectedKaspi))
                }
                .padding(.top, Spacing.lg)
                heroButton("Закрыть смену", icon: "lock.fill") { showCloseSheet = true }
                    .padding(.top, Spacing.lg)
            }
        } else {
            hero(colors: Theme.heroGradient) {
                heroLabel("Смена закрыта", icon: "moon.fill")
                Text("Начните смену")
                    .font(.system(size: 30, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                    .padding(.top, Spacing.sm)
                Text("Пока смена не открыта, продавать нельзя. Открытие проверит, стоите ли вы сегодня в графике.")
                    .font(.system(size: 14))
                    .foregroundStyle(.white.opacity(0.75))
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 2)
                heroButton("Открыть смену", icon: "play.fill", prominent: true) { showOpenSheet = true }
                    .padding(.top, Spacing.lg)
            }
        }
    }

    private func hero<Content: View>(colors: [Color], @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 0, content: content)
            .padding(Spacing.xl)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing),
                in: RoundedRectangle(cornerRadius: Radius.xl, style: .continuous)
            )
            .overlay(alignment: .topTrailing) {
                OrdaControlMark(ringColor: .white.opacity(0.10))
                    .frame(width: 120, height: 120)
                    .offset(x: 30, y: -24)
                    .allowsHitTesting(false)
            }
            .clipShape(RoundedRectangle(cornerRadius: Radius.xl, style: .continuous))
    }

    private func heroLabel(_ text: String, icon: String) -> some View {
        Label {
            Text(text)
        } icon: {
            Image(systemName: icon).font(.system(size: 9, weight: .bold))
        }
        .font(.system(size: 13, weight: .semibold))
        .foregroundStyle(.white)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(.white.opacity(0.16), in: Capsule())
    }

    private func heroStat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.system(size: 13))
                .foregroundStyle(.white.opacity(0.65))
            Text(value)
                .font(.system(size: 16, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
    }

    private func heroButton(_ title: String, icon: String, prominent: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(prominent ? Theme.navy : .white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 13)
                .background(prominent ? Color.white : Color.white.opacity(0.18), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.pressable)
    }

    // ── Быстрые действия ─────────────────────────────────────────────────────

    /// Круглые кнопки — как у владельца. Продажа и ревизия — работа магазина;
    /// оператору клуба вместо них регламенты и задачи.
    private var quickActions: some View {
        HStack(alignment: .top, spacing: Spacing.sm) {
            if sellsGoods {
                RoundAction(icon: "barcode.viewfinder", title: "Продать", tint: Theme.brand) { route = .sale }
                RoundAction(icon: "list.clipboard.fill", title: "Ревизия", tint: Theme.brand) { route = .audit }
            } else {
                RoundAction(icon: "checklist", title: "Задачи", tint: Theme.brand) { route = .tasks }
            }
            RoundAction(icon: "checkmark.seal.fill", title: "Чек-листы", tint: Theme.brand) { route = .checklists }
            RoundAction(icon: "book.closed.fill", title: "База", tint: Theme.brand) { route = .knowledge }
            RoundAction(icon: "wallet.bifold.fill", title: "Деньги", tint: Theme.brand) { route = .money }
        }
    }

    /// Торгует ли точка. Пока сводка не пришла — считаем, что да.
    private var sellsGoods: Bool {
        cabinet.overview?.points?.sellsGoods ?? true
    }

    // ── Требует внимания ─────────────────────────────────────────────────────

    /// Карточками в ряд, как у владельца: каждая — одно дело и куда нажать.
    @ViewBuilder
    private var attention: some View {
        let debts = cabinet.overview?.counters
        let hasAny = !store.blockingChecklists.isEmpty
            || !cabinet.pendingArticles.isEmpty
            || cabinet.overdueCount > 0
            || (debts?.activeDebts ?? 0) > 0
        if hasAny {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Spacing.md) {
                    if !store.blockingChecklists.isEmpty {
                        AttentionCard(
                            icon: "checklist.unchecked",
                            tint: Theme.warning,
                            title: "\(store.blockingChecklists.count) \(pluralize(store.blockingChecklists.count, "чек-лист", "чек-листа", "чек-листов")) до закрытия",
                            subtitle: "без них смену не закрыть"
                        ) { route = .checklists }
                    }
                    if !cabinet.pendingArticles.isEmpty {
                        AttentionCard(
                            icon: "book.closed.fill",
                            tint: Theme.info,
                            title: "Прочитать \(cabinet.pendingArticles.count) \(pluralize(cabinet.pendingArticles.count, "правило", "правила", "правил"))",
                            subtitle: "новое в базе знаний"
                        ) { route = .knowledge }
                    }
                    if cabinet.overdueCount > 0 {
                        AttentionCard(
                            icon: "clock.badge.exclamationmark.fill",
                            tint: Theme.negative,
                            title: "\(cabinet.overdueCount) \(pluralize(cabinet.overdueCount, "задача просрочена", "задачи просрочены", "задач просрочено"))",
                            subtitle: "откройте и отметьте"
                        ) { route = .tasks }
                    }
                    if let debts, debts.activeDebts > 0 {
                        AttentionCard(
                            icon: "creditcard.trianglebadge.exclamationmark",
                            tint: Theme.negative,
                            title: "Долг перед точкой",
                            subtitle: Money.format(debts.activeDebtAmount)
                        ) { route = .money }
                    }
                }
            }
            .scrollClipDisabled()
        }
    }

    // ── Деньги смены ─────────────────────────────────────────────────────────

    private var shiftMoney: some View {
        OwnerSection("Выручка по чекам") {
            Text("\(store.totals.salesCount) \(pluralize(store.totals.salesCount, "чек", "чека", "чеков"))")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textDim)
        } content: {
            VStack(alignment: .leading, spacing: Spacing.md) {
                TrendChart(
                    title: "",
                    subtitle: nil,
                    points: revenuePoints,
                    color: ChartPalette.series1
                )
                if store.totals.returnsCount > 0 {
                    HStack {
                        Label("Возвраты", systemImage: "arrow.uturn.backward")
                            .font(.system(size: 14))
                            .foregroundStyle(Theme.textMuted)
                        Spacer()
                        Text("\(store.totals.returnsCount) · \(Money.format(store.totals.returnsTotal))")
                            .font(.system(size: 14, weight: .semibold))
                            .monospacedDigit()
                            .foregroundStyle(Theme.warning)
                    }
                }
            }
        }
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

    // ── Неделя ───────────────────────────────────────────────────────────────

    @ViewBuilder
    private var weekCard: some View {
        if let week = cabinet.overview?.week {
            Button { route = .money } label: {
                HStack(spacing: Spacing.md) {
                    TintedIcon(systemName: "wallet.bifold.fill", tint: Theme.positive, size: 46)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Заработано за неделю")
                            .font(.system(size: 14))
                            .foregroundStyle(Theme.textDim)
                            .lineLimit(1)
                        HStack(spacing: Spacing.sm) {
                            Text(Money.format(week.netAmount))
                                .font(.system(size: 22, weight: .bold, design: .rounded))
                                .monospacedDigit()
                                .foregroundStyle(Theme.text)
                                .contentTransition(.numericText())
                            Text(week.statusLabel)
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(week.status == "paid" ? Theme.positive : Theme.textMuted)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background((week.status == "paid" ? Theme.positive : Theme.textDim).opacity(0.12), in: Capsule())
                        }
                        // Остаток — только если часть уже выплачена: иначе он
                        // равен заработанному и читается как расхождение.
                        if week.paidAmount > 0, week.remainingAmount > 0 {
                            Text("осталось получить \(Money.format(week.remainingAmount))")
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.textDim)
                        }
                    }
                    Spacer(minLength: Spacing.sm)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.textDim)
                }
                .padding(Spacing.lg)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
            }
            .buttonStyle(.pressable)
        } else if cabinet.isLoadingOverview {
            Skeleton(height: 90, cornerRadius: Radius.lg)
        }
    }

    private func nextShiftRow(_ next: NextShift) -> some View {
        HStack(spacing: Spacing.md) {
            TintedIcon(systemName: "calendar", tint: Theme.brand, size: 46)
            VStack(alignment: .leading, spacing: 3) {
                Text("Ближайшая смена")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textDim)
                Text(next.label ?? next.date)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Theme.text)
            }
            Spacer()
        }
        .padding(Spacing.lg)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
    }

    // ── Офлайн ───────────────────────────────────────────────────────────────

    private var offlineBanner: some View {
        HStack(spacing: Spacing.md) {
            TintedIcon(systemName: "arrow.triangle.2.circlepath", tint: Theme.warning, size: 42)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(store.queuedSalesCount) \(pluralize(store.queuedSalesCount, "чек", "чека", "чеков")) ждёт отправки")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.text)
                Text("Продажи сохранены на устройстве.")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
            }
            Spacer()
            Button("Отправить") { Task { await store.flushQueue() } }
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(Theme.brand, in: Capsule())
        }
        .padding(Spacing.lg)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
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

#if DEBUG
struct DebugSheet: Identifiable { let id: String }
#endif
