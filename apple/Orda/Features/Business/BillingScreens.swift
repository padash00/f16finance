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

    /// Сколько платим в месяц — главной цифрой, тариф и сроки — под ней.
    /// Цвет карточки — состояние подписки: красный при просрочке оплаты.
    private func header(_ billing: OrganizationBilling) -> some View {
        let subscription = billing.subscription
        var footer: [(String, String)] = []
        if let subscription {
            footer.append(("Тариф", subscription.planName ?? "—"))
            if let period = subscription.billingPeriod {
                footer.append(("Период оплаты", period == "yearly" ? "Год" : "Месяц"))
            }
            if let ends = subscription.endsAt {
                footer.append(("Действует до", ends.formatted(.dateTime.day().month(.abbreviated).year())))
            }
        }
        let caption = [
            subscription?.statusLabel ?? "Подписка не оформлена",
            billing.primaryDomain,
        ].compactMap { $0 }.joined(separator: " · ")

        return VStack(alignment: .leading, spacing: Spacing.sm) {
            HeroSummary(
                title: "\(billing.organizationName ?? "Организация") · в месяц",
                value: Money.format(billing.monthlyTotal),
                caption: caption,
                footer: footer,
                colors: heroColors(subscription?.status)
            )

            // Предупреждаем только когда до конца меньше двух недель:
            // раньше это шум, а не польза.
            if let days = subscription?.daysLeft, days >= 0, days <= 14 {
                Text("Подписка кончается: осталось \(days) \(pluralize(days, "день", "дня", "дней"))")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.warning)
                    .padding(.horizontal, Spacing.xs)
            } else if let days = subscription?.daysLeft, days < 0 {
                Text("Срок подписки истёк")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.negative)
                    .padding(.horizontal, Spacing.xs)
            }
        }
    }

    private func heroColors(_ status: String?) -> [Color] {
        switch status {
        case "past_due": Theme.heroNegative
        case "trialing": Theme.heroAccent
        case "active": Theme.heroGradient
        default: [Color(hex: 0x64748B), Color(hex: 0x475569)]
        }
    }

    private func overdueBanner(_ billing: OrganizationBilling) -> some View {
        HStack(spacing: Spacing.md) {
            TintedIcon(systemName: "exclamationmark.triangle.fill", tint: Theme.negative, size: 44)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(billing.overdueCount) \(pluralize(billing.overdueCount, "счёт просрочен", "счёта просрочено", "счетов просрочено"))")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Theme.text)
                Text("При долгой просрочке часть разделов отключается.")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textMuted)
            }
            Spacer()
        }
        .padding(Spacing.lg)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private func invoices(_ billing: OrganizationBilling) -> some View {
        OwnerSection("Счета") {
            if !billing.invoices.isEmpty {
                Text("последние \(billing.invoices.count)")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
            }
        } content: {
            if billing.invoices.isEmpty {
                InlineEmpty(icon: "doc.text", text: "Счетов пока нет", tint: Theme.textDim)
            } else {
                VStack(spacing: Spacing.md) {
                    ForEach(billing.invoices, id: \.id) { invoice in
                        InvoiceRow(invoice: invoice)
                    }
                }
            }
        }
    }

    private func modules(_ billing: OrganizationBilling) -> some View {
        OwnerSection("Что подключено") {
            VStack(spacing: Spacing.md) {
                if let package = billing.package {
                    AmountRow(
                        leading: { TintedIcon(systemName: "shippingbox.fill", tint: Color(hex: 0x4F46E5), size: 40) },
                        title: package.name,
                        subtitle: "пакет",
                        amount: Money.format(package.priceKzt)
                    )
                }

                if billing.addons.isEmpty {
                    if billing.package == nil {
                        InlineEmpty(icon: "square.stack", text: "Модули не подключены", tint: Theme.textDim)
                    }
                } else {
                    ForEach(Array(billing.addons.enumerated()), id: \.element.id) { index, addon in
                        AmountRow(
                            leading: { TintedIcon(systemName: "puzzlepiece.extension.fill", tint: OwnerTint.point(index), size: 40) },
                            title: addon.name,
                            subtitle: "модуль",
                            amount: Money.format(addon.priceKzt)
                        )
                    }
                }
            }
        }
    }
}

private struct InvoiceRow: View {
    let invoice: OrganizationBilling.Invoice

    private var tint: Color {
        if invoice.isPaid { return Theme.positive }
        if invoice.isOverdue { return Theme.negative }
        return Theme.warning
    }

    var body: some View {
        HStack(spacing: Spacing.md) {
            TintedIcon(systemName: invoice.isPaid ? "checkmark" : "doc.text.fill", tint: tint, size: 40)

            VStack(alignment: .leading, spacing: 2) {
                Text(period)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                if let due = invoice.dueDate, !invoice.isPaid {
                    Text("до \(due.formatted(.dateTime.day().month(.abbreviated)))")
                        .font(.system(size: 13))
                        .foregroundStyle(invoice.isOverdue ? Theme.negative : Theme.textDim)
                } else if let paid = invoice.paidAt {
                    Text("оплачен \(paid.formatted(.dateTime.day().month(.abbreviated)))")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textDim)
                }
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 2) {
                Text(Money.format(invoice.amount))
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(Theme.text)
                // Статус подписью, а не плашкой — плашка съедала полстроки.
                Text(invoice.statusLabel.lowercased())
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(tint)
            }
            .fixedSize()
        }
        .padding(.vertical, Spacing.xs)
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

