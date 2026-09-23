import OrdaKit
import OrdaUI
import SwiftUI

/// Сводка «сегодня» и «этот месяц» для главной.
///
/// Отдельно от аналитики: у главной свой, неизменный период — владелец
/// открывает приложение, чтобы увидеть сегодня, а не то, что крутил в
/// аналитике вчера. Точки — общие с аналитикой.
@MainActor
@Observable
final class OwnerHomeStore {
    private(set) var today: OwnerAnalytics?
    private(set) var month: OwnerAnalytics?
    private(set) var error: APIError?
    private(set) var isLoading = false

    private let service: OwnerAnalyticsService

    init(api: APIClient) {
        service = OwnerAnalyticsService(api: api)
    }

    func load(companyIDs: Set<String>) async {
        isLoading = true
        defer { isLoading = false }
        let ids = Array(companyIDs)
        let extra = ExtraCashPreference.shared.includeExtra
        let todayBounds = AnalyticsPeriod.today.bounds()
        let monthBounds = AnalyticsPeriod.thisMonth.bounds()
        // Главной хватает лёгкого ответа: итоги, точки, касса без товаров.
        let todayQuery = OwnerAnalyticsQuery(from: todayBounds.from, to: todayBounds.to, companyIDs: ids, includeExtra: extra, lite: true)
        let monthQuery = OwnerAnalyticsQuery(from: monthBounds.from, to: monthBounds.to, companyIDs: ids, includeExtra: extra, lite: true)

        // Прошлые цифры — сразу: открыл приложение и видишь выручку, а не
        // пустую карточку, пока идёт сеть.
        if today == nil { today = await service.cached(todayQuery) }
        if month == nil { month = await service.cached(monthQuery) }

        // Два запроса независимы: сбой одного не должен гасить другой.
        async let t = result(todayQuery)
        async let m = result(monthQuery)
        let (todayResult, monthResult) = await (t, m)
        if case let .success(value) = todayResult { today = value }
        if case let .success(value) = monthResult { month = value }
        switch (todayResult, monthResult) {
        case (.failure(let e), _), (_, .failure(let e)): error = e
        default: error = nil
        }
    }

    private func result(_ query: OwnerAnalyticsQuery) async -> Result<OwnerAnalytics, APIError> {
        do {
            return .success(try await service.load(query))
        } catch let apiError as APIError {
            return .failure(apiError)
        } catch {
            return .failure(.transport(message: error.localizedDescription))
        }
    }
}

/// Куда главная может отправить человека.
enum OwnerDestination: Hashable {
    case analytics
    case services
    case page(String)
}

/// Главная владельца — как главная банковского приложения.
///
/// Сверху карточка с одной большой цифрой: выручка сегодня, листается на
/// месяц. Под ней — круглые кнопки того, что делают каждый день. Дальше —
/// что требует решения, точки и сервисы плиткой.
struct OwnerHomeScreen: View {
    let resolver: AccessResolver
    /// Перейти на вкладку или открыть раздел.
    var navigate: (OwnerDestination) -> Void = { _ in }

    @Environment(\.api) private var api
    @Environment(AnalyticsStore.self) private var analytics
    @Environment(BusinessStore.self) private var business
    @Environment(AuthStore.self) private var auth

    @State private var home: OwnerHomeStore?
    @State private var heroPage = 0
    @State private var sheet: QuickSheet?
    @State private var showsCompanies = false

