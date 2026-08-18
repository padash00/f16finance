import ActivityKit
import OrdaKit
import SwiftUI
import WidgetKit

/// Живая активность смены: экран блокировки и «остров».
///
/// Показывает ровно то, ради чего оператор достаёт телефон: сколько наторговали
/// и сколько идёт смена. Остальное — в приложении: активность это ответ на один
/// вопрос, а не второй интерфейс.
///
/// Расширение намеренно не ходит в сеть и ничего не считает. Данные ему
/// приносит приложение, а его дело — нарисовать. Виджет, который тянет API,
/// падает в фоне без объяснений и разряжает телефон.
@main
struct OrdaLiveActivityBundle: WidgetBundle {
    var body: some Widget {
        ShiftLiveActivity()
    }
}

struct ShiftLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ShiftActivityAttributes.self) { context in
            lockScreen(context)
                .activityBackgroundTint(Color.black.opacity(0.55))
                .activitySystemActionForegroundColor(brand)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    label(
                        context.state.hasHall ? "Занято" : "Выручка",
                        value: headline(context.state)
                    )
                }
                DynamicIslandExpandedRegion(.trailing) {
                    label(
                        context.state.hasHall ? "Касса зала" : "Чеков",
                        value: context.state.hasHall
                            ? money(context.state.revenue)
                            : "\(context.state.receipts)"
                    )
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(spacing: 12) {
                        chip("Наличные", money(context.state.cash))
                        chip("Kaspi", money(context.state.kaspi))
                        Spacer(minLength: 0)
                        Text(context.attributes.openedAt, style: .timer)
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: 64, alignment: .trailing)
                    }
                }
            } compactLeading: {
                Image(systemName: "cube.transparent.fill")
                    .foregroundStyle(brand)
            } compactTrailing: {
                Text(
                    context.state.hasHall
                        ? "\(context.state.busyStations ?? 0)/\(context.state.totalStations ?? 0)"
                        : shortMoney(context.state.revenue)
                )
                .font(.caption2.monospacedDigit())
            } minimal: {
                Image(systemName: "cube.transparent.fill")
                    .foregroundStyle(brand)
            }
            .keylineTint(brand)
        }
    }

    // ── Экран блокировки ─────────────────────────────────────────────────────

    private func lockScreen(_ context: ActivityViewContext<ShiftActivityAttributes>) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label(context.attributes.pointName, systemImage: "storefront")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                Spacer()
                Text(context.attributes.isNight ? "Ночная смена" : "Дневная смена")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            HStack(alignment: .firstTextBaseline) {
                // Главная цифра разная. В магазине это выручка, в клубе —
                // занятые станции: чеков там нет вовсе, и «0 ₸» на весь экран
                // блокировки означало бы, что карточка сломана.
                Text(headline(context.state))
                    .font(.system(size: 30, weight: .bold, design: .rounded))
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                Spacer(minLength: 8)
                // Время идёт само: обновлять активность ради часов нельзя —
                // система ограничивает частоту обновлений, и они нужны на
                // деньги.
                Text(context.attributes.openedAt, style: .timer)
                    .font(.callout.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: 74, alignment: .trailing)
            }

            HStack(spacing: 14) {
                if context.state.hasHall {
                    // Ближайшее окончание — то, ради чего оператор клуба и
                    // смотрит на телефон: подойти и спросить, продлевают ли.
                    if let ends = context.state.nextSessionEndsAt {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(ends > Date() ? "Освободится через" : "Сидит сверх")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                            Text(ends, style: .timer)
                                .font(.callout.weight(.semibold).monospacedDigit())
                                .foregroundStyle(ends > Date() ? Color.primary : Color.orange)
                        }
                    } else {
                        chip("Свободно", "весь зал")
                    }
                    chip("Касса зала", money(context.state.revenue))
                } else {
                    chip("Чеков", "\(context.state.receipts)")
                    chip("Наличные", money(context.state.cash))
                    chip("Kaspi", money(context.state.kaspi))
                }
            }

            if let attention = context.state.attention, !attention.isEmpty {
                Label(attention, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption2)
                    .foregroundStyle(.orange)
                    .lineLimit(1)
            }
        }
        .padding(16)
    }

    // ── Мелочи ───────────────────────────────────────────────────────────────

    private var brand: Color { Color(red: 0.13, green: 0.77, blue: 0.53) }

    /// Главная цифра карточки: у магазина деньги, у клуба занятость зала.
    private func headline(_ state: ShiftActivityAttributes.ContentState) -> String {
        guard state.hasHall else { return money(state.revenue) }
        return "\(state.busyStations ?? 0) из \(state.totalStations ?? 0)"
    }

    private func label(_ title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.callout.weight(.semibold).monospacedDigit())
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
    }

    private func chip(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(title)
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.caption.weight(.medium).monospacedDigit())
                .lineLimit(1)
        }
    }

    /// Суммы целиком, без округления: на них смотрят как на кассу.
    private func money(_ value: Double) -> String {
        Money.format(value)
    }

    /// В «острове» места на две-три цифры — там сокращаем.
    private func shortMoney(_ value: Double) -> String {
        Money.axisTick(value)
    }
}
