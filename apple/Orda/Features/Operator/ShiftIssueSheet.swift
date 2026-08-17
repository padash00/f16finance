import OrdaKit
import OrdaUI
import SwiftUI

/// «Не смогу выйти» по конкретной смене.
///
/// Это не отказ и не самовольная замена: заявка уходит руководителю, а решение
/// и подмену принимает он. Молча не выйти — хуже для всех, и до сих пор
/// сказать об этом можно было только звонком, который потом никто не помнит.
///
/// Причина обязательна, и не для формы: «не смогу» без объяснения руководитель
/// не сможет ни принять, ни закрыть — он не знает, искать ли замену на один
/// день или человек заболел на неделю.
struct ShiftIssueSheet: View {
    let responseID: String
    let shiftDate: String
    let shiftType: String
    let companyName: String

    var onDone: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(CabinetStore.self) private var cabinet

    @State private var reason = ""
    @State private var isSaving = false
    @State private var error: String?

    /// Готовые причины: набирать текст стоя в дороге неудобно, а руководителю
    /// нужна суть, а не сочинение.
    private let presets = [
        "Заболел",
        "Семейные обстоятельства",
        "Учёба",
        "Не успеваю доехать",
    ]

    private var canSubmit: Bool {
        reason.trimmingCharacters(in: .whitespaces).count >= 3 && !isSaving
    }

    var body: some View {
        NavigationStack {
            ScreenScroll {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        FieldLabel("Смена")
                        Text(ScheduleScreen.dayTitle(shiftDate) + (shiftType == "night" ? ", ночная" : ", дневная"))
                            .font(Typography.title)
                            .foregroundStyle(Theme.text)
                        Text(companyName)
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textMuted)
                    }
                }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        FieldLabel("Причина")

                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: Spacing.xs) {
                                ForEach(presets, id: \.self) { preset in
                                    Button {
                                        reason = preset
                                    } label: {
                                        Text(preset)
                                            .font(Typography.caption.weight(.medium))
                                            .padding(.horizontal, Spacing.md)
                                            .padding(.vertical, Spacing.xs)
                                            .background(
                                                reason == preset ? Theme.brand.opacity(0.16) : Theme.surfaceRaised,
                                                in: Capsule()
                                            )
                                            .foregroundStyle(reason == preset ? Theme.brand : Theme.textDim)
                                    }
                                    .buttonStyle(.pressable)
                                }
                            }
                            .padding(.horizontal, 2)
                        }

                        TextField("Что случилось", text: $reason, axis: .vertical)
                            .textFieldStyle(.plain)
                            .lineLimit(2...4)
                            .padding(Spacing.md)
                            .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))

                        Text("Руководитель увидит заявку и решит, кем заменить. Смена остаётся за вами, пока он не решит иначе.")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textMuted)
                            .fixedSize(horizontal: false, vertical: true)
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
                    Task { await submit() }
                } label: {
                    if isSaving {
                        ProgressView().controlSize(.small)
                    } else {
                        Text("Отправить руководителю")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!canSubmit)
            }
            .background(Theme.background)
            .navigationTitle("Не смогу выйти")
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

    private func submit() async {
        isSaving = true
        error = nil
        defer { isSaving = false }

        let failure = await cabinet.reportShiftIssue(
            responseID: responseID,
            shiftDate: shiftDate,
            shiftType: shiftType,
            reason: reason.trimmingCharacters(in: .whitespaces)
        )

        if let failure {
            error = failure
            Haptics.error()
        } else {
            Haptics.success()
            await onDone()
            dismiss()
        }
    }
}
