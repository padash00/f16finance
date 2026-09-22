import OrdaKit
import OrdaUI
import SwiftUI

// ── Общее для разделов «по людям» ────────────────────────────────────────────

/// Переключатель периода.
///
/// Быстрые кнопки — календарные неделя и месяц: премию и место в рейтинге
/// владелец объявляет за них. Любые другие даты — под календарём.
private struct PeoplePeriodPicker: View {
    let period: AnalyticsPeriod
    let select: (AnalyticsPeriod) -> Void

    var body: some View {
        PeriodBar(
            selection: Binding(get: { period }, set: { select($0) }),
            quick: [.thisWeek, .lastWeek, .thisMonth, .lastMonth]
        )
    }
}

/// Место в рейтинге: тройка — медалями, остальные — числом.
private struct RankBadge: View {
    let rank: Int

    private var medal: String? {
        switch rank {
        case 1: "🥇"
        case 2: "🥈"
        case 3: "🥉"
        default: nil
        }
    }

    var body: some View {
        ZStack {
            if let medal {
                Text(medal).font(.system(size: 18))
            } else {
                Circle().fill(Theme.surfaceRaised)
                Text("\(rank)")
                    .font(Typography.caption.weight(.bold))
                    .monospacedDigit()
                    .foregroundStyle(Theme.textDim)
            }
        }
        .frame(width: 26, height: 26)
    }
}

/// Кружок с фото или буквой — для людей, у которых нет `TeamOperator`.
///
/// Без фото — цветная буква, как в зарплате и списке операторов: серый
/// кружок с инициалами на весь лидерборд выглядел заглушкой.
private struct PersonAvatar: View {
    let name: String
    let photoURL: String?
    var size: CGFloat = 32

    private var initials: String {
        name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined().uppercased()
    }

    var body: some View {
        if photoURL == nil {
            PersonInitial(name: name, size: size)
        } else {
            Thumbnail(url: photoURL, side: size, cornerRadius: size / 2, fallbackText: initials)
                .overlay(Circle().stroke(Theme.border, lineWidth: 0.5))
        }
    }
}

/// Шапка карточки человека как профиль в банке: крупный кружок по центру,
/// имя и одна строка пояснения. Цифры идут ниже отдельной карточкой.
private struct PersonProfileHeader: View {
    let name: String
    var photoURL: String? = nil
    let subtitle: String
    var subtitleColor: Color = Theme.textMuted

    var body: some View {
        VStack(spacing: Spacing.sm) {
            PersonAvatar(name: name, photoURL: photoURL, size: 84)
            Text(name)
                .font(.system(size: 24, weight: .bold, design: .rounded))
                .foregroundStyle(Theme.text)
                .multilineTextAlignment(.center)
            Text(subtitle)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(subtitleColor)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Spacing.md)
    }
}

// ── Эффективность (PI) ───────────────────────────────────────────────────────

@MainActor @Observable
final class PerformanceStore {
    private(set) var report: PerformanceRanking?
    /// PI за прошлый период — чтобы показать, вырос человек или просел.
    private(set) var previousPI: [String: Double] = [:]
    private(set) var companies: [Company] = []
    private(set) var isLoading = false
    private(set) var error: APIError?

    private(set) var period: AnalyticsPeriod = .thisMonth
    private(set) var companyID = ""

    private let service: PeopleAnalyticsService

    init(api: APIClient) { service = PeopleAnalyticsService(api: api) }

    var companyName: String {
        companies.first { $0.id == companyID }?.name ?? "Все точки"
    }

    func select(period: AnalyticsPeriod) async {
        guard period != self.period else { return }
        self.period = period
        await load()
    }

    func select(companyID: String) async {
        guard companyID != self.companyID else { return }
        self.companyID = companyID
        await load()
    }

    func load() async {
        isLoading = true
        defer { isLoading = false }

        let bounds = period.bounds()
        let earlier = PeoplePeriod.previous(from: bounds.from, to: bounds.to)
        let company = companyID.isEmpty ? nil : companyID

        do {
            // Прошлый период — украшение: если он не посчитался, рейтинг за
            // текущий всё равно должен открыться.
            async let current = service.performance(from: bounds.from, to: bounds.to, companyID: company)
            async let previous = try? service.performance(from: earlier.from, to: earlier.to, companyID: company)

            report = try await current
            error = nil
            previousPI = Dictionary(
                (await previous)?.ranking.map { ($0.operatorID, $0.pi) } ?? [],
                uniquingKeysWith: { first, _ in first }
            )
        } catch let apiError as APIError {
            error = apiError
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }

        if companies.isEmpty {
            companies = (try? await service.companies()) ?? []
        }
    }
}

