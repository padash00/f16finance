import OrdaKit
import OrdaUI
import SwiftUI

/// Дашборд владельца.
///
/// Владелец заходит на сорок секунд по дороге, а не сидит в приложении. Поэтому
/// сверху — сколько заработали сегодня, сразу под ним — что требует решения,
/// и только потом аналитика. Порядок обратный веб-порталу намеренно.
struct BusinessDashboardScreen: View {
    let resolver: AccessResolver

    @Environment(BusinessStore.self) private var store
    @Environment(AuthStore.self) private var auth

    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.lg) {
                if let error = store.dashboardError {
                    Card(accent: Theme.negative) {
                        VStack(alignment: .leading, spacing: Spacing.md) {
                            Label(error.userMessage, systemImage: "exclamationmark.triangle")
                                .font(Typography.callout)
                                .foregroundStyle(Theme.textMuted)
                            if error.isRetryable {
                                Button("Повторить") { Task { await store.loadDashboard() } }
                                    .buttonStyle(SecondaryButtonStyle())
                            }
                        }
                    }
                } else if store.isLoadingDashboard && store.dashboard == nil {
                    Skeleton(height: 170, cornerRadius: Radius.lg)
                    Skeleton(height: 200, cornerRadius: Radius.lg)
                } else if let dashboard = store.dashboard {
                    todayCard(dashboard)
                    weekChart(dashboard)
                    paymentSplit(dashboard)
                }

                approvalsCard

                if let dashboard = store.dashboard {
                    if !dashboard.lowStock.isEmpty { lowStockCard(dashboard) }
                    if !dashboard.topItems.isEmpty { topItemsCard(dashboard) }
                }

                sectionsCard
            }
            .padding(Spacing.lg)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.background)
        .navigationTitle("Обзор")
        .toolbar { LogoutToolbarItem() }
        .refreshable { await store.bootstrap() }
    }

    // ── Сегодня ──────────────────────────────────────────────────────────────

    private func todayCard(_ dashboard: BusinessDashboard) -> some View {
        Card(accent: Theme.brand) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                HStack {
                    Text("Выручка сегодня")
                        .font(Typography.label)
                        .foregroundStyle(Theme.textDim)
                        .textCase(.uppercase)
                    Spacer()
                    if let change = dashboard.changePercent {
                        ChangeBadge(change: change)
                    }
                }

                Text(Money.format(dashboard.today.total))
                    .font(Typography.monospacedDigits(Typography.hero))
                    .foregroundStyle(Theme.text)
                    .contentTransition(.numericText())
                    .animation(Motion.value, value: dashboard.today.total)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)

                HStack(spacing: Spacing.lg) {
                    Text("\(dashboard.today.count) \(pluralize(dashboard.today.count, "чек", "чека", "чеков"))")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                    Text("вчера \(Money.compact(dashboard.yesterdayTotal))")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                }

                RowDivider()
                StatRow("За месяц", value: Money.format(dashboard.monthTotal), icon: "calendar")
            }
        }
    }

    private func weekChart(_ dashboard: BusinessDashboard) -> some View {
        let today = DateParsing.dateOnlyString(from: Date())
        let points = dashboard.weekSeries.map { entry in
            CategoryPoint(
                label: weekdayLabel(entry.date),
                value: entry.amount,
                isHighlighted: entry.date == today
            )
        }
        return CategoryBarChart(title: "Выручка за неделю", points: points)
    }

    private func paymentSplit(_ dashboard: BusinessDashboard) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                Text("Чем платили сегодня")
                    .font(Typography.label)
                    .foregroundStyle(Theme.textDim)
                    .textCase(.uppercase)

                SplitBar(segments: [
                    .init(label: "Наличные", value: dashboard.today.cash, color: ChartPalette.series1),
                    .init(label: "Kaspi", value: dashboard.today.kaspi, color: ChartPalette.series2),
                    .init(label: "Прочее", value: dashboard.today.card + dashboard.today.online, color: ChartPalette.series3),
                ])
            }
        }
    }

    // ── Требует решения ──────────────────────────────────────────────────────

    @ViewBuilder
    private var approvalsCard: some View {
        // Экран очереди скрываем целиком, если права на просмотр нет: пустая
        // карточка «0 расходов» вводила бы в заблуждение.
        if resolver.can("expenses-pending.view") {
            NavigationLink { ApprovalsScreen() } label: {
                Card(accent: store.pending.isEmpty ? nil : Theme.warning) {
                    HStack(spacing: Spacing.md) {
                        Image(systemName: store.pending.isEmpty ? "checkmark.circle" : "clock.badge.exclamationmark")
                            .font(.system(size: 22))
                            .foregroundStyle(store.pending.isEmpty ? Theme.positive : Theme.warning)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(store.pending.isEmpty ? "Всё согласовано" : "Ждут вашего решения")
                                .font(Typography.body.weight(.medium))
                                .foregroundStyle(Theme.text)
                            Text(
                                store.pending.isEmpty
                                    ? "Расходов на одобрении нет"
                                    : "\(store.pending.count) \(pluralize(store.pending.count, "расход", "расхода", "расходов")) · \(Money.compact(store.pending.reduce(0) { $0 + $1.total }))"
                            )
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                        }

                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Theme.textDim)
                    }
                }
            }
            .buttonStyle(.plain)
        }
    }

    // ── Склад ────────────────────────────────────────────────────────────────

    private func lowStockCard(_ dashboard: BusinessDashboard) -> some View {
        Card(accent: Theme.warning) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                HStack {
                    Text("Заканчивается на складе")
                        .font(Typography.label)
                        .foregroundStyle(Theme.warning)
                        .textCase(.uppercase)
                    Spacer()
                    Text("\(dashboard.lowStock.count)")
                        .font(Typography.caption.weight(.bold))
                        .monospacedDigit()
                        .foregroundStyle(Theme.warning)
                }

                ForEach(dashboard.lowStock.prefix(6)) { item in
                    StatRow(
                        item.name,
                        value: "\(Quantity.format(item.balance)) / \(Quantity.format(item.threshold))",
                        valueColor: item.balance <= 0 ? Theme.negative : Theme.warning
                    )
                }

                if dashboard.lowStock.count > 6 {
                    Text("и ещё \(dashboard.lowStock.count - 6)")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                }
            }
        }
    }

    private func topItemsCard(_ dashboard: BusinessDashboard) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                Text("Топ продаж за неделю")
                    .font(Typography.label)
                    .foregroundStyle(Theme.textDim)
                    .textCase(.uppercase)

                ForEach(dashboard.topItems) { item in
                    StatRow(item.name, value: "\(Quantity.format(item.quantity)) шт")
                }
            }
        }
    }

    // ── Разделы ──────────────────────────────────────────────────────────────

    private var sectionsCard: some View {
        Card {
            VStack(spacing: Spacing.sm) {
                Text("Разделы")
                    .font(Typography.label)
                    .foregroundStyle(Theme.textDim)
                    .textCase(.uppercase)
                    .frame(maxWidth: .infinity, alignment: .leading)

                NavigationLink { LedgerScreen() } label: {
                    NavigationRow(
                        icon: "chart.line.uptrend.xyaxis",
                        iconColor: Theme.brand,
                        title: "Доходы и расходы",
                        subtitle: "динамика, категории, прибыль"
                    )
                }
                .buttonStyle(.plain)

                RowDivider()

                NavigationLink { BusinessSectionsScreen(resolver: resolver) } label: {
                    NavigationRow(
                        icon: "square.grid.2x2",
                        iconColor: ChartPalette.series2,
                        title: "Все разделы",
                        subtitle: "\(resolver.visibleGroups().count) доступно"
                    )
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func weekdayLabel(_ iso: String) -> String {
        guard let date = DateParsing.parseDateOnly(iso) else { return iso }
        return date.formatted(.dateTime.weekday(.abbreviated))
    }
}
