import OrdaKit
import OrdaUI
import SwiftUI

/// Деньги по административному сотруднику: выплата, премия, штраф, аванс.
///
/// Оклады считаются в приложении с недавних пор, но платить всё равно надо
/// было идти на сайт: ведомость показывала долг и молчала о том, как его
/// закрыть. Документ, который нельзя провести с того же экрана, где его
/// смотрят, — половина работы.
///
/// Один лист на четыре действия по образцу листа оператора: разница между
/// ними в одном-двух полях, и выбрать вид сверху проще, чем искать кнопку.
struct StaffSalarySheet: View {
    enum Kind: String, CaseIterable, Identifiable {
        case payment
        case bonus
        case fine
        case advance

        var id: String { rawValue }

        var title: String {
            switch self {
            case .payment: "Выплата"
            case .bonus: "Премия"
            case .fine: "Штраф"
            case .advance: "Аванс"
            }
        }

        var action: String {
            switch self {
            case .payment: "Выплатить"
            case .bonus: "Начислить премию"
            case .fine: "Удержать штраф"
            case .advance: "Выдать аванс"
            }
        }

        var note: String {
            switch self {
            case .payment: "Выплата станет расходом точки и закроет корректировки этой половины месяца."
            case .bonus: "Премия прибавится к расчёту половины месяца."
            case .fine: "Штраф вычтется из расчёта половины месяца."
            case .advance: "Аванс сразу станет расходом точки и уменьшит остаток к выплате."
            }
        }
    }

