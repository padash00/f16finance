import OrdaKit
import OrdaUI
import SwiftUI

/// Полоса фильтра над аналитикой: период, точки, база сравнения.
///
/// Одна на все вкладки и всегда на виду: цифра без подписи «за что» читается
/// как «за всё время». Под кнопками — строка, за какие дни данные и с чем
/// сравниваем: «месяц» 22-го числа — это 22 дня, и база тоже 22 дня.
struct AnalyticsFilterBar: View {
    @Environment(AnalyticsStore.self) private var store

    @State private var showsPeriod = false
    @State private var showsCompanies = false

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Spacing.sm) {
                    pill(icon: "calendar", title: store.filter.period.title, isActive: true) {
                        showsPeriod = true
                    }
                    if store.companies.count > 1 || !store.filter.companyIDs.isEmpty {
                        pill(icon: "building.2", title: store.companiesTitle, isActive: !store.filter.isAllCompanies) {
                            showsCompanies = true
                        }
                    }
                    compareMenu
                }
                .padding(.horizontal, Spacing.lg)
            }
            caption
                .padding(.horizontal, Spacing.lg)
        }
        .padding(.vertical, Spacing.sm)
        .background(.bar)
        .sheet(isPresented: $showsPeriod) {
            PeriodPickerSheet(selection: Binding(
                get: { store.filter.period },
                set: { store.filter.period = $0 }
            ))
            .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $showsCompanies) {
            CompanyPickerSheet(
                companies: store.companies,
                selection: Binding(get: { store.filter.companyIDs }, set: { store.filter.companyIDs = $0 })
            )
            .presentationDetents([.medium, .large])
        }
    }

    private var compareMenu: some View {
        Menu {
            Picker("Сравнение", selection: Binding(
                get: { store.filter.compare },
                set: { store.filter.compare = $0 }
            )) {
                ForEach(AnalyticsCompare.allCases) { option in
                    Text(option.title).tag(option)
                }
            }
        } label: {
            pillLabel(icon: "arrow.left.arrow.right", title: "vs \(store.filter.compare.shortTitle)", isActive: false)
        }
    }

    /// «по 22 сен · база 1–22 авг» и признак загрузки.
    private var caption: some View {
        HStack(spacing: Spacing.xs) {
            if let period = store.data?.period {
                let current = AnalyticsPeriod.rangeLabel(from: period.from, to: min(period.through, period.to))
                let base = AnalyticsPeriod.rangeLabel(from: period.prevFrom, to: period.prevTo)
                Text("\(current) · база \(base)" + (period.partial ? " · период идёт" : ""))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            } else {
                let bounds = store.bounds
                Text(AnalyticsPeriod.rangeLabel(from: bounds.from, to: bounds.to))
            }
            if store.isLoading {
                ProgressView().controlSize(.mini)
            }
        }
        .font(.system(size: 11))
        .foregroundStyle(Theme.textDim)
        .monospacedDigit()
    }

    private func pill(icon: String, title: String, isActive: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            pillLabel(icon: icon, title: title, isActive: isActive)
        }
        .buttonStyle(.plain)
    }

    private func pillLabel(icon: String, title: String, isActive: Bool) -> some View {
        HStack(spacing: Spacing.xs) {
            Image(systemName: icon)
                .font(.system(size: 12, weight: .semibold))
            Text(title)
                .font(Typography.callout.weight(.medium))
                .lineLimit(1)
            Image(systemName: "chevron.down")
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(Theme.textDim)
        }
        .foregroundStyle(isActive ? Theme.text : Theme.textMuted)
        .padding(.horizontal, Spacing.md)
        .padding(.vertical, Spacing.sm)
        .background(Theme.surface, in: Capsule())
        .overlay(Capsule().strokeBorder(Theme.border, lineWidth: 1))
        .contentShape(Capsule())
    }
}

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

                Section("Свои даты") {
                    DatePicker("С", selection: $customFrom, displayedComponents: .date)
                    DatePicker("По", selection: $customTo, in: customFrom..., displayedComponents: .date)
                    Button("Показать за эти даты") {
                        selection = .custom(from: Self.iso(customFrom), to: Self.iso(customTo))
                        dismiss()
                    }
                    .disabled(customTo < customFrom)
                }
            }
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
            }
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
