import OrdaKit
import OrdaUI
import SwiftUI

// ── Общее ────────────────────────────────────────────────────────────────────

/// Дата в формате API по местному календарю.
///
/// Не `DateParsing.dateOnlyString`: она разбирает дату в UTC, а «сегодня» у
/// владельца местное. В UTC+5 период иначе заканчивался бы вчера, и выручка
/// текущего дня в налог не попадала бы.
private func localDayString(_ date: Date) -> String {
    let parts = Calendar.current.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
}

/// Период налогового расчёта.
///
/// Год с начала — основной: и ставка ИПН, и пороги НДС считаются нарастающим
/// итогом с 1 января, а не за скользящее окно.
private enum TaxPeriod: String, CaseIterable, Identifiable {
    case year, quarter, month

    var id: String { rawValue }

    var label: String {
        switch self {
        case .year: "С начала года"
        case .quarter: "Квартал"
        case .month: "Месяц"
        }
    }

    var bounds: (from: String, to: String) {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        let start: Date = switch self {
        case .year: calendar.date(from: calendar.dateComponents([.year], from: today)) ?? today
        case .quarter: calendar.date(byAdding: .month, value: -2, to: startOfMonth(today)) ?? today
        case .month: startOfMonth(today)
        }
        return (localDayString(start), localDayString(today))
    }

    private func startOfMonth(_ date: Date) -> Date {
        let calendar = Calendar.current
        return calendar.date(from: calendar.dateComponents([.year, .month], from: date)) ?? date
    }
}

// ── Налоги ───────────────────────────────────────────────────────────────────

@MainActor @Observable
final class TaxStore {
    private(set) var summary: TaxSummary?
    private(set) var isLoading = false
    private(set) var error: APIError?

    private let service: TaxService

    init(api: APIClient) { service = TaxService(api: api) }

    func load(from: String, to: String, rate: Double) async {
        isLoading = true
        defer { isLoading = false }
        do {
            summary = try await service.load(from: from, to: to, rate: rate)
            error = nil
        } catch let apiError as APIError {
            error = apiError
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }
}

/// Налоги ИП на упрощёнке: сколько отдать в бюджет и близко ли порог НДС.
///
/// Все величины считает сервер общей с сайтом функцией: по этой цифре платят,
/// и вторая реализация формулы означала бы два разных налога за один период.
/// Здесь остаётся выбор периода и ставки — её устанавливает маслихат, и в
/// коде она не константа.
struct TaxScreen: View {
    @Environment(\.api) private var api

    @State private var store: TaxStore?
    @State private var period: TaxPeriod = .year
    @State private var rate: Double = 2

    var body: some View {
        ScreenScroll {
            VStack(spacing: Spacing.lg) {
                Picker("Период", selection: $period) {
                    ForEach(TaxPeriod.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)

                if let store {
                    if let error = store.error, store.summary == nil {
                        ErrorStateView(error: error) { Task { await reload() } }
                    } else if let summary = store.summary {
                        content(summary)
                    } else {
                        loadingState
                    }
                } else {
                    loadingState
                }
            }
        }
        .background(Theme.background)
        .navigationTitle("Налоги")
        .toolbar { LogoutToolbarItem() }
        .task {
            if store == nil {
                let created = TaxStore(api: api)
                store = created
                let bounds = period.bounds
                await created.load(from: bounds.from, to: bounds.to, rate: rate)
            }
        }
        .onChange(of: period) { _, _ in Task { await reload() } }
        .onChange(of: rate) { _, _ in Task { await reload() } }
        .refreshable { await reload() }
    }

    private func reload() async {
        let bounds = period.bounds
        await store?.load(from: bounds.from, to: bounds.to, rate: rate)
    }

    private var loadingState: some View {
        VStack(spacing: Spacing.lg) {
            Skeleton(height: 120, cornerRadius: Radius.lg)
            Skeleton(height: 200, cornerRadius: Radius.lg)
            Skeleton(height: 180, cornerRadius: Radius.lg)
        }
    }

    @ViewBuilder
    private func content(_ summary: TaxSummary) -> some View {
        VStack(spacing: Spacing.lg) {
            burden(summary)
            rates(summary.constants)

            DashboardGrid {
                MetricTile(
                    label: "Облагаемый оборот",
                    value: Money.format(summary.revenue),
                    icon: "arrow.down.circle.fill",
                    accent: Theme.brand
                )
                MetricTile(
                    label: "ИПН \(Percent.format(summary.rate))",
                    value: Money.format(summary.ipn),
                    icon: "percent",
                    accent: Theme.info
                )
                MetricTile(
                    label: "Соцплатежи за себя",
                    value: Money.format(summary.selfSocial),
                    icon: "person.fill",
                    accent: Theme.accent
                )
                MetricTile(
                    label: "За работников",
                    value: Money.format(summary.burden.payrollTaxes),
                    icon: "person.3.fill",
                    accent: Theme.accent
                )
            }

            SplitDashboard {
                monthsChart(summary)
                thresholds(summary.year)
            } side: {
                breakdown(summary)
                payroll(summary.payroll)
            }
        }
    }

    // ── Итоговая цифра ───────────────────────────────────────────────────────

    private func burden(_ summary: TaxSummary) -> some View {
        Card(accent: Theme.brand) {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Text("К уплате за период")
                    .font(Typography.label)
                    .foregroundStyle(Theme.textDim)
                    .textCase(.uppercase)

                Text(Money.format(summary.burden.total))
                    .font(Typography.hero)
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)

                Text("Нагрузка \(Percent.format(summary.burden.effectiveRate)) от оборота")
                    .font(Typography.callout)
                    .foregroundStyle(Theme.textMuted)

                if !summary.excludedCompanies.isEmpty {
                    let names = summary.excludedCompanies.map(\.name).joined(separator: ", ")
                    Text("Без учёта: \(names)")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                }
            }
        }
    }

