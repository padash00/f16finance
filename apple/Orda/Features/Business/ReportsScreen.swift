import OrdaKit
import OrdaUI
import SwiftUI

/// Сводный отчёт: выручка, прибыль, куда уходят деньги, какая точка тянет.
///
/// Каждый показатель показан вместе с изменением к прошлому периоду такой же
/// длины. Абсолютная цифра сама по себе ничего не говорит: «1,8 млн» — это
/// хорошо или плохо, понятно только в сравнении.
struct ReportsScreen: View {
    @Environment(BusinessStore.self) private var store

    var body: some View {
        @Bindable var bindable = store

        return ScreenScroll {
            VStack(spacing: Spacing.lg) {
                PeriodBar(selection: $bindable.range, showsExtra: true)

                if let error = store.reportError, store.report == nil {
                    ErrorStateView(error: error) { Task { await store.loadReport() } }
                } else if let report = store.report {
                    content(report)
                } else {
                    loadingState
                }
            }
        }
        .background(Theme.background)
        .onChange(of: ExtraCashPreference.shared.includeExtra) { _, _ in Task { await store.loadReport() } }
        .navigationTitle("Отчёты")
        .toolbar { LogoutToolbarItem() }
        .task { await store.loadReport() }
        .refreshable { await store.loadReport() }
    }

    private var loadingState: some View {
        VStack(spacing: Spacing.lg) {
            Skeleton(height: 96, cornerRadius: Radius.lg)
            Skeleton(height: 240, cornerRadius: Radius.lg)
            Skeleton(height: 180, cornerRadius: Radius.lg)
        }
    }

    @ViewBuilder
    private func content(_ report: ReportAggregate) -> some View {
        let totals = report.current

        VStack(spacing: Spacing.lg) {
            HeroSummary(
                title: "Прибыль за период",
                value: Money.format(totals.profit),
                caption: report.profitChange.map { "\(Percent.format($0, signed: true)) к прошлому периоду" },
                footer: [
                    ("Выручка" + (report.incomeChange.map { " · \(Percent.format($0, signed: true))" } ?? ""), Money.format(totals.totalIncome)),
                    ("Расходы" + (report.expenseChange.map { " · \(Percent.format($0, signed: true))" } ?? ""), Money.format(totals.totalExpense)),
                    // Среднее на отчёт смены, а не чек покупателя: сервер делит
                    // выручку на число строк дохода.
                    ("Средняя смена", Money.format(totals.avgTransaction)),
                ],
                colors: totals.profit >= 0
                    ? [Color(hex: 0x059669), Color(hex: 0x0F766E)]
                    : [Color(hex: 0xDC2626), Color(hex: 0x9F1239)]
            )

            trend(report)

            SplitDashboard {
                expenses(report)
            } side: {
                payments(totals)
                companies(report)
            }
        }
    }

    // ── Динамика ─────────────────────────────────────────────────────────────

    private func trend(_ report: ReportAggregate) -> some View {
        // Сервер сам выбирает шаг: по дням для недели, по неделям для квартала.
        // Подписи берём его же — они уже согласованы с шагом.
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

    // ── Расходы ──────────────────────────────────────────────────────────────

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

    // ── Точки ────────────────────────────────────────────────────────────────

    private func companies(_ report: ReportAggregate) -> some View {
        let rows = report.companyIncome

        return Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Выручка по точкам")

                if rows.isEmpty {
                    InlineEmpty(icon: "building.2", text: "Данных по точкам нет", tint: Theme.textDim)
                } else {
                    let maximum = rows.first?.amount ?? 1
                    ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                        if index > 0 { RowDivider() }
                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            HStack {
                                Text(row.name)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.text)
                                    .lineLimit(1)
                                Spacer(minLength: Spacing.sm)
                                Text(Money.format(row.amount))
                                    .font(Typography.callout.weight(.medium))
                                    .monospacedDigit()
                                    .foregroundStyle(Theme.text)
                            }
                            // Доля от лучшей точки — глазу проще сравнить
                            // длину, чем два числа в разных строках.
                            ProportionBar(ratio: maximum > 0 ? row.amount / maximum : 0)
                        }
                    }
                }
            }
        }
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