    /// Итог штрафов и бонусов — одной цветной карточкой над списком.
    private var summary: some View {
        let fines = store.incidents.reduce(0) { $0 + $1.fineAmount }
        let bonuses = store.incidents.reduce(0) { $0 + $1.bonusAmount }
        let pending = store.incidents.filter(\.isPending).count

        return HeroSummary(
            title: "Бонусы минус штрафы",
            value: Money.signed(bonuses - fines),
            caption: pending > 0 ? "\(pending) ждут решения" : "всё разобрано",
            footer: [
                ("Штрафы", Money.format(fines)),
                ("Бонусы", Money.format(bonuses)),
                ("Ждут решения", "\(pending)"),
            ],
            colors: fines > bonuses
                ? Theme.heroNegative
                : Theme.heroGradient
        )
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
                // Сумма меняется после оплаты долга: переход показывает, что
                // именно изменилось, вместо того чтобы подменить число рывком.
                .contentTransition(.numericText())
                .animation(Motion.value, value: value)
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

    private var tint: Color {
        incident.isBonus ? Theme.positive : (incident.isFine ? Theme.negative : Theme.textDim)
    }

    var body: some View {
        HStack(spacing: Spacing.md) {
            TintedIcon(
                systemName: incident.isBonus ? "gift.fill" : (incident.isFine ? "exclamationmark.triangle.fill" : "note.text"),
                tint: tint,
                size: 40
            )

            VStack(alignment: .leading, spacing: 2) {
                Text(incident.title)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text([incident.subjectName, incident.companyName].compactMap { $0 }.joined(separator: " · "))
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 2) {
                if incident.netAmount != 0 {
                    Text(Money.signed(incident.netAmount))
                        .font(.system(size: 16, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(incident.netAmount > 0 ? Theme.positive : Theme.negative)
                }
                if incident.isPending {
                    Text("ждёт")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.warning)
                }
            }
            .fixedSize()
        }
        .padding(.vertical, Spacing.xs)
    }
}

private struct IncidentDetail: View {
    let incident: Incident

    var body: some View {
        ScreenScroll {
            VStack(spacing: Spacing.lg) {
                // Сумма — цветной карточкой, если она есть; у заметки суммы
                // нет, и карточка с нулём была бы пустым местом.
                if incident.netAmount != 0 {
                    HeroSummary(
                        title: incident.kindLabel,
                        value: Money.signed(incident.netAmount),
                        caption: incident.statusLabel,
                        colors: incident.netAmount > 0
                            ? Theme.heroGradient
                            : Theme.heroNegative
                    )
                }

                OwnerSection(incident.title) {
                    Text(incident.statusLabel.lowercased())
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(incident.isPending ? Theme.warning : Theme.positive)
                } content: {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        Text(incident.kindLabel)
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textDim)

                        if let details = incident.details, !details.isEmpty {
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
            HeroSummary(
                title: week.unpaidAmount > 0 ? "Не погашено за неделю" : "Все долги погашены",
                value: Money.format(week.unpaidAmount),
                footer: [
                    ("Всего за неделю", Money.format(week.totalAmount)),
                    ("Погашено", Money.format(week.totalAmount - week.unpaidAmount)),
                    ("Позиций", "\(week.totalCount)"),
                ],
                colors: week.unpaidAmount > 0
                    ? Theme.heroNegative
                    : Theme.heroGradient
            )

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
            PersonInitial(name: debt.clientName, isActive: !debt.isPaid)
            VStack(alignment: .leading, spacing: 2) {
                Text(debt.clientName)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(debt.isPaid ? Theme.textDim : Theme.text)
                    .lineLimit(1)
                if let comment = debt.comment, !comment.isEmpty {
                    Text(comment)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textDim)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 2) {
                Text(Money.format(debt.amount))
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(debt.isPaid ? Theme.textDim : Theme.text)
                    .strikethrough(debt.isPaid, color: Theme.textDim)
                // Статус подписью, а не плашкой — плашка съедала полстроки.
                Text(debt.statusLabel.lowercased())
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(debt.isPaid ? Theme.positive : Theme.warning)
            }
            .fixedSize()
        }
        .padding(.vertical, Spacing.xs)
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
        // Неделя листается круглыми кнопками по краям — как месяц в выписке.
        HStack(spacing: Spacing.md) {
            stepButton("chevron.left", enabled: true) { week = PayWeek.shifted(week, by: -1) }

            Spacer()

            VStack(spacing: 1) {
                Text(label)
                    .font(.system(size: 17, weight: .bold, design: .rounded))
                    .foregroundStyle(Theme.text)
                if isCurrent {
                    Text("текущая неделя")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.brand)
                }
            }

            Spacer()

            stepButton("chevron.right", enabled: allowsFuture || !isCurrent) { week = PayWeek.shifted(week, by: 1) }
        }
    }

    private func stepButton(_ icon: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(enabled ? Theme.text : Theme.textDim.opacity(0.5))
                .frame(width: 44, height: 44)
                .background(Theme.surface, in: Circle())
        }
        .buttonStyle(.pressable)
        .disabled(!enabled)
    }

    private var label: String {
        guard let start = DateParsing.parseDateOnly(week) else { return week }
        let end = Calendar(identifier: .iso8601).date(byAdding: .day, value: 6, to: start) ?? start
        return "\(start.formatted(.dateTime.day().month(.abbreviated))) — \(end.formatted(.dateTime.day().month(.abbreviated)))"
    }
}
