import OrdaKit
import OrdaUI
import SwiftUI

// ── Ревизии ──────────────────────────────────────────────────────────────────

/// Пересчёты остатков: где сошлось, а где нет.
///
/// Владельца интересует не факт ревизии, а расхождение в деньгах. Поэтому в
/// строке — сумма недостачи, а внутри позиции отсортированы по величине
/// расхождения, а не по алфавиту: пропажа на сто тысяч должна быть первой.
struct RevisionsScreen: View {
    @Environment(BusinessStore.self) private var store
    @Environment(\.access) private var access
    @State private var selected: Stocktake?
    @State private var isCounting = false

    /// Право `store-revisions.commit` проверяет и сервер.
    private var canCount: Bool { access?.can("store-revisions.commit") ?? false }

    var body: some View {
        Group {
            if let error = store.revisionsError, store.revisions.isEmpty {
                ErrorStateView(error: error) { Task { await store.loadRevisions() } }
            } else if store.isLoadingRevisions && store.revisions.isEmpty {
                LoadingRows(count: 6)
            } else {
                MasterDetail(
                    items: sorted,
                    selection: $selected,
                    listWidth: 340
                ) { stocktake in
                    RevisionRow(stocktake: stocktake)
                } detail: { stocktake in
                    RevisionDetail(stocktake: stocktake)
                } empty: {
                    WideEmptyState(
                        icon: "checklist",
                        title: "Ревизий нет",
                        message: "Здесь появятся пересчёты склада и витрин."
                    )
                }
            }
        }
        .background(Theme.background)
        .navigationTitle("Ревизии")
        .toolbar {
            if canCount {
                ToolbarItem(placement: .primaryAction) {
                    Button { isCounting = true } label: { Image(systemName: "plus") }
                }
            }
            LogoutToolbarItem()
        }
        .task { await store.loadRevisions() }
        .refreshable { await store.loadRevisions() }
        .sheet(isPresented: $isCounting) { StocktakeSheet() }
    }

    private var sorted: [Stocktake] {
        store.revisions.sorted { ($0.countedAt ?? .distantPast) > ($1.countedAt ?? .distantPast) }
    }
}

private struct RevisionRow: View {
    let stocktake: Stocktake

    var body: some View {
        HStack(spacing: Spacing.md) {
            Image(systemName: stocktake.mismatches.isEmpty ? "checkmark.seal.fill" : "exclamationmark.triangle.fill")
                .font(.system(size: 15))
                .foregroundStyle(stocktake.mismatches.isEmpty ? Theme.positive : Theme.warning)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 1) {
                Text(stocktake.locationName ?? "Точка")
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text(subtitle)
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 1) {
                if stocktake.shortageAmount > 0 {
                    Text(Money.format(stocktake.shortageAmount))
                        .font(Typography.callout.weight(.medium))
                        .monospacedDigit()
                        .foregroundStyle(Theme.negative)
                    Text("недостача")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                } else {
                    Text("сошлось")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.positive)
                }
            }
        }
    }

    private var subtitle: String {
        var parts: [String] = []
        if let date = stocktake.countedAt {
            parts.append(date.formatted(.dateTime.day().month(.abbreviated).hour().minute()))
        }
        if let author = stocktake.authorName { parts.append(author) }
        return parts.joined(separator: " · ")
    }
}

private struct RevisionDetail: View {
    let stocktake: Stocktake

    var body: some View {
        ScreenScroll {
            VStack(spacing: Spacing.lg) {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        Text(stocktake.locationName ?? "Точка")
                            .font(Typography.title)
                            .foregroundStyle(Theme.text)

                        if let company = stocktake.companyName {
                            StatRow("Точка", value: company, icon: "building.2")
                        }
                        if let date = stocktake.countedAt {
                            StatRow("Пересчитано", value: date.formatted(.dateTime.day().month(.wide).hour().minute()), icon: "calendar")
                        }
                        if let author = stocktake.authorName {
                            StatRow("Кто считал", value: author, icon: "person")
                        }
                        RowDivider()
                        StatRow("Позиций", value: "\(stocktake.items.count)", icon: "list.bullet")
                        StatRow(
                            "Расхождений",
                            value: "\(stocktake.mismatches.count)",
                            valueColor: stocktake.mismatches.isEmpty ? Theme.positive : Theme.warning,
                            icon: "exclamationmark.triangle"
                        )
                        if stocktake.shortageAmount > 0 {
                            StatRow("Недостача", value: Money.format(stocktake.shortageAmount), valueColor: Theme.negative, emphasized: true)
                        }

                        if let comment = stocktake.comment, !comment.isEmpty {
                            RowDivider()
                            Text(comment)
                                .font(Typography.callout)
                                .foregroundStyle(Theme.textMuted)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        SectionHeader("Расхождения", subtitle: "от крупных к мелким")

                        if stocktake.mismatches.isEmpty {
                            InlineEmpty(icon: "checkmark.seal", text: "Всё сошлось до позиции", tint: Theme.positive)
                        } else {
                            ForEach(Array(stocktake.mismatches.enumerated()), id: \.element.id) { index, line in
                                if index > 0 { RowDivider() }
                                RevisionLineRow(line: line)
                            }
                        }
                    }
                }
            }
        }
        .background(Theme.background)
        .navigationTitle("Ревизия")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}

