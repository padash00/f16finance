import OrdaKit
import OrdaUI
import SwiftUI

// ── Период ───────────────────────────────────────────────────────────────────

struct PeriodPickerSheet: View {
    @Binding var selection: AnalyticsPeriod
    @Environment(\.dismiss) private var dismiss

    @State private var customFrom = Date()
    @State private var customTo = Date()

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(AnalyticsPeriod.presets, id: \.self) { preset in
                        Button {
                            selection = preset
                            dismiss()
                        } label: {
                            HStack {
                                Text(preset.title)
                                    .foregroundStyle(Theme.text)
                                Spacer()
                                let bounds = preset.bounds()
                                Text(AnalyticsPeriod.rangeLabel(from: bounds.from, to: bounds.to))
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.textDim)
                                if preset == selection {
                                    Image(systemName: "checkmark")
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundStyle(Theme.brand)
                                }
                            }
                        }
                    }
                }
                .listRowBackground(Theme.surface)

                Section("Свои даты") {
                    DatePicker("С", selection: $customFrom, displayedComponents: .date)
                        .onChange(of: customFrom) { _, from in
                            if let limit = Calendar.current.date(byAdding: .day, value: 399, to: from), customTo > limit {
                                customTo = limit
                            }
                            if customTo < from { customTo = from }
                        }
                    // Сервер считает не больше 400 дней за раз — дальше даты не
                    // предлагаем, иначе выбор молча упирался бы в ошибку.
                    DatePicker(
                        "По",
                        selection: $customTo,
                        in: customFrom...(Calendar.current.date(byAdding: .day, value: 399, to: customFrom) ?? customFrom),
                        displayedComponents: .date
                    )
                    Button("Показать за эти даты") {
                        selection = .custom(from: Self.iso(customFrom), to: Self.iso(customTo))
                        dismiss()
                    }
                    .disabled(customTo < customFrom)
                }
                .listRowBackground(Theme.surface)
            }
            .brandedListBackground()
            .navigationTitle("Период")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Закрыть") { dismiss() }
                }
            }
            .environment(\.locale, Locale(identifier: "ru_RU"))
            .onAppear {
                let bounds = selection.bounds()
                customFrom = DateParsing.parseDateOnly(bounds.from) ?? Date()
                customTo = DateParsing.parseDateOnly(bounds.to) ?? Date()
            }
        }
    }

    static func iso(_ date: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
}

// ── Точки ────────────────────────────────────────────────────────────────────

struct CompanyPickerSheet: View {
    let companies: [OwnerAnalytics.CompanyOption]
    @Binding var selection: Set<String>
    @Environment(\.dismiss) private var dismiss

    /// Правим копию и применяем по «Готово»: иначе каждая галочка запускала бы
    /// новый запрос, пока человек ещё выбирает.
    @State private var draft: Set<String> = []

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button {
                        draft = []
                    } label: {
                        row(title: "Все точки", subtitle: nil, isOn: draft.isEmpty)
                    }
                }
                .listRowBackground(Theme.surface)
                Section("Точки") {
                    ForEach(companies) { company in
                        Button {
                            if draft.contains(company.id) {
                                draft.remove(company.id)
                            } else {
                                draft.insert(company.id)
                            }
                        } label: {
                            row(
                                title: company.name,
                                subtitle: company.isExtra ? "Не входит в общие итоги" : nil,
                                isOn: draft.contains(company.id)
                            )
                        }
                    }
                }
                .listRowBackground(Theme.surface)
            }
            .brandedListBackground()
            .navigationTitle("Точки")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Готово") {
                        // Выбраны все — это то же, что «все точки», и так понятнее подпись.
                        selection = draft.count == companies.count ? [] : draft
                        dismiss()
                    }
                    .fontWeight(.semibold)
                }
            }
            .onAppear { draft = selection }
        }
    }

    private func row(title: String, subtitle: String?, isOn: Bool) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).foregroundStyle(Theme.text)
                if let subtitle {
                    Text(subtitle)
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                }
            }
            Spacer()
            Image(systemName: isOn ? "checkmark.circle.fill" : "circle")
                .font(.system(size: 18))
                .foregroundStyle(isOn ? Theme.brand : Theme.textDim)
        }
        .contentShape(Rectangle())
    }
}
