import OrdaKit
import OrdaUI
import SwiftUI

/// ОПиУ и EBITDA по месяцам.
///
/// Отличается от «Отчётов» тем, что показывает не оборот, а прибыль по всей
/// цепочке — от выручки до чистой. Владельцу это нужно для разговора с
/// инвестором и банком, где оборот значения не имеет.
///
/// Отчёт развёрнут в две стороны. Вниз — цепочка строк: каждая следующая
/// величина получается вычитанием предыдущей, и порядок здесь не оформление, а
/// сам отчёт. Вбок — доля каждой строки в выручке: «ФОТ 480 000 ₸» ничего не
/// говорит, пока не видно, что это 26 % выручки, и что в прошлом месяце было
/// 19 %.
///
/// Все величины приходят с сервера посчитанными: формула одна на сайт и
/// приложение, иначе EBITDA в двух местах разошлась бы. Суммы за период
/// складываются здесь — период выбирает владелец, сервер отдаёт месяцы.
struct PnlScreen: View {
    @Environment(BusinessStore.self) private var store
    @Environment(\.access) private var access

    @State private var selected: MonthlyPnl?
    /// Месяц, который правим. Не флаг: лист должен знать, за какой именно
    /// месяц загружать строку.
    @State private var editingMonth: EditingMonth?

