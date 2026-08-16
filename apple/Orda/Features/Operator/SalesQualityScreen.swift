import OrdaKit
import OrdaUI
import SwiftUI

/// «Как я работаю» — оценка работы с покупателями за месяц.
///
/// Экран личный: человек видит только себя. Рейтинга команды здесь нет
/// намеренно — сравнение продавцов между собой это разговор управляющего с
/// каждым по отдельности, а не таблица у кассы.
///
/// Показываем словами: статус, что получается, над чем поработать, сколько
/// доплата и что нужно сделать, чтобы она появилась. Коэффициенты модели
/// оставлены на сайте: продавцу нужен предмет разговора, а не формула.
struct SalesQualityScreen: View {
    @Environment(\.api) private var api

    @State private var month = SalesQualityScreen.currentMonth
    @State private var report: SalesQualityMonth?
    @State private var loadError: APIError?
    @State private var isLoading = false

    var body: some View {
        ScreenScroll {
            monthPicker

            if let report, report.available {
                statusCard(report)
                if let bonus = report.bonus { bonusCard(bonus, status: report.status) }
                if !report.strengths.isEmpty || !report.weaknesses.isEmpty { sidesCard(report) }
                explanation
            } else if let loadError {
                ErrorStateView(error: loadError) { Task { await load() } }
            } else if isLoading {
                LoadingRows(count: 3)
            } else if let report {
                WideEmptyState(
                    icon: "cart",
                    title: emptyTitle(reason: report.reason),
                    message: emptyMessage(reason: report.reason)
                )
            }
        }
        .navigationTitle("Как я работаю")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task(id: month) { await load() }
        .refreshable { await load() }
    }

    // ── Части ────────────────────────────────────────────────────────────────

    private var monthPicker: some View {
        HStack(spacing: Spacing.sm) {
            Button {
                month = Self.shift(month, by: -1)
            } label: {
                Image(systemName: "chevron.left")
            }
            .buttonStyle(.pressable)

            Spacer()

            Text(Self.title(for: month))
                .font(Typography.callout.weight(.semibold))
                .foregroundStyle(Theme.text)
                .contentTransition(.numericText())

            Spacer()

            Button {
                month = Self.shift(month, by: 1)
            } label: {
                Image(systemName: "chevron.right")
            }
            .buttonStyle(.pressable)
            // Вперёд дальше текущего месяца ходить некуда: там пусто.
            .disabled(month >= Self.currentMonth)
            .opacity(month >= Self.currentMonth ? 0.35 : 1)
        }
        .padding(.horizontal, Spacing.xs)
    }

    private func statusCard(_ report: SalesQualityMonth) -> some View {
        Card(accent: color(for: report.status)) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                HStack(spacing: Spacing.sm) {
                    Image(systemName: icon(for: report.status))
                        .font(.title2)
                        .foregroundStyle(color(for: report.status))
                    Text(report.statusLabel)
                        .font(Typography.title)
                        .foregroundStyle(Theme.text)
                }

                Text(report.statusMeaning)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.textDim)
                    .fixedSize(horizontal: false, vertical: true)

                RowDivider()

