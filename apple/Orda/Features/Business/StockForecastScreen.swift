import OrdaKit
import OrdaUI
import SwiftUI

/// Прогноз склада: что закончится раньше всего.
///
/// На сайте это отдельная страница, в приложении её открывал экран аналитики
/// магазина — то есть вопрос «что скоро кончится» задать было нельзя. Порядок
/// строк задаёт сервер: сначала критичные, потом по остатку дней.
struct StockForecastScreen: View {
    @Environment(\.api) private var api
    @State private var store: StockForecastStore?
    @State private var onlyUrgent = false

    var body: some View {
        Group {
            if let store {
                if let error = store.error, store.rows == nil {
                    ErrorStateView(error: error) { Task { await store.load() } }
                } else if let rows = store.rows {
                    list(rows)
                } else {
                    LoadingRows(count: 8)
                }
            } else {
                LoadingRows(count: 8)
            }
        }
        .background(Theme.background)
        .navigationTitle("Прогноз склада")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Toggle(isOn: $onlyUrgent) {
                    Label("Только срочное", systemImage: "exclamationmark.triangle")
                }
                .toggleStyle(.button)
            }
            LogoutToolbarItem()
        }
        .task {
            if store == nil {
                let created = StockForecastStore(api: api)
                store = created
                await created.load()
            }
        }
        .refreshable { await store?.load() }
    }

    @ViewBuilder
    private func list(_ rows: [StockForecastRow]) -> some View {
        let shown = onlyUrgent ? rows.filter(\.isUrgent) : rows

        if shown.isEmpty {
            WideEmptyState(
                icon: "chart.line.downtrend.xyaxis",
                title: onlyUrgent ? "Срочного нет" : "Считать нечего",
                message: onlyUrgent
                    ? "Ни одна позиция не кончается в ближайшую неделю."
                    : "Нет ни остатков, ни продаж за последние 30 дней."
            )
        } else {
            ScrollView {
                LazyVStack(spacing: 0) {
                    summary(rows)

                    ForEach(shown) { row in
                        ForecastRowView(row: row)
                            .padding(.horizontal, Spacing.lg)
                            .padding(.vertical, Spacing.sm)
                        RowDivider().padding(.horizontal, Spacing.lg)
                    }
                }
                .padding(.vertical, Spacing.sm)
            }
        }
    }

    private func summary(_ rows: [StockForecastRow]) -> some View {
        let critical = rows.filter { $0.status == "critical" }.count
        let warning = rows.filter { $0.status == "warning" }.count
        let idle = rows.filter { $0.status == "no_sales" }.count

        return Card {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                if critical > 0 {
                    StatRow("Кончается за 3 дня", value: "\(critical)", valueColor: Theme.negative, icon: "exclamationmark.triangle")
                }
                if warning > 0 {
                    if critical > 0 { RowDivider() }
                    StatRow("На исходе, до недели", value: "\(warning)", valueColor: Theme.warning, icon: "clock")
                }
                if idle > 0 {
                    if critical > 0 || warning > 0 { RowDivider() }
                    // Не срочно, но важно: деньги стоят на полке мёртвым грузом.
                    StatRow("Не продавалось за 30 дней", value: "\(idle)", icon: "zzz")
                }
                if critical == 0 && warning == 0 && idle == 0 {
                    StatRow("Запаса хватает по всем позициям", value: "\(rows.count)", valueColor: Theme.positive, icon: "checkmark.circle")
                }
            }
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.bottom, Spacing.sm)
    }
}

private struct ForecastRowView: View {
    let row: StockForecastRow

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(row.name)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .lineLimit(2)

                Text(subtitle)
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: Spacing.xs) {
                if let days = row.daysLeft {
                    Text("\(days) \(pluralize(days, "день", "дня", "дней"))")
                        .font(Typography.callout.weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(daysColor)
                }
                StatusChip(row.statusLabel, kind: chipKind)
            }
        }
    }

    private var subtitle: String {
        var parts = ["остаток \(Quantity.format(row.balance))"]
        if row.dailyVelocity > 0 {
            parts.append("\(Quantity.format(row.dailyVelocity)) в день")
        }
        if let category = row.categoryName, !category.isEmpty { parts.append(category) }
        return parts.joined(separator: " · ")
    }

    private var daysColor: Color {
        switch row.status {
        case "critical": Theme.negative
        case "warning": Theme.warning
        default: Theme.text
        }
    }

    private var chipKind: StatusChip.Kind {
        switch row.status {
        case "critical": .danger
        case "warning": .warning
        case "low": .info
        case "no_sales": .neutral
        default: .good
        }
    }
}

@MainActor
@Observable
final class StockForecastStore {
    private(set) var rows: [StockForecastRow]?
    private(set) var error: APIError?

    private let service: BusinessService

    init(api: APIClient) {
        self.service = BusinessService(api: api)
    }

    func load() async {
        do {
            rows = try await service.stockForecast()
            error = nil
        } catch let apiError as APIError {
            error = apiError
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }
}
