import OrdaKit
import OrdaUI
import SwiftUI

// ── Общее для AI-разделов ────────────────────────────────────────────────────
//
// Язык тот же, что у кабинета владельца: одна цветная карточка с главной
// цифрой сверху, дальше белые блоки со строками «иконка в кружке — текст —
// сумма». Выводы модели — такие же строки: уровень важности читается по
// цвету кружка и подписи, без плашек, которые теснят сам текст.

/// Цвета карточек AI-разделов — те же, что у главных карточек владельца.
private enum InsightPalette {
    static let ai = Theme.heroGradient
    static let green = Theme.heroGradient
    static let red = Theme.heroNegative
    static let orange = Theme.heroGradient
    static let teal = Theme.heroGradient

    /// Оценка «из 100»: зелёная — хорошо, оранжевая — внимание, красная — плохо.
    static func score(_ value: Int) -> [Color] {
        value >= 80 ? green : value >= 60 ? orange : red
    }

    static func scoreTint(_ value: Int) -> Color {
        value >= 80 ? Theme.positive : value >= 60 ? Theme.warning : Theme.negative
    }
}

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
        VStack(alignment: .leading, spacing: Spacing.md) {
            HStack(spacing: Spacing.md) {
                ProgressView()
                    .tint(.white)
                    .frame(width: 52, height: 52)
                    .background(.white.opacity(0.18), in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 18, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                        .fixedSize(horizontal: false, vertical: true)
                    // Секунды крупно не нужны, но видеть, что счёт идёт, —
                    // главное доказательство, что ничего не зависло.
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        Text(elapsed(to: context.date))
                            .font(.system(size: 13, weight: .medium))
                            .monospacedDigit()
                            .foregroundStyle(.white.opacity(0.8))
                    }
                }
            }

            Text(hint)
                .font(.system(size: 14))
                .foregroundStyle(.white.opacity(0.85))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(Spacing.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(colors: InsightPalette.ai, startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: 28, style: .continuous)
        )
    }

    private func elapsed(to now: Date) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(startedAt)))
        return "\(seconds) \(pluralize(seconds, "секунда", "секунды", "секунд"))"
    }
}

/// Приглашение запустить разбор.
///
/// Кнопка, а не автозапуск: каждый разбор — реальные деньги владельца, и
/// тратить их молча при каждом открытии экрана нельзя. Отсюда и подпись
/// «платный запрос» прямо над заголовком — чтобы нажатие было осознанным.
struct AiRunPrompt: View {
    let icon: String
    let title: String
    let message: String
    var buttonTitle = "Разобрать"
    let action: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            HStack(spacing: Spacing.md) {
                Image(systemName: icon)
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 52, height: 52)
                    .background(.white.opacity(0.18), in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text("AI · платный запрос")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.75))
                    Text(title)
                        .font(.system(size: 20, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Text(message)
                .font(.system(size: 14))
                .foregroundStyle(.white.opacity(0.85))
                .fixedSize(horizontal: false, vertical: true)

            Button(action: action) {
                Label(buttonTitle, systemImage: "sparkles")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(InsightPalette.ai[0])
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(.white, in: Capsule())
            }
            .buttonStyle(.pressable)
        }
        .padding(Spacing.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(colors: InsightPalette.ai, startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: 28, style: .continuous)
        )
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
                        .font(.system(size: 17, weight: .bold, design: .rounded))
                        .foregroundStyle(Theme.text)
                        .padding(.top, Spacing.xs)
                case .listItem:
                    HStack(alignment: .top, spacing: Spacing.sm) {
                        Circle()
                            .fill(Theme.accent)
                            .frame(width: 6, height: 6)
                            .padding(.top, 7)
                        Text(block.text)
                            .font(.system(size: 15))
                            .foregroundStyle(Theme.textMuted)
                    }
                case .quote:
                    Text(block.text)
                        .font(.system(size: 15).italic())
                        .foregroundStyle(Theme.textMuted)
                        .padding(.leading, Spacing.md)
                        .overlay(alignment: .leading) {
                            Capsule().fill(Theme.accent.opacity(0.5)).frame(width: 3)
                        }
                case .tableHeader:
                    Text(block.text)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.textDim)
                case .tableRow:
                    // Разбор ИИ таблицами почти не пишет, но статья из базы
                    // знаний может прийти и сюда — строку показываем
                    // «заголовок: значение», а не склеенной.
                    VStack(alignment: .leading, spacing: 2) {
                        if let head = block.cells.first {
                            Text(head)
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(Theme.text)
                        }
                        ForEach(Array(block.cells.dropFirst().enumerated()), id: \.offset) { _, cell in
                            Text(cell)
                                .font(.system(size: 15))
                                .foregroundStyle(Theme.textMuted)
                        }
                    }
                case .paragraph:
                    Text(block.text)
                        .font(.system(size: 15))
                        .foregroundStyle(Theme.textMuted)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
    }
}

/// Вывод модели строкой «вывод → причина → действие».
///
/// Раньше каждый вывод был отдельной карточкой с плашкой уровня — пять
/// выводов превращались в пять рамок подряд. Теперь это строки одного блока:
/// важность видна по цвету кружка и короткой подписи над выводом.
struct AiInsightCard: View {
    let insight: AiInsight

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            TintedIcon(systemName: icon, tint: tint, size: 40)
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(insight.severityLabel)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(tint)
                Text(insight.verdict)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Theme.text)
                    .fixedSize(horizontal: false, vertical: true)

                if !insight.reason.isEmpty {
                    Text(insight.reason)
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if !insight.action.isEmpty {
                    HStack(alignment: .top, spacing: Spacing.sm) {
                        Image(systemName: "arrow.turn.down.right")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(tint)
                            .padding(.top, 2)
                        Text(insight.action)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(Theme.text)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.top, 2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var tint: Color {
        insight.isCritical ? Theme.negative : insight.isPositive ? Theme.positive : Theme.warning
    }

    private var icon: String {
        insight.isCritical ? "exclamationmark.triangle.fill" : insight.isPositive ? "checkmark.seal.fill" : "lightbulb.fill"
    }
}

/// Выводы модели одним белым блоком — или честная строка, что их нет.
private struct AiInsightList: View {
    let items: [AiInsight]

    var body: some View {
        if items.isEmpty {
            InsightRow(
                leading: { TintedIcon(systemName: "text.alignleft", tint: Theme.warning, size: 40) },
                title: "Модель не вернула разбор",
                subtitle: "Остались только цифры",
                wraps: true
            )
            .insightCard()
        } else {
            OwnerSection("Выводы AI") {
                Text("\(items.count)")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
            } content: {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    ForEach(items) { AiInsightCard(insight: $0) }
                }
            }
        }
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
                InsightRow(
                    leading: { TintedIcon(systemName: "clock.badge.exclamationmark", tint: Theme.warning, size: 40) },
                    title: "Не уложились во время",
                    subtitle: "Разбор не уложился в отведённое время. Попробуйте период покороче.",
                    wraps: true
                )
                .insightCard()
            }
        }
    }

    private var looksLikeTimeout: Bool {
        guard case let .transport(message) = error else { return false }
        return message.localizedCaseInsensitiveContains("time")
            || message.localizedCaseInsensitiveContains("врем")
    }
}

