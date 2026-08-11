import OrdaKit
import OrdaUI
import SwiftUI

/// Вход в программу на точке по QR.
///
/// На терминале стоит очередь: пересменка, клиенты ждут, а оператор набирает
/// логин и пароль на общей клавиатуре — на виду у всех. QR решает и то и
/// другое: программа показывает код, оператор наводит свой телефон и
/// подтверждает, что это он. Пароль при этом нигде не звучит.
///
/// Сам вход выполняет сервер: приложение только подтверждает код. Терминал
/// опрашивает сервер и входит сам — оператору возвращаться к нему уже не с чем.
struct PointQRLoginScreen: View {
    @Environment(\.api) private var api
    @Environment(\.dismiss) private var dismiss

    @State private var result: PointQRResult?
    @State private var isSending = false
    /// Код, который уже отправили: камера видит один и тот же QR десятки раз в
    /// секунду, и без этого подтверждение ушло бы двадцать раз подряд.
    @State private var handledNonce: String?

    var body: some View {
        ScreenScroll {
            switch result {
            case .approved:
                successCard
            case .some(let failure):
                failureCard(failure)
            case nil:
                scannerCard
            }
        }
        .background(Theme.background)
        .navigationTitle("Вход по QR")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }

    // ── Сканирование ─────────────────────────────────────────────────────────

    private var scannerCard: some View {
        VStack(spacing: Spacing.lg) {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("Наведите на код", subtitle: "он показан в программе на точке")
                    ScannerPane { code in
                        confirm(code)
                    }
                    if isSending {
                        HStack(spacing: Spacing.sm) {
                            ProgressView().controlSize(.small)
                            Text("Подтверждаем…")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textDim)
                        }
                    }
                }
            }

            Card {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    Text("Как это работает")
                        .font(Typography.label)
                        .foregroundStyle(Theme.textDim)
                        .textCase(.uppercase)
                    step(1, "На терминале откройте вход и нажмите «Войти по QR».")
                    step(2, "Наведите камеру на код — подтверждение уйдёт само.")
                    step(3, "Программа на точке войдёт под вами. Пароль вводить не нужно.")
                    // Срок кода короткий намеренно: снятый на фото QR не должен
                    // работать через час в чужих руках.
                    Text("Код живёт несколько минут. Если не успели — обновите его на терминале.")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                        .padding(.top, Spacing.xs)
                }
            }
        }
    }

    private func step(_ number: Int, _ text: String) -> some View {
        HStack(alignment: .top, spacing: Spacing.sm) {
            Text("\(number)")
                .font(Typography.caption.weight(.bold))
                .foregroundStyle(Theme.accent(for: .operator))
                .frame(width: 20, height: 20)
                .background(
                    Theme.accent(for: .operator).opacity(0.12),
                    in: Circle()
                )
            Text(text)
                .font(Typography.callout)
                .foregroundStyle(Theme.textMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // ── Итог ─────────────────────────────────────────────────────────────────

    private var successCard: some View {
        Card(accent: Theme.positive) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                Label("Вход подтверждён", systemImage: "checkmark.seal.fill")
                    .font(Typography.title)
                    .foregroundStyle(Theme.positive)
                Text("Программа на точке входит под вами. Возвращайтесь к терминалу.")
                    .font(Typography.callout)
                    .foregroundStyle(Theme.textMuted)
                Button("Готово") { dismiss() }
                    .buttonStyle(PrimaryButtonStyle(tint: Theme.accent(for: .operator)))
            }
        }
    }

    private func failureCard(_ failure: PointQRResult) -> some View {
        Card(accent: Theme.warning) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                Label("Не вышло", systemImage: "exclamationmark.triangle")
                    .font(Typography.title)
                    .foregroundStyle(Theme.warning)
                Text(failure.message)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
                Button("Сканировать ещё раз") {
                    handledNonce = nil
                    result = nil
                }
                .buttonStyle(SecondaryButtonStyle())
            }
        }
    }

    // ── Действие ─────────────────────────────────────────────────────────────

    private func confirm(_ scanned: String) {
        guard !isSending else { return }
        guard let nonce = PointQRLogin.nonce(from: scanned) else {
            result = .notFound
            return
        }
        guard nonce != handledNonce else { return }
        handledNonce = nonce

        isSending = true
        Task {
            let outcome = await ExamService(api: api).confirmPointQR(nonce: nonce)
            isSending = false
            result = outcome
            if outcome == .approved {
                Haptics.success()
            } else {
                Haptics.error()
            }
        }
    }
}
