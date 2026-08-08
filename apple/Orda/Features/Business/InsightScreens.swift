import OrdaKit
import OrdaUI
import SwiftUI

// ── Общее для AI-разделов ────────────────────────────────────────────────────

/// Честное ожидание вместо бесконечного спиннера.
///
/// Разбор идёт десятки секунд: модель читает данные и пишет текст. Крутящийся
/// кружок без объяснений в такой паузе читается как «зависло», и человек
/// нажимает ещё раз — то есть платит второй раз. Поэтому здесь и что именно
/// сейчас происходит, и сколько уже идёт.
struct AiWaitCard: View {
    private let title: String
    private let hint: String

    @State private var startedAt = Date()

    init(
        title: String,
        hint: String = "Обычно занимает от 20 секунд до минуты. Экран можно не трогать."
    ) {
        self.title = title
        self.hint = hint
    }

    var body: some View {
        Card(accent: Theme.accent) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                HStack(spacing: Spacing.md) {
                    ProgressView()
                        .controlSize(.small)
                    Text(title)
                        .font(Typography.headline)
                        .foregroundStyle(Theme.text)
                    Spacer(minLength: Spacing.sm)
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        Text(elapsed(to: context.date))
                            .font(Typography.caption)
                            .monospacedDigit()
                            .foregroundStyle(Theme.textDim)
                    }
                }

                Text(hint)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func elapsed(to now: Date) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(startedAt)))
        return "\(seconds) \(pluralize(seconds, "секунда", "секунды", "секунд"))"
    }
}

/// Приглашение запустить разбор.
///
/// Кнопка, а не автозапуск: каждый разбор — реальные деньги владельца, и
/// тратить их молча при каждом открытии экрана нельзя.
struct AiRunPrompt: View {
    let icon: String
    let title: String
    let message: String
    var buttonTitle = "Разобрать"
    let action: () -> Void

    var body: some View {
        Card(accent: Theme.accent) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                HStack(spacing: Spacing.md) {
                    Image(systemName: icon)
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(Theme.accent)
                    Text(title)
                        .font(Typography.title)
                        .foregroundStyle(Theme.text)
                }

                Text(message)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)

                Button(buttonTitle, action: action)
                    .buttonStyle(PrimaryButtonStyle(tint: Theme.accent))
            }
        }
    }
}

/// Текст модели, разобранный в блоки.
///
/// Сырую разметку показывать нельзя: `**` и `##` — это про оформление, а
/// читателю нужен смысл.
struct AiTextBlocks: View {
    let blocks: [RichText.Block]

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            ForEach(blocks) { block in
                switch block.kind {
                case .heading:
                    Text(block.text)
                        .font(Typography.headline)
                        .foregroundStyle(Theme.text)
                        .padding(.top, Spacing.xs)
                case .listItem:
                    HStack(alignment: .top, spacing: Spacing.sm) {
                        Circle()
                            .fill(Theme.accent)
                            .frame(width: 5, height: 5)
                            .padding(.top, 7)
                        Text(block.text)
                            .font(Typography.callout)
                            .foregroundStyle(Theme.textMuted)
                    }
                case .quote:
                    Text(block.text)
                        .font(Typography.callout.italic())
                        .foregroundStyle(Theme.textMuted)
                        .padding(.leading, Spacing.md)
                        .overlay(alignment: .leading) {
                            Capsule().fill(Theme.accent.opacity(0.5)).frame(width: 2)
                        }
                case .paragraph:
                    Text(block.text)
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textMuted)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
    }
}

/// Карточка «вывод → причина → действие».
struct AiInsightCard: View {
    let insight: AiInsight

    var body: some View {
        Card(accent: tint) {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                HStack(alignment: .top, spacing: Spacing.sm) {
                    Text(insight.verdict)
                        .font(Typography.headline)
                        .foregroundStyle(Theme.text)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: Spacing.sm)
                    StatusChip(insight.severityLabel, kind: chipKind)
                }

                if !insight.reason.isEmpty {
                    Text(insight.reason)
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if !insight.action.isEmpty {
                    RowDivider()
                    HStack(alignment: .top, spacing: Spacing.sm) {
                        Image(systemName: "arrow.turn.down.right")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(tint)
                            .padding(.top, 2)
                        Text(insight.action)
                            .font(Typography.callout.weight(.medium))
                            .foregroundStyle(Theme.text)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }

    private var tint: Color {
        insight.isCritical ? Theme.negative : insight.isPositive ? Theme.positive : Theme.warning
    }

    private var chipKind: StatusChip.Kind {
        insight.isCritical ? .danger : insight.isPositive ? .good : .warning
    }
}

/// Пояснение к сорванному разбору.
///
/// Долгий запрос обрывается по тайм-ауту раньше, чем модель успевает
/// ответить, и «нет связи» тут вводит в заблуждение — интернет как раз есть.
struct AiFailureView: View {
    let error: APIError
    let retry: () -> Void

    var body: some View {
        VStack(spacing: Spacing.md) {
            ErrorStateView(error: error, retry: retry)

            if looksLikeTimeout {
                Card {
                    InlineEmpty(
                        icon: "clock.badge.exclamationmark",
                        text: "Разбор не уложился в отведённое время. Попробуйте период покороче.",
                        tint: Theme.warning
                    )
                }
            }
        }
    }

    private var looksLikeTimeout: Bool {
        guard case let .transport(message) = error else { return false }
        return message.localizedCaseInsensitiveContains("time")
            || message.localizedCaseInsensitiveContains("врем")
    }
}

/// Ряд «метка — значение».
private struct InsightFactRow: View {
    let label: String
    let value: String
    var tint: Color = Theme.text

    var body: some View {
        StatRow(label, value: value, valueColor: tint)
    }
}

/// Таблица фактов с разделителями.
///
/// Не украшательство: подряд идущих строк в финансовых карточках больше
/// десяти, а столько выражений в одном блоке SwiftUI не принимает.
private struct InsightFactTable: View {
    struct Row: Identifiable {
        let id = UUID()
        let label: String
        let value: String
        var tint: Color = Theme.text
    }

    let rows: [Row]

    var body: some View {
        VStack(spacing: Spacing.md) {
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                if index > 0 { RowDivider() }
                StatRow(row.label, value: row.value, valueColor: row.tint)
            }
        }
    }
}

// ── AI Разбор ────────────────────────────────────────────────────────────────

@MainActor
@Observable
final class AnalysisStore {
    private(set) var bundle: MonthlyForecastBundle?
    private(set) var isLoading = false
    private(set) var error: APIError?

    /// Вывод модели по прогнозу. Загружается отдельно и только по кнопке.
    private(set) var comment: String?
    private(set) var isExplaining = false
    private(set) var commentError: APIError?

    private let service: InsightService

    init(api: APIClient) { service = InsightService(api: api) }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            bundle = try await service.monthlyForecast()
            error = nil
        } catch let e as APIError {
            error = e
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }

    func explain() async {
        guard let report = bundle?.forecast, !isExplaining else { return }
        isExplaining = true
        defer { isExplaining = false }
        do {
            comment = try await service.explainForecast(report)
            commentError = nil
        } catch let e as APIError {
            commentError = e
        } catch {
            commentError = .transport(message: error.localizedDescription)
        }
    }
}

/// Прогноз на следующий месяц: доход, расход, прибыль — и честная оценка,
/// насколько этому можно верить.
///
/// Сначала цифры, которые посчитал сервер, и только потом — по кнопке —
/// разбор модели. Порядок не случаен: число проверяемо, а текст модели нет.
struct AnalysisScreen: View {
    @Environment(\.api) private var api
    @State private var store: AnalysisStore?

    var body: some View {
        Group {
            if let store {
                if let error = store.error, store.bundle == nil {
                    ErrorStateView(error: error) { Task { await store.load() } }
                } else if let bundle = store.bundle {
                    ScreenScroll { content(bundle, store: store) }
                } else {
                    LoadingRows(count: 6)
                }
            } else {
                LoadingRows(count: 6)
            }
        }
        .background(Theme.background)
        .navigationTitle("AI Разбор")
        .toolbar { LogoutToolbarItem() }
        .task {
            if store == nil {
                let created = AnalysisStore(api: api)
                store = created
                await created.load()
            }
        }
        .refreshable { await store?.load() }
    }

    @ViewBuilder
    private func content(_ bundle: MonthlyForecastBundle, store: AnalysisStore) -> some View {
        let report = bundle.forecast

        VStack(spacing: Spacing.lg) {
            DashboardGrid {
                MetricTile(
                    label: "Доход, \(report.targetMonthLabel)",
                    value: Money.compact(report.income.expected),
                    change: report.income.momGrowthPct,
                    icon: "arrow.down.circle.fill",
                    accent: Theme.brand
                )
                MetricTile(
                    label: "Расход",
                    value: Money.compact(report.expense.expected),
                    icon: "arrow.up.circle.fill",
                    accent: Theme.negative
                )
                MetricTile(
                    label: "Прибыль",
                    value: Money.compact(report.profit.expected),
                    icon: "chart.line.uptrend.xyaxis",
                    accent: report.profit.expected >= 0 ? Theme.positive : Theme.negative
                )
                MetricTile(
                    label: "Маржа",
                    value: Percent.format(report.profit.marginPct),
                    icon: "percent",
                    accent: Theme.info
                )
            }

            history(report)

            SplitDashboard {
                range(report)
                expenseStructure(report)
                explanation(report)
            } side: {
                confidence(report)
                breakeven(report)
                backtest(report)
                companies(bundle.byCompany)
            }

            aiComment(store)
        }
    }

