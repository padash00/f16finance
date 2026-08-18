import OrdaKit
import OrdaUI
import SwiftUI

/// Что поручили лично мне.
///
/// Доска задач показывает поручения всей организации и закрыта правом
/// «Задачи»: владелец справедливо снимает его с рядового сотрудника. Своё
/// поручение при этом видеть надо в любом случае — иначе о нём узнают голосом
/// или из телеграма, а в приложении его нет.
///
/// Сервер отвечает на `mine=1` без этого права, но только назначенным на
/// просителя. Карточка молча исчезает, когда поручений нет.
struct MyTasksCard: View {
    @Environment(\.api) private var api

    @State private var tasks: [TeamTask] = []
    @State private var didLoad = false
    /// Поручение, на которое отвечаем.
    @State private var answering: TeamTask?

    /// Открытые поручения, срочные и просроченные сверху.
    private var open: [TeamTask] {
        tasks
            .filter { !$0.isDone && $0.status != "cancelled" && $0.status != "canceled" }
            .sorted { lhs, rhs in
                if lhs.isOverdue != rhs.isOverdue { return lhs.isOverdue }
                switch (lhs.dueDate, rhs.dueDate) {
                case let (l?, r?): return l < r
                case (nil, _?): return false
                case (_?, nil): return true
                default: return false
                }
            }
    }

    var body: some View {
        Group {
            if !open.isEmpty {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        SectionHeader(
                            "Мои задачи",
                            subtitle: "\(open.count) \(pluralize(open.count, "открытая", "открытые", "открытых"))"
                        )

                        ForEach(Array(open.prefix(5).enumerated()), id: \.element.id) { index, task in
                            if index > 0 { RowDivider() }
                            // Строка ведёт к ответу: увидеть поручение и не
                            // мочь на него ответить — половина дела, а
                            // «принял» и «сделал» ждут именно от исполнителя.
                            Button { answering = task } label: {
                                TeamTaskRowView(task: task)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.pressable)
                        }

                        if open.count > 5 {
                            Text("и ещё \(open.count - 5) — в разделе «Задачи»")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textDim)
                        }
                    }
                }
            } else if !didLoad {
                // Заглушка до первого ответа сервера — и она же держит
                // загрузку: у `Group`, где не отрисовалась ни одна ветка,
                // выходит `EmptyView`, а `.task` на нём не выполняется. Без
                // этой ветки поручения не загружались никогда, и карточка
                // «Мои задачи» не появлялась даже когда работа была.
                Card {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        SectionHeader("Мои задачи")
                        Text("Загружаем поручения…")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textMuted)
                    }
                }
            }
        }
        .task {
            guard !didLoad else { return }
            // Ошибку не показываем: у того, кому ничего не поручают, карточки
            // просто нет, и красная строка в профиле пугала бы зря.
            //
            // Отметку ставим после ответа, а не до: заглушка держит карточку в
            // дереве, пока ответ идёт. Убери её раньше — SwiftUI выкинет вид и
            // отменит сам запрос.
            tasks = (try? await BusinessService(api: api).myTasks()) ?? []
            didLoad = true
        }
        .sheet(item: $answering) { task in
            MyTaskAnswerSheet(task: task) {
                tasks = (try? await BusinessService(api: api).myTasks()) ?? []
            }
        }
    }
}

/// Ответ по своему поручению.
///
/// Сервер принимает не статус, а ответ человека: принял, нужны уточнения, не
/// могу, уже сделано, готово. Статус он выводит сам и пишет в историю задачи
/// комментарий — потом видно, кто и когда что сказал. Поэтому здесь пять
/// кнопок словами, а не выпадающий список состояний.
struct MyTaskAnswerSheet: View {
    let task: TeamTask
    var onDone: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.api) private var api

    @State private var note = ""
    @State private var sending: TaskResponse?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScreenScroll {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        FieldLabel("Задача")
                        Text(task.title)
                            .font(Typography.callout.weight(.medium))
                            .foregroundStyle(Theme.text)
                        if let details = task.details, !details.isEmpty {
                            Text(details)
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textMuted)
                        }
                    }
                }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        FieldLabel("Комментарий")
                        TextField("Необязательно", text: $note, axis: .vertical)
                            .textFieldStyle(.plain)
                            .font(Typography.callout)
                            .lineLimit(1...4)
                    }
                }

                VStack(spacing: Spacing.sm) {
                    // «Готово» — главный ответ, остальные вторичны: чаще всего
                    // человек открывает лист именно чтобы закрыть поручение.
                    Button {
                        Task { await send(.complete) }
                    } label: {
                        Label(TaskResponse.complete.title, systemImage: TaskResponse.complete.icon)
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(sending != nil)

                    ForEach(TaskResponse.allCases.filter { $0 != .complete }) { response in
                        Button {
                            Task { await send(response) }
                        } label: {
                            Label(response.title, systemImage: response.icon)
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(SecondaryButtonStyle())
                        .disabled(sending != nil)
                    }
                }

                if let error {
                    Card {
                        Text(error)
                            .font(Typography.caption)
                            .foregroundStyle(Theme.negative)
                    }
                }
            }
            .background(Theme.background)
            .navigationTitle("Ответить")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
            }
        }
    }

    private func send(_ response: TaskResponse) async {
        sending = response
        error = nil
        defer { sending = nil }
        do {
            try await BusinessService(api: api).respondToTask(
                id: task.id,
                response: response,
                note: note.trimmingCharacters(in: .whitespaces)
            )
            Haptics.success()
            await onDone()
            dismiss()
        } catch let apiError as APIError {
            Haptics.error()
            error = apiError.userMessage
        } catch {
            Haptics.error()
            self.error = error.localizedDescription
        }
    }
}