    let row: StaffSalaryRow
    var onDone: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.api) private var api
    @Environment(BusinessStore.self) private var store
    @Environment(AuthStore.self) private var auth

    private var canPay: Bool { auth.resolver?.can("salary.create_payment") ?? false }
    private var canAdjust: Bool { auth.resolver?.can("salary.create_adjustment") ?? false }

    private var kinds: [Kind] {
        var result: [Kind] = []
        if canPay { result.append(.payment) }
        if canAdjust { result.append(contentsOf: [.bonus, .fine, .advance]) }
        return result
    }

    @State private var kind: Kind = .payment
    @State private var companyID = ""
    @State private var amountText = ""
    @State private var cashText = ""
    @State private var kaspiText = ""
    @State private var comment = ""
    @State private var date = Date()
    @State private var isSaving = false
    @State private var error: String?

    private var cash: Double { StaffSalarySheet.parse(cashText) }
    private var kaspi: Double { StaffSalarySheet.parse(kaspiText) }
    private var total: Double { cash + kaspi }

    /// Половина месяца, которую закрывает выплата. Пусто — обе уже закрыты.
    private var slot: String? { row.openSlot }

    var body: some View {
        NavigationStack {
            ScreenScroll {
                header

                if kinds.count > 1 {
                    Card {
                        VStack(alignment: .leading, spacing: Spacing.md) {
                            FieldLabel("Что делаем")
                            Picker("Что делаем", selection: $kind) {
                                ForEach(kinds) { option in
                                    Text(option.title).tag(option)
                                }
                            }
                            .pickerStyle(.segmented)
                        }
                    }
                }

                if kind == .payment, slot == nil {
                    Card {
                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            Text("Месяц закрыт")
                                .font(Typography.callout.weight(.medium))
                                .foregroundStyle(Theme.text)
                            Text("Обе выплаты этого месяца уже проведены. Следующая — в следующем месяце.")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textMuted)
                        }
                    }
                } else {
                    form
                }

                if let error {
                    Card {
                        Text(error)
                            .font(Typography.caption)
                            .foregroundStyle(Theme.negative)
                    }
                }
            }
            .background(Theme.background)
            .navigationTitle(kind.title)
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
                if let first = kinds.first, !kinds.contains(kind) { kind = first }
                // Форму открываем с расчётной суммой: чаще всего платят ровно
                // столько, и перебивать цифру руками незачем.
                if cashText.isEmpty, row.toPay > 0 {
                    cashText = String(Int(row.toPay.rounded()))
                }
            }
        }
    }

    // ── Куски экрана ─────────────────────────────────────────────────────────

    private var header: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                FieldLabel("Кому")
                Text(row.name)
                    .font(Typography.title)
                    .foregroundStyle(Theme.text)
                Text(subtitle)
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textMuted)
            }
        }
    }

    private var subtitle: String {
        var parts: [String] = ["к выплате \(Money.format(row.toPay))"]
        if row.paidThisMonth > 0.01 {
            parts.append("выплачено за месяц \(Money.format(row.paidThisMonth))")
        }
        if !row.isActive, let date = row.dismissalDate {
            parts.append("уволен \(date)")
        }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder
    private var form: some View {
        // Точка нужна там, где рождается расход: выплата и аванс уходят из
        // кассы конкретной точки. Премия и штраф кассы не трогают.
        if kind == .payment || kind == .advance {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    FieldLabel("Точка")
                    Picker("Точка", selection: $companyID) {
                        Text("Выберите точку").tag("")
                        ForEach(store.companies) { company in
                            Text(company.name).tag(company.id)
                        }
                    }
                    .pickerStyle(.menu)
                }
            }
        }

        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                if kind == .payment {
                    FieldLabel("Сколько выдаём")
                    amountField("Наличными", text: $cashText)
                    RowDivider()
                    amountField("Kaspi", text: $kaspiText)
                    RowDivider()
                    HStack {
                        Text("Итого")
                            .font(Typography.callout.weight(.medium))
                            .foregroundStyle(Theme.text)
                        Spacer()
                        Text(Money.format(total))
                            .font(Typography.callout.weight(.medium).monospacedDigit())
                            .foregroundStyle(Theme.text)
                    }
                    // Переплата — не ошибка ввода, а решение: сервер заведёт
                    // разницу авансом и удержит её в следующей половине.
                    if total > row.toPay + 0.5 {
                        Text("Больше расчёта на \(Money.format(total - row.toPay)) — разница уйдёт авансом и вычтется из следующей выплаты.")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.warning)
                    }
                } else {
                    FieldLabel("Сумма")
                    amountField(kind.title, text: $amountText)
                }

                RowDivider()
                DatePicker("Дата", selection: $date, displayedComponents: .date)
                    .font(Typography.callout)

                RowDivider()
                FieldLabel("Комментарий")
                TextField("Необязательно", text: $comment, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(Typography.callout)
                    .lineLimit(1...3)
            }
        }

        Card {
            Text(kind.note)
                .font(Typography.caption)
                .foregroundStyle(Theme.textMuted)
        }

        Button(isSaving ? "Сохраняем…" : kind.action) {
            Task { await submit() }
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(isSaving)
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

    // ── Отправка ─────────────────────────────────────────────────────────────

    private func submit() async {
        let amount = kind == .payment ? total : StaffSalarySheet.parse(amountText)

        guard amount > 0 else {
            error = "Сумма должна быть больше нуля."
            Haptics.error()
            return
        }
        if kind == .payment || kind == .advance, companyID.isEmpty {
            error = "Выберите точку — деньги уходят из её кассы."
            Haptics.error()
            return
        }
        guard kind != .payment || slot != nil else { return }

        isSaving = true
        error = nil
        defer { isSaving = false }

        do {
            let service = BusinessService(api: api)
            switch kind {
            case .payment:
                try await service.payStaffSalary(
                    staffID: row.id,
                    companyID: companyID,
                    payDate: StaffSalarySheet.isoDay(date),
                    slot: slot ?? "first",
                    cashAmount: cash,
                    kaspiAmount: kaspi,
                    expectedAmount: row.toPay,
                    comment: comment.trimmingCharacters(in: .whitespaces)
                )
            case .bonus, .fine, .advance:
                try await service.createStaffAdjustment(
                    staffID: row.id,
                    companyID: kind == .advance ? companyID : nil,
                    kind: kind.rawValue,
                    amount: amount,
                    date: StaffSalarySheet.isoDay(date),
                    comment: comment.trimmingCharacters(in: .whitespaces)
                )
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
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}