    // ── Ставка ───────────────────────────────────────────────────────────────

    private func rates(_ constants: TaxConstants) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Ставка ИПН", subtitle: "устанавливает маслихат")
                HStack(spacing: Spacing.sm) {
                    ForEach(constants.allowedRates, id: \.self) { value in
                        FilterChip(title: Percent.format(value), isOn: value == rate) {
                            rate = value
                        }
                    }
                }
            }
        }
    }

    // ── Разбор ───────────────────────────────────────────────────────────────

    private func breakdown(_ summary: TaxSummary) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Из чего складывается")

                StatRow("Облагаемый оборот", value: Money.format(summary.revenue), icon: "arrow.down")
                StatRow("ИПН \(Percent.format(summary.rate))", value: Money.format(summary.ipn), icon: "percent")
                StatRow(
                    "Соцплатежи за себя",
                    value: Money.format(summary.selfSocial),
                    icon: "person"
                )
                if summary.monthsCount > 0 {
                    Text("\(Money.format(summary.constants.selfSocialMonthly)) × \(pluralize(summary.monthsCount, "месяц", "месяца", "месяцев"))")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                if summary.burden.payrollTaxes > 0 {
                    StatRow(
                        "Налоги за работников",
                        value: Money.format(summary.burden.payrollTaxes),
                        icon: "person.3"
                    )
                }

                RowDivider()
                StatRow("Всего в бюджет", value: Money.format(summary.burden.total), emphasized: true)
            }
        }
    }

    // ── Помесячно ────────────────────────────────────────────────────────────

    @ViewBuilder
    private func monthsChart(_ summary: TaxSummary) -> some View {
        let points = summary.months.compactMap { month -> TimePoint? in
            guard let date = month.date else { return nil }
            return TimePoint(label: month.label, date: date, value: month.total)
        }

        if points.count > 1 {
            TrendChart(
                title: "Налог по месяцам",
                subtitle: "ИПН вместе с соцплатежами",
                points: points,
                color: ChartPalette.series2
            )
        } else {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("Налог по месяцам")
                    InlineEmpty(icon: "calendar", text: "Для графика мало месяцев", tint: Theme.textDim)
                }
            }
        }
    }

    // ── Пороги ───────────────────────────────────────────────────────────────

    private func thresholds(_ outlook: TaxYearOutlook) -> some View {
        Card(accent: outlook.vatRisk ? Theme.warning : nil) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Порог НДС", subtitle: "оборот с начала года") {
                    StatusChip(
                        outlook.vatRisk ? "Темп выводит за порог" : "В пределах порога",
                        kind: outlook.vatRisk ? .warning : .good
                    )
                }

                ProportionBar(
                    ratio: outlook.vatProgress,
                    color: outlook.vatRisk ? Theme.warning : Theme.brand
                )

                StatRow("Оборот с начала года", value: Money.format(outlook.yearRevenue), icon: "sum")
                StatRow("Порог", value: Money.format(outlook.vatThreshold), icon: "flag")
                StatRow(
                    "Осталось до порога",
                    value: Money.format(outlook.vatRemaining),
                    valueColor: outlook.vatRemaining > 0 ? Theme.text : Theme.negative,
                    icon: "gauge"
                )
                RowDivider()
                StatRow(
                    "Прогноз на конец года",
                    value: Money.format(outlook.projected),
                    valueColor: outlook.vatRisk ? Theme.warning : Theme.text,
                    icon: "chart.line.uptrend.xyaxis"
                )

                if outlook.simplifiedRisk {
                    Text("Темп выводит и за предел упрощёнки — режим придётся менять.")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.negative)
                }
            }
        }
    }

    // ── Работники ────────────────────────────────────────────────────────────

    @ViewBuilder
    private func payroll(_ payroll: TaxPayroll) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader(
                    "Налоги за работников",
                    subtitle: payroll.employees > 0
                        ? pluralize(payroll.employees, "работник", "работника", "работников")
                        : nil
                )

                if payroll.employees == 0 {
                    InlineEmpty(icon: "person.3", text: "Штатных окладов нет", tint: Theme.textDim)
                } else {
                    StatRow("Фонд оплаты труда", value: Money.format(payroll.gross), icon: "banknote")
                    StatRow("Удержано с работников", value: Money.format(payroll.withheld), icon: "arrow.down.left")
                    StatRow("Сверху за счёт ИП", value: Money.format(payroll.employerTop), icon: "arrow.up.right")
                    RowDivider()
                    StatRow("В бюджет за месяц", value: Money.format(payroll.monthlyTax), emphasized: true)
                    StatRow("Расход на штат", value: Money.format(payroll.totalCost), icon: "creditcard")
                }
            }
        }
    }
}

