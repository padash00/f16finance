import OrdaKit
import OrdaUI
import SwiftUI

// ── Подписка ─────────────────────────────────────────────────────────────────

/// Тариф, подключённые модули и счета своей организации.
///
/// Первым делом — состояние подписки и просроченные счета: если оплата
/// просрочена, часть системы отключается, и это должно быть видно сразу,
/// а не после прокрутки до списка счетов.
struct SubscriptionScreen: View {
    @Environment(BusinessStore.self) private var store

    var body: some View {
        ScreenScroll {
            if let error = store.billingError, store.billing == nil {
                ErrorStateView(error: error) { Task { await store.loadBilling() } }
            } else if let billing = store.billing {
                content(billing)
            } else if store.isLoadingBilling {
                VStack(spacing: Spacing.lg) {
                    Skeleton(height: 120, cornerRadius: Radius.lg)
                    Skeleton(height: 200, cornerRadius: Radius.lg)
                }
            } else {
                WideEmptyState(
                    icon: "creditcard",
                    title: "Подписки нет",
                    message: "Организация не выбрана или тариф ещё не подключён."
                )
            }
        }
        .background(Theme.background)
        .navigationTitle("Подписка")
        .toolbar { LogoutToolbarItem() }
        .task { await store.loadBilling() }
        .refreshable { await store.loadBilling() }
    }

    @ViewBuilder
    private func content(_ billing: OrganizationBilling) -> some View {
        VStack(spacing: Spacing.lg) {
            header(billing)

            if billing.overdueCount > 0 {
                overdueBanner(billing)
            }

            SplitDashboard {
                invoices(billing)
            } side: {
                modules(billing)
            }
        }
    }

    private func header(_ billing: OrganizationBilling) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        Text(billing.organizationName ?? "Организация")
                            .font(Typography.title)
                            .foregroundStyle(Theme.text)
                        if let domain = billing.primaryDomain {
                            Text(domain)
                                .font(Typography.caption)
                                .monospaced()
                                .foregroundStyle(Theme.textDim)
                        }
                    }
                    Spacer()
                    if let subscription = billing.subscription {
                        StatusChip(subscription.statusLabel, kind: chipKind(subscription.status))
                    }
                }

                RowDivider()

                if let subscription = billing.subscription {
                    StatRow("Тариф", value: subscription.planName ?? "—", icon: "star")
                    if let period = subscription.billingPeriod {
                        StatRow("Период оплаты", value: period == "yearly" ? "Год" : "Месяц", icon: "calendar")
                    }
                    if let ends = subscription.endsAt {
                        StatRow(
                            "Действует до",
                            value: ends.formatted(.dateTime.day().month(.wide).year()),
                            valueColor: (subscription.daysLeft ?? 1) < 0 ? Theme.negative : Theme.text,
                            icon: "clock"
                        )
                    }
                    // Предупреждаем только когда до конца меньше двух недель:
                    // раньше это шум, а не польза.
                    if let days = subscription.daysLeft, days >= 0, days <= 14 {
                        StatusChip("осталось \(days) \(pluralize(days, "день", "дня", "дней"))", kind: .warning)
                    }
                } else {
                    InlineEmpty(icon: "creditcard", text: "Подписка не оформлена", tint: Theme.textDim)
                }

                RowDivider()
                StatRow("В месяц", value: Money.format(billing.monthlyTotal), emphasized: true)
            }
        }
    }

    private func chipKind(_ status: String) -> StatusChip.Kind {
        switch status {
        case "active": .good
        case "trialing": .info
        case "past_due": .danger
        default: .neutral
        }
    }

    private func overdueBanner(_ billing: OrganizationBilling) -> some View {
        Card(accent: Theme.negative) {
            HStack(spacing: Spacing.md) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 18))
                    .foregroundStyle(Theme.negative)
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(billing.overdueCount) \(pluralize(billing.overdueCount, "счёт просрочен", "счёта просрочено", "счетов просрочено"))")
                        .font(Typography.headline)
                        .foregroundStyle(Theme.text)
                    Text("При долгой просрочке часть разделов отключается.")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textMuted)
                }
                Spacer()
            }
        }
    }

    private func invoices(_ billing: OrganizationBilling) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Счета", subtitle: billing.invoices.isEmpty ? nil : "последние \(billing.invoices.count)")

                if billing.invoices.isEmpty {
                    InlineEmpty(icon: "doc.text", text: "Счетов пока нет", tint: Theme.textDim)
                } else {
                    ForEach(Array(billing.invoices.enumerated()), id: \.element.id) { index, invoice in
                        if index > 0 { RowDivider() }
                        InvoiceRow(invoice: invoice)
                    }
                }
            }
        }
    }

    private func modules(_ billing: OrganizationBilling) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Что подключено")

                if let package = billing.package {
                    HStack {
                        Label(package.name, systemImage: "shippingbox.fill")
                            .font(Typography.callout)
                            .foregroundStyle(Theme.text)
                        Spacer()
                        Text(Money.format(package.priceKzt))
                            .font(Typography.callout.weight(.medium))
                            .monospacedDigit()
                            .foregroundStyle(Theme.textMuted)
                    }
                }

                if billing.addons.isEmpty {
                    if billing.package == nil {
                        InlineEmpty(icon: "square.stack", text: "Модули не подключены", tint: Theme.textDim)
                    }
                } else {
                    ForEach(billing.addons) { addon in
                        RowDivider()
                        HStack {
                            Label(addon.name, systemImage: "puzzlepiece.extension.fill")
                                .font(Typography.callout)
                                .foregroundStyle(Theme.text)
                            Spacer()
                            Text(Money.format(addon.priceKzt))
                                .font(Typography.callout.weight(.medium))
                                .monospacedDigit()
                                .foregroundStyle(Theme.textMuted)
                        }
                    }
                }
            }
        }
    }
}

