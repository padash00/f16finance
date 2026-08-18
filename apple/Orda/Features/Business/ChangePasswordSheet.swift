import OrdaKit
import OrdaUI
import SwiftUI

/// Смена своего пароля.
///
/// Сброс по почте — для тех, кто пароль забыл. Тому, кто его помнит, почта не
/// нужна вовсе, а у оператора её и нет: он входит по логину, и временный
/// пароль ему выдаёт владелец. До сих пор сменить его можно было только на
/// сайте, то есть «когда дойду до компьютера», — а выданный на бумажке пароль
/// живёт ровно до первой смены рук.
///
/// Текущий пароль спрашиваем обязательно: телефон бывает разблокирован и лежит
/// на стойке.
struct ChangePasswordSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.api) private var api

    @State private var current = ""
    @State private var next = ""
    @State private var repeated = ""
    @State private var reveal = false
    @State private var isBusy = false
    @State private var error: String?
    @State private var done = false

    private var canSubmit: Bool {
        !current.isEmpty && next.count >= 8 && next == repeated && next != current
    }

    var body: some View {
        NavigationStack {
            ScreenScroll {
                if done {
                    Card {
                        VStack(alignment: .leading, spacing: Spacing.md) {
                            SectionHeader("Пароль изменён")
                            Text("Следующий вход — уже с новым паролем. На других устройствах вход останется прежним, пока не выйдете.")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textMuted)
                                .fixedSize(horizontal: false, vertical: true)
                            Button("Готово") { dismiss() }
                                .buttonStyle(PrimaryButtonStyle())
                        }
                    }
                } else {
                    Card {
                        VStack(alignment: .leading, spacing: Spacing.md) {
                            SectionHeader("Текущий пароль")
                            secureField("Тот, которым входите сейчас", text: $current, isNew: false)

                            RowDivider()

                            SectionHeader("Новый пароль", subtitle: "Не короче 8 символов")
                            secureField("Новый пароль", text: $next, isNew: true)
                            secureField("Ещё раз", text: $repeated, isNew: true)

                            // Несовпадение показываем сразу, а не после
                            // нажатия: набирают вслепую, и промах во втором
                            // поле — самая частая причина «не сохраняется».
                            if !repeated.isEmpty && repeated != next {
                                Text("Пароли не совпадают.")
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.warning)
                            }

                            Toggle("Показать пароли", isOn: $reveal)
                                .font(Typography.caption)
                                .tint(Theme.brand)

                            Button(isBusy ? "Сохраняем…" : "Сменить пароль") {
                                Task { await submit() }
                            }
                            .buttonStyle(PrimaryButtonStyle())
                            .disabled(isBusy || !canSubmit)
                        }
                    }
                }

                if let error {
                    Card {
                        Text(error)
                            .font(Typography.caption)
                            .foregroundStyle(Theme.negative)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .background(Theme.background)
            .navigationTitle("Пароль")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Закрыть") { dismiss() }
                }
            }
        }
    }

    @ViewBuilder
    private func secureField(_ placeholder: String, text: Binding<String>, isNew: Bool) -> some View {
        Group {
            if reveal {
                TextField(placeholder, text: text)
            } else {
                SecureField(placeholder, text: text)
            }
        }
        .textFieldStyle(.plain)
        .font(Typography.callout)
        #if os(iOS)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .textContentType(isNew ? .newPassword : .password)
        #endif
        .padding(Spacing.md)
        .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
    }

    private func submit() async {
        isBusy = true
        error = nil
        defer { isBusy = false }
        do {
            try await MyProfileService(api: api).changePassword(current: current, new: next)
            Haptics.success()
            done = true
        } catch let apiError as APIError {
            Haptics.error()
            error = apiError.userMessage
        } catch {
            Haptics.error()
            self.error = error.localizedDescription
        }
    }
}