/// Эффективность операторов: PI = факт ÷ норма для его слота.
///
/// Ни одна цифра здесь не считается в приложении. Норма — медиана выручки по
/// (точка, день недели, смена) за всю историю, с исключением собственных смен
/// оператора; повторить это на клиенте значит завести вторую версию правды,
/// и владелец не будет знать, какой верить.
struct PerformanceScreen: View {
    @Environment(\.api) private var api
    @State private var store: PerformanceStore?

    var body: some View {
        Group {
            if let store {
                if let error = store.error, store.report == nil {
                    ErrorStateView(error: error) { Task { await store.load() } }
                } else if let report = store.report {
                    ScreenScroll { content(store, report) }
                } else {
                    LoadingRows(count: 6)
                }
            } else {
                LoadingRows(count: 6)
            }
        }
        .background(Theme.background)
        .navigationTitle("Эффективность")
        .navigationDestination(for: PerformanceRoute.self) { route in
            PerformanceDetail(item: route.item, companies: store?.companies ?? [])
        }
        .toolbar {
            if let store {
                ToolbarItem(placement: .primaryAction) { companyMenu(store) }
            }
            LogoutToolbarItem()
        }
        .task {
            if store == nil {
                let created = PerformanceStore(api: api)
                store = created
                await created.load()
            }
        }
        .refreshable { await store?.load() }
    }

    private func companyMenu(_ store: PerformanceStore) -> some View {
        Menu {
            Button("Все точки") { Task { await store.select(companyID: "") } }
            ForEach(store.companies) { company in
                Button(company.name) { Task { await store.select(companyID: company.id) } }
            }
        } label: {
            Label(store.companyName, systemImage: "building.2")
        }
    }

    @ViewBuilder
    private func content(_ store: PerformanceStore, _ report: PerformanceRanking) -> some View {
        VStack(spacing: Spacing.lg) {
            PeoplePeriodPicker(period: store.period) { period in
                Task { await store.select(period: period) }
            }

            if report.ranking.isEmpty {
                InlineEmpty(icon: "person.2.slash", text: "За период смен нет", tint: Theme.textDim)
            } else {
                metrics(report)

                SplitDashboard {
                    rankingCard(store, report)
                } side: {
                    coldStartCard(report)
                    baselineCard(report)
                }
            }
        }
    }

    /// Средний PI — главная цифра, раскладка «выше · в норме · ниже» — её
    /// расшифровка. Четыре равные плитки не говорили, на что смотреть.
    private func metrics(_ report: PerformanceRanking) -> some View {
        let people = report.qualified
        let above = people.filter { $0.pi >= 1.05 }.count
        let norm = people.filter { $0.pi >= 0.95 && $0.pi < 1.05 }.count
        let below = people.filter { $0.pi < 0.95 }.count

        return HeroSummary(
            title: "Средний PI",
            value: report.averagePI.map { String(format: "%.2f", $0) } ?? "—",
            caption: "факт ÷ норма смены",
            footer: [
                ("Выше нормы", "\(above)"),
                ("В норме", "\(norm)"),
                ("Ниже нормы", "\(below)"),
            ],
            colors: Theme.heroGradient
        )
    }

