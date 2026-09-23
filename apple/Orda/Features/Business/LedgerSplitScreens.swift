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
///
/// Форма правит сумму по способам, дату и комментарий. Оператор и «Kaspi до
/// полуночи» уходят из исходной записи (`IncomeEdit`): раньше форма их не
/// отправляла, и сервер обнулял их при каждом исправлении.
struct EditIncomeSheet: View {
    let row: IncomeRow
    let onSaved: () async -> Void

    @Environment(\.api) private var api
    @Environment(\.dismiss) private var dismiss
    @Environment(BusinessStore.self) private var store

    @State private var edit: IncomeEdit
    @State private var cash = ""
    @State private var kaspi = ""
    @State private var card = ""
    @State private var online = ""
    @State private var date = Date()
    @State private var isSaving = false
    @State private var error: String?

    init(row: IncomeRow, onSaved: @escaping () async -> Void) {
        self.row = row
        self.onSaved = onSaved
        _edit = State(initialValue: IncomeEdit(row: row))
        _cash = State(initialValue: LedgerEditForm.text(row.cashAmount))
        _kaspi = State(initialValue: LedgerEditForm.text(row.kaspiAmount))
        _card = State(initialValue: LedgerEditForm.text(row.cardAmount))
        _online = State(initialValue: LedgerEditForm.text(row.onlineAmount))
        _date = State(initialValue: DateParsing.parseDateOnly(row.date) ?? Date())
    }

    private var draft: IncomeEdit {
        var value = edit
        value.cash = AmountParsing.value(cash)
        value.kaspi = AmountParsing.value(kaspi)
        value.card = AmountParsing.value(card)
        value.online = AmountParsing.value(online)
        value.date = DateParsing.dateOnlyString(from: date)
        return value
    }

