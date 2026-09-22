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
        .toolbar { LogoutToolbarItem() }
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

        if rows.isEmpty {
            WideEmptyState(
                icon: "chart.line.downtrend.xyaxis",
                title: "Считать нечего",
                message: "Нет ни остатков, ни продаж за последние 30 дней."
            )
        } else {
            ScrollView {
                VStack(spacing: Spacing.lg) {
                    summary(rows)

                    // Фильтр — кнопками над списком, а не переключателем в
                    // панели: там его не замечали, и «срочное» не находили.
                    PillSegment(
                        options: [(value: false, title: "Все"), (value: true, title: "Срочное")] as [(value: Bool, title: String)],
                        selection: $onlyUrgent
                    )

                    if shown.isEmpty {
                        WideEmptyState(
                            icon: "checkmark.seal",
                            title: "Срочного нет",
                            message: "Ни одна позиция не кончается в ближайшую неделю."
                        )
                        .padding(.top, Spacing.lg)
                    } else {
                        // Список ленивый и на белой подложке: позиций на складе
                        // бывают сотни, строить их все сразу незачем.
                        LazyVStack(spacing: 0) {
                            ForEach(Array(shown.enumerated()), id: \.element.id) { index, row in
                                if index > 0 { RowDivider().padding(.leading, 40 + Spacing.md) }
                                ForecastRowView(row: row)
                                    .padding(.vertical, Spacing.sm)
                            }
                        }
                        .padding(.horizontal, Spacing.lg)
                        .padding(.vertical, Spacing.sm)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
                    }
                }
                .padding(.horizontal, Spacing.lg)
                .padding(.bottom, Spacing.xxl)
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
            }
        }
    }

    /// Сколько позиций вот-вот кончится — главная цифра; разбивка по срокам и
    /// залежавшееся — под ней. Цвет карточки — по самому срочному.
    private func summary(_ rows: [StockForecastRow]) -> some View {
        let critical = rows.filter { $0.status == "critical" }.count
        let warning = rows.filter { $0.status == "warning" }.count
        // Не срочно, но важно: деньги стоят на полке мёртвым грузом.
        let idle = rows.filter { $0.status == "no_sales" }.count
        let urgent = critical + warning

        return Group {
            if urgent > 0 {
                HeroSummary(
                    title: "Скоро закончится",
                    value: "\(urgent) \(pluralize(urgent, "позиция", "позиции", "позиций"))",
                    caption: "из \(rows.count) на складе",
                    footer: [
                        ("За 3 дня", "\(critical)"),
                        ("До недели", "\(warning)"),
                        ("Без продаж 30 дн.", "\(idle)"),
                    ],
                    colors: critical > 0
                        ? [Color(hex: 0xE11D48), Color(hex: 0x9F1239)]
                        : [Color(hex: 0xF59E0B), Color(hex: 0xEA580C)]
                )
            } else {
                HeroSummary(
                    title: "Запаса хватает",
                    value: "\(rows.count) \(pluralize(rows.count, "позиция", "позиции", "позиций"))",
                    caption: "ничего не кончается в ближайшую неделю",
                    footer: idle > 0 ? [("Без продаж 30 дн.", "\(idle)")] : [],
                    colors: [Color(hex: 0x059669), Color(hex: 0x0F766E)]
                )
            }
        }
    }
}

private struct ForecastRowView: View {
    let row: StockForecastRow

    var body: some View {
        HStack(spacing: Spacing.md) {
            TintedIcon(systemName: icon, tint: tint, size: 40)

            VStack(alignment: .leading, spacing: 4) {
                Text(row.name)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Theme.text)
                    .lineLimit(2)

                Text(subtitle)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }

            Spacer(minLength: Spacing.sm)

            // Статус — цветной подписью, а не плашкой: плашка съедала место
            // у названия, и длинные позиции обрезались.
            VStack(alignment: .trailing, spacing: 4) {
                if let days = row.daysLeft {
                    Text("\(days) \(pluralize(days, "день", "дня", "дней"))")
                        .font(.system(size: 16, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(daysColor)
                }
                Text(row.statusLabel)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(tint)
            }
        }
        .contentShape(Rectangle())
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

    private var tint: Color {
        switch row.status {
        case "critical": Theme.negative
        case "warning": Theme.warning
        case "low": Theme.info
        case "no_sales": Theme.textDim
        default: Theme.positive
        }
    }

    private var icon: String {
        switch row.status {
        case "critical": "exclamationmark.triangle.fill"
        case "warning": "clock.fill"
        case "low": "arrow.down.circle.fill"
        case "no_sales": "zzz"
        default: "checkmark.circle.fill"
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
