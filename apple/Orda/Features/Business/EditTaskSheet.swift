import OrdaKit
import OrdaUI
import SwiftUI

/// Правка задачи.
///
/// Задача редко доживает до конца в том виде, в каком её поставили: сдвигается
/// срок, меняется исполнитель, уточняется формулировка. С телефона всего этого
/// сделать было нельзя — только поставить и закрыть. В итоге правку откладывали
/// «до ноутбука», а задача повисала в неверном виде.
///
/// Шлём только изменённое: сервер трактует пропущенный ключ как «не трогать»,
/// и правка срока не должна стирать исполнителя.
struct EditTaskSheet: View {
    let task: TeamTask

    @Environment(BusinessStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var title = ""
    @State private var details = ""
    @State private var priority: TaskPriority = .medium
    @State private var status: TaskState = .todo
    @State private var operatorID: String = ""
    @State private var hasDueDate = false
    @State private var dueDate = Date()
    @State private var isSaving = false
    @State private var errorMessage: String?
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
            .navigationTitle("Изменить задачу")
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
                prepare()
                if store.operators.isEmpty { await store.loadTeam() }
            }
        }
    }

    private var mainCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                FieldLabel("Что сделать")
                TextField("Коротко", text: $title, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .lineLimit(1...3)
                    .padding(Spacing.md)
                    .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))

                FieldLabel("Подробности")
                TextField("Необязательно", text: $details, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .lineLimit(2...6)
                    .padding(Spacing.md)
                    .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))

                FieldLabel("Приоритет")
                Picker("Приоритет", selection: $priority) {
                    ForEach(TaskPriority.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)

                FieldLabel("Состояние")
                Picker("Состояние", selection: $status) {
                    ForEach(TaskState.selectable) { Text($0.title).tag($0) }
                }
                .pickerStyle(.menu)

                Toggle(isOn: $hasDueDate) {
                    Text("Срок")
                        .font(Typography.callout)
                        .foregroundStyle(Theme.text)
                }
                if hasDueDate {
                    DatePicker("До", selection: $dueDate, displayedComponents: .date)
                        .font(Typography.callout)
                }
            }
        }
    }

    private var assigneeCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                FieldLabel("Исполнитель")
                Picker("Исполнитель", selection: $operatorID) {
                    Text("Без исполнителя").tag("")
                    ForEach(store.operators.filter(\.isActive)) { person in
                        Text(person.name).tag(person.id)
                    }
                }
                .pickerStyle(.menu)

                // Переназначение — обычное дело: человек заболел, ушёл в
                // отпуск, поменялась смена.
                Text("Задача появится у него в приложении и в уведомлениях.")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
            }
        }
    }

    @ViewBuilder
    private var footer: some View {
        if let errorMessage {
            Text(errorMessage)
                .font(Typography.callout)
                .foregroundStyle(Theme.negative)
                .frame(maxWidth: .infinity, alignment: .leading)
        }

        Button(isSaving ? "Сохраняем…" : "Сохранить") {
            Task { await save() }
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(isSaving || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    private func prepare() {
        title = task.title
        details = task.details ?? ""
        priority = TaskPriority(rawValue: task.priority) ?? .medium
        status = TaskState(rawValue: task.status) ?? .todo
        operatorID = task.operatorID ?? ""
        if let due = task.dueDate {
            hasDueDate = true
            dueDate = due
        }
    }

    private func save() async {
        guard !isSaving else { return }
        isSaving = true
        defer { isSaving = false }
        errorMessage = nil

        let patch = TaskPatch(
            title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            description: details.trimmingCharacters(in: .whitespacesAndNewlines),
            priority: priority.rawValue,
            status: status.rawValue,
            // Пустая строка — «снять исполнителя»: сервер отличает её от
            // непереданного ключа.
            operatorID: operatorID,
            dueDate: hasDueDate ? Self.isoDay.string(from: dueDate) : ""
        )

        if await store.updateTask(taskID: task.id, patch: patch) {
            Haptics.success()
            dismiss()
        } else {
            errorMessage = store.taskSaveError
            Haptics.error()
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