private struct InvoiceRow: View {
    let invoice: OrganizationBilling.Invoice

    private var kind: StatusChip.Kind {
        if invoice.isPaid { return .good }
        if invoice.isOverdue { return .danger }
        return .warning
    }

    var body: some View {
        HStack(spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: 1) {
                Text(period)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                if let due = invoice.dueDate, !invoice.isPaid {
                    Text("до \(due.formatted(.dateTime.day().month(.abbreviated)))")
                        .font(Typography.caption)
                        .foregroundStyle(invoice.isOverdue ? Theme.negative : Theme.textDim)
                } else if let paid = invoice.paidAt {
                    Text("оплачен \(paid.formatted(.dateTime.day().month(.abbreviated)))")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                }
            }

            Spacer(minLength: Spacing.sm)

            Text(Money.format(invoice.amount))
                .font(Typography.callout.weight(.medium))
                .monospacedDigit()
                .foregroundStyle(Theme.text)

            StatusChip(invoice.statusLabel, kind: kind)
        }
    }

    private var period: String {
        guard let start = invoice.periodStart else { return "Счёт" }
        guard let end = invoice.periodEnd else {
            return start.formatted(.dateTime.month(.wide).year())
        }
        return "\(start.formatted(.dateTime.day().month(.abbreviated))) — \(end.formatted(.dateTime.day().month(.abbreviated)))"
    }
}

// ── Инциденты ────────────────────────────────────────────────────────────────

/// Штрафы, бонусы и заметки по людям.
///
/// Штраф и бонус — одна сущность с разным знаком, поэтому список общий, а
/// разделяет их цвет суммы: минус красным, плюс зелёным. Два отдельных
/// списка заставляли бы переключаться, чтобы понять итог по человеку.
struct IncidentsScreen: View {
    @Environment(BusinessStore.self) private var store
    @Environment(\.access) private var access

    @State private var selected: Incident?
    @State private var onlyPending = false
    @State private var isAdding = false

    /// Права те же, что проверяет сервер.
    private var canCreate: Bool { access?.can("incidents.create") ?? false }
    private var canDecide: Bool { access?.can("incidents.update") ?? false }