    /// Право `profitability.edit` проверяет и сервер.
    private var canEdit: Bool {
        access?.can("profitability.edit") ?? false
    }

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
        .task { await store.loadPnl() }
        .refreshable { await store.loadPnl() }
        .sheet(item: $editingMonth) { target in
            ProfitabilityInputSheet(month: target.id)
                // Сохранённые вводы меняют EBITDA — пересчитываем сразу,
                // иначе владелец увидит прежнюю цифру и решит, что не
                // сохранилось.
                .onDisappear { Task { await store.loadPnl() } }
        }
    }

    @ViewBuilder
    private func content(_ report: PnlReport) -> some View {
        // Месяцы без выручки и без расходов скрываем: это будущее или
        // период до начала работы, и нули в таблице только мешают.
        let months = report.months.filter { $0.revenue != 0 || $0.netProfit != 0 }

        if months.isEmpty {
            WideEmptyState(
                icon: "chart.pie",
                title: "Данных пока нет",
                message: "ОПиУ появится, когда в журналах будут доходы и расходы."
            )
        } else {
            let totals = PnlReport(months: months).totals

            VStack(spacing: Spacing.lg) {
                tiles(totals)
                payrollNotice(months)
                periodReport(totals, months: months)
                revenueSplit(totals)
                trend(months)
                monthList(months)
            }
        }
    }

    // ── Верхние показатели ───────────────────────────────────────────────────

    private func tiles(_ totals: PnlTotals) -> some View {
        DashboardGrid {
            MetricTile(
                label: "Выручка за период",
                value: Money.format(totals.revenue),
                icon: "arrow.down.circle.fill",
                accent: Theme.brand
            )
            MetricTile(
                label: "Валовая прибыль",
                value: Money.format(totals.grossProfit),
                icon: "chart.bar.fill",
                accent: Theme.info
            )
            MetricTile(
                label: "EBITDA",
                value: Money.format(totals.ebitda),
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
                value: Money.format(totals.netProfit),
                icon: "banknote.fill",
                accent: totals.netProfit >= 0 ? Theme.positive : Theme.negative
            )
            MetricTile(
                label: "Чистая маржа",
                value: Percent.format(totals.netMargin),
                icon: "percent",
                accent: totals.netProfit >= 0 ? Theme.positive : Theme.negative
            )
        }
    }

    /// Предупреждение о незаполненном ФОТ.
    ///
    /// Зарплата не выводится из журнала расходов — её задают руками. Пока не
    /// задали, EBITDA завышена ровно на фонд оплаты труда, а выглядит она при
    /// этом совершенно обычно. Молчать об этом нельзя: на такую цифру смотрят
    /// в разговоре с банком.
    @ViewBuilder
    private func payrollNotice(_ months: [MonthlyPnl]) -> some View {
        let empty = months.filter { !$0.hasManualPayroll }
        if !empty.isEmpty {
            Card(accent: Theme.warning) {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    Label("EBITDA завышена", systemImage: "exclamationmark.triangle")
                        .font(Typography.callout.weight(.semibold))
                        .foregroundStyle(Theme.warning)
                    Text(noticeText(empty))
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textMuted)
                    if canEdit, let first = empty.first {
                        Button("Заполнить за \(first.label)") {
                            editingMonth = EditingMonth(first.month)
                        }
                        .buttonStyle(SecondaryButtonStyle())
                    }
                }
            }
        }
    }

    private func noticeText(_ empty: [MonthlyPnl]) -> String {
        let names = empty.prefix(3).map(\.label).joined(separator: ", ")
        let tail = empty.count > 3 ? " и ещё \(empty.count - 3)" : ""
        return "Фонд оплаты труда и налоги с него задаются вручную — из журнала расходов они не выводятся. Не заполнены: \(names)\(tail). Пока их нет, EBITDA и чистая прибыль за эти месяцы выше настоящих."
    }

    // ── Отчёт за период ──────────────────────────────────────────────────────

    /// Та же цепочка, что у месяца, но сложенная за весь период.
    ///
    /// Раньше period показывался четырьмя плитками, а сам отчёт — только внутри
    /// раскрытого месяца. Чтобы увидеть годовые расходы на ФОТ, приходилось
    /// открывать двенадцать месяцев подряд и складывать в уме.
    private func periodReport(_ totals: PnlTotals, months: [MonthlyPnl]) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                SectionHeader(
                    "Отчёт за период",
                    subtitle: "\(months.count) \(pluralize(months.count, "месяц", "месяца", "месяцев")) · доля от выручки"
                )

                PnlRow("Выручка", amount: totals.revenue, share: 100, icon: "arrow.down")
                if totals.cogs > 0 {
                    PnlRow("Себестоимость", amount: -totals.cogs, share: totals.share(totals.cogs))
                }
                PnlRow("Валовая прибыль", amount: totals.grossProfit, share: totals.grossMargin, emphasized: true)

                RowDivider()

                if totals.operatingExpenses > 0 {
                    PnlRow("Операционные", amount: -totals.operatingExpenses, share: totals.share(totals.operatingExpenses))
                }
                if totals.posCommission > 0 {
                    PnlRow("Комиссии эквайринга", amount: -totals.posCommission, share: totals.share(totals.posCommission))
                }
                if totals.payroll > 0 {
                    PnlRow("Фонд оплаты труда", amount: -totals.payroll, share: totals.share(totals.payroll))
                }
                if totals.payrollTaxes > 0 {
                    PnlRow("Налоги с ФОТ", amount: -totals.payrollTaxes, share: totals.share(totals.payrollTaxes))
                }
                if totals.otherOperating > 0 {
                    PnlRow("Прочие операционные", amount: -totals.otherOperating, share: totals.share(totals.otherOperating))
                }

                PnlRow("EBITDA", amount: totals.ebitda, share: totals.ebitdaMargin, emphasized: true)

                if totals.depreciation > 0 || totals.amortization > 0 {
                    RowDivider()
                    if totals.depreciation > 0 {
                        PnlRow("Износ", amount: -totals.depreciation, share: totals.share(totals.depreciation))
                    }
                    if totals.amortization > 0 {
                        PnlRow("Амортизация", amount: -totals.amortization, share: totals.share(totals.amortization))
                    }
                    PnlRow("Операционная прибыль", amount: totals.operatingProfit, share: totals.share(totals.operatingProfit), emphasized: true)
                }

                if totals.financialExpenses > 0 {
                    PnlRow("Финансовые расходы", amount: -totals.financialExpenses, share: totals.share(totals.financialExpenses))
                }
                if totals.incomeTax > 0 {
                    PnlRow("Налог на прибыль", amount: -totals.incomeTax, share: totals.share(totals.incomeTax))
                }
                if totals.nonOperating > 0 {
                    PnlRow("Неоперационные", amount: -totals.nonOperating, share: totals.share(totals.nonOperating))
                }

                PnlRow("Чистая прибыль", amount: totals.netProfit, share: totals.netMargin, emphasized: true)

                // CAPEX и дивиденды в отчёт не входят: первое — вложение,
                // второе происходит уже после чистой прибыли. Но владельцу
                // важно видеть, что деньги ушли и туда.
                if totals.capex > 0 || totals.profitDistribution > 0 {
                    RowDivider()
                    Text("Вне отчёта")
                        .font(Typography.label)
                        .foregroundStyle(Theme.textDim)
                        .textCase(.uppercase)
                    if totals.capex > 0 {
                        PnlRow("Вложения (CAPEX)", amount: totals.capex, share: totals.share(totals.capex), icon: "hammer")
                    }
                    if totals.profitDistribution > 0 {
                        PnlRow("Распределение прибыли", amount: totals.profitDistribution, share: totals.share(totals.profitDistribution), icon: "arrow.up.forward")
                    }
                }
            }
        }
    }

    /// Чем платят.
    ///
    /// Доля наличных — это не любопытство: от неё зависит и комиссия
    /// эквайринга, и то, сколько денег физически лежит в кассе к инкассации.
    @ViewBuilder
    private func revenueSplit(_ totals: PnlTotals) -> some View {
        if totals.cashRevenue > 0 || totals.cashlessRevenue > 0 {
            Card {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    SectionHeader("Чем платили", subtitle: "за весь период")
                    PnlRow("Наличными", amount: totals.cashRevenue, share: totals.share(totals.cashRevenue), icon: "banknote")
                    PnlRow("Безналично", amount: totals.cashlessRevenue, share: totals.share(totals.cashlessRevenue), icon: "creditcard")
                }
            }
        }
    }

    // ── Месяцы ───────────────────────────────────────────────────────────────

    private func monthList(_ months: [MonthlyPnl]) -> some View {
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
                        MonthRow(
                            month: month,
                            previous: index > 0 ? months[index - 1] : nil,
                            isExpanded: selected?.id == month.id
                        )
                    }
                    .buttonStyle(.pressable)

                    if selected?.id == month.id {
                        MonthBreakdown(month: month)

                        // ФОТ, налоги, амортизация и комиссии банка ни
                        // из чего не выводятся — их задают руками. Без
                        // них EBITDA считается по неполной картине, и
                        // отправлять за этим на сайт означает, что
                        // цифре в приложении нельзя верить.
                        if canEdit {
                            Button("Заполнить ФОТ, налоги и эквайринг") {
                                editingMonth = EditingMonth(month.month)
                            }
                            .buttonStyle(SecondaryButtonStyle())
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

/// Строка отчёта: название, сумма и доля в выручке.
///
/// Доля стоит под суммой, а не отдельной колонкой: на телефоне три колонки
/// сжимают названия статей до многоточия, и отчёт перестаёт читаться.
private struct PnlRow: View {
    private let label: String
    private let amount: Double
    private let share: Double?
    private let icon: String?
    private let isEmphasized: Bool

    init(
        _ label: String,
        amount: Double,
        share: Double?,
        icon: String? = nil,
        emphasized: Bool = false
    ) {
        self.label = label
        self.amount = amount
        self.share = share
        self.icon = icon
        self.isEmphasized = emphasized
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
            if let icon {
                Image(systemName: icon)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
                    .frame(width: 18)
            }
            Text(label)
                .font(isEmphasized ? Typography.callout.weight(.semibold) : Typography.callout)
                .foregroundStyle(isEmphasized ? Theme.text : Theme.textMuted)

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 1) {
                Text(amount < 0 ? Money.signed(amount) : Money.format(amount))
                    .font(isEmphasized ? Typography.headline : Typography.callout.weight(.medium))
                    .monospacedDigit()
                    .foregroundStyle(valueColor)
                if let share {
                    Text(Percent.format(share))
                        .font(Typography.caption)
                        .monospacedDigit()
                        .foregroundStyle(Theme.textDim)
                }
            }
        }
        .padding(.vertical, 1)
    }

    /// Красным — только расходы и убыток. Итоговые строки красим по знаку,
    /// промежуточные оставляем спокойными: если покрасить всё, глаз перестаёт
    /// различать, где действительно плохо.
    private var valueColor: Color {
        if amount < 0 { return Theme.negative }
        if isEmphasized { return Theme.positive }
        return Theme.text
    }
}

