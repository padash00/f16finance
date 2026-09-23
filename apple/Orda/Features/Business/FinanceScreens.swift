import OrdaKit
import OrdaUI
import SwiftUI

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
            summary = try await service.load(from: from, to: to, rate: rate, includeExtra: ExtraCashPreference.shared.includeExtra)
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
    /// Год с начала — основной: ставка ИПН и порог НДС считаются нарастающим
    /// итогом с 1 января. Любой другой период — под календарём.
    @State private var period: AnalyticsPeriod = .thisYear
    @State private var rate: Double = 2

    var body: some View {
        ScreenScroll {
            VStack(spacing: Spacing.lg) {
                PeriodBar(selection: $period, quick: [.thisMonth, .thisQuarter, .thisYear], showsExtra: true)

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
                let bounds = period.bounds()
                await created.load(from: bounds.from, to: bounds.to, rate: rate)
            }
        }
        .onChange(of: period) { _, _ in Task { await reload() } }
        .onChange(of: rate) { _, _ in Task { await reload() } }
        .onChange(of: ExtraCashPreference.shared.includeExtra) { _, _ in Task { await reload() } }
        .refreshable { await reload() }
    }

    private func reload() async {
        let bounds = period.bounds()
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

    /// Одна цифра — сколько отдать в бюджет; оборот, ИПН и соцплатежи — её
    /// расшифровка под ней, а не четыре плитки стопкой.
    private func burden(_ summary: TaxSummary) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HeroSummary(
                title: "К уплате за период",
                value: Money.format(summary.burden.total),
                caption: "нагрузка \(Percent.format(summary.burden.effectiveRate)) от оборота",
                footer: [
                    ("Оборот", Money.format(summary.revenue)),
                    ("ИПН \(Percent.format(summary.rate))", Money.format(summary.ipn)),
                    ("Соцплатежи", Money.format(summary.selfSocial)),
                ],
                colors: Theme.heroGradient
            )

            if !summary.excludedCompanies.isEmpty {
                let names = summary.excludedCompanies.map(\.name).joined(separator: ", ")
                OwnerFootnote(text: "Без учёта: \(names)")
            }
        }
    }

    // ── Ставка ───────────────────────────────────────────────────────────────

    private func rates(_ constants: TaxConstants) -> some View {
        OwnerSection("Ставка ИПН") {
            Text("устанавливает маслихат")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textDim)
        } content: {
            let options: [(value: Double, title: String)] = constants.allowedRates.map { (value: $0, title: Percent.format($0)) }
            PillSegment(options: options, selection: $rate)
        }
    }

    // ── Разбор ───────────────────────────────────────────────────────────────

    private func breakdown(_ summary: TaxSummary) -> some View {
        let total = max(summary.burden.total, 1)
        return OwnerSection("Из чего складывается") {
            EmptyView()
        } content: {
            VStack(spacing: Spacing.md) {
                AmountRow(
                    leading: { TintedIcon(systemName: "arrow.down", tint: Color(hex: 0x10B981), size: 40) },
                    title: "Облагаемый оборот",
                    subtitle: "база для ИПН",
                    amount: Money.format(summary.revenue)
                )
                AmountRow(
                    leading: { TintedIcon(systemName: "percent", tint: Color(hex: 0x4F46E5), size: 40) },
                    title: "ИПН \(Percent.format(summary.rate))",
                    subtitle: Percent.format(summary.ipn / total * 100) + " налога",
                    amount: Money.format(summary.ipn),
                    share: summary.ipn / total,
                    tint: Color(hex: 0x4F46E5)
                )
                AmountRow(
                    leading: { TintedIcon(systemName: "person.fill", tint: Color(hex: 0x3B82F6), size: 40) },
                    title: "Соцплатежи за себя",
                    subtitle: summary.monthsCount > 0
                        ? "\(Money.format(summary.constants.selfSocialMonthly)) × \(pluralize(summary.monthsCount, "месяц", "месяца", "месяцев"))"
                        : nil,
                    amount: Money.format(summary.selfSocial),
                    share: summary.selfSocial / total,
                    tint: Color(hex: 0x3B82F6)
                )
                if summary.burden.payrollTaxes > 0 {
                    AmountRow(
                        leading: { TintedIcon(systemName: "person.3.fill", tint: Color(hex: 0xF59E0B), size: 40) },
                        title: "Налоги за работников",
                        subtitle: Percent.format(summary.burden.payrollTaxes / total * 100) + " налога",
                        amount: Money.format(summary.burden.payrollTaxes),
                        share: summary.burden.payrollTaxes / total,
                        tint: Color(hex: 0xF59E0B)
                    )
                }

                TaxTotalLine(title: "Всего в бюджет", value: Money.format(summary.burden.total))
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
        OwnerSection("Порог НДС") {
            // Статус подписью, а не плашкой: плашка съедала половину заголовка.
            Text(outlook.vatRisk ? "темп выводит за порог" : "в пределах порога")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(outlook.vatRisk ? Theme.warning : Theme.positive)
        } content: {
            VStack(alignment: .leading, spacing: Spacing.md) {
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
        OwnerSection("Налоги за работников") {
            if payroll.employees > 0 {
                Text(pluralize(payroll.employees, "работник", "работника", "работников"))
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
            }
        } content: {
            VStack(alignment: .leading, spacing: Spacing.md) {
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

/// Итоговая строка под разбором: жирно и через черту, как «итого» в выписке.
private struct TaxTotalLine: View {
    let title: String
    let value: String

    var body: some View {
        VStack(spacing: Spacing.md) {
            RowDivider()
            HStack {
                Text(title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Theme.text)
                Spacer()
                Text(value)
                    .font(.system(size: 18, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(Theme.text)
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
    /// Точки организации — из последнего ответа по всей организации: при
    /// выбранной точке сервер отдаёт только её, и чипы бы пропали.
    private(set) var companies: [CashflowCompany] = []
    private(set) var outlook: CashflowOutlook?
    private(set) var outlookError: APIError?
    private(set) var isLoadingOutlook = false
    private var outlookCompany: String??

    private let service: CashflowService

    init(api: APIClient) { service = CashflowService(api: api) }

    func load(range: AnalyticsPeriod, companyID: String?) async {
        isLoading = true
        defer { isLoading = false }
        do {
            let bounds = range.bounds()
            let loaded = try await service.load(
                from: bounds.from,
                to: bounds.to,
                includeExtra: ExtraCashPreference.shared.includeExtra,
                companyID: companyID
            )
            report = loaded
            if companyID == nil || companies.isEmpty {
                companies = loaded.companies
            }
            error = nil
        } catch let apiError as APIError {
            error = apiError
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }

    /// Платежи вперёд — только когда открыли вкладку: запрос тяжёлый и
    /// нужен не всем.
    func loadOutlook(companyID: String?, force: Bool = false) async {
        if !force, outlookCompany == .some(companyID), outlook != nil { return }
        isLoadingOutlook = true
        defer { isLoadingOutlook = false }
        do {
            outlook = try await service.outlook(companyID: companyID)
            outlookCompany = .some(companyID)
            outlookError = nil
        } catch let apiError as APIError {
            outlookError = apiError
        } catch {
            outlookError = .transport(message: error.localizedDescription)
        }
    }
}

/// Движение денег: сколько пришло и ушло, наличными и безналом, по точкам и
/// статьям, и что впереди до конца месяца — то же, что на сайте.
///
/// Остаток показываем только когда задана отметка остатка: накопленный за
/// период поток — не деньги в кассе, и раньше он подписывался «Баланс на
/// конец», вводя в заблуждение.
struct CashflowScreen: View {
    @Environment(\.api) private var api

    enum Tab: String, CaseIterable, Hashable {
        case overview, channels, points, expenses, payments
        var title: String {
            switch self {
            case .overview: "Обзор"
            case .channels: "Нал и безнал"
            case .points: "Точки"
            case .expenses: "Расходы"
            case .payments: "Платежи"
            }
        }
    }

    @State private var store: CashflowStore?
    @State private var range: AnalyticsPeriod = .thisMonth
    @State private var companyID: String?
    @State private var tab: Tab = .overview
    @Environment(\.access) private var access
    /// Лист «Остаток денег» — отметки остатка, как диалог на сайте.
    @State private var showsBalance = false
    @State private var aiText: String?
    @State private var isAskingAI = false
    @State private var aiError: String?
    @State private var exported: ExportedFile?
    @State private var isExporting = false
    @State private var exportError: String?

    private var canAskAI: Bool { access?.can("cashflow.ai_analysis") ?? false }
    private var canExport: Bool { access?.can("cashflow.export") ?? false }

    var body: some View {
        ScreenScroll {
            VStack(spacing: Spacing.lg) {
                PeriodBar(
                    selection: $range,
                    quick: [.thisMonth, .lastMonth, .last7Days, .last30Days],
                    // Галочка Extra — только когда такие точки есть и точка
                    // не выбрана: у одной точки её не с чем складывать.
                    showsExtra: companyID == nil && !(store?.report?.extraNames.isEmpty ?? true)
                )

                if let companies = store?.companies, companies.count > 1 {
                    pointChips(companies)
                }

                PillSegment(options: Tab.allCases.map { ($0, $0.title) }, selection: $tab)

                if let store {
                    if tab == .payments {
                        PaymentsTab(store: store, companyID: companyID)
                    } else if let error = store.error, store.report == nil {
                        ErrorStateView(error: error) { Task { await reload() } }
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
        .toolbar {
            if canExport, store?.report != nil {
                ToolbarItem(placement: .primaryAction) {
                    Button { Task { await exportPDF() } } label: {
                        if isExporting {
                            ProgressView().controlSize(.small)
                        } else {
                            Image(systemName: "square.and.arrow.up")
                        }
                    }
                    .disabled(isExporting)
                    .accessibilityLabel("Выгрузить PDF")
                }
            }
            LogoutToolbarItem()
        }
        .shareSheet($exported)
        .alert("PDF не собрался", isPresented: Binding(get: { exportError != nil }, set: { if !$0 { exportError = nil } })) {
            Button("Понятно", role: .cancel) {}
        } message: {
            Text(exportError ?? "")
        }
        .sheet(isPresented: $showsBalance) {
            CashflowBalanceSheet(
                companies: store?.companies ?? [],
                defaultCompanyID: companyID
            ) {
                Task { await reload() }
            }
        }
        .onChange(of: range) { _, _ in aiText = nil }
        .onChange(of: companyID) { _, _ in aiText = nil }
        .task {
            if store == nil {
                let created = CashflowStore(api: api)
                store = created
                #if DEBUG
                // Снимки экрана: `-ordaCashflowTab overview|channels|points|expenses|payments`.
                if let raw = UserDefaults.standard.string(forKey: "ordaCashflowTab"), let wanted = Tab(rawValue: raw) {
                    tab = wanted
                }
                #endif
                await created.load(range: range, companyID: companyID)
                #if DEBUG
                // Снимки экрана: `-ordaCashflowOpen balance|ai|pdf`.
                switch UserDefaults.standard.string(forKey: "ordaCashflowOpen") {
                case "balance": showsBalance = true
                case "ai": await askAI()
                case "pdf": await exportPDF()
                default: break
                }
                #endif
            }
        }
        .onChange(of: range) { _, _ in Task { await reload() } }
        .onChange(of: companyID) { _, _ in Task { await reload() } }
        .onChange(of: ExtraCashPreference.shared.includeExtra) { _, _ in Task { await reload() } }
        .refreshable {
            await reload()
            if tab == .payments { await store?.loadOutlook(companyID: companyID, force: true) }
        }
    }

    private func reload() async {
        await store?.load(range: range, companyID: companyID)
    }

    private var loadingState: some View {
        VStack(spacing: Spacing.lg) {
            Skeleton(height: 150, cornerRadius: Radius.xl)
            Skeleton(height: 240, cornerRadius: Radius.lg)
            Skeleton(height: 180, cornerRadius: Radius.lg)
        }
    }

    // ── Точки ────────────────────────────────────────────────────────────────

    private func pointChips(_ companies: [CashflowCompany]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Spacing.sm) {
                chip("Все точки", isOn: companyID == nil) { companyID = nil }
                ForEach(companies) { company in
                    chip(company.name, isOn: companyID == company.id) { companyID = company.id }
                }
            }
        }
        .scrollClipDisabled()
    }

    private func chip(_ title: String, isOn: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(isOn ? .white : Theme.text)
                .padding(.horizontal, 14)
                .frame(height: 34)
                .background(isOn ? Theme.brand : Theme.surface, in: Capsule())
                .overlay(Capsule().strokeBorder(isOn ? .clear : Theme.border, lineWidth: 1))
        }
        .buttonStyle(.pressable)
    }

    // ── Содержимое ───────────────────────────────────────────────────────────

    @ViewBuilder
    private func content(_ report: CashflowReport) -> some View {
        if report.days.isEmpty {
            WideEmptyState(
                icon: "arrow.left.arrow.right",
                title: "Движений нет",
                message: "За выбранный период не было ни доходов, ни расходов."
            )
        } else {
            VStack(spacing: Spacing.lg) {
                hero(report)
                switch tab {
                case .overview: overview(report)
                case .channels: channels(report)
                case .points: points(report)
                case .expenses: expenses(report)
                case .payments: EmptyView()
                }
            }
        }
    }

    /// Итог периода. Остаток — только по отметке остатка; иначе честно
    /// «накоплено за период».
    private func hero(_ report: CashflowReport) -> some View {
        let flows = report.flows.total.inflow == 0 && report.flows.total.outflow == 0
            ? CashflowFlow(inflow: report.totals.income, outflow: report.totals.expense, net: report.totals.net)
            : report.flows.total
        var footer: [(String, String)] = [
            ("Пришло", Money.format(flows.inflow)),
            ("Ушло", Money.format(flows.outflow)),
        ]
        if let end = report.balance?.end {
            footer.append(("Остаток на конец", Money.format(end.total)))
        } else {
            footer.append(("Накоплено", Money.format(report.totals.endingBalance)))
        }
        var caption: String?
        if let change = Percent.change(current: flows.net, previous: report.previous.total.net), report.previous.total.inflow > 0 {
            caption = "\(change >= 0 ? "+" : "")\(Percent.format(change)) к прошлому периоду"
        }
        if report.pendingCount > 0 {
            let pending = "ещё \(Money.format(report.pendingTotal)) ждут согласования"
            caption = caption.map { "\($0) · \(pending)" } ?? pending
        }
        return HeroSummary(
            title: flows.net >= 0 ? "Чистый поток за период" : "Ушло больше, чем пришло",
            value: Money.signed(flows.net),
            caption: caption,
            footer: footer,
            colors: flows.net >= 0 ? Theme.heroGradient : Theme.heroNegative
        )
    }

    // ── Обзор ────────────────────────────────────────────────────────────────

    @ViewBuilder
    private func overview(_ report: CashflowReport) -> some View {
        balanceRow(report)

        dailyChart(report)

        let activities = report.activities.filter { $0.amount > 0 || $0.previous > 0 }
        if !activities.isEmpty {
            let total = max(activities.reduce(0) { $0 + $1.amount }, 1)
            OwnerSection("Куда ушли деньги") {
                Text("к прошлому периоду")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
            } content: {
                VStack(spacing: Spacing.md) {
                    ForEach(Array(activities.enumerated()), id: \.element.id) { index, activity in
                        AmountRow(
                            leading: { TintedIcon(systemName: Self.activityIcon(activity.key), tint: OwnerTint.point(index), size: 40) },
                            title: activity.label,
                            subtitle: "нал \(Money.format(activity.cash)) · безнал \(Money.format(activity.cashless))",
                            amount: Money.format(activity.amount),
                            change: Percent.change(current: activity.amount, previous: activity.previous),
                            higherIsBetter: false,
                            share: activity.amount / total,
                            tint: OwnerTint.point(index)
                        )
                    }
                }
            }
        }

        highlights(report)

        if canAskAI { aiCard(report) }
    }

    /// Строка «Остаток денег»: чем подтверждён остаток и куда нажать, чтобы
    /// указать его. Без отметки остаток не считается — это честно пишем.
    private func balanceRow(_ report: CashflowReport) -> some View {
        Button { showsBalance = true } label: {
            HStack(spacing: Spacing.md) {
                TintedIcon(systemName: "banknote.fill", tint: Theme.brand, size: 42)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Остаток денег")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Theme.text)
                    Text(report.balance?.anchor.map { "отметка на \(Self.dayLabel($0.asOfDate))" } ?? "не указан — нажмите, чтобы указать")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textDim)
                        .lineLimit(1)
                }
                Spacer(minLength: Spacing.sm)
                if let end = report.balance?.end {
                    Text(Money.format(end.total))
                        .font(.system(size: 16, weight: .bold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(end.total < 0 ? Theme.negative : Theme.text)
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.textDim)
            }
            .padding(Spacing.lg)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
        }
        .buttonStyle(.pressable)
    }

    /// Разбор ИИ — по кнопке: запрос платный и не нужен при каждом входе.
    private func aiCard(_ report: CashflowReport) -> some View {
        OwnerSection("Разбор ИИ") {
            if aiText != nil {
                Button("Обновить") { Task { await askAI() } }
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.brand)
                    .disabled(isAskingAI)
            }
        } content: {
            VStack(alignment: .leading, spacing: Spacing.md) {
                if let aiText {
                    AiTextBlocks(blocks: InsightMarkdown.blocks(from: aiText))
                } else {
                    Text("Три коротких вывода с цифрами: что хорошо, что тревожит — особенно наличные и крупные выплаты — и одно главное действие.")
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.textDim)
                        .fixedSize(horizontal: false, vertical: true)
                    Button {
                        Task { await askAI() }
                    } label: {
                        HStack(spacing: Spacing.sm) {
                            if isAskingAI {
                                ProgressView().controlSize(.small).tint(.white)
                                Text("Разбираем…")
                            } else {
                                Image(systemName: "sparkles")
                                Text("Разобрать период")
                            }
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(isAskingAI)
                }
                if let aiError {
                    Text(aiError)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.negative)
                }
            }
        }
    }

    private func askAI() async {
        guard let report = store?.report, !isAskingAI else { return }
        isAskingAI = true
        defer { isAskingAI = false }
        aiError = nil
        do {
            aiText = try await CashflowService(api: api).aiAnalysis(report)
        } catch let error as APIError {
            aiError = error.userMessage
        } catch {
            aiError = error.localizedDescription
        }
    }

    /// PDF собирает сервер — тот же отчёт, что скачивают на сайте.
    private func exportPDF() async {
        guard let report = store?.report, !isExporting else { return }
        isExporting = true
        defer { isExporting = false }
        do {
            let data = try await CashflowService(api: api).pdf(report)
            exported = try ExportedFile.write(data, name: CashflowExport.pdfFileName(report))
            Haptics.success()
        } catch let error as APIError {
            exportError = error.userMessage
        } catch {
            exportError = error.localizedDescription
        }
    }

    private static func activityIcon(_ key: String) -> String {
        switch key {
        case "operating": "cart.fill"
        case "investing": "hammer.fill"
        case "owners": "person.2.fill"
        case "taxes": "building.columns.fill"
        default: "ellipsis.circle.fill"
        }
    }

    /// Остаток по дням, если есть отметка, иначе накопленный поток.
    private func dailyChart(_ report: CashflowReport) -> some View {
        let hasOnHand = report.days.contains { $0.onHand != nil }
        let points = report.days.compactMap { item -> TimePoint? in
            guard let date = item.day else { return nil }
            let value = hasOnHand ? (item.onHand?.total ?? item.balance) : item.balance
            return TimePoint(label: item.label, date: date, value: value)
        }
        return Group {
            if points.count > 1 {
                TrendChart(
                    title: hasOnHand ? "Остаток по дням" : "Накоплено с начала периода",
                    subtitle: hasOnHand ? "деньги на конец каждого дня" : "нарастающим итогом, не остаток кассы",
                    points: points,
                    color: ChartPalette.series1
                )
            } else {
                Card {
                    InlineEmpty(icon: "chart.xyaxis.line", text: "Для графика мало дней", tint: Theme.textDim)
                }
            }
        }
    }

    private func highlights(_ report: CashflowReport) -> some View {
        OwnerSection("Чем запомнился период") {
            EmptyView()
        } content: {
            VStack(spacing: 0) {
                statLine("Маржа", Percent.format(report.totals.margin), color: report.totals.margin >= 0 ? Theme.text : Theme.negative)
                divider
                statLine("Дней в минусе", "\(report.totals.negativeDays) из \(report.totals.daysCount)", color: report.totals.negativeDays > 0 ? Theme.warning : Theme.text)
                if let best = report.bestDay, best.net > 0 {
                    divider
                    statLine("Лучший день · \(best.label)", Money.signed(best.net), color: Theme.positive)
                }
                if let worst = report.worstDay {
                    divider
                    statLine("Худший день · \(worst.label)", Money.signed(worst.net), color: Theme.negative)
                }
                if let lowest = report.balance?.lowest {
                    divider
                    statLine("Меньше всего денег · \(Self.dayLabel(lowest.date))", Money.format(lowest.total), color: lowest.total < 0 ? Theme.negative : Theme.text)
                }
                if let anchor = report.balance?.anchor {
                    divider
                    statLine("Отметка остатка", Self.dayLabel(anchor.asOfDate), color: Theme.textMuted)
                }
            }
        }
    }

    // ── Нал и безнал ─────────────────────────────────────────────────────────

    @ViewBuilder
    private func channels(_ report: CashflowReport) -> some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            channelCard("Наличные", icon: "banknote.fill", tint: Theme.positive, flow: report.flows.cash, previous: report.previous.cash, start: report.balance?.start?.cash, end: report.balance?.end?.cash)
            channelCard("Безналичный", icon: "creditcard.fill", tint: Theme.brand, flow: report.flows.cashless, previous: report.previous.cashless, start: report.balance?.start?.cashless, end: report.balance?.end?.cashless)
        }

        if !report.cashDeficitDays.isEmpty {
            OwnerSection("Наличных ушло больше, чем пришло") {
                Text("\(report.cashDeficitDays.count) \(pluralize(report.cashDeficitDays.count, "день", "дня", "дней"))")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
            } content: {
                VStack(spacing: 0) {
                    ForEach(Array(report.cashDeficitDays.enumerated()), id: \.element.id) { index, day in
                        if index > 0 { divider }
                        statLine(Self.dayLabel(day.date), Money.signed(day.net), color: Theme.negative)
                    }
                }
            }
        }

        OwnerSection("По дням") {
            Text("нал · безнал")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textDim)
        } content: {
            VStack(spacing: 0) {
                ForEach(Array(report.days.reversed().prefix(31).enumerated()), id: \.element.id) { index, day in
                    if index > 0 { divider }
                    HStack(spacing: Spacing.md) {
                        Text(day.label)
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(Theme.text)
                            .frame(width: 64, alignment: .leading)
                        channelDelta("нал", day.cashIn, day.cashOut)
                        Spacer(minLength: Spacing.sm)
                        channelDelta("безнал", day.cashlessIn, day.cashlessOut)
                    }
                    .padding(.vertical, 10)
                }
            }
        }
    }

    private func channelDelta(_ label: String, _ inflow: Double, _ outflow: Double) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(Money.signed(inflow - outflow))
                .font(.system(size: 14, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(inflow - outflow >= 0 ? Theme.text : Theme.negative)
            Text("\(label): +\(Money.format(inflow)) −\(Money.format(outflow))")
                .font(.system(size: 11))
                .monospacedDigit()
                .foregroundStyle(Theme.textDim)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
    }

    private func channelCard(_ title: String, icon: String, tint: Color, flow: CashflowFlow, previous: CashflowFlow, start: Double?, end: Double?) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack(spacing: Spacing.sm) {
                TintedIcon(systemName: icon, tint: tint, size: 32, corner: 9)
                Text(title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            Text(Money.signed(flow.net))
                .font(.system(size: 22, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(flow.net >= 0 ? Theme.text : Theme.negative)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            if let change = Percent.change(current: flow.net, previous: previous.net), previous.inflow > 0 {
                ChangeText(change: change)
            }
            VStack(alignment: .leading, spacing: 3) {
                miniLine("Пришло", flow.inflow)
                miniLine("Ушло", flow.outflow)
                if let start { miniLine("На начало", start) }
                if let end { miniLine("На конец", end) }
            }
            .padding(.top, 2)
        }
        .padding(Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
    }

    private func miniLine(_ label: String, _ value: Double) -> some View {
        HStack {
            Text(label)
                .font(.system(size: 12))
                .foregroundStyle(Theme.textDim)
            Spacer(minLength: 4)
            Text(Money.format(value))
                .font(.system(size: 12, weight: .medium))
                .monospacedDigit()
                .foregroundStyle(Theme.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
    }

    // ── Точки ────────────────────────────────────────────────────────────────

    @ViewBuilder
    private func points(_ report: CashflowReport) -> some View {
        let rows = report.companies
            .filter { $0.flows.total.inflow != 0 || $0.flows.total.outflow != 0 }
            .sorted { $0.flows.total.inflow > $1.flows.total.inflow }
        if rows.isEmpty {
            WideEmptyState(icon: "building.2", title: "По точкам пусто", message: "За период у точек не было движений.")
        } else {
            let top = max(rows.map(\.flows.total.inflow).max() ?? 1, 1)
            OwnerSection("Точки") {
                Text("пришло · ушло")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
            } content: {
                VStack(spacing: Spacing.md) {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, company in
                        Button {
                            companyID = company.id
                            tab = .overview
                        } label: {
                            AmountRow(
                                leading: { LetterBadge(text: company.name, tint: OwnerTint.point(index)) },
                                title: company.name + (company.inTotals ? "" : " · вне итогов"),
                                subtitle: "пришло \(Money.format(company.flows.total.inflow)) · ушло \(Money.format(company.flows.total.outflow))",
                                amount: Money.signed(company.flows.total.net),
                                change: Percent.change(current: company.flows.total.net, previous: company.previousNet),
                                share: company.flows.total.inflow / top,
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

    // ── Расходы ──────────────────────────────────────────────────────────────

    @ViewBuilder
    private func expenses(_ report: CashflowReport) -> some View {
        if report.pendingCount > 0 {
            HStack(spacing: Spacing.md) {
                TintedIcon(systemName: "clock.badge.exclamationmark.fill", tint: Theme.warning, size: 42)
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(report.pendingCount) \(pluralize(report.pendingCount, "расход ждёт", "расхода ждут", "расходов ждут")) согласования")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.text)
                    Text("\(Money.format(report.pendingTotal)) — в «ушло» пока не входят")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textDim)
                }
                Spacer(minLength: 0)
            }
            .padding(Spacing.lg)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
        }

        let categories = report.categories.filter { $0.amount > 0 }.sorted { $0.amount > $1.amount }
        if !categories.isEmpty {
            let total = max(categories.reduce(0) { $0 + $1.amount }, 1)
            OwnerSection("Статьи") {
                Text("\(categories.count)")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
            } content: {
                VStack(spacing: Spacing.md) {
                    ForEach(Array(categories.enumerated()), id: \.element.id) { index, category in
                        AmountRow(
                            leading: { TintedIcon(systemName: OwnerAnalyticsScreen.expenseIcon(category.name), tint: OwnerTint.point(index), size: 40) },
                            title: category.name,
                            subtitle: "нал \(Money.format(category.cash)) · безнал \(Money.format(category.cashless))" + (category.previous > 0 ? " · было \(Money.format(category.previous))" : ""),
                            amount: Money.format(category.amount),
                            change: Percent.change(current: category.amount, previous: category.previous),
                            higherIsBetter: false,
                            share: category.amount / total,
                            tint: OwnerTint.point(index)
                        )
                    }
                }
            }
        }

        if !report.largestExpenses.isEmpty {
            OwnerSection("Крупные расходы") {
                EmptyView()
            } content: {
                VStack(spacing: 0) {
                    ForEach(Array(report.largestExpenses.enumerated()), id: \.element.id) { index, item in
                        if index > 0 { divider }
                        HStack(spacing: Spacing.md) {
                            TintedIcon(systemName: OwnerAnalyticsScreen.expenseIcon(item.category), tint: item.pending ? Theme.warning : Theme.negative, size: 40, corner: 12)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.payee.isEmpty ? item.category : item.payee)
                                    .font(.system(size: 15, weight: .medium))
                                    .foregroundStyle(Theme.text)
                                    .lineLimit(1)
                                Text([Self.dayLabel(item.date), item.company, item.payee.isEmpty ? nil : item.category, item.pending ? "ждёт согласования" : nil].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                                    .font(.system(size: 13))
                                    .foregroundStyle(Theme.textDim)
                                    .lineLimit(1)
                            }
                            Spacer(minLength: Spacing.sm)
                            Text("−" + Money.format(item.amount))
                                .font(.system(size: 15, weight: .semibold, design: .rounded))
                                .monospacedDigit()
                                .foregroundStyle(Theme.text)
                        }
                        .padding(.vertical, 10)
                    }
                }
            }
        }

        if categories.isEmpty && report.largestExpenses.isEmpty && report.pendingCount == 0 {
            WideEmptyState(icon: "cart", title: "Расходов нет", message: "За период ничего не потратили.")
        }
    }

    // ── Мелочи ───────────────────────────────────────────────────────────────

    private var divider: some View {
        Rectangle().fill(Theme.borderSoft).frame(height: 1)
    }

    private func statLine(_ label: String, _ value: String, color: Color) -> some View {
        HStack {
            Text(label)
                .font(.system(size: 15))
                .foregroundStyle(Theme.textMuted)
                .lineLimit(1)
            Spacer(minLength: Spacing.md)
            Text(value)
                .font(.system(size: 15, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(color)
        }
        .padding(.vertical, 11)
    }

    static func dayLabel(_ iso: String) -> String {
        guard let date = DateParsing.parseDateOnly(iso) else { return iso }
        return date.formatted(.dateTime.day().month(.abbreviated))
    }
}

/// Вкладка «Платежи»: регулярные платежи на месяц вперёд и деньги до конца
/// месяца. Грузится при открытии вкладки.
private struct PaymentsTab: View {
    let store: CashflowStore
    let companyID: String?

    var body: some View {
        VStack(spacing: Spacing.lg) {
            if let outlook = store.outlook {
                projection(outlook)
                payments(outlook)
            } else if let error = store.outlookError {
                ErrorStateView(error: error) { Task { await store.loadOutlook(companyID: companyID, force: true) } }
            } else {
                Skeleton(height: 150, cornerRadius: Radius.xl)
                Skeleton(height: 220, cornerRadius: Radius.lg)
            }
        }
        .task(id: companyID ?? "") { await store.loadOutlook(companyID: companyID) }
    }

    @ViewBuilder
    private func projection(_ outlook: CashflowOutlook) -> some View {
        if let projection = outlook.projection {
            let end = projection.balanceEnd
            HeroSummary(
                title: end != nil ? "Останется к \(CashflowScreen.dayLabel(projection.monthEnd))" : "Поток до \(CashflowScreen.dayLabel(projection.monthEnd))",
                value: Money.signed(end ?? projection.netLeft),
                caption: projection.source == "model" ? "по модели прогноза выручки" : "по среднему дню",
                footer: [
                    ("Придёт", Money.format(projection.incomeLeft)),
                    ("Платежи", Money.format(projection.paymentsLeft)),
                    ("Прочее", Money.format(projection.otherSpendLeft)),
                ],
                colors: (end ?? projection.netLeft) >= 0 ? Theme.heroGradient : Theme.heroNegative
            )

            if let lowest = projection.lowestBalance, let date = projection.lowestDate, lowest < 0 {
                HStack(spacing: Spacing.md) {
                    TintedIcon(systemName: "exclamationmark.triangle.fill", tint: Theme.negative, size: 42)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(CashflowScreen.dayLabel(date)) денег не хватит")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Theme.text)
                        Text("минимум \(Money.format(lowest)) — перенесите платёж или отложите заранее")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textDim)
                    }
                    Spacer(minLength: 0)
                }
                .padding(Spacing.lg)
                .background(Theme.negative.opacity(0.08), in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
            }

            let points = projection.days.compactMap { day -> TimePoint? in
                guard let date = DateParsing.parseDateOnly(day.date), let balance = day.balance else { return nil }
                return TimePoint(label: CashflowScreen.dayLabel(day.date), date: date, value: balance)
            }
            if points.count > 1 {
                TrendChart(
                    title: "Деньги до конца месяца",
                    subtitle: "остаток по дням с учётом платежей",
                    points: points,
                    color: ChartPalette.series2
                )
            }
        }
    }

    @ViewBuilder
    private func payments(_ outlook: CashflowOutlook) -> some View {
        if outlook.payments.isEmpty {
            WideEmptyState(
                icon: "calendar.badge.clock",
                title: "Регулярных платежей нет",
                message: "Они появятся, когда в шаблонах расходов будет день месяца."
            )
        } else {
            let total = outlook.payments.reduce(0) { $0 + $1.amount }
            OwnerSection("Регулярные платежи") {
                Text("на 31 день · \(Money.format(total))")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
            } content: {
                VStack(spacing: 0) {
                    ForEach(Array(outlook.payments.enumerated()), id: \.element.id) { index, payment in
                        if index > 0 {
                            Rectangle().fill(Theme.borderSoft).frame(height: 1).padding(.leading, 52)
                        }
                        HStack(spacing: Spacing.md) {
                            VStack(spacing: 0) {
                                Text(Self.dayNumber(payment.date))
                                    .font(.system(size: 16, weight: .bold, design: .rounded))
                                    .foregroundStyle(Theme.text)
                                Text(Self.monthShort(payment.date))
                                    .font(.system(size: 10, weight: .semibold))
                                    .foregroundStyle(Theme.textDim)
                            }
                            .frame(width: 40, height: 40)
                            .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(payment.name)
                                    .font(.system(size: 15, weight: .medium))
                                    .foregroundStyle(Theme.text)
                                    .lineLimit(1)
                                Text("\(payment.company) · \(payment.cashless ? "безнал" : "наличные")")
                                    .font(.system(size: 13))
                                    .foregroundStyle(Theme.textDim)
                                    .lineLimit(1)
                            }
                            Spacer(minLength: Spacing.sm)
                            Text(Money.format(payment.amount))
                                .font(.system(size: 15, weight: .semibold, design: .rounded))
                                .monospacedDigit()
                                .foregroundStyle(Theme.text)
                        }
                        .padding(.vertical, 10)
                    }
                }
            }
        }
    }

    private static func dayNumber(_ iso: String) -> String {
        Int(iso.suffix(2)).map(String.init) ?? iso
    }

    private static func monthShort(_ iso: String) -> String {
        guard let date = DateParsing.parseDateOnly(iso) else { return "" }
        return date.formatted(.dateTime.month(.abbreviated))
    }
}

// ── Остаток денег ────────────────────────────────────────────────────────────

/// Отметки остатка — как диалог «Остаток денег» на сайте.
///
/// Сколько было наличных и безналичных на утро даты — до движений этого дня.
/// Дальше система считает остаток сама. Пересчитали кассу — новая отметка.
struct CashflowBalanceSheet: View {
    let companies: [CashflowCompany]
    let defaultCompanyID: String?
    var onChanged: () -> Void

    @Environment(\.api) private var api
    @Environment(\.dismiss) private var dismiss

    @State private var list: CashflowAnchorList?
    @State private var loadError: String?
    @State private var companyID: String?
    @State private var date = Date()
    @State private var cashText = ""
    @State private var cashlessText = ""
    @State private var note = ""
    @State private var isSaving = false
    @State private var saveError: String?
    @State private var deleting: CashflowAnchor?

    var body: some View {
        NavigationStack {
            ScreenScroll {
                Text("Сколько было наличных и безналичных на утро даты — до движений этого дня. Дальше система считает остаток сама. Пересчитали кассу — добавьте новую отметку.")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textDim)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)

                if let list {
                    if !list.available {
                        notice(list.hint ?? "Функция ещё не включена.", icon: "exclamationmark.triangle.fill", tint: Theme.warning)
                    } else {
                        if list.canEdit {
                            form
                        } else {
                            notice("Указать остаток может владелец или управляющий.", icon: "lock.fill", tint: Theme.textDim)
                        }
                        anchors(list)
                    }
                } else if let loadError {
                    notice(loadError, icon: "exclamationmark.circle.fill", tint: Theme.negative)
                } else {
                    LoadingRows(count: 3)
                }
            }
            .background(Theme.background)
            .navigationTitle("Остаток денег")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Закрыть") { dismiss() }
                }
            }
            .task {
                companyID = defaultCompanyID
                await load()
            }
            .confirmationDialog(
                "Удалить отметку остатка?",
                isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                titleVisibility: .visible
            ) {
                if let anchor = deleting {
                    Button("Удалить", role: .destructive) { Task { await remove(anchor) } }
                }
                Button("Отмена", role: .cancel) { deleting = nil }
            } message: {
                Text("Остаток будет считаться от предыдущей отметки, если она есть.")
            }
        }
    }

    // ── Новая отметка ────────────────────────────────────────────────────────

    private var form: some View {
        VStack(spacing: Spacing.md) {
            LedgerEditForm.section("Новая отметка") {
                LedgerEditForm.menuRow("Чьи деньги", icon: "building.2.fill", value: companyName(companyID)) {
                    Button("Вся организация") { companyID = nil }
                    ForEach(companies) { company in
                        Button(company.name) { companyID = company.id }
                    }
                }
                LedgerEditForm.divider
                HStack {
                    Label {
                        Text("На утро даты").font(.system(size: 16)).foregroundStyle(Theme.text)
                    } icon: {
                        Image(systemName: "calendar")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Theme.brand)
                            .frame(width: 28)
                    }
                    Spacer()
                    DatePicker("", selection: $date, in: ...Date(), displayedComponents: .date)
                        .labelsHidden()
                }
                .padding(.vertical, 8)
                LedgerEditForm.divider
                LedgerEditForm.amountRow("Наличные", icon: "banknote.fill", text: $cashText)
                LedgerEditForm.divider
                LedgerEditForm.amountRow("Безналичный", icon: "creditcard.fill", text: $cashlessText)
                LedgerEditForm.divider
                LedgerEditForm.commentRow($note)
            }
            LedgerEditForm.saveButton(isSaving: isSaving, problem: nil, error: saveError) {
                Task { await save() }
            }
        }
    }

    // ── Отметки ──────────────────────────────────────────────────────────────

    @ViewBuilder
    private func anchors(_ list: CashflowAnchorList) -> some View {
        OwnerSection("Отметки") {
            Text("\(list.anchors.count)")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textDim)
        } content: {
            if list.anchors.isEmpty {
                Text("Пока нет ни одной.")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textDim)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(list.anchors.enumerated()), id: \.element.id) { index, anchor in
                        if index > 0 {
                            Rectangle().fill(Theme.borderSoft).frame(height: 1).padding(.leading, 52)
                        }
                        HStack(spacing: Spacing.md) {
                            TintedIcon(systemName: anchor.companyID == nil ? "building.columns.fill" : "storefront.fill", tint: Theme.brand, size: 40, corner: 12)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(CashflowScreen.dayLabel(anchor.asOfDate)) · \(anchor.companyID == nil ? "Вся организация" : companyName(anchor.companyID))")
                                    .font(.system(size: 15, weight: .medium))
                                    .foregroundStyle(Theme.text)
                                    .lineLimit(1)
                                Text(anchorLine(anchor))
                                    .font(.system(size: 13))
                                    .foregroundStyle(Theme.textDim)
                                    .lineLimit(2)
                            }
                            Spacer(minLength: Spacing.sm)
                            if list.canEdit {
                                Button { deleting = anchor } label: {
                                    Image(systemName: "trash")
                                        .font(.system(size: 14, weight: .semibold))
                                        .foregroundStyle(Theme.negative)
                                        .frame(width: 32, height: 32)
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Удалить отметку")
                            }
                        }
                        .padding(.vertical, 10)
                    }
                }
            }
        }
    }

    private func anchorLine(_ anchor: CashflowAnchor) -> String {
        var line = "нал \(Money.format(anchor.cash)) · безнал \(Money.format(anchor.cashless))"
        if let note = anchor.note, !note.isEmpty { line += " · \(note)" }
        return line
    }

    private func notice(_ text: String, icon: String, tint: Color) -> some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            Image(systemName: icon)
                .foregroundStyle(tint)
            Text(text)
                .font(.system(size: 14))
                .foregroundStyle(Theme.textMuted)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(Spacing.lg)
        .background(tint.opacity(0.10), in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
    }

    private func companyName(_ id: String?) -> String {
        guard let id else { return "Вся организация" }
        return companies.first { $0.id == id }?.name ?? "Точка"
    }

    // ── Запросы ──────────────────────────────────────────────────────────────

    private func load() async {
        do {
            list = try await CashflowService(api: api).balanceAnchors()
            loadError = nil
        } catch let error as APIError {
            loadError = error.userMessage
        } catch {
            loadError = error.localizedDescription
        }
    }

    private func save() async {
        let cash = AmountParsing.value(cashText.isEmpty ? "0" : cashText)
        let cashless = AmountParsing.value(cashlessText.isEmpty ? "0" : cashlessText)
        isSaving = true
        defer { isSaving = false }
        saveError = nil
        do {
            try await CashflowService(api: api).saveBalanceAnchor(CashflowAnchorDraft(
                companyID: companyID,
                date: DateParsing.dateOnlyString(from: date),
                cash: cash,
                cashless: cashless,
                note: note
            ))
            Haptics.success()
            cashText = ""
            cashlessText = ""
            note = ""
            await load()
            onChanged()
        } catch let error as APIError {
            saveError = error.userMessage
            Haptics.error()
        } catch {
            saveError = error.localizedDescription
            Haptics.error()
        }
    }

    private func remove(_ anchor: CashflowAnchor) async {
        deleting = nil
        do {
            try await CashflowService(api: api).deleteBalanceAnchor(id: anchor.id)
            Haptics.success()
            await load()
            onChanged()
        } catch let error as APIError {
            saveError = error.userMessage
            Haptics.error()
        } catch {
            saveError = error.localizedDescription
            Haptics.error()
        }
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
                // Годы — кнопками, как в «Аналитике по месяцам».
                let options: [(value: Int, title: String)] = years.map { (value: $0, title: String($0)) }
                PillSegment(options: options, selection: $year)

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

            let done = plans.filter(\.isDone).count

            VStack(spacing: Spacing.lg) {
                // Главное в целях — сколько уже выполнено; остальное — её
                // расшифровка, а не четыре равные плитки.
                HeroSummary(
                    title: "Выполнено планов за \(String(year))",
                    value: "\(done) из \(plans.count)",
                    footer: [
                        ("Планов на год", "\(plans.count)"),
                        ("В работе", "\(open.count)"),
                        ("Закрытых периодов", "\(closed.count)"),
                    ],
                    colors: Theme.heroGradient
                )

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
        OwnerSection(title) {
            if !plans.isEmpty {
                Text("\(plans.count)")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
            }
        } content: {
            if plans.isEmpty {
                InlineEmpty(icon: "target", text: empty, tint: Theme.textDim)
            } else {
                VStack(spacing: Spacing.md) {
                    ForEach(plans, id: \.id) { plan in
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

    /// Иконка по метрике — строки разных целей различаются с первого взгляда.
    private var icon: String {
        switch plan.metric {
        case "revenue": "arrow.down.circle.fill"
        case "profit": "banknote.fill"
        case "checks": "doc.text.fill"
        case "avg_check": "cart.fill"
        case "margin": "percent"
        default: "target"
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            TintedIcon(systemName: plan.isDone ? "checkmark" : icon, tint: tint, size: 40)

            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                    Text("\(plan.metricLabel) · \(plan.periodLabel)")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                    Spacer(minLength: Spacing.sm)
                    // Процент текстом цвета статуса, а не плашкой — плашка
                    // съедала половину строки.
                    Text(Percent.format(plan.achievement))
                        .font(.system(size: 16, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(statusColor)
                }

                Text(companyName)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)

                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Theme.surfaceRaised)
                        Capsule().fill(tint).frame(width: max(3, geo.size.width * min(max(plan.progress, 0), 1)))
                    }
                }
                .frame(height: 4)
                .padding(.top, 2)

                HStack {
                    Text("Факт \(plan.formattedFact)")
                        .foregroundStyle(Theme.textMuted)
                    Spacer(minLength: Spacing.sm)
                    Text("План \(plan.formattedTarget)")
                        .foregroundStyle(Theme.textDim)
                }
                .font(.system(size: 12))
                .monospacedDigit()
            }
        }
        .padding(.vertical, Spacing.xs)
    }

    /// Закрытый период с недобором — уже не «в работе», а провал: цвет должен
    /// это говорить, иначе строка выглядит как незаконченная.
    private var statusColor: Color {
        if plan.isDone { return Theme.positive }
        if plan.isClosed { return Theme.negative }
        return plan.progress >= 0.7 ? Theme.info : Theme.warning
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
    static func weekEnd(of weekStart: String) -> String {
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
        .weeklyActPdfExport(week: week, weekEnd: WeeklyReportStore.weekEnd(of: week))
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
                // Итог недели — главной цифрой; выручка, расходы и остаток в
                // кассе — её расшифровка, как в «Движении денег».
                HeroSummary(
                    title: totals.net >= 0 ? "Итог недели" : "Неделя в минусе",
                    value: Money.signed(totals.net),
                    footer: [
                        ("Выручка", Money.format(totals.income.total)),
                        ("Расходы", Money.format(totals.expenseTotal)),
                        ("Остаток наличных", Money.format(totals.remainCash)),
                    ],
                    colors: totals.net >= 0
                        ? Theme.heroGradient
                        : Theme.heroNegative
                )

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
        // Дни, которые ещё не наступили, не рисуем: нули в конце идущей
        // недели читались как обвал выручки.
        let today = Calendar.current.startOfDay(for: Date())
        let points = report.dailyTotals.compactMap { day -> TimePoint? in
            guard let date = day.day, Calendar.current.startOfDay(for: date) <= today else { return nil }
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

    /// Способы оплаты — кольцом и строками с долей, как «Чем платили» в
    /// доходах: одинаковые разделы выглядят одинаково на всех экранах.
    private func payments(_ totals: WeeklyTotals) -> some View {
        let all: [(name: String, icon: String, amount: Double, color: Color)] = [
            ("Наличные", "banknote.fill", totals.income.cash, ChartPalette.series1),
            ("Kaspi", "qrcode", totals.income.kaspi, ChartPalette.series2),
            ("Карта", "creditcard.fill", totals.income.card, ChartPalette.series3),
            ("Онлайн", "globe", totals.income.online, Theme.textDim),
        ]
        let methods = all.filter { $0.amount > 0 }
        let total = max(totals.income.total, 1)

        return OwnerSection("Чем платили") {
            if totals.income.total > 0 {
                Text("безнал \(Money.format(totals.income.cashless))")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
            }
        } content: {
            if totals.income.total <= 0 {
                InlineEmpty(icon: "creditcard", text: "Выручки за неделю нет", tint: Theme.textDim)
            } else {
                VStack(spacing: Spacing.lg) {
                    DonutChart(
                        slices: methods.map { ShareSlice(label: $0.name, value: $0.amount, color: $0.color) },
                        centerTitle: "Выручка",
                        centerValue: Money.format(totals.income.total),
                        showsLegend: false
                    )

                    VStack(spacing: Spacing.md) {
                        ForEach(methods, id: \.name) { method in
                            AmountRow(
                                leading: { TintedIcon(systemName: method.icon, tint: method.color, size: 40) },
                                title: method.name,
                                subtitle: Percent.format(method.amount / total * 100),
                                amount: Money.format(method.amount),
                                share: method.amount / total,
                                tint: method.color
                            )
                        }

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
    }

    /// Статьи расходов строками с иконкой и долей — как выписка расходов.
    private func expenses(_ totals: WeeklyTotals) -> some View {
        let groups = Array(totals.expenses.prefix(8))
        let total = max(totals.expenseTotal, 1)

        return OwnerSection("Куда ушли деньги") {
            if !totals.expenses.isEmpty {
                Text(Money.format(totals.expenseTotal))
                    .font(.system(size: 13))
                    .monospacedDigit()
                    .foregroundStyle(Theme.textDim)
            }
        } content: {
            if groups.isEmpty {
                InlineEmpty(icon: "tray", text: "Расходов за неделю нет", tint: Theme.textDim)
            } else {
                VStack(spacing: Spacing.md) {
                    ForEach(Array(groups.enumerated()), id: \.element.id) { index, group in
                        AmountRow(
                            leading: {
                                TintedIcon(
                                    systemName: OwnerAnalyticsScreen.expenseIcon(group.category),
                                    tint: OwnerTint.point(index),
                                    size: 40
                                )
                            },
                            title: group.category,
                            subtitle: Percent.format(group.amount / total * 100),
                            amount: Money.format(group.amount),
                            share: group.amount / total,
                            tint: OwnerTint.point(index)
                        )
                    }
                }
            }
        }
    }

    private func companies(_ report: WeeklyReport) -> some View {
        let rows = report.activeCompanies

        return OwnerSection("По точкам") {
            Text("нажмите, чтобы раскрыть")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textDim)
        } content: {
            if rows.isEmpty {
                InlineEmpty(icon: "building.2", text: "Точек с движением нет", tint: Theme.textDim)
            } else {
                VStack(spacing: Spacing.md) {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, company in
                        Button {
                            withAnimation(Motion.transition) {
                                expanded = expanded == company.id ? nil : company.id
                            }
                        } label: {
                            WeeklyCompanyRow(
                                company: company,
                                tint: OwnerTint.point(index),
                                isExpanded: expanded == company.id
                            )
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
    let tint: Color
    let isExpanded: Bool

    var body: some View {
        HStack(spacing: Spacing.md) {
            LetterBadge(text: company.name, tint: tint)

            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                    Text(company.name)
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                    Spacer(minLength: Spacing.sm)
                    Text(Money.format(company.income.total))
                        .font(.system(size: 16, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                }
                HStack(spacing: Spacing.sm) {
                    Text("расходы \(Money.format(company.expenseTotal))")
                        .foregroundStyle(Theme.textDim)
                    Spacer(minLength: Spacing.sm)
                    Text("итог \(Money.signed(company.net))")
                        .foregroundStyle(company.net >= 0 ? Theme.positive : Theme.negative)
                }
                .font(.system(size: 13))
                .monospacedDigit()
                .lineLimit(1)
            }

            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.textDim)
                .rotationEffect(.degrees(isExpanded ? 90 : 0))
                .animation(Motion.value, value: isExpanded)
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
                    .frame(maxWidth: .infinity, alignment: .leading)

                ForEach(company.expenses.prefix(6)) { group in
                    StatRow(group.category, value: Money.format(group.amount))
                }
            }
        }
        .padding(Spacing.md)
        .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
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
            // Цена — главной карточкой, а выручка, EBITDA и прибыль — её
            // расшифровкой под ней, а не четырьмя плитками стопкой.
            VStack(alignment: .leading, spacing: 0) {
                HeroSummary(
                    title: "Вероятная цена бизнеса",
                    value: Money.format(valuation.valuation.mid),
                    caption: "вилка \(Money.format(valuation.valuation.low)) — \(Money.format(valuation.valuation.high))",
                    footer: [
                        ("Выручка 12 мес", Money.format(valuation.revenue12mo)),
                        ("EBITDA · \(Percent.format(valuation.ebitdaMargin))", Money.format(valuation.ebitda12mo)),
                        ("Чистая прибыль", Money.format(valuation.netProfit12mo)),
                    ],
                    colors: Theme.heroGradient
                )
                HStack(spacing: Spacing.sm) {
                    if let period = valuation.periodLabel {
                        Text("По EBITDA за \(period)")
                    }
                    Spacer(minLength: 0)
                    if let trend = valuation.trendPct {
                        ChangeText(change: trend)
                        Text("EBITDA к прошлому году")
                    }
                }
                .font(.system(size: 13))
                .foregroundStyle(Theme.textDim)
                .padding(.horizontal, Spacing.xs)
                .padding(.top, Spacing.sm)
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
