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
        .task { await store.loadPending() }
        .refreshable { await store.loadPending() }
        // Расходы заводят на точках, пока владелец смотрит на этот экран.
        // Ждать, пока он догадается потянуть вниз, значит держать человека у стойки:
        // оператор стоит и ждёт решения.
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                if Task.isCancelled { break }
                await store.loadPending()
            }
        }
        .sheet(item: $declining) { expense in
            declineSheet(expense)
        }
    }

    /// Сумма очереди главной цифрой — владелец сначала видит, сколько денег
    /// ждёт его решения, и только потом разбирает строки.
    private var summaryCard: some View {
        let total = store.pending.reduce(0) { $0 + $1.total }
        let cash = store.pending.reduce(0) { $0 + $1.cashAmount }
        let kaspi = store.pending.reduce(0) { $0 + $1.kaspiAmount }
        return HeroSummary(
            title: "Ждут решения",
            value: Money.format(total),
            caption: "\(store.pending.count) \(Self.expensesWord(store.pending.count)) на согласовании",
            footer: [
                ("Наличные", Money.format(cash)),
                ("Kaspi", Money.format(kaspi)),
            ],
            colors: [Color(hex: 0xF59E0B), Color(hex: 0xEA580C)]
        )
    }

    static func expensesWord(_ n: Int) -> String {
        let m10 = n % 10, m100 = n % 100
        if m10 == 1 && m100 != 11 { return "расход" }
        if (2...4).contains(m10) && !(12...14).contains(m100) { return "расхода" }
        return "расходов"
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
///
/// Как платёж на подтверждение в банке: иконка статьи, крупная сумма, кто и
/// где подал — и две большие кнопки внизу, чтобы не промахнуться пальцем.
struct PendingExpenseCard: View {
    let expense: PendingExpense
    let companyName: String?
    let canApprove: Bool
    let canDecline: Bool
    let onApprove: () -> Void
    let onDecline: () -> Void

    private var category: String { expense.category?.isEmpty == false ? expense.category! : "Без категории" }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            HStack(alignment: .center, spacing: Spacing.md) {
                TintedIcon(
                    systemName: OwnerAnalyticsScreen.expenseIcon(category),
                    tint: LedgerStatementScreen.categoryTint(category),
                    size: 46
                )
                VStack(alignment: .leading, spacing: 3) {
                    Text(category)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                    Text(whereLine)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textDim)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("−" + Money.format(expense.total))
                    .font(.system(size: 30, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                // Способ оплаты подписью: при смешанной оплате оператор
                // должен понимать, сколько брать из кассы, а сколько с Kaspi.
                Text(paymentLine)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.textDim)
            }

            if let payee = expense.payee, !payee.isEmpty {
                Label(payee, systemImage: "person.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textMuted)
                    .lineLimit(1)
            }

            if let reason = expense.reason ?? expense.comment, !reason.isEmpty {
                Text(reason)
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textMuted)
                    .lineLimit(3)
                    .padding(Spacing.md)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }

            // Кнопки показываем только при наличии прав. Сервер всё равно
            // проверит, но предлагать действие, которое отклонят, — обман.
            if canApprove || canDecline {
                HStack(spacing: Spacing.sm) {
                    if canDecline {
                        decisionButton("Отклонить", icon: "xmark", tint: Theme.negative, filled: false, action: onDecline)
                    }
                    if canApprove {
                        decisionButton("Одобрить", icon: "checkmark", tint: Theme.positive, filled: true, action: onApprove)
                    }
                }
            } else {
                Text("У вас нет права решать по расходам — только просмотр.")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textDim)
            }
        }
        .padding(Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private var whereLine: String {
        [companyName, expense.date.map(shortDate)].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private var paymentLine: String {
        if expense.cashAmount > 0 && expense.kaspiAmount > 0 {
            return "Смешанная оплата: наличные \(Money.format(expense.cashAmount)) · Kaspi \(Money.format(expense.kaspiAmount))"
        }
        return expense.kaspiAmount > 0 ? "Kaspi" : "Наличные"
    }

    /// Кнопка решения: «одобрить» залита, «отклонить» — контуром, чтобы
    /// основное действие читалось сразу.
    private func decisionButton(_ title: String, icon: String, tint: Color, filled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(filled ? .white : tint)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 13)
                .background(filled ? tint : tint.opacity(0.12), in: Capsule())
                .contentShape(Capsule())
        }
        .buttonStyle(.pressable)
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

        return ScreenScroll {
            VStack(spacing: Spacing.lg) {
                PeriodBar(selection: $bindableStore.range)

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
        }
        .background(Theme.background)
        .navigationTitle("Деньги")
        .toolbar { LogoutToolbarItem() }
        .task { await store.loadLedger() }
        .refreshable { await store.loadLedger() }
    }

    /// Прибыль главной цифрой на цветной карточке, доход и расход — её
    /// расшифровка. Цвет сам говорит, в плюсе период или в минусе.
    private var profitCard: some View {
        HeroSummary(
            title: "Прибыль за период",
            value: Money.format(store.profit),
            caption: store.range.title,
            footer: [
                ("Доходы", Money.format(store.incomeTotal)),
                ("Расходы", Money.format(store.expenseTotal)),
            ],
            colors: store.profit >= 0
                ? [Color(hex: 0x059669), Color(hex: 0x0F766E)]
                : [Color(hex: 0xE11D48), Color(hex: 0x9F1239)]
        )
    }

    private var incomeChart: some View {
        let points = store.incomeSeries.compactMap { entry -> TimePoint? in
            guard let date = DateParsing.parseDateOnly(entry.date) else { return nil }
            // Подпись оси — для человека, а не для API: «2026-08-01» под
            // столбиком не читается.
            return TimePoint(
                label: date.formatted(.dateTime.day().month(.abbreviated)),
                date: date,
                value: entry.amount
            )
        }
        return TrendChart(
            title: "Доходы по дням",
            subtitle: store.range.title.lowercased(),
            points: points
        )
    }

    /// Статьи строками с иконкой и полосой доли — как траты по категориям
    /// в банковской выписке: вес статьи видно без чтения цифр.
    @ViewBuilder
    private var categoriesCard: some View {
        let categories = store.expensesByCategory
        if !categories.isEmpty {
            let total = max(categories.reduce(0) { $0 + $1.amount }, 1)
            OwnerSection("Расходы по статьям") {
                Text(Money.format(store.expenseTotal))
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(Theme.textDim)
            } content: {
                VStack(spacing: Spacing.sm) {
                    ForEach(Array(categories.prefix(8).enumerated()), id: \.element.name) { index, category in
                        if index > 0 {
                            Rectangle().fill(Theme.borderSoft).frame(height: 1).padding(.leading, 56)
                        }
                        let tint = LedgerStatementScreen.categoryTint(category.name)
                        AmountRow(
                            leading: {
                                TintedIcon(systemName: OwnerAnalyticsScreen.expenseIcon(category.name), tint: tint, size: 42)
                            },
                            title: category.name,
                            subtitle: Percent.format(category.amount / total * 100),
                            amount: Money.format(category.amount),
                            share: category.amount / total,
                            tint: tint
                        )
                    }
                }
            }
        }
    }
}
