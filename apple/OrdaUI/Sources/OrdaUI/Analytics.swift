import Charts
import OrdaKit
import SwiftUI

// ── Компоненты аналитики владельца ───────────────────────────────────────────
//
// Карточка показателя, график со сравнением, доли, тепловая карта и таблица с
// сортировкой. Всё рассчитано на одно правило: цифра всегда рядом со своей
// базой сравнения, а цвет изменения — по смыслу, а не по знаку. Рост расходов
// красный, хотя стрелка смотрит вверх.

/// Изменение к базе с цветом по смыслу.
public struct DeltaBadge: View {
    private let change: Double?
    private let higherIsBetter: Bool
    private let inPoints: Bool

    /// - Parameters:
    ///   - change: процент изменения; nil — базы нет.
    ///   - inPoints: изменение доли (маржи) — в процентных пунктах: маржа
    ///     20 % → 22 % — это «+2 п.п.», а не «+10 %».
    public init(change: Double?, higherIsBetter: Bool = true, inPoints: Bool = false) {
        self.change = change
        self.higherIsBetter = higherIsBetter
        self.inPoints = inPoints
    }

    private func text(_ change: Double) -> String {
        guard inPoints else { return Percent.format(change, signed: true) }
        return Percent.format(change, signed: true).replacingOccurrences(of: "\u{202F}%", with: "\u{202F}п.п.")
    }

    public var body: some View {
        if let change {
            let rising = change >= 0
            let good = abs(change) < 0.05 ? nil : (rising == higherIsBetter)
            let tint = good.map { $0 ? Theme.positive : Theme.negative } ?? Theme.textDim
            HStack(spacing: Spacing.xxs) {
                Image(systemName: rising ? "arrow.up.right" : "arrow.down.right")
                    .font(.system(size: 9, weight: .bold))
                Text(text(change))
                    .font(Typography.caption.weight(.semibold))
                    .monospacedDigit()
            }
            .foregroundStyle(tint)
            .padding(.horizontal, Spacing.sm - 2)
            .padding(.vertical, Spacing.xxs + 1)
            .background(tint.opacity(0.12), in: Capsule())
            .accessibilityLabel(rising ? "рост на \(Percent.format(change))" : "падение на \(Percent.format(change))")
        } else {
            Text("нет базы")
                .font(Typography.caption)
                .foregroundStyle(Theme.textDim)
        }
    }
}

/// Карточка ключевого показателя: значение, изменение, «было» и мини-график.
///
/// «Было X» рядом с процентом обязательно: «+40 %» с 5 000 ₸ и с 5 млн — разные
/// новости, и без базы процент ничего не говорит.
public struct KPICard: View {
    private let title: String
    private let icon: String
    private let value: String
    private let previous: String?
    private let change: Double?
    private let higherIsBetter: Bool
    private let spark: [Double]
    private let accent: Color
    private let isSelected: Bool
    private let changeInPoints: Bool

    public init(
        title: String,
        icon: String,
        value: String,
        previous: String?,
        change: Double?,
        higherIsBetter: Bool = true,
        spark: [Double] = [],
        accent: Color = ChartPalette.series1,
        isSelected: Bool = false,
        changeInPoints: Bool = false
    ) {
        self.changeInPoints = changeInPoints
        self.title = title
        self.icon = icon
        self.value = value
        self.previous = previous
        self.change = change
        self.higherIsBetter = higherIsBetter
        self.spark = spark
        self.accent = accent
        self.isSelected = isSelected
    }

