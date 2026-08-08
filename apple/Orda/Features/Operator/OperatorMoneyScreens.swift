import OrdaKit
import OrdaUI
import SwiftUI

// ── Деньги ───────────────────────────────────────────────────────────────────

/// Зарплата за неделю: из чего сложилась, что уже выплачено, что удержано.
struct MoneyScreen: View {
    @Environment(CabinetStore.self) private var cabinet

    var body: some View {
        ScreenScroll {
            if let week = cabinet.salary?.week ?? cabinet.overview?.week {
                heroCard(week)

                SplitDashboard {
                    breakdownCard(week)
                    // Пустой график хуже отсутствия: рамка с подписями дней и
                    // без столбцов читается как поломка.
                    if hasShiftAmounts {
                        CategoryBarChart(title: "Смены недели", points: shiftPoints)
                    }
                } side: {
                    debtsCard
                    incidentsCard
                }
            } else {
                Skeleton(height: 140, cornerRadius: Radius.lg)
            }
        }
        .navigationTitle("Мои деньги")
        .toolbar { LogoutToolbarItem() }
        .task {
            if cabinet.salary == nil { await cabinet.loadSalary() }
            if cabinet.incidents.isEmpty { await cabinet.loadIncidents() }
        }
        .refreshable {
            await cabinet.loadSalary()
            await cabinet.loadIncidents()
            await cabinet.loadOverview()
        }
    }

    private func heroCard(_ week: SalaryWeek) -> some View {
        Card(accent: Theme.brand) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                HStack {
                    Text("К выплате за неделю")
                        .font(Typography.label)
                        .foregroundStyle(Theme.textDim)
                        .textCase(.uppercase)
                    Spacer()
                    StatusChip(week.statusLabel, kind: week.status == "paid" ? .good : .neutral)
                }

                Text(Money.format(week.netAmount))
                    .font(Typography.monospacedDigits(Typography.hero))
                    .foregroundStyle(Theme.text)
                    .contentTransition(.numericText())
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)

                if let start = week.weekStart, let end = week.weekEnd {
                    Text("\(shortDate(start)) — \(shortDate(end))")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                }

                if week.paidAmount > 0 {
                    SplitBar(segments: [
                        .init(label: "Выплачено", value: week.paidAmount, color: ChartPalette.series1),
                        .init(label: "Остаток", value: max(week.remainingAmount, 0), color: ChartPalette.series2),
                    ])
                }
            }
        }
    }

    private func breakdownCard(_ week: SalaryWeek) -> some View {
        Card {
            VStack(spacing: Spacing.md) {
                Text("Из чего сложилось")
                    .font(Typography.label)
                    .foregroundStyle(Theme.textDim)
                    .textCase(.uppercase)
                    .frame(maxWidth: .infinity, alignment: .leading)

                StatRow("Начислено за смены", value: Money.format(week.grossAmount), icon: "calendar")
                if week.bonusAmount > 0 {
                    StatRow("Бонусы", value: Money.signed(week.bonusAmount), valueColor: Theme.positive, icon: "plus.circle")
                }
                if week.fineAmount > 0 {
                    StatRow("Штрафы", value: Money.signed(-week.fineAmount), valueColor: Theme.negative, icon: "minus.circle")
                }
                if week.advanceAmount > 0 {
                    StatRow("Аванс", value: Money.signed(-week.advanceAmount), valueColor: Theme.warning, icon: "arrow.down.circle")
                }
                if week.debtAmount > 0 {
                    StatRow("Удержано в счёт долга", value: Money.signed(-week.debtAmount), valueColor: Theme.negative, icon: "creditcard")
                }

                RowDivider()
                StatRow("Итого к выплате", value: Money.format(week.netAmount), emphasized: true)
            }
        }
    }

    /// Есть ли что показывать: суммы по сменам могут прийти нулями, и тогда
    /// столбцов не будет вовсе.
    private var hasShiftAmounts: Bool {
        shiftPoints.contains { $0.value > 0 }
    }

    /// Смены недели столбцами. Сегодняшняя выделена — остальные приглушены.
    private var shiftPoints: [CategoryPoint] {
        let today = DateParsing.dateOnlyString(from: Date())
        return (cabinet.salary?.shifts ?? []).map { shift in
            CategoryPoint(
                label: weekdayLabel(shift.date),
                value: shift.amount ?? 0,
                isHighlighted: shift.date == today
            )
        }
    }

    @ViewBuilder
    private var debtsCard: some View {
        let debts = cabinet.overview?.recentDebts ?? []
        if !debts.isEmpty {
            Card(accent: Theme.negative) {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    Text("Долг перед точкой")
                        .font(Typography.label)
                        .foregroundStyle(Theme.negative)
                        .textCase(.uppercase)

                    ForEach(debts) { debt in
                        StatRow(
                            debt.comment ?? debt.companyName ?? "Долг",
                            value: Money.format(debt.amount),
                            valueColor: Theme.negative
                        )
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var incidentsCard: some View {
        if !cabinet.incidents.isEmpty {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    Text("Штрафы и поощрения")
                        .font(Typography.label)
                        .foregroundStyle(Theme.textDim)
                        .textCase(.uppercase)

                    ForEach(cabinet.incidents.prefix(8)) { incident in
                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            HStack {
                                Text(incident.title ?? (incident.isPenalty ? "Штраф" : "Поощрение"))
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.text)
                                Spacer()
                                if let amount = incident.amount {
                                    Text(Money.signed(incident.isPenalty ? -abs(amount) : abs(amount)))
                                        .font(Typography.callout.weight(.semibold))
                                        .monospacedDigit()
                                        .foregroundStyle(incident.isPenalty ? Theme.negative : Theme.positive)
                                }
                            }
                            if let description = incident.description, !description.isEmpty {
                                Text(description)
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.textDim)
                                    .lineLimit(2)
                            }
                        }
                    }
                }
            }
        }
    }

    private func shortDate(_ iso: String) -> String {
        guard let date = DateParsing.parseDateOnly(iso) else { return iso }
        return date.formatted(.dateTime.day().month(.abbreviated))
    }

    private func weekdayLabel(_ iso: String) -> String {
        guard let date = DateParsing.parseDateOnly(iso) else { return iso }
        return date.formatted(.dateTime.weekday(.abbreviated))
    }
}