    var body: some View {
        NavigationStack {
            ScreenScroll {
                LedgerEditForm.total(draft.total, caption: row.shift.map { $0 == "night" ? "Ночная смена" : "Дневная смена" }, tint: Theme.positive)

                LedgerEditForm.section("Сумма") {
                    LedgerEditForm.amountRow("Наличные", icon: "banknote.fill", text: $cash)
                    LedgerEditForm.divider
                    LedgerEditForm.amountRow("Kaspi", icon: "qrcode", text: $kaspi)
                    LedgerEditForm.divider
                    LedgerEditForm.amountRow("Карта", icon: "creditcard.fill", text: $card)
                    LedgerEditForm.divider
                    LedgerEditForm.amountRow("Онлайн", icon: "globe", text: $online)
                }

                LedgerEditForm.section("Подробности") {
                    LedgerEditForm.operatorRow(store: store, selection: $edit.operatorID)
                    LedgerEditForm.divider
                    LedgerEditForm.dateRow($date)
                    LedgerEditForm.divider
                    LedgerEditForm.commentRow($edit.comment)
                }

                LedgerEditForm.saveButton(isSaving: isSaving, problem: draft.problem, error: error) {
                    Task { await save() }
                }
            }
            .background(Theme.background)
            .navigationTitle("Правка дохода")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } } }
            .task { if store.operators.isEmpty { await store.loadTeam() } }
        }
    }

    private func save() async {
        guard draft.problem == nil else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            try await BusinessService(api: api).updateIncome(draft)
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
/// тем, что было записано; точку можно сменить, если расход записали не туда.
/// Оператор уходит из исходной записи.
struct EditExpenseSheet: View {
    let row: ExpenseRow
    let onSaved: () async -> Void

    @Environment(\.api) private var api
    @Environment(\.dismiss) private var dismiss
    @Environment(BusinessStore.self) private var store

    @State private var edit: ExpenseEdit?
    @State private var cash = ""
    @State private var kaspi = ""
    @State private var date = Date()
    @State private var isSaving = false
    @State private var error: String?

    init(row: ExpenseRow, onSaved: @escaping () async -> Void) {
        self.row = row
        self.onSaved = onSaved
        _edit = State(initialValue: ExpenseEdit(row: row))
        _cash = State(initialValue: LedgerEditForm.text(row.cashAmount))
        _kaspi = State(initialValue: LedgerEditForm.text(row.kaspiAmount))
        _date = State(initialValue: DateParsing.parseDateOnly(row.date) ?? Date())
    }

    private var draft: ExpenseEdit? {
        guard var value = edit else { return nil }
        value.cash = AmountParsing.value(cash)
        value.kaspi = AmountParsing.value(kaspi)
        value.date = DateParsing.dateOnlyString(from: date)
        return value
    }

    /// Категории справочника; записанная, если её там уже нет, — тоже в списке.
    private var categoryNames: [String] {
        var names = store.expenseCategories.map(\.name)
        if let current = edit?.category, !current.isEmpty, !names.contains(current) {
            names.insert(current, at: 0)
        }
        return names
    }

    var body: some View {
        NavigationStack {
            Group {
                if let draft {
                    ScreenScroll {
                        LedgerEditForm.total(draft.total, caption: draft.category, tint: Theme.negative)

                        LedgerEditForm.section("Сумма") {
                            LedgerEditForm.amountRow("Наличные", icon: "banknote.fill", text: $cash)
                            LedgerEditForm.divider
                            LedgerEditForm.amountRow("Kaspi", icon: "qrcode", text: $kaspi)
                        }

                        LedgerEditForm.section("Подробности") {
                            LedgerEditForm.menuRow("Категория", icon: "tag.fill", value: draft.category.isEmpty ? "Выбрать" : draft.category) {
                                ForEach(categoryNames, id: \.self) { name in
                                    Button(name) { edit?.category = name }
                                }
                            }
                            LedgerEditForm.divider
                            LedgerEditForm.menuRow("Точка", icon: "building.2.fill", value: store.companyName(draft.companyID) ?? "Выбрать") {
                                ForEach(store.companies) { company in
                                    Button(company.name) { edit?.companyID = company.id }
                                }
                            }
                            LedgerEditForm.divider
                            LedgerEditForm.operatorRow(store: store, selection: Binding(
                                get: { edit?.operatorID },
                                set: { edit?.operatorID = $0 }
                            ))
                            LedgerEditForm.divider
                            LedgerEditForm.dateRow($date)
                            LedgerEditForm.divider
                            LedgerEditForm.commentRow(Binding(
                                get: { edit?.comment ?? "" },
                                set: { edit?.comment = $0 }
                            ))
                        }

                        LedgerEditForm.saveButton(isSaving: isSaving, problem: draft.problem, error: error) {
                            Task { await save() }
                        }
                    }
                } else {
                    WideEmptyState(
                        icon: "building.2",
                        title: "Нет точки",
                        message: "У этого расхода не указана точка. Исправьте его на сайте."
                    )
                }
            }
            .background(Theme.background)
            .navigationTitle("Правка расхода")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } } }
            .task {
                if store.companies.isEmpty { await store.loadCompanies() }
                if store.expenseCategories.isEmpty { await store.loadCategories() }
                if store.operators.isEmpty { await store.loadTeam() }
            }
        }
    }

    private func save() async {
        guard let draft, draft.problem == nil else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            try await BusinessService(api: api).updateExpense(draft)
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

/// Общие куски форм правки — как карточка перевода в банковском приложении:
/// итог крупно сверху, поля строками на белом.
enum LedgerEditForm {
    /// Ноль — пустым полем: «0» читается как введённое значение.
    static func text(_ value: Double) -> String {
        value == 0 ? "" : Quantity.format(value)
    }

    static func total(_ value: Double, caption: String?, tint: Color) -> some View {
        VStack(spacing: 4) {
            Text(Money.format(value))
                .font(.system(size: 36, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(Theme.text)
                .contentTransition(.numericText())
                .animation(Motion.value, value: value)
            if let caption, !caption.isEmpty {
                Text(caption)
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textDim)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Spacing.md)
    }

    static func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.textDim)
                .padding(.horizontal, Spacing.xs)
            VStack(spacing: 0) { content() }
                .padding(.horizontal, Spacing.lg)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
        }
    }

    static var divider: some View {
        Rectangle().fill(Theme.borderSoft).frame(height: 1).padding(.leading, 40)
    }

    private static func label(_ title: String, icon: String) -> some View {
        HStack(spacing: Spacing.md) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Theme.brand)
                .frame(width: 28)
            Text(title)
                .font(.system(size: 16))
                .foregroundStyle(Theme.text)
        }
    }

    static func amountRow(_ title: String, icon: String, text: Binding<String>) -> some View {
        HStack {
            label(title, icon: icon)
            Spacer(minLength: Spacing.md)
            TextField("0", text: text)
                .multilineTextAlignment(.trailing)
                .font(.system(size: 17, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(Theme.text)
                #if os(iOS)
                .keyboardType(.decimalPad)
                #endif
            Text("₸").foregroundStyle(Theme.textDim)
        }
        .padding(.vertical, 13)
    }

    static func dateRow(_ date: Binding<Date>) -> some View {
        HStack {
            label("Дата", icon: "calendar")
            Spacer()
            DatePicker("", selection: date, in: ...Date(), displayedComponents: .date)
                .labelsHidden()
        }
        .padding(.vertical, 8)
    }

    static func commentRow(_ text: Binding<String>) -> some View {
        HStack(alignment: .top) {
            label("Комментарий", icon: "text.bubble.fill")
            Spacer(minLength: Spacing.md)
            TextField("необязательно", text: text, axis: .vertical)
                .multilineTextAlignment(.trailing)
                .lineLimit(1...4)
                .font(.system(size: 16))
        }
        .padding(.vertical, 13)
    }

    static func menuRow<Items: View>(_ title: String, icon: String, value: String, @ViewBuilder items: () -> Items) -> some View {
        Menu {
            items()
        } label: {
            HStack {
                label(title, icon: icon)
                Spacer(minLength: Spacing.md)
                Text(value)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Theme.brand)
                    .lineLimit(1)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.textDim)
            }
            .padding(.vertical, 13)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// Оператор — как на сайте: действующие по алфавиту, а записанный, даже
    /// если уже уволен, остаётся в списке, чтобы правка его не потеряла.
    @MainActor
    static func operatorRow(store: BusinessStore, selection: Binding<String?>) -> some View {
        let current = selection.wrappedValue
        let people = store.operators
            .filter { $0.isActive || $0.id == current }
            .sorted { ($0.shortName ?? $0.name) < ($1.shortName ?? $1.name) }
        let name = people.first { $0.id == current }.map { $0.shortName ?? $0.name }
        return menuRow("Оператор", icon: "person.fill", value: name ?? (current == nil ? "Не выбран" : "…")) {
            Button("Не выбран") { selection.wrappedValue = nil }
            ForEach(people) { person in
                Button(person.shortName ?? person.name) { selection.wrappedValue = person.id }
            }
        }
    }

    static func saveButton(isSaving: Bool, problem: String?, error: String?, action: @escaping () -> Void) -> some View {
        VStack(spacing: Spacing.sm) {
            if let message = error ?? problem {
                Text(message)
                    .font(.system(size: 13))
                    .foregroundStyle(error == nil ? Theme.textDim : Theme.negative)
                    .multilineTextAlignment(.center)
            }
            Button(isSaving ? "Сохраняем…" : "Сохранить", action: action)
                .buttonStyle(PrimaryButtonStyle())
                .disabled(isSaving || problem != nil)
        }
        .padding(.top, Spacing.sm)
    }
}
