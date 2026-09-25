import OrdaKit
import OrdaUI
import SwiftUI

/// Отчёт по фильтрам: период, точка, смена, шаг графика, база сравнения.
///
/// Свой, а не общий `BusinessStore.report`: у отчёта свои фильтры, и менять
/// ими выбор на других экранах незачем. Период — общий (`store.range`), как у
/// доходов и расходов.
@MainActor
@Observable
final class ReportsStore {
    private(set) var bundle: ReportBundle?
    private(set) var error: APIError?
    private(set) var isLoading = false
    /// Операции периода грузятся отдельно и только на своей вкладке: это
    /// сотни строк, а «Обзору» они не нужны.
    private(set) var operations: [ReportOperation]?
    private(set) var operationsError: APIError?
    private(set) var isLoadingOperations = false

    /// Разбор ИИ — по кнопке: вызов платный, и тратить его на срез, который
    /// никто не прочтёт, незачем. Сбрасывается при смене среза.
    private(set) var insight: String?
    private(set) var insightError: String?
    private(set) var isLoadingInsight = false

    private(set) var isExportingPDF = false

    private let service: BusinessService
    private var generation = 0

    init(api: APIClient) { service = BusinessService(api: api) }

    func loadInsight() async {
        guard let aggregate = bundle?.aggregate, !isLoadingInsight else { return }
        isLoadingInsight = true
        insightError = nil
        defer { isLoadingInsight = false }
        do {
            insight = try await service.reportInsight(body: ReportExport.insightBody(aggregate: aggregate))
        } catch let apiError as APIError {
            insightError = apiError.userMessage
        } catch {
            insightError = error.localizedDescription
        }
    }

    /// PDF как на сайте: сервер собирает его из итогов и операций периода.
    /// Операции дочитываем, если вкладку «Операции» ещё не открывали.
    func exportPDF(_ query: ReportQuery, companyLabel: String, companyName: (String?) -> String) async throws -> ExportedFile? {
        guard let aggregate = bundle?.aggregate else { return nil }
        isExportingPDF = true
        defer { isExportingPDF = false }
        var rows = operations
        if rows == nil {
            rows = try await service.reportBundle(query, operations: true).operations
            operations = rows
        }
        let body = try ReportExport.finreportBody(
            aggregate: aggregate,
            operations: rows ?? [],
            companyLabel: companyLabel,
            companyName: companyName
        )
        let data = try await service.reportPDF(body: body)
        return try ExportedFile.write(data, name: "Финансовый отчёт \(aggregate.dateFrom) — \(aggregate.dateTo).pdf")
    }

    func load(_ query: ReportQuery) async {
        generation += 1
        let mine = generation
        isLoading = true
        operations = nil
        insight = nil
        insightError = nil
        defer { if mine == generation { isLoading = false } }
        do {
            let result = try await service.reportBundle(query)
            guard mine == generation else { return }
            bundle = result
            error = nil
        } catch let apiError as APIError {
            guard mine == generation else { return }
            error = apiError
        } catch {
            guard mine == generation else { return }
            self.error = .transport(message: error.localizedDescription)
        }
    }

    func loadOperations(_ query: ReportQuery) async {
        guard operations == nil, !isLoadingOperations else { return }
        isLoadingOperations = true
        defer { isLoadingOperations = false }
        do {
            operations = try await service.reportBundle(query, operations: true).operations
            operationsError = nil
        } catch let apiError as APIError {
            operationsError = apiError
        } catch {
            operationsError = .transport(message: error.localizedDescription)
        }
    }
}

/// Сводный отчёт: выручка, прибыль, куда уходят деньги, какая точка тянет.
///
/// Каждый показатель показан вместе с изменением к базе сравнения: прошлому
/// периоду такой же длины или тому же периоду год назад. Абсолютная цифра
/// сама по себе ничего не говорит: «1,8 млн» — это хорошо или плохо, понятно
/// только в сравнении.
struct ReportsScreen: View {
    enum Tab: String, CaseIterable, Hashable {
        case overview, expenses, points, operations

        var title: String {
            switch self {
            case .overview: "Обзор"
            case .expenses: "Расходы"
            case .points: "Точки"
            case .operations: "Операции"
            }
        }
    }