// ── Профиль ──────────────────────────────────────────────────────────────────

struct OperatorProfileScreen: View {
    @Environment(AuthStore.self) private var auth
    @Environment(OperatorStore.self) private var store
    @Environment(CabinetStore.self) private var cabinet

    @State private var confirmingLogout = false

    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.lg) {
                Card {
                    HStack(spacing: Spacing.lg) {
                        Image(systemName: "person.crop.circle.fill")
                            .font(.system(size: 44))
                            .foregroundStyle(Theme.accent(for: .operator))
                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            Text(cabinet.overview?.operatorName ?? auth.role?.displayName ?? "Оператор")
                                .font(Typography.title)
                                .foregroundStyle(Theme.text)
                            if let label = auth.role?.roleLabel {
                                Text(label)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.textMuted)
                            }
                        }
                        Spacer()
                    }
                }

                Card {
                    VStack(spacing: Spacing.sm) {
                        NavigationLink { ScheduleScreen() } label: {
                            NavigationRow(icon: "calendar", iconColor: ChartPalette.series2, title: "Мой график")
                        }
                        .buttonStyle(.plain)

                        RowDivider()

                        NavigationLink { MoneyScreen() } label: {
                            NavigationRow(icon: "wallet.bifold", iconColor: Theme.brand, title: "Мои деньги")
                        }
                        .buttonStyle(.plain)

                        RowDivider()

                        NavigationLink { KnowledgeScreen() } label: {
                            NavigationRow(
                                icon: "book.closed",
                                iconColor: Theme.info,
                                title: "База знаний",
                                badge: cabinet.pendingArticles.count,
                                badgeColor: Theme.info
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }

                if store.queuedSalesCount > 0 {
                    Card(accent: Theme.warning) {
                        VStack(alignment: .leading, spacing: Spacing.md) {
                            Label(
                                "\(store.queuedSalesCount) \(pluralize(store.queuedSalesCount, "неотправленный чек", "неотправленных чека", "неотправленных чеков"))",
                                systemImage: "arrow.triangle.2.circlepath"
                            )
                            .font(Typography.callout.weight(.semibold))
                            .foregroundStyle(Theme.warning)

                            Text("Чеки сохранены на устройстве и уйдут при связи. Не удаляйте приложение.")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textMuted)

                            Button("Отправить сейчас") { Task { await store.flushQueue() } }
                                .buttonStyle(SecondaryButtonStyle())
                        }
                    }
                }

                Button("Выйти из аккаунта") { confirmingLogout = true }
                    .buttonStyle(DestructiveButtonStyle())
            }
            .padding(Spacing.lg)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.background)
        .navigationTitle("Профиль")
        .confirmationDialog("Выйти из аккаунта?", isPresented: $confirmingLogout, titleVisibility: .visible) {
            Button("Выйти", role: .destructive) { Task { await auth.signOut() } }
            Button("Отмена", role: .cancel) {}
        } message: {
            Text("Неотправленные чеки останутся на устройстве.")
        }
    }
}
