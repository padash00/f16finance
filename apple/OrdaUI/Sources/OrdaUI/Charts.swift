import Charts
import OrdaKit
import SwiftUI

/// Цвета рядов данных.
///
/// Набор проверен валидатором палитр в обеих темах: светлота внутри полосы,
/// хрома выше порога, соседние пары различимы и при дальтонизме (ΔE ≥ 22),
/// контраст к поверхности карточки ≥ 3:1.
///
/// Порядок фиксированный и не «прокручивается»: цвет закреплён за сущностью,
/// а не за местом в списке. Иначе фильтр, убравший один ряд, перекрасил бы
/// все остальные — и читатель решил бы, что данные изменились.
public enum ChartPalette {
    /// Первый ряд — основной показатель (выручка, начислено).
    public static let series1 = Color.adaptive(dark: 0x059669, light: 0x047857)
    /// Второй ряд (Kaspi, вторая точка).
    public static let series2 = Color.adaptive(dark: 0x3B82F6, light: 0x2563EB)
    /// Третий ряд.
    public static let series3 = Color.adaptive(dark: 0xEA580C, light: 0xC2410C)

    public static let all: [Color] = [series1, series2, series3]

    /// Цвет ряда по индексу. Больше трёх рядов не выдаём: четвёртый должен
    /// стать «Прочее» или уехать в отдельный график.
    public static func series(_ index: Int) -> Color {
        all[min(max(index, 0), all.count - 1)]
    }

    /// Сетка и оси — приглушённые: данные должны быть заметнее разметки.
    public static var grid: Color { Theme.border }
}

/// Точка временного ряда.
public struct TimePoint: Identifiable, Sendable, Hashable {
    public let id = UUID()
    public let label: String
    public let date: Date
    public let value: Double

    public init(label: String, date: Date, value: Double) {
        self.label = label
        self.date = date
        self.value = value
    }
}

/// Значение по категории — для столбцов.
public struct CategoryPoint: Identifiable, Sendable, Hashable {
    public let id = UUID()
    public let label: String
    public let value: Double
    /// Выделить столбец (сегодня, текущая неделя).
    public let isHighlighted: Bool

    public init(label: String, value: Double, isHighlighted: Bool = false) {
        self.label = label
        self.value = value
        self.isHighlighted = isHighlighted
    }
}

/// График «как менялось во времени» — один ряд, линия с заливкой.
///
/// Легенды нет намеренно: ряд один, и его называет заголовок карточки.
/// Подписи ставим только на крайние точки — число над каждой точкой
/// превращает график в таблицу, которую невозможно читать.
public struct TrendChart: View {
    private let title: String
    private let subtitle: String?
    private let points: [TimePoint]
    private let color: Color
    private let formatter: (Double) -> String

    @State private var selected: TimePoint?

    public init(
        title: String,
        subtitle: String? = nil,
        points: [TimePoint],
        color: Color = ChartPalette.series1,
        formatter: @escaping (Double) -> String = { Money.format($0) }
    ) {
        self.title = title
        self.subtitle = subtitle
        self.points = points
        self.color = color
        self.formatter = formatter
    }

    public var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                header

                if points.isEmpty {
                    emptyPlot
                } else {
                    chart
                }
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: Spacing.xxs) {
            HStack {
                Text(title)
                    .font(Typography.label)
                    .foregroundStyle(Theme.textDim)
                    .textCase(.uppercase)
                Spacer()
                if let selected {
                    Text("\(selected.label) · \(formatter(selected.value))")
                        .font(Typography.caption.weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(Theme.text)
                }
            }
            if let subtitle, selected == nil {
                Text(subtitle)
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
            }
        }
    }

    private var chart: some View {
        Chart {
            ForEach(points) { point in
                AreaMark(x: .value("Время", point.date), y: .value("Сумма", point.value))
                    .foregroundStyle(
                        LinearGradient(
                            colors: [color.opacity(0.28), color.opacity(0.02)],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .interpolationMethod(.monotone)

                LineMark(x: .value("Время", point.date), y: .value("Сумма", point.value))
                    .foregroundStyle(color)
                    .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round))
                    .interpolationMethod(.monotone)
            }

            if let selected {
                RuleMark(x: .value("Время", selected.date))
                    .foregroundStyle(Theme.textDim.opacity(0.4))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))

                PointMark(x: .value("Время", selected.date), y: .value("Сумма", selected.value))
                    .foregroundStyle(color)
                    .symbolSize(90)
                    // Кольцо цвета поверхности отделяет точку от линии под ней.
                    .annotation(position: .overlay) {
                        Circle()
                            .strokeBorder(Theme.surface, lineWidth: 2)
                            .frame(width: 12, height: 12)
                    }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading) { value in
                AxisGridLine().foregroundStyle(ChartPalette.grid.opacity(0.5))
                AxisValueLabel {
                    if let amount = value.as(Double.self) {
                        Text(Money.axisTick(amount))
                            .font(.system(size: 10))
                            .foregroundStyle(Theme.textDim)
                    }
                }
            }
        }
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: 4)) { _ in
                AxisGridLine().foregroundStyle(ChartPalette.grid.opacity(0.3))
                AxisValueLabel()
                    .font(.system(size: 10))
                    .foregroundStyle(Theme.textDim)
            }
        }
        .chartXSelection(value: Binding(
            get: { selected?.date },
            set: { date in
                guard let date else { selected = nil; return }
                selected = points.min { abs($0.date.timeIntervalSince(date)) < abs($1.date.timeIntervalSince(date)) }
            }
        ))
        .frame(height: 160)
    }

    private var emptyPlot: some View {
        VStack(spacing: Spacing.sm) {
            Image(systemName: "chart.line.uptrend.xyaxis")
                .font(.system(size: 22, weight: .light))
                .foregroundStyle(Theme.textDim)
            Text("Пока нет данных")
                .font(Typography.caption)
                .foregroundStyle(Theme.textDim)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 160)
    }
}