    private func rankingCard(_ store: PerformanceStore, _ report: PerformanceRanking) -> some View {
        let people = report.qualified
        // Полоса — PI относительно лучшего: сразу видно, насколько отстаёт
        // хвост рейтинга от лидера.
        let best = max(people.map(\.pi).max() ?? 1, 0.01)

        return OwnerSection("Рейтинг") {
            Text("\(people.count) \(pluralize(people.count, "оператор", "оператора", "операторов"))")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textDim)
        } content: {
            if people.isEmpty {
                InlineEmpty(
                    icon: "hourglass",
                    text: "Ни у кого нет \(report.minQualifyingShifts) смен — сравнивать пока не с чем",
                    tint: Theme.textDim
                )
            } else {
                VStack(spacing: Spacing.sm) {
                    ForEach(Array(people.enumerated()), id: \.element.id) { index, item in
                        NavigationLink(value: PerformanceRoute(item: item)) {
                            PerformanceRowView(
                                rank: index + 1,
                                item: item,
                                previousPI: store.previousPI[item.operatorID],
                                share: item.pi / best
                            )
                        }
                        .buttonStyle(.pressable)
                    }
                }
            }
        }
    }

    /// Кто ещё не набрал смен. Их нельзя ставить в один ряд с остальными, но и
    /// прятать нечестно: человек работал.
    @ViewBuilder
    private func coldStartCard(_ report: PerformanceRanking) -> some View {
        let people = report.coldStart
        if !people.isEmpty {
            OwnerSection("Мало смен") {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    Text("меньше \(report.minQualifyingShifts) — в рейтинг не идут")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textDim)
                    ForEach(people) { item in
                        AmountRow(
                            leading: { PersonInitial(name: item.displayName, isActive: false, size: 36) },
                            title: item.displayName,
                            amount: "\(item.shifts) \(pluralize(item.shifts, "смена", "смены", "смен"))"
                        )
                    }
                }
            }
        }
    }

    private func baselineCard(_ report: PerformanceRanking) -> some View {
        let baseline = report.baseline

        return OwnerSection("Как считается") {
            VStack(alignment: .leading, spacing: Spacing.md) {
                Text("PI = факт ÷ норма смены. Норма — медианная выручка этого же слота: та же точка, тот же день недели, та же смена. Собственные смены оператора в норму не входят.")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)

                RowDivider()
                StatRow("Смен в истории", value: "\(baseline.shiftsCount)", icon: "clock.arrow.circlepath")
                StatRow("Слотов", value: "\(baseline.slotsCount)", icon: "square.grid.3x3")
                StatRow("Медиана смены", value: Money.format(baseline.globalMedian), icon: "chart.bar")
            }
        }
    }
}

/// Строка рейтинга: место, имя, PI и деньги сверх нормы.
///
/// Оценка — цветом полосы и подписью, а не плашкой: плашка справа съедала
/// полстроки, и имя обрезалось.
private struct PerformanceRowView: View {
    let rank: Int
    let item: PerformanceRankingItem
    let previousPI: Double?
    let share: Double

    private var tint: Color {
        switch item.grade {
        case .excellent, .good: Theme.positive
        case .norm: Theme.textMuted
        case .below: Theme.warning
        case .weak: Theme.negative
        }
    }

    var body: some View {
        AmountRow(
            leading: {
                HStack(spacing: Spacing.sm) {
                    RankBadge(rank: rank)
                    PersonInitial(name: item.displayName, size: 36)
                }
            },
            title: item.displayName,
            // Сверх нормы — то, ради чего раздел и открывают: это деньги,
            // которых без этого человека не было бы.
            subtitle: "\(item.grade.label.lowercased()) · \(Money.signed(item.aboveNorm)) · \(item.shifts) \(pluralize(item.shifts, "смена", "смены", "смен"))",
            amount: "PI \(String(format: "%.2f", item.pi))",
            change: previousPI.flatMap { Percent.change(current: item.pi, previous: $0) },
            share: share,
            tint: tint,
            showsChevron: true
        )
    }
}

/// Карточка оператора: из чего сложился его PI.
private struct PerformanceDetail: View {
    let item: PerformanceRankingItem
    let companies: [Company]

    private func companyName(_ id: String) -> String {
        companies.first { $0.id == id }?.name ?? "Точка"
    }

    var body: some View {
        ScreenScroll {
            VStack(spacing: Spacing.lg) {
                PersonProfileHeader(
                    name: item.displayName,
                    subtitle: item.grade.label,
                    subtitleColor: gradeColor
                )

                // PI — главная цифра; выручка и деньги сверх нормы — то, из
                // чего она сложилась. Зелёный, если человек тянет выше нормы.
                HeroSummary(
                    title: "Эффективность, PI",
                    value: String(format: "%.2f", item.pi),
                    caption: "сверх нормы \(Money.signed(item.aboveNorm))",
                    footer: [
                        ("Выручка", Money.format(item.totalRevenue)),
                        ("За смену", Money.format(item.avgRevenuePerShift)),
                        ("Смен", "\(item.shifts)"),
                    ],
                    colors: item.pi >= 1
                        ? Theme.heroGradient
                        : Theme.heroGradient
                )

                if !trend.isEmpty {
                    TrendChart(
                        title: "Выручка по сменам",
                        subtitle: "\(item.shifts) \(pluralize(item.shifts, "смена", "смены", "смен"))",
                        points: trend,
                        color: ChartPalette.series1
                    )
                }

                shiftsCard
            }
        }
        .background(Theme.background)
        .navigationTitle(item.displayName)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }

    private var trend: [TimePoint] {
        item.shiftDetails
            .compactMap { shift -> TimePoint? in
                guard let day = shift.day else { return nil }
                return TimePoint(
                    label: day.formatted(.dateTime.day().month(.abbreviated)),
                    date: day,
                    value: shift.actual
                )
            }
            .sorted { $0.date < $1.date }
    }

    private var gradeColor: Color {
        switch item.grade {
        case .excellent, .good: Theme.positive
        case .norm: Theme.textMuted
        case .below: Theme.warning
        case .weak: Theme.negative
        }
    }

    private var shiftsCard: some View {
        let shifts = item.shiftDetails.sorted { $0.date > $1.date }

        return OwnerSection("Смены") {
            Text("факт против нормы")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textDim)
        } content: {
            VStack(spacing: Spacing.sm) {
                ForEach(shifts) { shift in
                    shiftRow(shift)
                }
            }
        }
    }

    private func shiftRow(_ shift: PerformanceShift) -> some View {
        HStack(spacing: Spacing.md) {
            // День или ночь — иконкой в кружке, как тип операции в выписке.
            TintedIcon(
                systemName: shift.isNight ? "moon.fill" : "sun.max.fill",
                tint: shift.isNight ? Color(hex: 0x4F46E5) : Color(hex: 0xF59E0B),
                size: 36
            )
            VStack(alignment: .leading, spacing: 1) {
                Text(shift.day?.formatted(.dateTime.day().month(.abbreviated)) ?? shift.date)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Theme.text)
                Text(companyName(shift.companyID))
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 1) {
                Text(Money.format(shift.actual))
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(Theme.text)
                Text("норма \(Money.format(shift.expected))")
                    .font(Typography.caption)
                    .monospacedDigit()
                    .foregroundStyle(Theme.textDim)
            }

            // Упёршийся в потолок PI помечаем: почти всегда это не рекорд, а
            // повод посмотреть, что за смена была.
            if shift.isClipped {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.warning)
            }

            Text(String(format: "%.2f", shift.pi))
                .font(Typography.callout.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(shift.pi >= 1 ? Theme.positive : Theme.negative)
                .frame(width: 44, alignment: .trailing)
        }
    }
}

// ── Рейтинг операторов ───────────────────────────────────────────────────────

@MainActor @Observable
final class RatingsStore {
    private(set) var entries: [LeaderboardEntry]?
    private(set) var isLoading = false
    private(set) var error: APIError?
    private(set) var period: AnalyticsPeriod = .thisMonth

    private let service: PeopleAnalyticsService

    init(api: APIClient) { service = PeopleAnalyticsService(api: api) }

    var totalRevenue: Double { (entries ?? []).reduce(0) { $0 + $1.revenue } }

    func select(period: AnalyticsPeriod) async {
        guard period != self.period else { return }
        self.period = period
        await load()
    }

    func load() async {
        isLoading = true
        defer { isLoading = false }

        let bounds = period.bounds()
        let earlier = PeoplePeriod.previous(from: bounds.from, to: bounds.to)

        do {
            async let current = service.incomes(from: bounds.from, to: bounds.to)
            async let previous = try? service.incomes(from: earlier.from, to: earlier.to)
            async let people = service.operators()

            entries = OperatorLeaderboard.build(
                incomes: try await current,
                previousIncomes: (await previous) ?? [],
                operators: try await people
            )
            error = nil
        } catch let apiError as APIError {
            error = apiError
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }
}

/// Лидерборд по выручке.
///
/// Сумма четырёх колонок оплаты, делённая на число смен, — расчёт настолько
/// прямой, что дублировать его безопасно: сойтись с сайтом он может только
/// одним способом. Всё остальное («справедливое» сравнение с поправкой на
/// слот) живёт в разделе «Эффективность» и считается на сервере.
struct RatingsScreen: View {
    @Environment(\.api) private var api
    @State private var store: RatingsStore?

