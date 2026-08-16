import OrdaKit
import OrdaUI
import SwiftUI

/// Деньги по оператору: аванс, премия, штраф, погашение долга.
///
/// Все четыре решения принимают у стойки, посреди смены, а сделать их можно
/// было только на сайте — то есть «вечером, когда дойду до компьютера».
/// Премия, назначенная через два дня, уже не работает как премия.
///
/// Один лист на все действия, а не четыре экрана: разница между ними в одном
/// поле, и человеку проще выбрать вид сверху, чем искать нужную кнопку.
struct AdvanceSheet: View {
    /// Что делаем с деньгами оператора.
    enum Kind: String, CaseIterable, Identifiable {
        case advance
        case bonus
        case fine

        var id: String { rawValue }

        var title: String {
            switch self {
            case .advance: "Аванс"
            case .bonus: "Премия"
            case .fine: "Штраф"
            }
        }

        var action: String {
            switch self {
            case .advance: "Выдать аванс"
            case .bonus: "Начислить премию"
            case .fine: "Удержать штраф"
            }
        }

        var note: String {
            switch self {
            case .advance: "Аванс сразу станет расходом точки и уменьшит остаток к выплате за неделю."
            case .bonus: "Премия прибавится к расчёту недели."
            case .fine: "Штраф вычтется из расчёта недели."
            }
        }
    }

    let row: SalaryRow
    let weekStart: String
    var onDone: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.api) private var api
    @Environment(BusinessStore.self) private var store
    @Environment(AuthStore.self) private var auth

    private var canMarkDebt: Bool { auth.resolver?.can("salary.mark_debt_paid") ?? false }
    private var canAdvance: Bool { auth.resolver?.can("salary.create_advance") ?? false }
    private var canAdjust: Bool { auth.resolver?.can("salary.create_adjustment") ?? false }

    /// Виды, доступные по правам. Пустой список означает, что человеку сюда
    /// вообще нечего было открывать, — но строка списка это уже проверила.
    private var kinds: [Kind] {
        var result: [Kind] = []
        if canAdvance { result.append(.advance) }
        if canAdjust { result.append(contentsOf: [.bonus, .fine]) }
        return result
    }

    @State private var kind: Kind = .advance
    @State private var companyID = ""
    @State private var amountText = ""
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
                        FieldLabel("Что делаем")
                        Picker("Что делаем", selection: $kind) {
                            ForEach(kinds) { option in
                                Text(option.title).tag(option)
                            }
                        }
                        .pickerStyle(.segmented)
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
                        if kind == .advance {
                            // У аванса две кассы: часть наличными из ящика,
                            // часть переводом. Премия и штраф — просто число.
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
                        } else {
                            amountField("Сумма", text: $amountText)
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

                if !kinds.isEmpty {
                Button {
                    Task { await submit() }
                } label: {
                    if isSaving {
                        ProgressView().controlSize(.small)
                    } else {
                        Text(kind.action)
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(isSaving)

                Text(kind.note)
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
                }

                // Долг относится к неделе целиком, а не к сумме в поле, —
                // поэтому отдельной кнопкой, а не ещё одним видом сверху.
                if row.week.debtAmount > 0, canMarkDebt {
                    Card(accent: Theme.warning) {
                        VStack(alignment: .leading, spacing: Spacing.md) {
                            SectionHeader(
                                "Долг за неделю",
                                subtitle: Money.format(row.week.debtAmount)
                            )

                            Button {
                                Task { await markDebtPaid() }
                            } label: {
                                Label("Долг погашен", systemImage: "checkmark.circle")
                            }
                            .buttonStyle(SecondaryButtonStyle())
                            .disabled(isSaving)

                            Text("Отмечайте, только когда деньги вернули: запись снимает долг со всех точек за эту неделю.")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textMuted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
            .background(Theme.background)
            .navigationTitle(row.operatorName)
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
                // Начинаем с того вида, который человеку доступен: иначе форма
                // открывалась на «Аванс» без права его выдавать.
                if let first = kinds.first, !kinds.contains(kind) { kind = first }
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
        let amount = kind == .advance ? total : AdvanceSheet.parse(amountText)

        if kind == .advance, companyID.isEmpty {
            error = "Выберите точку — аванс ложится расходом на её кассу."
            Haptics.error()
            return
        }
        guard amount > 0 else {
            error = "Сумма должна быть больше нуля."
            Haptics.error()
            return
        }

        isSaving = true
        error = nil
        defer { isSaving = false }

        do {
            let service = BusinessService(api: api)
            switch kind {
            case .advance:
                try await service.createSalaryAdvance(
                    operatorID: row.operatorID,
                    companyID: companyID,
                    weekStart: weekStart,
                    paymentDate: AdvanceSheet.isoDay(paymentDate),
                    cashAmount: cash,
                    kaspiAmount: kaspi,
                    comment: comment.trimmingCharacters(in: .whitespaces)
                )
            case .bonus, .fine:
                try await service.createSalaryAdjustment(
                    operatorID: row.operatorID,
                    companyID: companyID.isEmpty ? nil : companyID,
                    date: AdvanceSheet.isoDay(paymentDate),
                    amount: amount,
                    kind: kind == .bonus ? "bonus" : "fine",
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

    private func markDebtPaid() async {
        isSaving = true
        error = nil
        defer { isSaving = false }

        do {
            try await BusinessService(api: api).markOperatorDebtsPaid(
                operatorID: row.operatorID,
                weekStart: weekStart
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
