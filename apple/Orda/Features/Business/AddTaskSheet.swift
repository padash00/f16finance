import OrdaKit
import OrdaUI
import SwiftUI

/// Постановка задачи.
///
/// Задачу вспоминают на обходе точки, в разговоре, по дороге — и телефон здесь
/// единственное, что под рукой. Отложить «до ноутбука» означает не поставить
/// вовсе, поэтому форма короткая: название, точка, срочность и, если нужно,
/// исполнитель со сроком.
struct AddTaskSheet: View {
    @Environment(BusinessStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var draft = TaskDraft()
    @State private var hasDueDate = false
    @State private var dueDate = Date()
    @State private var errorMessage: String?
    @State private var isSaving = false
    @State private var didPrepare = false

    var body: some View {
        NavigationStack {
            ScreenScroll {
                VStack(spacing: Spacing.lg) {
                    mainCard
                    assigneeCard
                    footer
                }
            }
            .background(Theme.background)
            .navigationTitle("Новая задача")
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
                if store.operators.isEmpty { await store.loadTeam() }
                if draft.companyID.isEmpty, store.companies.count == 1 {
                    draft.companyID = store.companies[0].id
                }
            }
        }
    }

    private var mainCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                FieldLabel("Что сделать")
                TextField("Например: заменить лампу в зале", text: $draft.title, axis: .vertical)
                    .lineLimit(1...3)
                    .textFieldStyle(.plain)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .padding(Spacing.md)
                    .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))

                FieldLabel("Подробности")
                TextField("Необязательно", text: $draft.details, axis: .vertical)
                    .lineLimit(1...4)
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

                FieldLabel("Срочность")
                Picker("Срочность", selection: $draft.priority) {
                    ForEach(TaskPriority.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
            }
        }
    }

    private var assigneeCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Кому и когда")

                FieldLabel("Исполнитель")
                Picker("Исполнитель", selection: Binding(
                    get: { draft.operatorID ?? "" },
                    set: { draft.operatorID = $0.isEmpty ? nil : $0 }
                )) {
                    // Без исполнителя задача попадает в общий список точки —
                    // это нормальный случай, а не пропуск.
                    Text("Не назначен").tag("")
                    ForEach(store.operators.filter(\.isActive)) { person in
                        Text(person.shortName ?? person.name).tag(person.id)
                    }
                }
                .pickerStyle(.menu)

                Toggle(isOn: $hasDueDate) {
                    Text("Со сроком")
                        .font(Typography.callout)
                        .foregroundStyle(Theme.text)
                }

                if hasDueDate {
                    DatePicker("Срок", selection: $dueDate, displayedComponents: .date)
                        .font(Typography.callout)
                }

                FieldLabel("Начальное состояние")
                Picker("Состояние", selection: $draft.status) {
                    ForEach([TaskState.todo, .inProgress]) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
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

        Button(isSaving ? "Ставим…" : "Поставить задачу") {
            Task { await save() }
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(isSaving || !prepared.isValid)
    }

    private var prepared: TaskDraft {
        var value = draft
        value.dueDate = hasDueDate ? Self.isoDay.string(from: dueDate) : nil
        return value
    }

    private func save() async {
        guard !isSaving else { return }
        isSaving = true
        defer { isSaving = false }
        errorMessage = nil

        if await store.createTask(prepared) {
            Haptics.success()
            dismiss()
        } else {
            errorMessage = store.taskSaveError
        }
    }

    private static let isoDay: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()
}