    var body: some View {
        Group {
            if let store {
                if let error = store.error, store.entries == nil {
                    ErrorStateView(error: error) { Task { await store.load() } }
                } else if let entries = store.entries {
                    ScreenScroll { content(store, entries) }
                } else {
                    LoadingRows(count: 6)
                }
            } else {
                LoadingRows(count: 6)
            }
        }
        .background(Theme.background)
        .navigationTitle("Рейтинг")
        .toolbar { LogoutToolbarItem() }
        .task {
            if store == nil {
                let created = RatingsStore(api: api)
                store = created
                await created.load()
            }
        }
        .refreshable { await store?.load() }
    }

    @ViewBuilder
    private func content(_ store: RatingsStore, _ entries: [LeaderboardEntry]) -> some View {
        // Люди с нулём в списке нужны (видно, кто не работал), но если нулевые
        // все — данных за период просто нет.
        let working = entries.filter { $0.revenue > 0 }

        VStack(spacing: Spacing.lg) {
            PeoplePeriodPicker(period: store.period) { period in
                Task { await store.select(period: period) }
            }

            if working.isEmpty {
                InlineEmpty(icon: "trophy", text: "За период выручки нет", tint: Theme.textDim)
            } else {
                metrics(store, working)

                SplitDashboard {
                    leaderboardCard(entries)
                } side: {
                    topChart(working)
                }
            }
        }
    }

    /// Суммарная выручка — главная цифра, сколько людей её сделали и кто
    /// лидер — подписи. Имя лидера в плитке обрезалось до трёх букв.
    private func metrics(_ store: RatingsStore, _ working: [LeaderboardEntry]) -> some View {
        let shifts = working.reduce(0) { $0 + $1.shifts }
        return HeroSummary(
            title: "Выручка операторов",
            value: Money.format(store.totalRevenue),
            footer: [
                ("Работали", "\(working.count)"),
                ("Смен", "\(shifts)"),
                ("Лидер", working.first?.name ?? "—"),
            ],
            colors: Theme.heroGradient
        )
    }

    private func leaderboardCard(_ entries: [LeaderboardEntry]) -> some View {
        OwnerSection("Таблица лидеров") {
            Text("по выручке")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textDim)
        } content: {
            VStack(spacing: Spacing.sm) {
                ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                    LeaderboardRowView(rank: index + 1, entry: entry, tint: OwnerTint.point(index))
                }
            }
        }
    }

    private func topChart(_ working: [LeaderboardEntry]) -> some View {
        let top = working.prefix(6).map {
            CategoryPoint(label: $0.name, value: $0.revenue, isHighlighted: $0.id == working.first?.id)
        }
        return CategoryBarChart(title: "Топ по выручке", points: Array(top), color: ChartPalette.series1)
    }
}

/// Строка лидерборда: место, человек, выручка, доля полосой и изменение к
/// прошлому периоду — как строка расходов по категориям в банке.
private struct LeaderboardRowView: View {
    let rank: Int
    let entry: LeaderboardEntry
    let tint: Color

    private var subtitle: String {
        guard entry.shifts > 0 else { return "нет смен за период" }
        return "\(entry.shifts) \(pluralize(entry.shifts, "смена", "смены", "смен")) · \(Money.format(entry.avgPerShift)) · \(Percent.format(entry.share))"
    }

    var body: some View {
        AmountRow(
            leading: {
                HStack(spacing: Spacing.sm) {
                    RankBadge(rank: rank)
                    PersonAvatar(name: entry.name, photoURL: entry.photoURL, size: 36)
                        .opacity(entry.revenue > 0 ? 1 : 0.55)
                }
            },
            title: entry.name,
            subtitle: subtitle,
            amount: entry.revenue > 0 ? Money.format(entry.revenue) : "—",
            change: entry.change,
            share: entry.revenue > 0 ? entry.share / 100 : nil,
            tint: tint
        )
    }
}

// ── Достижения операторов ────────────────────────────────────────────────────

@MainActor @Observable
final class AchievementsStore {
    private(set) var results: [AchievementResult]?
    private(set) var isLoading = false
    private(set) var error: APIError?
    private(set) var period: AnalyticsPeriod = .thisMonth

    private let service: PeopleAnalyticsService

    init(api: APIClient) { service = PeopleAnalyticsService(api: api) }

    var summary: [OperatorAchievement: Int] {
        OperatorAchievements.summary(results ?? [])
    }

    func select(period: AnalyticsPeriod) async {
        guard period != self.period else { return }
        self.period = period
        await load()
    }