// ── Движение денег ───────────────────────────────────────────────────────────

@MainActor @Observable
final class CashflowStore {
    private(set) var report: CashflowReport?
    private(set) var isLoading = false
    private(set) var error: APIError?

    private let service: CashflowService

    init(api: APIClient) { service = CashflowService(api: api) }

    func load(range: DateRange) async {
        isLoading = true
        defer { isLoading = false }
        do {
            let bounds = range.bounds
            report = try await service.load(from: bounds.from, to: bounds.to)
            error = nil
        } catch let apiError as APIError {
            error = apiError
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }
}

/// Движение денег по дням: сколько пришло, сколько ушло, что накопилось.
///
/// Отличается от «Отчётов» тем, что показывает не итог периода, а его форму:
/// в какие дни касса проседала и когда. Накопительный баланс считает сервер —
/// на клиенте он разошёлся бы с сайтом на первой же строке без даты.
struct CashflowScreen: View {
    @Environment(\.api) private var api

    @State private var store: CashflowStore?
    @State private var range: DateRange = .month

    var body: some View {
        ScreenScroll {
            VStack(spacing: Spacing.lg) {
                Picker("Период", selection: $range) {
                    ForEach(DateRange.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)

                if let store {
                    if let error = store.error, store.report == nil {
                        ErrorStateView(error: error) { Task { await store.load(range: range) } }
                    } else if let report = store.report {
                        content(report)
                    } else {
                        loadingState
                    }
                } else {
                    loadingState
                }
            }
        }
        .background(Theme.background)
        .navigationTitle("Движение денег")
        .toolbar { LogoutToolbarItem() }
        .task {
            if store == nil {
                let created = CashflowStore(api: api)
                store = created
                await created.load(range: range)
            }
        }
        .onChange(of: range) { _, new in Task { await store?.load(range: new) } }
        .refreshable { await store?.load(range: range) }
    }

    private var loadingState: some View {
        VStack(spacing: Spacing.lg) {
            Skeleton(height: 96, cornerRadius: Radius.lg)
            Skeleton(height: 240, cornerRadius: Radius.lg)
            Skeleton(height: 180, cornerRadius: Radius.lg)
        }
    }

    @ViewBuilder
    private func content(_ report: CashflowReport) -> some View {
        if report.days.isEmpty {
            WideEmptyState(
                icon: "arrow.left.arrow.right",
                title: "Движений нет",
                message: "За выбранный период не было ни доходов, ни расходов."
            )
        } else {
            let totals = report.totals

            VStack(spacing: Spacing.lg) {
                DashboardGrid {
                    MetricTile(
                        label: "Пришло",
                        value: Money.format(totals.income),
                        icon: "arrow.down.circle.fill",
                        accent: Theme.brand
                    )
                    MetricTile(
                        label: "Ушло",
                        value: Money.format(totals.expense),
                        icon: "arrow.up.circle.fill",
                        accent: Theme.negative
                    )
                    MetricTile(
                        label: "Чистый поток",
                        value: Money.format(totals.net),
                        icon: "chart.line.uptrend.xyaxis",
                        accent: totals.net >= 0 ? Theme.positive : Theme.negative
                    )
                    MetricTile(
                        label: "Баланс на конец",
                        value: Money.format(totals.endingBalance),
                        icon: "wallet.pass",
                        accent: totals.endingBalance >= 0 ? Theme.info : Theme.negative
                    )
                }

                balanceChart(report)

                SplitDashboard {
                    days(report)
                } side: {
                    highlights(report)
                }
            }
        }
    }

    private func balanceChart(_ report: CashflowReport) -> some View {
        let points = report.days.compactMap { item -> TimePoint? in
            guard let date = item.day else { return nil }
            return TimePoint(label: item.label, date: date, value: item.balance)
        }

        return Group {
            if points.count > 1 {
                TrendChart(
                    title: "Накопительный баланс",
                    subtitle: "нарастающим итогом с начала периода",
                    points: points,
                    color: ChartPalette.series2
                )
            } else {
                Card {
                    InlineEmpty(icon: "chart.xyaxis.line", text: "Для графика мало дней", tint: Theme.textDim)
                }
            }
        }
    }

    private func highlights(_ report: CashflowReport) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Чем запомнился период")

                StatRow(
                    "Маржа",
                    value: Percent.format(report.totals.margin),
                    valueColor: report.totals.margin >= 0 ? Theme.text : Theme.negative,
                    icon: "percent"
                )
                StatRow(
                    "Дней в минусе",
                    value: "\(report.totals.negativeDays) из \(report.totals.daysCount)",
                    valueColor: report.totals.negativeDays > 0 ? Theme.warning : Theme.text,
                    icon: "exclamationmark.triangle"
                )

                if let best = report.bestDay, best.net > 0 {
                    RowDivider()
                    StatRow(
                        "Лучший день · \(best.label)",
                        value: Money.signed(best.net),
                        valueColor: Theme.positive,
                        icon: "arrow.up.forward"
                    )
                }
                if let worst = report.worstDay {
                    StatRow(
                        "Худший день · \(worst.label)",
                        value: Money.signed(worst.net),
                        valueColor: Theme.negative,
                        icon: "arrow.down.forward"
                    )
                }
            }
        }
    }

    private func days(_ report: CashflowReport) -> some View {
        // Свежие дни сверху: к старым владелец возвращается редко, а листать
        // весь квартал ради вчерашнего дня — работа.
        let rows = report.days.reversed().prefix(30)

        return Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("По дням", subtitle: "последние сверху")

                ForEach(Array(rows.enumerated()), id: \.element.id) { index, day in
                    if index > 0 { RowDivider() }
                    DayCashRow(day: day)
                }
            }
        }
    }
}

