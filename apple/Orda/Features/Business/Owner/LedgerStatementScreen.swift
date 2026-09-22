import OrdaKit
import OrdaUI
import SwiftUI

/// Доходы или расходы — как выписка в банковском приложении.
///
/// Сверху большая сумма за период, под ней — категории пузырями (нажатие
/// фильтрует), дальше операции по дням с итогом дня. Нажатие на операцию
/// открывает её «чек» с правкой. Всё, что было на прежних экранах, — период,
/// добавление, правка, доли по точкам и способам, ожидающие согласования, —
/// осталось, но разложено иначе.
struct LedgerStatementScreen: View {
    enum Kind { case income, expense }

    let kind: Kind

    @Environment(BusinessStore.self) private var store
    @Environment(\.access) private var access

    @State private var isAdding = false
    @State private var opened: Operation?
    @State private var editingIncome: IncomeRow?
    @State private var editingExpense: ExpenseRow?
    @State private var query = ""
    /// Выбранная категория (расходы) или способ оплаты (доходы).
    @State private var bucket: String?
    @State private var companyID: String?

    /// Операция выписки — общий вид дохода и расхода.
    struct Operation: Identifiable, Hashable {
        let id: String
        let date: String
        let title: String
        let subtitle: String?
        let amount: Double
        let icon: String
        let tint: Color
        let isPending: Bool
        let companyID: String?
        /// Разбивка по способам: «Наличные 5 000 ₸».
        let parts: [(String, Double)]
        let comment: String?
        /// Корзины, в которые попадает операция: статья или способы оплаты.
        let buckets: Set<String>

        static func == (a: Operation, b: Operation) -> Bool { a.id == b.id }
        func hash(into hasher: inout Hasher) { hasher.combine(id) }
    }

    // ── Данные ───────────────────────────────────────────────────────────────

    private var isIncome: Bool { kind == .income }
    private var title: String { isIncome ? "Доходы" : "Расходы" }
    private var tint: Color { isIncome ? Color(hex: 0x10B981) : Color(hex: 0xEF4444) }

    private var canCreate: Bool { access?.can(isIncome ? "income.create" : "expenses.create") ?? false }
    private var canEdit: Bool { access?.can(isIncome ? "income.edit" : "expenses.edit") ?? false }

    private var operations: [Operation] {
        if isIncome {
            return store.incomes.map { row in
                let parts = [("Наличные", row.cashAmount), ("Kaspi", row.kaspiAmount), ("Карта", row.cardAmount), ("Онлайн", row.onlineAmount)]
                    .filter { $0.1 != 0 }
                return Operation(
                    id: row.id,
                    date: row.date,
                    title: store.companyName(row.companyID) ?? "Выручка",
                    subtitle: [ShiftLabel.of(row.shift).map { "\($0), смена" }, row.comment].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "),
                    amount: row.total,
                    icon: row.shift == "night" ? "moon.fill" : "sun.max.fill",
                    tint: row.shift == "night" ? Color(hex: 0x6366F1) : Color(hex: 0xF59E0B),
                    isPending: false,
                    companyID: row.companyID,
                    parts: parts,
                    comment: row.comment,
                    buckets: Set(parts.map(\.0))
                )
            }
        }
        return store.expenses.map { row in
            let category = row.category?.isEmpty == false ? row.category! : "Без категории"
            let parts = [("Наличные", row.cashAmount), ("Kaspi", row.kaspiAmount)].filter { $0.1 != 0 }
            return Operation(
                id: row.id,
                date: row.date,
                title: category,
                subtitle: [store.companyName(row.companyID), row.comment].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "),
                amount: row.total,
                icon: OwnerAnalyticsScreen.expenseIcon(category),
                tint: Self.categoryTint(category),
                isPending: row.isPending,
                companyID: row.companyID,
                parts: parts,
                comment: row.comment,
                buckets: [category]
            )
        }
    }

    private var filtered: [Operation] {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        return operations.filter { op in
            (bucket == nil || op.buckets.contains(bucket!))
                && (companyID == nil || op.companyID == companyID)
                && (needle.isEmpty
                    || op.title.lowercased().contains(needle)
                    || (op.subtitle?.lowercased().contains(needle) ?? false)
                    || Money.format(op.amount).replacingOccurrences(of: "\u{202F}", with: "").contains(needle.replacingOccurrences(of: " ", with: "")))
        }
        .sorted { $0.date == $1.date ? $0.amount > $1.amount : $0.date > $1.date }
    }

