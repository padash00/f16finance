import OrdaKit
import OrdaUI
import SwiftUI

/// Оплата: состав чека, способ, суммы.
struct CheckoutSheet: View {
    @Environment(OperatorStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var method: PaymentMethod = .cash
    @State private var cashText = ""
    @State private var kaspiText = ""
    @State private var error: String?
    @State private var isSubmitting = false
    /// Клиент чека: карта лояльности. Без него бонусы не начисляются.
    @State private var customer: PointCustomer?
    @State private var isPickingCustomer = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    lines

                    Card(accent: Theme.accent(for: .operator)) {
                        HStack {
                            Text("Итого")
                                .font(Typography.title)
                                .foregroundStyle(Theme.text)
                            Spacer()
                            Text(Money.format(store.cartTotal))
                                .font(Typography.monospacedDigits(Typography.metric))
                                .foregroundStyle(Theme.text)
                        }
                    }

                    customerCard

                    Picker("Оплата", selection: $method) {
                        ForEach(PaymentMethod.allCases, id: \.self) { option in
                            Text(option.label).tag(option)
                        }
                    }
                    .pickerStyle(.segmented)
                    .onChange(of: method) { _, _ in prefillAmounts() }

                    if method == .mixed {
                        amountField("Наличными", text: $cashText)
                        amountField("Kaspi", text: $kaspiText)

                        let entered = parse(cashText) + parse(kaspiText)
                        if abs(entered - store.cartTotal) >= 1 {
                            Text(
                                entered < store.cartTotal
                                    ? "Не хватает \(Money.format(store.cartTotal - entered))"
                                    : "Введено больше суммы чека на \(Money.format(entered - store.cartTotal))"
                            )
                            .font(Typography.callout)
                            .foregroundStyle(Theme.warning)
                        }
                    }

                    if let error {
                        Text(error)
                            .font(Typography.callout)
                            .foregroundStyle(Theme.negative)
                    }

                    Button {
                        submit()
                    } label: {
                        if isSubmitting {
                            ProgressView().controlSize(.small)
                        } else {
                            Text("Провести продажу")
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle(tint: Theme.accent(for: .operator)))
                    .disabled(isSubmitting)
                }
                .padding(Spacing.lg)
            }
            .background(Theme.background)
            .navigationTitle("Оплата")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Назад") { dismiss() }
                }
            }
        }
        .onAppear(perform: prefillAmounts)
    }

    private var lines: some View {
        Card {
            VStack(spacing: Spacing.md) {
                ForEach(store.cart) { line in
                    HStack(spacing: Spacing.md) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(line.name)
                                .font(Typography.body)
                                .foregroundStyle(Theme.text)
                                .lineLimit(1)
                            Text("\(Quantity.format(line.quantity)) × \(Money.format(line.unitPrice))")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textDim)
                        }

                        Spacer()

                        Stepper(
                            value: Binding(
                                get: { line.quantity },
                                set: { store.setQuantity($0, for: line.itemID) }
                            ),
                            in: 0...9999,
                            step: 1
                        ) {
                            Text(Money.format(line.total))
                                .font(Typography.callout.weight(.semibold))
                                .monospacedDigit()
                                .foregroundStyle(Theme.text)
                        }
                        .labelsHidden()

                        Text(Money.format(line.total))
                            .font(Typography.callout.weight(.semibold))
                            .monospacedDigit()
                            .foregroundStyle(Theme.text)
                    }
                }
            }
        }
    }

    private func amountField(_ title: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(title)
                .font(Typography.label)
                .foregroundStyle(Theme.textDim)
            HStack {
                TextField("0", text: text)
                    .textFieldStyle(.plain)
                    .monospacedDigit()
                    #if os(iOS)
                    .keyboardType(.numberPad)
                    #endif
                Text(Money.currencySymbol).foregroundStyle(Theme.textDim)
            }
            .padding(Spacing.md)
            .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
        }
    }

    /// Для одиночного способа оплаты суммы очевидны — не заставляем кассира
    /// вводить то, что и так известно.
    private func prefillAmounts() {
        switch method {
        case .cash:
            cashText = String(Int(store.cartTotal.rounded()))
            kaspiText = "0"
        case .kaspi:
            cashText = "0"
            kaspiText = String(Int(store.cartTotal.rounded()))
        case .mixed:
            if parse(cashText) + parse(kaspiText) == 0 {
                cashText = ""
                kaspiText = ""
            }
        }
    }

    private func parse(_ text: String) -> Double {
        Double(text.replacingOccurrences(of: ",", with: ".").trimmingCharacters(in: .whitespaces)) ?? 0
    }

    /// Клиент в чеке.
    ///
    /// Карта лояльности лежит у человека на брелке, а привязать её было нечем:
    /// приложение о клиентах не знало вовсе. Бонусы за такую продажу не
    /// начислялись — и человек про них спрашивал уже у стойки.
    private var customerCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                if let customer {
                    HStack(spacing: Spacing.md) {
                        Image(systemName: "person.text.rectangle")
                            .font(.system(size: 18))
                            .foregroundStyle(Theme.brand)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(customer.name)
                                .font(Typography.callout.weight(.semibold))
                                .foregroundStyle(Theme.text)
                            Text(customer.subtitle.isEmpty ? "без карты" : customer.subtitle)
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textDim)
                        }
                        Spacer(minLength: 0)
                        VStack(alignment: .trailing, spacing: 1) {
                            Text("\(Int(customer.loyaltyPoints))")
                                .font(Typography.callout.weight(.semibold))
                                .monospacedDigit()
                                .foregroundStyle(Theme.positive)
                            Text("бонусов")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textDim)
                        }
                        Button {
                            self.customer = nil
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(Theme.textDim)
                        }
                        .buttonStyle(.pressable)
                    }
                } else {
                    Button {
                        isPickingCustomer = true
                    } label: {
                        Label("Клиент по карте", systemImage: "person.badge.plus")
                            .font(Typography.callout)
                            .foregroundStyle(Theme.brand)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.pressable)
                }
            }
        }
        .sheet(isPresented: $isPickingCustomer) {
            CustomerPickerSheet { picked in
                customer = picked
                Haptics.tap()
            }
        }
    }

    private func submit() {
        isSubmitting = true
        error = nil

        Task {
            let failure = await store.checkout(
                method: method,
                cash: parse(cashText),
                kaspi: parse(kaspiText),
                customerID: customer?.id
            )
            isSubmitting = false
            if let failure {
                error = failure
                Haptics.error()
            } else {
                Haptics.success()
                dismiss()
            }
        }
    }
}