private struct RevisionLineRow: View {
    let line: Stocktake.Line

    var body: some View {
        HStack(spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: 1) {
                Text(line.name)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                // Ожидалось → найдено: без обоих чисел расхождение непонятно.
                Text("ждали \(Quantity.format(line.expected)) · нашли \(Quantity.format(line.actual)) \(line.unit)")
                    .font(Typography.caption)
                    .monospacedDigit()
                    .foregroundStyle(Theme.textDim)
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 1) {
                Text(Quantity.format(abs(line.delta)))
                    .font(Typography.callout.weight(.medium))
                    .monospacedDigit()
                    .foregroundStyle(line.isShortage ? Theme.negative : Theme.positive)
                if line.amount != 0 {
                    Text(Money.format(abs(line.amount)))
                        .font(Typography.caption)
                        .monospacedDigit()
                        .foregroundStyle(Theme.textDim)
                }
            }

            Image(systemName: line.isShortage ? "arrow.down" : "arrow.up")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(line.isShortage ? Theme.negative : Theme.positive)
        }
    }
}

// ── Поставщики ───────────────────────────────────────────────────────────────

/// Поставщики: сколько закупали и сколько должны.
struct SuppliersScreen: View {
    @Environment(BusinessStore.self) private var store

    @State private var selected: Supplier?
    @State private var search = ""
    @State private var onlyDebtors = false

    var body: some View {
        VStack(spacing: 0) {
            if let list = store.suppliers, list.totalDebt > 0 {
                HStack(spacing: Spacing.md) {
                    SummaryPill(title: "Долг поставщикам", value: Money.format(list.totalDebt), tint: Theme.warning)
                    SummaryPill(title: "Поставщиков", value: "\(list.suppliers.count)", tint: Theme.textMuted)
                }
                .padding(.horizontal, Spacing.lg)
                .padding(.vertical, Spacing.md)
            }

            if let error = store.suppliersError, store.suppliers == nil {
                ErrorStateView(error: error) { Task { await store.loadSuppliers() } }
            } else if store.suppliers == nil {
                LoadingRows(count: 7)
            } else {
                MasterDetail(
                    items: filtered,
                    selection: $selected,
                    listWidth: 320
                ) { supplier in
                    SupplierRow(supplier: supplier)
                } detail: { supplier in
                    SupplierDetail(supplier: supplier)
                } empty: {
                    WideEmptyState(
                        icon: "shippingbox",
                        title: search.isEmpty ? "Поставщиков нет" : "Никого не найдено",
                        message: "Поставщики появляются при первой приёмке."
                    )
                }
            }
        }
        .background(Theme.background)
        .navigationTitle("Поставщики")
        .searchable(text: $search, prompt: "Название, БИН или телефон")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Toggle(isOn: $onlyDebtors) {
                    Label("Только с долгом", systemImage: "creditcard.trianglebadge.exclamationmark")
                }
                .toggleStyle(.button)
            }
            LogoutToolbarItem()
        }
        .task { await store.loadSuppliers() }
        .refreshable { await store.loadSuppliers() }
    }

    private var filtered: [Supplier] {
        var items = store.suppliers?.suppliers ?? []
        if onlyDebtors { items = items.filter(\.hasDebt) }
        if !search.isEmpty {
            items = items.filter {
                $0.name.localizedCaseInsensitiveContains(search)
                    || ($0.binIIN?.contains(search) ?? false)
                    || ($0.phone?.contains(search) ?? false)
            }
        }
        // Должники первыми: с ними и разговаривают.
        return items.sorted { left, right in
            if left.hasDebt != right.hasDebt { return left.hasDebt }
            return left.receiptsTotal > right.receiptsTotal
        }
    }
}

private struct SupplierRow: View {
    let supplier: Supplier

