import OrdaKit
import OrdaUI
import SwiftUI

/// Отмена складского документа: приёмки или списания.
///
/// Один лист на оба: разница только в том, что пишется в запрос, а разговор с
/// человеком одинаковый — «уверены, и почему».
///
/// Причина обязательна не для формы. Через месяц отменённый документ без
/// объяснения выглядит как воровство, и разбираться будут с тем, кто отменил.
struct CancelDocumentSheet: View {
    enum Kind {
        case receipt(id: String, title: String, amount: Double)
        case writeoff(id: String, title: String, amount: Double)

        var screenTitle: String {
            switch self {
            case .receipt: "Отмена приёмки"
            case .writeoff: "Отмена списания"
            }
        }

        var action: String {
            switch self {
            case .receipt: "Отменить приёмку"
            case .writeoff: "Отменить списание"
            }
        }

        var consequence: String {
            switch self {
            case .receipt:
                "Принятый товар уйдёт с остатков, долг поставщику пересчитается. Документ останется в истории с пометкой об отмене."
            case .writeoff:
                "Списанный товар вернётся на остаток. Документ останется в истории с пометкой об отмене."
            }
        }

        var title: String {
            switch self {
            case let .receipt(_, title, _), let .writeoff(_, title, _): title
            }
        }

        var amount: Double {
            switch self {
            case let .receipt(_, _, amount), let .writeoff(_, _, amount): amount
            }
        }
    }

    let kind: Kind
    var onDone: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.api) private var api

    @State private var reason = ""
    @State private var isSaving = false
    @State private var error: String?

    private var canSubmit: Bool {
        reason.trimmingCharacters(in: .whitespaces).count >= 3 && !isSaving
    }

    var body: some View {
        NavigationStack {
            ScreenScroll {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        Text(kind.title)
                            .font(Typography.title)
                            .foregroundStyle(Theme.text)
                        Text(Money.format(kind.amount))
                            .font(Typography.callout)
                            .foregroundStyle(Theme.textMuted)
                    }
                }

                Card(accent: Theme.warning) {
                    HStack(alignment: .top, spacing: Spacing.sm) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(Theme.warning)
                        Text(kind.consequence)
                            .font(Typography.callout)
                            .foregroundStyle(Theme.textDim)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        FieldLabel("Причина")
                        TextField("Например: пересчитали — пришло 18, а не 20", text: $reason, axis: .vertical)
                            .textFieldStyle(.plain)
                            .lineLimit(2...4)
                            .padding(Spacing.md)
                            .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))

                        Text("Обязательна. Через месяц отменённый документ без объяснения выглядит как воровство — и разбираться будут с тем, кто отменил.")
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
                        Text(kind.action)
                    }
                }
                .buttonStyle(DestructiveButtonStyle())
                .disabled(!canSubmit)
            }
            .background(Theme.background)
            .navigationTitle(kind.screenTitle)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Назад") { dismiss() }
                }
            }
        }
    }

    private func submit() async {
        isSaving = true
        error = nil
        defer { isSaving = false }

        let text = reason.trimmingCharacters(in: .whitespaces)
        do {
            let service = BusinessService(api: api)
            switch kind {
            case let .receipt(id, _, _):
                try await service.cancelReceipt(receiptID: id, reason: text)
            case let .writeoff(id, _, _):
                try await service.cancelWriteoff(writeoffID: id, reason: text)
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