                HStack(spacing: Spacing.xl) {
                    metric("Смен", value: report.shifts)
                    metric("Чеков", value: report.receipts)
                }
            }
        }
    }

    private func metric(_ title: String, value: Int) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xxs) {
            Text(title.uppercased())
                .font(Typography.caption)
                .foregroundStyle(Theme.textMuted)
            Text("\(value)")
                .font(Typography.metric)
                .foregroundStyle(Theme.text)
        }
    }

    private func bonusCard(_ bonus: SalesQualityMonth.Bonus, status: String) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Доплата за качество", subtitle: "За работу с покупателями, сверх зарплаты")

                HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                    Text(Money.format(bonus.amount))
                        .font(Typography.hero)
                        .foregroundStyle(bonus.amount > 0 ? Theme.positive : Theme.textDim)

                    if bonus.amount > 0 {
                        Text(bonus.paid ? "выплачена" : "в расчёте")
                            .font(Typography.caption.weight(.medium))
                            .foregroundStyle(bonus.paid ? Theme.positive : Theme.warning)
                            .padding(.horizontal, Spacing.sm)
                            .padding(.vertical, 3)
                            .background(
                                (bonus.paid ? Theme.positive : Theme.warning).opacity(0.14),
                                in: Capsule()
                            )
                    }
                }

                if let next = bonus.nextStep {
                    Text(next)
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textDim)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if bonus.strong > 0 || bonus.top > 0 {
                    RowDivider()
                    VStack(spacing: Spacing.xs) {
                        thresholdRow("Сильный", amount: bonus.strong, reached: status == "STRONG" || status == "TOP")
                        thresholdRow("Топ", amount: bonus.top, reached: status == "TOP")
                    }
                }
            }
        }
    }

    private func thresholdRow(_ title: String, amount: Double, reached: Bool) -> some View {
        HStack {
            Image(systemName: reached ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(reached ? Theme.positive : Theme.textMuted)
            Text(title)
                .font(Typography.callout)
                .foregroundStyle(Theme.textDim)
            Spacer()
            Text(Money.format(amount))
                .font(Typography.callout.weight(.medium))
                .foregroundStyle(Theme.text)
        }
    }

    private func sidesCard(_ report: SalesQualityMonth) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                if !report.strengths.isEmpty {
                    sideList("Получается", items: report.strengths, icon: "arrow.up.right", color: Theme.positive)
                }
                if !report.strengths.isEmpty && !report.weaknesses.isEmpty { RowDivider() }
                if !report.weaknesses.isEmpty {
                    sideList("Над чем поработать", items: report.weaknesses, icon: "arrow.down.right", color: Theme.warning)
                }
            }
        }
    }

    private func sideList(_ title: String, items: [String], icon: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text(title.uppercased())
                .font(Typography.caption)
                .foregroundStyle(Theme.textMuted)
            ForEach(items, id: \.self) { item in
                HStack(spacing: Spacing.sm) {
                    Image(systemName: icon)
                        .font(.caption.weight(.bold))
                        .foregroundStyle(color)
                        .frame(width: 18)
                    Text(item)
                        .font(Typography.callout)
                        .foregroundStyle(Theme.text)
                }
            }
        }
    }

    private var explanation: some View {
        Text(
            "Оценка считается по вашим сменам и сравнивается с обычным для точки — "
                + "с поправкой на день недели, погоду и загрузку. Слабый день сам по себе "
                + "оценку не портит."
        )
        .font(Typography.caption)
        .foregroundStyle(Theme.textMuted)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, Spacing.xs)
    }

    // ── Данные ───────────────────────────────────────────────────────────────

    private func load() async {
        isLoading = report == nil
        loadError = nil
        do {
            report = try await SalesQualityService(api: api).myMonth(month: month)
        } catch let error as APIError {
            loadError = error
        } catch {
            loadError = .transport(message: error.localizedDescription)
        }
        isLoading = false
    }

    private func emptyTitle(reason: String?) -> String {
        reason == "no-shifts" ? "Смен в этом месяце нет" : "Продаж в этом месяце нет"
    }

    private func emptyMessage(reason: String?) -> String {
        reason == "no-shifts"
            ? "Оценка появится после первых смен за прилавком."
            : "Экран считает работу за прилавком магазина. В этом месяце продаж под вашим именем не было."
    }

    private func color(for status: String) -> Color {
        switch status {
        case "TOP": return Theme.positive
        case "STRONG": return Theme.brand
        case "NEEDS_TRAINING": return Theme.warning
        default: return Theme.info
        }
    }

    private func icon(for status: String) -> String {
        switch status {
        case "TOP": return "star.fill"
        case "STRONG": return "hand.thumbsup.fill"
        case "NEEDS_TRAINING": return "exclamationmark.triangle.fill"
        case "INSUFFICIENT_DATA": return "hourglass"
        default: return "equal.circle.fill"
        }
    }

    // ── Месяц ────────────────────────────────────────────────────────────────

    private static var currentMonth: String {
        let now = Calendar.current.dateComponents([.year, .month], from: Date())
        return String(format: "%04d-%02d", now.year ?? 1970, now.month ?? 1)
    }

    private static func shift(_ month: String, by delta: Int) -> String {
        let parts = month.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 2 else { return month }
        var components = DateComponents()
        components.year = parts[0]
        components.month = parts[1]
        guard let date = Calendar.current.date(from: components),
              let moved = Calendar.current.date(byAdding: .month, value: delta, to: date)
        else { return month }
        let next = Calendar.current.dateComponents([.year, .month], from: moved)
        return String(format: "%04d-%02d", next.year ?? 1970, next.month ?? 1)
    }

    private static func title(for month: String) -> String {
        let parts = month.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 2 else { return month }
        var components = DateComponents()
        components.year = parts[0]
        components.month = parts[1]
        guard let date = Calendar.current.date(from: components) else { return month }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ru_RU")
        formatter.dateFormat = "LLLL yyyy"
        return formatter.string(from: date).capitalized
    }
}
