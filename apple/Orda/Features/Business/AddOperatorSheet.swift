import OrdaKit
import OrdaUI
import SwiftUI

/// Оформление оператора.
///
/// Нового человека оформляют в день выхода, часто прямо на точке: он уже стоит
/// у кассы, а завести его можно было только с ноутбука. В итоге первую смену
/// работали под чужим логином — и выручка этой смены записывалась не на того.
///
/// Три шага сервера — карточка, учётная запись, отправка доступов — здесь идут
/// подряд, но раздельно: учётку заводят не всем, а доступы шлют не всегда через
/// Telegram.
struct AddOperatorSheet: View {
    @Environment(BusinessStore.self) private var store
    @Environment(\.api) private var api
    @Environment(\.access) private var access
    @Environment(\.dismiss) private var dismiss

    @State private var draft = OperatorDraft()
    @State private var makesAccount = true
    @State private var username = ""
    @State private var telegramChatID = ""
    @State private var didEditUsername = false

    /// Выданные доступы. Пока они на экране, лист не закрывается: пароль
    /// приходит один раз и нигде не хранится.
    @State private var account: OperatorAccount?
    @State private var sentToTelegram = false

    @State private var errorMessage: String?
    @State private var isSaving = false

    private var canCreateAccount: Bool { access?.can("operators.create_account") ?? false }
    private var canSendTelegram: Bool { access?.can("operators.send_credentials_telegram") ?? false }

    var body: some View {
        NavigationStack {
            ScreenScroll {
                VStack(spacing: Spacing.lg) {
                    if let account {
                        credentialsCard(account)
                    } else {
                        personCard
                        accountCard
                        footer
                    }
                }
            }
            .background(Theme.background)
            .navigationTitle(account == nil ? "Новый оператор" : "Доступы")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(account == nil ? "Отмена" : "Готово") { dismiss() }
                }
            }
        }
    }

    // ── Человек ──────────────────────────────────────────────────────────────

    private var personCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                FieldLabel("Имя для смен и отчётов")
                TextField("Как называть в системе", text: $draft.name)
                    .textFieldStyle(.plain)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .padding(Spacing.md)
                    .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
                    .onChange(of: draft.name) { _, value in
                        // Пока логин не трогали руками, держим его в согласии
                        // с именем: человек не должен придумывать его сам.
                        if !didEditUsername { username = OperatorUsername.suggestion(from: value) }
                    }

                FieldLabel("Полное имя")
                plainField($draft.fullName, placeholder: "Для документов")

                FieldLabel("Должность")
                plainField($draft.position, placeholder: "Кассир, старший смены")

                FieldLabel("Телефон")
                plainField($draft.phone, placeholder: "+7 700 000 00 00")

                FieldLabel("Почта")
                plainField($draft.email, placeholder: "Необязательно")
            }
        }
    }

    @ViewBuilder
    private var accountCard: some View {
        if canCreateAccount {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    Toggle(isOn: $makesAccount) {
                        Text("Сразу завести вход в программу")
                            .font(Typography.callout)
                            .foregroundStyle(Theme.text)
                    }

                    if makesAccount {
                        FieldLabel("Логин")
                        plainField($username, placeholder: "latinicey")
                            .onChange(of: username) { _, _ in didEditUsername = true }

                        if let issue = OperatorUsername.validationMessage(for: username) {
                            Text(issue)
                                .font(Typography.caption)
                                .foregroundStyle(Theme.warning)
                        } else {
                            Text("Вход в программу точки: логин и пароль. Пароль придумает сервер.")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textDim)
                        }

                        if canSendTelegram {
                            FieldLabel("Telegram для отправки доступов")
                            plainField($telegramChatID, placeholder: "chat id, необязательно")
                        }
                    }
                }
            }
        }
    }

    // ── Доступы ──────────────────────────────────────────────────────────────

    private func credentialsCard(_ account: OperatorAccount) -> some View {
        VStack(spacing: Spacing.lg) {
            Card(accent: Theme.warning) {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("Запишите или отправьте сейчас")
                    Text("Пароль показывается один раз и больше нигде не хранится. Закроете экран — восстановить его будет нельзя, только сбросить.")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textMuted)

                    RowDivider()
                    StatRow("Логин", value: account.username, icon: "person")
                    StatRow("Пароль", value: account.password, icon: "key")

                    Button {
                        #if os(iOS)
                        UIPasteboard.general.string = "Логин: \(account.username)\nПароль: \(account.password)"
                        #endif
                        Haptics.success()
                    } label: {
                        Label("Скопировать", systemImage: "doc.on.doc")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }
            }

            if canSendTelegram, !telegramChatID.trimmingCharacters(in: .whitespaces).isEmpty {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        if sentToTelegram {
                            Label("Отправлено в Telegram", systemImage: "checkmark.circle")
                                .font(Typography.callout)
                                .foregroundStyle(Theme.positive)
                        } else {
                            Button("Отправить в Telegram") {
                                Task { await sendCredentials(account) }
                            }
                            .buttonStyle(PrimaryButtonStyle())
                        }

                        if let errorMessage {
                            Text(errorMessage)
                                .font(Typography.caption)
                                .foregroundStyle(Theme.negative)
                        }
                    }
                }
            }
        }
    }

    // ── Отправка ─────────────────────────────────────────────────────────────

    @ViewBuilder
    private var footer: some View {
        if let blocker = blocker {
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

        Button(isSaving ? "Оформляем…" : "Оформить") {
            Task { await save() }
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(isSaving || blocker != nil)
    }

    private var blocker: String? {
        if let message = draft.validationMessage { return message }
        if makesAccount, canCreateAccount {
            return OperatorUsername.validationMessage(for: username)
        }
        return nil
    }

    @ViewBuilder
    private func plainField(_ text: Binding<String>, placeholder: String) -> some View {
        TextField(placeholder, text: text)
            .textFieldStyle(.plain)
            .font(Typography.callout)
            .foregroundStyle(Theme.text)
            .padding(Spacing.md)
            .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
            #if os(iOS)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            #endif
    }

    private func save() async {
        guard !isSaving else { return }
        isSaving = true
        defer { isSaving = false }
        errorMessage = nil

        // Карточка и учётная запись — два разных запроса. Если второй не
        // пройдёт, человек уже заведён: об этом надо сказать прямо, а не
        // делать вид, что не получилось ничего.
        guard await store.createOperator(draft) else {
            errorMessage = store.operatorSaveError
            return
        }

        guard makesAccount, canCreateAccount else {
            Haptics.success()
            dismiss()
            return
        }

        guard let created = store.operators.first(where: { $0.name == draft.name.trimmingCharacters(in: .whitespacesAndNewlines) }) else {
            errorMessage = "Оператор заведён, но учётную запись создать не удалось: не нашли его в списке. Заведите вход из карточки."
            return
        }

        do {
            account = try await BusinessService(api: api).createOperatorAccount(
                operatorID: created.id,
                username: username,
                name: draft.name
            )
            Haptics.success()
        } catch let error as APIError {
            errorMessage = "Оператор заведён, но вход создать не удалось: \(error.userMessage)"
        } catch {
            errorMessage = "Оператор заведён, но вход создать не удалось: \(error.localizedDescription)"
        }
    }

    private func sendCredentials(_ account: OperatorAccount) async {
        errorMessage = nil
        do {
            try await BusinessService(api: api).sendOperatorCredentials(
                operatorID: account.operatorID,
                chatID: telegramChatID.trimmingCharacters(in: .whitespaces),
                username: account.username,
                password: account.password,
                name: draft.name
            )
            sentToTelegram = true
            Haptics.success()
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