    public var body: some View {
        Card(padding: Spacing.md, accent: isSelected ? accent : nil) {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                HStack(spacing: Spacing.xs) {
                    Image(systemName: icon)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(accent)
                    Text(title)
                        .font(Typography.label)
                        .foregroundStyle(Theme.textDim)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                }

                Text(value)
                    .font(Typography.monospacedDigits(.system(.title3, design: .rounded).weight(.bold)))
                    .foregroundStyle(Theme.text)
                    .contentTransition(.numericText())
                    .animation(Motion.value, value: value)
                    .lineLimit(1)
                    .minimumScaleFactor(0.55)

                HStack(alignment: .center, spacing: Spacing.xs) {
                    DeltaBadge(change: change, higherIsBetter: higherIsBetter, inPoints: changeInPoints)
                    Spacer(minLength: 0)
                    if spark.count > 1 {
                        Sparkline(values: spark, color: accent)
                            .frame(width: 54, height: 20)
                    }
                }

                if let previous {
                    Text("было \(previous)")
                        .font(.system(size: 11))
                        .monospacedDigit()
                        .foregroundStyle(Theme.textDim)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Мини-график тренда без осей — только форма.
public struct Sparkline: View {
    private let values: [Double]
    private let color: Color

    public init(values: [Double], color: Color) {
        self.values = values
        self.color = color
    }

    public var body: some View {
        Chart {
            ForEach(Array(values.enumerated()), id: \.offset) { index, value in
                LineMark(x: .value("i", index), y: .value("v", value))
                    .foregroundStyle(color)
                    .lineStyle(StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
                    .interpolationMethod(.monotone)
            }
        }
        .chartXAxis(.hidden)
        .chartYAxis(.hidden)
        .chartLegend(.hidden)
        .accessibilityHidden(true)
    }
}

// ── График со сравнением ─────────────────────────────────────────────────────

/// Точка графика: текущее значение и значение базы на том же месте.
public struct ComparisonPoint: Identifiable, Hashable, Sendable {
    public let id: Int
    public let date: Date
    public let label: String
    public let value: Double
    public let previousLabel: String
    public let previous: Double

    public init(id: Int, date: Date, label: String, value: Double, previousLabel: String, previous: Double) {
        self.id = id
        self.date = date
        self.label = label
        self.value = value
        self.previousLabel = previousLabel
        self.previous = previous
    }
}

/// Линия периода поверх пунктира базы сравнения.
///
/// Касание показывает обе цифры: «22 сен — 184 500 ₸ · было 150 000 ₸». База
/// нарисована на тех же датах, что и текущий период, — иначе прошлогодний
/// сентябрь уехал бы на год влево.
public struct ComparisonChart: View {
    private let points: [ComparisonPoint]
    private let color: Color
    private let showsPrevious: Bool
    private let asBars: Bool
    private let height: CGFloat

    @State private var selectedID: Int?

    public init(
        points: [ComparisonPoint],
        color: Color = ChartPalette.series1,
        showsPrevious: Bool = true,
        asBars: Bool = false,
        height: CGFloat = 200
    ) {
        self.points = points
        self.color = color
        self.showsPrevious = showsPrevious
        self.asBars = asBars
        self.height = height
    }

    private var selected: ComparisonPoint? {
        selectedID.flatMap { id in points.first { $0.id == id } }
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            readout
            if points.isEmpty {
                ChartEmptyPlot(height: height)
            } else {
                chart
            }
        }
    }

    /// Строка над графиком: выбранная точка или легенда.
    @ViewBuilder
    private var readout: some View {
        if let selected {
            HStack(spacing: Spacing.sm) {
                Text(selected.label)
                    .foregroundStyle(Theme.textMuted)
                Text(Money.format(selected.value))
                    .foregroundStyle(Theme.text)
                    .fontWeight(.semibold)
                if showsPrevious {
                    Text("· было \(Money.format(selected.previous))")
                        .foregroundStyle(Theme.textDim)
                }
            }
            .font(Typography.caption)
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.7)
        } else {
            HStack(spacing: Spacing.md) {
                LegendSwatch(color: color, title: "Текущий период", dashed: false)
                if showsPrevious {
                    LegendSwatch(color: Theme.textDim, title: "База сравнения", dashed: true)
                }
            }
        }
    }

    private var chart: some View {
        Chart {
            ForEach(points) { point in
                if asBars {
                    // Ширина столбика ограничена: при двух днях автоматическая
                    // растягивала их на полэкрана.
                    BarMark(x: .value("Дата", point.date, unit: .day), y: .value("Сумма", point.value), width: .fixed(points.count <= 12 ? 22 : 8))
                        .foregroundStyle(color.opacity(selectedID == nil || selectedID == point.id ? 1 : 0.35))
                        .cornerRadius(4)
                } else {
                    AreaMark(x: .value("Дата", point.date), y: .value("Сумма", point.value), series: .value("Ряд", "cur"))
                        .foregroundStyle(
                            LinearGradient(colors: [color.opacity(0.24), color.opacity(0.01)], startPoint: .top, endPoint: .bottom)
                        )
                        .interpolationMethod(.monotone)
                    LineMark(x: .value("Дата", point.date), y: .value("Сумма", point.value), series: .value("Ряд", "cur"))
                        .foregroundStyle(color)
                        .lineStyle(StrokeStyle(lineWidth: 2.2, lineCap: .round, lineJoin: .round))
                        .interpolationMethod(.monotone)
                }
                if showsPrevious {
                    LineMark(
                        x: asBars ? .value("Дата", point.date, unit: .day) : .value("Дата", point.date),
                        y: .value("Сумма", point.previous),
                        series: .value("Ряд", "prev")
                    )
                        .foregroundStyle(Theme.textDim.opacity(0.8))
                        .lineStyle(StrokeStyle(lineWidth: 1.4, lineCap: .round, dash: [4, 4]))
                        .interpolationMethod(.monotone)
                }
            }

            if let selected {
                RuleMark(x: .value("Дата", selected.date))
                    .foregroundStyle(Theme.textDim.opacity(0.4))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                if !asBars {
                    PointMark(x: .value("Дата", selected.date), y: .value("Сумма", selected.value))
                        .foregroundStyle(color)
                        .symbolSize(70)
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) { value in
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
            // Мало точек — подпись ровно у каждой: автоматические деления на
            // трёх днях повторяли одну дату дважды.
            if points.count <= 8 {
                AxisMarks(values: points.map(\.date)) { _ in
                    AxisValueLabel(format: .dateTime.day().month(.abbreviated), centered: true)
                        .font(.system(size: 10))
                        .foregroundStyle(Theme.textDim)
                }
            } else {
                AxisMarks(values: .automatic(desiredCount: 5)) { _ in
                    AxisGridLine().foregroundStyle(ChartPalette.grid.opacity(0.25))
                    AxisValueLabel(format: .dateTime.day().month(.abbreviated))
                        .font(.system(size: 10))
                        .foregroundStyle(Theme.textDim)
                }
            }
        }
        .chartXSelection(value: Binding(
            get: { selected?.date },
            set: { date in
                guard let date else { selectedID = nil; return }
                selectedID = points.min {
                    abs($0.date.timeIntervalSince(date)) < abs($1.date.timeIntervalSince(date))
                }?.id
            }
        ))
        .frame(height: height)
        .environment(\.locale, Locale(identifier: "ru_RU"))
    }
}

/// Образец цвета для легенды: сплошная линия или пунктир.
public struct LegendSwatch: View {
    let color: Color
    let title: String
    let dashed: Bool

    public init(color: Color, title: String, dashed: Bool = false) {
        self.color = color
        self.title = title
        self.dashed = dashed
    }

    public var body: some View {
        HStack(spacing: Spacing.xs) {
            Path { path in
                path.move(to: CGPoint(x: 0, y: 4))
                path.addLine(to: CGPoint(x: 16, y: 4))
            }
            .stroke(color, style: StrokeStyle(lineWidth: 2, lineCap: .round, dash: dashed ? [3, 3] : []))
            .frame(width: 16, height: 8)
            Text(title)
                .font(.system(size: 11))
                .foregroundStyle(Theme.textDim)
        }
    }
}

struct ChartEmptyPlot: View {
    let height: CGFloat

    var body: some View {
        VStack(spacing: Spacing.sm) {
            Image(systemName: "chart.xyaxis.line")
                .font(.system(size: 22, weight: .light))
                .foregroundStyle(Theme.textDim)
            Text("За период данных нет")
                .font(Typography.caption)
                .foregroundStyle(Theme.textDim)
        }
        .frame(maxWidth: .infinity)
        .frame(height: height)
    }
}

// ── Доли ─────────────────────────────────────────────────────────────────────

/// Доля в целом: кусок кольца и строка легенды.
public struct ShareSlice: Identifiable, Hashable, Sendable {
    public let id: String
    public let label: String
    public let value: Double
    public let color: Color

    public init(id: String? = nil, label: String, value: Double, color: Color) {
        self.id = id ?? label
        self.label = label
        self.value = value
        self.color = color
    }
}

/// Цвета долей. Первые — палитра рядов, дальше — фиолетовый и серый «Прочее».
/// Больше пяти кусков кольцо не держит: мелочь собирается в «Прочее».
public enum SharePalette {
    public static let colors: [Color] = [
        ChartPalette.series1, ChartPalette.series2, ChartPalette.series3, Theme.accent,
    ]
    public static let other = Theme.textDim

    /// Крупные доли как есть, остальное — одним куском «Прочее».
    public static func slices(_ items: [(label: String, value: Double)], limit: Int = 4) -> [ShareSlice] {
        let positive = items.filter { $0.value > 0 }.sorted { $0.value > $1.value }
        var result = positive.prefix(limit).enumerated().map { index, item in
            ShareSlice(label: item.label, value: item.value, color: colors[min(index, colors.count - 1)])
        }
        let rest = positive.dropFirst(limit).reduce(0) { $0 + $1.value }
        if rest > 0 { result.append(ShareSlice(label: "Прочее", value: rest, color: other)) }
        return result
    }
}

/// Кольцо долей с итогом в центре и легендой с суммами и процентами.
public struct DonutChart: View {
    private let slices: [ShareSlice]
    private let centerTitle: String
    private let centerValue: String

    public init(slices: [ShareSlice], centerTitle: String, centerValue: String) {
        self.slices = slices
        self.centerTitle = centerTitle
        self.centerValue = centerValue
    }

    private var total: Double { slices.reduce(0) { $0 + $1.value } }

    public var body: some View {
        if total <= 0 {
            ChartEmptyPlot(height: 140)
        } else {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .center, spacing: Spacing.lg) {
                    ring.frame(width: 140, height: 140)
                    legend
                }
                VStack(spacing: Spacing.md) {
                    ring.frame(width: 150, height: 150)
                    legend
                }
            }
        }
    }

    private var ring: some View {
        Chart(slices) { slice in
            SectorMark(angle: .value("Сумма", slice.value), innerRadius: .ratio(0.64), angularInset: 1.2)
                .foregroundStyle(slice.color)
                .cornerRadius(3)
        }
        .chartLegend(.hidden)
        .chartBackground { _ in
            VStack(spacing: 0) {
                Text(centerTitle)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(Theme.textDim)
                Text(centerValue)
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
            .padding(.horizontal, Spacing.lg)
        }
    }

    private var legend: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            ForEach(slices) { slice in
                HStack(spacing: Spacing.sm) {
                    Circle().fill(slice.color).frame(width: 8, height: 8)
                    Text(slice.label)
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textMuted)
                        .lineLimit(1)
                    Spacer(minLength: Spacing.sm)
                    Text(Money.format(slice.value))
                        .font(Typography.caption.weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(Theme.text)
                    Text(Percent.format(slice.value / total * 100))
                        .font(.system(size: 11))
                        .monospacedDigit()
                        .foregroundStyle(Theme.textDim)
                        .frame(minWidth: 40, alignment: .trailing)
                }
            }
        }
        .frame(maxWidth: .infinity)
    }
}

// ── Рейтинг полосами ─────────────────────────────────────────────────────────

/// Строка рейтинга: название, полоса доли от лидера, сумма и изменение.
public struct RankedBarRow: Identifiable, Hashable, Sendable {
    public let id: String
    public let label: String
    public let value: Double
    public let change: Double?
    public let caption: String?

    public init(id: String, label: String, value: Double, change: Double?, caption: String? = nil) {
        self.id = id
        self.label = label
        self.value = value
        self.change = change
        self.caption = caption
    }
}

/// Горизонтальные полосы «кто сколько» — точки, статьи, операторы.
///
/// Полоса считается от лидера, а не от суммы: так разница между вторым и
/// третьим видна, даже когда лидер забирает половину.
public struct RankedBars: View {
    private let rows: [RankedBarRow]
    private let color: Color
    private let higherIsBetter: Bool
    private let onSelect: ((RankedBarRow) -> Void)?

    public init(
        rows: [RankedBarRow],
        color: Color = ChartPalette.series1,
        higherIsBetter: Bool = true,
        onSelect: ((RankedBarRow) -> Void)? = nil
    ) {
        self.rows = rows
        self.color = color
        self.higherIsBetter = higherIsBetter
        self.onSelect = onSelect
    }

    public var body: some View {
        let top = max(rows.map(\.value).max() ?? 0, 1)
        VStack(spacing: Spacing.md) {
            ForEach(rows) { row in
                Button {
                    onSelect?(row)
                } label: {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        HStack(spacing: Spacing.sm) {
                            Text(row.label)
                                .font(Typography.callout)
                                .foregroundStyle(Theme.text)
                                .lineLimit(1)
                            Spacer(minLength: Spacing.sm)
                            Text(Money.format(row.value))
                                .font(Typography.callout.weight(.semibold))
                                .monospacedDigit()
                                .foregroundStyle(Theme.text)
                            if onSelect != nil {
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 10, weight: .semibold))
                                    .foregroundStyle(Theme.textDim)
                            }
                        }
                        GeometryReader { geo in
                            ZStack(alignment: .leading) {
                                Capsule().fill(Theme.surfaceRaised)
                                Capsule()
                                    .fill(color)
                                    .frame(width: max(4, geo.size.width * max(0, row.value) / top))
                            }
                        }
                        .frame(height: 6)
                        HStack(spacing: Spacing.sm) {
                            if let caption = row.caption {
                                Text(caption)
                                    .font(.system(size: 11))
                                    .foregroundStyle(Theme.textDim)
                                    .monospacedDigit()
                            }
                            Spacer(minLength: 0)
                            DeltaBadge(change: row.change, higherIsBetter: higherIsBetter)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(onSelect == nil)
            }
        }
    }
}

// ── Тепловая карта ───────────────────────────────────────────────────────────

/// Выручка по дням недели и часам: где пик, где простой.
///
/// Цвет — одна шкала от прозрачного к насыщенному: здесь нет «плохо/хорошо»,
/// только «больше/меньше». Пустые часы не закрашены вовсе, чтобы ночь без
/// продаж не спорила с дневным пиком.
public struct HeatmapGrid: View {
    private let values: [[Double]]
    private let color: Color
    private static let weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

    @State private var selected: (day: Int, hour: Int)?

    public init(values: [[Double]], color: Color = ChartPalette.series1) {
        self.values = values
        self.color = color
    }

    private var peak: Double { values.flatMap { $0 }.max() ?? 0 }

    /// Часы, в которые хоть что-то продавалось, — остальные обрезаем по краям.
    private var hourRange: ClosedRange<Int> {
        var first = 23
        var last = 0
        for row in values {
            for (hour, value) in row.enumerated() where value > 0 {
                first = min(first, hour)
                last = max(last, hour)
            }
        }
        return first <= last ? first...last : 0...23
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            readout
            if peak <= 0 {
                ChartEmptyPlot(height: 160)
            } else {
                grid
            }
        }
    }

    @ViewBuilder
    private var readout: some View {
        if let selected, values.indices.contains(selected.day), values[selected.day].indices.contains(selected.hour) {
            Text("\(Self.weekdays[selected.day]), \(selected.hour):00–\(selected.hour + 1):00 · \(Money.format(values[selected.day][selected.hour]))")
                .font(Typography.caption.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(Theme.text)
        } else {
            Text("Нажмите на клетку, чтобы увидеть сумму")
                .font(Typography.caption)
                .foregroundStyle(Theme.textDim)
        }
    }

    private var grid: some View {
        let hours = Array(hourRange)
        return VStack(spacing: 3) {
            ForEach(0..<min(values.count, 7), id: \.self) { day in
                HStack(spacing: 3) {
                    Text(Self.weekdays[day])
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(Theme.textDim)
                        .frame(width: 20, alignment: .leading)
                    ForEach(hours, id: \.self) { hour in
                        let value = values[day].indices.contains(hour) ? values[day][hour] : 0
                        let isSelected = selected?.day == day && selected?.hour == hour
                        RoundedRectangle(cornerRadius: 3, style: .continuous)
                            .fill(value > 0 ? color.opacity(0.12 + 0.88 * value / peak) : Theme.surfaceRaised.opacity(0.6))
                            .overlay {
                                if isSelected {
                                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                                        .strokeBorder(Theme.text, lineWidth: 1.5)
                                }
                            }
                            .aspectRatio(1, contentMode: .fit)
                            .onTapGesture { selected = isSelected ? nil : (day, hour) }
                    }
                }
            }
            HStack(spacing: 3) {
                Color.clear.frame(width: 20, height: 1)
                ForEach(hours, id: \.self) { hour in
                    Text(hour % 3 == 0 ? "\(hour)" : "")
                        .font(.system(size: 9))
                        .foregroundStyle(Theme.textDim)
                        .frame(maxWidth: .infinity)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Тепловая карта продаж по дням недели и часам")
    }
}

// ── Таблица с сортировкой ────────────────────────────────────────────────────

/// Колонка таблицы: заголовок, как достать значение для сортировки и как его
/// нарисовать.
public struct DataColumn<Row>: Identifiable {
    public let id: String
    public let title: String
    public let alignment: HorizontalAlignment
    public let width: CGFloat?
    let sortValue: (Row) -> Double
    let text: (Row) -> String

    /// Числовая колонка — сортируется по числу, рисуется строкой.
    public init(
        _ title: String,
        id: String? = nil,
        width: CGFloat? = nil,
        value: @escaping (Row) -> Double,
        text: @escaping (Row) -> String
    ) {
        self.id = id ?? title
        self.title = title
        self.alignment = .trailing
        self.width = width
        self.sortValue = value
        self.text = text
    }
}

/// Таблица: первая колонка — название, дальше — числа. Нажатие на заголовок
/// сортирует, повторное — меняет направление.
///
/// На телефоне лишние колонки уезжают вбок прокруткой, первая колонка остаётся
/// на месте: без названия строка чисел ничего не значит.
public struct DataTable<Row: Identifiable>: View {
    private let rows: [Row]
    private let nameTitle: String
    private let name: (Row) -> String
    private let columns: [DataColumn<Row>]
    private let onSelect: ((Row) -> Void)?
    private let nameWidth: CGFloat

    @State private var sortColumn: String?
    @State private var ascending = false

    public init(
        rows: [Row],
        nameTitle: String,
        nameWidth: CGFloat = 132,
        name: @escaping (Row) -> String,
        columns: [DataColumn<Row>],
        defaultSort: String? = nil,
        onSelect: ((Row) -> Void)? = nil
    ) {
        self.rows = rows
        self.nameTitle = nameTitle
        self.nameWidth = nameWidth
        self.name = name
        self.columns = columns
        self.onSelect = onSelect
        _sortColumn = State(initialValue: defaultSort ?? columns.first?.id)
    }

    private var sorted: [Row] {
        guard let sortColumn, let column = columns.first(where: { $0.id == sortColumn }) else {
            if ascending { return rows.sorted { name($0).localizedCompare(name($1)) == .orderedAscending } }
            return rows
        }
        return rows.sorted {
            ascending ? column.sortValue($0) < column.sortValue($1) : column.sortValue($0) > column.sortValue($1)
        }
    }

    public var body: some View {
        HStack(alignment: .top, spacing: 0) {
            // Название — неподвижная колонка.
            VStack(alignment: .leading, spacing: 0) {
                header(nameTitle, id: nil, alignment: .leading)
                    .frame(width: nameWidth, alignment: .leading)
                ForEach(Array(sorted.enumerated()), id: \.element.id) { index, row in
                    cell {
                        Text(name(row))
                            .font(Typography.callout)
                            .foregroundStyle(Theme.text)
                            .lineLimit(1)
                    }
                    .frame(width: nameWidth, alignment: .leading)
                    .background(index.isMultiple(of: 2) ? Color.clear : Theme.surfaceRaised.opacity(0.5))
                    .contentShape(Rectangle())
                    .onTapGesture { onSelect?(row) }
                }
            }

            ScrollView(.horizontal, showsIndicators: false) {
                VStack(alignment: .trailing, spacing: 0) {
                    HStack(spacing: 0) {
                        ForEach(columns) { column in
                            header(column.title, id: column.id, alignment: .trailing)
                                .frame(minWidth: column.width ?? 104, alignment: .trailing)
                        }
                    }
                    ForEach(Array(sorted.enumerated()), id: \.element.id) { index, row in
                        HStack(spacing: 0) {
                            ForEach(columns) { column in
                                cell {
                                    Text(column.text(row))
                                        .font(Typography.callout)
                                        .monospacedDigit()
                                        .foregroundStyle(column.id == sortColumn ? Theme.text : Theme.textMuted)
                                        .lineLimit(1)
                                }
                                .frame(minWidth: column.width ?? 104, alignment: .trailing)
                            }
                        }
                        .background(index.isMultiple(of: 2) ? Color.clear : Theme.surfaceRaised.opacity(0.5))
                        .contentShape(Rectangle())
                        .onTapGesture { onSelect?(row) }
                    }
                }
            }
        }
    }

    private func header(_ title: String, id: String?, alignment: Alignment) -> some View {
        Button {
            if sortColumn == id {
                ascending.toggle()
            } else {
                sortColumn = id
                // Числа — от больших к меньшим, названия — по алфавиту.
                ascending = id == nil
            }
        } label: {
            HStack(spacing: Spacing.xxs) {
                Text(title)
                    .font(Typography.label)
                    .lineLimit(1)
                if sortColumn == id {
                    Image(systemName: ascending ? "chevron.up" : "chevron.down")
                        .font(.system(size: 8, weight: .bold))
                }
            }
            .foregroundStyle(sortColumn == id ? Theme.text : Theme.textDim)
            .padding(.horizontal, Spacing.sm)
            .padding(.vertical, Spacing.sm)
            .frame(maxWidth: .infinity, alignment: alignment)
        }
        .buttonStyle(.plain)
    }

    private func cell<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        content()
            .padding(.horizontal, Spacing.sm)
            .frame(height: 40)
    }
}
