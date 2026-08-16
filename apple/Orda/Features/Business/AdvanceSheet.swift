import OrdaKit
import OrdaUI
import SwiftUI

/// Выдать аванс оператору.
///
/// Аванс просят у стойки, посреди смены, и до сих пор выдать его можно было
/// только на сайте — то есть «вечером, когда дойду до компьютера». Это одно из
/// немногих денежных действий, которое делают именно с телефона.
///
/// Сервер сам заводит расход по точке и корректировку недели: форма только
/// собирает, кому, сколько и откуда.
struct AdvanceSheet: View {
    let row: SalaryRow
    let weekStart: String
    var onDone: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.api) private var api
    @Environment(BusinessStore.self) private var store

    @State private var companyID = ""
    @State private var cashText = ""
    @State private var kaspiText = ""
    @State private var comment = ""
    @State private var paymentDate = Date()
    @State private var isSaving = false
    @State private var error: String?

    private var cash: Double { AdvanceSheet.parse(cashText) }
    private var kaspi: Double { AdvanceSheet.parse(kaspiText) }
    private var total: Double { cash + kaspi }

    var body: some View {
        NavigationStack {
            ScreenScroll {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        FieldLabel("Кому")
                        Text(row.operatorName)
                            .font(Typography.title)
                            .foregroundStyle(Theme.text)
                        Text("Неделя с \(weekStart) · к выплате \(Money.format(row.week.netAmount))")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textMuted)
                    }
                }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        FieldLabel("Точка")
                        // Точка обязательна: аванс это расход, и он должен лечь
                        // на ту точку, чья касса его выдала.
                        Picker("Точка", selection: $companyID) {
                            Text("Выберите точку").tag("")
                            ForEach(store.companies) { company in
                                Text(company.name).tag(company.id)
                            }
                        }
                        .pickerStyle(.menu)
                        .tint(Theme.brand)
                    }
                }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        amountField("Наличными", text: $cashText)
                        RowDivider()
                        amountField("Kaspi", text: $kaspiText)
                        RowDivider()
                        HStack {
                            Text("Итого")
                                .font(Typography.callout)
                                .foregroundStyle(Theme.textDim)
                            Spacer()
                            Text(Money.format(total))
                                .font(Typography.title)
                                .foregroundStyle(total > 0 ? Theme.text : Theme.textMuted)
                        }
                    }
                }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        DatePicker("Дата выплаты", selection: $paymentDate, displayedComponents: .date)
                            .font(Typography.callout)

                        RowDivider()

                        FieldLabel("Комментарий")
                        TextField("Необязательно", text: $comment, axis: .vertical)
                            .textFieldStyle(.plain)
                            .lineLimit(1...3)
                            .padding(Spacing.md)
                            .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
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
                        Text("Выдать аванс")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(isSaving)

                Text("Аванс сразу станет расходом точки и уменьшит остаток к выплате за неделю.")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .background(Theme.background)
            .navigationTitle("Аванс")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
            }
            .task {
                if companyID.isEmpty { companyID = store.companies.first?.id ?? "" }
            }
        }
    }

    private func amountField(_ title: String, text: Binding<String>) -> some View {
        HStack {
            Text(title)
                .font(Typography.callout)
                .foregroundStyle(Theme.textDim)
            Spacer()
            TextField("0", text: text)
                .multilineTextAlignment(.trailing)
                .font(Typography.callout.monospacedDigit())
                #if os(iOS)
                .keyboardType(.numberPad)
                #endif
                .frame(maxWidth: 140)
        }
    }

    private func submit() async {
        guard !companyID.isEmpty else {
            error = "Выберите точку — аванс ложится расходом на её кассу."
            Haptics.error()
            return
        }
        guard total > 0 else {
            error = "Сумма аванса должна быть больше нуля."
            Haptics.error()
            return
        }

        isSaving = true
        error = nil
        defer { isSaving = false }

        do {
            try await BusinessService(api: api).createSalaryAdvance(
                operatorID: row.operatorID,
                companyID: companyID,
                weekStart: weekStart,
                paymentDate: AdvanceSheet.isoDay(paymentDate),
                cashAmount: cash,
                kaspiAmount: kaspi,
                comment: comment.trimmingCharacters(in: .whitespaces)
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

    /// Суммы вводят как придётся: с пробелами, с запятой вместо точки.
    private static func parse(_ raw: String) -> Double {
        let cleaned = raw
            .replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: "\u{00A0}", with: "")
            .replacingOccurrences(of: ",", with: ".")
        return Double(cleaned) ?? 0
    }

    private static func isoDay(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}
