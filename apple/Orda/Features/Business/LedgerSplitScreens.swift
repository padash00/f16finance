import OrdaKit
import OrdaUI
import SwiftUI

// ── Доходы и расходы по отдельности ──────────────────────────────────────────
//
// На сайте это две разные страницы, и в меню приложения два разных пункта. До
// этого оба вели на сводный экран «Деньги»: нажимаешь «Доходы» — попадаешь не
// туда, куда шёл, и раздел выглядит неоткрывающимся, хотя он открылся.
//
// Сводный экран остался: он висит на своём пункте «Деньги» и отвечает на
// вопрос «сколько осталось». Эти два отвечают на другой — «из чего сложилось».

/// Доходы за период: сколько, чем платили, по каким точкам и по дням.
struct IncomeScreen: View {
    @Environment(BusinessStore.self) private var store
    @Environment(\.access) private var access

    @State private var isAdding = false

    /// Право `income.create` проверяет и сервер. Кнопка без права вела бы в
    /// гарантированный отказ уже после заполнения формы.
    private var canCreate: Bool {
        access?.can("income.create") ?? false
    }

    var body: some View {
        @Bindable var bindable = store

        return ScreenScroll {
            VStack(spacing: Spacing.lg) {
                Picker("Период", selection: $bindable.range) {
                    ForEach(DateRange.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)

                if let error = store.incomesError, store.incomes.isEmpty {
                    ErrorStateView(error: error) { Task { await store.loadIncomes() } }
                } else if store.isLoadingIncomes && store.incomes.isEmpty {
                    Skeleton(height: 130, cornerRadius: Radius.lg)
                    Skeleton(height: 190, cornerRadius: Radius.lg)
                } else if store.incomes.isEmpty {
                    EmptyStateView(
                        icon: "arrow.down.circle",
                        title: "Доходов нет",
                        message: "За выбранный период записей не заведено."
                    )
                } else {
                    totalCard
                    methodsCard
                    chart
                    companiesCard
                    rowsCard
                }
            }
        }
        .background(Theme.background)
        .navigationTitle("Доходы")
        .toolbar {
            if canCreate {
                ToolbarItem(placement: .primaryAction) {
                    Button { isAdding = true } label: { Image(systemName: "plus") }
                }
            }
            LogoutToolbarItem()
        }
        .task { await store.loadIncomes() }
        .refreshable { await store.loadIncomes() }
        .sheet(isPresented: $isAdding) { AddIncomeSheet() }
    }

    private var totalCard: some View {
        Card(accent: Theme.positive) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                Text("Доход за период")
                    .font(Typography.label)
                    .foregroundStyle(Theme.textDim)
                    .textCase(.uppercase)

                Text(Money.format(store.incomeTotal))
                    .font(Typography.monospacedDigits(Typography.hero))
                    .foregroundStyle(Theme.text)
                    .contentTransition(.numericText())
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)

                RowDivider()
                StatRow("Записей", value: "\(store.incomes.count)", icon: "list.bullet")
                StatRow(
                    "Средняя запись",
                    value: Money.format(store.incomes.isEmpty ? 0 : store.incomeTotal / Double(store.incomes.count)),
                    icon: "divide"
                )
            }
        }
    }

    @ViewBuilder
    private var methodsCard: some View {
        let methods = store.incomeByMethod.filter { $0.amount > 0 }
        if !methods.isEmpty {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("Чем платили")

                    SplitBar(segments: methods.enumerated().map { index, method in
                        SplitBar.Segment(
                            label: method.name,
                            value: method.amount,
                            color: ChartPalette.series(index)
                        )
                    })

                    RowDivider()
                    ForEach(methods, id: \.name) { method in
                        StatRow(method.name, value: Money.format(method.amount))
                    }
                }
            }
        }
    }

    private var chart: some View {
        TrendChart(
            title: "Доходы по дням",
            subtitle: store.range.label.lowercased(),
            points: store.incomeSeries.compactMap(TimePoint.fromDaily)
        )
    }

    @ViewBuilder
    private var companiesCard: some View {
        let companies = store.incomeByCompany
        // Одна точка — разрез не несёт информации: там та же сумма, что выше.
        if companies.count > 1 {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("По точкам")
                    let maximum = companies.first?.amount ?? 0
                    ForEach(companies, id: \.name) { company in
                        AmountShareRow(
                            name: company.name,
                            amount: company.amount,
                            ratio: maximum > 0 ? company.amount / maximum : 0,
                            color: ChartPalette.series1
                        )
                    }
                }
            }
        }
    }

    private var rowsCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Записи")
                ForEach(sortedRows.prefix(50)) { row in
                    IncomeRowView(row: row, companyName: store.companyName(row.companyID))
                    if row.id != sortedRows.prefix(50).last?.id { RowDivider() }
                }
                if sortedRows.count > 50 {
                    Text("Показаны последние 50 из \(sortedRows.count)")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                }
            }
        }
    }

    /// Новые сверху: свежая смена интересует чаще, чем начало периода.
    private var sortedRows: [IncomeRow] {
        store.incomes.sorted { $0.date > $1.date }
    }
}

