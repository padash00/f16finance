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
    @State private var showingActs = false

    /// Право `store-revisions.commit` проверяет и сервер.
    private var canCount: Bool { access?.can("store-revisions.commit") ?? false }
    /// Отмена и откат закрыты одним правом — тем же, что на сервере.
    private var canCancel: Bool { access?.can("store-revisions.cancel") ?? false }

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
                } header: {
                    // Идущий пересчёт — выше готовых: он ещё живой, и именно с
                    // ним что-то делают. Готовые ревизии только читают.
                    if !store.revisionActs.filter(\.isOpen).isEmpty || canCancel {
                        Button { showingActs = true } label: {
                            HStack(spacing: Spacing.md) {
                                Image(systemName: "clock.badge.checkmark")
                                    .foregroundStyle(Theme.info)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text("Акты пересчёта")
                                        .font(Typography.callout.weight(.medium))
                                        .foregroundStyle(Theme.text)
                                    Text(actsSubtitle)
                                        .font(Typography.caption)
                                        .foregroundStyle(Theme.textMuted)
                                }
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.textMuted)
                            }
                            .padding(Spacing.md)
                            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
                        }
                        .buttonStyle(.pressable)
                    }
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
        .task {
            await store.loadRevisions()
            await store.loadRevisionActs()
        }
        .refreshable {
            await store.loadRevisions()
            await store.loadRevisionActs()
        }
        .sheet(isPresented: $isCounting) { StocktakeSheet() }
        .sheet(isPresented: $showingActs) { RevisionActsSheet() }
    }

    private var actsSubtitle: String {
        let open = store.revisionActs.filter(\.isOpen).count
        if open > 0 {
            return "\(open) \(pluralize(open, "идёт", "идут", "идут")) — можно отменить"
        }
        return "Отменить лишний, откатить проведённый"
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
    @Environment(\.access) private var access

    @State private var selected: Supplier?
    @State private var search = ""
    @State private var onlyDebtors = false
    @State private var isAdding = false

    private var canCreate: Bool { access?.can("store-suppliers.create") ?? false }

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
        .sheet(isPresented: $isAdding) {
            AddSupplierSheet { await store.loadSuppliers() }
        }
        .toolbar {
            if canCreate {
                ToolbarItem(placement: .primaryAction) {
                    Button { isAdding = true } label: { Image(systemName: "plus") }
                }
            }
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
    @State private var isAdding = false

    @Environment(\.access) private var access

    /// Право то же, что проверяет сервер.
    private var canAdd: Bool { access?.can("staff.create") ?? false }

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
            if canAdd {
                ToolbarItem(placement: .primaryAction) {
                    Button { isAdding = true } label: { Image(systemName: "person.badge.plus") }
                }
            }
            ToolbarItem(placement: .primaryAction) {
                Toggle(isOn: $showInactive) {
                    Label("С уволенными", systemImage: "person.slash")
                }
                .toggleStyle(.button)
            }
            LogoutToolbarItem()
        }
        .sheet(isPresented: $isAdding) {
            AddStaffSheet { await store.loadStaff() }
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

    @Environment(\.api) private var api
    @Environment(\.access) private var access

    @State private var isSending = false
    @State private var accessResult: String?
    @State private var accessError: String?
    @State private var confirmingReset = false

    /// Право то же, что проверяет сервер. Приложение шлёт сброс пароля —
    /// значит спрашивать надо право сброса, а не приглашения: у сервера это
    /// теперь разные решения.
    private var canSendAccess: Bool { access?.can("staff.reset_password") ?? false }

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

                accessCard

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

    /// Доступ сотрудника: пригласить или отправить смену пароля.
    ///
    /// Сотрудник звонит со смены, а не пишет заявку: «не могу войти» случается
    /// в момент, когда владелец не за компьютером. Раньше письмо отправлялось
    /// только с сайта, и человек ждал вечера.
    ///
    /// Кнопка одна на оба случая — вход либо есть, либо нет, и знает об этом
    /// только сервер. Смена пароля спрашивает подтверждение: старый перестанет
    /// работать сразу, а человек может стоять на кассе.
    @ViewBuilder
    private var accessCard: some View {
        if canSendAccess {
            Card {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    SectionHeader("Доступ")

                    if let email = member.email, !email.isEmpty {
                        Text(email)
                            .font(Typography.callout)
                            .foregroundStyle(Theme.textDim)
                    } else {
                        Text("У сотрудника не заполнена почта — письмо отправить некуда.")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    if let accessResult {
                        Text(accessResult)
                            .font(Typography.caption)
                            .foregroundStyle(Theme.positive)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    if let accessError {
                        Text(accessError)
                            .font(Typography.caption)
                            .foregroundStyle(Theme.negative)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Button {
                        confirmingReset = true
                    } label: {
                        if isSending {
                            ProgressView().controlSize(.small)
                        } else {
                            Label("Отправить доступ на почту", systemImage: "envelope.badge")
                        }
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(isSending || (member.email ?? "").isEmpty || !member.isActive)

                    if !member.isActive {
                        Text("Уволенному сотруднику доступ не отправляется.")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textMuted)
                    }
                }
            }
            .alert("Отправить письмо?", isPresented: $confirmingReset) {
                Button("Отправить") { Task { await sendAccess() } }
                Button("Отмена", role: .cancel) {}
            } message: {
                Text("Если вход уже есть, сотрудник задаст новый пароль по ссылке — старый перестанет работать.")
            }
        }
    }

    private func sendAccess() async {
        isSending = true
        accessError = nil
        accessResult = nil
        defer { isSending = false }

        do {
            // Сервер сам решит, приглашение это или смена пароля: состояние
            // учётной записи знает только он.
            accessResult = try await BusinessService(api: api)
                .sendStaffAccessEmail(staffID: member.id, invite: false)
        } catch let error as APIError {
            accessError = error.userMessage
        } catch {
            accessError = error.localizedDescription
        }
    }
}

/// Акты пересчёта: отменить лишний, откатить проведённый.
///
/// Ревизию заводят и бросают: открыли не ту точку, посчитали половину, ушли на
/// смену. Такой акт висит и мешает завести правильный — а закрыть его можно
/// было только на сайте.
///
/// Отмена и откат — разные вещи, и здесь они разведены намеренно. Отмена
/// выбрасывает недосчитанный акт, остатки не трогая. Откат разворачивает уже
/// проведённую ревизию: остатки возвращаются к тому, что было, а созданные
/// актом долги удаляются. Второе тяжелее и спрашивает подтверждение отдельно.
struct RevisionActsSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(BusinessStore.self) private var store
    @Environment(\.access) private var access

    @State private var cancelling: RevisionAct?
    @State private var closing: RevisionAct?
    @State private var opening: RevisionAct?
    @State private var reverting: RevisionAct?
    @State private var isBusy = false
    @State private var error: String?

    private var canCancel: Bool { access?.can("store-revisions.cancel") ?? false }
    private var canCommit: Bool { access?.can("store-revisions.commit") ?? false }

    var body: some View {
        NavigationStack {
            ScreenScroll {
                if store.revisionActs.isEmpty {
                    Card {
                        Text("Актов пересчёта нет.")
                            .font(Typography.callout)
                            .foregroundStyle(Theme.textMuted)
                    }
                }

                if let error {
                    Text(error)
                        .font(Typography.callout)
                        .foregroundStyle(Theme.negative)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                }

                ForEach(store.revisionActs) { act in
                    Card(accent: act.isOpen ? Theme.info : nil) {
                        VStack(alignment: .leading, spacing: Spacing.sm) {
                            HStack(alignment: .firstTextBaseline) {
                                Text(act.locationName)
                                    .font(Typography.body.weight(.medium))
                                    .foregroundStyle(Theme.text)
                                Spacer()
                                StatusChip(
                                    act.statusLabel,
                                    kind: act.isOpen ? .info : (act.isCancelled ? .neutral : .good)
                                )
                            }

                            if let opened = act.openedAt {
                                Text("открыт \(opened.formatted(.dateTime.day().month(.abbreviated).hour().minute()))")
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.textDim)
                            }

                            if act.isOpen, let progress = act.progress {
                                ProgressView(value: progress)
                                    .tint(Theme.info)
                                Text("посчитано \(act.countedItems) из \(act.totalItems)")
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.textMuted)
                            }

                            if let comment = act.comment, !comment.isEmpty {
                                Text(comment)
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.textMuted)
                                    .fixedSize(horizontal: false, vertical: true)
                            }

                            // Состав акта: что пересчитано, где расхождение.
                            // Счётчик «12 из 40» не отвечает ни на один из
                            // вопросов, которые задают, стоя у полки.
                            Button { opening = act } label: {
                                Label("Открыть состав", systemImage: "list.bullet.rectangle")
                            }
                            .buttonStyle(SecondaryButtonStyle())

                            // Провести ревизию — то, ради чего её и открывали.
                            // Приложение умело акт открыть и отменить, но не
                            // закрыть: считали по полкам с телефоном, а
                            // завершали с ноутбука.
                            if act.isOpen, canCommit {
                                Button { closing = act } label: {
                                    Label("Провести ревизию", systemImage: "checkmark.seal")
                                }
                                .buttonStyle(PrimaryButtonStyle())
                                .disabled(isBusy)
                            }

                            if canCancel {
                                if act.isOpen {
                                    Button { cancelling = act } label: {
                                        Label("Отменить акт", systemImage: "xmark.circle")
                                    }
                                    .buttonStyle(SecondaryButtonStyle())
                                    .disabled(isBusy)
                                } else if act.isClosed {
                                    Button { reverting = act } label: {
                                        Label("Откатить ревизию", systemImage: "arrow.uturn.backward")
                                    }
                                    .buttonStyle(SecondaryButtonStyle())
                                    .disabled(isBusy)
                                }
                            }
                        }
                    }
                }
            }
            .background(Theme.background)
            .navigationTitle("Акты пересчёта")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Готово") { dismiss() }
                }
            }
            // Проведение необратимо в обычном смысле: откат есть, но он
            // отдельное тяжёлое действие и только у владельца. Поэтому
            // спрашиваем и говорим, что именно произойдёт с остатками.
            .sheet(item: $opening) { act in
                RevisionActScreen(act: act)
            }
            .alert("Провести ревизию?", isPresented: Binding(get: { closing != nil }, set: { if !$0 { closing = nil } })) {
                Button("Провести", role: .destructive) {
                    if let act = closing { Task { await run { await store.closeRevisionAct(id: act.id) } } }
                }
                Button("Не сейчас", role: .cancel) {}
            } message: {
                Text("Остатки станут такими, какими их пересчитали. Недостача превратится в долг, излишек — в приход. Откатить сможет только владелец.")
            }
            .alert("Отменить акт?", isPresented: Binding(get: { cancelling != nil }, set: { if !$0 { cancelling = nil } })) {
                Button("Отменить акт", role: .destructive) {
                    if let act = cancelling { Task { await run { await store.cancelRevisionAct(id: act.id) } } }
                }
                Button("Не надо", role: .cancel) {}
            } message: {
                Text("Подсчёты будут отброшены. Остатки не изменятся — так отменяют ревизию, открытую по ошибке.")
            }
            .alert("Откатить проведённую ревизию?", isPresented: Binding(get: { reverting != nil }, set: { if !$0 { reverting = nil } })) {
                Button("Откатить", role: .destructive) {
                    if let act = reverting { Task { await run { await store.revertRevisionAct(id: act.id) } } }
                }
                Button("Не надо", role: .cancel) {}
            } message: {
                Text("Остатки вернутся к состоянию до ревизии, а созданные ею долги удалятся. Продажи после ревизии сохранятся.")
            }
            .task { await store.loadRevisionActs() }
        }
    }

    private func run(_ action: () async -> String?) async {
        isBusy = true
        error = nil
        defer { isBusy = false }
        error = await action()
    }
}