    /// Пузыри сверху: статьи расходов или способы оплаты доходов.
    private var buckets: [(name: String, amount: Double)] {
        let source = operations.filter { companyID == nil || $0.companyID == companyID }
        var sums: [String: Double] = [:]
        for op in source {
            if isIncome {
                for (name, value) in op.parts { sums[name, default: 0] += value }
            } else {
                sums[op.title, default: 0] += op.amount
            }
        }
        return sums.map { ($0.key, $0.value) }.sorted { $0.1 > $1.1 }
    }

    private var days: [(date: String, total: Double, items: [Operation])] {
        Dictionary(grouping: filtered, by: \.date)
            .map { ($0.key, $0.value.reduce(0) { $0 + $1.amount }, $0.value) }
            .sorted { $0.0 > $1.0 }
    }

    private var isLoading: Bool { isIncome ? store.isLoadingIncomes : store.isLoadingExpenses }
    private var error: APIError? { isIncome ? store.incomesError : store.expensesError }

    private func reload() async {
        if isIncome { await store.loadIncomes() } else { await store.loadExpenses() }
    }

    // ── Экран ────────────────────────────────────────────────────────────────

    var body: some View {
        @Bindable var bindable = store

        return ScrollView {
            LazyVStack(spacing: Spacing.lg, pinnedViews: []) {
                summary
                PillSegment(
                    options: DateRange.allCases.map { ($0, $0.label) },
                    selection: $bindable.range
                )
                if operations.isEmpty {
                    if let error {
                        ErrorStateView(error: error) { Task { await reload() } }
                    } else if isLoading {
                        Skeleton(height: 300, cornerRadius: 24)
                    } else {
                        EmptyStateView(
                            icon: isIncome ? "arrow.down.circle" : "arrow.up.circle",
                            title: isIncome ? "Доходов нет" : "Расходов нет",
                            message: "За выбранный период записей не заведено."
                        )
                    }
                } else {
                    filters
                    bubbles
                    statement
                }
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.bottom, Spacing.xxl)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.background)
        .navigationTitle(title)
        .searchable(text: $query, prompt: isIncome ? "Точка, смена, комментарий" : "Статья, точка, сумма")
        .toolbar {
            if canCreate {
                ToolbarItem(placement: .primaryAction) {
                    Button { isAdding = true } label: {
                        Image(systemName: "plus")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 32, height: 32)
                            .background(tint, in: Circle())
                    }
                }
            }
        }
        .task { await reload() }
        .refreshable { await reload() }
        .sheet(isPresented: $isAdding) {
            if isIncome { AddIncomeSheet() } else { AddExpenseSheet() }
        }
        .sheet(item: $opened) { op in
            OperationReceipt(
                operation: op,
                isIncome: isIncome,
                companyName: store.companyName(op.companyID),
                canEdit: canEdit
            ) {
                opened = nil
                if isIncome {
                    editingIncome = store.incomes.first { $0.id == op.id }
                } else {
                    editingExpense = store.expenses.first { $0.id == op.id }
                }
            }
            .presentationDetents([.medium, .large])
        }
        .sheet(item: $editingIncome) { row in
            EditIncomeSheet(row: row) { await store.loadIncomes() }
        }
        .sheet(item: $editingExpense) { row in
            EditExpenseSheet(row: row) { await store.loadExpenses() }
        }
    }

    // ── Итог ─────────────────────────────────────────────────────────────────

    private var summary: some View {
        let total = filtered.reduce(0) { $0 + $1.amount }
        let pending = isIncome ? [] : store.expensesAwaitingApproval
        return VStack(alignment: .leading, spacing: Spacing.sm) {
            Text(summaryCaption)
                .font(.system(size: 15))
                .foregroundStyle(Theme.textDim)
            Text((isIncome ? "+" : "−") + Money.format(total))
                .font(.system(size: 38, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(isIncome ? Theme.positive : Theme.text)
                .contentTransition(.numericText())
                .animation(Motion.value, value: total)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            HStack(spacing: Spacing.sm) {
                Label("\(filtered.count) \(Self.operationsWord(filtered.count))", systemImage: "list.bullet")
                if !pending.isEmpty {
                    Label("\(pending.count) на согласовании", systemImage: "clock")
                        .foregroundStyle(Theme.warning)
                }
            }
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(Theme.textDim)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, Spacing.sm)
    }

    private var summaryCaption: String {
        let period = store.range.label.lowercased()
        if let bucket { return "\(bucket) · \(period)" }
        return (isIncome ? "Пришло за " : "Потрачено за ") + (store.range == .week ? "неделю" : period)
    }

    static func operationsWord(_ n: Int) -> String {
        let m10 = n % 10, m100 = n % 100
        if m10 == 1 && m100 != 11 { return "операция" }
        if (2...4).contains(m10) && !(12...14).contains(m100) { return "операции" }
        return "операций"
    }

    // ── Фильтры ──────────────────────────────────────────────────────────────

    @ViewBuilder
    private var filters: some View {
        let companies = Set(operations.compactMap(\.companyID))
        if companies.count > 1 {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Spacing.sm) {
                    chip("Все точки", isOn: companyID == nil) { companyID = nil }
                    ForEach(store.companies.filter { companies.contains($0.id) }) { company in
                        chip(company.name, isOn: companyID == company.id) {
                            companyID = companyID == company.id ? nil : company.id
                        }
                    }
                }
            }
            .scrollClipDisabled()
        }
    }

    private func chip(_ title: String, isOn: Bool, action: @escaping () -> Void) -> some View {
        Button {
            withAnimation(Motion.tap) { action() }
        } label: {
            Text(title)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(isOn ? .white : Theme.text)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(isOn ? AnyShapeStyle(Theme.text) : AnyShapeStyle(Theme.surface), in: Capsule())
        }
        .buttonStyle(.pressable)
    }

    /// Статьи или способы оплаты пузырями: иконка, сумма, доля.
    @ViewBuilder
    private var bubbles: some View {
        let items = buckets
        if items.count > 1 {
            let total = max(items.reduce(0) { $0 + $1.amount }, 1)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Spacing.sm) {
                    ForEach(items, id: \.name) { item in
                        let isOn = bucket == item.name
                        let color = isIncome ? Self.methodTint(item.name) : Self.categoryTint(item.name)
                        Button {
                            withAnimation(Motion.tap) { bucket = isOn ? nil : item.name }
                        } label: {
                            VStack(alignment: .leading, spacing: 6) {
                                TintedIcon(
                                    systemName: isIncome ? Self.methodIcon(item.name) : OwnerAnalyticsScreen.expenseIcon(item.name),
                                    tint: isOn ? .white : color,
                                    size: 34
                                )
                                .background(isOn ? color : .clear, in: Circle())
                                Text(item.name)
                                    .font(.system(size: 13, weight: .medium))
                                    .foregroundStyle(Theme.text)
                                    .lineLimit(1)
                                Text(Money.format(item.amount))
                                    .font(.system(size: 15, weight: .bold, design: .rounded))
                                    .monospacedDigit()
                                    .foregroundStyle(Theme.text)
                                    .lineLimit(1)
                                Text(Percent.format(item.amount / total * 100))
                                    .font(.system(size: 12))
                                    .foregroundStyle(Theme.textDim)
                            }
                            .padding(Spacing.md)
                            .frame(width: 128, alignment: .leading)
                            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                            .overlay {
                                RoundedRectangle(cornerRadius: 20, style: .continuous)
                                    .strokeBorder(isOn ? color : .clear, lineWidth: 2)
                            }
                        }
                        .buttonStyle(.pressable)
                    }
                }
            }
            .scrollClipDisabled()
        }
    }

    // ── Выписка ──────────────────────────────────────────────────────────────

    private var statement: some View {
        VStack(spacing: Spacing.lg) {
            if filtered.isEmpty {
                EmptyStateView(icon: "magnifyingglass", title: "Ничего не нашлось", message: "Снимите фильтр или измените поиск.")
            }
            ForEach(days, id: \.date) { day in
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    HStack {
                        Text(Self.dayTitle(day.date))
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Theme.text)
                        Spacer()
                        Text((isIncome ? "+" : "−") + Money.format(day.total))
                            .font(.system(size: 14, weight: .semibold, design: .rounded))
                            .monospacedDigit()
                            .foregroundStyle(Theme.textDim)
                    }
                    .padding(.horizontal, Spacing.xs)

                    VStack(spacing: 0) {
                        ForEach(Array(day.items.enumerated()), id: \.element.id) { index, op in
                            if index > 0 {
                                Rectangle().fill(Theme.borderSoft).frame(height: 1).padding(.leading, 64)
                            }
                            Button { opened = op } label: { row(op) }
                                .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, Spacing.md)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                }
            }
        }
    }

    private func row(_ op: Operation) -> some View {
        HStack(spacing: Spacing.md) {
            TintedIcon(systemName: op.icon, tint: op.tint, size: 42)
            VStack(alignment: .leading, spacing: 3) {
                Text(op.title)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                if op.isPending {
                    Text("На согласовании")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.warning)
                } else if let subtitle = op.subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textDim)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: Spacing.sm)
            Text((isIncome ? "+" : "−") + Money.format(op.amount))
                .font(.system(size: 16, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(isIncome ? Theme.positive : Theme.text)
                .opacity(op.isPending ? 0.6 : 1)
        }
        .padding(.vertical, Spacing.md)
        .contentShape(Rectangle())
    }

    // ── Оформление ───────────────────────────────────────────────────────────

    static func dayTitle(_ iso: String) -> String {
        guard let date = DateParsing.parseDateOnly(iso) else { return iso }
        let calendar = Calendar.current
        if calendar.isDateInToday(date) { return "Сегодня" }
        if calendar.isDateInYesterday(date) { return "Вчера" }
        return date.formatted(.dateTime.day().month(.wide).weekday(.wide).locale(Locale(identifier: "ru_RU")))
    }

    static func categoryTint(_ name: String) -> Color {
        let palette: [Color] = [
            Color(hex: 0xEF4444), Color(hex: 0xF59E0B), Color(hex: 0x3B82F6), Color(hex: 0x8B5CF6),
            Color(hex: 0x10B981), Color(hex: 0xEC4899), Color(hex: 0x14B8A6), Color(hex: 0xF97316),
        ]
        // Цвет закреплён за названием, а не за местом в списке: фильтр не
        // должен перекрашивать статьи.
        let hash = name.unicodeScalars.reduce(0) { ($0 &* 31 &+ Int($1.value)) & 0x7FFFFFFF }
        return palette[hash % palette.count]
    }

    static func methodTint(_ name: String) -> Color {
        switch name {
        case "Наличные": Color(hex: 0x10B981)
        case "Kaspi": Color(hex: 0xEF4444)
        case "Карта": Color(hex: 0x3B82F6)
        default: Color(hex: 0x8B5CF6)
        }
    }

    static func methodIcon(_ name: String) -> String {
        switch name {
        case "Наличные": "banknote.fill"
        case "Kaspi": "k.circle.fill"
        case "Карта": "creditcard.fill"
        default: "globe"
        }
    }
}