    // ── История ──────────────────────────────────────────────────────────────

    private func history(_ report: MonthlyForecastReport) -> some View {
        let points = report.months.compactMap { month -> TimePoint? in
            guard let date = month.date else { return nil }
            return TimePoint(label: month.shortLabel, date: date, value: month.income)
        }

        return Group {
            if points.count > 1 {
                TrendChart(
                    title: "Выручка по месяцам",
                    subtitle: "факт, на котором построен прогноз",
                    points: points
                )
            } else {
                Card {
                    InlineEmpty(icon: "chart.xyaxis.line", text: "Месяцев пока мало для графика")
                }
            }
        }
    }

    // ── Вилка прогноза ───────────────────────────────────────────────────────

    private func range(_ report: MonthlyForecastReport) -> some View {
        let rows: [InsightFactTable.Row] = [
            .init(label: "Доход, минимум", value: Money.format(report.income.low)),
            .init(label: "Доход, ожидаемый", value: Money.format(report.income.expected), tint: Theme.brand),
            .init(label: "Доход, максимум", value: Money.format(report.income.high)),
            .init(
                label: "Прибыль: худший сценарий",
                value: Money.format(report.scenarios.worst),
                tint: report.scenarios.worst >= 0 ? Theme.text : Theme.negative
            ),
            .init(label: "Прибыль: ожидаемая", value: Money.format(report.scenarios.expected), tint: Theme.positive),
            .init(label: "Прибыль: лучший сценарий", value: Money.format(report.scenarios.best)),
        ]

        return Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Вилка на \(report.targetMonthLabel)", subtitle: "одно число прогнозом не бывает")

                InsightFactTable(rows: rows)

                if let current = report.current {
                    RowDivider()
                    Text("Текущий месяц пройден на \(Percent.format(current.elapsedRatio * 100)): факт \(Money.format(current.factToDate)).")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                }
            }
        }
    }

    // ── Структура расходов ───────────────────────────────────────────────────

    private func expenseStructure(_ report: MonthlyForecastReport) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader(
                    "Из чего расход",
                    subtitle: "переменные растут вместе с выручкой, постоянные — нет"
                )

                if report.expense.expected <= 0 {
                    InlineEmpty(icon: "tray", text: "Расходов в истории нет")
                } else {
                    SplitBar(segments: [
                        .init(label: "Постоянные", value: report.expense.fixed, color: ChartPalette.series1),
                        .init(label: "Переменные", value: report.expense.variable, color: ChartPalette.series2),
                    ].filter { $0.value > 0 })

                    RowDivider()
                    InsightFactRow(label: "Постоянные", value: Money.format(report.expense.fixed))
                    RowDivider()
                    InsightFactRow(
                        label: "Переменные (\(Percent.format(report.expense.variableRatePct)) от дохода)",
                        value: Money.format(report.expense.variable)
                    )

                    if report.expense.oneOffAvg > 0 {
                        RowDivider()
                        InsightFactRow(
                            label: "Разовые, в среднем за месяц",
                            value: Money.format(report.expense.oneOffAvg),
                            tint: Theme.warning
                        )
                        Text("Разовые траты в прогноз не входят — они случаются нерегулярно, но деньги на них уходят настоящие.")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    let groups = report.fixedExpenses + report.variableExpenses
                    if !groups.isEmpty {
                        RowDivider()
                        ForEach(groups.prefix(8)) { group in
                            StatRow(
                                group.label,
                                value: Money.format(group.amount),
                                icon: group.isFixed ? "lock.fill" : "arrow.up.arrow.down"
                            )
                        }
                    }
                }
            }
        }
    }

    // ── Как считали ──────────────────────────────────────────────────────────

    @ViewBuilder
    private func explanation(_ report: MonthlyForecastReport) -> some View {
        if !report.explanation.isEmpty {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("Как получилось это число")
                    ForEach(Array(report.explanation.enumerated()), id: \.offset) { _, line in
                        HStack(alignment: .top, spacing: Spacing.sm) {
                            Circle()
                                .fill(Theme.textDim)
                                .frame(width: 4, height: 4)
                                .padding(.top, 7)
                            Text(line)
                                .font(Typography.callout)
                                .foregroundStyle(Theme.textMuted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
        }
    }

    // ── Уверенность ──────────────────────────────────────────────────────────

    private func confidence(_ report: MonthlyForecastReport) -> some View {
        let confidence = report.confidence

        return Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Насколько можно верить")

                ProgressRing(
                    progress: Double(confidence.score) / 100,
                    label: "\(confidence.score)",
                    caption: confidence.label,
                    color: confidence.score >= 75 ? Theme.positive : confidence.score >= 45 ? Theme.warning : Theme.negative
                )
                .frame(maxWidth: .infinity)

                RowDivider()
                InsightFactRow(
                    label: "Месяцев данных",
                    value: "\(confidence.monthsOfData)"
                )
                RowDivider()
                InsightFactRow(label: "Разброс выручки", value: Percent.format(confidence.volatilityPct))
                RowDivider()
                InsightFactRow(
                    label: "Сезонность",
                    value: confidence.seasonalityAvailable ? "Учтена" : "Не хватает истории",
                    tint: confidence.seasonalityAvailable ? Theme.text : Theme.textDim
                )

                ForEach(Array(confidence.notes.enumerated()), id: \.offset) { _, note in
                    Text(note)
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    // ── Безубыточность ───────────────────────────────────────────────────────

    private func breakeven(_ report: MonthlyForecastReport) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Точка безубыточности", subtitle: "выручка, ниже которой месяц уходит в минус")

                Text(Money.format(report.breakeven.revenue))
                    .font(Typography.monospacedDigits(Typography.metric))
                    .foregroundStyle(Theme.text)

                InsightFactRow(
                    label: "Запас прочности",
                    value: Percent.format(report.breakeven.safetyMarginPct),
                    tint: report.breakeven.safetyMarginPct >= 20 ? Theme.positive : Theme.warning
                )
                ProportionBar(
                    ratio: min(max(report.breakeven.safetyMarginPct / 100, 0), 1),
                    color: report.breakeven.safetyMarginPct >= 20 ? Theme.positive : Theme.warning
                )
            }
        }
    }

    // ── Проверка модели ──────────────────────────────────────────────────────

    @ViewBuilder
    private func backtest(_ report: MonthlyForecastReport) -> some View {
        if let backtest = report.backtest {
            Card(accent: backtest.isAccurate ? Theme.positive : Theme.warning) {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("Проверка на прошлом месяце")

                    InsightFactRow(label: "Предсказали", value: Money.format(backtest.predictedIncome))
                    RowDivider()
                    InsightFactRow(label: "Вышло", value: Money.format(backtest.actualIncome))
                    RowDivider()
                    InsightFactRow(
                        label: "Ошибка",
                        value: Percent.format(backtest.incomeErrorPct, signed: true),
                        tint: backtest.isAccurate ? Theme.positive : Theme.warning
                    )
                }
            }
        }
    }

    // ── Точки ────────────────────────────────────────────────────────────────

    @ViewBuilder
    private func companies(_ rows: [ForecastCompanyRow]) -> some View {
        if !rows.isEmpty {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("Прогноз по точкам")

                    let maximum = rows.map(\.income).max() ?? 1
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                        if index > 0 { RowDivider() }
                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            HStack {
                                Text(row.name)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.text)
                                    .lineLimit(1)
                                Spacer(minLength: Spacing.sm)
                                Text(Money.compact(row.income))
                                    .font(Typography.callout.weight(.medium))
                                    .monospacedDigit()
                                    .foregroundStyle(Theme.text)
                            }
                            Text("прибыль \(Money.compact(row.profit)) · маржа \(Percent.format(row.marginPct))")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textDim)
                            ProportionBar(ratio: maximum > 0 ? row.income / maximum : 0)
                        }
                    }
                }
            }
        }
    }

    // ── Разбор модели ────────────────────────────────────────────────────────

    @ViewBuilder
    private func aiComment(_ store: AnalysisStore) -> some View {
        if store.isExplaining {
            AiWaitCard(title: "Модель читает прогноз")
        } else if let comment = store.comment, !comment.isEmpty {
            Card(accent: Theme.accent) {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("Вывод AI") {
                        Button("Обновить") { Task { await store.explain() } }
                            .buttonStyle(SecondaryButtonStyle())
                    }
                    AiTextBlocks(blocks: InsightMarkdown.blocks(from: comment))
                }
            }
        } else if let error = store.commentError {
            AiFailureView(error: error) { Task { await store.explain() } }
        } else {
            AiRunPrompt(
                icon: "sparkles",
                title: "Вывод AI по прогнозу",
                message: "Цифры выше посчитаны без ИИ. Если нужен короткий разбор словами — запустите: это платный запрос к модели, поэтому он не запускается сам.",
                buttonTitle: "Разобрать"
            ) {
                Task { await store.explain() }
            }
        }
    }
}