    enum QuickSheet: String, Identifiable {
        case expense, income, task
        var id: String { rawValue }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.lg) {
                header
                hero
                quickActions
                attention
                points
                services
                if let error = home?.error, home?.today == nil {
                    ErrorStateView(error: error) { Task { await reload() } }
                }
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.bottom, Spacing.xxl)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.background)
        .refreshable { await reload() }
        #if os(iOS)
        .toolbar(.hidden, for: .navigationBar)
        #endif
        .task(id: [analytics.filter.companyIDs.sorted().joined(), String(ExtraCashPreference.shared.includeExtra)]) {
            if home == nil { home = OwnerHomeStore(api: api) }
            await reload()
        }
        .sheet(item: $sheet) { kind in
            switch kind {
            case .expense: AddExpenseSheet()
            case .income: AddIncomeSheet()
            case .task: AddTaskSheet()
            }
        }
        .sheet(isPresented: $showsCompanies) {
            CompanyPickerSheet(
                companies: analytics.companies.isEmpty ? (home?.month?.companies ?? []) : analytics.companies,
                selection: Binding(get: { analytics.filter.companyIDs }, set: { analytics.filter.companyIDs = $0 })
            )
            .presentationDetents([.medium, .large])
        }
    }

    private func reload() async {
        await home?.load(companyIDs: analytics.filter.companyIDs)
    }

    // ── Шапка ────────────────────────────────────────────────────────────────

    /// Шапка как в банковском приложении: слева аватар и приветствие,
    /// справа — точки капсулой. Раньше выбор точек был крупным заголовком
    /// с галочкой и выглядел как текст, а не как кнопка.
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
                Text(greetingPart)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
                Text(firstName ?? "ORDA CONTROL")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
            }
            .accessibilityElement(children: .combine)

            Spacer(minLength: Spacing.sm)

            if (home?.isLoading ?? false) && home?.today != nil {
                ProgressView().controlSize(.small)
            }

            // Выбрана не вся сеть — капсула синяя и с крестиком: цифры на
            // экране не за всё, и это должно бросаться в глаза.
            let filtered = !analytics.filter.companyIDs.isEmpty
            HStack(spacing: 6) {
                Button {
                    showsCompanies = true
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "building.2.fill")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(filtered ? .white : Theme.brand)
                        Text(analytics.companiesTitle)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(filtered ? .white : Theme.text)
                            .lineLimit(1)
                        if !filtered {
                            Image(systemName: "chevron.down")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(Theme.textDim)
                        }
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Точки: \(analytics.companiesTitle)")
                if filtered {
                    Button {
                        analytics.filter.companyIDs = []
                        Haptics.tap()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 15))
                            .foregroundStyle(.white.opacity(0.85))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Показать все точки")
                }
            }
            .padding(.horizontal, 12)
            .frame(height: 36)
            .background(filtered ? Theme.brand : Theme.surface, in: Capsule())
            .overlay(Capsule().strokeBorder(filtered ? .clear : Theme.border, lineWidth: 1))
        }
        .padding(.top, Spacing.md)
    }

    private var greetingPart: String {
        let hour = Calendar.current.component(.hour, from: Date())
        return switch hour {
        case 5..<12: "Доброе утро"
        case 12..<18: "Добрый день"
        case 18..<23: "Добрый вечер"
        default: "Доброй ночи"
        }
    }

    /// Вместо имени бывает почта — её в приветствие не ставим.
    private var fullName: String? {
        resolver.session.displayName ?? auth.role?.displayName
    }

    private var firstName: String? {
        fullName?
            .split(separator: " ").first.map(String.init)
            .flatMap { $0.contains("@") ? nil : $0 }
    }

    private var initials: String {
        let words = (fullName ?? "")
            .split(separator: " ")
            .filter { !$0.contains("@") }
            .prefix(2)
        let letters = words.compactMap(\.first).map(String.init).joined()
        return letters.isEmpty ? "O" : letters.uppercased()
    }

    // ── Карточка-герой ───────────────────────────────────────────────────────

    private var hero: some View {
        VStack(spacing: Spacing.sm) {
            // Листается прокруткой с постраничной остановкой, а не TabView:
            // страничный TabView внутри прокрутки при перерисовке застревал
            // между карточками.
            ScrollView(.horizontal, showsIndicators: false) {
                // Страница — ровно ширина экрана, без промежутков: постраничное
                // листание тогда останавливается точно на карточке. Зазор между
                // карточками — внутренний отступ самой страницы.
                HStack(spacing: 0) {
                    todayCard
                        .padding(.trailing, Spacing.xs)
                        .containerRelativeFrame(.horizontal)
                        .id(0)
                    monthCard
                        .padding(.leading, Spacing.xs)
                        .containerRelativeFrame(.horizontal)
                        .id(1)
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.paging)
            .scrollPosition(id: Binding(get: { heroPage }, set: { heroPage = $0 ?? 0 }))
            .frame(height: 196)

            HStack(spacing: 6) {
                ForEach(0..<2, id: \.self) { index in
                    Capsule()
                        .fill(index == heroPage ? Theme.text : Theme.textDim.opacity(0.35))
                        .frame(width: index == heroPage ? 18 : 6, height: 6)
                }
            }
            .animation(Motion.tap, value: heroPage)
        }
    }

    private var todayCard: some View {
        let data = home?.today
        let pos = data?.pos
        // Живая выручка — по кассе: отчёты смен приходят в конце смены, и
        // днём по ним «сегодня» почти всегда ноль.
        let value = pos?.amount ?? data?.kpi.current.revenue
        let previous = pos?.previous.amount ?? data?.kpi.previous.revenue
        let change = value.flatMap { v in previous.flatMap { Percent.change(current: v, previous: $0) } }
        let footer: [(String, String)] = if let pos {
            [("Чеков", pos.receipts.formatted()), ("Средний чек", Money.format(pos.avgCheck))]
        } else {
            [("Смен закрыто", (data?.kpi.current.shifts ?? 0).formatted()), ("Наличные", Money.format(data?.kpi.current.cash))]
        }
        return HeroCard(
            title: "Выручка сегодня",
            value: value,
            change: change,
            changeCaption: pos?.previous.sameTime == true ? "к этому часу вчера" : "к вчера",
            footer: footer,
            colors: Theme.heroAccent
        ) { navigate(.analytics) }
    }

    private var monthCard: some View {
        let data = home?.month
        let cur = data?.kpi.current
        let prev = data?.kpi.previous
        let change = cur.flatMap { c in prev.flatMap { Percent.change(current: c.revenue, previous: $0.revenue) } }
        return HeroCard(
            title: "Выручка за месяц",
            value: cur?.revenue,
            change: change,
            changeCaption: "к тем же дням прошлого месяца",
            footer: [("Прибыль", Money.format(cur?.profit)), ("Расходы", Money.format(cur?.expense))],
            colors: Theme.heroGradient
        ) { navigate(.analytics) }
    }

    // ── Быстрые действия ─────────────────────────────────────────────────────

    private var quickActions: some View {
        HStack(alignment: .top, spacing: Spacing.sm) {
            if resolver.can("expenses.create") {
                RoundAction(icon: "minus", title: "Расход", tint: Theme.brand) { sheet = .expense }
            }
            if resolver.can("income.create") {
                RoundAction(icon: "plus", title: "Доход", tint: Theme.brand) { sheet = .income }
            }
            if resolver.can("tasks.create") {
                RoundAction(icon: "checklist", title: "Задача", tint: Theme.brand) { sheet = .task }
            }
            RoundAction(icon: "chart.pie.fill", title: "Аналитика", tint: Theme.brand) { navigate(.analytics) }
            RoundAction(icon: "square.grid.2x2.fill", title: "Сервисы", tint: Theme.brand) { navigate(.services) }
        }
    }

    // ── Требует внимания ─────────────────────────────────────────────────────

    @ViewBuilder
    private var attention: some View {
        let pending = business.pending
        let canStock = resolver.can("store.view") || resolver.can("store-warehouse.view")
        let lowStock = canStock ? (business.dashboard?.lowStock ?? []) : []
        if !pending.isEmpty || !lowStock.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Spacing.md) {
                    if !pending.isEmpty {
                        AttentionCard(
                            icon: "clock.badge.exclamationmark.fill",
                            tint: Color(hex: 0xF59E0B),
                            title: "\(pending.count) \(Self.expensesWord(pending.count)) ждут решения",
                            subtitle: Money.format(pending.reduce(0) { $0 + $1.total })
                        ) { navigate(.page("expenses-pending")) }
                    }
                    if !lowStock.isEmpty {
                        AttentionCard(
                            icon: "shippingbox.fill",
                            tint: Color(hex: 0xEF4444),
                            title: "Заканчивается \(lowStock.count) \(Self.itemsWord(lowStock.count))",
                            subtitle: lowStock.prefix(2).map(\.name).joined(separator: ", ")
                        ) { navigate(.page("store-warehouse")) }
                    }
                }
            }
            .scrollClipDisabled()
        }
    }

    static func expensesWord(_ n: Int) -> String {
        let m10 = n % 10, m100 = n % 100
        if m10 == 1 && m100 != 11 { return "расход" }
        if (2...4).contains(m10) && !(12...14).contains(m100) { return "расхода" }
        return "расходов"
    }

    static func itemsWord(_ n: Int) -> String {
        let m10 = n % 10, m100 = n % 100
        if m10 == 1 && m100 != 11 { return "товар" }
        if (2...4).contains(m10) && !(12...14).contains(m100) { return "товара" }
        return "товаров"
    }

    // ── Точки ────────────────────────────────────────────────────────────────

    @ViewBuilder
    private var points: some View {
        // Точки без движения за месяц (здание, склад) — не строка с нулём.
        let rows = home?.month?.byCompany.filter { $0.revenue != 0 || $0.expense != 0 } ?? []
        if rows.count > 1 {
            let total = max(rows.reduce(0) { $0 + $1.revenue }, 1)
            OwnerSection("Точки") {
                Text("за месяц")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
            } content: {
                VStack(spacing: Spacing.md) {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                        Button {
                            analytics.filter.companyIDs = [row.id]
                            navigate(.analytics)
                        } label: {
                            AmountRow(
                                leading: { LetterBadge(text: row.name, tint: OwnerTint.point(index)) },
                                title: row.name,
                                subtitle: "прибыль \(Money.format(row.profit))",
                                amount: Money.format(row.revenue),
                                change: Percent.change(current: row.revenue, previous: row.prevRevenue),
                                share: row.revenue / total,
                                tint: OwnerTint.point(index),
                                showsChevron: true
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    // ── Сервисы ──────────────────────────────────────────────────────────────

    private var services: some View {
        let favorites = OwnerServices.favorites(resolver: resolver)
        return OwnerSection("Сервисы") {
            Button("Все") { navigate(.services) }
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.brand)
        } content: {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: Spacing.sm), count: 4), spacing: Spacing.lg) {
                ForEach(favorites) { item in
                    Button {
                        navigate(.page(item.pageID))
                    } label: {
                        ServiceTile(
                            icon: item.icon,
                            title: item.title,
                            tint: item.tint,
                            badge: item.pageID == "expenses-pending" ? business.pending.count : 0
                        )
                    }
                    .buttonStyle(.pressable)
                }
            }
        }
    }
}

/// Карточка с одной большой цифрой на цветном градиенте.
struct HeroCard: View {
    let title: String
    let value: Double?
    let change: Double?
    let changeCaption: String
    let footer: [(String, String)]
    let colors: [Color]
    var action: () -> Void = {}

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text(title)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(.white.opacity(0.85))
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.7))
                }
                Text(value.map { Money.format($0) } ?? "—")
                    .font(.system(size: 38, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(.white)
                    .contentTransition(.numericText())
                    .animation(Motion.value, value: value)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                    .padding(.top, Spacing.xs)
                    .redacted(reason: value == nil ? .placeholder : [])

                HStack(spacing: 6) {
                    if let change {
                        HStack(spacing: 3) {
                            Image(systemName: change >= 0 ? "arrow.up.right" : "arrow.down.right")
                                .font(.system(size: 11, weight: .bold))
                            Text(Percent.format(change, signed: true))
                                .font(.system(size: 13, weight: .bold))
                                .monospacedDigit()
                        }
                        .foregroundStyle(.white)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(.white.opacity(0.2), in: Capsule())
                        Text(changeCaption)
                            .font(.system(size: 13))
                            .foregroundStyle(.white.opacity(0.8))
                            .lineLimit(1)
                    }
                }
                .frame(height: 24)
                .padding(.top, Spacing.xs)

                Spacer(minLength: 0)

                HStack(spacing: Spacing.xl) {
                    ForEach(footer, id: \.0) { label, text in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(label)
                                .font(.system(size: 12))
                                .foregroundStyle(.white.opacity(0.7))
                            Text(text)
                                .font(.system(size: 15, weight: .semibold, design: .rounded))
                                .monospacedDigit()
                                .foregroundStyle(.white)
                                .lineLimit(1)
                                .minimumScaleFactor(0.7)
                        }
                    }
                    Spacer(minLength: 0)
                }
            }
            .padding(Spacing.xl)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .background {
                RoundedRectangle(cornerRadius: 28, style: .continuous)
                    .fill(LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing))
                    .overlay(alignment: .topTrailing) {
                        Circle()
                            .fill(.white.opacity(0.08))
                            .frame(width: 180, height: 180)
                            .offset(x: 60, y: -70)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
            }
        }
        .buttonStyle(.pressable)
    }
}

/// Карточка «требует внимания» в горизонтальной ленте.
struct AttentionCard: View {
    let icon: String
    let tint: Color
    let title: String
    let subtitle: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: Spacing.md) {
                TintedIcon(systemName: icon, tint: tint, size: 42)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                    Text(subtitle)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textDim)
                        .lineLimit(1)
                }
            }
            .padding(Spacing.md)
            .frame(width: 280, alignment: .leading)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
        .buttonStyle(.pressable)
    }
}
