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
                Picker("Период", selection: $bindable.range) {
                    ForEach(DateRange.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)

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
        .navigationTitle("Отчёты")
        .toolbar { LogoutToolbarItem() }
        .task { if store.report == nil { await store.loadReport() } }
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
            DashboardGrid {
                MetricTile(
                    label: "Выручка",
                    value: Money.compact(totals.totalIncome),
                    change: report.incomeChange,
                    icon: "arrow.down.circle.fill",
                    accent: Theme.brand
                )
                MetricTile(
                    label: "Расходы",
                    value: Money.compact(totals.totalExpense),
                    change: report.expenseChange,
                    icon: "arrow.up.circle.fill",
                    accent: Theme.negative
                )
                MetricTile(
                    label: "Прибыль",
                    value: Money.compact(totals.profit),
                    change: report.profitChange,
                    icon: "chart.line.uptrend.xyaxis",
                    accent: totals.profit >= 0 ? Theme.positive : Theme.negative
                )
                MetricTile(
                    label: "Средний чек",
                    value: Money.compact(totals.avgTransaction),
                    icon: "receipt.fill",
                    accent: Theme.info
                )
            }

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
                                Text(Money.compact(row.amount))
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