private struct IncomeRowView: View {
    let row: IncomeRow
    let companyName: String?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(DateFormatting.dayMonth(row.date))
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)

                if let subtitle {
                    Text(subtitle)
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: Spacing.sm)

            Text(Money.format(row.total))
                .font(Typography.callout.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(Theme.positive)
        }
    }

    private var subtitle: String? {
        let parts = [companyName, ShiftLabel.of(row.shift), row.comment]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

/// Расходы за период: сколько, на что, по каким точкам и что ждёт согласования.
struct ExpensesScreen: View {
    @Environment(BusinessStore.self) private var store
    @Environment(\.access) private var access

    @State private var isAdding = false

    /// Право `expenses.create` проверяет и сервер — на каждом шаге мастера.
    private var canCreate: Bool {
        access?.can("expenses.create") ?? false
    }

    var body: some View {
        @Bindable var bindable = store

        return ScreenScroll {
            VStack(spacing: Spacing.lg) {
                Picker("Период", selection: $bindable.range) {
                    ForEach(DateRange.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)

                if let error = store.expensesError, store.expenses.isEmpty {
                    ErrorStateView(error: error) { Task { await store.loadExpenses() } }
                } else if store.isLoadingExpenses && store.expenses.isEmpty {
                    Skeleton(height: 130, cornerRadius: Radius.lg)
                    Skeleton(height: 190, cornerRadius: Radius.lg)
                } else if store.expenses.isEmpty {
                    EmptyStateView(
                        icon: "arrow.up.circle",
                        title: "Расходов нет",
                        message: "За выбранный период записей не заведено."
                    )
                } else {
                    totalCard
                    categoriesCard
                    chart
                    rowsCard
                }
            }
        }
        .background(Theme.background)
        .navigationTitle("Расходы")
        .toolbar {
            if canCreate {
                ToolbarItem(placement: .primaryAction) {
                    Button { isAdding = true } label: { Image(systemName: "plus") }
                }
            }
            LogoutToolbarItem()
        }
        .task { await store.loadExpenses() }
        .refreshable { await store.loadExpenses() }
        .sheet(isPresented: $isAdding) { AddExpenseSheet() }
    }

    private var totalCard: some View {
        Card(accent: Theme.negative) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                Text("Расход за период")
                    .font(Typography.label)
                    .foregroundStyle(Theme.textDim)
                    .textCase(.uppercase)

                Text(Money.format(store.expenseTotal))
                    .font(Typography.monospacedDigits(Typography.hero))
                    .foregroundStyle(Theme.text)
                    .contentTransition(.numericText())
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)

                RowDivider()
                StatRow("Записей", value: "\(store.expenses.count)", icon: "list.bullet")
                StatRow(
                    "Наличными",
                    value: Money.format(store.expenses.reduce(0) { $0 + $1.cashAmount }),
                    icon: "banknote"
                )
                StatRow(
                    "Kaspi",
                    value: Money.format(store.expenses.reduce(0) { $0 + $1.kaspiAmount }),
                    icon: "creditcard"
                )

                // Ожидающие согласования — деньги, которые ещё не потрачены, но
                // уже заявлены. Молчать о них на экране расходов значило бы
                // показывать итог, который завтра вырастет без причины.
                let awaiting = store.expensesAwaitingApproval
                if !awaiting.isEmpty {
                    RowDivider()
                    StatRow(
                        "Ждут согласования",
                        value: Money.format(awaiting.reduce(0) { $0 + $1.total }),
                        valueColor: Theme.warning,
                        icon: "clock"
                    )
                }
            }
        }
    }

    @ViewBuilder
    private var categoriesCard: some View {
        let categories = store.expensesByCategory
        if !categories.isEmpty {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("По категориям")
                    let maximum = categories.first?.amount ?? 0
                    ForEach(categories.prefix(12), id: \.name) { category in
                        AmountShareRow(
                            name: category.name,
                            amount: category.amount,
                            ratio: maximum > 0 ? category.amount / maximum : 0,
                            color: ChartPalette.series3
                        )
                    }
                }
            }
        }
    }

    private var chart: some View {
        TrendChart(
            title: "Расходы по дням",
            subtitle: store.range.label.lowercased(),
            points: store.expenseSeries.compactMap(TimePoint.fromDaily)
        )
    }

    private var rowsCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Записи")
                ForEach(sortedRows.prefix(50)) { row in
                    ExpenseRowView(row: row, companyName: store.companyName(row.companyID))
                    if row.id != sortedRows.prefix(50).last?.id { RowDivider() }
                }
                if sortedRows.count > 50 {
                    Text("Показаны последние 50 из \(sortedRows.count)")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                }
            }
        }
    }

    private var sortedRows: [ExpenseRow] {
        store.expenses.sorted { $0.date > $1.date }
    }
}

