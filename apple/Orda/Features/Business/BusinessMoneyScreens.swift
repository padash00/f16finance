import OrdaKit
import OrdaUI
import SwiftUI

// ── Одобрение расходов ───────────────────────────────────────────────────────

/// Очередь расходов, ждущих решения владельца.
///
/// Главный сценарий владельца на телефоне: увидеть, что подал оператор, и
/// решить за пару секунд. Поэтому решение принимается прямо из карточки — без
/// перехода на отдельный экран.
struct ApprovalsScreen: View {
    @Environment(BusinessStore.self) private var store
    @Environment(\.access) private var access

    @State private var error: String?
    @State private var declining: PendingExpense?
    @State private var declineReason = ""

    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.md) {
                if let apiError = store.pendingError {
                    ErrorStateView(error: apiError) {
                        Task { await store.loadPending() }
                    }
                } else if store.isLoadingPending && store.pending.isEmpty {
                    ForEach(0..<3, id: \.self) { _ in Skeleton(height: 130, cornerRadius: Radius.lg) }
                } else if store.pending.isEmpty {
                    EmptyStateView(
                        icon: "checkmark.seal",
                        title: "Всё согласовано",
                        message: "Расходов на одобрении нет."
                    )
                } else {
                    summaryCard

                    ForEach(Array(store.pending.enumerated()), id: \.element.id) { index, expense in
                        PendingExpenseCard(
                            expense: expense,
                            companyName: store.companyName(expense.companyID),
                            canApprove: access?.can("expenses-pending.approve") == true,
                            canDecline: access?.can("expenses-pending.decline") == true,
                            onApprove: { approve(expense) },
                            onDecline: { declining = expense }
                        )
                        .staggeredAppear(index: index)
                    }
                }

                if let error {
                    Text(error).font(Typography.callout).foregroundStyle(Theme.negative)
                }
            }
            .padding(Spacing.lg)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.background)
        .navigationTitle("Ожидают одобрения")
        .toolbar { LogoutToolbarItem() }
        .task { if store.pending.isEmpty { await store.loadPending() } }
        .refreshable { await store.loadPending() }
        .sheet(item: $declining) { expense in
            declineSheet(expense)
        }
    }

    private var summaryCard: some View {
        Card(accent: Theme.warning) {
            HStack {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text("На сумму")
                        .font(Typography.label)
                        .foregroundStyle(Theme.textDim)
                        .textCase(.uppercase)
                    Text(Money.format(store.pending.reduce(0) { $0 + $1.total }))
                        .font(Typography.monospacedDigits(Typography.metric))
                        .foregroundStyle(Theme.text)
                }
                Spacer()
                Text("\(store.pending.count)")
                    .font(Typography.monospacedDigits(Typography.metric))
                    .foregroundStyle(Theme.warning)
            }
        }
    }

    private func declineSheet(_ expense: PendingExpense) -> some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                Text("Почему отклоняете?")
                    .font(Typography.title)
                    .foregroundStyle(Theme.text)

                Text("Причину увидит тот, кто подал расход. Без неё человек не поймёт, что исправить.")
                    .font(Typography.callout)
                    .foregroundStyle(Theme.textMuted)

                TextField("Причина", text: $declineReason, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(3...6)
                    .padding(Spacing.md)
                    .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))

                Button("Отклонить расход") {
                    decline(expense)
                }
                .buttonStyle(DestructiveButtonStyle())

                Spacer()
            }
            .padding(Spacing.lg)
            .background(Theme.background)
            .navigationTitle(Money.format(expense.total))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { declining = nil }
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func approve(_ expense: PendingExpense) {
        Task {
            if let failure = await store.approve(expense) {
                error = failure
                Haptics.error()
            } else {
                Haptics.success()
            }
        }
    }

    private func decline(_ expense: PendingExpense) {
        let reason = declineReason
        declining = nil
        declineReason = ""
        Task {
            if let failure = await store.decline(expense, reason: reason.isEmpty ? nil : reason) {
                error = failure
                Haptics.error()
            } else {
                Haptics.success()
            }
        }
    }
}

/// Карточка расхода с решением прямо в ней.
struct PendingExpenseCard: View {
    let expense: PendingExpense
    let companyName: String?
    let canApprove: Bool
    let canDecline: Bool
    let onApprove: () -> Void
    let onDecline: () -> Void

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        Text(expense.category ?? "Без категории")
                            .font(Typography.body.weight(.medium))
                            .foregroundStyle(Theme.text)

