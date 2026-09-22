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
                            AmountRow(
                                leading: { TintedIcon(systemName: "clock.badge.checkmark", tint: Theme.info, size: 42) },
                                title: "Акты пересчёта",
                                subtitle: actsSubtitle,
                                amount: "",
                                showsChevron: true
                            )
                            .padding(.horizontal, Spacing.md)
                            .padding(.vertical, Spacing.sm)
                            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
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

/// Строка ревизии: сошлось — зелёная галочка, нет — оранжевый знак и
/// сумма недостачи справа, как списание в выписке.
private struct RevisionRow: View {
    let stocktake: Stocktake

    var body: some View {
        let clean = stocktake.mismatches.isEmpty
        HStack(spacing: Spacing.md) {
            TintedIcon(
                systemName: clean ? "checkmark.seal.fill" : "exclamationmark.triangle.fill",
                tint: clean ? Theme.positive : Theme.warning,
                size: 40
            )

            VStack(alignment: .leading, spacing: 3) {
                Text(stocktake.locationName ?? "Точка")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 2) {
                if stocktake.shortageAmount > 0 {
                    Text("−" + Money.format(stocktake.shortageAmount))
                        .font(.system(size: 16, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(Theme.negative)
                    Text("недостача")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textDim)
                } else {
                    Text("сошлось")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.positive)
                }
            }
            .fixedSize()
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
                // Главное в ревизии — деньги: недостача крупно на красной
                // карточке, а если всё сошлось — зелёная.
                HeroSummary(
                    title: stocktake.locationName ?? "Точка",
                    value: stocktake.shortageAmount > 0 ? "−" + Money.format(stocktake.shortageAmount) : "Сошлось",
                    caption: stocktake.shortageAmount > 0 ? "недостача" : nil,
                    footer: [
                        ("Позиций", "\(stocktake.items.count)"),
                        ("Расхождений", "\(stocktake.mismatches.count)"),
                    ],
                    colors: stocktake.shortageAmount > 0
                        ? Theme.heroNegative
                        : (stocktake.mismatches.isEmpty
                            ? Theme.heroGradient
                            : Theme.heroGradient)
                )

                OwnerSection("Подробности") {
                    VStack(alignment: .leading, spacing: 0) {
                        if let company = stocktake.companyName {
                            OpInfoRow(icon: "building.2.fill", tint: Color(hex: 0x14B8A6), title: "Точка", value: company)
                            OpDivider()
                        }
                        if let date = stocktake.countedAt {
                            OpInfoRow(icon: "calendar", tint: Color(hex: 0x3B82F6), title: "Пересчитано", value: date.formatted(.dateTime.day().month(.wide).hour().minute()))
                            OpDivider()
                        }
                        if let author = stocktake.authorName {
                            OpInfoRow(icon: "person.fill", tint: Color(hex: 0x8B5CF6), title: "Кто считал", value: author)
                            OpDivider()
                        }
                        OpInfoRow(
                            icon: "exclamationmark.triangle.fill",
                            tint: stocktake.mismatches.isEmpty ? Theme.positive : Theme.warning,
                            title: "Расхождений",
                            value: "\(stocktake.mismatches.count)",
                            valueColor: stocktake.mismatches.isEmpty ? Theme.positive : Theme.warning
                        )

                        if let comment = stocktake.comment, !comment.isEmpty {
                            Text(comment)
                                .font(.system(size: 14))
                                .foregroundStyle(Theme.textMuted)
                                .padding(Spacing.md)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                                .padding(.top, Spacing.sm)
                        }
                    }
                }

                OwnerSection("Расхождения") {
                    OpCount(text: "от крупных к мелким")
                } content: {
                    if stocktake.mismatches.isEmpty {
                        InlineEmpty(icon: "checkmark.seal", text: "Всё сошлось до позиции", tint: Theme.positive)
                    } else {
                        VStack(spacing: 0) {
                            ForEach(Array(stocktake.mismatches.enumerated()), id: \.element.id) { index, line in
                                if index > 0 { OpDivider() }
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

/// Позиция с расхождением: стрелка в кружке (вниз — недостача, вверх —
/// излишек), сколько ждали и сколько нашли.
private struct RevisionLineRow: View {
    let line: Stocktake.Line

    var body: some View {
        let tint = line.isShortage ? Theme.negative : Theme.positive
        HStack(spacing: Spacing.md) {
            TintedIcon(systemName: line.isShortage ? "arrow.down" : "arrow.up", tint: tint, size: 40)

            VStack(alignment: .leading, spacing: 3) {
                Text(line.name)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                // Ожидалось → найдено: без обоих чисел расхождение непонятно.
                Text("ждали \(Quantity.format(line.expected)) · нашли \(Quantity.format(line.actual)) \(line.unit)")
                    .font(.system(size: 13))
                    .monospacedDigit()
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 2) {
                Text((line.isShortage ? "−" : "+") + Quantity.format(abs(line.delta)))
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(tint)
                if line.amount != 0 {
                    Text(Money.format(abs(line.amount)))
                        .font(.system(size: 12))
                        .monospacedDigit()
                        .foregroundStyle(Theme.textDim)
                }
            }
            .fixedSize()
        }
        .padding(.vertical, Spacing.sm)
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
                // Долг — главная цифра раздела: с ней и открывают поставщиков.
                HeroSummary(
                    title: "Долг поставщикам",
                    value: Money.format(list.totalDebt),
                    footer: [
                        ("Поставщиков", "\(list.suppliers.count)"),
                        ("С долгом", "\(list.suppliers.filter(\.hasDebt).count)"),
                    ],
                    colors: Theme.heroGradient
                )
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

/// Строка поставщика: кружок с буквой, сколько закупили, долг — оранжевой
/// подписью вместо плашки.
private struct SupplierRow: View {
    let supplier: Supplier

    var body: some View {
        HStack(spacing: Spacing.md) {
            PersonInitial(name: supplier.name, size: 40)

            VStack(alignment: .leading, spacing: 3) {
                Text(supplier.name)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text("\(supplier.receiptsCount) \(pluralize(supplier.receiptsCount, "приёмка", "приёмки", "приёмок"))")
                    .font(.system(size: 13))
                    .monospacedDigit()
                    .foregroundStyle(Theme.textDim)
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 2) {
                Text(Money.format(supplier.receiptsTotal))
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(Theme.text)
                if supplier.hasDebt {
                    Text("долг \(Money.format(supplier.openDebtsAmount))")
                        .font(.system(size: 12, weight: .semibold))
                        .monospacedDigit()
                        .foregroundStyle(Theme.warning)
                }
            }
            .fixedSize()
        }
    }
}

private struct SupplierDetail: View {
    let supplier: Supplier

    var body: some View {
        ScreenScroll {
            VStack(spacing: Spacing.lg) {
                OpProfileHeader(
                    name: supplier.name,
                    subtitle: supplier.organizationName.flatMap { $0.isEmpty ? nil : $0 },
                    status: supplier.hasDebt
                        ? "\(supplier.openDebtsCount) \(pluralize(supplier.openDebtsCount, "накладная", "накладные", "накладных")) не оплачено"
                        : nil,
                    statusColor: Theme.warning
                )

                // Закупки главной цифрой, приёмки и долг — под ней.
                HeroSummary(
                    title: "Закуплено всего",
                    value: Money.format(supplier.receiptsTotal),
                    footer: [
                        ("Приёмок", "\(supplier.receiptsCount)"),
                        ("Долг", Money.format(supplier.openDebtsAmount)),
                    ],
                    colors: supplier.hasDebt
                        ? Theme.heroGradient
                        : Theme.heroGradient
                )

                OwnerSection("Реквизиты") {
                    VStack(spacing: 0) {
                        let rows = supplierRows
                        ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                            if index > 0 { OpDivider() }
                            OpInfoRow(icon: row.icon, tint: row.tint, title: row.title, value: row.value)
                        }
                        if rows.isEmpty {
                            InlineEmpty(icon: "doc.text", text: "Реквизиты не заполнены", tint: Theme.textDim)
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

    private var supplierRows: [(icon: String, tint: Color, title: String, value: String)] {
        var rows: [(icon: String, tint: Color, title: String, value: String)] = []
        if let bin = supplier.binIIN, !bin.isEmpty {
            rows.append(("number", Color(hex: 0x64748B), "БИН / ИИН", bin))
        }
        if let contact = supplier.contactName, !contact.isEmpty {
            rows.append(("person.fill", Color(hex: 0x8B5CF6), "Контакт", contact))
        }
        if let phone = supplier.phone, !phone.isEmpty {
            rows.append(("phone.fill", Color(hex: 0x10B981), "Телефон", phone))
        }
        if let last = supplier.lastReceiptDate {
            rows.append(("calendar", Color(hex: 0x3B82F6), "Последняя приёмка", last.formatted(.dateTime.day().month(.wide).year())))
        }
        return rows
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

/// Строка сотрудника: кружок с буквой, роль, оклад справа и сколько из
/// него уже выплачено — зелёным, когда закрыт полностью.
private struct StaffRow: View {
    let member: StaffMember
    let paid: Double

    var body: some View {
        HStack(spacing: Spacing.md) {
            PersonInitial(name: member.fullName, isActive: member.isActive, size: 40)

            VStack(alignment: .leading, spacing: 3) {
                Text(member.fullName)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(member.isActive ? Theme.text : Theme.textDim)
                    .lineLimit(1)
                Text(member.roleLabel)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 2) {
                Text(Money.format(member.monthlySalary))
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(Theme.text)
                if member.monthlySalary > 0 {
                    Text("выплачено \(Money.format(paid))")
                        .font(.system(size: 12))
                        .monospacedDigit()
                        .foregroundStyle(paid >= member.monthlySalary ? Theme.positive : Theme.textDim)
                }
            }
            .fixedSize()
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
                OpProfileHeader(
                    name: member.fullName,
                    subtitle: member.roleLabel,
                    status: member.isActive ? "работает" : "не работает",
                    statusColor: member.isActive ? Theme.positive : Theme.textDim,
                    isActive: member.isActive
                )

                accessCard

                // Сколько осталось выплатить — главная цифра месяца; оклад и
                // уже выплаченное — расшифровка под ней.
                HeroSummary(
                    title: "Осталось выплатить",
                    value: Money.format(max(member.monthlySalary - paid, 0)),
                    caption: "оклад за месяц",
                    footer: [
                        ("Начислено", Money.format(member.monthlySalary)),
                        ("Выплачено", Money.format(paid)),
                    ],
                    colors: paid >= member.monthlySalary
                        ? Theme.heroGradient
                        : Theme.heroGradient
                )

                if let phone = member.phone, !phone.isEmpty {
                    OwnerSection("Контакты") {
                        VStack(spacing: 0) {
                            OpInfoRow(icon: "phone.fill", tint: Color(hex: 0x10B981), title: "Телефон", value: phone)
                            if let email = member.email, !email.isEmpty {
                                OpDivider()
                                OpInfoRow(icon: "envelope.fill", tint: Color(hex: 0x3B82F6), title: "Почта", value: email)
                            }
                        }
                    }
                }

                OwnerSection("Выплаты") {
                    if !payments.isEmpty { OpCount(text: "\(payments.count)") }
                } content: {
                    if payments.isEmpty {
                        InlineEmpty(icon: "banknote", text: "Выплат ещё не было", tint: Theme.textDim)
                    } else {
                        VStack(spacing: 0) {
                            ForEach(Array(payments.prefix(20).enumerated()), id: \.element.id) { index, payment in
                                if index > 0 { OpDivider() }
                                AmountRow(
                                    leading: { TintedIcon(systemName: "banknote.fill", tint: Color(hex: 0x10B981), size: 40) },
                                    title: payment.payDate?.formatted(.dateTime.day().month(.wide).year()) ?? "—",
                                    subtitle: payment.comment.flatMap { $0.isEmpty ? nil : $0 },
                                    amount: Money.format(payment.amount)
                                )
                                .padding(.vertical, Spacing.xs)
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
            OwnerSection("Доступ") {
                VStack(alignment: .leading, spacing: Spacing.sm) {
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
                    InlineEmpty(icon: "clock.badge.checkmark", text: "Актов пересчёта нет.", tint: Theme.textDim)
                        .padding(Spacing.lg)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                }

                if let error {
                    Text(error)
                        .font(Typography.callout)
                        .foregroundStyle(Theme.negative)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                }

                ForEach(store.revisionActs) { act in
                    // Акт — белой карточкой: иконка статуса в кружке, статус
                    // цветной подписью, действия — кнопками ниже.
                    let tint = act.isOpen ? Theme.info : (act.isCancelled ? Theme.textDim : Theme.positive)
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        VStack(alignment: .leading, spacing: Spacing.sm) {
                            HStack(spacing: Spacing.md) {
                                TintedIcon(
                                    systemName: act.isOpen ? "clock.fill" : (act.isCancelled ? "xmark" : "checkmark.seal.fill"),
                                    tint: tint,
                                    size: 42
                                )
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(act.locationName)
                                        .font(.system(size: 16, weight: .semibold))
                                        .foregroundStyle(Theme.text)
                                        .lineLimit(1)
                                    if let opened = act.openedAt {
                                        Text("открыт \(opened.formatted(.dateTime.day().month(.abbreviated).hour().minute()))")
                                            .font(.system(size: 13))
                                            .foregroundStyle(Theme.textDim)
                                    }
                                }
                                Spacer(minLength: Spacing.sm)
                                Text(act.statusLabel)
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(tint)
                                    .fixedSize()
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
                    .padding(Spacing.lg)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
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

// ── Общие детали экранов ─────────────────────────────────────────────────────

/// Разделитель с отступом под иконку — строки читаются как один список.
private struct OpDivider: View {
    var body: some View {
        Rectangle().fill(Theme.borderSoft).frame(height: 1).padding(.leading, 52)
    }
}

/// Приглушённая подпись справа от заголовка секции.
private struct OpCount: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.system(size: 13, weight: .semibold))
            .monospacedDigit()
            .foregroundStyle(Theme.textDim)
            .lineLimit(1)
    }
}

/// Строка «иконка — название — значение» вместо StatRow в белых блоках.
private struct OpInfoRow: View {
    let icon: String
    let tint: Color
    let title: String
    let value: String
    var valueColor: Color = Theme.text

    var body: some View {
        HStack(spacing: Spacing.md) {
            TintedIcon(systemName: icon, tint: tint, size: 40)
            Text(title)
                .font(.system(size: 16))
                .foregroundStyle(Theme.textMuted)
                .lineLimit(1)
            Spacer(minLength: Spacing.sm)
            Text(value)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(valueColor)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .textSelection(.enabled)
        }
        .padding(.vertical, Spacing.sm)
    }
}

/// Шапка карточки человека или компании — как профиль в банке: крупная
/// буква, имя, подпись и статус цветным текстом.
private struct OpProfileHeader: View {
    let name: String
    var subtitle: String?
    var status: String?
    var statusColor: Color = Theme.textDim
    var isActive = true

    var body: some View {
        HStack(spacing: Spacing.lg) {
            PersonInitial(name: name, isActive: isActive, size: 64)
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(name)
                    .font(.system(size: 22, weight: .bold, design: .rounded))
                    .foregroundStyle(Theme.text)
                if let subtitle {
                    Text(subtitle)
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.textDim)
                }
                if let status {
                    Text(status)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(statusColor)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }
}