private struct ExpenseRowView: View {
    let row: ExpenseRow
    let companyName: String?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                HStack(spacing: Spacing.sm) {
                    Text(row.category?.isEmpty == false ? row.category! : "Без категории")
                        .font(Typography.callout)
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)

                    if row.isPending {
                        StatusChip("На согласовании", kind: .warning)
                    }
                }

                if let subtitle {
                    Text(subtitle)
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: Spacing.sm)

            Text(Money.format(row.total))
                .font(Typography.callout.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(Theme.text)
        }
    }

    private var subtitle: String? {
        let parts = [DateFormatting.dayMonth(row.date), companyName, row.comment]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

// ── Общие мелочи двух экранов ────────────────────────────────────────────────

/// Строка «название — сумма — доля». Одинаковая у категорий расходов и точек
/// дохода: разные данные, но читаются одним движением глаза.
struct AmountShareRow: View {
    let name: String
    let amount: Double
    let ratio: Double
    var color: Color = ChartPalette.series1

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack {
                Text(name)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Spacer()
                Text(Money.format(amount))
                    .font(Typography.callout.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(Theme.text)
            }
            ProportionBar(ratio: ratio, color: color)
        }
    }
}

enum ShiftLabel {
    static func of(_ raw: String?) -> String? {
        switch raw {
        case "day": "День"
        case "night": "Ночь"
        default: nil
        }
    }
}

enum DateFormatting {
    /// `2026-08-08` → «8 авг». Сырая ISO-дата в строке списка не читается.
    static func dayMonth(_ raw: String) -> String {
        guard let date = DateParsing.parseDateOnly(raw) else { return raw }
        return date.formatted(.dateTime.day().month(.abbreviated))
    }
}

extension TimePoint {
    /// Точка графика из пары «дата — сумма». Подпись — для человека: под
    /// столбиком «2026-08-01» не читается.
    static func fromDaily(_ entry: (date: String, amount: Double)) -> TimePoint? {
        guard let date = DateParsing.parseDateOnly(entry.date) else { return nil }
        return TimePoint(
            label: date.formatted(.dateTime.day().month(.abbreviated)),
            date: date,
            value: entry.amount
        )
    }
}