/// Подтверждение проведённой продажи и ссылка на чек.
struct SaleReceiptSheet: View {
    let feedback: OperatorStore.SaleFeedback

    @Environment(\.dismiss) private var dismiss
    @State private var appeared = false

    var body: some View {
        VStack(spacing: Spacing.xl) {
            Image(systemName: feedback.wasQueued ? "arrow.triangle.2.circlepath.circle.fill" : "checkmark.circle.fill")
                .font(.system(size: 64))
                .foregroundStyle(feedback.wasQueued ? Theme.warning : Theme.positive)
                .scaleEffect(appeared ? 1 : 0.6)
                .symbolEffect(.bounce, value: appeared)

            VStack(spacing: Spacing.sm) {
                Text(Money.format(feedback.total))
                    .font(Typography.monospacedDigits(Typography.hero))
                    .foregroundStyle(Theme.text)

                Text(feedback.wasQueued ? "Сохранено на устройстве" : "Продажа проведена")
                    .font(Typography.callout)
                    .foregroundStyle(Theme.textMuted)

                if feedback.wasQueued {
                    Text("Чек уйдёт на сервер, как только появится связь.")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                        .multilineTextAlignment(.center)
                }
            }

            // Чек — публичная страница по QR: клиент открывает её у себя,
            // печатать ничего не нужно.
            if let urlString = feedback.receiptURL, let url = URL(string: urlString) {
                ShareLink(item: url) {
                    Label("Отправить чек", systemImage: "square.and.arrow.up")
                }
                .buttonStyle(SecondaryButtonStyle())
            }

            Button("Готово") { dismiss() }
                .buttonStyle(PrimaryButtonStyle(tint: Theme.accent(for: .operator)))
        }
        .padding(Spacing.xxl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background)
        .onAppear {
            withAnimation(Motion.appear) { appeared = true }
        }
        .presentationDetents([.medium])
    }
}
