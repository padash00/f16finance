import OrdaKit
import OrdaUI
import SwiftUI

/// Решение руководителя по заявке «не смогу выйти».
///
/// Последнее слово здесь: оператор заявку подал, старший на точке предложил,
/// кем закрыть, — а расписание меняет только это решение. До сих пор принять
/// его можно было лишь на сайте, и заявка висела до вечера, когда руководитель
/// доберётся до компьютера.
///
/// Решение правит график по-настоящему: «снять» освобождает смену, «заменить»
/// ставит другого человека. Поэтому оно и подтверждается отдельным нажатием, а
/// не выбором в списке.
struct ResolveShiftIssueSheet: View {
    let issue: ShiftIssue
    /// Кого можно поставить вместо — люди этой точки на этой неделе.
    let operatorNames: [String]

    @Environment(\.dismiss) private var dismiss
    @Environment(BusinessStore.self) private var store

    @State private var choice: String = "replace"
    @State private var replacement: String?
    @State private var note = ""
    @State private var isSaving = false
    @State private var error: String?

    private var canSubmit: Bool {
        if isSaving { return false }
        if choice == "replace" { return replacement != nil }
        return true
    }

    var body: some View {
        NavigationStack {
            ScreenScroll {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        Text(issue.operatorName)
                            .font(Typography.title)
                            .foregroundStyle(Theme.text)

                        Text(
                            ScheduleWeekScreen.dayTitle(issue.shiftDate)
                                + (issue.isNight ? ", ночная" : ", дневная")
                        )
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textDim)

                        if let reason = issue.reason, !reason.isEmpty {
                            Text(reason)
                                .font(Typography.callout)
                                .foregroundStyle(Theme.textMuted)
                                .fixedSize(horizontal: false, vertical: true)
                                .padding(.top, Spacing.xxs)
                        }
                    }
                }

                // Предложение старшего — отдельной карточкой: он на точке и
                // знает, кто уже отработал две ночи подряд.
                if let proposal = issue.proposalLabel {
                    Card(accent: Theme.info) {
                        VStack(alignment: .leading, spacing: Spacing.xxs) {
                            Text(proposal)
                                .font(Typography.body)
                                .foregroundStyle(Theme.text)
                            if let note = issue.leadNote, !note.isEmpty {
                                Text(note)
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.textMuted)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            if let lead = issue.leadOperatorName {
                                Text(lead)
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.textDim)
                            }
                        }
                    }
                }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        FieldLabel("Решение")

                        Picker("", selection: $choice) {
                            Text("Замена").tag("replace")
                            Text("Оставить").tag("keep")
                            Text("Снять").tag("remove")
                        }
                        .pickerStyle(.segmented)
                        .labelsHidden()

                        Text(hint)
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                if choice == "replace" { replacementCard }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        FieldLabel("Комментарий")
                        TextField("Увидит оператор", text: $note, axis: .vertical)
                            .textFieldStyle(.plain)
                            .lineLimit(2...4)
                            .padding(Spacing.md)
                            .background(
                                Theme.surfaceRaised,
                                in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
                            )
                    }
                }

                if let error {
                    Text(error)
                        .font(Typography.callout)
                        .foregroundStyle(Theme.negative)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Button {
                    Task { await submit(status: "resolved") }
                } label: {
                    if isSaving {
                        ProgressView().controlSize(.small)
                    } else {
                        Text("Применить к графику")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!canSubmit)

                // Отклонить — не то же самое, что «оставить смену»: причина не
                // принята, и в истории это должно читаться именно так.
                Button {
                    Task { await submit(status: "dismissed") }
                } label: {
                    Text("Отклонить заявку")
                }
                .buttonStyle(SecondaryButtonStyle())
                .disabled(isSaving)
            }
            .background(Theme.background)
            .navigationTitle("Заявка")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
            }
            .onAppear {
                // Предложение старшего подставляем как готовый ответ: чаще
                // всего руководитель с ним и соглашается.
                if let proposed = issue.leadAction { choice = proposed }
                replacement = issue.replacementName ?? operatorNames.first
            }
        }
    }

    private var hint: String {
        switch choice {
        case "keep": "Смена остаётся за человеком: причина не тянет на замену."
        case "remove": "Смена освободится, и в этот день на точке никого не будет."
        default: "Тот, кого выберете, встанет в график вместо него."
        }
    }

    @ViewBuilder
    private var replacementCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                FieldLabel("Кто выйдет")

                if operatorNames.isEmpty {
                    Text("На этой неделе на точке больше никого нет в графике. Поставьте человека в смену вручную или выберите «оставить».")
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    ForEach(Array(operatorNames.enumerated()), id: \.element) { index, name in
                        if index > 0 { RowDivider() }
                        Button {
                            replacement = name
                        } label: {
                            HStack {
                                Text(name)
                                    .font(Typography.body)
                                    .foregroundStyle(Theme.text)
                                Spacer()
                                Image(systemName: replacement == name ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(replacement == name ? Theme.brand : Theme.textMuted)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.pressable)
                    }
                }
            }
        }
    }

    private func submit(status: String) async {
        isSaving = true
        error = nil
        defer { isSaving = false }

        let failure = await store.resolveShiftIssue(
            requestID: issue.id,
            status: status,
            // Отклонённая заявка ничего в графике не меняет: смена остаётся.
            action: status == "dismissed" ? "keep" : choice,
            replacementOperatorName: choice == "replace" ? replacement : nil,
            note: note.trimmingCharacters(in: .whitespaces)
        )

        if let failure {
            error = failure
        } else {
            dismiss()
        }
    }
}