                        if let payee = expense.payee, !payee.isEmpty {
                            Text(payee)
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textMuted)
                        }
                    }
                    Spacer()
                    Text(Money.format(expense.total))
                        .font(Typography.monospacedDigits(Typography.title))
                        .foregroundStyle(Theme.text)
                }

                if let reason = expense.reason ?? expense.comment, !reason.isEmpty {
                    Text(reason)
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textMuted)
                        .lineLimit(3)
                }

                HStack(spacing: Spacing.sm) {
                    if let date = expense.date {
                        Text(shortDate(date))
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                    }
                    if let companyName {
                        Text("· \(companyName)")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                    }
                    Spacer()
                    if expense.cashAmount > 0 && expense.kaspiAmount > 0 {
                        StatusChip("смешанная оплата", kind: .neutral)
                    }
                }

                // Кнопки показываем только при наличии прав. Сервер всё равно
                // проверит, но предлагать действие, которое отклонят, — обман.
                if canApprove || canDecline {
                    HStack(spacing: Spacing.md) {
                        if canDecline {
                            Button("Отклонить", action: onDecline)
                                .buttonStyle(DestructiveButtonStyle())
                        }
                        if canApprove {
                            Button("Одобрить", action: onApprove)
                                .buttonStyle(PrimaryButtonStyle())
                        }
                    }
                } else {
                    Text("У вас нет права решать по расходам — только просмотр.")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                }
            }
        }
    }

    private func shortDate(_ iso: String) -> String {
        guard let date = DateParsing.parseDateOnly(iso) else { return iso }
        return date.formatted(.dateTime.day().month(.abbreviated))
    }
}

// ── Доходы и расходы ─────────────────────────────────────────────────────────

/// Динамика денег за период: доход, расход, прибыль, структура расходов.
struct LedgerScreen: View {
    @Environment(BusinessStore.self) private var store

    var body: some View {
        @Bindable var bindableStore = store

        return ScrollView {
            VStack(spacing: Spacing.lg) {
                Picker("Период", selection: $bindableStore.range) {
                    ForEach(DateRange.allCases) { range in
                        Text(range.label).tag(range)
                    }
                }
                .pickerStyle(.segmented)

                if let error = store.ledgerError {
                    ErrorStateView(error: error) { Task { await store.loadLedger() } }
                } else if store.isLoadingLedger && store.incomes.isEmpty {
                    Skeleton(height: 130, cornerRadius: Radius.lg)
                    Skeleton(height: 190, cornerRadius: Radius.lg)
                } else {
                    profitCard
                    incomeChart
                    categoriesCard
                }
            }
            .padding(Spacing.lg)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.background)
        .navigationTitle("Деньги")
        .toolbar { LogoutToolbarItem() }
        .task { if store.incomes.isEmpty { await store.loadLedger() } }
        .refreshable { await store.loadLedger() }
    }

    private var profitCard: some View {
        Card(accent: store.profit >= 0 ? Theme.brand : Theme.negative) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                Text("Прибыль за период")
                    .font(Typography.label)
                    .foregroundStyle(Theme.textDim)
                    .textCase(.uppercase)

                Text(Money.format(store.profit))
                    .font(Typography.monospacedDigits(Typography.hero))
                    .foregroundStyle(store.profit >= 0 ? Theme.text : Theme.negative)
                    .contentTransition(.numericText())
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)

                RowDivider()
                StatRow("Доходы", value: Money.format(store.incomeTotal), valueColor: Theme.positive, icon: "arrow.down.circle")
                StatRow("Расходы", value: Money.format(store.expenseTotal), valueColor: Theme.negative, icon: "arrow.up.circle")
            }
        }
    }

    private var incomeChart: some View {
        let points = store.incomeSeries.compactMap { entry -> TimePoint? in
            guard let date = DateParsing.parseDateOnly(entry.date) else { return nil }
            return TimePoint(label: entry.date, date: date, value: entry.amount)
        }
        return TrendChart(
            title: "Доходы по дням",
            subtitle: store.range.label.lowercased(),
            points: points
        )
    }

    @ViewBuilder
    private var categoriesCard: some View {
        let categories = store.expensesByCategory
        if !categories.isEmpty {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    Text("Расходы по категориям")
                        .font(Typography.label)
                        .foregroundStyle(Theme.textDim)
                        .textCase(.uppercase)

                    // Доля от общей суммы полосой — так видно вес категории,
                    // а не только абсолютное число.
                    ForEach(categories.prefix(8), id: \.name) { category in
                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            HStack {
                                Text(category.name)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.text)
                                    .lineLimit(1)
                                Spacer()
                                Text(Money.format(category.amount))
                                    .font(Typography.callout.weight(.semibold))
                                    .monospacedDigit()
                                    .foregroundStyle(Theme.text)
                            }

                            GeometryReader { proxy in
                                Capsule()
                                    .fill(ChartPalette.series1)
                                    .frame(width: barWidth(category.amount, in: proxy.size.width))
                            }
                            .frame(height: 6)
                        }
                    }
                }
            }
        }
    }

    private func barWidth(_ amount: Double, in available: CGFloat) -> CGFloat {
        let maximum = store.expensesByCategory.first?.amount ?? 0
        guard maximum > 0 else { return 0 }
        return max(4, available * CGFloat(amount / maximum))
    }
}