    func load() async {
        isLoading = true
        defer { isLoading = false }

        let bounds = period.bounds()

        do {
            async let incomes = service.incomes(from: bounds.from, to: bounds.to)
            async let people = service.operators()

            let stats = OperatorAchievements.stats(
                incomes: try await incomes,
                operators: try await people
            )
            results = OperatorAchievements.compute(stats)
            error = nil
        } catch let apiError as APIError {
            error = apiError
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }
}

private extension OperatorAchievement {
    var icon: String {
        switch self {
        case .champion: "crown.fill"
        case .top3: "trophy.fill"
        case .millionaire: "sparkles"
        case .mega: "star.fill"
        case .marathoner: "medal.fill"
        case .iron: "flame.fill"
        case .premium: "rosette"
        case .major: "chart.pie.fill"
        }
    }

    /// Значки — украшение, а не статус. Красный и янтарный здесь читались бы
    /// как «проблема», поэтому награды раскрашены палитрой графиков.
    var tint: Color {
        switch self {
        case .champion: ChartPalette.series3
        case .top3: Theme.brand
        case .millionaire: Theme.positive
        case .mega: ChartPalette.series2
        case .marathoner: Theme.info
        case .iron: ChartPalette.series3
        case .premium: Theme.accent
        case .major: Theme.accent
        }
    }
}

/// Достижения: кто что получил и кому сколько осталось.
///
/// Правила пороговые и открытые — «миллион выручки», «20 смен». Они и должны
/// быть на виду: достижение, механику которого нельзя объяснить кассиру, не
/// мотивирует.
struct AchievementsScreen: View {
    @Environment(\.api) private var api
    @State private var store: AchievementsStore?

    var body: some View {
        Group {
            if let store {
                if let error = store.error, store.results == nil {
                    ErrorStateView(error: error) { Task { await store.load() } }
                } else if let results = store.results {
                    ScreenScroll { content(store, results) }
                } else {
                    LoadingRows(count: 6)
                }
            } else {
                LoadingRows(count: 6)
            }
        }
        .background(Theme.background)
        .navigationTitle("Достижения")
        .navigationDestination(for: AchievementRoute.self) { route in
            AchievementDetail(result: route.result)
        }
        .toolbar { LogoutToolbarItem() }
        .task {
            if store == nil {
                let created = AchievementsStore(api: api)
                store = created
                await created.load()
            }
        }
        .refreshable { await store?.load() }
    }

    @ViewBuilder
    private func content(_ store: AchievementsStore, _ results: [AchievementResult]) -> some View {
        VStack(spacing: Spacing.lg) {
            PeoplePeriodPicker(period: store.period) { period in
                Task { await store.select(period: period) }
            }

            if results.isEmpty {
                InlineEmpty(icon: "medal", text: "За период никто не работал", tint: Theme.textDim)
            } else {
                SplitDashboard {
                    peopleCard(results)
                } side: {
                    catalogCard(store.summary, people: results.count)
                }
            }
        }
    }

    private func peopleCard(_ results: [AchievementResult]) -> some View {
        OwnerSection("Операторы") {
            Text("\(results.count) \(pluralize(results.count, "человек", "человека", "человек"))")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textDim)
        } content: {
            VStack(spacing: Spacing.sm) {
                ForEach(results) { result in
                    NavigationLink(value: AchievementRoute(result: result)) {
                        AchievementRowView(result: result)
                    }
                    .buttonStyle(.pressable)
                }
            }
        }
    }

    /// Сколько человек получило каждое достижение — видно, какие пороги
    /// работают, а какие недостижимы и потому бесполезны.
    private func catalogCard(_ summary: [OperatorAchievement: Int], people: Int) -> some View {
        OwnerSection("Каталог") {
            Text("кто сколько получил")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textDim)
        } content: {
            VStack(spacing: Spacing.sm) {
                ForEach(OperatorAchievement.allCases) { achievement in
                    let count = summary[achievement] ?? 0
                    AmountRow(
                        leading: {
                            TintedIcon(systemName: achievement.icon, tint: count > 0 ? achievement.tint : Theme.textDim)
                        },
                        title: achievement.title,
                        subtitle: achievement.detail,
                        amount: "\(count) из \(people)",
                        // Полоса — доля людей с наградой: порог, который никто не
                        // берёт, виден сразу пустой строкой.
                        share: people > 0 ? Double(count) / Double(people) : 0,
                        tint: achievement.tint
                    )
                }
            }
        }
    }
}

/// Строка человека: место, имя и полученные значки.
private struct AchievementRowView: View {
    let result: AchievementResult

