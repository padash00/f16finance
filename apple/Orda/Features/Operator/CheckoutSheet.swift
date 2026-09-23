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

    @State private var showsLines = false

    var body: some View {
        NavigationStack {
            ScreenScroll {
                // Сумма к оплате — крупно, как в банке перед переводом.
                VStack(spacing: 4) {
                    Text("К оплате")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(Theme.textDim)
                    Text(Money.format(store.cartTotal))
                        .font(.system(size: 44, weight: .bold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(Theme.text)
                    Button {
                        withAnimation(Motion.tap) { showsLines.toggle() }
                    } label: {
                        HStack(spacing: 4) {
                            Text("\(store.cartCount) \(pluralize(store.cartCount, "позиция", "позиции", "позиций"))")
                            Image(systemName: "chevron.down")
                                .font(.system(size: 11, weight: .bold))
                                .rotationEffect(.degrees(showsLines ? 180 : 0))
                        }
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Theme.brand)
                    }
                    .buttonStyle(.plain)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, Spacing.md)

                if showsLines { lines }

                LedgerEditForm.section("Чем платят") {
                    HStack(spacing: Spacing.sm) {
                        ForEach(PaymentMethod.allCases, id: \.self) { option in
                            methodTile(option)
                        }
                    }
                    .padding(.vertical, Spacing.md)

                    if method == .mixed {
                        LedgerEditForm.divider
                        LedgerEditForm.amountRow("Наличными", icon: "banknote.fill", text: $cashText)
                        LedgerEditForm.divider
                        LedgerEditForm.amountRow("Kaspi", icon: "qrcode", text: $kaspiText)
                    }
                }
                .onChange(of: method) { _, _ in prefillAmounts() }

                if method == .mixed {
                    let entered = parse(cashText) + parse(kaspiText)
                    if abs(entered - store.cartTotal) >= 1 {
                        Label(
                            entered < store.cartTotal
                                ? "Не хватает \(Money.format(store.cartTotal - entered))"
                                : "Больше суммы чека на \(Money.format(entered - store.cartTotal))",
                            systemImage: "exclamationmark.circle.fill"
                        )
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.warning)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }

                customerCard

                LedgerEditForm.saveButton(
                    title: "Провести продажу",
                    isSaving: isSubmitting,
                    problem: nil,
                    error: error
                ) { submit() }
            }
            .background(Theme.background)
            .navigationTitle("Оплата")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Назад") { dismiss() }
                }
            }
        }
        .onAppear(perform: prefillAmounts)
    }

    /// Способ оплаты — крупной плиткой: у стойки жмут не глядя, и мелкий
    /// переключатель промахивали.
    private func methodTile(_ option: PaymentMethod) -> some View {
        let isOn = method == option
        let icon = switch option {
        case .cash: "banknote.fill"
        case .kaspi: "qrcode"
        case .mixed: "square.split.2x1.fill"
        }
        return Button {
            method = option
            Haptics.tap()
        } label: {
            VStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 20, weight: .semibold))
                Text(option.label)
                    .font(.system(size: 14, weight: .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .foregroundStyle(isOn ? .white : Theme.text)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(isOn ? Theme.brand : Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.pressable)
    }

    /// Состав чека — строками, для сверки. Править его — в самом чеке.
    private var lines: some View {
        VStack(spacing: 0) {
            ForEach(Array(store.cart.enumerated()), id: \.element.id) { index, line in
                if index > 0 { Rectangle().fill(Theme.borderSoft).frame(height: 1) }
                HStack {
                    Text(line.name)
                        .font(.system(size: 15))
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                    Spacer(minLength: Spacing.sm)
                    Text("\(Quantity.format(line.quantity)) × \(Money.format(line.unitPrice))")
                        .font(.system(size: 13))
                        .monospacedDigit()
                        .foregroundStyle(Theme.textDim)
                    Text(Money.format(line.total))
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(Theme.text)
                        .frame(minWidth: 70, alignment: .trailing)
                }
                .padding(.vertical, 10)
            }
        }
        .padding(.horizontal, Spacing.lg)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
        .transition(.opacity)
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
        LedgerEditForm.section("Клиент") {
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
            .padding(.vertical, 13)
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