    var body: some View {
        VStack(spacing: 0) {
            summary

            if let error = store.incidentsError, store.incidents.isEmpty {
                ErrorStateView(error: error) { Task { await store.loadIncidents() } }
            } else if store.isLoadingIncidents && store.incidents.isEmpty {
                LoadingRows(count: 6)
            } else {
                MasterDetail(
                    items: filtered,
                    selection: $selected,
                    listWidth: 340,
                    actions: { incident in
                        // Разбор инцидента — это два решения: признать или
                        // отменить. Открывать карточку ради одного нажатия
                        // долго, а очередь разбирают пачкой.
                        guard canDecide, incident.status == "draft" else { return [] }
                        return [
                            RowAction("Подтвердить", icon: "checkmark.circle", tint: Theme.positive) {
                                Task { await store.setIncidentStatus(id: incident.id, to: .confirmed) }
                            },
                            RowAction("Отменить", icon: "xmark.circle", isDestructive: true) {
                                Task { await store.setIncidentStatus(id: incident.id, to: .voided) }
                            },
                        ]
                    }
                ) { incident in
                    IncidentRow(incident: incident)
                } detail: { incident in
                    IncidentDetail(incident: incident)
                } empty: {
                    WideEmptyState(
                        icon: "checkmark.shield",
                        title: onlyPending ? "Нет ожидающих решения" : "Инцидентов нет",
                        message: "Здесь появятся штрафы, бонусы и заметки по команде."
                    )
                }
            }
        }
        .background(Theme.background)
        .navigationTitle("Инциденты")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Toggle(isOn: $onlyPending) {
                    Label("Только ожидающие", systemImage: "clock")
                }
                .toggleStyle(.button)
            }
            LogoutToolbarItem()
        }
        .task { await store.loadIncidents() }
        .refreshable { await store.loadIncidents() }
    }

    private var summary: some View {
        let fines = store.incidents.reduce(0) { $0 + $1.fineAmount }
        let bonuses = store.incidents.reduce(0) { $0 + $1.bonusAmount }
        let pending = store.incidents.filter(\.isPending).count

        return HStack(spacing: Spacing.md) {
            SummaryPill(title: "Штрафы", value: Money.format(fines), tint: Theme.negative)
            SummaryPill(title: "Бонусы", value: Money.format(bonuses), tint: Theme.positive)
            SummaryPill(title: "Ждут решения", value: "\(pending)", tint: pending > 0 ? Theme.warning : Theme.textDim)
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.md)
    }

    private var filtered: [Incident] {
        let items = onlyPending ? store.incidents.filter(\.isPending) : store.incidents
        return items.sorted { ($0.occurredAt ?? .distantPast) > ($1.occurredAt ?? .distantPast) }
    }
}

/// Компактная сводка в шапке — не карточка: это фон для списка, а не раздел.
struct SummaryPill: View {
    let title: String
    let value: String
    var tint: Color = Theme.brand

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(value)
                .font(Typography.headline)
                .monospacedDigit()
                .foregroundStyle(tint)
            Text(title)
                .font(Typography.caption)
                .foregroundStyle(Theme.textDim)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Spacing.md)
        .background(Theme.surfaceRaised)
        .clipShape(RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
    }
}

struct IncidentRow: View {
    let incident: Incident

    var body: some View {
        HStack(spacing: Spacing.md) {
            Image(systemName: incident.isBonus ? "gift.fill" : (incident.isFine ? "exclamationmark.triangle.fill" : "note.text"))
                .font(.system(size: 14))
                .foregroundStyle(incident.isBonus ? Theme.positive : (incident.isFine ? Theme.negative : Theme.textDim))
                .frame(width: 22)

            VStack(alignment: .leading, spacing: 1) {
                Text(incident.title)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text([incident.subjectName, incident.companyName].compactMap { $0 }.joined(separator: " · "))
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 2) {
                if incident.netAmount != 0 {
                    Text(Money.signed(incident.netAmount))
                        .font(Typography.callout.weight(.medium))
                        .monospacedDigit()
                        .foregroundStyle(incident.netAmount > 0 ? Theme.positive : Theme.negative)
                }
                if incident.isPending {
                    StatusChip("ждёт", kind: .warning)
                }
            }
        }
    }
}

private struct IncidentDetail: View {
    let incident: Incident

