import OrdaKit
import OrdaUI
import SwiftUI
#if os(iOS)
import UIKit
#endif

/// Сброс пароля оператору.
///
/// Пароль забывают перед сменой, и человек стоит у кассы, пока владелец
/// «дойдёт до компьютера». Сервер новый пароль не придумывает — его задаёт тот,
/// кто сбрасывает, и дальше надо решить, как он попадёт к человеку.
///
/// Решение простое: **есть Telegram — отправляем туда**, там пароль остаётся у
/// адресата, а не на чужом экране и не диктуется вслух через зал. Нет
/// Telegram — показываем один раз с кнопкой «скопировать», и повторно его уже
/// не увидеть: хранить пароль в приложении значит хранить его в двух местах.
struct ResetPasswordSheet: View {
    let person: TeamOperator
    var onDone: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.api) private var api

    @State private var password = ResetPasswordSheet.generate()
    @State private var isSaving = false
    @State private var error: String?
    /// Пароль сменён и показан. Обратно на форму пути нет.
    @State private var issued = false
    @State private var sentToTelegram = false
    @State private var copied = false

    var body: some View {
        NavigationStack {
            ScreenScroll {
                if issued {
                    resultCard
                } else {
                    formCards
                }
            }
            .background(Theme.background)
            .navigationTitle(issued ? "Пароль сменён" : "Сброс пароля")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: issued ? .confirmationAction : .cancellationAction) {
                    Button(issued ? "Готово" : "Отмена") { dismiss() }
                }
            }
        }
        .interactiveDismissDisabled(issued && !sentToTelegram && !copied)
    }

    // ── Форма ────────────────────────────────────────────────────────────────

    @ViewBuilder
    private var formCards: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                FieldLabel("Кому")
                Text(person.displayName)
                    .font(Typography.title)
                    .foregroundStyle(Theme.text)
                if let username = person.username, !username.isEmpty {
                    Text("логин \(username)")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textMuted)
                }
            }
        }

        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                FieldLabel("Новый пароль")
                HStack(spacing: Spacing.sm) {
                    Text(password)
                        .font(Typography.title.monospaced())
                        .foregroundStyle(Theme.text)
                        .textSelection(.enabled)
                    Spacer()
                    Button {
                        password = ResetPasswordSheet.generate()
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .buttonStyle(.pressable)
                }

                Text("Придуман приложением: пароли, придуманные людьми, оказываются одинаковыми у всей смены.")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }

        Card(accent: person.hasTelegram ? Theme.info : Theme.warning) {
            HStack(alignment: .top, spacing: Spacing.sm) {
                Image(systemName: person.hasTelegram ? "paperplane.fill" : "eye")
                    .foregroundStyle(person.hasTelegram ? Theme.info : Theme.warning)
                Text(person.hasTelegram
                    ? "Уйдёт в Telegram: пароль останется у человека, а не на вашем экране."
                    : "Telegram не привязан — пароль покажется один раз. Передайте его сразу.")
                    .font(Typography.callout)
                    .foregroundStyle(Theme.textDim)
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
                Text("Сменить пароль")
            }
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(isSaving || person.authUserID == nil)

        if person.authUserID == nil {
            Text("У этого оператора нет входа в программу. Сначала выдайте ему учётную запись.")
                .font(Typography.caption)
                .foregroundStyle(Theme.warning)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // ── Результат ────────────────────────────────────────────────────────────

    @ViewBuilder
    private var resultCard: some View {
        Card(accent: Theme.positive) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                Label(
                    sentToTelegram ? "Отправлено в Telegram" : "Пароль сменён",
                    systemImage: sentToTelegram ? "paperplane.fill" : "checkmark.circle.fill"
                )
                .font(Typography.callout.weight(.semibold))
                .foregroundStyle(Theme.positive)

                if sentToTelegram {
                    Text("\(person.displayName) получит логин и пароль сообщением. На этом экране их больше не будет.")
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textDim)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    Text("Запишите или скопируйте — второй раз пароль не показывается.")
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textDim)
                        .fixedSize(horizontal: false, vertical: true)

                    HStack(spacing: Spacing.sm) {
                        Text(password)
                            .font(Typography.hero.monospaced())
                            .minimumScaleFactor(0.5)
                            .lineLimit(1)
                            .foregroundStyle(Theme.text)
                            .textSelection(.enabled)
                        Spacer()
                    }

                    Button {
                        copy()
                    } label: {
                        Label(copied ? "Скопировано" : "Скопировать", systemImage: copied ? "checkmark" : "doc.on.doc")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }
            }
        }

        if let username = person.username, !username.isEmpty, !sentToTelegram {
            Card {
                HStack {
                    Text("Логин")
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textDim)
                    Spacer()
                    Text(username)
                        .font(Typography.callout.weight(.medium).monospaced())
                        .foregroundStyle(Theme.text)
                        .textSelection(.enabled)
                }
            }
        }
    }

    // ── Действия ─────────────────────────────────────────────────────────────

    private func submit() async {
        guard let userID = person.authUserID else { return }
        isSaving = true
        error = nil
        defer { isSaving = false }

        do {
            let service = BusinessService(api: api)
            try await service.resetOperatorPassword(userID: userID, password: password)

            // Отправка — best-effort: пароль уже сменён, и молчать об этом
            // нельзя. Не ушло в Telegram — показываем на экране.
            if let chatID = person.telegramChatID, !chatID.isEmpty {
                do {
                    try await service.sendOperatorCredentials(
                        operatorID: person.id,
                        chatID: chatID,
                        username: person.username ?? "",
                        password: password,
                        name: person.displayName
                    )
                    sentToTelegram = true
                } catch {
                    sentToTelegram = false
                    self.error = "Пароль сменён, но в Telegram не ушёл — передайте его сами."
                }
            }

            issued = true
            Haptics.success()
            await onDone()
        } catch let apiError as APIError {
            Haptics.error()
            error = apiError.userMessage
        } catch {
            Haptics.error()
            self.error = error.localizedDescription
        }
    }

    private func copy() {
        #if os(iOS)
        UIPasteboard.general.string = password
        #endif
        copied = true
        Haptics.tap()
    }

    /// Пароль из словаря без похожих знаков.
    ///
    /// Ноль и «O», единица и «l» неразличимы на бумажке и в чужом почерке — а
    /// пароль часто переписывают от руки.
    private static func generate() -> String {
        let alphabet = Array("abcdefghijkmnpqrstuvwxyz23456789")
        return String((0..<10).map { _ in alphabet.randomElement() ?? "a" })
    }
}
