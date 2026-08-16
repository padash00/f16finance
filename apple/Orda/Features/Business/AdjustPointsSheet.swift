import OrdaKit
import OrdaUI
import SwiftUI

/// Корректировка бонусов клиента.
///
/// Спор на кассе решается на месте: «начислите, у меня не прошло». Идти ради
/// этого к компьютеру — значит отпустить человека недовольным и вернуться к
/// вопросу вечером, когда деталей уже никто не помнит.
///
/// Знак задаётся кнопкой, а не минусом в поле: «−20» и «-20» с разными
/// тире — обычная опечатка, из-за которой начисляют вместо списания.
struct AdjustPointsSheet: View {
    let customer: Customer
    var onDone: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.api) private var api

    @State private var isAdding = true
    @State private var amountText = ""
    @State private var reason = ""
    @State private var isSaving = false
    @State private var error: String?

    private var amount: Int { Int(amountText.filter(\.isNumber)) ?? 0 }
    private var resulting: Double {
        customer.loyaltyPoints + Double(isAdding ? amount : -amount)
    }

    var body: some View {
        NavigationStack {
            ScreenScroll {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        FieldLabel("Клиент")
                        Text(customer.name)
                            .font(Typography.title)
                            .foregroundStyle(Theme.text)
                        Text("Сейчас \(Quantity.format(customer.loyaltyPoints)) \(pluralize(Int(customer.loyaltyPoints), "балл", "балла", "баллов"))")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textMuted)
                    }
                }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        Picker("Действие", selection: $isAdding) {
                            Text("Начислить").tag(true)
                            Text("Списать").tag(false)
                        }
                        .pickerStyle(.segmented)

                        HStack {
                            Text("Баллов")
                                .font(Typography.callout)
                                .foregroundStyle(Theme.textDim)
                            Spacer()
                            TextField("0", text: $amountText)
                                .multilineTextAlignment(.trailing)
                                .font(Typography.callout.monospacedDigit())
                                #if os(iOS)
                                .keyboardType(.numberPad)
                                #endif
                                .frame(maxWidth: 120)
                        }

                        if amount > 0 {
                            RowDivider()
                            HStack {
                                Text("Станет")
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.textDim)
                                Spacer()
                                Text(Quantity.format(max(0, resulting)))
                                    .font(Typography.title)
                                    .foregroundStyle(resulting < 0 ? Theme.negative : Theme.text)
                            }

                            if resulting < 0 {
                                Text("У клиента столько баллов нет — списать больше, чем есть, не выйдет.")
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.negative)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        FieldLabel("Причина")
                        TextField("Например: не прошло начисление по чеку", text: $reason, axis: .vertical)
                            .textFieldStyle(.plain)
                            .lineLimit(1...3)
                            .padding(Spacing.md)
                            .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))

                        Text("Причина остаётся в журнале: корректировка баллов — это деньги, и через месяц никто не вспомнит, почему их начислили.")
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
                        Text(isAdding ? "Начислить" : "Списать")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(isSaving || amount == 0 || resulting < 0)
            }
            .background(Theme.background)
            .navigationTitle("Баллы")
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
            try await BusinessService(api: api).adjustLoyaltyPoints(
                customerID: customer.id,
                delta: isAdding ? amount : -amount,
                reason: reason.trimmingCharacters(in: .whitespaces)
            )
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