    var body: some View {
        ScreenScroll {
            VStack(spacing: Spacing.lg) {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: Spacing.xs) {
                                Text(incident.kindLabel)
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.textDim)
                                    .textCase(.uppercase)
                                Text(incident.title)
                                    .font(Typography.title)
                                    .foregroundStyle(Theme.text)
                            }
                            Spacer()
                            StatusChip(incident.statusLabel, kind: incident.isPending ? .warning : .good)
                        }

                        if let details = incident.details, !details.isEmpty {
                            RowDivider()
                            Text(details)
                                .font(Typography.callout)
                                .foregroundStyle(Theme.textMuted)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }

                        RowDivider()
                        if let subject = incident.subjectName {
                            StatRow("Сотрудник", value: subject, icon: "person")
                        }
                        if let company = incident.companyName {
                            StatRow("Точка", value: company, icon: "building.2")
                        }
                        if let date = incident.occurredAt {
                            StatRow("Когда", value: date.formatted(.dateTime.day().month(.wide).hour().minute()), icon: "clock")
                        }
                        if incident.fineAmount > 0 {
                            StatRow("Штраф", value: Money.format(incident.fineAmount), valueColor: Theme.negative, icon: "minus.circle")
                        }
                        if incident.bonusAmount > 0 {
                            StatRow("Бонус", value: Money.format(incident.bonusAmount), valueColor: Theme.positive, icon: "plus.circle")
                        }
                        if incident.photoCount > 0 {
                            StatRow("Фото", value: "\(incident.photoCount)", icon: "photo")
                        }
                    }
                }
            }
        }
        .background(Theme.background)
        .navigationTitle("Инцидент")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}

// ── Долги с точки ────────────────────────────────────────────────────────────

/// Долги клиентов, записанные операторами за неделю.
struct PointDebtsScreen: View {
    @Environment(BusinessStore.self) private var store
    @Environment(\.access) private var access
    @Environment(\.api) private var api

    @State private var settling: PointDebt?
    @State private var isSaving = false
    @State private var actionError: String?

    /// Погашение — действие с деньгами, и право у него своё.
    private var canSettle: Bool { access?.can("point-debts.mark_paid") ?? false }

    var body: some View {
        @Bindable var bindable = store

        return ScreenScroll {
            VStack(spacing: Spacing.lg) {
                WeekStepper(
                    week: $bindable.debtsWeek,
                    allowsFuture: false
                )

                if let error = store.debtsError, store.debts == nil {
                    ErrorStateView(error: error) { Task { await store.loadDebts() } }
                } else if let week = store.debts {
                    content(week)
                } else {
                    VStack(spacing: Spacing.lg) {
                        Skeleton(height: 96, cornerRadius: Radius.lg)
                        Skeleton(height: 200, cornerRadius: Radius.lg)
                    }
                }
            }
        }
        .background(Theme.background)
        .navigationTitle("Долги с точки")
        .toolbar { LogoutToolbarItem() }
        .alert("Долг погашен?", isPresented: .constant(settling != nil)) {
            Button("Погашен") {
                if let debt = settling { Task { await settle(debt) } }
            }
            Button("Отмена", role: .cancel) { settling = nil }
        } message: {
            if let debt = settling {
                Text("\(debt.clientName) — \(Money.format(debt.amount)). Отмечайте, только когда деньги вернули: запись видна в журнале.")
            }
        }
        .overlay(alignment: .top) {
            if let actionError {
                Text(actionError)
                    .font(Typography.caption)
                    .foregroundStyle(Theme.negative)
                    .padding(Spacing.md)
                    .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
                    .padding(Spacing.md)
            }
        }
        .task { await store.loadDebts() }
        .refreshable { await store.loadDebts() }
    }

    private func settle(_ debt: PointDebt) async {
        settling = nil
        isSaving = true
        actionError = nil
        defer { isSaving = false }

        do {
            try await BusinessService(api: api).markPointDebtsPaid(itemIDs: [debt.id])
            Haptics.success()
            await store.loadDebts()
        } catch let error as APIError {
            Haptics.error()
            actionError = error.userMessage
        } catch {
            Haptics.error()
            actionError = error.localizedDescription
        }
    }

