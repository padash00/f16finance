import OrdaKit
import OrdaUI
import SwiftUI

// ── Доходы и расходы по отдельности ──────────────────────────────────────────
//
// На сайте это две разные страницы, и в меню приложения два разных пункта. До
// этого оба вели на сводный экран «Деньги»: нажимаешь «Доходы» — попадаешь не
// туда, куда шёл, и раздел выглядит неоткрывающимся, хотя он открылся.
//
// Сводный экран остался: он висит на своём пункте «Деньги» и отвечает на
// вопрос «сколько осталось». Эти два отвечают на другой — «из чего сложилось».

struct AmountShareRow: View {
    let name: String
    let amount: Double
    let ratio: Double
    var color: Color = ChartPalette.series1

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack {
                Text(name)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Spacer()
                Text(Money.format(amount))
                    .font(Typography.callout.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(Theme.text)
            }
            ProportionBar(ratio: ratio, color: color)
        }
    }
}

enum ShiftLabel {
    static func of(_ raw: String?) -> String? {
        switch raw {
        case "day": "День"
        case "night": "Ночь"
        default: nil
        }
    }
}

enum DateFormatting {
    /// `2026-08-08` → «8 авг». Сырая ISO-дата в строке списка не читается.
    static func dayMonth(_ raw: String) -> String {
        guard let date = DateParsing.parseDateOnly(raw) else { return raw }
        return date.formatted(.dateTime.day().month(.abbreviated))
    }
}

extension TimePoint {
    /// Точка графика из пары «дата — сумма». Подпись — для человека: под
    /// столбиком «2026-08-01» не читается.
    static func fromDaily(_ entry: (date: String, amount: Double)) -> TimePoint? {
        guard let date = DateParsing.parseDateOnly(entry.date) else { return nil }
        return TimePoint(
            label: date.formatted(.dateTime.day().month(.abbreviated)),
            date: date,
            value: entry.amount
        )
    }
}


// ── Правка записи ────────────────────────────────────────────────────────────

/// Поправить доход.
///
/// Ошибаются в сумме чаще, чем кажется: смена закрылась, цифру записали не ту,
/// а исправить можно было только с сайта — то есть завтра. К утру расхождение
/// уже разошлось по отчётам.
struct EditIncomeSheet: View {
    let row: IncomeRow
    let onSaved: () async -> Void

    @Environment(\.api) private var api
    @Environment(\.dismiss) private var dismiss

    @State private var cash = ""
    @State private var kaspi = ""
    @State private var card = ""
    @State private var online = ""
    @State private var comment = ""
    @State private var isSaving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScreenScroll {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        SectionHeader(DateFormatting.dayMonth(row.date), subtitle: row.shift.map { $0 == "night" ? "Ночь" : "День" })

                        amountField("Наличные", text: $cash)
                        amountField("Kaspi", text: $kaspi)
                        amountField("Карта", text: $card)
                        amountField("Онлайн", text: $online)

                        FieldLabel("Комментарий")
                        TextField("необязательно", text: $comment)
                            .textFieldStyle(.plain)
                            .font(Typography.callout)

                        if let error {
                            Text(error).font(Typography.caption).foregroundStyle(Theme.negative)
                        }

                        Button(isSaving ? "Сохраняем…" : "Сохранить") { Task { await save() } }
                            .buttonStyle(PrimaryButtonStyle())
                            .disabled(isSaving)
                    }
                }
            }
            .background(Theme.background)
            .navigationTitle("Правка дохода")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } } }
            .task {
                cash = amountText(row.cashAmount)
                kaspi = amountText(row.kaspiAmount)
                card = amountText(row.cardAmount)
                online = amountText(row.onlineAmount)
                comment = row.comment ?? ""
            }
        }
    }

    /// Ноль показываем пустым полем: «0» в поле суммы читается как введённое
    /// значение, и человек не понимает, надо ли его стирать.
    private func amountText(_ value: Double) -> String {
        value == 0 ? "" : Quantity.format(value)
    }

    private func amountField(_ label: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            FieldLabel(label)
            TextField("0", text: text)
                .textFieldStyle(.plain)
                .font(Typography.callout)
                #if os(iOS)
                .keyboardType(.decimalPad)
                #endif
        }
    }

    private func save() async {
        isSaving = true
        defer { isSaving = false }
        do {
            try await BusinessService(api: api).updateIncome(
                id: row.id,
                date: row.date,
                cashAmount: AmountParsing.value(cash),
                kaspiAmount: AmountParsing.value(kaspi),
                cardAmount: AmountParsing.value(card),
                onlineAmount: AmountParsing.value(online),
                comment: comment.trimmingCharacters(in: .whitespaces)
            )
            Haptics.success()
            await onSaved()
            dismiss()
        } catch let apiError as APIError {
            error = apiError.userMessage
            Haptics.error()
        } catch {
            self.error = error.localizedDescription
            Haptics.error()
        }
    }
}