/// Строка дня: приход, расход и итог.
private struct DayCashRow: View {
    let day: CashflowDay

    var body: some View {
        HStack(spacing: Spacing.md) {
            Text(day.label)
                .font(Typography.callout)
                .foregroundStyle(Theme.text)
                .frame(width: 72, alignment: .leading)

            VStack(alignment: .leading, spacing: 1) {
                Text("\(Money.format(day.income)) · \(Money.format(day.expense))")
                    .font(Typography.caption)
                    .monospacedDigit()
                    .foregroundStyle(Theme.textDim)
                ProportionBar(
                    ratio: day.income > 0 ? min(1, day.expense / day.income) : 1,
                    color: day.net >= 0 ? Theme.brand : Theme.negative
                )
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 1) {
                Text(Money.signed(day.net))
                    .font(Typography.callout.weight(.medium))
                    .monospacedDigit()
                    .foregroundStyle(day.net >= 0 ? Theme.text : Theme.negative)
                Text(Money.format(day.balance))
                    .font(Typography.caption)
                    .monospacedDigit()
                    .foregroundStyle(Theme.textDim)
            }
        }
        .padding(.vertical, Spacing.xs)
    }
}

// ── Цели и планы ─────────────────────────────────────────────────────────────

@MainActor @Observable
final class GoalsStore {
    private(set) var board: GoalsBoard?
    private(set) var isLoading = false
    private(set) var error: APIError?

    private let service: GoalsService

    init(api: APIClient) { service = GoalsService(api: api) }

    func load(year: Int) async {
        isLoading = true
        defer { isLoading = false }
        do {
            board = try await service.load(year: year)
            error = nil
        } catch let apiError as APIError {
            error = apiError
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }
}

/// Планы по выручке, прибыли и чекам вместе с фактом.
///
/// Факт и процент выполнения приходят с сервера: это та же выручка, что в
/// отчётах, собранная теми же правилами. Пересчитывать её здесь значило бы
/// показывать цель выполненной там, где на сайте она не выполнена.
struct GoalsScreen: View {
    @Environment(\.api) private var api

    @State private var store: GoalsStore?
    @State private var year = Calendar.current.component(.year, from: Date())

    private var years: [Int] {
        let current = Calendar.current.component(.year, from: Date())
        return [current - 1, current]
    }

    var body: some View {
        ScreenScroll {
            VStack(spacing: Spacing.lg) {
                Picker("Год", selection: $year) {
                    ForEach(years, id: \.self) { Text(String($0)).tag($0) }
                }
                .pickerStyle(.segmented)

                if let store {
                    if let error = store.error, store.board == nil {
                        ErrorStateView(error: error) { Task { await store.load(year: year) } }
                    } else if let board = store.board {
                        content(board)
                    } else {
                        LoadingRows(count: 5)
                    }
                } else {
                    LoadingRows(count: 5)
                }
            }
        }
        .background(Theme.background)
        .navigationTitle("Цели и планы")
        .toolbar { LogoutToolbarItem() }
        .task {
            if store == nil {
                let created = GoalsStore(api: api)
                store = created
                await created.load(year: year)
            }
        }
        .onChange(of: year) { _, new in Task { await store?.load(year: new) } }
        .refreshable { await store?.load(year: year) }
    }

    @ViewBuilder
    private func content(_ board: GoalsBoard) -> some View {
        if board.plans.isEmpty {
            WideEmptyState(
                icon: "target",
                title: "Планов на \(String(year)) нет",
                message: "Цели по выручке, прибыли и чекам задаются на сайте, в разделе «Цели»."
            )
        } else {
            let plans = board.sortedPlans
            let open = plans.filter { !$0.isClosed }
            let closed = plans.filter(\.isClosed)

            VStack(spacing: Spacing.lg) {
                DashboardGrid {
                    MetricTile(
                        label: "Планов на год",
                        value: "\(plans.count)",
                        icon: "target",
                        accent: Theme.brand
                    )
                    MetricTile(
                        label: "В работе",
                        value: "\(open.count)",
                        icon: "hourglass",
                        accent: Theme.info
                    )
                    MetricTile(
                        label: "Выполнено",
                        value: "\(plans.filter(\.isDone).count)",
                        icon: "checkmark.seal.fill",
                        accent: Theme.positive
                    )
                    MetricTile(
                        label: "Закрытых периодов",
                        value: "\(closed.count)",
                        icon: "lock.fill",
                        accent: Theme.textDim
                    )
                }

                SplitDashboard {
                    plansCard("В работе", plans: open, board: board, empty: "Открытых планов нет")
                } side: {
                    plansCard("Закрытые периоды", plans: closed, board: board, empty: "Закрытых планов пока нет")
                }
            }
        }
    }