    @ViewBuilder
    private func content(_ week: PointDebtWeek) -> some View {
        VStack(spacing: Spacing.lg) {
            DashboardGrid {
                MetricTile(
                    label: "Всего за неделю",
                    value: Money.format(week.totalAmount),
                    icon: "sum",
                    accent: Theme.brand
                )
                MetricTile(
                    label: "Не погашено",
                    value: Money.format(week.unpaidAmount),
                    icon: "exclamationmark.circle.fill",
                    accent: week.unpaidAmount > 0 ? Theme.warning : Theme.positive
                )
                MetricTile(
                    label: "Позиций",
                    value: "\(week.totalCount)",
                    icon: "list.bullet",
                    accent: Theme.textMuted
                )
            }

            // Группируем по точкам: долг спрашивают с конкретной точки,
            // а не со всей сети сразу.
            let grouped = Dictionary(grouping: week.items) { $0.companyID ?? "" }

            if week.items.isEmpty {
                Card {
                    InlineEmpty(icon: "checkmark.circle", text: "За эту неделю долгов нет", tint: Theme.positive)
                }
            } else {
                ForEach(week.companies) { company in
                    if let rows = grouped[company.id], !rows.isEmpty {
                        Card {
                            VStack(alignment: .leading, spacing: Spacing.md) {
                                SectionHeader(
                                    company.name,
                                    subtitle: Money.format(rows.reduce(0) { $0 + $1.amount })
                                )
                                ForEach(Array(rows.enumerated()), id: \.element.id) { index, debt in
                                    if index > 0 { RowDivider() }
                                    if canSettle, !debt.isPaid {
                                        // Долг возвращают наличными у стойки —
                                        // отметить надо там же, а не вечером.
                                        Button {
                                            settling = debt
                                        } label: {
                                            DebtRow(debt: debt)
                                                .contentShape(Rectangle())
                                        }
                                        .buttonStyle(.pressable)
                                    } else {
                                        DebtRow(debt: debt)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

private struct DebtRow: View {
    let debt: PointDebt

    var body: some View {
        HStack(spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: 1) {
                Text(debt.clientName)
                    .font(Typography.callout)
                    .foregroundStyle(debt.isPaid ? Theme.textDim : Theme.text)
                    .lineLimit(1)
                if let comment = debt.comment, !comment.isEmpty {
                    Text(comment)
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: Spacing.sm)

            Text(Money.format(debt.amount))
                .font(Typography.callout.weight(.medium))
                .monospacedDigit()
                .foregroundStyle(debt.isPaid ? Theme.textDim : Theme.text)

            StatusChip(debt.statusLabel, kind: debt.isPaid ? .good : .warning)
        }
    }
}

// ── Общий переключатель недели ───────────────────────────────────────────────

/// Стрелки «предыдущая / следующая неделя».
///
/// Вынесен отдельно: тремя экранами подряд повторять одну и ту же вёрстку
/// со стрелками — верный способ получить три чуть разных поведения.
struct WeekStepper: View {
    @Binding var week: String
    var allowsFuture: Bool = false

    private var isCurrent: Bool { week == PayWeek.start() }

    var body: some View {
        Card {
            HStack(spacing: Spacing.md) {
                Button { week = PayWeek.shifted(week, by: -1) } label: {
                    Image(systemName: "chevron.left").font(.system(size: 14, weight: .semibold))
                }
                .buttonStyle(.pressable)
                .foregroundStyle(Theme.brand)

                Spacer()

                VStack(spacing: 1) {
                    Text(label)
                        .font(Typography.headline)
                        .foregroundStyle(Theme.text)
                    if isCurrent {
                        Text("текущая неделя")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.brand)
                    }
                }

                Spacer()

                Button { week = PayWeek.shifted(week, by: 1) } label: {
                    Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold))
                }
                .buttonStyle(.pressable)
                .disabled(!allowsFuture && isCurrent)
                .foregroundStyle(!allowsFuture && isCurrent ? Theme.textDim : Theme.brand)
            }
        }
    }

    private var label: String {
        guard let start = DateParsing.parseDateOnly(week) else { return week }
        let end = Calendar(identifier: .iso8601).date(byAdding: .day, value: 6, to: start) ?? start
        return "\(start.formatted(.dateTime.day().month(.abbreviated))) — \(end.formatted(.dateTime.day().month(.abbreviated)))"
    }
}