/// Короткий вывод модели одним абзацем — под главной карточкой.
private struct AiSummaryCard: View {
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            TintedIcon(systemName: "sparkles", tint: Theme.accent, size: 40)
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text("Коротко от AI")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.accent)
                Text(text)
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.text)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .insightCard()
    }
}

/// Повторный разбор — белая капсула под главной карточкой.
///
/// Серая кнопка рядом с цветной карточкой терялась; при этом запрос платный,
/// поэтому она на виду, но отдельной строкой — случайно не заденешь.
private struct RerunButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: "arrow.clockwise")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.brand)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(Theme.surface, in: Capsule())
        }
        .buttonStyle(.pressable)
    }
}

/// Секция с короткой пояснительной строкой под заголовком.
///
/// Без пояснения «ABC-анализ» или «Вилка» читателю ничего не говорят, а
/// длинная подпись справа от заголовка не помещается на телефоне.
private struct InsightSection<Content: View, Trailing: View>: View {
    let title: String
    let note: String?
    let trailing: () -> Trailing
    let content: () -> Content

    init(
        _ title: String,
        note: String? = nil,
        @ViewBuilder trailing: @escaping () -> Trailing = { EmptyView() },
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.title = title
        self.note = note
        self.trailing = trailing
        self.content = content
    }

    var body: some View {
        OwnerSection(title, trailing: trailing) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                if let note {
                    Text(note)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textDim)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, -Spacing.sm)
                }
                content()
            }
        }
    }
}

/// Строка «иконка — текст — значение» для того, что в `AmountRow` не ложится:
/// цветное значение, многострочный текст модели, цветная пометка статуса.
private struct InsightRow<Leading: View>: View {
    @ViewBuilder let leading: () -> Leading
    let title: String
    var subtitle: String? = nil
    var value: String? = nil
    var valueTint: Color = Theme.text
    var note: String? = nil
    var noteTint: Color = Theme.textDim
    /// Тексты модели — целыми предложениями: обрезать их значит терять смысл.
    var wraps = false

    var body: some View {
        HStack(alignment: wraps ? .top : .center, spacing: Spacing.md) {
            leading()
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                    Text(title)
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(Theme.text)
                        .lineLimit(wraps ? nil : 1)
                        .fixedSize(horizontal: false, vertical: wraps)
                    Spacer(minLength: Spacing.sm)
                    if let value {
                        Text(value)
                            .font(.system(size: 16, weight: .semibold, design: .rounded))
                            .monospacedDigit()
                            .foregroundStyle(valueTint)
                            .lineLimit(1)
                            .layoutPriority(1)
                    }
                }
                if let subtitle {
                    Text(subtitle)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textDim)
                        .lineLimit(wraps ? nil : 1)
                        .fixedSize(horizontal: false, vertical: wraps)
                }
                if let note {
                    Text(note)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(noteTint)
                }
            }
        }
        .padding(.vertical, Spacing.xs)
        .contentShape(Rectangle())
    }
}

/// Номер шага в цветном кружке — для списков дел.
private struct StepBadge: View {
    let number: Int
    var tint: Color = Theme.accent
    var size: CGFloat = 32

    var body: some View {
        Text("\(number)")
            .font(.system(size: size * 0.44, weight: .bold, design: .rounded))
            .foregroundStyle(tint)
            .frame(width: size, height: size)
            .background(tint.opacity(0.14), in: Circle())
    }
}

/// Короткая подпись в кружке: «Пн», «A». `LetterBadge` берёт одну букву, а у
/// «Понедельника» и «Пятницы» она общая.
private struct TextBadge: View {
    let text: String
    let tint: Color
    var size: CGFloat = 40

    var body: some View {
        Text(text)
            .font(.system(size: size * 0.36, weight: .bold, design: .rounded))
            .foregroundStyle(tint)
            .frame(width: size, height: size)
            .background(tint.opacity(0.14), in: Circle())
    }
}

private extension View {
    /// Белый скруглённый блок — как `OwnerSection`, но без заголовка.
    func insightCard() -> some View {
        padding(Spacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }
}

/// Ряд «метка — значение».
private struct InsightFactRow: View {
    let label: String
    let value: String
    var tint: Color = Theme.text

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
            Text(label)
                .font(.system(size: 15))
                .foregroundStyle(Theme.textMuted)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: Spacing.sm)
            Text(value)
                .font(.system(size: 15, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(tint)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
    }
}

/// Таблица фактов.
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
            ForEach(rows) { row in
                InsightFactRow(label: row.label, value: row.value, tint: row.tint)
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
            hero(report)

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

    // ── Главная цифра ────────────────────────────────────────────────────────

    /// Ожидаемый доход крупно, расход и прибыль — его расшифровкой. Цвет — по
    /// прибыли: в минус прогноз уходит редко, и тогда это видно сразу.
    private func hero(_ report: MonthlyForecastReport) -> some View {
        HeroSummary(
            title: "Доход, \(report.targetMonthLabel)",
            value: Money.format(report.income.expected),
            caption: "\(Percent.format(report.income.momGrowthPct, signed: true)) к прошлому месяцу · прогноз",
            footer: [
                ("Расход", Money.format(report.expense.expected)),
                ("Прибыль", Money.format(report.profit.expected)),
                ("Маржа", Percent.format(report.profit.marginPct)),
            ],
            colors: report.profit.expected >= 0 ? InsightPalette.ai : InsightPalette.red
        )
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
                InsightRow(
                    leading: { TintedIcon(systemName: "chart.xyaxis.line", tint: Theme.textDim, size: 40) },
                    title: "Месяцев пока мало для графика"
                )
                .insightCard()
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

        return InsightSection("Вилка на \(report.targetMonthLabel)", note: "одно число прогнозом не бывает") {
            InsightFactTable(rows: rows)

            if let current = report.current {
                OwnerFootnote(text: "Текущий месяц пройден на \(Percent.format(current.elapsedRatio * 100)): факт \(Money.format(current.factToDate)).")
            }
        }
    }

    // ── Структура расходов ───────────────────────────────────────────────────

    private func expenseStructure(_ report: MonthlyForecastReport) -> some View {
        InsightSection("Из чего расход", note: "переменные растут вместе с выручкой, постоянные — нет") {
            if report.expense.expected <= 0 {
                InsightRow(
                    leading: { TintedIcon(systemName: "tray", tint: Theme.textDim, size: 40) },
                    title: "Расходов в истории нет"
                )
            } else {
                SplitBar(segments: [
                    .init(label: "Постоянные", value: report.expense.fixed, color: ChartPalette.series1),
                    .init(label: "Переменные", value: report.expense.variable, color: ChartPalette.series2),
                ].filter { $0.value > 0 })

                InsightFactRow(label: "Постоянные", value: Money.format(report.expense.fixed))
                InsightFactRow(
                    label: "Переменные (\(Percent.format(report.expense.variableRatePct)) от дохода)",
                    value: Money.format(report.expense.variable)
                )

                if report.expense.oneOffAvg > 0 {
                    InsightFactRow(
                        label: "Разовые, в среднем за месяц",
                        value: Money.format(report.expense.oneOffAvg),
                        tint: Theme.warning
                    )
                    OwnerFootnote(text: "Разовые траты в прогноз не входят — они случаются нерегулярно, но деньги на них уходят настоящие.")
                }

                let groups = report.fixedExpenses + report.variableExpenses
                if !groups.isEmpty {
                    let total = max(report.expense.expected, 1)
                    VStack(spacing: Spacing.md) {
                        ForEach(groups.prefix(8)) { group in
                            let tint = group.isFixed ? ChartPalette.series1 : ChartPalette.series2
                            AmountRow(
                                leading: {
                                    TintedIcon(systemName: group.isFixed ? "lock.fill" : "arrow.up.arrow.down", tint: tint, size: 40)
                                },
                                title: group.label,
                                subtitle: group.isFixed ? "постоянный" : "переменный",
                                amount: Money.format(group.amount),
                                share: group.amount / total,
                                tint: tint
                            )
                        }
                    }
                    .padding(.top, Spacing.xs)
                }
            }
        }
    }

    // ── Как считали ──────────────────────────────────────────────────────────

    @ViewBuilder
    private func explanation(_ report: MonthlyForecastReport) -> some View {
        if !report.explanation.isEmpty {
            OwnerSection("Как получилось это число") {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    ForEach(Array(report.explanation.enumerated()), id: \.offset) { index, line in
                        HStack(alignment: .top, spacing: Spacing.md) {
                            StepBadge(number: index + 1, tint: Theme.info, size: 28)
                            Text(line)
                                .font(.system(size: 15))
                                .foregroundStyle(Theme.textMuted)
                                .fixedSize(horizontal: false, vertical: true)
                                .padding(.top, 4)
                        }
                    }
                }
            }
        }
    }

