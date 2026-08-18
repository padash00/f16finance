import OrdaUI
import SwiftUI

/// Сброс пароля, не выходя из приложения.
///
/// Раньше кнопка «Восстановить пароль» открывала сайт: браузер, форма, письмо,
/// ссылка, снова форма — и только потом обратно в приложение, вводить новый
/// пароль руками. С телефона это четыре перехода, и теряются люди ровно
/// посередине; а пароль просят обычно тогда, когда он нужен сейчас.
///
/// Два шага на одном экране: почта → код из письма и новый пароль. Второй шаг
/// сразу с паролем, а не «сначала проверим код»: код одноразовый и живёт
/// минуты, и лишний экран между ними — лишний способ не успеть.
///
/// Оператору это не подходит: у него не почта, а логин, и пароль ему выдаёт
/// владелец. Поэтому лист открывается только из раздела для сотрудников.
struct PasswordResetSheet: View {
    /// Почта, с которой человек пытался войти: чаще всего сбрасывают её же.
    var initialEmail: String = ""

    @Environment(\.dismiss) private var dismiss

    private let client = SessionClient(baseURL: AppConfiguration.current.apiBaseURL)

    private enum Step {
        case email
        case code
        case done
    }

    @State private var step: Step = .email
    @State private var email = ""
    @State private var code = ""
    @State private var password = ""
    @State private var revealPassword = false
    @State private var isBusy = false
    @State private var error: String?
    @State private var didSeedEmail = false

    var body: some View {
        NavigationStack {
            ScreenScroll {
                switch step {
                case .email: emailStep
                case .code: codeStep
                case .done: doneStep
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
            .navigationTitle("Сброс пароля")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Закрыть") { dismiss() }
                }
            }
            .task {
                guard !didSeedEmail else { return }
                didSeedEmail = true
                if email.isEmpty { email = initialEmail }
            }
        }
    }

    // ── Шаги ─────────────────────────────────────────────────────────────────

    private var emailStep: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Рабочая почта", subtitle: "Пришлём код для смены пароля")

                TextField("name@company.kz", text: $email)
                    .textFieldStyle(.plain)
                    .font(Typography.callout)
                    .padding(Spacing.md)
                    .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
                    #if os(iOS)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textContentType(.username)
                    #endif

                Button(isBusy ? "Отправляем…" : "Прислать код") {
                    Task { await requestCode() }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(isBusy || !email.contains("@"))

                Text("Если такая почта заведена, письмо придёт в течение минуты. Проверьте папку «Спам».")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var codeStep: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Код из письма", subtitle: email)

                TextField("123456", text: $code)
                    .textFieldStyle(.plain)
                    .font(Typography.title.monospacedDigit())
                    .padding(Spacing.md)
                    .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
                    #if os(iOS)
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode)
                    #endif

                FieldLabel("Новый пароль")
                HStack(spacing: Spacing.sm) {
                    Group {
                        if revealPassword {
                            TextField("Не короче 8 символов", text: $password)
                        } else {
                            SecureField("Не короче 8 символов", text: $password)
                        }
                    }
                    .textFieldStyle(.plain)
                    .font(Typography.callout)
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textContentType(.newPassword)
                    #endif

                    // Пароль набирают вслепую и с первого раза редко попадают:
                    // без этой кнопки человек ловит «пароль не подошёл» уже
                    // после смены и идёт по кругу.
                    Button {
                        revealPassword.toggle()
                    } label: {
                        Image(systemName: revealPassword ? "eye.slash" : "eye")
                            .foregroundStyle(Theme.textDim)
                    }
                    .buttonStyle(.plain)
                }
                .padding(Spacing.md)
                .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))

                Button(isBusy ? "Сохраняем…" : "Сменить пароль") {
                    Task { await confirm() }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(isBusy || code.count < 4 || password.count < 8)

                Button("Прислать код заново") {
                    Task { await requestCode() }
                }
                .buttonStyle(SecondaryButtonStyle())
                .disabled(isBusy)

                Text("Код одноразовый и живёт несколько минут. Если в письме только ссылка — откройте её: она ведёт на сайт и тоже меняет пароль.")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var doneStep: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Пароль изменён")
                Text("Войдите с новым паролем — почта та же: \(email).")
                    .font(Typography.callout)
                    .foregroundStyle(Theme.textDim)
                    .fixedSize(horizontal: false, vertical: true)
                Button("Вернуться ко входу") { dismiss() }
                    .buttonStyle(PrimaryButtonStyle())
            }
        }
    }

    // ── Действия ─────────────────────────────────────────────────────────────

    private func requestCode() async {
        isBusy = true
        error = nil
        defer { isBusy = false }
        do {
            try await client.requestPasswordReset(email: email)
            Haptics.success()
            step = .code
        } catch let authError as SessionClient.AuthError {
            Haptics.error()
            error = authError.errorDescription ?? "Не удалось сбросить пароль"
        } catch {
            Haptics.error()
            self.error = error.localizedDescription
        }
    }

    private func confirm() async {
        isBusy = true
        error = nil
        defer { isBusy = false }
        do {
            try await client.confirmPasswordReset(email: email, code: code, password: password)
            Haptics.success()
            step = .done
        } catch let authError as SessionClient.AuthError {
            Haptics.error()
            error = authError.errorDescription ?? "Не удалось сбросить пароль"
        } catch {
            Haptics.error()
            self.error = error.localizedDescription
        }
    }
}