    private func plansCard(
        _ title: String,
        plans: [GoalPlan],
        board: GoalsBoard,
        empty: String
    ) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader(title)

                if plans.isEmpty {
                    InlineEmpty(icon: "target", text: empty, tint: Theme.textDim)
                } else {
                    ForEach(Array(plans.enumerated()), id: \.element.id) { index, plan in
                        if index > 0 { RowDivider() }
                        GoalPlanRow(plan: plan, companyName: board.companyName(plan.companyID))
                    }
                }
            }
        }
    }
}

/// Строка плана: метрика, период, точка и полоса выполнения.
private struct GoalPlanRow: View {
    let plan: GoalPlan
    let companyName: String

    private var tint: Color {
        if plan.isDone { return Theme.positive }
        if plan.isClosed { return Theme.negative }
        return Theme.brand
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack(spacing: Spacing.sm) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("\(plan.metricLabel) · \(plan.periodLabel)")
                        .font(Typography.callout.weight(.medium))
                        .foregroundStyle(Theme.text)
                    Text(companyName)
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                        .lineLimit(1)
                }

                Spacer(minLength: Spacing.sm)

                StatusChip(Percent.format(plan.achievement), kind: chipKind)
            }

            ProportionBar(ratio: plan.progress, color: tint)

            HStack {
                Text("Факт \(plan.formattedFact)")
                    .font(Typography.caption)
                    .monospacedDigit()
                    .foregroundStyle(Theme.textMuted)
                Spacer(minLength: Spacing.sm)
                Text("План \(plan.formattedTarget)")
                    .font(Typography.caption)
                    .monospacedDigit()
                    .foregroundStyle(Theme.textDim)
            }
        }
        .padding(.vertical, Spacing.xs)
    }

    /// Закрытый период с недобором — уже не «в работе», а провал: цвет должен
    /// это говорить, иначе строка выглядит как незаконченная.
    private var chipKind: StatusChip.Kind {
        if plan.isDone { return .good }
        if plan.isClosed { return .danger }
        return plan.progress >= 0.7 ? .info : .warning
    }
}

// ── Недельный отчёт ──────────────────────────────────────────────────────────

@MainActor @Observable
final class WeeklyReportStore {
    private(set) var report: WeeklyReport?
    private(set) var isLoading = false
    private(set) var error: APIError?

    private let service: WeeklyReportService

    init(api: APIClient) { service = WeeklyReportService(api: api) }

    /// Воскресенье недели, начинающейся в `weekStart`.
    ///
    /// `PayWeek` умеет шагать только неделями — отдельного «плюс шесть дней»
    /// там нет и заводить его ради одного места незачем.
    private static func weekEnd(of weekStart: String) -> String {
        guard let start = DateParsing.parseDateOnly(weekStart) else { return weekStart }
        let calendar = Calendar(identifier: .iso8601)
        let end = calendar.date(byAdding: .day, value: 6, to: start) ?? start
        return DateParsing.dateOnlyString(from: end)
    }

    func load(week: String) async {
        isLoading = true
        defer { isLoading = false }
        do {
            report = try await service.load(from: week, to: Self.weekEnd(of: week))
            error = nil
        } catch let apiError as APIError {
            error = apiError
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }
}

/// Итоги недели по точкам: выручка, расходы, что осталось в кассе.
///
/// Считает сервер тем же роутом, которым печатается недельный акт: цифра в
/// телефоне и цифра в подписанном акте обязаны совпадать.
struct WeeklyReportScreen: View {
    @Environment(\.api) private var api

    @State private var store: WeeklyReportStore?
    @State private var week = PayWeek.start()
    @State private var expanded: String?

    var body: some View {
        ScreenScroll {
            VStack(spacing: Spacing.lg) {
                WeekStepper(week: $week)

                if let store {
                    if let error = store.error, store.report == nil {
                        ErrorStateView(error: error) { Task { await store.load(week: week) } }
                    } else if let report = store.report {
                        content(report)
                    } else {
                        loadingState
                    }
                } else {
                    loadingState
                }
            }
        }
        .background(Theme.background)
        .navigationTitle("Недельный отчёт")
        .toolbar { LogoutToolbarItem() }
        .task {
            if store == nil {
                let created = WeeklyReportStore(api: api)
                store = created
                await created.load(week: week)
            }
        }
        .onChange(of: week) { _, new in Task { await store?.load(week: new) } }
        .refreshable { await store?.load(week: week) }
    }

