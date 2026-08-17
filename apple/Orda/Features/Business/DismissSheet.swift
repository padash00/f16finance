import OrdaKit
import OrdaUI
import SwiftUI

/// Увольнение и восстановление.
///
/// Увольнение — не удаление: смены, выручка и ведомости остаются, иначе
/// рассыпалась бы отчётность прошлых недель. Сервер закрывает доступ,
/// проставляет дату и снимает человека с графика.
///
/// Решение принимают на месте, а оформляют «когда дойду до компьютера» — и всё
/// это время у уволенного открыт вход в кассу.
struct DismissSheet: View {
    /// Кого увольняем. Оператор и сотрудник — разные записи на сервере.
    let kind: String
    let personID: String
    let personName: String
    /// Уже уволен: тогда лист предлагает восстановить.
    let isDismissed: Bool
    var onDone: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.api) private var api

    @State private var reason = ""
    @State private var dismissalType = DismissalType.voluntary
    @State private var cascade = true
    @State private var isSaving = false
    @State private var error: String?

    /// Причины увольнения — те же, что понимает сервер.
    enum DismissalType: String, CaseIterable, Identifiable {
        case voluntary
        case mutualAgreement = "mutual_agreement"
        case cause
        case contractEnd = "contract_end"
        case other

        var id: String { rawValue }

        var title: String {
            switch self {
            case .voluntary: "По собственному"
            case .mutualAgreement: "По соглашению"
            case .cause: "За нарушение"
            case .contractEnd: "Кончился договор"
            case .other: "Другое"
            }
        }
    }

    var body: some View {
        NavigationStack {
            ScreenScroll {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        FieldLabel(isDismissed ? "Восстановить" : "Уволить")
                        Text(personName)
                            .font(Typography.title)
                            .foregroundStyle(Theme.text)
                    }
                }

                if isDismissed {
                    Card(accent: Theme.info) {
                        Text("Человек снова сможет входить и появится в графике. История смен и выплат не менялась — она сохранялась всё это время.")
                            .font(Typography.callout)
                            .foregroundStyle(Theme.textDim)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                } else {
                    Card {
                        VStack(alignment: .leading, spacing: Spacing.md) {
                            FieldLabel("Причина увольнения")
                            Picker("Причина", selection: $dismissalType) {
                                ForEach(DismissalType.allCases) { option in
                                    Text(option.title).tag(option)
                                }
                            }
                            .pickerStyle(.menu)
                            .tint(Theme.brand)

                            RowDivider()

                            FieldLabel("Комментарий")
                            TextField("Что произошло", text: $reason, axis: .vertical)
                                .textFieldStyle(.plain)
                                .lineLimit(2...4)
                                .padding(Spacing.md)
                                .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))

                            Text("Обязателен: через полгода «уволен» без объяснения не отличить от ошибки.")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textMuted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }

                    Card {
                        VStack(alignment: .leading, spacing: Spacing.sm) {
                            Toggle("Закрыть и связанную запись", isOn: $cascade)
                                .tint(Theme.brand)
                            Text("У человека бывают две записи — оператор и сотрудник. Закрыть надо обе, иначе одна дверь останется открытой.")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textMuted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }

                    Card(accent: Theme.warning) {
                        HStack(alignment: .top, spacing: Spacing.sm) {
                            Image(systemName: "info.circle.fill")
                                .foregroundStyle(Theme.warning)
                            Text("Смены, выручка и ведомости останутся: это не удаление, а закрытие доступа. Отчётность прошлых недель не изменится.")
                                .font(Typography.callout)
                                .foregroundStyle(Theme.textDim)
                                .fixedSize(horizontal: false, vertical: true)
                        }
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
                        Text(isDismissed ? "Восстановить" : "Уволить")
                    }
                }
                .buttonStyle(isDismissed ? AnyButtonStyle(PrimaryButtonStyle()) : AnyButtonStyle(DestructiveButtonStyle()))
                .disabled(isSaving || (!isDismissed && reason.trimmingCharacters(in: .whitespaces).count < 3))
            }
            .background(Theme.background)
            .navigationTitle(isDismissed ? "Восстановление" : "Увольнение")
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

        do {
            let service = BusinessService(api: api)
            if isDismissed {
                try await service.restorePerson(kind: kind, id: personID)
            } else {
                try await service.dismissPerson(
                    kind: kind,
                    id: personID,
                    reason: reason.trimmingCharacters(in: .whitespaces),
                    dismissalType: dismissalType.rawValue,
                    cascadePaired: cascade
                )
            }
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
