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
    /// Показать все статьи, а не пять крупных.
    @State private var showsAllBuckets = false

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
    private var tint: Color { isIncome ? Theme.positive : Theme.negative }

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

    /// Сумма операции под выбранным пузырём. У дохода «Kaspi» — это только
    /// его безналичная часть: складывать всю операцию значило бы показать в
    /// итоге и наличные, и сумма разошлась бы с самим пузырём.
    private func shownAmount(_ op: Operation) -> Double {
        guard isIncome, let bucket else { return op.amount }
        return op.parts.first { $0.0 == bucket }?.1 ?? 0
    }

    private var days: [(date: String, total: Double, items: [Operation])] {
        Dictionary(grouping: filtered, by: \.date)
            .map { ($0.key, $0.value.reduce(0) { $0 + shownAmount($1) }, $0.value) }
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
            // Заголовки дней прилипают при прокрутке — как даты в выписке банка.
            LazyVStack(spacing: Spacing.lg, pinnedViews: [.sectionHeaders]) {
                // Как в «Движении денег»: сначала период, под ним — карточка
                // с суммой за этот период.
                PeriodBar(selection: $bindable.range)
                summary
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
                    activeFilters
                    breakdownCard
                    companiesCard
                    dailyCard
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
                            .background(Theme.brand, in: Circle())
                    }
                }
            }
        }
        .task { await reload() }
        .refreshable { await reload() }
        // Новый период — фильтры сначала: статьи или точки из прошлого периода
        // в новом может не быть, и снять такой фильтр было бы нечем.
        .onChange(of: store.range) { _, _ in
            bucket = nil
            companyID = nil
        }
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

    /// Сумма периода цветной карточкой — как в «Движении денег»: крупно
    /// итог, под ним чем пришло или ушло. Доходы — зелёные, расходы — красные.
    private var summary: some View {
        let total = filtered.reduce(0) { $0 + shownAmount($1) }
        let pending = isIncome ? [] : store.expensesAwaitingApproval
        return HeroSummary(
            title: summaryTitle,
            value: (isIncome ? "+" : "−") + Money.format(total),
            caption: "\(filtered.count) \(Self.operationsWord(filtered.count))"
                + (pending.isEmpty ? "" : " · \(pending.count) на согласовании"),
            footer: summaryFooter,
            colors: isIncome
                ? Theme.heroGradient
                : Theme.heroNegative
        )
        .animation(Motion.value, value: total)
    }

    /// Даты уже стоят под переключателем периода — здесь только что за сумма.
    private var summaryTitle: String {
        if let bucket { return bucket }
        if let companyID, let name = store.companyName(companyID) {
            return (isIncome ? "Пришло · " : "Потрачено · ") + name
        }
        return isIncome ? "Пришло за период" : "Потрачено за период"
    }

    /// Чем платили: наличные, Kaspi, у доходов — ещё карта и онлайн вместе.
    /// Считается по тем же операциям, что и сумма сверху, — с фильтрами.
    private var summaryFooter: [(String, String)] {
        var sums: [String: Double] = [:]
        for op in filtered {
            for (name, value) in op.parts {
                if let bucket, isIncome, name != bucket { continue }
                sums[name, default: 0] += value
            }
        }
        var rows: [(String, String)] = [
            ("Наличные", Money.format(sums["Наличные"] ?? 0)),
            ("Kaspi", Money.format(sums["Kaspi"] ?? 0)),
        ]
        if isIncome {
            let other = (sums["Карта"] ?? 0) + (sums["Онлайн"] ?? 0)
            if other > 0 { rows.append(("Карта и онлайн", Money.format(other))) }
        } else if !store.expensesAwaitingApproval.isEmpty {
            rows.append(("Ждёт решения", Money.format(store.expensesAwaitingApproval.reduce(0) { $0 + $1.total })))
        }
        return rows
    }

    static func operationsWord(_ n: Int) -> String {
        let m10 = n % 10, m100 = n % 100
        if m10 == 1 && m100 != 11 { return "операция" }
        if (2...4).contains(m10) && !(12...14).contains(m100) { return "операции" }
        return "операций"
    }

    // ── Фильтры ──────────────────────────────────────────────────────────────

    /// Что сейчас выбрано — плашками с крестиком. Фильтр всегда видно и всегда
    /// можно снять, даже если его карточка ушла за экран.
    @ViewBuilder
    private var activeFilters: some View {
        if bucket != nil || companyID != nil {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Spacing.sm) {
                    if let bucket {
                        filterPill(bucket, icon: isIncome ? Self.methodIcon(bucket) : OwnerAnalyticsScreen.expenseIcon(bucket)) {
                            self.bucket = nil
                        }
                    }
                    if let companyID {
                        filterPill(store.companyName(companyID) ?? "Точка", icon: "building.2.fill") {
                            self.companyID = nil
                        }
                    }
                    Button("Сбросить") {
                        withAnimation(Motion.tap) {
                            bucket = nil
                            companyID = nil
                        }
                    }
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.brand)
                    .padding(.leading, Spacing.xs)
                }
            }
            .scrollClipDisabled()
            .transition(.move(edge: .top).combined(with: .opacity))
        }
    }

    private func filterPill(_ title: String, icon: String, remove: @escaping () -> Void) -> some View {
        Button {
            withAnimation(Motion.tap) { remove() }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 12, weight: .semibold))
                Text(title).font(.system(size: 14, weight: .semibold)).lineLimit(1)
                Image(systemName: "xmark.circle.fill").font(.system(size: 14))
                    .foregroundStyle(.white.opacity(0.8))
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Theme.brand, in: Capsule())
        }
        .buttonStyle(.pressable)
    }

    // ── Статьи / способы оплаты ─────────────────────────────────────────────

    /// Куда ушли деньги (расходы) или чем платили (доходы): кольцо долей и
    /// строки под ним. Нажатие на строку оставляет в выписке только её.
    @ViewBuilder
    private var breakdownCard: some View {
        let items = buckets
        if !items.isEmpty {
            let total = max(items.reduce(0) { $0 + $1.amount }, 1)
            let colors = Dictionary(uniqueKeysWithValues: items.map { ($0.name, bucketTint($0.name)) })
            let shown = showsAllBuckets ? items : Array(items.prefix(5))
            OwnerSection(isIncome ? "Чем платили" : "Куда ушли деньги") {
                Text("\(items.count) \(isIncome ? "способа" : Self.articlesWord(items.count))")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
            } content: {
                VStack(spacing: Spacing.lg) {
                    DonutChart(
                        slices: donutSlices(items, colors: colors),
                        centerTitle: isIncome ? "Пришло" : "Ушло",
                        centerValue: Money.format(total),
                        showsLegend: false
                    )
                    VStack(spacing: Spacing.md) {
                        ForEach(shown, id: \.name) { item in
                            let isOn = bucket == item.name
                            Button {
                                withAnimation(Motion.tap) { bucket = isOn ? nil : item.name }
                            } label: {
                                AmountRow(
                                    leading: {
                                        TintedIcon(
                                            systemName: isIncome ? Self.methodIcon(item.name) : OwnerAnalyticsScreen.expenseIcon(item.name),
                                            tint: isOn ? .white : colors[item.name] ?? Theme.brand,
                                            size: 40
                                        )
                                        .background(isOn ? (colors[item.name] ?? Theme.brand) : .clear, in: Circle())
                                    },
                                    title: item.name,
                                    subtitle: Percent.format(item.amount / total * 100),
                                    amount: Money.format(item.amount),
                                    share: item.amount / total,
                                    tint: colors[item.name] ?? Theme.brand
                                )
                                .opacity(bucket == nil || isOn ? 1 : 0.45)
                            }
                            .buttonStyle(.plain)
                        }
                        if items.count > 5 {
                            Button(showsAllBuckets ? "Свернуть" : "Все \(isIncome ? "способы" : "статьи") (\(items.count))") {
                                withAnimation(Motion.transition) { showsAllBuckets.toggle() }
                            }
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Theme.brand)
                            .frame(maxWidth: .infinity)
                        }
                    }
                }
            }
        }
    }

    /// Кольцо: пять крупных долей своими цветами — те же, что у строк под
    /// ним, — остальное серым «Прочее».
    private func donutSlices(_ items: [(name: String, amount: Double)], colors: [String: Color]) -> [ShareSlice] {
        var slices = items.prefix(5).map { ShareSlice(label: $0.name, value: $0.amount, color: colors[$0.name] ?? Theme.brand) }
        let rest = items.dropFirst(5).reduce(0) { $0 + $1.amount }
        if rest > 0 { slices.append(ShareSlice(label: "Прочее", value: rest, color: SharePalette.other)) }
        return slices
    }

    private func bucketTint(_ name: String) -> Color {
        isIncome ? Self.methodTint(name) : Self.categoryTint(name)
    }

    static func articlesWord(_ n: Int) -> String {
        let m10 = n % 10, m100 = n % 100
        if m10 == 1 && m100 != 11 { return "статья" }
        if (2...4).contains(m10) && !(12...14).contains(m100) { return "статьи" }
        return "статей"
    }

    // ── Точки ────────────────────────────────────────────────────────────────

    /// Сколько по каждой точке — с учётом выбранной статьи, но без фильтра по
    /// точке: иначе список сжимался бы до одной строки.
    private var companyTotals: [(id: String, name: String, amount: Double)] {
        var sums: [String: Double] = [:]
        for op in operations where bucket == nil || op.buckets.contains(bucket!) {
            guard let id = op.companyID else { continue }
            sums[id, default: 0] += shownAmount(op)
        }
        return sums
            .map { (id: $0.key, name: store.companyName($0.key) ?? "Точка", amount: $0.value) }
            .filter { $0.amount != 0 }
            .sorted { $0.amount > $1.amount }
    }

    @ViewBuilder
    private var companiesCard: some View {
        let rows = companyTotals
        if rows.count > 1 {
            let total = max(rows.reduce(0) { $0 + $1.amount }, 1)
            OwnerSection("По точкам") {
                EmptyView()
            } content: {
                VStack(spacing: Spacing.md) {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                        let isOn = companyID == row.id
                        Button {
                            withAnimation(Motion.tap) { companyID = isOn ? nil : row.id }
                        } label: {
                            AmountRow(
                                leading: { LetterBadge(text: row.name, tint: OwnerTint.point(index)) },
                                title: row.name,
                                subtitle: Percent.format(row.amount / total * 100),
                                amount: Money.format(row.amount),
                                share: row.amount / total,
                                tint: OwnerTint.point(index)
                            )
                            .opacity(companyID == nil || isOn ? 1 : 0.45)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    // ── По дням ──────────────────────────────────────────────────────────────

    /// Столбик на каждый день периода, по сегодня: дни без операций — ноль, а
    /// не дыра, иначе тихий день не отличить от пропуска на графике.
    private var dailyPoints: [ComparisonPoint] {
        let bounds = store.range.bounds()
        let today = AnalyticsPeriod.today.bounds().to
        let last = min(bounds.to, today)
        var sums: [String: Double] = [:]
        for op in filtered { sums[op.date, default: 0] += shownAmount(op) }
        var points: [ComparisonPoint] = []
        var day = bounds.from
        var index = 0
        while day <= last, index < 400 {
            if let date = DateParsing.parseDateOnly(day) {
                points.append(ComparisonPoint(
                    id: index,
                    date: Calendar.current.startOfDay(for: date),
                    label: AnalyticsPeriod.rangeLabel(from: day, to: day),
                    value: sums[day] ?? 0,
                    previousLabel: "",
                    previous: 0
                ))
                day = DateParsing.dateOnlyString(from: Calendar.current.date(byAdding: .day, value: 1, to: date) ?? date)
            } else {
                break
            }
            index += 1
        }
        return points
    }

    @ViewBuilder
    private var dailyCard: some View {
        let points = dailyPoints
        if points.count > 1 {
            let peak = points.max { $0.value < $1.value }
            OwnerSection("По дням") {
                if let peak, peak.value > 0 {
                    Text("больше всего \(peak.label)")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textDim)
                }
            } content: {
                ComparisonChart(points: points, color: tint, showsPrevious: false, asBars: true, height: 170)
            }
        }
    }

    // ── Выписка ──────────────────────────────────────────────────────────────

    @ViewBuilder
    private var statement: some View {
        if filtered.isEmpty {
            EmptyStateView(icon: "magnifyingglass", title: "Ничего не нашлось", message: "Снимите фильтр или измените поиск.")
        }
        ForEach(days, id: \.date) { day in
            Section {
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
            } header: {
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
                .padding(.vertical, Spacing.sm)
                .frame(maxWidth: .infinity)
                .background(Theme.background)
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
            Text((isIncome ? "+" : "−") + Money.format(shownAmount(op)))
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