    private var loadingState: some View {
        VStack(spacing: Spacing.lg) {
            Skeleton(height: 96, cornerRadius: Radius.lg)
            Skeleton(height: 220, cornerRadius: Radius.lg)
            Skeleton(height: 180, cornerRadius: Radius.lg)
        }
    }

    @ViewBuilder
    private func content(_ report: WeeklyReport) -> some View {
        let totals = report.totals

        if totals.income.total == 0, totals.expenseTotal == 0 {
            WideEmptyState(
                icon: "calendar.badge.exclamationmark",
                title: "Неделя пустая",
                message: "За эту неделю не внесено ни доходов, ни расходов."
            )
        } else {
            VStack(spacing: Spacing.lg) {
                DashboardGrid {
                    MetricTile(
                        label: "Выручка",
                        value: Money.format(totals.income.total),
                        icon: "arrow.down.circle.fill",
                        accent: Theme.brand
                    )
                    MetricTile(
                        label: "Расходы",
                        value: Money.format(totals.expenseTotal),
                        icon: "arrow.up.circle.fill",
                        accent: Theme.negative
                    )
                    MetricTile(
                        label: "Итог недели",
                        value: Money.format(totals.net),
                        icon: "equal.circle.fill",
                        accent: totals.net >= 0 ? Theme.positive : Theme.negative
                    )
                    MetricTile(
                        label: "Остаток наличных",
                        value: Money.format(totals.remainCash),
                        icon: "banknote",
                        accent: totals.remainCash >= 0 ? Theme.info : Theme.negative
                    )
                }

                weekChart(report)

                SplitDashboard {
                    companies(report)
                } side: {
                    payments(totals)
                    expenses(totals)
                }
            }
        }
    }

    private func weekChart(_ report: WeeklyReport) -> some View {
        let points = report.dailyTotals.compactMap { day -> TimePoint? in
            guard let date = day.day else { return nil }
            return TimePoint(label: day.label, date: date, value: day.income)
        }

        return Group {
            if points.count > 1 {
                TrendChart(title: "Выручка по дням", points: points)
            } else {
                Card {
                    InlineEmpty(icon: "chart.xyaxis.line", text: "Данных по дням нет", tint: Theme.textDim)
                }
            }
        }
    }

    private func payments(_ totals: WeeklyTotals) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Чем платили")

                if totals.income.total <= 0 {
                    InlineEmpty(icon: "creditcard", text: "Выручки за неделю нет", tint: Theme.textDim)
                } else {
                    SplitBar(segments: [
                        .init(label: "Наличные", value: totals.income.cash, color: ChartPalette.series1),
                        .init(label: "Kaspi", value: totals.income.kaspi, color: ChartPalette.series2),
                        .init(label: "Карта", value: totals.income.card, color: ChartPalette.series3),
                        .init(label: "Онлайн", value: totals.income.online, color: Theme.textDim),
                    ])

                    RowDivider()
                    StatRow("Наличными", value: Money.format(totals.income.cash), icon: "banknote")
                    StatRow("Безналично", value: Money.format(totals.income.cashless), icon: "creditcard")
                    RowDivider()
                    // Остаток — это доход минус расход того же вида оплаты.
                    // Расхождение с кассой ищут именно по этим двум строкам.
                    StatRow(
                        "Остаток наличных",
                        value: Money.format(totals.remainCash),
                        valueColor: totals.remainCash >= 0 ? Theme.text : Theme.negative
                    )
                    StatRow(
                        "Остаток безнала",
                        value: Money.format(totals.remainKaspi),
                        valueColor: totals.remainKaspi >= 0 ? Theme.text : Theme.negative
                    )
                }
            }
        }
    }

    @ViewBuilder
    private func expenses(_ totals: WeeklyTotals) -> some View {
        if totals.expenses.isEmpty {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("Куда ушли деньги")
                    InlineEmpty(icon: "tray", text: "Расходов за неделю нет", tint: Theme.textDim)
                }
            }
        } else {
            CategoryBarChart(
                title: "Куда ушли деньги",
                points: totals.expenses.prefix(8).map {
                    CategoryPoint(label: $0.category, value: $0.amount)
                },
                color: ChartPalette.series3
            )
        }
    }

    private func companies(_ report: WeeklyReport) -> some View {
        let rows = report.activeCompanies

        return Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("По точкам", subtitle: "нажмите точку, чтобы раскрыть")

                if rows.isEmpty {
                    InlineEmpty(icon: "building.2", text: "Точек с движением нет", tint: Theme.textDim)
                } else {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, company in
                        if index > 0 { RowDivider() }
                        Button {
                            expanded = expanded == company.id ? nil : company.id
                        } label: {
                            WeeklyCompanyRow(company: company, isExpanded: expanded == company.id)
                        }
                        .buttonStyle(.pressable)

                        if expanded == company.id {
                            WeeklyCompanyDetail(company: company)
                        }
                    }
                }
            }
        }
    }
}

/// Строка точки: выручка недели и итог.
private struct WeeklyCompanyRow: View {
    let company: WeeklyCompany
    let isExpanded: Bool