    var body: some View {
        HStack(spacing: Spacing.md) {
            Text(supplier.initials)
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundStyle(Theme.brand)
                .frame(width: 36, height: 36)
                .background(Theme.brand.opacity(0.14), in: Circle())

            VStack(alignment: .leading, spacing: 1) {
                Text(supplier.name)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text("\(supplier.receiptsCount) \(pluralize(supplier.receiptsCount, "приёмка", "приёмки", "приёмок"))")
                    .font(Typography.caption)
                    .monospacedDigit()
                    .foregroundStyle(Theme.textDim)
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 2) {
                Text(Money.format(supplier.receiptsTotal))
                    .font(Typography.callout.weight(.medium))
                    .monospacedDigit()
                    .foregroundStyle(Theme.text)
                if supplier.hasDebt {
                    StatusChip("долг \(Money.format(supplier.openDebtsAmount))", kind: .warning)
                }
            }
        }
    }
}

private struct SupplierDetail: View {
    let supplier: Supplier

    var body: some View {
        ScreenScroll {
            VStack(spacing: Spacing.lg) {
                Card {
                    HStack(spacing: Spacing.lg) {
                        Text(supplier.initials)
                            .font(.system(size: 22, weight: .semibold, design: .rounded))
                            .foregroundStyle(Theme.brand)
                            .frame(width: 64, height: 64)
                            .background(Theme.brand.opacity(0.14), in: Circle())

                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            Text(supplier.name)
                                .font(Typography.title)
                                .foregroundStyle(Theme.text)
                            if let org = supplier.organizationName, !org.isEmpty {
                                Text(org)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.textMuted)
                            }
                            if supplier.hasDebt {
                                StatusChip("\(supplier.openDebtsCount) \(pluralize(supplier.openDebtsCount, "накладная", "накладные", "накладных")) не оплачено", kind: .warning)
                            }
                        }
                        Spacer()
                    }
                }

                DashboardGrid {
                    MetricTile(
                        label: "Закуплено всего",
                        value: Money.format(supplier.receiptsTotal),
                        icon: "shippingbox.fill",
                        accent: Theme.brand
                    )
                    MetricTile(
                        label: "Приёмок",
                        value: "\(supplier.receiptsCount)",
                        icon: "arrow.down.circle.fill",
                        accent: Theme.info
                    )
                    MetricTile(
                        label: "Долг",
                        value: Money.format(supplier.openDebtsAmount),
                        icon: "creditcard.fill",
                        accent: supplier.hasDebt ? Theme.warning : Theme.positive
                    )
                }

                Card {
                    VStack(spacing: Spacing.md) {
                        SectionHeader("Реквизиты")
                        if let bin = supplier.binIIN, !bin.isEmpty {
                            StatRow("БИН / ИИН", value: bin, icon: "number")
                        }
                        if let contact = supplier.contactName, !contact.isEmpty {
                            StatRow("Контакт", value: contact, icon: "person")
                        }
                        if let phone = supplier.phone, !phone.isEmpty {
                            StatRow("Телефон", value: phone, icon: "phone")
                        }
                        if let last = supplier.lastReceiptDate {
                            StatRow("Последняя приёмка", value: last.formatted(.dateTime.day().month(.wide).year()), icon: "calendar")
                        }
                    }
                }
            }
        }
        .background(Theme.background)
        .navigationTitle(supplier.name)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}

// ── Сотрудники ───────────────────────────────────────────────────────────────

/// Административная команда: оклады и выплаты за месяц.
///
/// В отличие от операторов, здесь оклад, а не выработка. Поэтому главная
/// величина строки — сколько уже выплачено из оклада за текущий месяц.
struct StaffScreen: View {
    @Environment(BusinessStore.self) private var store

    @State private var selected: StaffMember?
    @State private var showInactive = false

    var body: some View {
        Group {
            if let error = store.staffError, store.staff == nil {
                ErrorStateView(error: error) { Task { await store.loadStaff() } }
            } else if store.staff == nil {
                LoadingRows(count: 5)
            } else {
                MasterDetail(
                    items: filtered,
                    selection: $selected,
                    listWidth: 320
                ) { member in
                    StaffRow(member: member, paid: store.staff?.paidThisMonth(member.id) ?? 0)
                } detail: { member in
                    StaffDetail(member: member, list: store.staff)
                } empty: {
                    WideEmptyState(
                        icon: "person.2",
                        title: "Сотрудников нет",
                        message: "Здесь появится административная команда."
                    )
                }
            }
        }
        .background(Theme.background)
        .navigationTitle("Сотрудники")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Toggle(isOn: $showInactive) {
                    Label("С уволенными", systemImage: "person.slash")
                }
                .toggleStyle(.button)
            }
            LogoutToolbarItem()
        }
        .task { await store.loadStaff() }
        .refreshable { await store.loadStaff() }
    }

    private var filtered: [StaffMember] {
        let members = store.staff?.staff ?? []
        return (showInactive ? members : members.filter(\.isActive))
            .sorted { left, right in
                if left.isActive != right.isActive { return left.isActive }
                return left.monthlySalary > right.monthlySalary
            }
    }
}