/// Столбцы по категориям — «сколько в каждом дне/точке».
///
/// Столбцы тонкие, с 4-точечным скруглением сверху и зазором цвета поверхности
/// между соседями. Подписи значений — только на выделенном столбце.
public struct CategoryBarChart: View {
    private let title: String
    private let points: [CategoryPoint]
    private let color: Color
    private let formatter: (Double) -> String

    public init(
        title: String,
        points: [CategoryPoint],
        color: Color = ChartPalette.series1,
        formatter: @escaping (Double) -> String = { Money.format($0) }
    ) {
        self.title = title
        self.points = points
        self.color = color
        self.formatter = formatter
    }

    public var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                Text(title)
                    .font(Typography.label)
                    .foregroundStyle(Theme.textDim)
                    .textCase(.uppercase)

                if points.isEmpty {
                    Text("Пока нет данных")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                        .frame(maxWidth: .infinity)
                        .frame(height: 140)
                } else {
                    Chart(points) { point in
                        BarMark(
                            x: .value("Категория", point.label),
                            y: .value("Сумма", point.value),
                            width: .fixed(18)
                        )
                        .foregroundStyle(point.isHighlighted ? color : color.opacity(0.45))
                        .cornerRadius(4)
                        .annotation(position: .top) {
                            // Подписываем только выделенный столбец: число над
                            // каждым превращает график в нечитаемую таблицу.
                            if point.isHighlighted, point.value > 0 {
                                Text(formatter(point.value))
                                    .font(.system(size: 10, weight: .semibold))
                                    .monospacedDigit()
                                    .foregroundStyle(Theme.text)
                            }
                        }
                    }
                    .chartYAxis {
                        AxisMarks(position: .leading) { value in
                            AxisGridLine().foregroundStyle(ChartPalette.grid.opacity(0.5))
                            AxisValueLabel {
                                if let amount = value.as(Double.self) {
                                    Text(Money.axisTick(amount))
                                        .font(.system(size: 10))
                                        .foregroundStyle(Theme.textDim)
                                }
                            }
                        }
                    }
                    .chartXAxis {
                        AxisMarks { _ in
                            AxisValueLabel()
                                .font(.system(size: 10))
                                .foregroundStyle(Theme.textDim)
                        }
                    }
                    .frame(height: 150)
                }
            }
        }
    }
}

/// Кольцо прогресса.
///
/// Не график: одно число — это заголовок, а не ряд данных. Кольцо читается
/// мгновенно и хорошо ложится в плитку дашборда.
public struct ProgressRing: View {
    private let progress: Double
    private let label: String
    private let caption: String?
    private let color: Color

    public init(progress: Double, label: String, caption: String? = nil, color: Color = Theme.brand) {
        self.progress = min(max(progress, 0), 1)
        self.label = label
        self.caption = caption
        self.color = color
    }

    public var body: some View {
        VStack(spacing: Spacing.sm) {
            ZStack {
                Circle()
                    .stroke(Theme.surfaceRaised, lineWidth: 10)

                Circle()
                    .trim(from: 0, to: progress)
                    .stroke(color, style: StrokeStyle(lineWidth: 10, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(Motion.value, value: progress)

                Text(label)
                    .font(Typography.monospacedDigits(Typography.title))
                    .foregroundStyle(Theme.text)
                    .contentTransition(.numericText())
            }
            .frame(width: 92, height: 92)

            if let caption {
                Text(caption)
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
                    .multilineTextAlignment(.center)
            }
        }
    }
}

/// Горизонтальная полоса-разбивка: наличные / Kaspi и т.п.
///
/// Между сегментами зазор цвета поверхности — иначе две заливки сливаются в
/// одну и границу приходится угадывать.
public struct SplitBar: View {
    public struct Segment: Identifiable, Sendable {
        public let id = UUID()
        public let label: String
        public let value: Double
        public let color: Color

        public init(label: String, value: Double, color: Color) {
            self.label = label
            self.value = value
            self.color = color
        }
    }

    private let segments: [Segment]
    private let total: Double

    public init(segments: [Segment]) {
        self.segments = segments.filter { $0.value > 0 }
        self.total = segments.reduce(0) { $0 + max($1.value, 0) }
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            GeometryReader { proxy in
                HStack(spacing: 2) {
                    ForEach(segments) { segment in
                        Capsule()
                            .fill(segment.color)
                            .frame(width: width(for: segment, in: proxy.size.width))
                    }
                }
            }
            .frame(height: 10)

            // Легенда обязательна: два и более ряда не должны различаться
            // только цветом.
            HStack(spacing: Spacing.lg) {
                ForEach(segments) { segment in
                    HStack(spacing: Spacing.xs) {
                        Circle().fill(segment.color).frame(width: 8, height: 8)
                        Text(segment.label)
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textMuted)
                        Text(Money.format(segment.value))
                            .font(Typography.caption.weight(.semibold))
                            .monospacedDigit()
                            .foregroundStyle(Theme.text)
                    }
                }
                Spacer(minLength: 0)
            }
        }
    }

    private func width(for segment: Segment, in available: CGFloat) -> CGFloat {
        guard total > 0 else { return 0 }
        let gaps = CGFloat(max(segments.count - 1, 0)) * 2
        return max(4, (available - gaps) * CGFloat(segment.value / total))
    }
}