// ── AI Прогноз ───────────────────────────────────────────────────────────────

@MainActor
@Observable
final class ForecastStore {
    private(set) var report: AiForecastReport?
    private(set) var isGenerating = false
    private(set) var error: APIError?

    private let service: InsightService

    init(api: APIClient) { service = InsightService(api: api) }

    func generate() async {
        guard !isGenerating else { return }
        isGenerating = true
        defer { isGenerating = false }
        do {
            report = try await service.aiForecast()
            error = nil
        } catch let e as APIError {
            error = e
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }
}

/// Прогноз на 30/60/90 дней вместе с разбором модели.
///
/// Экран ничего не грузит при открытии: запрос долгий и платный, а всё, что
/// он вернёт, зависит от одного нажатия. Пусть его сделает человек.
struct ForecastScreen: View {
    @Environment(\.api) private var api
    @State private var store: ForecastStore?

    var body: some View {
        ScreenScroll {
            if let store {
                if store.isGenerating {
                    AiWaitCard(
                        title: "Строим прогноз",
                        hint: "Сервер считает 13 недель истории и просит модель объяснить, куда всё идёт. Это дольше обычного запроса — от 20 секунд до минуты."
                    )
                } else if let error = store.error, store.report == nil {
                    AiFailureView(error: error) { Task { await store.generate() } }
                } else if let report = store.report {
                    content(report, store: store)
                } else {
                    intro(store)
                }
            } else {
                LoadingRows(count: 3)
            }
        }
        .background(Theme.background)
        .navigationTitle("AI Прогноз")
        .toolbar { LogoutToolbarItem() }
        .task { if store == nil { store = ForecastStore(api: api) } }
    }

    private func intro(_ store: ForecastStore) -> some View {
        VStack(spacing: Spacing.lg) {
            AiRunPrompt(
                icon: "chart.line.uptrend.xyaxis",
                title: "Прогноз на 30, 60 и 90 дней",
                message: "Сервер разложит последние 13 недель — выручку, расходы, сезонность и крупные разовые траты, — а модель объяснит, что с этим делать. Запрос платный и небыстрый, поэтому запускается только по кнопке.",
                buttonTitle: "Построить прогноз"
            ) {
                Task { await store.generate() }
            }

            Card {
                InlineEmpty(
                    icon: "info.circle",
                    text: "Прогноз строится по всем доступным вам точкам сразу.",
                    tint: Theme.info
                )
            }
        }
    }

    @ViewBuilder
    private func content(_ report: AiForecastReport, store: ForecastStore) -> some View {
        VStack(spacing: Spacing.lg) {
            header(report, store: store)

            DashboardGrid {
                MetricTile(
                    label: report.projected.month0Label.isEmpty ? "Текущий месяц" : report.projected.month0Label,
                    value: Money.compact(report.projected.month0Income),
                    icon: "calendar",
                    accent: Theme.brand
                )
                MetricTile(
                    label: report.projected.month1Label.isEmpty ? "Через месяц" : report.projected.month1Label,
                    value: Money.compact(report.projected.month1Income),
                    icon: "calendar",
                    accent: Theme.info
                )
                MetricTile(
                    label: report.projected.month2Label.isEmpty ? "Через два месяца" : report.projected.month2Label,
                    value: Money.compact(report.projected.month2Income),
                    icon: "calendar",
                    accent: Theme.accent
                )
                MetricTile(
                    label: "Прибыль текущего месяца",
                    value: Money.compact(report.projected.month0Profit),
                    icon: "banknote.fill",
                    accent: report.projected.month0Profit >= 0 ? Theme.positive : Theme.negative
                )
            }

            weeks(report)

            SplitDashboard {
                analysis(report)
                categories(report)
            } side: {
                momentum(report)
                seasonality(report)
                kpi(report)
                outliers(report)
            }
        }
    }

    private func header(_ report: AiForecastReport, store: ForecastStore) -> some View {
        Card {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: Spacing.xxs) {
                    Text("История \(Self.rangeLabel(from: report.dateFrom, to: report.dateTo))")
                        .font(Typography.callout)
                        .foregroundStyle(Theme.text)
                    Text("Средняя выручка недели \(Money.compact(report.avgWeeklyIncome))")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                }
                Spacer(minLength: Spacing.md)
                Button("Пересчитать") { Task { await store.generate() } }
                    .buttonStyle(SecondaryButtonStyle())
            }
        }
    }

    /// Границы периода приходят строками ISO — читателю нужны даты, а не ключи API.
    private static func rangeLabel(from: String, to: String) -> String {
        guard let start = DateParsing.parseDateOnly(from), let end = DateParsing.parseDateOnly(to) else {
            return "\(from) — \(to)"
        }
        return "\(start.formatted(.dateTime.day().month(.abbreviated))) — \(end.formatted(.dateTime.day().month(.abbreviated)))"
    }

    private func weeks(_ report: AiForecastReport) -> some View {
        let points = report.activeWeeks.enumerated().map { index, week in
            CategoryPoint(label: "Н\(index + 1)", value: week.income)
        }

        return Group {
            if points.count > 1 {
                CategoryBarChart(title: "Выручка по неделям", points: points)
            } else {
                Card {
                    InlineEmpty(icon: "chart.bar", text: "Недель с продажами пока мало")
                }
            }
        }
    }

    @ViewBuilder
    private func analysis(_ report: AiForecastReport) -> some View {
        let blocks = report.blocks

        if blocks.isEmpty {
            Card {
                InlineEmpty(icon: "text.alignleft", text: "Модель не вернула разбор — остались только цифры", tint: Theme.warning)
            }
        } else {
            Card(accent: Theme.accent) {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("Разбор AI", subtitle: "цифры считал сервер, выводы — модель")
                    AiTextBlocks(blocks: blocks)
                }
            }
        }
    }

    @ViewBuilder
    private func categories(_ report: AiForecastReport) -> some View {
        if !report.categories.isEmpty {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("Куда уходят деньги", subtitle: "и как менялось за последние 30 дней")

                    ForEach(Array(report.categories.enumerated()), id: \.element.id) { index, category in
                        if index > 0 { RowDivider() }
                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            HStack {
                                Text(category.category)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.text)
                                    .lineLimit(1)
                                Spacer(minLength: Spacing.sm)
                                Text(Money.compact(category.total))
                                    .font(Typography.callout.weight(.medium))
                                    .monospacedDigit()
                                    .foregroundStyle(Theme.text)
                            }
                            HStack(spacing: Spacing.sm) {
                                Text("\(Percent.format(category.share)) расходов · \(category.count) \(pluralize(category.count, "операция", "операции", "операций"))")
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.textDim)
                                if let trend = category.trendPct, abs(trend) >= 10 {
                                    Text(Percent.format(trend, signed: true))
                                        .font(Typography.caption.weight(.semibold))
                                        .foregroundStyle(trend > 0 ? Theme.negative : Theme.positive)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    private func momentum(_ report: AiForecastReport) -> some View {
        let comparison = report.comparison

        return Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Разгон", subtitle: "последние 30 дней против предыдущих 30")

                InsightFactRow(
                    label: "Выручка",
                    value: Percent.format(comparison.incomeMomentum, signed: true),
                    tint: comparison.incomeMomentum >= 0 ? Theme.positive : Theme.negative
                )
                RowDivider()
                InsightFactRow(
                    label: "Расходы",
                    value: Percent.format(comparison.expenseMomentum, signed: true),
                    tint: comparison.expenseMomentum <= 0 ? Theme.positive : Theme.negative
                )
                RowDivider()
                InsightFactRow(
                    label: "Прибыль",
                    value: Percent.format(comparison.profitMomentum, signed: true),
                    tint: comparison.profitMomentum >= 0 ? Theme.positive : Theme.negative
                )
                RowDivider()
                InsightFactRow(label: "Маржа сейчас", value: Percent.format(comparison.last30.margin))
            }
        }
    }

    @ViewBuilder
    private func seasonality(_ report: AiForecastReport) -> some View {
        let days = report.seasonality.byDay.filter { $0.avg > 0 }

        if !days.isEmpty {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("Дни недели", subtitle: "средняя выручка дня")

                    let maximum = days.map(\.avg).max() ?? 1
                    ForEach(days) { day in
                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            HStack {
                                Text(day.name)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.text)
                                Spacer(minLength: Spacing.sm)
                                Text(Money.compact(day.avg))
                                    .font(Typography.caption)
                                    .monospacedDigit()
                                    .foregroundStyle(Theme.textMuted)
                            }
                            ProportionBar(
                                ratio: maximum > 0 ? day.avg / maximum : 0,
                                color: day.name == report.seasonality.best?.name ? Theme.positive : Theme.brand
                            )
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func kpi(_ report: AiForecastReport) -> some View {
        if let kpi = report.kpi, kpi.plan > 0 {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("План на месяц")
                    ProgressRing(
                        progress: kpi.progress / 100,
                        label: Percent.format(kpi.progress),
                        caption: "выполнено",
                        color: kpi.progress >= 100 ? Theme.positive : Theme.brand
                    )
                    .frame(maxWidth: .infinity)
                    RowDivider()
                    InsightFactRow(label: "План", value: Money.format(kpi.plan))
                    RowDivider()
                    InsightFactRow(label: "Факт", value: Money.format(kpi.actual))
                }
            }
        }
    }

    @ViewBuilder
    private func outliers(_ report: AiForecastReport) -> some View {
        if !report.outliers.isEmpty {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("Крупные разовые траты", subtitle: "выбиваются из обычного ряда")

                    ForEach(Array(report.outliers.prefix(6).enumerated()), id: \.element.id) { index, outlier in
                        if index > 0 { RowDivider() }
                        VStack(alignment: .leading, spacing: Spacing.xxs) {
                            HStack {
                                Text(outlier.category)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.text)
                                    .lineLimit(1)
                                Spacer(minLength: Spacing.sm)
                                Text(Money.compact(outlier.amount))
                                    .font(Typography.callout.weight(.medium))
                                    .monospacedDigit()
                                    .foregroundStyle(Theme.warning)
                            }
                            if let day = outlier.day {
                                Text(day.formatted(.dateTime.day().month(.abbreviated)))
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.textDim)
                            }
                            if let comment = outlier.comment, !comment.isEmpty {
                                Text(comment)
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.textDim)
                            }
                        }
                    }
                }
            }
        }
    }
}