    var body: some View {
        HStack(spacing: Spacing.md) {
            Image(systemName: "chevron.right")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Theme.textDim)
                .rotationEffect(.degrees(isExpanded ? 90 : 0))
                .animation(Motion.value, value: isExpanded)

            Text(company.name)
                .font(Typography.callout)
                .foregroundStyle(Theme.text)
                .lineLimit(1)

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 1) {
                Text(Money.format(company.income.total))
                    .font(Typography.callout.weight(.medium))
                    .monospacedDigit()
                    .foregroundStyle(Theme.text)
                Text("итог \(Money.signed(company.net))")
                    .font(Typography.caption)
                    .monospacedDigit()
                    .foregroundStyle(company.net >= 0 ? Theme.textDim : Theme.negative)
            }
        }
        .padding(.vertical, Spacing.xs)
        .contentShape(Rectangle())
    }
}

/// Раскрытая точка: разбивка выручки, расходы и остатки.
private struct WeeklyCompanyDetail: View {
    let company: WeeklyCompany

    var body: some View {
        VStack(spacing: Spacing.sm) {
            StatRow("Наличными", value: Money.format(company.income.cash), icon: "banknote")
            StatRow("Безналично", value: Money.format(company.income.cashless), icon: "creditcard")
            StatRow("Расходы", value: Money.signed(-company.expenseTotal), valueColor: Theme.negative)
            StatRow(
                "Итог",
                value: Money.format(company.net),
                valueColor: company.net >= 0 ? Theme.positive : Theme.negative,
                emphasized: true
            )

            RowDivider()
            StatRow(
                "Остаток наличных",
                value: Money.format(company.remainCash),
                valueColor: company.remainCash >= 0 ? Theme.text : Theme.negative
            )
            StatRow(
                "Остаток безнала",
                value: Money.format(company.remainKaspi),
                valueColor: company.remainKaspi >= 0 ? Theme.text : Theme.negative
            )

            if !company.expenses.isEmpty {
                RowDivider()
                Text("Расходы по категориям")
                    .font(Typography.label)
                    .foregroundStyle(Theme.textDim)
                    .textCase(.uppercase)
                    .frame(maxWidth: .infinity, alignment: .leading)

                ForEach(company.expenses.prefix(6)) { group in
                    StatRow(group.category, value: Money.format(group.amount))
                }
            }
        }
        .padding(Spacing.md)
        .background(Theme.surfaceRaised)
        .clipShape(RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
    }
}

// ── Оценка бизнеса ───────────────────────────────────────────────────────────

@MainActor @Observable
final class ValuationStore {
    private(set) var valuation: BusinessValuation?
    private(set) var isLoaded = false
    private(set) var isLoading = false
    private(set) var error: APIError?

    private let service: ValuationService

    init(api: APIClient) { service = ValuationService(api: api) }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            valuation = try await service.load()
            isLoaded = true
            error = nil
        } catch let apiError as APIError {
            error = apiError
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }
}

/// Сколько бизнес стоит: EBITDA за 12 месяцев, умноженная на мультипликатор.
///
/// Мультипликатор и его поправки считает сервер: он знает базовую ставку рынка
/// и правила, по которым тренд и стабильность маржи её двигают. Своя формула
/// в приложении дала бы владельцу вторую цену за один и тот же бизнес.
struct ValuationScreen: View {
    @Environment(\.api) private var api

    @State private var store: ValuationStore?

    var body: some View {
        ScreenScroll {
            if let store {
                if let error = store.error, store.valuation == nil {
                    ErrorStateView(error: error) { Task { await store.load() } }
                } else if let valuation = store.valuation {
                    content(valuation)
                } else if store.isLoaded {
                    WideEmptyState(
                        icon: "chart.pie",
                        title: "Оценивать нечего",
                        message: "Нет точек с выручкой за последние 12 месяцев."
                    )
                } else {
                    loadingState
                }
            } else {
                loadingState
            }
        }
        .background(Theme.background)
        .navigationTitle("Оценка бизнеса")
        .toolbar { LogoutToolbarItem() }
        .task {
            if store == nil {
                let created = ValuationStore(api: api)
                store = created
                await created.load()
            }
        }
        .refreshable { await store?.load() }
    }

    private var loadingState: some View {
        VStack(spacing: Spacing.lg) {
            Skeleton(height: 140, cornerRadius: Radius.lg)
            Skeleton(height: 200, cornerRadius: Radius.lg)
            Skeleton(height: 220, cornerRadius: Radius.lg)
        }
    }

    @ViewBuilder
    private func content(_ valuation: BusinessValuation) -> some View {
        VStack(spacing: Spacing.lg) {
            price(valuation)

            DashboardGrid {
                MetricTile(
                    label: "Выручка за 12 мес",
                    value: Money.format(valuation.revenue12mo),
                    icon: "arrow.down.circle.fill",
                    accent: Theme.brand
                )
                MetricTile(
                    label: "EBITDA за 12 мес",
                    value: Money.format(valuation.ebitda12mo),
                    change: valuation.trendPct,
                    icon: "chart.line.uptrend.xyaxis",
                    accent: valuation.ebitda12mo >= 0 ? Theme.positive : Theme.negative
                )
                MetricTile(
                    label: "Маржа EBITDA",
                    value: Percent.format(valuation.ebitdaMargin),
                    icon: "percent",
                    accent: Theme.info
                )
                MetricTile(
                    label: "Чистая прибыль",
                    value: Money.format(valuation.netProfit12mo),
                    icon: "banknote.fill",
                    accent: valuation.netProfit12mo >= 0 ? Theme.positive : Theme.negative
                )
            }

            trend(valuation)

            SplitDashboard {
                factors(valuation)
            } side: {
                basis(valuation)
            }
        }
    }

