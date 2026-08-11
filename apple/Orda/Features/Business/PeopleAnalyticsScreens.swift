import OrdaKit
import OrdaUI
import SwiftUI

// ── Общее для разделов «по людям» ────────────────────────────────────────────

/// Переключатель периода.
///
/// Периоды календарные, а не «последние N дней»: премию и место в рейтинге
/// владелец объявляет за месяц или неделю, и скользящее окно с этим разговором
/// не стыкуется.
private struct PeoplePeriodPicker: View {
    let period: PeoplePeriod
    let select: (PeoplePeriod) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Spacing.sm) {
                ForEach(PeoplePeriod.allCases) { candidate in
                    FilterChip(title: candidate.label, isOn: candidate == period) {
                        select(candidate)
                    }
                }
            }
        }
        .scrollClipDisabled()
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

/// Кружок с фото или инициалами — для людей, у которых нет `TeamOperator`.
private struct PersonAvatar: View {
    let name: String
    let photoURL: String?
    var size: CGFloat = 32

    private var initials: String {
        name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined().uppercased()
    }

    var body: some View {
        Thumbnail(url: photoURL, side: size, cornerRadius: size / 2, fallbackText: initials)
            .overlay(Circle().stroke(Theme.border, lineWidth: 0.5))
    }
}

/// Стрелка изменения к прошлому периоду.
private struct DeltaLabel: View {
    let change: Double?