    // ── Уверенность ──────────────────────────────────────────────────────────

    private func confidence(_ report: MonthlyForecastReport) -> some View {
        let confidence = report.confidence
        let tint = confidence.score >= 75 ? Theme.positive : confidence.score >= 45 ? Theme.warning : Theme.negative

        return OwnerSection("Насколько можно верить") {
            Text(confidence.label)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(tint)
        } content: {
            VStack(alignment: .leading, spacing: Spacing.md) {
                ProgressRing(
                    progress: Double(confidence.score) / 100,
                    label: "\(confidence.score)",
                    caption: confidence.label,
                    color: tint
                )
                .frame(maxWidth: .infinity)

                InsightFactRow(label: "Месяцев данных", value: "\(confidence.monthsOfData)")
                InsightFactRow(label: "Разброс выручки", value: Percent.format(confidence.volatilityPct))
                InsightFactRow(
                    label: "Сезонность",
                    value: confidence.seasonalityAvailable ? "Учтена" : "Не хватает истории",
                    tint: confidence.seasonalityAvailable ? Theme.text : Theme.textDim
                )

                ForEach(Array(confidence.notes.enumerated()), id: \.offset) { _, note in
                    OwnerFootnote(text: note)
                }
            }
        }
    }

    // ── Безубыточность ───────────────────────────────────────────────────────