    // ── Цена ─────────────────────────────────────────────────────────────────

    @ViewBuilder
    private func price(_ valuation: BusinessValuation) -> some View {
        if valuation.profitable {
            Card(accent: Theme.brand) {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    Text("Вероятная цена бизнеса")
                        .font(Typography.label)
                        .foregroundStyle(Theme.textDim)
                        .textCase(.uppercase)

                    Text(Money.format(valuation.valuation.mid))
                        .font(Typography.hero)
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)

                    Text("Вилка \(Money.format(valuation.valuation.low)) — \(Money.format(valuation.valuation.high))")
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textMuted)

                    if let period = valuation.periodLabel {
                        Text("По EBITDA за \(period)")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                    }
                }
            }
        } else {
            Card(accent: Theme.warning) {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    SectionHeader("Оценить по EBITDA нельзя")
                    Text("За 12 месяцев бизнес не вышел в плюс по EBITDA. Инвестор в этом случае считает не мультипликатор прибыли, а стоимость активов.")
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textMuted)
                }
            }
        }
    }

    // ── Основание ────────────────────────────────────────────────────────────

    private func basis(_ valuation: BusinessValuation) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("На чём построена оценка")

                StatRow("EBITDA за 12 мес", value: Money.format(valuation.ebitda12mo), icon: "sum")
                StatRow("Год назад", value: Money.format(valuation.ebitdaPrev12mo), icon: "clock.arrow.circlepath")
                StatRow(
                    "Мультипликатор",
                    value: "×\(multipleText(valuation.multiple.mid))",
                    icon: "multiply",
                    emphasized: true
                )
                StatRow(
                    "Вилка мультипликатора",
                    value: "×\(multipleText(valuation.multiple.low)) — ×\(multipleText(valuation.multiple.high))",
                    icon: "arrow.left.and.right"
                )
                RowDivider()
                StatRow(
                    "Точек с выручкой",
                    value: "\(valuation.companiesCount)",
                    icon: "building.2"
                )
                if let cv = valuation.marginCv {
                    StatRow(
                        "Разброс маржи",
                        value: String(format: "%.2f", cv).replacingOccurrences(of: ".", with: ","),
                        valueColor: cv > 0.5 ? Theme.warning : Theme.text,
                        icon: "waveform.path.ecg"
                    )
                }
            }
        }
    }

    private func multipleText(_ value: Double) -> String {
        String(format: "%.1f", value).replacingOccurrences(of: ".", with: ",")
    }

    // ── Поправки ─────────────────────────────────────────────────────────────

    private func factors(_ valuation: BusinessValuation) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Что двигает цену", subtitle: "поправки к базовому мультипликатору")

                if valuation.factors.isEmpty {
                    InlineEmpty(icon: "slider.horizontal.3", text: "Поправок нет", tint: Theme.textDim)
                } else {
                    ForEach(Array(valuation.factors.enumerated()), id: \.element.id) { index, factor in
                        if index > 0 { RowDivider() }
                        FactorRow(factor: factor)
                    }
                }
            }
        }
    }

    private func trend(_ valuation: BusinessValuation) -> some View {
        let points = valuation.lastTwelveMonths.compactMap { month -> TimePoint? in
            guard let date = month.date else { return nil }
            return TimePoint(label: month.label, date: date, value: month.ebitda)
        }

        return Group {
            if points.count > 1 {
                TrendChart(
                    title: "EBITDA по месяцам",
                    subtitle: "последние 12 полных месяцев",
                    points: points,
                    color: ChartPalette.series2
                )
            }
        }
    }
}

/// Поправка к мультипликатору: чем она вызвана и куда двигает цену.
private struct FactorRow: View {
    let factor: ValuationFactor

    private var kind: StatusChip.Kind {
        if factor.isGood { return .good }
        if factor.isBad { return .danger }
        return .neutral
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(spacing: Spacing.sm) {
                Text(factor.label)
                    .font(Typography.callout.weight(.medium))
                    .foregroundStyle(Theme.text)

                Spacer(minLength: Spacing.sm)

                if factor.effect != 0 {
                    StatusChip(effectText, kind: kind)
                } else {
                    StatusChip("нейтрально", kind: .neutral)
                }
            }

            Text(factor.note)
                .font(Typography.caption)
                .foregroundStyle(Theme.textMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, Spacing.xs)
    }

    private var effectText: String {
        let value = String(format: "%.1f", abs(factor.effect)).replacingOccurrences(of: ".", with: ",")
        return factor.effect > 0 ? "+\(value) к мультипликатору" : "−\(value) к мультипликатору"
    }
}