// ── Бизнес-аналитика ─────────────────────────────────────────────────────────

@MainActor
@Observable
final class BusinessIntelligenceStore {
    private(set) var data: BusinessIntelligence?
    private(set) var isLoading = false
    private(set) var error: APIError?

    private(set) var actions: [String] = []
    private(set) var isAsking = false
    private(set) var actionsError: APIError?

    private let service: InsightService

    init(api: APIClient) { service = InsightService(api: api) }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            data = try await service.businessIntelligence()
            error = nil
        } catch let e as APIError {
            error = e
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }

    func askPriorities() async {
        guard !isAsking else { return }
        isAsking = true
        defer { isAsking = false }
        do {
            actions = try await service.priorityActions()
            actionsError = nil
        } catch let e as APIError {
            actionsError = e
        } catch {
            actionsError = .transport(message: error.localizedDescription)
        }
    }
}

/// Управленческие формулы на данных точки: ABC, RFM, страховой запас,
/// контрольные границы выручки, риск недостач.
///
/// Здесь нет ни одного обращения к модели — всё считает сервер, поэтому
/// раздел грузится сразу. Модель подключается отдельной кнопкой и только
/// затем, чтобы свести это в список дел на сегодня.
struct BusinessIntelligenceScreen: View {
    @Environment(\.api) private var api
    @State private var store: BusinessIntelligenceStore?

    var body: some View {
        Group {
            if let store {
                if let error = store.error, store.data == nil {
                    ErrorStateView(error: error) { Task { await store.load() } }
                } else if let data = store.data {
                    ScreenScroll { content(data, store: store) }
                } else {
                    LoadingRows(count: 6)
                }
            } else {
                LoadingRows(count: 6)
            }
        }
        .background(Theme.background)
        .navigationTitle("Бизнес-аналитика")
        .toolbar { LogoutToolbarItem() }
        .task {
            if store == nil {
                let created = BusinessIntelligenceStore(api: api)
                store = created
                await created.load()
            }
        }
        .refreshable { await store?.load() }
    }

    @ViewBuilder
    private func content(_ data: BusinessIntelligence, store: BusinessIntelligenceStore) -> some View {
        if !data.hasAnything {
            WideEmptyState(
                icon: "brain",
                title: "Считать пока не на чем",
                message: "Формулам нужны продажи, остатки и клиенты. Появятся данные — появится и аналитика."
            )
        } else {
            VStack(spacing: Spacing.lg) {
                health(data.healthScore)
                priorities(store)

                SplitDashboard {
                    abc(data.abc)
                    reorder(data.safetyStock)
                    newsvendor(data.newsvendor)
                } side: {
                    anomalies(data.anomalies)
                    rfm(data.rfm)
                    clv(data.clv)
                    cashiers(data.cashierRisk)
                }
            }
        }
    }