    private func breakeven(_ report: MonthlyForecastReport) -> some View {
        let safe = report.breakeven.safetyMarginPct >= 20
        return InsightSection("Точка безубыточности", note: "выручка, ниже которой месяц уходит в минус") {
            Text(Money.format(report.breakeven.revenue))
                .font(.system(size: 30, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(Theme.text)
                .lineLimit(1)
                .minimumScaleFactor(0.6)

            InsightFactRow(
                label: "Запас прочности",
                value: Percent.format(report.breakeven.safetyMarginPct),
                tint: safe ? Theme.positive : Theme.warning
            )
            ProportionBar(
                ratio: min(max(report.breakeven.safetyMarginPct / 100, 0), 1),
                color: safe ? Theme.positive : Theme.warning
            )
        }
    }

    // ── Проверка модели ──────────────────────────────────────────────────────

    @ViewBuilder
    private func backtest(_ report: MonthlyForecastReport) -> some View {
        if let backtest = report.backtest {
            let tint = backtest.isAccurate ? Theme.positive : Theme.warning
            OwnerSection("Проверка на прошлом месяце") {
                Image(systemName: backtest.isAccurate ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
                    .foregroundStyle(tint)
            } content: {
                VStack(spacing: Spacing.md) {
                    InsightFactRow(label: "Предсказали", value: Money.format(backtest.predictedIncome))
                    InsightFactRow(label: "Вышло", value: Money.format(backtest.actualIncome))
                    InsightFactRow(
                        label: "Ошибка",
                        value: Percent.format(backtest.incomeErrorPct, signed: true),
                        tint: tint
                    )
                }
            }
        }
    }

    // ── Точки ────────────────────────────────────────────────────────────────

    @ViewBuilder
    private func companies(_ rows: [ForecastCompanyRow]) -> some View {
        if !rows.isEmpty {
            let maximum = max(rows.map(\.income).max() ?? 1, 1)
            OwnerSection("Прогноз по точкам") {
                VStack(spacing: Spacing.md) {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                        AmountRow(
                            leading: { LetterBadge(text: row.name, tint: OwnerTint.point(index)) },
                            title: row.name,
                            subtitle: "прибыль \(Money.format(row.profit)) · маржа \(Percent.format(row.marginPct))",
                            amount: Money.format(row.income),
                            share: row.income / maximum,
                            tint: OwnerTint.point(index)
                        )
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
            OwnerSection("Вывод AI") {
                Button("Обновить") { Task { await store.explain() } }
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.brand)
            } content: {
                AiTextBlocks(blocks: InsightMarkdown.blocks(from: comment))
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
        VStack(spacing: Spacing.md) {
            AiRunPrompt(
                icon: "chart.line.uptrend.xyaxis",
                title: "Прогноз на 30, 60 и 90 дней",
                message: "Сервер разложит последние 13 недель — выручку, расходы, сезонность и крупные разовые траты, — а модель объяснит, что с этим делать. Запрос платный и небыстрый, поэтому запускается только по кнопке.",
                buttonTitle: "Построить прогноз"
            ) {
                Task { await store.generate() }
            }

            OwnerFootnote(text: "Прогноз строится по всем доступным вам точкам сразу.")
        }
    }

    @ViewBuilder
    private func content(_ report: AiForecastReport, store: ForecastStore) -> some View {
        VStack(spacing: Spacing.lg) {
            hero(report)

            RerunButton(title: "Пересчитать") { Task { await store.generate() } }

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

    /// Ближайший месяц крупно, два следующих и прибыль — под ним. На какой
    /// истории всё посчитано, сказано подписью: без неё прогноз не проверить.
    private func hero(_ report: AiForecastReport) -> some View {
        let projected = report.projected
        return HeroSummary(
            title: "Выручка, " + (projected.month0Label.isEmpty ? "текущий месяц" : projected.month0Label),
            value: Money.format(projected.month0Income),
            caption: "история \(Self.rangeLabel(from: report.dateFrom, to: report.dateTo)) · неделя в среднем \(Money.format(report.avgWeeklyIncome))",
            footer: [
                (projected.month1Label.isEmpty ? "Через месяц" : projected.month1Label, Money.format(projected.month1Income)),
                (projected.month2Label.isEmpty ? "Через два" : projected.month2Label, Money.format(projected.month2Income)),
                ("Прибыль сейчас", Money.format(projected.month0Profit)),
            ],
            colors: projected.month0Profit >= 0 ? InsightPalette.ai : InsightPalette.red
        )
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
                InsightRow(
                    leading: { TintedIcon(systemName: "chart.bar", tint: Theme.textDim, size: 40) },
                    title: "Недель с продажами пока мало"
                )
                .insightCard()
            }
        }
    }

    @ViewBuilder
    private func analysis(_ report: AiForecastReport) -> some View {
        let blocks = report.blocks

        if blocks.isEmpty {
            InsightRow(
                leading: { TintedIcon(systemName: "text.alignleft", tint: Theme.warning, size: 40) },
                title: "Модель не вернула разбор",
                subtitle: "Остались только цифры",
                wraps: true
            )
            .insightCard()
        } else {
            InsightSection("Разбор AI", note: "цифры считал сервер, выводы — модель") {
                Image(systemName: "sparkles")
                    .foregroundStyle(Theme.accent)
            } content: {
                AiTextBlocks(blocks: blocks)
            }
        }
    }

    @ViewBuilder
    private func categories(_ report: AiForecastReport) -> some View {
        if !report.categories.isEmpty {
            InsightSection("Куда уходят деньги", note: "и как менялось за последние 30 дней") {
                VStack(spacing: Spacing.md) {
                    ForEach(Array(report.categories.enumerated()), id: \.element.id) { index, category in
                        let tint = OwnerTint.point(index)
                        AmountRow(
                            leading: {
                                TintedIcon(systemName: OwnerAnalyticsScreen.expenseIcon(category.category), tint: tint, size: 40)
                            },
                            title: category.category,
                            subtitle: "\(Percent.format(category.share)) · \(category.count) \(pluralize(category.count, "операция", "операции", "операций"))",
                            amount: Money.format(category.total),
                            // Мелкие колебания — шум; стрелку показываем от 10%.
                            change: category.trendPct.flatMap { abs($0) >= 10 ? $0 : nil },
                            higherIsBetter: false,
                            share: category.share / 100,
                            tint: tint
                        )
                    }
                }
            }
        }
    }

    private func momentum(_ report: AiForecastReport) -> some View {
        let comparison = report.comparison

        return InsightSection("Разгон", note: "последние 30 дней против предыдущих 30") {
            VStack(spacing: Spacing.md) {
                momentumRow("Выручка", comparison.incomeMomentum, higherIsBetter: true)
                momentumRow("Расходы", comparison.expenseMomentum, higherIsBetter: false)
                momentumRow("Прибыль", comparison.profitMomentum, higherIsBetter: true)
                InsightRow(
                    leading: { TintedIcon(systemName: "percent", tint: Theme.info, size: 40) },
                    title: "Маржа сейчас",
                    value: Percent.format(comparison.last30.margin)
                )
            }
        }
    }

    private func momentumRow(_ label: String, _ value: Double, higherIsBetter: Bool) -> some View {
        let good = (value >= 0) == higherIsBetter
        let tint = good ? Theme.positive : Theme.negative
        return InsightRow(
            leading: {
                TintedIcon(systemName: value >= 0 ? "arrow.up.right" : "arrow.down.right", tint: tint, size: 40)
            },
            title: label,
            value: Percent.format(value, signed: true),
            valueTint: tint
        )
    }

    @ViewBuilder
    private func seasonality(_ report: AiForecastReport) -> some View {
        let days = report.seasonality.byDay.filter { $0.avg > 0 }

        if !days.isEmpty {
            let maximum = max(days.map(\.avg).max() ?? 1, 1)
            InsightSection("Дни недели", note: "средняя выручка дня") {
                VStack(spacing: Spacing.md) {
                    ForEach(days) { day in
                        let isBest = day.name == report.seasonality.best?.name
                        let tint = isBest ? Theme.positive : Theme.brand
                        AmountRow(
                            leading: { TextBadge(text: String(day.name.prefix(2)), tint: tint) },
                            title: day.name,
                            subtitle: isBest ? "лучший день" : nil,
                            amount: Money.format(day.avg),
                            share: day.avg / maximum,
                            tint: tint
                        )
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func kpi(_ report: AiForecastReport) -> some View {
        if let kpi = report.kpi, kpi.plan > 0 {
            OwnerSection("План на месяц") {
                VStack(spacing: Spacing.md) {
                    ProgressRing(
                        progress: kpi.progress / 100,
                        label: Percent.format(kpi.progress),
                        caption: "выполнено",
                        color: kpi.progress >= 100 ? Theme.positive : Theme.brand
                    )
                    .frame(maxWidth: .infinity)
                    InsightFactRow(label: "План", value: Money.format(kpi.plan))
                    InsightFactRow(label: "Факт", value: Money.format(kpi.actual))
                }
            }
        }
    }

    @ViewBuilder
    private func outliers(_ report: AiForecastReport) -> some View {
        if !report.outliers.isEmpty {
            InsightSection("Крупные разовые траты", note: "выбиваются из обычного ряда") {
                VStack(spacing: Spacing.md) {
                    ForEach(report.outliers.prefix(6)) { outlier in
                        InsightRow(
                            leading: {
                                TintedIcon(systemName: OwnerAnalyticsScreen.expenseIcon(outlier.category), tint: Theme.warning, size: 40)
                            },
                            title: outlier.category,
                            subtitle: outlierSubtitle(outlier),
                            value: Money.format(outlier.amount),
                            valueTint: Theme.warning
                        )
                    }
                }
            }
        }
    }

    /// Дата и комментарий одной строкой: по отдельности они занимали
    /// по строке каждый, и список из шести трат не влезал в экран.
    private func outlierSubtitle(_ outlier: AiForecastOutlier) -> String? {
        var parts: [String] = []
        if let day = outlier.day { parts.append(day.formatted(.dateTime.day().month(.abbreviated))) }
        if let comment = outlier.comment, !comment.isEmpty { parts.append(comment) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
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
                healthFactors(data.healthScore)
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

    /// Оценка «из 100» — главная цифра раздела, цвет карточки говорит, хорошо
    /// это или плохо, раньше, чем прочитано число.
    private func health(_ section: BiHealthSection) -> some View {
        HeroSummary(
            title: "Здоровье бизнеса",
            value: "\(section.score) из 100",
            caption: section.band,
            footer: section.factors.prefix(3).map { ($0.label, "\($0.score)") },
            colors: InsightPalette.score(section.score)
        )
    }

    /// Из чего сложилась оценка — с пояснением к каждому фактору.
    private func healthFactors(_ section: BiHealthSection) -> some View {
        OwnerSection("Из чего оценка") {
            if section.factors.isEmpty {
                InsightRow(
                    leading: { TintedIcon(systemName: "square.stack.3d.up", tint: Theme.textDim, size: 40) },
                    title: "Разбивка недоступна"
                )
            } else {
                VStack(spacing: Spacing.md) {
                    ForEach(section.factors) { factor in
                        let tint = InsightPalette.scoreTint(factor.score)
                        AmountRow(
                            leading: {
                                TintedIcon(
                                    systemName: factor.score >= 80 ? "checkmark" : factor.score >= 60 ? "exclamationmark" : "xmark",
                                    tint: tint,
                                    size: 40
                                )
                            },
                            title: factor.label,
                            subtitle: factor.note.isEmpty ? nil : factor.note,
                            amount: "\(factor.score)",
                            share: Double(factor.score) / 100,
                            tint: tint
                        )
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
            OwnerSection("Что делать сегодня") {
                Button("Обновить") { Task { await store.askPriorities() } }
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.brand)
            } content: {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    ForEach(Array(store.actions.enumerated()), id: \.offset) { index, action in
                        HStack(alignment: .top, spacing: Spacing.md) {
                            StepBadge(number: index + 1)
                            Text(action)
                                .font(.system(size: 15))
                                .foregroundStyle(Theme.text)
                                .fixedSize(horizontal: false, vertical: true)
                                .padding(.top, 5)
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
                message: "Формулы уже посчитаны. Модель может свести их в короткий список дел — это отдельный платный запрос, поэтому он по кнопке.",
                buttonTitle: "Собрать список"
            ) {
                Task { await store.askPriorities() }
            }
        }
    }

    /// Цвет класса ABC: A — деньги, B — середина, C — хвост.
    private func abcTint(_ cls: String) -> Color {
        switch cls.uppercased() {
        case "A": Theme.positive
        case "B": Theme.info
        default: Theme.textDim
        }
    }

    @ViewBuilder
    private func abc(_ section: BiAbcSection) -> some View {
        if section.available {
            InsightSection("ABC-анализ", note: "малая часть позиций делает бо́льшую часть выручки") {
                VStack(spacing: Spacing.md) {
                    ForEach(section.classes) { cls in
                        let tint = abcTint(cls.cls)
                        AmountRow(
                            leading: { TextBadge(text: cls.cls, tint: tint) },
                            title: "Класс \(cls.cls)",
                            subtitle: "\(cls.itemCount) \(pluralize(cls.itemCount, "позиция", "позиции", "позиций"))",
                            amount: Percent.format(cls.revenueSharePct),
                            share: cls.revenueSharePct / 100,
                            tint: tint
                        )
                    }
                }

                if !section.vital.isEmpty {
                    Text("Ключевые позиции")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.textDim)
                        .padding(.top, Spacing.xs)
                    VStack(spacing: Spacing.md) {
                        ForEach(section.vital.prefix(8)) { item in
                            InsightRow(
                                leading: { TintedIcon(systemName: "star.fill", tint: Theme.positive, size: 36) },
                                title: item.name,
                                value: Money.format(item.revenue)
                            )
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

            InsightSection(
                "Пора заказывать",
                note: section.needsOrder.isEmpty
                    ? "всё выше точки заказа"
                    : "\(section.needsOrder.count) \(pluralize(section.needsOrder.count, "позиция", "позиции", "позиций")) ниже точки заказа"
            ) {
                if rows.isEmpty {
                    InsightRow(
                        leading: { TintedIcon(systemName: "shippingbox", tint: Theme.textDim, size: 40) },
                        title: "Позиций для расчёта нет"
                    )
                } else {
                    VStack(spacing: Spacing.md) {
                        ForEach(rows.prefix(10)) { row in
                            let tint = row.belowReorder ? Theme.warning : Theme.positive
                            InsightRow(
                                leading: {
                                    TintedIcon(systemName: row.belowReorder ? "cart.fill.badge.plus" : "shippingbox.fill", tint: tint, size: 40)
                                },
                                title: row.name,
                                subtitle: "остаток \(Quantity.format(row.stock)) · точка заказа \(Quantity.format(row.reorderPoint)) · запас \(Quantity.format(row.safetyStock))",
                                note: row.belowReorder ? "Заказать" : "Хватает",
                                noteTint: tint
                            )
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func newsvendor(_ section: BiNewsvendorSection) -> some View {
        if section.available, !section.rows.isEmpty {
            InsightSection("Сколько держать", note: "баланс между «не хватило» и «списали»") {
                VStack(spacing: Spacing.md) {
                    ForEach(section.rows.prefix(8)) { row in
                        let short = row.stock < row.recommendedStock
                        InsightRow(
                            leading: {
                                TintedIcon(systemName: "scalemass.fill", tint: short ? Theme.warning : Theme.info, size: 40)
                            },
                            title: row.name,
                            subtitle: "сейчас → рекомендуем",
                            value: "\(Quantity.format(row.stock)) → \(Quantity.format(row.recommendedStock))",
                            valueTint: short ? Theme.warning : Theme.text
                        )
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func anomalies(_ section: BiAnomalySection) -> some View {
        if section.available {
            InsightSection("Необычные дни", note: "выручка вне контрольных границ за \(section.days) \(pluralize(section.days, "день", "дня", "дней"))") {
                if section.anomalies.isEmpty {
                    InsightRow(
                        leading: { TintedIcon(systemName: "checkmark.circle.fill", tint: Theme.positive, size: 40) },
                        title: "Выбросов нет — выручка ровная"
                    )
                } else {
                    VStack(spacing: Spacing.md) {
                        ForEach(section.anomalies.prefix(8)) { day in
                            let tint = day.isAbove ? Theme.positive : Theme.negative
                            InsightRow(
                                leading: {
                                    TintedIcon(systemName: day.isAbove ? "arrow.up.right" : "arrow.down.right", tint: tint, size: 40)
                                },
                                title: day.day?.formatted(.dateTime.day().month(.abbreviated)) ?? day.date,
                                subtitle: "\(day.company) · \(day.isAbove ? "выше" : "ниже") обычного",
                                value: Money.format(day.revenue),
                                valueTint: tint
                            )
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func rfm(_ section: BiRfmSection) -> some View {
        if section.available, !section.segments.isEmpty {
            let maximum = max(section.segments.map(\.monetary).max() ?? 1, 1)
            InsightSection("Сегменты клиентов", note: "давно ли приходил, как часто, на сколько") {
                VStack(spacing: Spacing.md) {
                    ForEach(Array(section.segments.enumerated()), id: \.element.id) { index, segment in
                        AmountRow(
                            leading: { LetterBadge(text: segment.segment, tint: OwnerTint.point(index)) },
                            title: segment.segment,
                            subtitle: "\(segment.count) \(pluralize(segment.count, "клиент", "клиента", "клиентов"))",
                            amount: Money.format(segment.monetary),
                            share: segment.monetary / maximum,
                            tint: OwnerTint.point(index)
                        )
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func clv(_ section: BiClvSection) -> some View {
        if section.available, !section.rows.isEmpty {
            InsightSection("Самые ценные клиенты", note: "оценка на всё время, а не за визит") {
                VStack(spacing: Spacing.md) {
                    ForEach(section.rows.prefix(8)) { row in
                        AmountRow(
                            leading: { PersonInitial(name: row.name) },
                            title: row.name,
                            subtitle: "средний чек \(Money.format(row.avgOrder)) · \(row.frequency) \(pluralize(row.frequency, "покупка", "покупки", "покупок"))",
                            amount: Money.format(row.clv)
                        )
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func cashiers(_ section: BiCashierSection) -> some View {
        if section.available, !section.rows.isEmpty {
            InsightSection("Риск недостачи", note: "оценка по истории, а не обвинение") {
                VStack(spacing: Spacing.md) {
                    ForEach(section.rows.prefix(8)) { row in
                        let high = row.posteriorPct >= 30
                        InsightRow(
                            leading: { PersonInitial(name: row.cashier) },
                            title: row.cashier,
                            subtitle: "\(row.shortfallEvents) из \(row.totalEvents) смен с расхождением",
                            value: Percent.format(row.posteriorPct),
                            valueTint: high ? Theme.negative : Theme.textMuted,
                            note: high ? "Высокий риск" : nil,
                            noteTint: Theme.negative
                        )
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

    func generate(days: AnalyticsPeriod) async {
        guard !isGenerating else { return }
        isGenerating = true
        defer { isGenerating = false }
        do {
            let bounds = days.bounds()
            report = try await service.cfo(from: bounds.from, to: bounds.to)
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
    @State private var period: AnalyticsPeriod = .last90Days

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
        VStack(spacing: Spacing.md) {
            PeriodBar(selection: $period, quick: [.last7Days, .last30Days, .last90Days, .thisYear])

            // Смена периода сама разбор не запускает: это был бы новый платный
            // запрос от одного касания сегментированного переключателя.
            if store.report != nil || store.error != nil {
                RerunButton(title: "Разобрать за \(period.title.lowercased())") {
                    Task { await store.generate(days: period) }
                }
            }
        }
    }

    @ViewBuilder
    private func content(_ report: CfoReport) -> some View {
        VStack(spacing: Spacing.lg) {
            hero(report)

            dataQuality(report.dataQuality, period: report.periodLabel)

            if let analysis = report.analysis {
                if let error = analysis.error, !error.isEmpty {
                    InsightRow(
                        leading: { TintedIcon(systemName: "exclamationmark.bubble", tint: Theme.warning, size: 40) },
                        title: error,
                        wraps: true
                    )
                    .insightCard()
                }
            }

            SplitDashboard {
                summary(report.analysis?.summary)
                statements("Что изменилось", icon: "arrow.left.arrow.right", items: report.analysis?.changes ?? [])
                statements("Почему так", icon: "magnifyingglass", items: report.analysis?.rootCauses ?? [])
                moneyLines("Где утекает", icon: "arrow.down.right", items: report.analysis?.losses ?? [], tint: Theme.negative)
                moneyLines("Где недозарабатываем", icon: "hourglass", items: report.analysis?.missedProfit ?? [], tint: Theme.warning)
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

    /// Прибыль периода крупно: финдиректора спрашивают «сколько заработали»,
    /// а выручка и расходы — объяснение этой цифры. Изменения к прошлому
    /// такому же периоду — прямо в подписях.
    private func hero(_ report: CfoReport) -> some View {
        let executive = report.executive
        return HeroSummary(
            title: "Прибыль · \(report.periodLabel)",
            value: Money.format(executive.profit),
            caption: "\(Percent.format(executive.profitDeltaPct, signed: true)) к прошлому периоду",
            footer: [
                ("Выручка · \(Percent.format(executive.revenueDeltaPct, signed: true))", Money.format(executive.revenue)),
                ("Расходы · \(Percent.format(executive.expensesDeltaPct, signed: true))", Money.format(executive.expenses)),
                ("Маржа", Percent.format(executive.margin)),
            ],
            colors: executive.profit >= 0 ? InsightPalette.green : InsightPalette.red
        )
    }

    private func dataQuality(_ quality: CfoDataQuality, period: String) -> some View {
        let tint = quality.percent >= 90 ? Theme.positive : quality.percent >= 70 ? Theme.warning : Theme.negative
        // Без этой строки любые выводы ниже выглядят одинаково
        // убедительно — и при полных данных, и при половине месяца.
        return InsightRow(
            leading: {
                TintedIcon(systemName: quality.percent >= 90 ? "checkmark.shield.fill" : "exclamationmark.shield.fill", tint: tint, size: 40)
            },
            title: quality.label,
            subtitle: "\(period) · продажи внесены за \(quality.daysWithSales) из \(quality.daysInPeriod) \(pluralize(quality.daysInPeriod, "дня", "дней", "дней")), расходы — за \(quality.daysWithExpenses).",
            value: Percent.format(Double(quality.percent)),
            valueTint: tint,
            wraps: true
        )
        .insightCard()
    }

    @ViewBuilder
    private func summary(_ summary: CfoSummary?) -> some View {
        if let summary {
            OwnerSection("Коротко") {
                Image(systemName: "sparkles")
                    .foregroundStyle(Theme.accent)
            } content: {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    if !summary.whereLosing.isEmpty {
                        labelled("Где теряем", summary.whereLosing, icon: "arrow.down.right", tint: Theme.negative)
                    }
                    if !summary.whereEarn.isEmpty {
                        labelled("Где зарабатываем", summary.whereEarn, icon: "arrow.up.right", tint: Theme.positive)
                    }
                    if !summary.mainRisk.isEmpty {
                        labelled("Главный риск", summary.mainRisk, icon: "exclamationmark.triangle.fill", tint: Theme.warning)
                    }
                    if !summary.mainOpportunity.isEmpty {
                        labelled("Главная возможность", summary.mainOpportunity, icon: "lightbulb.fill", tint: Theme.info)
                    }
                    if !summary.extraProfit.isEmpty {
                        labelled("Потенциал прибыли", summary.extraProfit, icon: "plus.circle.fill", tint: Theme.brand)
                    }

                    if !summary.threeActions.isEmpty {
                        Text("Три шага")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.textDim)
                            .padding(.top, Spacing.xs)
                        ForEach(Array(summary.threeActions.enumerated()), id: \.offset) { index, action in
                            HStack(alignment: .top, spacing: Spacing.md) {
                                StepBadge(number: index + 1)
                                Text(action)
                                    .font(.system(size: 15, weight: .medium))
                                    .foregroundStyle(Theme.text)
                                    .fixedSize(horizontal: false, vertical: true)
                                    .padding(.top, 5)
                            }
                        }
                    }
                }
            }
        }
    }

    /// Подпись цветом над текстом: по ней пять абзацев различаются с первого
    /// взгляда, не читая каждый.
    private func labelled(_ label: String, _ text: String, icon: String, tint: Color) -> some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            TintedIcon(systemName: icon, tint: tint, size: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(tint)
                Text(text)
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.text)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private func statements(_ title: String, icon: String, items: [CfoStatement]) -> some View {
        if !items.isEmpty {
            OwnerSection(title) {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    ForEach(items) { item in
                        InsightRow(
                            leading: { TintedIcon(systemName: icon, tint: item.isFact ? Theme.brand : Theme.textDim, size: 36) },
                            title: item.text,
                            note: item.status.isEmpty ? nil : item.status,
                            noteTint: item.isFact ? Theme.brand : Theme.textDim,
                            wraps: true
                        )
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func moneyLines(_ title: String, icon: String, items: [CfoMoneyLine], tint: Color) -> some View {
        if !items.isEmpty {
            OwnerSection(title) {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    ForEach(items) { item in
                        InsightRow(
                            leading: { TintedIcon(systemName: icon, tint: tint, size: 36) },
                            title: item.text,
                            value: item.amount.isEmpty ? nil : item.amount,
                            valueTint: tint,
                            note: item.status.isEmpty ? nil : item.status,
                            wraps: true
                        )
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func opportunities(_ items: [CfoOpportunity]) -> some View {
        if !items.isEmpty {
            OwnerSection("Возможности") {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    ForEach(items) { item in
                        InsightRow(
                            leading: { TintedIcon(systemName: "lightbulb.fill", tint: Theme.positive, size: 36) },
                            title: item.title,
                            subtitle: item.action.isEmpty ? nil : item.action,
                            value: item.effect.isEmpty ? nil : item.effect,
                            valueTint: Theme.positive,
                            note: item.status.isEmpty ? nil : item.status,
                            wraps: true
                        )
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func scenarios(_ items: [CfoScenario]) -> some View {
        if !items.isEmpty {
            InsightSection("Что если", note: "оценки на допущениях, не обещания") {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    ForEach(items) { item in
                        InsightRow(
                            leading: { TintedIcon(systemName: "arrow.triangle.branch", tint: Theme.info, size: 36) },
                            title: item.name,
                            subtitle: [item.assumption, item.note].filter { !$0.isEmpty }.joined(separator: "\n").nilIfEmpty,
                            value: item.effect,
                            valueTint: Theme.info,
                            wraps: true
                        )
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func healthScore(_ score: CfoHealthScore?) -> some View {
        if let score {
            let tint = InsightPalette.scoreTint(score.score)
            OwnerSection("Оценка бизнеса") {
                Text(score.bandLabel)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(tint)
            } content: {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    ProgressRing(
                        progress: Double(score.score) / 100,
                        label: "\(score.score)",
                        caption: "из 100",
                        color: tint
                    )
                    .frame(maxWidth: .infinity)

                    ForEach(Array(score.breakdown.enumerated()), id: \.offset) { _, part in
                        InsightFactRow(label: part.label, value: "\(part.value)")
                    }

                    if !score.missing.isEmpty {
                        OwnerFootnote(text: "Без данных: \(score.missing.joined(separator: ", "))")
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

        return OwnerSection("Структура затрат") {
            VStack(alignment: .leading, spacing: Spacing.md) {
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
            OwnerSection("Риски") {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    ForEach(items) { risk in
                        let tint = risk.isCritical ? Theme.negative : Theme.warning
                        InsightRow(
                            leading: { TintedIcon(systemName: "exclamationmark.triangle.fill", tint: tint, size: 36) },
                            title: risk.risk,
                            subtitle: "вероятность \(risk.probability.lowercased()) · влияние \(risk.impact.lowercased())",
                            note: risk.isCritical ? "Высокий" : "Умеренный",
                            noteTint: tint,
                            wraps: true
                        )
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func forecast(_ forecast: CfoForecast?) -> some View {
        if let forecast {
            OwnerSection("Прогноз прибыли") {
                Text(forecast.bandLabel)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
            } content: {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    if !forecast.text.isEmpty {
                        Text(forecast.text)
                            .font(.system(size: 15))
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
                        InsightRow(
                            leading: { TintedIcon(systemName: "exclamationmark.triangle", tint: Theme.warning, size: 36) },
                            title: warning,
                            wraps: true
                        )
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func actionPlan(_ plan: CfoActionPlan?) -> some View {
        if let plan, !plan.isEmpty {
            OwnerSection("План действий") {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    planGroup("Сегодня", icon: "bolt.fill", tint: Theme.negative, items: plan.today)
                    planGroup("На неделе", icon: "calendar", tint: Theme.warning, items: plan.week)
                    planGroup("В этом месяце", icon: "calendar.badge.clock", tint: Theme.info, items: plan.month)
                }
            }
        }
    }

    /// Срок — иконкой и цветом: «сегодня» должно бросаться в глаза сильнее,
    /// чем «в этом месяце».
    @ViewBuilder
    private func planGroup(_ title: String, icon: String, tint: Color, items: [String]) -> some View {
        if !items.isEmpty {
            HStack(alignment: .top, spacing: Spacing.md) {
                TintedIcon(systemName: icon, tint: tint, size: 36)
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text(title)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(tint)
                    ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                        HStack(alignment: .top, spacing: Spacing.sm) {
                            Circle()
                                .fill(tint)
                                .frame(width: 5, height: 5)
                                .padding(.top, 7)
                            Text(item)
                                .font(.system(size: 15))
                                .foregroundStyle(Theme.text)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    @ViewBuilder
    private func companies(_ rows: [CfoCompanyRow]) -> some View {
        if rows.count > 1 {
            OwnerSection("Точки по прибыли") {
                VStack(spacing: Spacing.md) {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                        InsightRow(
                            leading: { LetterBadge(text: row.name, tint: OwnerTint.point(index)) },
                            title: row.name,
                            subtitle: "выручка \(Money.format(row.revenue)) · маржа \(Percent.format(row.margin))",
                            value: Money.format(row.profit),
                            valueTint: row.profit >= 0 ? Theme.positive : Theme.negative
                        )
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func expenseChanges(_ rows: [CfoExpenseChange]) -> some View {
        if !rows.isEmpty {
            OwnerSection("Что сдвинулось в расходах") {
                VStack(spacing: Spacing.md) {
                    ForEach(rows) { row in
                        let tint = row.delta > 0 ? Theme.negative : Theme.positive
                        InsightRow(
                            leading: {
                                TintedIcon(systemName: OwnerAnalyticsScreen.expenseIcon(row.label), tint: tint, size: 40)
                            },
                            title: row.label,
                            subtitle: "\(Money.format(row.previous)) → \(Money.format(row.current))",
                            value: Money.signed(row.delta),
                            valueTint: tint
                        )
                    }
                }
            }
        }
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
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
    private(set) var reportPeriod: AnalyticsPeriod?

    private let service: InsightService

    init(api: APIClient) { service = InsightService(api: api) }

    func generate(days: AnalyticsPeriod) async {
        guard !isGenerating else { return }
        isGenerating = true
        defer { isGenerating = false }
        do {
            let bounds = days.bounds()
            report = try await service.expenseAnalysis(from: bounds.from, to: bounds.to)
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
    @State private var period: AnalyticsPeriod = .last90Days

    var body: some View {
        ScreenScroll {
            if let store {
                VStack(spacing: Spacing.lg) {
                    PeriodBar(selection: $period, quick: [.last7Days, .last30Days, .last90Days, .thisYear])

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
            hero(report, categories: categories, store: store)

            RerunButton(title: store.reportPeriod == period ? "Пересчитать" : "Разобрать за \(period.title.lowercased())") {
                Task { await store.generate(days: period) }
            }

            if !report.summary.isEmpty {
                AiSummaryCard(text: report.summary)
            }

            if categories.isEmpty {
                WideEmptyState(
                    icon: "tray",
                    title: "Расходов за период нет",
                    message: "Внесите траты в журнал — тогда будет что разбирать."
                )
            } else {
                SplitDashboard {
                    AiInsightList(items: report.insights)
                    breakdown(categories, total: report.total)
                } side: {
                    spikes(categories)
                }
            }
        }
    }

    /// Сумма расходов крупно. Рост трат — плохая новость, поэтому карточка
    /// красная, когда расходы выросли, и зелёная, когда снизились.
    private func hero(_ report: ExpenseAnalysisReport, categories: [ExpenseAnalysisCategory], store: ExpenseAnalysisStore) -> some View {
        let spikes = categories.filter(\.isSpike).count
        return HeroSummary(
            title: "Расходы за \((store.reportPeriod ?? period).title.lowercased())",
            value: Money.format(report.total),
            caption: "\(Percent.format(report.totalChangePct, signed: true)) к прошлому такому же периоду",
            footer: [
                ("Категорий", "\(categories.count)"),
                ("Резко выросло", "\(spikes)"),
                ("Крупнейшая", categories.max(by: { $0.amount < $1.amount })?.category ?? "—"),
            ],
            colors: report.totalChangePct > 0 ? InsightPalette.red : InsightPalette.green
        )
    }

    /// Кольцо и строки одних цветов: пять крупных категорий своими, прочее —
    /// серым. Легенда кольца не нужна — строки под ним и есть легенда.
    private func breakdown(_ categories: [ExpenseAnalysisCategory], total: Double) -> some View {
        var slices = categories.prefix(5).enumerated().map { index, category in
            ShareSlice(id: category.id, label: category.category, value: category.amount, color: OwnerTint.point(index))
        }
        let rest = categories.dropFirst(5).reduce(0) { $0 + $1.amount }
        if rest > 0 { slices.append(ShareSlice(id: "__rest", label: "Прочее", value: rest, color: SharePalette.other)) }

        return InsightSection("Все категории", note: "доля и изменение к прошлому периоду") {
            DonutChart(slices: slices, centerTitle: "Всего", centerValue: Money.format(total), showsLegend: false)

            VStack(spacing: Spacing.md) {
                ForEach(Array(categories.enumerated()), id: \.element.id) { index, category in
                    let tint = index < 5 ? OwnerTint.point(index) : SharePalette.other
                    AmountRow(
                        leading: {
                            TintedIcon(systemName: OwnerAnalyticsScreen.expenseIcon(category.category), tint: tint, size: 40)
                        },
                        title: category.category,
                        subtitle: Percent.format(category.sharePct) + (category.isSpike ? " · резкий рост" : ""),
                        amount: Money.format(category.amount),
                        change: category.changePct,
                        higherIsBetter: false,
                        share: category.sharePct / 100,
                        tint: tint
                    )
                }
            }
        }
    }

    @ViewBuilder
    private func spikes(_ categories: [ExpenseAnalysisCategory]) -> some View {
        let spikes = categories.filter(\.isSpike)

        if !spikes.isEmpty {
            InsightSection("Резко выросло", note: "проверить в первую очередь") {
                VStack(spacing: Spacing.md) {
                    ForEach(spikes.prefix(6)) { category in
                        InsightRow(
                            leading: { TintedIcon(systemName: "arrow.up.right", tint: Theme.negative, size: 40) },
                            title: category.category,
                            subtitle: "\(Money.format(category.previous)) → \(Money.format(category.amount))",
                            value: Percent.format(category.changePct, signed: true),
                            valueTint: Theme.negative
                        )
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

    func generate(days: AnalyticsPeriod) async {
        guard !isGenerating else { return }
        isGenerating = true
        defer { isGenerating = false }
        do {
            let bounds = days.bounds()
            report = try await service.teamAnalysis(from: bounds.from, to: bounds.to)
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
    @State private var period: AnalyticsPeriod = .last30Days

    var body: some View {
        ScreenScroll {
            if let store {
                VStack(spacing: Spacing.lg) {
                    PeriodBar(selection: $period, quick: [.last7Days, .last30Days, .last90Days, .thisYear])

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
                RerunButton(title: "Пересчитать") { Task { await store.generate(days: period) } }
            }
        } else {
            VStack(spacing: Spacing.lg) {
                totals(report.aggregates, store: store)

                if !report.summary.isEmpty {
                    AiSummaryCard(text: report.summary)
                }

                SplitDashboard {
                    AiInsightList(items: report.insights)
                    roster(report.operators)
                } side: {
                    fairness(report.aggregates)
                    problems(report.operators)
                }
            }
        }
    }

    /// Оборот команды крупно, зарплата и выработка — его расшифровкой.
    private func totals(_ aggregates: TeamAnalysisAggregates, store: TeamAnalysisStore) -> some View {
        VStack(spacing: Spacing.md) {
            HeroSummary(
                title: "Оборот команды",
                value: Money.format(aggregates.totalTurnover),
                // Подпись берём из ответа, а не из переключателя: он мог
                // сдвинуться после того, как разбор уже посчитали.
                caption: rangeLabel(aggregates).isEmpty ? nil : rangeLabel(aggregates),
                footer: [
                    ("К выплате", Money.format(aggregates.totalNet)),
                    ("За смену", Money.format(aggregates.avgRevenuePerShift)),
                    ("Работали", "\(aggregates.activeCount) из \(aggregates.operatorsCount)"),
                ],
                colors: InsightPalette.teal
            )

            RerunButton(title: "Разобрать за \(period.title.lowercased())") {
                Task { await store.generate(days: period) }
            }
        }
    }

    private func rangeLabel(_ aggregates: TeamAnalysisAggregates) -> String {
        guard let from = DateParsing.parseDateOnly(aggregates.dateFrom),
              let to = DateParsing.parseDateOnly(aggregates.dateTo) else { return "" }
        return "\(from.formatted(.dateTime.day().month(.abbreviated))) — \(to.formatted(.dateTime.day().month(.abbreviated)))"
    }

    private func roster(_ operators: [TeamAnalysisOperator]) -> some View {
        let maximum = max(operators.map(\.turnover).max() ?? 1, 1)
        return InsightSection("Операторы", note: "по обороту за период") {
            VStack(spacing: Spacing.md) {
                ForEach(operators) { member in
                    AmountRow(
                        leading: { PersonInitial(name: member.name) },
                        title: member.name,
                        subtitle: "\(member.shifts) \(pluralize(member.shifts, "смена", "смены", "смен")) · \(Money.format(member.revenuePerShift)) за смену · зарплата \(Money.format(member.net))",
                        amount: Money.format(member.turnover),
                        share: member.turnover / maximum,
                        // Штрафы и долги — оранжевой полосой: видно, у кого
                        // смотреть блок ниже, не читая его целиком.
                        tint: member.hasProblems ? Theme.warning : Theme.brand
                    )
                }
            }
        }
    }

    private func fairness(_ aggregates: TeamAnalysisAggregates) -> some View {
        InsightSection("Справедливость оплаты", note: "разрыв между максимальной и минимальной") {
            InsightFactRow(label: "Минимум", value: Money.format(aggregates.salarySpread.minNet))
            InsightFactRow(label: "Максимум", value: Money.format(aggregates.salarySpread.maxNet))
            InsightFactRow(
                label: "Разрыв",
                value: aggregates.salarySpread.ratio > 0 ? "×\(String(format: "%.1f", aggregates.salarySpread.ratio))" : "—",
                tint: aggregates.salarySpread.ratio >= 3 ? Theme.warning : Theme.text
            )

            if let share = aggregates.salaryShare {
                InsightFactRow(
                    label: "Зарплата от оборота",
                    value: Percent.format(share),
                    tint: share > 30 ? Theme.warning : Theme.text
                )
            }
        }
    }

    @ViewBuilder
    private func problems(_ operators: [TeamAnalysisOperator]) -> some View {
        let flagged = operators.filter(\.hasProblems)

        if !flagged.isEmpty {
            OwnerSection("Штрафы и долги") {
                Text("\(flagged.count)")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
            } content: {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    ForEach(flagged) { member in
                        HStack(alignment: .top, spacing: Spacing.md) {
                            PersonInitial(name: member.name)
                            VStack(alignment: .leading, spacing: Spacing.xs) {
                                Text(member.name)
                                    .font(.system(size: 16, weight: .medium))
                                    .foregroundStyle(Theme.text)
                                if member.fine > 0 {
                                    InsightFactRow(label: "Штрафы", value: Money.format(member.fine), tint: Theme.negative)
                                }
                                if member.debt > 0 {
                                    InsightFactRow(label: "Долг", value: Money.format(member.debt), tint: Theme.warning)
                                }
                                if member.remaining > 0 {
                                    InsightFactRow(label: "Не выплачено", value: Money.format(member.remaining))
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