    @Environment(BusinessStore.self) private var store
    @Environment(\.api) private var api
    @Environment(\.access) private var access

    @State private var reports: ReportsStore?
    @State private var exported: ExportedFile?
    @State private var exportError: String?
    @State private var tab: Tab = .overview
    @State private var companyID: String?
    @State private var shift: ReportQuery.Shift = .all
    @State private var grouping: ReportQuery.Grouping = .auto
    @State private var compareYear = false
    @State private var expanded: Set<String> = []
    @State private var search = ""

    private var query: ReportQuery {
        let bounds = store.range.bounds()
        var q = ReportQuery(from: bounds.from, to: bounds.to)
        q.companyID = companyID
        q.shift = shift
        q.grouping = grouping
        q.compareYear = compareYear
        q.includeExtra = ExtraCashPreference.shared.includeExtra
        return q
    }

    private var compareWord: String { compareYear ? "к прошлому году" : "к прошлому периоду" }

    var body: some View {
        @Bindable var bindable = store

        return ScreenScroll {
            VStack(spacing: Spacing.lg) {
                PeriodBar(selection: $bindable.range, showsExtra: true)
                filters
                PillSegment(options: Tab.allCases.map { ($0, $0.title) }, selection: $tab)

                if let error = reports?.error, reports?.bundle == nil {
                    ErrorStateView(error: error) { Task { await reload() } }
                } else if let bundle = reports?.bundle {
                    switch tab {
                    case .overview: overview(bundle)
                    case .expenses: expenseArticles(bundle)
                    case .points: points(bundle.aggregate)
                    case .operations: operationsTab
                    }
                } else {
                    loadingState
                }
            }
        }
        .background(Theme.background)
        .navigationTitle("Отчёты")
        .toolbar {
            if access?.can("reports.export") == true, reports?.bundle != nil {
                ToolbarItem(placement: .primaryAction) {
                    Button { Task { await exportPDF() } } label: {
                        if reports?.isExportingPDF == true {
                            ProgressView().controlSize(.small)
                        } else {
                            Image(systemName: "square.and.arrow.up")
                        }
                    }
                    .disabled(reports?.isExportingPDF == true)
                    .accessibilityLabel("Скачать PDF")
                }
            }
            LogoutToolbarItem()
        }
        .shareSheet($exported)
        .alert("Не удалось собрать PDF", isPresented: Binding(get: { exportError != nil }, set: { if !$0 { exportError = nil } })) {
            Button("Понятно", role: .cancel) {}
        } message: {
            Text(exportError ?? "")
        }
        .task(id: query) {
            if reports == nil { reports = ReportsStore(api: api) }
            await reload()
            if tab == .operations { await reports?.loadOperations(query) }
        }
        .task(id: tab) {
            if tab == .operations { await reports?.loadOperations(query) }
        }
        .task {
            if store.companies.isEmpty { await store.loadCompanies() }
            #if DEBUG
            // Снимки экрана: `-ordaReportsTab overview|expenses|points|operations`.
            if let raw = UserDefaults.standard.string(forKey: "ordaReportsTab"), let wanted = Tab(rawValue: raw) {
                tab = wanted
            }
            // Проверка выгрузки и ИИ: `-ordaAutoExport pdf|ai`.
            switch UserDefaults.standard.string(forKey: "ordaAutoExport") {
            case "pdf":
                try? await Task.sleep(for: .seconds(3))
                await exportPDF()
            case "ai":
                try? await Task.sleep(for: .seconds(3))
                await reports?.loadInsight()
                DebugDump.write("ai_reports.txt", reports?.insight.map { "\($0)" } ?? reports?.insightError ?? "пусто")
            default: break
            }
            #endif
        }
        .refreshable { await reload() }
    }

    private func reload() async {
        await reports?.load(query)
    }

    /// Что стоит в шапке PDF: точка или вся сеть — как на сайте.
    private var companyLabel: String {
        if let companyID { return store.companyName(companyID) ?? "Точка" }
        return ExtraCashPreference.shared.includeExtra ? "Все компании (включая F16 Extra)" : "Все компании"
    }

