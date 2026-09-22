import OrdaKit
import OrdaUI
import SwiftUI

/// Выбор периода для любого аналитического экрана.
///
/// Быстрые кнопки — то, что берут чаще всего; календарь — все готовые периоды
/// и свои даты «с … по …». Под кнопками — точные даты: «месяц» без дат
/// непонятно, календарный он или последние тридцать дней.
struct PeriodBar: View {
    @Binding var selection: AnalyticsPeriod
    var quick: [AnalyticsPeriod] = [.thisWeek, .thisMonth, .thisQuarter, .thisYear]
    /// Что дописать справа от дат — «сравнение: …» и тому подобное.
    var trailing: AnyView? = nil
    /// Показать кнопку «учесть F16 Extra» — там, где отчёт её понимает.
    var showsExtra = false

    @State private var showsPicker = false

    /// Выбор вне быстрых кнопок — подсвечиваем календарь.
    private var isOther: Bool { !quick.contains(selection) }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack(spacing: Spacing.sm) {
                PillSegment(
                    options: quick.map { (Optional($0), $0.shortTitle) },
                    selection: Binding(
                        get: { isOther ? nil : Optional(selection) },
                        set: { if let value = $0 { selection = value } }
                    )
                )
                Button {
                    showsPicker = true
                } label: {
                    Image(systemName: "calendar")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(isOther ? Color.white : Theme.text)
                        .frame(width: 44, height: 44)
                        .background(isOther ? AnyShapeStyle(Theme.brand) : AnyShapeStyle(Theme.surfaceRaised), in: Circle())
                }
                .buttonStyle(.pressable)
                .accessibilityLabel("Выбрать даты")
            }

            HStack(spacing: 4) {
                if isOther {
                    Text(selection.isCustom ? "Свои даты" : selection.title)
                        .fontWeight(.semibold)
                        .foregroundStyle(Theme.brand)
                    Text("·")
                }
                let bounds = selection.bounds()
                Text(AnalyticsPeriod.rangeLabel(from: bounds.from, to: bounds.to))
                if let trailing {
                    Text("·")
                    trailing
                }
            }
            .font(.system(size: 13))
            .foregroundStyle(Theme.textDim)
            .monospacedDigit()
            .padding(.horizontal, Spacing.xs)

            if showsExtra {
                ExtraCashToggle()
            }
        }
        .sheet(isPresented: $showsPicker) {
            PeriodPickerSheet(selection: $selection)
                .presentationDetents([.medium, .large])
        }
    }
}
