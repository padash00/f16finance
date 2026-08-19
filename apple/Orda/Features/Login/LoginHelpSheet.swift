import OrdaUI
import SwiftUI

/// «Не получается войти».
///
/// Экран входа был тупиком: пароль не подошёл — и дальше ничего. Ссылка
/// «забыли пароль» здесь не подошла бы: восстановление у сотрудника и у
/// оператора устроено по-разному. Сотрудник ходит по своей почте, а оператору
/// пароль выдаёт владелец — сбросить его самому нельзя, и делать вид, что
/// можно, значит гонять человека по кругу.
struct LoginHelpSheet: View {
    /// Что человек уже набрал на экране входа: почту подставим в сброс, чтобы
    /// не набирать её второй раз с телефона.
    var enteredLogin: String = ""

    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    private let configuration = AppConfiguration.current

    /// Открыт лист смены пароля.
    @State private var resetting = false

    var body: some View {
        NavigationStack {
            ScreenScroll {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        SectionHeader("Сотрудник офиса", subtitle: "Вход по рабочей почте")

                        Text("Пришлём код на рабочую почту — и пароль сменится прямо здесь, без браузера.")
                            .font(Typography.callout)
                            .foregroundStyle(Theme.textDim)
                            .fixedSize(horizontal: false, vertical: true)

                        // Сброс идёт здесь же, а не в браузере: человек уже не
                        // может войти, и отправлять его на сайт — четыре
                        // перехода там, где он и так раздражён.
                        Button {
                            resetting = true
                        } label: {
                            Label("Сменить пароль", systemImage: "key")
                        }
                        .buttonStyle(PrimaryButtonStyle())

                        Text("Если в письме окажется только ссылка, а не код, — откройте её: она ведёт на тот же сброс на сайте.")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        SectionHeader("Оператор", subtitle: "Вход по логину, не по почте")

                        Text("Логин и пароль выдаёт владелец точки. Сбросить их самому нельзя — попросите владельца выдать новый пароль: он показывается один раз и может прийти в Telegram.")
                            .font(Typography.callout)
                            .foregroundStyle(Theme.textDim)
                            .fixedSize(horizontal: false, vertical: true)

                        Text("Если пароль временный, программа попросит сменить его при первом входе.")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        SectionHeader("Частые причины")

                        bullet("Оператор вводит почту вместо логина — они разные.")
                        bullet("Учётная запись отключена: это видно владельцу на сайте.")
                        bullet("Раскладка и лишний пробел в конце — нажмите глазок и проверьте.")
                    }
                }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        SectionHeader("Поддержка")

                        Button {
                            if let url = URL(string: "mailto:support@turanix.kz") { openURL(url) }
                        } label: {
                            NavigationRow(icon: "envelope", iconColor: Theme.info, title: "support@turanix.kz")
                        }
                        .buttonStyle(.pressable)

                        RowDivider()

                        Button {
                            if let url = URL(string: "tel:+77011070260") { openURL(url) }
                        } label: {
                            NavigationRow(icon: "phone", iconColor: Theme.brand, title: "+7 701 107 02 60")
                        }
                        .buttonStyle(.pressable)
                    }
                }
            }
            .navigationTitle("Не получается войти")
            .sheet(isPresented: $resetting) {
                PasswordResetSheet(initialEmail: enteredLogin.contains("@") ? enteredLogin : "")
            }
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

    private func bullet(_ text: String) -> some View {
        HStack(alignment: .top, spacing: Spacing.sm) {
            Circle()
                .fill(Theme.textMuted)
                .frame(width: 5, height: 5)
                .padding(.top, 7)
            Text(text)
                .font(Typography.callout)
                .foregroundStyle(Theme.textDim)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