    private func exportPDF() async {
        do {
            exported = try await reports?.exportPDF(query, companyLabel: companyLabel) { id in
                store.companyName(id) ?? "—"
            }
            if exported != nil { Haptics.success() }
        } catch let error as APIError {
            exportError = error.userMessage
        } catch {
            exportError = error.localizedDescription
        }
    }

    private var loadingState: some View {
        VStack(spacing: Spacing.lg) {
            Skeleton(height: 150, cornerRadius: Radius.xl)
            Skeleton(height: 240, cornerRadius: Radius.lg)
            Skeleton(height: 180, cornerRadius: Radius.lg)
        }
    }

    // ── Фильтры ──────────────────────────────────────────────────────────────

    /// Фильтры капсулами в ряд, как у банка над выпиской. Выбранный —
    /// синим: сразу видно, что отчёт не «весь».
    private var filters: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Spacing.sm) {
                filterChip(
                    icon: "building.2.fill",
                    title: store.companyName(companyID) ?? "Все точки",
                    isActive: companyID != nil
                ) {
                    Button("Все точки") { companyID = nil }
                    ForEach(store.companies) { company in
                        Button(company.name) { companyID = company.id }
                    }
                }
                filterChip(
                    icon: shift == .night ? "moon.fill" : "sun.max.fill",
                    title: shift.title,
                    isActive: shift != .all
                ) {
                    ForEach(ReportQuery.Shift.allCases, id: \.self) { option in
                        Button(option.title) { shift = option }
                    }
                }
                filterChip(
                    icon: "chart.bar.fill",
                    title: grouping == .auto ? "Шаг: авто" : grouping.title,
                    isActive: grouping != .auto
                ) {
                    ForEach(ReportQuery.Grouping.allCases, id: \.self) { option in
                        Button(option.title) { grouping = option }
                    }
                }
                filterChip(
                    icon: "arrow.left.arrow.right",
                    title: compareYear ? "С прошлым годом" : "С прошлым периодом",
                    isActive: compareYear
                ) {
                    Button("С прошлым периодом") { compareYear = false }
                    Button("С тем же периодом год назад") { compareYear = true }
                }
            }
        }
        .scrollClipDisabled()
    }

    private func filterChip<Items: View>(
        icon: String,
        title: String,
        isActive: Bool,
        @ViewBuilder items: () -> Items
    ) -> some View {
        Menu {
            items()
        } label: {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 12, weight: .semibold))
                Text(title)
                    .font(.system(size: 14, weight: .semibold))
                    .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.system(size: 10, weight: .bold))
            }
            .foregroundStyle(isActive ? .white : Theme.text)
            .padding(.horizontal, 12)
            .frame(height: 36)
            .background(isActive ? Theme.brand : Theme.surface, in: Capsule())
            .overlay(Capsule().strokeBorder(isActive ? Color.clear : Theme.border, lineWidth: 1))
        }
    }

    // ── Обзор ────────────────────────────────────────────────────────────────

    @ViewBuilder
    private func overview(_ bundle: ReportBundle) -> some View {
        let report = bundle.aggregate
        let totals = report.current

        VStack(spacing: Spacing.lg) {
            HeroSummary(
                title: "Прибыль за период",
                value: Money.format(totals.profit),
                caption: report.profitChange.map { "\(Percent.format($0, signed: true)) \(compareWord)" },
                footer: [
                    ("Выручка" + (report.incomeChange.map { " · \(Percent.format($0, signed: true))" } ?? ""), Money.format(totals.totalIncome)),
                    ("Расходы" + (report.expenseChange.map { " · \(Percent.format($0, signed: true))" } ?? ""), Money.format(totals.totalExpense)),
                    // Среднее на отчёт смены, а не чек покупателя: сервер делит
                    // выручку на число строк дохода.
                    ("Средняя смена", Money.format(totals.avgTransaction)),
                ],
                colors: totals.profit >= 0 ? Theme.heroGradient : Theme.heroNegative
            )

            if bundle.impreciseNightKaspiCount > 0 {
                HStack(alignment: .top, spacing: Spacing.md) {
                    TintedIcon(systemName: "moon.stars.fill", tint: Theme.warning, size: 36, corner: 10)
                    Text("В \(bundle.impreciseNightKaspiCount) \(pluralize(bundle.impreciseNightKaspiCount, "ночной смене", "ночных сменах", "ночных сменах")) Kaspi не разделён по полуночи — суммы по дням приблизительные, итог точный.")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(Spacing.md)
                .background(Theme.warning.opacity(0.08), in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
            }

            if let forecast = ReportForecast.forPeriod(
                dateFrom: report.dateFrom,
                dateTo: report.dateTo,
                asOf: bundle.asOf ?? DateParsing.dateOnlyString(from: Date()),
                income: totals.totalIncome,
                expense: totals.totalExpense,
                profit: totals.profit,
                hints: bundle.forecastHints
            ) {
                forecastCard(forecast)
            }

            trend(report)

            SplitDashboard {
                expenses(report)
            } side: {
                payments(totals)
                companies(report)
            }

            heatmap(report)

            if access?.can("reports.view") != false, totals.totalIncome != 0 || totals.totalExpense != 0 {
                insightCard
            }
        }
    }

    // ── Прогноз ──────────────────────────────────────────────────────────────

    /// Период ещё идёт — чем он, скорее всего, закончится. Для календарного
    /// месяца — гибрид темпа и «хвоста» прошлого месяца, иначе линейно.
    private func forecastCard(_ forecast: ReportForecast) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: Spacing.sm) {
                Image(systemName: "chart.line.uptrend.xyaxis")
                    .font(.system(size: 13, weight: .bold))
                Text("Прогноз на конец периода")
                    .font(.system(size: 14, weight: .semibold))
                Spacer()
                Text("точность \(Int(forecast.confidence.rounded()))%")
                    .font(.system(size: 12, weight: .semibold))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(.white.opacity(0.16), in: Capsule())
            }
            .foregroundStyle(.white)

            HStack(alignment: .firstTextBaseline, spacing: Spacing.xl) {
                forecastValue("Выручка", forecast.forecastIncome)
                forecastValue("Прибыль", forecast.forecastProfit)
            }
            .padding(.top, Spacing.md)

            Text("Осталось \(forecast.remainingDays) \(pluralize(forecast.remainingDays, "день", "дня", "дней")) · \(forecast.note)")
                .font(.system(size: 12))
                .foregroundStyle(.white.opacity(0.7))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, Spacing.md)
        }
        .padding(Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(colors: Theme.heroAccent, startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous)
        )
    }

    private func forecastValue(_ label: String, _ value: Double) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.system(size: 13))
                .foregroundStyle(.white.opacity(0.7))
            Text(Money.format(value))
                .font(.system(size: 22, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
    }

    // ── Тепловая карта ───────────────────────────────────────────────────────

    /// Прибыль по дням календарём: зелёные дни в плюс, красные в минус, чем
    /// ярче — тем больше. Дольше трёх месяцев — клетка на месяц.
    @ViewBuilder
    private func heatmap(_ report: ReportAggregate) -> some View {
        let map = ProfitHeatmap.build(from: report.dateFrom, to: report.dateTo, dailyIncome: report.dailyIncome, dailyExpense: report.dailyExpense)
        if !map.cells.isEmpty, map.maxAbsProfit > 0 {
            OwnerSection("Прибыль по дням") {
                Text(map.byMonth ? "по месяцам" : "календарь")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
            } content: {
                let columns = Array(repeating: GridItem(.flexible(), spacing: 5), count: map.byMonth ? 4 : 7)
                LazyVGrid(columns: columns, spacing: 5) {
                    if !map.byMonth {
                        ForEach(["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"], id: \.self) { day in
                            Text(day)
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(Theme.textDim)
                        }
                        ForEach(0..<map.leadingBlanks, id: \.self) { _ in Color.clear.frame(height: 1) }
                    }
                    ForEach(map.cells) { cell in
                        heatCell(cell, maxAbs: map.maxAbsProfit, byMonth: map.byMonth)
                    }
                }
                HStack(spacing: Spacing.md) {
                    legend(Theme.positive, "в плюс")
                    legend(Theme.negative, "в минус")
                    Spacer()
                }
                .padding(.top, Spacing.xs)
            }
        }
    }

    private func heatCell(_ cell: ProfitHeatCell, maxAbs: Double, byMonth: Bool) -> some View {
        let profit = cell.profit
        let alpha = profit == 0 || maxAbs == 0 ? 0 : 0.14 + 0.6 * (abs(profit) / maxAbs)
        let color = profit > 0 ? Theme.positive : Theme.negative
        return VStack(spacing: 1) {
            Text(cell.label)
                .font(.system(size: byMonth ? 12 : 13, weight: .semibold))
                .foregroundStyle(Theme.text)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            if byMonth, profit != 0 {
                Text(Money.axisTick(profit))
                    .font(.system(size: 11, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(Theme.textMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: byMonth ? 52 : 40)
        .background(
            profit == 0 ? Theme.surfaceRaised : color.opacity(alpha),
            in: RoundedRectangle(cornerRadius: 9, style: .continuous)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(cell.label): прибыль \(Money.format(profit))")
    }

    private func legend(_ color: Color, _ title: String) -> some View {
        HStack(spacing: 5) {
            RoundedRectangle(cornerRadius: 3).fill(color.opacity(0.6)).frame(width: 12, height: 12)
            Text(title)
                .font(.system(size: 12))
                .foregroundStyle(Theme.textDim)
        }
    }

    // ── Разбор ИИ ────────────────────────────────────────────────────────────

    private var insightCard: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            HStack(spacing: Spacing.md) {
                TintedIcon(systemName: "sparkles", tint: Theme.accent, size: 40, corner: 12)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Разбор ИИ")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Theme.text)
                    Text("что выросло, что просело и на что смотреть")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textDim)
                        .lineLimit(1)
                }
                Spacer(minLength: Spacing.sm)
                Button {
                    Task { await reports?.loadInsight() }
                } label: {
                    if reports?.isLoadingInsight == true {
                        ProgressView().controlSize(.small)
                    } else {
                        Text(reports?.insight == nil ? "Получить" : "Обновить")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .background(Theme.brand, in: Capsule())
                    }
                }
                .buttonStyle(.pressable)
                .disabled(reports?.isLoadingInsight == true)
            }

            if let error = reports?.insightError {
                Text(error)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.negative)
            } else if let text = reports?.insight {
                Text(text)
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.text)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
            } else if reports?.isLoadingInsight == true {
                VStack(alignment: .leading, spacing: 8) {
                    Skeleton(height: 12)
                    Skeleton(height: 12)
                    Skeleton(height: 12).frame(maxWidth: 200)
                }
            }
        }
        .padding(Spacing.lg)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
    }

    // ── Динамика ─────────────────────────────────────────────────────────────

    private func trend(_ report: ReportAggregate) -> some View {
        // Шаг задаёт запрос: «Авто» выбирает его по длине периода (дни,
        // недели, месяцы), иначе — то, что выбрали в фильтре. Подписи — от
        // сервера, они уже согласованы с шагом.
        let points = report.buckets.compactMap { bucket -> TimePoint? in
            guard let date = bucket.date else { return nil }
            return TimePoint(label: bucket.label, date: date, value: bucket.income)
        }

        return Group {
            if points.count > 1 {
                TrendChart(
                    title: "Выручка",
                    subtitle: periodLabel(report),
                    points: points
                )
            } else {
                Card {
                    InlineEmpty(icon: "chart.xyaxis.line", text: "Для графика мало данных", tint: Theme.textDim)
                }
            }
        }
    }

    private func periodLabel(_ report: ReportAggregate) -> String? {
        guard let from = DateParsing.parseDateOnly(report.dateFrom),
              let to = DateParsing.parseDateOnly(report.dateTo) else { return nil }
        return "\(from.formatted(.dateTime.day().month(.abbreviated))) — \(to.formatted(.dateTime.day().month(.abbreviated)))"
    }

    // ── Расходы (обзор) ──────────────────────────────────────────────────────

    private func expenses(_ report: ReportAggregate) -> some View {
        let categories = report.expenseCategories

        return Group {
            if categories.isEmpty {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        SectionHeader("Куда ушли деньги")
                        InlineEmpty(icon: "tray", text: "Расходов за период нет", tint: Theme.textDim)
                    }
                }
            } else {
                CategoryBarChart(
                    title: "Куда ушли деньги",
                    points: categories.prefix(10).map {
                        CategoryPoint(label: $0.name, value: $0.amount)
                    },
                    color: ChartPalette.series3
                )
            }
        }
    }

    // ── Способы оплаты ───────────────────────────────────────────────────────

    private func payments(_ totals: FinancialTotals) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Чем платили")

                if totals.totalIncome <= 0 {
                    InlineEmpty(icon: "creditcard", text: "Выручки за период нет", tint: Theme.textDim)
                } else {
                    SplitBar(segments: [
                        .init(label: "Наличные", value: totals.incomeCash, color: ChartPalette.series1),
                        .init(label: "Kaspi", value: totals.incomeKaspi, color: ChartPalette.series2),
                        .init(label: "Карта", value: totals.incomeCard, color: ChartPalette.series3),
                        .init(label: "Онлайн", value: totals.incomeOnline, color: Theme.textDim),
                    ].filter { $0.value > 0 })

                    RowDivider()
                    StatRow("Наличными", value: Money.format(totals.incomeCash), icon: "banknote")
                    StatRow("Безналично", value: Money.format(totals.incomeNonCash), icon: "creditcard")
                    StatRow("Операций", value: "\(totals.transactionCount)", icon: "number")
                }
            }
        }
    }

    private func companies(_ report: ReportAggregate) -> some View {
        let rows = report.companyIncome

        return OwnerSection("Выручка по точкам") {
            if rows.isEmpty {
                InlineEmpty(icon: "building.2", text: "Данных по точкам нет", tint: Theme.textDim)
            } else {
                let maximum = max(rows.first?.amount ?? 1, 1)
                VStack(spacing: Spacing.sm) {
                    ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                        AmountRow(
                            leading: { LetterBadge(text: row.name, tint: OwnerTint.point(index)) },
                            title: row.name,
                            amount: Money.format(row.amount),
                            share: row.amount / maximum,
                            tint: OwnerTint.point(index)
                        )
                    }
                }
            }
        }
    }

    // ── Вкладка «Расходы»: статьи ОПиУ ───────────────────────────────────────

    @ViewBuilder
    private func expenseArticles(_ bundle: ReportBundle) -> some View {
        let articles = bundle.expenseArticles
        let total = articles.filter { !$0.offChain }.reduce(0) { $0 + $1.amount }

        if articles.isEmpty {
            WideEmptyState(icon: "tray", title: "Расходов нет", message: "За выбранный период расходов не записано.")
        } else {
            VStack(spacing: Spacing.lg) {
                HeroSummary(
                    title: "Расходы за период",
                    value: Money.format(bundle.aggregate.current.totalExpense),
                    caption: bundle.aggregate.expenseChange.map { "\(Percent.format($0, signed: true)) \(compareWord)" },
                    footer: [
                        ("Статей", "\(articles.count)"),
                        ("Было", Money.format(bundle.aggregate.previous.totalExpense)),
                    ]
                )

                OwnerSection("По статьям ОПиУ") {
                    Text("нажмите, чтобы раскрыть")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textDim)
                } content: {
                    VStack(spacing: 0) {
                        ForEach(Array(articles.enumerated()), id: \.element.id) { index, article in
                            if index > 0 { Rectangle().fill(Theme.borderSoft).frame(height: 1).padding(.leading, 52) }
                            articleRow(article, index: index, total: total)
                        }
                    }
                }
                OwnerFootnote(text: "CAPEX и выплаты партнёрам в ОПиУ не вычитаются — их доля не считается от операционных расходов.")
            }
        }
    }

    private func articleRow(_ article: ReportExpenseArticle, index: Int, total: Double) -> some View {
        let isOpen = expanded.contains(article.id)
        let tint = article.offChain ? Theme.textDim : OwnerTint.point(index)
        return VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(Motion.tap) {
                    if isOpen { expanded.remove(article.id) } else { expanded.insert(article.id) }
                }
            } label: {
                AmountRow(
                    leading: { TintedIcon(systemName: article.offChain ? "arrow.up.right.square.fill" : "tag.fill", tint: tint, size: 40, corner: 12) },
                    title: article.label,
                    subtitle: article.prevAmount > 0 ? "было \(Money.format(article.prevAmount))" : "в базе сравнения не было",
                    amount: Money.format(article.amount),
                    change: article.change,
                    higherIsBetter: false,
                    share: article.offChain || total <= 0 ? nil : article.amount / total,
                    tint: tint
                )
            }
            .buttonStyle(.plain)

            if isOpen {
                VStack(spacing: 6) {
                    ForEach(article.categories, id: \.name) { category in
                        HStack {
                            Text(category.name)
                                .font(.system(size: 14))
                                .foregroundStyle(Theme.textMuted)
                                .lineLimit(1)
                            Spacer(minLength: Spacing.sm)
                            Text(Money.format(category.amount))
                                .font(.system(size: 14, weight: .medium, design: .rounded))
                                .monospacedDigit()
                                .foregroundStyle(Theme.text)
                        }
                    }
                }
                .padding(.leading, 52)
                .padding(.bottom, Spacing.sm)
                .transition(.opacity)
            }
        }
    }

    // ── Вкладка «Точки» ──────────────────────────────────────────────────────

    @ViewBuilder
    private func points(_ report: ReportAggregate) -> some View {
        let rows = report.companyStats
            .map { entry in
                (
                    id: entry.key,
                    stat: entry.value,
                    name: store.companyName(entry.key)
                        ?? report.companyIncome.first(where: { $0.companyID == entry.key })?.name
                        ?? "Точка"
                )
            }
            .sorted { $0.stat.income > $1.stat.income }

        if rows.isEmpty {
            WideEmptyState(icon: "building.2", title: "Нет данных по точкам", message: "За выбранный период по точкам ничего не записано.")
        } else {
            let maxIncome = max(rows.first?.stat.income ?? 1, 1)
            OwnerSection("Точки за период") {
                Text(compareYear ? "к прошлому году" : "к прошлому периоду")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
            } content: {
                VStack(spacing: 0) {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                        if index > 0 { Rectangle().fill(Theme.borderSoft).frame(height: 1).padding(.leading, 52) }
                        pointRow(name: row.name, stat: row.stat, previous: report.companyStatsPrev[row.id], index: index, share: row.stat.income / maxIncome)
                    }
                }
            }
        }
    }

    private func pointRow(name: String, stat: ReportCompanyStat, previous: ReportCompanyStat?, index: Int, share: Double) -> some View {
        let tint = OwnerTint.point(index)
        return VStack(alignment: .leading, spacing: Spacing.sm) {
            AmountRow(
                leading: { LetterBadge(text: name, tint: tint) },
                title: name,
                subtitle: "выручка",
                amount: Money.format(stat.income),
                change: previous.flatMap { Percent.change(current: stat.income, previous: $0.income) },
                share: share,
                tint: tint
            )
            HStack(spacing: 0) {
                pointStat("Расходы", Money.format(stat.expense), Theme.text)
                pointStat("Прибыль", Money.format(stat.profit), stat.profit >= 0 ? Theme.positive : Theme.negative)
                pointStat("Маржа", stat.margin.map { Percent.format($0 * 100) } ?? "—", Theme.text)
            }
            .padding(.leading, 52)
        }
        .padding(.vertical, Spacing.xs)
    }

    private func pointStat(_ label: String, _ value: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.system(size: 12))
                .foregroundStyle(Theme.textDim)
            Text(value)
                .font(.system(size: 14, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(color)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // ── Вкладка «Операции» ───────────────────────────────────────────────────

    @ViewBuilder
    private var operationsTab: some View {
        if let error = reports?.operationsError, reports?.operations == nil {
            ErrorStateView(error: error) { Task { await reports?.loadOperations(query) } }
        } else if let operations = reports?.operations {
            let filtered = filter(operations)
            VStack(spacing: Spacing.lg) {
                searchField
                if filtered.isEmpty {
                    WideEmptyState(
                        icon: "magnifyingglass",
                        title: operations.isEmpty ? "Операций нет" : "Ничего не нашлось",
                        message: operations.isEmpty ? "За выбранный период операций не записано." : "Попробуйте другое слово или сумму."
                    )
                } else {
                    ForEach(groupedByDay(filtered), id: \.day) { group in
                        OwnerSection(Self.dayTitle(group.day)) {
                            Text((group.net >= 0 ? "+" : "−") + Money.format(abs(group.net)))
                                .font(.system(size: 13, weight: .semibold))
                                .monospacedDigit()
                                .foregroundStyle(group.net >= 0 ? Theme.positive : Theme.negative)
                        } content: {
                            VStack(spacing: 0) {
                                ForEach(Array(group.items.enumerated()), id: \.element.id) { index, op in
                                    if index > 0 { Rectangle().fill(Theme.borderSoft).frame(height: 1).padding(.leading, 52) }
                                    operationRow(op)
                                }
                            }
                        }
                    }
                    if filtered.count > Self.operationLimit {
                        OwnerFootnote(text: "Показаны первые \(Self.operationLimit) операций. Уточните поиск или точку.")
                    }
                }
            }
        } else {
            VStack(spacing: Spacing.md) {
                ForEach(0..<6, id: \.self) { _ in Skeleton(height: 56, cornerRadius: Radius.md) }
            }
        }
    }

    private static let operationLimit = 300

    private var searchField: some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: "magnifyingglass").foregroundStyle(Theme.textDim)
            TextField("Точка, статья, сумма, комментарий", text: $search)
                .textFieldStyle(.plain)
                .autocorrectionDisabled()
            if !search.isEmpty {
                Button { search = "" } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.textDim)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, Spacing.md)
        .frame(height: 44)
        .background(Theme.surface, in: Capsule())
    }

    private func filter(_ operations: [ReportOperation]) -> [ReportOperation] {
        let needle = search.trimmingCharacters(in: .whitespaces).lowercased()
        guard !needle.isEmpty else { return operations }
        let digits = needle.replacingOccurrences(of: " ", with: "")
        return operations.filter { op in
            let haystack = [store.companyName(op.companyID), op.title, op.comment]
                .compactMap { $0?.lowercased() }
                .joined(separator: " ")
            return haystack.contains(needle)
                || (!digits.isEmpty && digits.allSatisfy(\.isNumber) && String(Int(op.amount)).contains(digits))
        }
    }

    private struct DayGroup {
        let day: String
        let items: [ReportOperation]
        var net: Double { items.reduce(0) { $0 + ($1.kind == .income ? $1.amount : -$1.amount) } }
    }

    private func groupedByDay(_ operations: [ReportOperation]) -> [DayGroup] {
        let limited = Array(operations.prefix(Self.operationLimit))
        var order: [String] = []
        var byDay: [String: [ReportOperation]] = [:]
        for op in limited {
            if byDay[op.date] == nil { order.append(op.date) }
            byDay[op.date, default: []].append(op)
        }
        return order.map { DayGroup(day: $0, items: byDay[$0] ?? []) }
    }

    private func operationRow(_ op: ReportOperation) -> some View {
        let isIncome = op.kind == .income
        let point = store.companyName(op.companyID)
        let subtitle = [point, op.comment].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
        return HStack(spacing: Spacing.md) {
            TintedIcon(
                systemName: isIncome ? "arrow.down.left" : "arrow.up.right",
                tint: isIncome ? Theme.positive : Theme.negative,
                size: 40,
                corner: 12
            )
            VStack(alignment: .leading, spacing: 2) {
                Text(op.title ?? (isIncome ? "Выручка" : "Расход"))
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                if !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textDim)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: Spacing.sm)
            Text((isIncome ? "+" : "−") + Money.format(op.amount))
                .font(.system(size: 15, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(isIncome ? Theme.positive : Theme.text)
        }
        .padding(.vertical, 8)
    }

    static func dayTitle(_ iso: String) -> String {
        guard let date = DateParsing.parseDateOnly(iso) else { return iso }
        if Calendar.current.isDateInToday(date) { return "Сегодня" }
        if Calendar.current.isDateInYesterday(date) { return "Вчера" }
        return date.formatted(.dateTime.weekday(.wide).day().month(.wide))
    }
}

/// Тонкая полоска доли под строкой.
struct ProportionBar: View {
    let ratio: Double
    var color: Color = Theme.brand

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Theme.surfaceRaised)
                Capsule()
                    .fill(color)
                    .frame(width: max(proxy.size.width * min(max(ratio, 0), 1), 2))
            }
        }
        .frame(height: 4)
    }
}