/// Строка месяца: EBITDA, маржа и изменение к прошлому месяцу.
private struct MonthRow: View {
    let month: MonthlyPnl
    let previous: MonthlyPnl?
    let isExpanded: Bool

    var body: some View {
        HStack(spacing: Spacing.md) {
            Image(systemName: "chevron.right")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Theme.textDim)
                .rotationEffect(.degrees(isExpanded ? 90 : 0))
                .animation(Motion.value, value: isExpanded)

            VStack(alignment: .leading, spacing: 1) {
                Text(month.label)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                // Изменение к прошлому месяцу: сама по себе EBITDA ничего не
                // говорит, пока не видно, куда она движется.
                if let change {
                    Text("\(Percent.format(change, signed: true)) к прошлому месяцу")
                        .font(Typography.caption)
                        .monospacedDigit()
                        .foregroundStyle(change >= 0 ? Theme.positive : Theme.negative)
                }
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 1) {
                Text(Money.format(month.ebitda))
                    .font(Typography.callout.weight(.medium))
                    .monospacedDigit()
                    .foregroundStyle(month.ebitda >= 0 ? Theme.text : Theme.negative)
                Text("\(Percent.format(month.ebitdaMargin)) от \(Money.format(month.revenue))")
                    .font(Typography.caption)
                    .monospacedDigit()
                    .foregroundStyle(Theme.textDim)
            }
        }
        .padding(.vertical, Spacing.xs)
        .contentShape(Rectangle())
    }

    private var change: Double? {
        guard let previous else { return nil }
        return Percent.change(current: month.ebitda, previous: previous.ebitda)
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
            PnlRow("Выручка", amount: month.revenue, share: month.revenue > 0 ? 100 : nil, icon: "arrow.down")
            if month.cashRevenue > 0 || month.cashlessRevenue > 0 {
                PnlRow("· наличными", amount: month.cashRevenue, share: month.share(month.cashRevenue))
                PnlRow("· безналично", amount: month.cashlessRevenue, share: month.share(month.cashlessRevenue))
            }
            if month.cogs > 0 {
                PnlRow("Себестоимость", amount: -month.cogs, share: month.share(month.cogs))
            }
            PnlRow("Валовая прибыль", amount: month.grossProfit, share: month.share(month.grossProfit), emphasized: true)

            if month.operatingExpenses > 0 {
                PnlRow("Операционные", amount: -month.operatingExpenses, share: month.share(month.operatingExpenses))
            }
            if month.posCommission > 0 {
                PnlRow("Комиссии эквайринга", amount: -month.posCommission, share: month.share(month.posCommission))
            }
            if month.payroll > 0 {
                PnlRow("Фонд оплаты труда", amount: -month.payroll, share: month.share(month.payroll))
            }
            if month.payrollTaxes > 0 {
                PnlRow("Налоги с ФОТ", amount: -month.payrollTaxes, share: month.share(month.payrollTaxes))
            }
            if month.otherOperating > 0 {
                PnlRow("Прочие операционные", amount: -month.otherOperating, share: month.share(month.otherOperating))
            }

            PnlRow("EBITDA", amount: month.ebitda, share: month.ebitdaMargin, emphasized: true)

            if !month.hasManualPayroll {
                Text("ФОТ за этот месяц не заполнен — EBITDA выше настоящей.")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.warning)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            if month.depreciation > 0 {
                PnlRow("Износ", amount: -month.depreciation, share: month.share(month.depreciation))
            }
            if month.amortization > 0 {
                PnlRow("Амортизация", amount: -month.amortization, share: month.share(month.amortization))
            }
            if month.depreciation > 0 || month.amortization > 0 {
                PnlRow("Операционная прибыль", amount: month.operatingProfit, share: month.share(month.operatingProfit), emphasized: true)
            }

            if month.financialExpenses > 0 {
                PnlRow("Финансовые расходы", amount: -month.financialExpenses, share: month.share(month.financialExpenses))
            }
            if month.incomeTax > 0 {
                PnlRow("Налог на прибыль", amount: -month.incomeTax, share: month.share(month.incomeTax))
            }
            if month.nonOperating > 0 {
                PnlRow("Неоперационные", amount: -month.nonOperating, share: month.share(month.nonOperating))
            }

            PnlRow("Чистая прибыль", amount: month.netProfit, share: month.netMargin, emphasized: true)

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
                    PnlRow("Вложения (CAPEX)", amount: month.capex, share: month.share(month.capex), icon: "hammer")
                }
                if month.profitDistribution > 0 {
                    PnlRow("Распределение прибыли", amount: month.profitDistribution, share: month.share(month.profitDistribution), icon: "arrow.up.forward")
                }
            }
        }
        .padding(Spacing.md)
        .background(Theme.surfaceRaised)
        .clipShape(RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
    }
}
