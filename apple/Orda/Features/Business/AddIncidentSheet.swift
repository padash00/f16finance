import OrdaKit
import OrdaUI
import SwiftUI

/// Регистрация инцидента.
///
/// Инцидент случается на точке и записывается там же: разбитая витрина,
/// опоздание на смену, хорошо отработанный конфликт с гостем. Пока это можно
/// было завести только на сайте, между событием и записью проходил день — и
/// запись делалась по памяти, а половина не делалась вовсе.
struct AddIncidentSheet: View {
    @Environment(BusinessStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var draft = IncidentDraft()
    @State private var fine = ""
    @State private var bonus = ""
    @State private var errorMessage: String?
    @State private var isSaving = false
    @State private var didPrepare = false

    var body: some View {
        NavigationStack {
            ScreenScroll {
                VStack(spacing: Spacing.lg) {
                    whatCard
                    amountCard
                    footer
                }
            }
            .background(Theme.background)
            .navigationTitle("Новый инцидент")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
            }
            .task {
                guard !didPrepare else { return }
                didPrepare = true
                if store.companies.isEmpty { await store.loadCompanies() }
                if store.staff == nil { await store.loadStaff() }
                if draft.companyID.isEmpty, store.companies.count == 1 {
                    draft.companyID = store.companies[0].id
                }
            }
        }
    }

    private var whatCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                Picker("Что записываем", selection: $draft.kind) {
                    ForEach(IncidentKind.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)

                FieldLabel("Что произошло")
                TextField("Коротко: суть", text: $draft.title, axis: .vertical)
                    .lineLimit(1...3)
                    .textFieldStyle(.plain)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .padding(Spacing.md)
                    .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))

                FieldLabel("Подробности")
                TextField("Необязательно", text: $draft.details, axis: .vertical)
                    .lineLimit(1...5)
                    .textFieldStyle(.plain)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .padding(Spacing.md)
                    .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))

                FieldLabel("Точка")
                Picker("Точка", selection: $draft.companyID) {
                    Text("Не выбрана").tag("")
                    ForEach(store.companies) { company in
                        Text(company.name).tag(company.id)
                    }
                }
                .pickerStyle(.menu)

                FieldLabel("Кого касается")
                Picker("Сотрудник", selection: Binding(
                    get: { draft.subjectStaffID ?? "" },
                    set: { draft.subjectStaffID = $0.isEmpty ? nil : $0 }
                )) {
                    // Инцидент бывает про точку, а не про человека: разбитая
                    // витрина ничья.
                    Text("Никого конкретно").tag("")
                    ForEach(staffOptions, id: \.id) { person in
                        Text(person.name).tag(person.id)
                    }
                }
                .pickerStyle(.menu)

                FieldLabel("Серьёзность")
                Picker("Серьёзность", selection: $draft.severity) {
                    ForEach(IncidentSeverity.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
            }
        }
    }

    @ViewBuilder
    private var amountCard: some View {
        // Деньги показываем только там, где они бывают: у заметки суммы нет,
        // и пустые поля в форме сбивают с толку.
        if draft.kind != .note {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader(draft.kind == .bonus ? "Премия" : "Штраф")

                    if draft.kind == .violation {
                        MoneyField(title: "Штраф", text: $fine)
                    } else {
                        MoneyField(title: "Премия", text: $bonus)
                    }

                    Text("Сумма попадёт в расчёт зарплаты за неделю.")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                }
            }
        }
    }

    @ViewBuilder
    private var footer: some View {
        if let blocker = prepared.validationMessage {
            Text(blocker)
                .font(Typography.callout)
                .foregroundStyle(Theme.warning)
                .frame(maxWidth: .infinity, alignment: .leading)
        }

        if let errorMessage {
            Text(errorMessage)
                .font(Typography.callout)
                .foregroundStyle(Theme.negative)
                .frame(maxWidth: .infinity, alignment: .leading)
        }

        Button(isSaving ? "Записываем…" : "Записать") {
            Task { await save() }
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(isSaving || !prepared.isValid)
    }

    private var staffOptions: [(id: String, name: String)] {
        (store.staff?.staff ?? [])
            .filter(\.isActive)
            .map { (id: $0.id, name: $0.shortName ?? $0.fullName) }
    }

    private var prepared: IncidentDraft {
        var value = draft
        value.fineAmount = draft.kind == .violation ? AmountParsing.value(fine) : 0
        value.bonusAmount = draft.kind == .bonus ? AmountParsing.value(bonus) : 0
        return value
    }

    private func save() async {
        guard !isSaving else { return }
        isSaving = true
        defer { isSaving = false }
        errorMessage = nil

        if await store.createIncident(prepared) {
            Haptics.success()
            dismiss()
        } else {
            errorMessage = store.incidentSaveError
        }
    }
}
