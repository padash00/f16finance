import OrdaKit
import OrdaUI
import SwiftUI

/// ОПиУ и EBITDA по месяцам.
///
/// Отличается от «Отчётов» тем, что показывает не оборот, а прибыль по всей
/// цепочке — от выручки до чистой. Владельцу это нужно для разговора с
/// инвестором и банком, где оборот значения не имеет.
///
/// Все величины приходят с сервера посчитанными: формула одна на сайт и
/// приложение, иначе EBITDA в двух местах разошлась бы.
struct PnlScreen: View {
    @Environment(BusinessStore.self) private var store

    @State private var selected: MonthlyPnl?

    var body: some View {
        ScreenScroll {
            VStack(spacing: Spacing.lg) {
                if let error = store.pnlError, store.pnl == nil {
                    ErrorStateView(error: error) { Task { await store.loadPnl() } }
                } else if let report = store.pnl {
                    content(report)
                } else {
                    VStack(spacing: Spacing.lg) {
                        Skeleton(height: 96, cornerRadius: Radius.lg)
                        Skeleton(height: 240, cornerRadius: Radius.lg)
                        Skeleton(height: 200, cornerRadius: Radius.lg)
                    }
                }
            }
        }
        .background(Theme.background)
        .navigationTitle("ОПиУ и EBITDA")
        .toolbar { LogoutToolbarItem() }
        .task { if store.pnl == nil { await store.loadPnl() } }
        .refreshable { await store.loadPnl() }
    }

    @ViewBuilder
    private func content(_ report: PnlReport) -> some View {
        // Месяцы без выручки и без расходов скрываем: это будущее или
        // period до начала работы, и нули в таблице только мешают.
        let months = report.months.filter { $0.revenue != 0 || $0.netProfit != 0 }

        if months.isEmpty {
            WideEmptyState(
                icon: "chart.pie",
                title: "Данных пока нет",
                message: "ОПиУ появится, когда в журналах будут доходы и расходы."
            )
        } else {
            let totals = report.totals

            VStack(spacing: Spacing.lg) {
                DashboardGrid {
                    MetricTile(
                        label: "Выручка за период",
                        value: Money.compact(totals.revenue),
                        icon: "arrow.down.circle.fill",
                        accent: Theme.brand
                    )
                    MetricTile(
                        label: "EBITDA",
                        value: Money.compact(totals.ebitda),
                        icon: "chart.line.uptrend.xyaxis",
                        accent: totals.ebitda >= 0 ? Theme.positive : Theme.negative
                    )
                    MetricTile(
                        label: "Маржа EBITDA",
                        value: Percent.format(totals.ebitdaMargin),
                        icon: "percent",
                        accent: Theme.info
                    )
                    MetricTile(
                        label: "Чистая прибыль",
                        value: Money.compact(totals.netProfit),
                        icon: "banknote.fill",
                        accent: totals.netProfit >= 0 ? Theme.positive : Theme.negative
                    )
                }

                trend(months)

                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        SectionHeader("По месяцам", subtitle: "нажмите месяц, чтобы раскрыть")

                        ForEach(Array(months.enumerated()), id: \.element.id) { index, month in
                            if index > 0 { RowDivider() }
                            Button {
                                // Повторное нажатие сворачивает: раскрытая
                                // строка — это состояние, а не переход.
                                selected = selected?.id == month.id ? nil : month
                            } label: {
                                MonthRow(month: month, isExpanded: selected?.id == month.id)
                            }
                            .buttonStyle(.plain)

                            if selected?.id == month.id {
                                MonthBreakdown(month: month)
                            }
                        }
                    }
                }
            }
        }
    }

    private func trend(_ months: [MonthlyPnl]) -> some View {
        let points = months.compactMap { month -> TimePoint? in
            guard let date = month.date else { return nil }
            return TimePoint(label: month.label, date: date, value: month.ebitda)
        }

        return Group {
            if points.count > 1 {
                TrendChart(
                    title: "EBITDA по месяцам",
                    subtitle: "прибыль до износа, процентов и налогов",
                    points: points,
                    color: ChartPalette.series2
                )
            }
        }
    }
}

/// Строка месяца: выручка, EBITDA, маржа.
private struct MonthRow: View {
    let month: MonthlyPnl
    let isExpanded: Bool