    var body: some View {
        HStack(spacing: Spacing.md) {
            RankBadge(rank: result.rank)
            PersonAvatar(name: result.stat.name, photoURL: result.stat.photoURL, size: 40)

            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                    Text(result.stat.name)
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                    Spacer(minLength: Spacing.sm)
                    Text(Money.format(result.stat.revenue))
                        .font(.system(size: 16, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                }

                HStack(spacing: Spacing.sm) {
                    if result.earned.isEmpty {
                        Text("пока без достижений")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textDim)
                    } else {
                        // Значки маленькими цветными кружками — как иконки
                        // категорий в банке, а не россыпью голых символов.
                        HStack(spacing: 4) {
                            ForEach(result.earned) { achievement in
                                TintedIcon(systemName: achievement.icon, tint: achievement.tint, size: 22)
                            }
                        }
                    }
                    Spacer(minLength: Spacing.sm)
                    Text("\(result.stat.shifts) \(pluralize(result.stat.shifts, "смена", "смены", "смен"))")
                        .font(.system(size: 13))
                        .monospacedDigit()
                        .foregroundStyle(Theme.textDim)
                }
            }

            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.textDim)
        }
        .padding(.vertical, Spacing.xs)
        .contentShape(Rectangle())
    }
}

/// Карточка человека: что получено и сколько осталось до остального.
private struct AchievementDetail: View {
    let result: AchievementResult

    var body: some View {
        ScreenScroll {
            VStack(spacing: Spacing.lg) {
                PersonProfileHeader(
                    name: result.stat.name,
                    photoURL: result.stat.photoURL,
                    subtitle: "\(result.rank)-е место · \(result.earned.count) из \(OperatorAchievement.allCases.count) достижений",
                    subtitleColor: result.rank <= 3 ? Theme.positive : Theme.textMuted
                )

                // Выручка — главная цифра: все пороги достижений считаются от
                // неё и от смен. Место и доля — подписи.
                HeroSummary(
                    title: "Выручка за период",
                    value: Money.format(result.stat.revenue),
                    footer: [
                        ("Место", "\(result.rank)"),
                        ("Смен", "\(result.stat.shifts)"),
                        ("Доля", Percent.format(result.stat.share)),
                    ],
                    colors: Theme.heroGradient
                )

                if !result.earned.isEmpty {
                    OwnerSection("Получено") {
                        Text("\(result.earned.count) из \(OperatorAchievement.allCases.count)")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textDim)
                    } content: {
                        VStack(alignment: .leading, spacing: Spacing.md) {
                            ForEach(result.earned) { achievement in
                                badge(achievement, isEarned: true)
                            }
                        }
                    }
                }

                if !result.locked.isEmpty {
                    OwnerSection("Осталось") {
                        VStack(alignment: .leading, spacing: Spacing.md) {
                            ForEach(result.locked) { achievement in
                                badge(achievement, isEarned: false)
                            }
                        }
                    }
                }
            }
        }
        .background(Theme.background)
        .navigationTitle(result.stat.name)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }

    @ViewBuilder
    private func badge(_ achievement: OperatorAchievement, isEarned: Bool) -> some View {
        let progress = isEarned ? nil : achievement.progress(for: result.stat)

        HStack(alignment: .top, spacing: Spacing.md) {
            TintedIcon(systemName: achievement.icon, tint: isEarned ? achievement.tint : Theme.textDim)

            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(achievement.title)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(isEarned ? Theme.text : Theme.textMuted)
                Text(achievement.detail)
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
                    .fixedSize(horizontal: false, vertical: true)

                if let progress {
                    HStack(spacing: Spacing.sm) {
                        ProportionBar(ratio: progress.ratio, color: achievement.tint)
                            .frame(maxWidth: 140)
                        Text(Percent.format(progress.ratio * 100))
                            .font(Typography.caption)
                            .monospacedDigit()
                            .foregroundStyle(Theme.textDim)
                    }
                }
            }

            Spacer(minLength: 0)

            if isEarned {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.positive)
            }
        }
    }
}

/// Адрес карточки сотрудника в «Эффективности».
///
/// По значению, а не замыканием: список перечитывается сам, и переход,
/// созданный замыканием, схлопывался вместе с пересборкой.
struct PerformanceRoute: Hashable {
    let item: PerformanceRankingItem
}

/// Адрес карточки достижения.
struct AchievementRoute: Hashable {
    let result: AchievementResult
}