    private func health(_ section: BiHealthSection) -> some View {
        Card(accent: section.score >= 80 ? Theme.positive : section.score >= 60 ? Theme.warning : Theme.negative) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Здоровье бизнеса", subtitle: section.band)

                ProgressRing(
                    progress: Double(section.score) / 100,
                    label: "\(section.score)",
                    caption: "из 100",
                    color: section.score >= 80 ? Theme.positive : section.score >= 60 ? Theme.warning : Theme.negative
                )
                .frame(maxWidth: .infinity)

                if section.factors.isEmpty {
                    InlineEmpty(icon: "square.stack.3d.up", text: "Разбивка недоступна")
                } else {
                    ForEach(section.factors) { factor in
                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            HStack {
                                Text(factor.label)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.text)
                                Spacer(minLength: Spacing.sm)
                                Text("\(factor.score)")
                                    .font(Typography.callout.weight(.medium))
                                    .monospacedDigit()
                                    .foregroundStyle(Theme.textMuted)
                            }
                            ProportionBar(ratio: Double(factor.score) / 100)
                            if !factor.note.isEmpty {
                                Text(factor.note)
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.textDim)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func priorities(_ store: BusinessIntelligenceStore) -> some View {
        if store.isAsking {
            AiWaitCard(title: "Собираем приоритеты на сегодня")
        } else if !store.actions.isEmpty {
            Card(accent: Theme.accent) {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("Что делать сегодня") {
                        Button("Обновить") { Task { await store.askPriorities() } }
                            .buttonStyle(SecondaryButtonStyle())
                    }
                    ForEach(Array(store.actions.enumerated()), id: \.offset) { index, action in
                        HStack(alignment: .top, spacing: Spacing.sm) {
                            Text("\(index + 1)")
                                .font(Typography.caption.weight(.bold))
                                .foregroundStyle(Theme.accent)
                                .frame(width: 18, alignment: .leading)
                            Text(action)
                                .font(Typography.callout)
                                .foregroundStyle(Theme.textMuted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
        } else if let error = store.actionsError {
            AiFailureView(error: error) { Task { await store.askPriorities() } }
        } else {
            AiRunPrompt(
                icon: "list.bullet.rectangle",
                title: "Приоритеты на сегодня",
                message: "Формулы выше уже посчитаны. Модель может свести их в короткий список дел — это отдельный платный запрос, поэтому он по кнопке.",
                buttonTitle: "Собрать список"
            ) {
                Task { await store.askPriorities() }
            }
        }
    }

    @ViewBuilder
    private func abc(_ section: BiAbcSection) -> some View {
        if section.available {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("ABC-анализ", subtitle: "малая часть позиций делает бо́льшую часть выручки")

                    ForEach(section.classes) { cls in
                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            HStack {
                                Text("Класс \(cls.cls)")
                                    .font(Typography.callout.weight(.semibold))
                                    .foregroundStyle(Theme.text)
                                Spacer(minLength: Spacing.sm)
                                Text("\(cls.itemCount) \(pluralize(cls.itemCount, "позиция", "позиции", "позиций")) · \(Percent.format(cls.revenueSharePct)) выручки")
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.textDim)
                            }
                            ProportionBar(ratio: cls.revenueSharePct / 100)
                        }
                    }

                    if !section.vital.isEmpty {
                        RowDivider()
                        Text("Ключевые позиции")
                            .font(Typography.label)
                            .foregroundStyle(Theme.textDim)
                            .textCase(.uppercase)
                        ForEach(section.vital.prefix(8)) { item in
                            StatRow(item.name, value: Money.compact(item.revenue))
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func reorder(_ section: BiSafetySection) -> some View {
        if section.available {
            let rows = section.needsOrder.isEmpty ? Array(section.rows.prefix(8)) : section.needsOrder

            Card(accent: section.needsOrder.isEmpty ? nil : Theme.warning) {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader(
                        "Пора заказывать",
                        subtitle: section.needsOrder.isEmpty
                            ? "всё выше точки заказа"
                            : "\(section.needsOrder.count) \(pluralize(section.needsOrder.count, "позиция", "позиции", "позиций")) ниже точки заказа"
                    )

                    if rows.isEmpty {
                        InlineEmpty(icon: "shippingbox", text: "Позиций для расчёта нет")
                    } else {
                        ForEach(rows.prefix(10)) { row in
                            VStack(alignment: .leading, spacing: Spacing.xxs) {
                                HStack {
                                    Text(row.name)
                                        .font(Typography.callout)
                                        .foregroundStyle(Theme.text)
                                        .lineLimit(1)
                                    Spacer(minLength: Spacing.sm)
                                    StatusChip(
                                        row.belowReorder ? "Заказать" : "Хватает",
                                        kind: row.belowReorder ? .warning : .good
                                    )
                                }
                                Text("остаток \(Quantity.format(row.stock)) · точка заказа \(Quantity.format(row.reorderPoint)) · запас \(Quantity.format(row.safetyStock))")
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.textDim)
                            }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func newsvendor(_ section: BiNewsvendorSection) -> some View {
        if section.available, !section.rows.isEmpty {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("Сколько держать", subtitle: "баланс между «не хватило» и «списали»")

                    ForEach(section.rows.prefix(8)) { row in
                        StatRow(
                            row.name,
                            value: "\(Quantity.format(row.stock)) → \(Quantity.format(row.recommendedStock))",
                            valueColor: row.stock < row.recommendedStock ? Theme.warning : Theme.text
                        )
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func anomalies(_ section: BiAnomalySection) -> some View {
        if section.available {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("Необычные дни", subtitle: "выручка вне контрольных границ за \(section.days) \(pluralize(section.days, "день", "дня", "дней"))")

                    if section.anomalies.isEmpty {
                        InlineEmpty(icon: "checkmark.circle", text: "Выбросов нет — выручка ровная", tint: Theme.positive)
                    } else {
                        ForEach(section.anomalies.prefix(8)) { day in
                            VStack(alignment: .leading, spacing: Spacing.xxs) {
                                HStack {
                                    Text(day.day?.formatted(.dateTime.day().month(.abbreviated)) ?? day.date)
                                        .font(Typography.callout)
                                        .foregroundStyle(Theme.text)
                                    Spacer(minLength: Spacing.sm)
                                    Text(Money.compact(day.revenue))
                                        .font(Typography.callout.weight(.medium))
                                        .monospacedDigit()
                                        .foregroundStyle(day.isAbove ? Theme.positive : Theme.negative)
                                }
                                Text("\(day.company) · \(day.isAbove ? "выше" : "ниже") обычного")
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.textDim)
                            }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func rfm(_ section: BiRfmSection) -> some View {
        if section.available, !section.segments.isEmpty {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("Сегменты клиентов", subtitle: "давно ли приходил, как часто, на сколько")

                    let maximum = section.segments.map(\.monetary).max() ?? 1
                    ForEach(section.segments) { segment in
                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            HStack {
                                Text(segment.segment)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.text)
                                Spacer(minLength: Spacing.sm)
                                Text("\(segment.count) · \(Money.compact(segment.monetary))")
                                    .font(Typography.caption)
                                    .monospacedDigit()
                                    .foregroundStyle(Theme.textMuted)
                            }
                            ProportionBar(ratio: maximum > 0 ? segment.monetary / maximum : 0)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func clv(_ section: BiClvSection) -> some View {
        if section.available, !section.rows.isEmpty {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("Самые ценные клиенты", subtitle: "оценка на всё время, а не за визит")

                    ForEach(section.rows.prefix(8)) { row in
                        VStack(alignment: .leading, spacing: Spacing.xxs) {
                            HStack {
                                Text(row.name)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.text)
                                    .lineLimit(1)
                                Spacer(minLength: Spacing.sm)
                                Text(Money.compact(row.clv))
                                    .font(Typography.callout.weight(.medium))
                                    .monospacedDigit()
                                    .foregroundStyle(Theme.brand)
                            }
                            Text("средний чек \(Money.compact(row.avgOrder)) · \(row.frequency) \(pluralize(row.frequency, "покупка", "покупки", "покупок"))")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textDim)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func cashiers(_ section: BiCashierSection) -> some View {
        if section.available, !section.rows.isEmpty {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("Риск недостачи", subtitle: "оценка по истории, а не обвинение")

                    ForEach(section.rows.prefix(8)) { row in
                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            HStack {
                                Text(row.cashier)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.text)
                                Spacer(minLength: Spacing.sm)
                                Text(Percent.format(row.posteriorPct))
                                    .font(Typography.callout.weight(.medium))
                                    .monospacedDigit()
                                    .foregroundStyle(row.posteriorPct >= 30 ? Theme.negative : Theme.textMuted)
                            }
                            ProportionBar(
                                ratio: row.posteriorPct / 100,
                                color: row.posteriorPct >= 30 ? Theme.negative : Theme.warning
                            )
                            Text("\(row.shortfallEvents) из \(row.totalEvents) смен с расхождением")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textDim)
                        }
                    }
                }
            }
        }
    }
}

// ── AI Финдиректор ───────────────────────────────────────────────────────────

@MainActor
@Observable
final class AiCfoStore {
    private(set) var report: CfoReport?
    private(set) var isGenerating = false
    private(set) var error: APIError?

    private let service: InsightService

    init(api: APIClient) { service = InsightService(api: api) }

    func generate(days: InsightPeriod) async {
        guard !isGenerating else { return }
        isGenerating = true
        defer { isGenerating = false }
        do {
            report = try await service.cfo(days: days)
            error = nil
        } catch let e as APIError {
            error = e
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }
}

/// Финансовый аудит: что происходит с деньгами, почему и что делать.
///
/// Самый долгий разбор в приложении — модель пишет несколько страниц. Поэтому
/// период выбирается заранее, а запуск всегда явный.
struct AiCfoScreen: View {
    @Environment(\.api) private var api
    @State private var store: AiCfoStore?
    @State private var period: InsightPeriod = .quarter

    var body: some View {
        ScreenScroll {
            if let store {
                VStack(spacing: Spacing.lg) {
                    periodPicker(store)

                    if store.isGenerating {
                        AiWaitCard(
                            title: "Финансовый аудит идёт",
                            hint: "Сервер считает выручку, расходы и структуру затрат по всем точкам, затем модель пишет разбор. Это самый долгий разбор — до минуты."
                        )
                    } else if let error = store.error, store.report == nil {
                        AiFailureView(error: error) { Task { await store.generate(days: period) } }
                    } else if let report = store.report {
                        content(report)
                    } else {
                        AiRunPrompt(
                            icon: "briefcase.fill",
                            title: "Разбор финдиректора",
                            message: "Цифры посчитает сервер, а модель объяснит, где теряются деньги, что этому причиной и что делать сегодня, на неделе и в этом месяце. Запрос платный — запускается только по кнопке.",
                            buttonTitle: "Разобрать"
                        ) {
                            Task { await store.generate(days: period) }
                        }
                    }
                }
            } else {
                LoadingRows(count: 3)
            }
        }
        .background(Theme.background)
        .navigationTitle("AI Финдиректор")
        .toolbar { LogoutToolbarItem() }
        .task { if store == nil { store = AiCfoStore(api: api) } }
    }

    private func periodPicker(_ store: AiCfoStore) -> some View {
        VStack(spacing: Spacing.sm) {
            Picker("Период", selection: $period) {
                ForEach(InsightPeriod.cfoOptions) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)

            // Смена периода сама разбор не запускает: это был бы новый платный
            // запрос от одного касания сегментированного переключателя.
            if store.report != nil || store.error != nil {
                Button("Разобрать за \(period.label.lowercased())") {
                    Task { await store.generate(days: period) }
                }
                .buttonStyle(SecondaryButtonStyle())
                .frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
    }

    @ViewBuilder
    private func content(_ report: CfoReport) -> some View {
        VStack(spacing: Spacing.lg) {
            DashboardGrid {
                MetricTile(
                    label: "Выручка",
                    value: Money.compact(report.executive.revenue),
                    change: report.executive.revenueDeltaPct,
                    icon: "arrow.down.circle.fill",
                    accent: Theme.brand
                )
                MetricTile(
                    label: "Расходы",
                    value: Money.compact(report.executive.expenses),
                    change: report.executive.expensesDeltaPct,
                    icon: "arrow.up.circle.fill",
                    accent: Theme.negative
                )
                MetricTile(
                    label: "Прибыль",
                    value: Money.compact(report.executive.profit),
                    change: report.executive.profitDeltaPct,
                    icon: "banknote.fill",
                    accent: report.executive.profit >= 0 ? Theme.positive : Theme.negative
                )
                MetricTile(
                    label: "Маржа",
                    value: Percent.format(report.executive.margin),
                    icon: "percent",
                    accent: Theme.info
                )
            }

            dataQuality(report.dataQuality, period: report.periodLabel)

            if let analysis = report.analysis {
                if let error = analysis.error, !error.isEmpty {
                    Card(accent: Theme.warning) {
                        InlineEmpty(icon: "exclamationmark.bubble", text: error, tint: Theme.warning)
                    }
                }
            }

            SplitDashboard {
                summary(report.analysis?.summary)
                statements("Что изменилось", icon: "arrow.left.arrow.right", items: report.analysis?.changes ?? [])
                statements("Почему так", icon: "magnifyingglass", items: report.analysis?.rootCauses ?? [])
                moneyLines("Где утекает", items: report.analysis?.losses ?? [], tint: Theme.negative)
                moneyLines("Где недозарабатываем", items: report.analysis?.missedProfit ?? [], tint: Theme.warning)
                opportunities(report.analysis?.opportunities ?? [])
                scenarios(report.analysis?.scenarios ?? [])
            } side: {
                healthScore(report.analysis?.healthScore)
                costStructure(report)
                risks(report.analysis?.risks ?? [])
                forecast(report.analysis?.forecast)
                actionPlan(report.analysis?.actionPlan)
                companies(report.companies)
                expenseChanges(report.expenseChanges)
            }
        }
    }

    private func dataQuality(_ quality: CfoDataQuality, period: String) -> some View {
        Card(accent: quality.percent >= 90 ? Theme.positive : quality.percent >= 70 ? Theme.warning : Theme.negative) {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                HStack {
                    Text(quality.label)
                        .font(Typography.headline)
                        .foregroundStyle(Theme.text)
                    Spacer(minLength: Spacing.sm)
                    Text(Percent.format(Double(quality.percent)))
                        .font(Typography.headline)
                        .monospacedDigit()
                        .foregroundStyle(Theme.textMuted)
                }
                // Без этой строки любые выводы ниже выглядят одинаково
                // убедительно — и при полных данных, и при половине месяца.
                Text("\(period) · продажи внесены за \(quality.daysWithSales) из \(quality.daysInPeriod) \(pluralize(quality.daysInPeriod, "дня", "дней", "дней")), расходы — за \(quality.daysWithExpenses).")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    @ViewBuilder
    private func summary(_ summary: CfoSummary?) -> some View {
        if let summary {
            Card(accent: Theme.accent) {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("Коротко")

                    if !summary.whereLosing.isEmpty {
                        labelled("Где теряем", summary.whereLosing, tint: Theme.negative)
                    }
                    if !summary.whereEarn.isEmpty {
                        labelled("Где зарабатываем", summary.whereEarn, tint: Theme.positive)
                    }
                    if !summary.mainRisk.isEmpty {
                        labelled("Главный риск", summary.mainRisk, tint: Theme.warning)
                    }
                    if !summary.mainOpportunity.isEmpty {
                        labelled("Главная возможность", summary.mainOpportunity, tint: Theme.info)
                    }
                    if !summary.extraProfit.isEmpty {
                        labelled("Потенциал прибыли", summary.extraProfit, tint: Theme.brand)
                    }

                    if !summary.threeActions.isEmpty {
                        RowDivider()
                        ForEach(Array(summary.threeActions.enumerated()), id: \.offset) { index, action in
                            HStack(alignment: .top, spacing: Spacing.sm) {
                                Text("\(index + 1)")
                                    .font(Typography.caption.weight(.bold))
                                    .foregroundStyle(Theme.accent)
                                    .frame(width: 16, alignment: .leading)
                                Text(action)
                                    .font(Typography.callout.weight(.medium))
                                    .foregroundStyle(Theme.text)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                }
            }
        }
    }

    private func labelled(_ label: String, _ text: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xxs) {
            Text(label)
                .font(Typography.label)
                .foregroundStyle(tint)
                .textCase(.uppercase)
            Text(text)
                .font(Typography.callout)
                .foregroundStyle(Theme.textMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func statements(_ title: String, icon: String, items: [CfoStatement]) -> some View {
        if !items.isEmpty {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader(title)
                    ForEach(items) { item in
                        HStack(alignment: .top, spacing: Spacing.sm) {
                            Image(systemName: icon)
                                .font(.system(size: 12))
                                .foregroundStyle(item.isFact ? Theme.brand : Theme.textDim)
                                .frame(width: 16)
                                .padding(.top, 2)
                            VStack(alignment: .leading, spacing: Spacing.xxs) {
                                Text(item.text)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.textMuted)
                                    .fixedSize(horizontal: false, vertical: true)
                                if !item.status.isEmpty {
                                    Text(item.status)
                                        .font(Typography.caption)
                                        .foregroundStyle(item.isFact ? Theme.brand : Theme.textDim)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func moneyLines(_ title: String, items: [CfoMoneyLine], tint: Color) -> some View {
        if !items.isEmpty {
            Card(accent: tint) {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader(title)
                    ForEach(items) { item in
                        VStack(alignment: .leading, spacing: Spacing.xxs) {
                            HStack(alignment: .top) {
                                Text(item.text)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.textMuted)
                                    .fixedSize(horizontal: false, vertical: true)
                                Spacer(minLength: Spacing.sm)
                                if !item.amount.isEmpty {
                                    Text(item.amount)
                                        .font(Typography.callout.weight(.semibold))
                                        .foregroundStyle(tint)
                                }
                            }
                            if !item.status.isEmpty {
                                Text(item.status)
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.textDim)
                            }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func opportunities(_ items: [CfoOpportunity]) -> some View {
        if !items.isEmpty {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("Возможности")
                    ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                        if index > 0 { RowDivider() }
                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            HStack(alignment: .top) {
                                Text(item.title)
                                    .font(Typography.headline)
                                    .foregroundStyle(Theme.text)
                                    .fixedSize(horizontal: false, vertical: true)
                                Spacer(minLength: Spacing.sm)
                                if !item.effect.isEmpty {
                                    Text(item.effect)
                                        .font(Typography.callout.weight(.semibold))
                                        .foregroundStyle(Theme.positive)
                                }
                            }
                            if !item.action.isEmpty {
                                Text(item.action)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.textMuted)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            if !item.status.isEmpty {
                                Text(item.status)
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.textDim)
                            }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func scenarios(_ items: [CfoScenario]) -> some View {
        if !items.isEmpty {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("Что если", subtitle: "оценки на допущениях, не обещания")
                    ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                        if index > 0 { RowDivider() }
                        VStack(alignment: .leading, spacing: Spacing.xxs) {
                            HStack(alignment: .top) {
                                Text(item.name)
                                    .font(Typography.callout.weight(.semibold))
                                    .foregroundStyle(Theme.text)
                                Spacer(minLength: Spacing.sm)
                                Text(item.effect)
                                    .font(Typography.callout.weight(.medium))
                                    .foregroundStyle(Theme.info)
                            }
                            if !item.assumption.isEmpty {
                                Text(item.assumption)
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.textDim)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            if !item.note.isEmpty {
                                Text(item.note)
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.textDim)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func healthScore(_ score: CfoHealthScore?) -> some View {
        if let score {
            Card(accent: score.score >= 80 ? Theme.positive : score.score >= 60 ? Theme.warning : Theme.negative) {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("Оценка бизнеса", subtitle: score.bandLabel)

                    ProgressRing(
                        progress: Double(score.score) / 100,
                        label: "\(score.score)",
                        caption: "из 100",
                        color: score.score >= 80 ? Theme.positive : score.score >= 60 ? Theme.warning : Theme.negative
                    )
                    .frame(maxWidth: .infinity)

                    ForEach(Array(score.breakdown.enumerated()), id: \.offset) { _, part in
                        StatRow(part.label, value: "\(part.value)")
                    }

                    if !score.missing.isEmpty {
                        RowDivider()
                        Text("Без данных: \(score.missing.joined(separator: ", "))")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }

    private func costStructure(_ report: CfoReport) -> some View {
        let structure = report.costStructure
        let rows: [InsightFactTable.Row] = [
            .init(label: "Постоянные", value: Money.format(structure.fixedExpenses)),
            .init(label: "Переменные", value: Money.format(structure.variableExpenses)),
            .init(label: "Безубыточность", value: Money.format(structure.breakevenRevenue)),
            .init(
                label: "Запас прочности",
                value: Percent.format(structure.safetyMarginPct),
                tint: structure.safetyMarginPct >= 20 ? Theme.positive : Theme.warning
            ),
            .init(
                label: "ФОТ (\(Percent.format(report.fotShare)) выручки)",
                value: Money.format(report.fot),
                // Зарплата больше трети выручки — повод пересобрать график,
                // а не просто цифра в таблице.
                tint: report.fotShare > 35 ? Theme.warning : Theme.text
            ),
            .init(
                label: "Доля лучшей точки",
                value: Percent.format(report.concentrationPct),
                tint: report.concentrationPct > 50 ? Theme.warning : Theme.text
            ),
        ]

        return Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Структура затрат")

                SplitBar(segments: [
                    .init(label: "Переменные", value: structure.variableExpenses, color: ChartPalette.series2),
                    .init(label: "Постоянные", value: structure.fixedExpenses, color: ChartPalette.series1),
                    .init(label: "Вложения", value: structure.capex, color: ChartPalette.series3),
                ].filter { $0.value > 0 })

                InsightFactTable(rows: rows)
            }
        }
    }

    @ViewBuilder
    private func risks(_ items: [CfoRisk]) -> some View {
        if !items.isEmpty {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("Риски")
                    ForEach(Array(items.enumerated()), id: \.element.id) { index, risk in
                        if index > 0 { RowDivider() }
                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            HStack(alignment: .top) {
                                Text(risk.risk)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.textMuted)
                                    .fixedSize(horizontal: false, vertical: true)
                                Spacer(minLength: Spacing.sm)
                                StatusChip(risk.isCritical ? "Высокий" : "Умеренный", kind: risk.isCritical ? .danger : .warning)
                            }
                            Text("вероятность \(risk.probability.lowercased()) · влияние \(risk.impact.lowercased())")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textDim)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func forecast(_ forecast: CfoForecast?) -> some View {
        if let forecast {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("Прогноз прибыли", subtitle: forecast.bandLabel)

                    if !forecast.text.isEmpty {
                        Text(forecast.text)
                            .font(Typography.callout)
                            .foregroundStyle(Theme.textMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if !forecast.pessimistic.isEmpty {
                        InsightFactRow(label: "Пессимистичный", value: forecast.pessimistic, tint: Theme.negative)
                    }
                    if !forecast.base.isEmpty {
                        InsightFactRow(label: "Базовый", value: forecast.base)
                    }
                    if !forecast.optimistic.isEmpty {
                        InsightFactRow(label: "Оптимистичный", value: forecast.optimistic, tint: Theme.positive)
                    }
                    if let warning = forecast.warning, !warning.isEmpty {
                        InlineEmpty(icon: "exclamationmark.triangle", text: warning, tint: Theme.warning)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func actionPlan(_ plan: CfoActionPlan?) -> some View {
        if let plan, !plan.isEmpty {
            Card(accent: Theme.accent) {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("План действий")
                    planGroup("Сегодня", items: plan.today)
                    planGroup("На неделе", items: plan.week)
                    planGroup("В этом месяце", items: plan.month)
                }
            }
        }
    }

    @ViewBuilder
    private func planGroup(_ title: String, items: [String]) -> some View {
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(title)
                    .font(Typography.label)
                    .foregroundStyle(Theme.textDim)
                    .textCase(.uppercase)
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    HStack(alignment: .top, spacing: Spacing.sm) {
                        Image(systemName: "circle")
                            .font(.system(size: 8))
                            .foregroundStyle(Theme.accent)
                            .padding(.top, 5)
                        Text(item)
                            .font(Typography.callout)
                            .foregroundStyle(Theme.textMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private func companies(_ rows: [CfoCompanyRow]) -> some View {
        if rows.count > 1 {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("Точки по прибыли")

                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                        if index > 0 { RowDivider() }
                        VStack(alignment: .leading, spacing: Spacing.xxs) {
                            HStack {
                                Text(row.name)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.text)
                                    .lineLimit(1)
                                Spacer(minLength: Spacing.sm)
                                Text(Money.compact(row.profit))
                                    .font(Typography.callout.weight(.medium))
                                    .monospacedDigit()
                                    .foregroundStyle(row.profit >= 0 ? Theme.positive : Theme.negative)
                            }
                            Text("выручка \(Money.compact(row.revenue)) · маржа \(Percent.format(row.margin))")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textDim)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func expenseChanges(_ rows: [CfoExpenseChange]) -> some View {
        if !rows.isEmpty {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("Что сдвинулось в расходах")

                    ForEach(rows) { row in
                        VStack(alignment: .leading, spacing: Spacing.xxs) {
                            HStack {
                                Text(row.label)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.text)
                                    .lineLimit(1)
                                Spacer(minLength: Spacing.sm)
                                Text(Money.signed(row.delta))
                                    .font(Typography.callout.weight(.medium))
                                    .monospacedDigit()
                                    .foregroundStyle(row.delta > 0 ? Theme.negative : Theme.positive)
                            }
                            Text("\(Money.compact(row.previous)) → \(Money.compact(row.current))")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textDim)
                        }
                    }
                }
            }
        }
    }
}

// ── AI Разбор расходов ───────────────────────────────────────────────────────

@MainActor
@Observable
final class ExpenseAnalysisStore {
    private(set) var report: ExpenseAnalysisReport?
    private(set) var isGenerating = false
    private(set) var error: APIError?
    /// Период, за который посчитан показанный разбор. Переключатель наверху
    /// меняется свободно, а цифры остаются старыми — подписывать их новым
    /// периодом значило бы врать.
    private(set) var reportPeriod: InsightPeriod?

    private let service: InsightService

    init(api: APIClient) { service = InsightService(api: api) }

    func generate(days: InsightPeriod) async {
        guard !isGenerating else { return }
        isGenerating = true
        defer { isGenerating = false }
        do {
            report = try await service.expenseAnalysis(days: days)
            reportPeriod = days
            error = nil
        } catch let e as APIError {
            error = e
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }
}

/// Где утекают деньги: категории расходов против такого же прошлого периода
/// плюс разбор модели.
struct ExpenseAnalysisScreen: View {
    @Environment(\.api) private var api
    @State private var store: ExpenseAnalysisStore?
    @State private var period: InsightPeriod = .quarter

    var body: some View {
        ScreenScroll {
            if let store {
                VStack(spacing: Spacing.lg) {
                    Picker("Период", selection: $period) {
                        ForEach(InsightPeriod.expenseOptions) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)

                    if store.isGenerating {
                        AiWaitCard(title: "Разбираем расходы")
                    } else if let error = store.error, store.report == nil {
                        AiFailureView(error: error) { Task { await store.generate(days: period) } }
                    } else if let report = store.report {
                        content(report, store: store)
                    } else {
                        AiRunPrompt(
                            icon: "wallet.pass.fill",
                            title: "Разбор расходов",
                            message: "Сервер сложит траты по категориям и сравнит с прошлым таким же периодом, а модель скажет, что выросло не по делу и что можно урезать. Запрос платный — запускается по кнопке.",
                            buttonTitle: "Разобрать"
                        ) {
                            Task { await store.generate(days: period) }
                        }
                    }
                }
            } else {
                LoadingRows(count: 3)
            }
        }
        .background(Theme.background)
        .navigationTitle("AI Разбор расходов")
        .toolbar { LogoutToolbarItem() }
        .task { if store == nil { store = ExpenseAnalysisStore(api: api) } }
    }

    @ViewBuilder
    private func content(_ report: ExpenseAnalysisReport, store: ExpenseAnalysisStore) -> some View {
        let categories = report.spentCategories

        VStack(spacing: Spacing.lg) {
            Card {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: Spacing.xxs) {
                        Text(Money.format(report.total))
                            .font(Typography.monospacedDigits(Typography.metric))
                            .foregroundStyle(Theme.text)
                        Text("расходы за \((store.reportPeriod ?? period).label.lowercased())")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                    }
                    Spacer(minLength: Spacing.md)
                    VStack(alignment: .trailing, spacing: Spacing.sm) {
                        Text(Percent.format(report.totalChangePct, signed: true))
                            .font(Typography.headline)
                            .monospacedDigit()
                            .foregroundStyle(report.totalChangePct > 0 ? Theme.negative : Theme.positive)
                        Button(store.reportPeriod == period ? "Пересчитать" : "Разобрать за \(period.label.lowercased())") {
                            Task { await store.generate(days: period) }
                        }
                        .buttonStyle(SecondaryButtonStyle())
                    }
                }
            }

            if !report.summary.isEmpty {
                Card(accent: Theme.accent) {
                    Text(report.summary)
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            if categories.isEmpty {
                WideEmptyState(
                    icon: "tray",
                    title: "Расходов за период нет",
                    message: "Внесите траты в журнал — тогда будет что разбирать."
                )
            } else {
                SplitDashboard {
                    insights(report.insights)
                    breakdown(categories)
                } side: {
                    chart(categories)
                    spikes(categories)
                }
            }
        }
    }

    @ViewBuilder
    private func insights(_ items: [AiInsight]) -> some View {
        if items.isEmpty {
            Card {
                InlineEmpty(icon: "text.alignleft", text: "Модель не вернула разбор — остались только цифры", tint: Theme.warning)
            }
        } else {
            ForEach(items) { AiInsightCard(insight: $0) }
        }
    }

    private func chart(_ categories: [ExpenseAnalysisCategory]) -> some View {
        CategoryBarChart(
            title: "Крупнейшие категории",
            points: categories.prefix(10).map {
                CategoryPoint(label: $0.category, value: $0.amount, isHighlighted: $0.isSpike)
            },
            color: ChartPalette.series3
        )
    }

    private func breakdown(_ categories: [ExpenseAnalysisCategory]) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Все категории", subtitle: "доля и изменение к прошлому периоду")

                ForEach(Array(categories.enumerated()), id: \.element.id) { index, category in
                    if index > 0 { RowDivider() }
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        HStack {
                            Text(category.category)
                                .font(Typography.callout)
                                .foregroundStyle(Theme.text)
                                .lineLimit(1)
                            Spacer(minLength: Spacing.sm)
                            Text(Money.compact(category.amount))
                                .font(Typography.callout.weight(.medium))
                                .monospacedDigit()
                                .foregroundStyle(Theme.text)
                        }
                        HStack(spacing: Spacing.sm) {
                            Text(Percent.format(category.sharePct))
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textDim)
                            Text(Percent.format(category.changePct, signed: true))
                                .font(Typography.caption.weight(.semibold))
                                .foregroundStyle(category.changePct > 0 ? Theme.negative : Theme.positive)
                        }
                        ProportionBar(ratio: category.sharePct / 100, color: category.isSpike ? Theme.negative : Theme.brand)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func spikes(_ categories: [ExpenseAnalysisCategory]) -> some View {
        let spikes = categories.filter(\.isSpike)

        if !spikes.isEmpty {
            Card(accent: Theme.negative) {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("Резко выросло", subtitle: "проверить в первую очередь")

                    ForEach(spikes.prefix(6)) { category in
                        VStack(alignment: .leading, spacing: Spacing.xxs) {
                            HStack {
                                Text(category.category)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.text)
                                    .lineLimit(1)
                                Spacer(minLength: Spacing.sm)
                                Text(Percent.format(category.changePct, signed: true))
                                    .font(Typography.callout.weight(.semibold))
                                    .monospacedDigit()
                                    .foregroundStyle(Theme.negative)
                            }
                            Text("\(Money.compact(category.previous)) → \(Money.compact(category.amount))")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textDim)
                        }
                    }
                }
            }
        }
    }
}

// ── AI Разбор команды ────────────────────────────────────────────────────────

@MainActor
@Observable
final class TeamAnalysisStore {
    private(set) var report: TeamAnalysisReport?
    private(set) var isGenerating = false
    private(set) var error: APIError?

    private let service: InsightService

    init(api: APIClient) { service = InsightService(api: api) }

    func generate(days: InsightPeriod) async {
        guard !isGenerating else { return }
        isGenerating = true
        defer { isGenerating = false }
        do {
            report = try await service.teamAnalysis(days: days)
            error = nil
        } catch let e as APIError {
            error = e
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }
}

/// Кто из операторов вытягивает точку, кто проседает и справедлива ли оплата.
struct TeamAnalysisScreen: View {
    @Environment(\.api) private var api
    @State private var store: TeamAnalysisStore?
    @State private var period: InsightPeriod = .month

    var body: some View {
        ScreenScroll {
            if let store {
                VStack(spacing: Spacing.lg) {
                    Picker("Период", selection: $period) {
                        ForEach(InsightPeriod.teamOptions) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)

                    if store.isGenerating {
                        AiWaitCard(title: "Разбираем команду")
                    } else if let error = store.error, store.report == nil {
                        AiFailureView(error: error) { Task { await store.generate(days: period) } }
                    } else if let report = store.report {
                        content(report, store: store)
                    } else {
                        AiRunPrompt(
                            icon: "person.3.fill",
                            title: "Разбор команды",
                            message: "Сервер соберёт по каждому оператору смены, выручку, зарплату, бонусы и штрафы, а модель скажет, кто тянет точку и где оплата разошлась с результатом. Запрос платный — запускается по кнопке.",
                            buttonTitle: "Разобрать"
                        ) {
                            Task { await store.generate(days: period) }
                        }
                    }
                }
            } else {
                LoadingRows(count: 3)
            }
        }
        .background(Theme.background)
        .navigationTitle("AI Разбор команды")
        .toolbar { LogoutToolbarItem() }
        .task { if store == nil { store = TeamAnalysisStore(api: api) } }
    }

    @ViewBuilder
    private func content(_ report: TeamAnalysisReport, store: TeamAnalysisStore) -> some View {
        if report.operators.isEmpty {
            VStack(spacing: Spacing.lg) {
                WideEmptyState(
                    icon: "person.3",
                    title: "Активности за период нет",
                    message: report.summary.isEmpty ? "Никто из операторов не работал в выбранные дни." : report.summary
                )
                Button("Пересчитать") { Task { await store.generate(days: period) } }
                    .buttonStyle(SecondaryButtonStyle())
            }
        } else {
            VStack(spacing: Spacing.lg) {
                totals(report.aggregates, store: store)

                if !report.summary.isEmpty {
                    Card(accent: Theme.accent) {
                        Text(report.summary)
                            .font(Typography.callout)
                            .foregroundStyle(Theme.textMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                SplitDashboard {
                    insights(report.insights)
                    roster(report.operators)
                } side: {
                    fairness(report.aggregates)
                    problems(report.operators)
                }
            }
        }
    }

    private func totals(_ aggregates: TeamAnalysisAggregates, store: TeamAnalysisStore) -> some View {
        VStack(spacing: Spacing.lg) {
            DashboardGrid {
                MetricTile(
                    label: "Оборот команды",
                    value: Money.compact(aggregates.totalTurnover),
                    icon: "arrow.down.circle.fill",
                    accent: Theme.brand
                )
                MetricTile(
                    label: "Зарплата к выплате",
                    value: Money.compact(aggregates.totalNet),
                    icon: "banknote.fill",
                    accent: Theme.info
                )
                MetricTile(
                    label: "Выручка за смену",
                    value: Money.compact(aggregates.avgRevenuePerShift),
                    icon: "clock.fill",
                    accent: Theme.accent
                )
                MetricTile(
                    label: "Работали",
                    value: "\(aggregates.activeCount) из \(aggregates.operatorsCount)",
                    icon: "person.2.fill",
                    accent: Theme.positive
                )
            }

            HStack {
                // Подпись берём из ответа, а не из переключателя: он мог
                // сдвинуться после того, как разбор уже посчитали.
                Text(rangeLabel(aggregates))
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
                Spacer(minLength: Spacing.md)
                Button("Разобрать за \(period.label.lowercased())") {
                    Task { await store.generate(days: period) }
                }
                .buttonStyle(SecondaryButtonStyle())
            }
        }
    }

    private func rangeLabel(_ aggregates: TeamAnalysisAggregates) -> String {
        guard let from = DateParsing.parseDateOnly(aggregates.dateFrom),
              let to = DateParsing.parseDateOnly(aggregates.dateTo) else { return "" }
        return "\(from.formatted(.dateTime.day().month(.abbreviated))) — \(to.formatted(.dateTime.day().month(.abbreviated)))"
    }

    @ViewBuilder
    private func insights(_ items: [AiInsight]) -> some View {
        if items.isEmpty {
            Card {
                InlineEmpty(icon: "text.alignleft", text: "Модель не вернула разбор — остались только цифры", tint: Theme.warning)
            }
        } else {
            ForEach(items) { AiInsightCard(insight: $0) }
        }
    }

    private func roster(_ operators: [TeamAnalysisOperator]) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Операторы", subtitle: "по обороту за период")

                let maximum = operators.map(\.turnover).max() ?? 1
                ForEach(Array(operators.enumerated()), id: \.element.id) { index, member in
                    if index > 0 { RowDivider() }
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        HStack {
                            Text(member.name)
                                .font(Typography.callout.weight(.medium))
                                .foregroundStyle(Theme.text)
                                .lineLimit(1)
                            Spacer(minLength: Spacing.sm)
                            Text(Money.compact(member.turnover))
                                .font(Typography.callout.weight(.medium))
                                .monospacedDigit()
                                .foregroundStyle(Theme.text)
                        }
                        Text("\(member.shifts) \(pluralize(member.shifts, "смена", "смены", "смен")) · \(Money.compact(member.revenuePerShift)) за смену · зарплата \(Money.compact(member.net))")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                        ProportionBar(
                            ratio: maximum > 0 ? member.turnover / maximum : 0,
                            color: member.hasProblems ? Theme.warning : Theme.brand
                        )
                    }
                }
            }
        }
    }

    private func fairness(_ aggregates: TeamAnalysisAggregates) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Справедливость оплаты", subtitle: "разрыв между максимальной и минимальной")

                InsightFactRow(label: "Минимум", value: Money.format(aggregates.salarySpread.minNet))
                RowDivider()
                InsightFactRow(label: "Максимум", value: Money.format(aggregates.salarySpread.maxNet))
                RowDivider()
                InsightFactRow(
                    label: "Разрыв",
                    value: aggregates.salarySpread.ratio > 0 ? "×\(String(format: "%.1f", aggregates.salarySpread.ratio))" : "—",
                    tint: aggregates.salarySpread.ratio >= 3 ? Theme.warning : Theme.text
                )

                if let share = aggregates.salaryShare {
                    RowDivider()
                    InsightFactRow(
                        label: "Зарплата от оборота",
                        value: Percent.format(share),
                        tint: share > 30 ? Theme.warning : Theme.text
                    )
                }
            }
        }
    }

    @ViewBuilder
    private func problems(_ operators: [TeamAnalysisOperator]) -> some View {
        let flagged = operators.filter(\.hasProblems)

        if !flagged.isEmpty {
            Card(accent: Theme.warning) {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("Штрафы и долги")

                    ForEach(Array(flagged.enumerated()), id: \.element.id) { index, member in
                        if index > 0 { RowDivider() }
                        VStack(alignment: .leading, spacing: Spacing.xxs) {
                            Text(member.name)
                                .font(Typography.callout.weight(.medium))
                                .foregroundStyle(Theme.text)
                            if member.fine > 0 {
                                StatRow("Штрафы", value: Money.format(member.fine), valueColor: Theme.negative)
                            }
                            if member.debt > 0 {
                                StatRow("Долг", value: Money.format(member.debt), valueColor: Theme.warning)
                            }
                            if member.remaining > 0 {
                                StatRow("Не выплачено", value: Money.format(member.remaining))
                            }
                        }
                    }
                }
            }
        }
    }
}