    var body: some View {
        if let change {
            let up = change >= 0
            HStack(spacing: 1) {
                Image(systemName: up ? "arrow.up" : "arrow.down")
                    .font(.system(size: 9, weight: .bold))
                Text(Percent.format(abs(change)))
                    .font(Typography.caption.weight(.medium))
                    .monospacedDigit()
            }
            .foregroundStyle(up ? Theme.positive : Theme.negative)
        } else {
            Text("—")
                .font(Typography.caption)
                .foregroundStyle(Theme.textDim)
        }
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

    private(set) var period: PeoplePeriod = .thisMonth
    private(set) var companyID = ""

    private let service: PeopleAnalyticsService

    init(api: APIClient) { service = PeopleAnalyticsService(api: api) }

    var companyName: String {
        companies.first { $0.id == companyID }?.name ?? "Все точки"
    }

    func select(period: PeoplePeriod) async {
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

    private func metrics(_ report: PerformanceRanking) -> some View {
        let people = report.qualified
        let above = people.filter { $0.pi >= 1.05 }.count
        let norm = people.filter { $0.pi >= 0.95 && $0.pi < 1.05 }.count
        let below = people.filter { $0.pi < 0.95 }.count

        return DashboardGrid {
            MetricTile(
                label: "Средний PI",
                value: report.averagePI.map { String(format: "%.2f", $0) } ?? "—",
                icon: "speedometer",
                accent: Theme.brand
            )
            MetricTile(
                label: "Выше нормы",
                value: "\(above)",
                icon: "arrow.up.right",
                accent: Theme.positive
            )
            MetricTile(
                label: "В норме",
                value: "\(norm)",
                icon: "equal",
                accent: Theme.textMuted
            )
            MetricTile(
                label: "Ниже нормы",
                value: "\(below)",
                icon: "arrow.down.right",
                accent: below > 0 ? Theme.warning : Theme.positive
            )
        }
    }

    private func rankingCard(_ store: PerformanceStore, _ report: PerformanceRanking) -> some View {
        let people = report.qualified

        return Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader(
                    "Рейтинг",
                    subtitle: "\(people.count) \(pluralize(people.count, "оператор", "оператора", "операторов"))"
                )

                if people.isEmpty {
                    InlineEmpty(
                        icon: "hourglass",
                        text: "Ни у кого нет \(report.minQualifyingShifts) смен — сравнивать пока не с чем",
                        tint: Theme.textDim
                    )
                } else {
                    ForEach(Array(people.enumerated()), id: \.element.id) { index, item in
                        if index > 0 { RowDivider() }
                        NavigationLink {
                            PerformanceDetail(item: item, companies: store.companies)
                        } label: {
                            PerformanceRowView(
                                rank: index + 1,
                                item: item,
                                previousPI: store.previousPI[item.operatorID]
                            )
                        }
                        .buttonStyle(.plain)
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
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader(
                        "Мало смен",
                        subtitle: "меньше \(report.minQualifyingShifts) — в рейтинг не идут"
                    )
                    ForEach(people) { item in
                        StatRow(
                            item.displayName,
                            value: "\(item.shifts) \(pluralize(item.shifts, "смена", "смены", "смен"))",
                            valueColor: Theme.textMuted,
                            icon: "person"
                        )
                    }
                }
            }
        }
    }

    private func baselineCard(_ report: PerformanceRanking) -> some View {
        let baseline = report.baseline

        return Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Как считается", subtitle: "PI = факт ÷ норма смены")

                Text("Норма — медианная выручка этого же слота: та же точка, тот же день недели, та же смена. Собственные смены оператора в норму не входят.")
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
private struct PerformanceRowView: View {
    let rank: Int
    let item: PerformanceRankingItem
    let previousPI: Double?

    private var tint: Color {
        switch item.grade {
        case .excellent, .good: Theme.positive
        case .norm: Theme.textMuted
        case .below: Theme.warning
        case .weak: Theme.negative
        }
    }

    private var chipKind: StatusChip.Kind {
        switch item.grade {
        case .excellent, .good: .good
        case .norm: .neutral
        case .below: .warning
        case .weak: .danger
        }
    }

    var body: some View {
        HStack(spacing: Spacing.md) {
            RankBadge(rank: rank)

            VStack(alignment: .leading, spacing: 1) {
                Text(item.displayName)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text("\(item.shifts) \(pluralize(item.shifts, "смена", "смены", "смен")) · \(Money.format(item.totalRevenue))")
                    .font(Typography.caption)
                    .monospacedDigit()
                    .foregroundStyle(Theme.textDim)
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 2) {
                Text(String(format: "%.2f", item.pi))
                    .font(Typography.headline)
                    .monospacedDigit()
                    .foregroundStyle(tint)
                // Сверх нормы — то, ради чего раздел и открывают: это деньги,
                // которых без этого человека не было бы.
                Text(Money.signed(item.aboveNorm))
                    .font(Typography.caption)
                    .monospacedDigit()
                    .foregroundStyle(item.aboveNorm >= 0 ? Theme.positive : Theme.negative)
            }

            if let previousPI {
                DeltaLabel(change: Percent.change(current: item.pi, previous: previousPI))
                    .frame(width: 44, alignment: .trailing)
            }

            StatusChip(item.grade.label, kind: chipKind)
        }
        .padding(.vertical, Spacing.xs)
        .contentShape(Rectangle())
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
                DashboardGrid {
                    MetricTile(
                        label: "PI",
                        value: String(format: "%.2f", item.pi),
                        icon: "speedometer",
                        accent: Theme.brand
                    )
                    MetricTile(
                        label: "Сверх нормы",
                        value: Money.format(item.aboveNorm),
                        icon: "plusminus",
                        accent: item.aboveNorm >= 0 ? Theme.positive : Theme.negative
                    )
                    MetricTile(
                        label: "Выручка",
                        value: Money.format(item.totalRevenue),
                        icon: "banknote.fill",
                        accent: Theme.info
                    )
                    MetricTile(
                        label: "В среднем за смену",
                        value: Money.format(item.avgRevenuePerShift),
                        icon: "chart.bar.fill",
                        accent: Theme.textMuted
                    )
                }

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

    private var shiftsCard: some View {
        let shifts = item.shiftDetails.sorted { $0.date > $1.date }

        return Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Смены", subtitle: "факт против нормы слота")

                ForEach(Array(shifts.enumerated()), id: \.element.id) { index, shift in
                    if index > 0 { RowDivider() }
                    shiftRow(shift)
                }
            }
        }
    }

    private func shiftRow(_ shift: PerformanceShift) -> some View {
        HStack(spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: Spacing.xs) {
                    Text(shift.day?.formatted(.dateTime.day().month(.abbreviated)) ?? shift.date)
                        .font(Typography.callout)
                        .foregroundStyle(Theme.text)
                    Image(systemName: shift.isNight ? "moon.fill" : "sun.max.fill")
                        .font(.system(size: 10))
                        .foregroundStyle(shift.isNight ? Theme.info : Theme.warning)
                }
                Text(companyName(shift.companyID))
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 1) {
                Text(Money.format(shift.actual))
                    .font(Typography.callout.weight(.medium))
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
    private(set) var period: PeoplePeriod = .thisMonth

    private let service: PeopleAnalyticsService

    init(api: APIClient) { service = PeopleAnalyticsService(api: api) }

    var totalRevenue: Double { (entries ?? []).reduce(0) { $0 + $1.revenue } }

    func select(period: PeoplePeriod) async {
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

    private func metrics(_ store: RatingsStore, _ working: [LeaderboardEntry]) -> some View {
        DashboardGrid {
            MetricTile(
                label: "Суммарная выручка",
                value: Money.format(store.totalRevenue),
                icon: "banknote.fill",
                accent: Theme.brand
            )
            MetricTile(
                label: "Работали",
                value: "\(working.count)",
                icon: "person.2.fill",
                accent: Theme.info
            )
            MetricTile(
                label: "Лидер",
                value: working.first?.name ?? "—",
                icon: "trophy.fill",
                accent: Theme.positive
            )
        }
    }

    private func leaderboardCard(_ entries: [LeaderboardEntry]) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Таблица лидеров", subtitle: "по выручке за период")

                ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                    if index > 0 { RowDivider() }
                    LeaderboardRowView(rank: index + 1, entry: entry)
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

/// Строка лидерборда.
private struct LeaderboardRowView: View {
    let rank: Int
    let entry: LeaderboardEntry

    var body: some View {
        HStack(spacing: Spacing.md) {
            RankBadge(rank: rank)
            PersonAvatar(name: entry.name, photoURL: entry.photoURL, size: 30)

            VStack(alignment: .leading, spacing: 3) {
                Text(entry.name)
                    .font(Typography.callout)
                    .foregroundStyle(entry.revenue > 0 ? Theme.text : Theme.textDim)
                    .lineLimit(1)

                if entry.revenue > 0 {
                    HStack(spacing: Spacing.sm) {
                        ProportionBar(ratio: entry.share / 100, color: Theme.brand)
                            .frame(maxWidth: 120)
                        Text(Percent.format(entry.share))
                            .font(Typography.caption)
                            .monospacedDigit()
                            .foregroundStyle(Theme.textDim)
                    }
                } else {
                    Text("нет смен за период")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                }
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 1) {
                Text(entry.revenue > 0 ? Money.format(entry.revenue) : "—")
                    .font(Typography.callout.weight(.medium))
                    .monospacedDigit()
                    .foregroundStyle(entry.revenue > 0 ? Theme.text : Theme.textDim)
                if entry.shifts > 0 {
                    Text("\(entry.shifts) \(pluralize(entry.shifts, "смена", "смены", "смен")) · \(Money.format(entry.avgPerShift))")
                        .font(Typography.caption)
                        .monospacedDigit()
                        .foregroundStyle(Theme.textDim)
                }
            }

            DeltaLabel(change: entry.change)
                .frame(width: 44, alignment: .trailing)
        }
        .padding(.vertical, Spacing.xs)
    }
}

// ── Достижения операторов ────────────────────────────────────────────────────

@MainActor @Observable
final class AchievementsStore {
    private(set) var results: [AchievementResult]?
    private(set) var isLoading = false
    private(set) var error: APIError?
    private(set) var period: PeoplePeriod = .thisMonth

    private let service: PeopleAnalyticsService

    init(api: APIClient) { service = PeopleAnalyticsService(api: api) }

    var summary: [OperatorAchievement: Int] {
        OperatorAchievements.summary(results ?? [])
    }

    func select(period: PeoplePeriod) async {
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
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader(
                    "Операторы",
                    subtitle: "\(results.count) \(pluralize(results.count, "человек", "человека", "человек")) за период"
                )

                ForEach(Array(results.enumerated()), id: \.element.id) { index, result in
                    if index > 0 { RowDivider() }
                    NavigationLink {
                        AchievementDetail(result: result)
                    } label: {
                        AchievementRowView(result: result)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    /// Сколько человек получило каждое достижение — видно, какие пороги
    /// работают, а какие недостижимы и потому бесполезны.
    private func catalogCard(_ summary: [OperatorAchievement: Int], people: Int) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Каталог", subtitle: "кто сколько раз получил")

                ForEach(OperatorAchievement.allCases) { achievement in
                    let count = summary[achievement] ?? 0
                    HStack(spacing: Spacing.md) {
                        Image(systemName: achievement.icon)
                            .font(.system(size: 13))
                            .foregroundStyle(count > 0 ? achievement.tint : Theme.textDim)
                            .frame(width: 20)

                        VStack(alignment: .leading, spacing: 1) {
                            Text(achievement.title)
                                .font(Typography.callout)
                                .foregroundStyle(Theme.text)
                            Text(achievement.detail)
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textDim)
                                .lineLimit(2)
                        }

                        Spacer(minLength: Spacing.sm)

                        Text("\(count) из \(people)")
                            .font(Typography.caption)
                            .monospacedDigit()
                            .foregroundStyle(count > 0 ? Theme.textMuted : Theme.textDim)
                    }
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
            PersonAvatar(name: result.stat.name, photoURL: result.stat.photoURL, size: 30)

            VStack(alignment: .leading, spacing: 2) {
                Text(result.stat.name)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)

                if result.earned.isEmpty {
                    Text("пока без достижений")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                } else {
                    HStack(spacing: Spacing.xs) {
                        ForEach(result.earned) { achievement in
                            Image(systemName: achievement.icon)
                                .font(.system(size: 11))
                                .foregroundStyle(achievement.tint)
                        }
                    }
                }
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 1) {
                Text(Money.format(result.stat.revenue))
                    .font(Typography.callout.weight(.medium))
                    .monospacedDigit()
                    .foregroundStyle(Theme.text)
                Text("\(result.stat.shifts) \(pluralize(result.stat.shifts, "смена", "смены", "смен"))")
                    .font(Typography.caption)
                    .monospacedDigit()
                    .foregroundStyle(Theme.textDim)
            }
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
                DashboardGrid {
                    MetricTile(
                        label: "Место",
                        value: "\(result.rank)",
                        icon: "number",
                        accent: result.rank <= 3 ? Theme.positive : Theme.textMuted
                    )
                    MetricTile(
                        label: "Выручка",
                        value: Money.format(result.stat.revenue),
                        icon: "banknote.fill",
                        accent: Theme.brand
                    )
                    MetricTile(
                        label: "Смен",
                        value: "\(result.stat.shifts)",
                        icon: "calendar",
                        accent: Theme.info
                    )
                    MetricTile(
                        label: "Доля выручки",
                        value: Percent.format(result.stat.share),
                        icon: "chart.pie.fill",
                        accent: Theme.accent
                    )
                }

                if !result.earned.isEmpty {
                    Card {
                        VStack(alignment: .leading, spacing: Spacing.md) {
                            SectionHeader("Получено", subtitle: "\(result.earned.count) из \(OperatorAchievement.allCases.count)")
                            ForEach(result.earned) { achievement in
                                badge(achievement, isEarned: true)
                            }
                        }
                    }
                }

                if !result.locked.isEmpty {
                    Card {
                        VStack(alignment: .leading, spacing: Spacing.md) {
                            SectionHeader("Осталось")
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
            Image(systemName: achievement.icon)
                .font(.system(size: 16))
                .foregroundStyle(isEarned ? achievement.tint : Theme.textDim)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(achievement.title)
                    .font(Typography.callout.weight(.medium))
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