private struct StaffRow: View {
    let member: StaffMember
    let paid: Double

    var body: some View {
        HStack(spacing: Spacing.md) {
            Text(member.initials)
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundStyle(Theme.brand)
                .frame(width: 36, height: 36)
                .background(Theme.brand.opacity(0.14), in: Circle())
                .opacity(member.isActive ? 1 : 0.55)

            VStack(alignment: .leading, spacing: 1) {
                Text(member.fullName)
                    .font(Typography.callout)
                    .foregroundStyle(member.isActive ? Theme.text : Theme.textDim)
                    .lineLimit(1)
                Text(member.roleLabel)
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 1) {
                Text(Money.format(member.monthlySalary))
                    .font(Typography.callout.weight(.medium))
                    .monospacedDigit()
                    .foregroundStyle(Theme.text)
                if member.monthlySalary > 0 {
                    Text("выплачено \(Money.format(paid))")
                        .font(Typography.caption)
                        .monospacedDigit()
                        .foregroundStyle(paid >= member.monthlySalary ? Theme.positive : Theme.textDim)
                }
            }
        }
    }
}

private struct StaffDetail: View {
    let member: StaffMember
    let list: StaffList?

    private var payments: [StaffPayment] {
        (list?.payments ?? [])
            .filter { $0.staffID == member.id }
            .sorted { ($0.payDate ?? .distantPast) > ($1.payDate ?? .distantPast) }
    }

    var body: some View {
        let paid = list?.paidThisMonth(member.id) ?? 0

        return ScreenScroll {
            VStack(spacing: Spacing.lg) {
                Card {
                    HStack(spacing: Spacing.lg) {
                        Text(member.initials)
                            .font(.system(size: 22, weight: .semibold, design: .rounded))
                            .foregroundStyle(Theme.brand)
                            .frame(width: 64, height: 64)
                            .background(Theme.brand.opacity(0.14), in: Circle())

                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            Text(member.fullName)
                                .font(Typography.title)
                                .foregroundStyle(Theme.text)
                            Text(member.roleLabel)
                                .font(Typography.callout)
                                .foregroundStyle(Theme.textMuted)
                            StatusChip(member.isActive ? "работает" : "не работает", kind: member.isActive ? .good : .neutral)
                        }
                        Spacer()
                    }
                }

                Card {
                    VStack(spacing: Spacing.md) {
                        SectionHeader("Оклад за месяц")
                        StatRow("Начислено", value: Money.format(member.monthlySalary), icon: "wallet.bifold")
                        StatRow("Выплачено", value: Money.format(paid), valueColor: Theme.positive, icon: "checkmark.circle")
                        RowDivider()
                        StatRow(
                            "Осталось",
                            value: Money.format(max(member.monthlySalary - paid, 0)),
                            valueColor: paid >= member.monthlySalary ? Theme.positive : Theme.warning,
                            emphasized: true
                        )
                    }
                }

                if let phone = member.phone, !phone.isEmpty {
                    Card {
                        VStack(spacing: Spacing.md) {
                            SectionHeader("Контакты")
                            StatRow("Телефон", value: phone, icon: "phone")
                            if let email = member.email, !email.isEmpty {
                                StatRow("Почта", value: email, icon: "envelope")
                            }
                        }
                    }
                }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        SectionHeader("Выплаты", subtitle: payments.isEmpty ? nil : "\(payments.count)")

                        if payments.isEmpty {
                            InlineEmpty(icon: "banknote", text: "Выплат ещё не было", tint: Theme.textDim)
                        } else {
                            ForEach(Array(payments.prefix(20).enumerated()), id: \.element.id) { index, payment in
                                if index > 0 { RowDivider() }
                                HStack(spacing: Spacing.md) {
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(payment.payDate?.formatted(.dateTime.day().month(.wide).year()) ?? "—")
                                            .font(Typography.callout)
                                            .foregroundStyle(Theme.text)
                                        if let comment = payment.comment, !comment.isEmpty {
                                            Text(comment)
                                                .font(Typography.caption)
                                                .foregroundStyle(Theme.textDim)
                                                .lineLimit(1)
                                        }
                                    }
                                    Spacer(minLength: Spacing.sm)
                                    Text(Money.format(payment.amount))
                                        .font(Typography.callout.weight(.medium))
                                        .monospacedDigit()
                                        .foregroundStyle(Theme.text)
                                }
                            }
                        }
                    }
                }
            }
        }
        .background(Theme.background)
        .navigationTitle(member.fullName)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}