    var body: some View {
        HStack(spacing: Spacing.md) {
            Image(systemName: "chevron.right")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Theme.textDim)
                .rotationEffect(.degrees(isExpanded ? 90 : 0))
                .animation(Motion.value, value: isExpanded)

            Text(month.label)
                .font(Typography.callout)
                .foregroundStyle(Theme.text)

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 1) {
                Text(Money.compact(month.ebitda))
                    .font(Typography.callout.weight(.medium))
                    .monospacedDigit()
                    .foregroundStyle(month.ebitda >= 0 ? Theme.text : Theme.negative)
                Text("\(Percent.format(month.ebitdaMargin)) от \(Money.compact(month.revenue))")
                    .font(Typography.caption)
                    .monospacedDigit()
                    .foregroundStyle(Theme.textDim)
            }
        }
        .padding(.vertical, Spacing.xs)
        .contentShape(Rectangle())
    }
}

/// Раскрытая цепочка от выручки до чистой прибыли.
///
/// Порядок строк — это и есть отчёт: каждая следующая величина получается
/// вычитанием предыдущей строки. Переставлять их нельзя.
private struct MonthBreakdown: View {
    let month: MonthlyPnl

    var body: some View {
        VStack(spacing: Spacing.sm) {
            StatRow("Выручка", value: Money.format(month.revenue), icon: "arrow.down")
            if month.cogs > 0 {
                StatRow("Себестоимость", value: Money.signed(-month.cogs), valueColor: Theme.negative)
            }
            StatRow("Валовая прибыль", value: Money.format(month.grossProfit), emphasized: true)

            if month.operatingExpenses > 0 {
                StatRow("Операционные", value: Money.signed(-month.operatingExpenses), valueColor: Theme.negative)
            }
            if month.posCommission > 0 {
                StatRow("Комиссии эквайринга", value: Money.signed(-month.posCommission), valueColor: Theme.negative)
            }
            if month.payroll > 0 {
                StatRow("Фонд оплаты труда", value: Money.signed(-month.payroll), valueColor: Theme.negative)
            }
            if month.payrollTaxes > 0 {
                StatRow("Налоги с ФОТ", value: Money.signed(-month.payrollTaxes), valueColor: Theme.negative)
            }
            if month.otherOperating > 0 {
                StatRow("Прочие операционные", value: Money.signed(-month.otherOperating), valueColor: Theme.negative)
            }

            StatRow(
                "EBITDA",
                value: Money.format(month.ebitda),
                valueColor: month.ebitda >= 0 ? Theme.positive : Theme.negative,
                emphasized: true
            )

            if month.depreciation > 0 {
                StatRow("Износ", value: Money.signed(-month.depreciation), valueColor: Theme.negative)
            }
            if month.amortization > 0 {
                StatRow("Амортизация", value: Money.signed(-month.amortization), valueColor: Theme.negative)
            }
            if month.depreciation > 0 || month.amortization > 0 {
                StatRow("Операционная прибыль", value: Money.format(month.operatingProfit), emphasized: true)
            }

            if month.financialExpenses > 0 {
                StatRow("Финансовые расходы", value: Money.signed(-month.financialExpenses), valueColor: Theme.negative)
            }
            if month.incomeTax > 0 {
                StatRow("Налог на прибыль", value: Money.signed(-month.incomeTax), valueColor: Theme.negative)
            }
            if month.nonOperating > 0 {
                StatRow("Неоперационные", value: Money.signed(-month.nonOperating), valueColor: Theme.negative)
            }

            StatRow(
                "Чистая прибыль",
                value: Money.format(month.netProfit),
                valueColor: month.netProfit >= 0 ? Theme.positive : Theme.negative,
                emphasized: true
            )

            // CAPEX и дивиденды в отчёт не входят: первое — вложение,
            // второе происходит уже после чистой прибыли. Но владельцу
            // важно видеть, что деньги ушли и туда.
            if month.capex > 0 || month.profitDistribution > 0 {
                RowDivider()
                Text("Вне отчёта")
                    .font(Typography.label)
                    .foregroundStyle(Theme.textDim)
                    .textCase(.uppercase)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if month.capex > 0 {
                    StatRow("Вложения (CAPEX)", value: Money.format(month.capex), icon: "hammer")
                }
                if month.profitDistribution > 0 {
                    StatRow("Распределение прибыли", value: Money.format(month.profitDistribution), icon: "arrow.up.forward")
                }
            }
        }
        .padding(Spacing.md)
        .background(Theme.surfaceRaised)
        .clipShape(RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
    }
}