/// Поправить расход.
///
/// Точка и категория обязательны — так проверяет сервер. Они уже заполнены
/// тем, что было записано, и менять их обычно не нужно; поле оставлено для
/// случая, когда расход записали не на ту точку.
struct EditExpenseSheet: View {
    let row: ExpenseRow
    let onSaved: () async -> Void

    @Environment(\.api) private var api
    @Environment(\.dismiss) private var dismiss
    @Environment(BusinessStore.self) private var store

    @State private var cash = ""
    @State private var kaspi = ""
    @State private var category = ""
    @State private var companyID = ""
    @State private var comment = ""
    @State private var isSaving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScreenScroll {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        SectionHeader(DateFormatting.dayMonth(row.date), subtitle: row.category)

                        FieldLabel("Точка")
                        Picker("Точка", selection: $companyID) {
                            ForEach(store.companies) { company in Text(company.name).tag(company.id) }
                        }
                        .pickerStyle(.menu)

                        FieldLabel("Категория")
                        TextField("Категория", text: $category)
                            .textFieldStyle(.plain)
                            .font(Typography.callout)

                        VStack(alignment: .leading, spacing: 2) {
                            FieldLabel("Наличные")
                            TextField("0", text: $cash)
                                .textFieldStyle(.plain)
                                #if os(iOS)
                                .keyboardType(.decimalPad)
                                #endif
                        }
                        VStack(alignment: .leading, spacing: 2) {
                            FieldLabel("Kaspi")
                            TextField("0", text: $kaspi)
                                .textFieldStyle(.plain)
                                #if os(iOS)
                                .keyboardType(.decimalPad)
                                #endif
                        }

                        FieldLabel("Комментарий")
                        TextField("необязательно", text: $comment)
                            .textFieldStyle(.plain)
                            .font(Typography.callout)

                        if let error {
                            Text(error).font(Typography.caption).foregroundStyle(Theme.negative)
                        }

                        Button(isSaving ? "Сохраняем…" : "Сохранить") { Task { await save() } }
                            .buttonStyle(PrimaryButtonStyle())
                            .disabled(isSaving || companyID.isEmpty || category.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
            .background(Theme.background)
            .navigationTitle("Правка расхода")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } } }
            .task {
                cash = row.cashAmount == 0 ? "" : Quantity.format(row.cashAmount)
                kaspi = row.kaspiAmount == 0 ? "" : Quantity.format(row.kaspiAmount)
                category = row.category ?? ""
                companyID = row.companyID ?? ""
                comment = row.comment ?? ""
                if store.companies.isEmpty { await store.loadCompanies() }
            }
        }
    }

    private func save() async {
        isSaving = true
        defer { isSaving = false }
        do {
            try await BusinessService(api: api).updateExpense(
                id: row.id,
                date: row.date,
                companyID: companyID,
                category: category.trimmingCharacters(in: .whitespaces),
                cashAmount: AmountParsing.value(cash),
                kaspiAmount: AmountParsing.value(kaspi),
                comment: comment.trimmingCharacters(in: .whitespaces)
            )
            Haptics.success()
            await onSaved()
            dismiss()
        } catch let apiError as APIError {
            error = apiError.userMessage
            Haptics.error()
        } catch {
            self.error = error.localizedDescription
            Haptics.error()
        }
    }
}