/// «Чек» операции: большая сумма, откуда и чем, кнопка правки.
private struct OperationReceipt: View {
    let operation: LedgerStatementScreen.Operation
    let isIncome: Bool
    let companyName: String?
    let canEdit: Bool
    let onEdit: () -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Spacing.lg) {
                    VStack(spacing: Spacing.sm) {
                        TintedIcon(systemName: operation.icon, tint: operation.tint, size: 64)
                        Text(operation.title)
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(Theme.text)
                            .multilineTextAlignment(.center)
                        Text((isIncome ? "+" : "−") + Money.format(operation.amount))
                            .font(.system(size: 36, weight: .bold, design: .rounded))
                            .monospacedDigit()
                            .foregroundStyle(isIncome ? Theme.positive : Theme.text)
                        if operation.isPending {
                            Label("Ждёт согласования", systemImage: "clock.fill")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Theme.warning)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 6)
                                .background(Theme.warning.opacity(0.14), in: Capsule())
                        }
                    }
                    .padding(.top, Spacing.md)

                    VStack(spacing: 0) {
                        line("Дата", LedgerStatementScreen.dayTitle(operation.date))
                        if let companyName { line("Точка", companyName) }
                        ForEach(operation.parts, id: \.0) { name, value in
                            line(name, Money.format(value))
                        }
                        if let comment = operation.comment, !comment.isEmpty {
                            line("Комментарий", comment)
                        }
                    }
                    .padding(.horizontal, Spacing.lg)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))

                    if canEdit {
                        Button {
                            onEdit()
                        } label: {
                            Label("Изменить", systemImage: "pencil")
                                .font(.system(size: 16, weight: .semibold))
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .foregroundStyle(.white)
                                .background(Theme.brand, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        }
                        .buttonStyle(.pressable)
                    }
                }
                .padding(Spacing.lg)
            }
            .background(Theme.background)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Закрыть") { dismiss() }
                }
            }
        }
    }

    private func line(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .font(.system(size: 15))
                .foregroundStyle(Theme.textDim)
            Spacer(minLength: Spacing.lg)
            Text(value)
                .font(.system(size: 15, weight: .medium))
                .monospacedDigit()
                .foregroundStyle(Theme.text)
                .multilineTextAlignment(.trailing)
        }
        .padding(.vertical, 14)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Theme.borderSoft).frame(height: 1)
        }
    }
}
