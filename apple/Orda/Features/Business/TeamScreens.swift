import OrdaKit
import OrdaUI
import SwiftUI

// ── Операторы ────────────────────────────────────────────────────────────────

/// Люди на точках: список слева, карточка человека справа.
///
/// Сортировка по обороту, а не по алфавиту: владелец открывает этот раздел,
/// чтобы понять, кто вытягивает выручку, а кто просел. Алфавит для этого
/// бесполезен, а имя всё равно видно в строке.
struct OperatorsScreen: View {
    @Environment(BusinessStore.self) private var store
    @Environment(\.access) private var access

    @State private var selected: TeamOperator?
    @State private var search = ""
    @State private var showInactive = false
    @State private var isAdding = false

    /// Право `operators.create` проверяет и сервер.
    private var canCreate: Bool { access?.can("operators.create") ?? false }

    var body: some View {
        Group {
            if let error = store.teamError, store.operators.isEmpty {
                ErrorStateView(error: error) { Task { await store.loadTeam() } }
            } else if store.isLoadingTeam && store.operators.isEmpty {
                LoadingRows(count: 7)
            } else {
                MasterDetail(
                    items: filtered,
                    selection: $selected,
                    listWidth: 320
                ) { person in
                    OperatorRowView(person: person)
                } detail: { person in
                    OperatorDetail(person: person)
                } empty: {
                    WideEmptyState(
                        icon: "person.2",
                        title: search.isEmpty ? "Операторов нет" : "Никого не найдено",
                        message: search.isEmpty
                            ? "Заведите операторов в разделе доступа."
                            : "Попробуйте другой запрос."
                    )
                }
            }
        }
        .background(Theme.background)
        .navigationTitle("Операторы")
        .searchable(text: $search, prompt: "Имя или должность")
        .sheet(isPresented: $isAdding) { AddOperatorSheet() }
        .toolbar {
            if canCreate {
                ToolbarItem(placement: .primaryAction) {
                    Button { isAdding = true } label: { Image(systemName: "plus") }
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
        .task { await store.loadTeam() }
        .refreshable { await store.loadTeam() }
    }

    private var filtered: [TeamOperator] {
        var people = store.operators
        if !showInactive { people = people.filter(\.isActive) }
        if !search.isEmpty {
            people = people.filter {
                $0.displayName.localizedCaseInsensitiveContains(search)
                    || ($0.position?.localizedCaseInsensitiveContains(search) ?? false)
            }
        }
        return people.sorted { left, right in
            // Действующие всегда выше уволенных, дальше — по обороту.
            if left.isActive != right.isActive { return left.isActive }
            return left.stats.totalTurnover > right.stats.totalTurnover
        }
    }
}

/// Строка оператора: аватар, имя, оборот за 30 дней.
struct OperatorRowView: View {
    let person: TeamOperator

    var body: some View {
        HStack(spacing: Spacing.md) {
            OperatorAvatar(person: person, size: 36)

            VStack(alignment: .leading, spacing: 1) {
                Text(person.displayName)
                    .font(Typography.callout)
                    .foregroundStyle(person.isActive ? Theme.text : Theme.textDim)
                    .lineLimit(1)
                Text(person.position ?? "Оператор")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 1) {
                Text(Money.format(person.stats.totalTurnover))
                    .font(Typography.callout.weight(.medium))
                    .monospacedDigit()
                    .foregroundStyle(Theme.text)
                Text("\(person.stats.totalShifts) \(pluralize(person.stats.totalShifts, "смена", "смены", "смен"))")
                    .font(Typography.caption)
                    .monospacedDigit()
                    .foregroundStyle(Theme.textDim)
            }

            if !person.isActive {
                Image(systemName: "person.slash")
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.textDim)
            }
        }
    }
}

/// Кружок с фото или инициалами.
///
/// Инициалы — не заглушка «пока нет фото», а полноценный вид: у большинства
/// операторов фото не загружено, и серый силуэт на весь список выглядел бы
/// сломанным.
struct OperatorAvatar: View {
    let person: TeamOperator
    var size: CGFloat = 36

    var body: some View {
        Thumbnail(
            url: person.photoURL,
            side: size,
            cornerRadius: size / 2,
            fallbackText: person.initials
        )
        .overlay(Circle().stroke(Theme.border, lineWidth: 0.5))
        .opacity(person.isActive ? 1 : 0.55)
    }
}

/// Карточка человека: показатели за 30 дней и учётные данные.
private struct OperatorDetail: View {
    let person: TeamOperator

    @Environment(BusinessStore.self) private var store
    @Environment(\.api) private var api
    @Environment(\.access) private var access

    @State private var confirmingToggle = false
    @State private var resetting = false
    @State private var isToggling = false
    @State private var toggleError: String?

    /// Право то же, что проверяет сервер.
    private var canToggle: Bool { access?.can("operators.toggle_active") ?? false }
    private var canReset: Bool { access?.can("operators.reset_password") ?? false }
    /// Увольнение закрыто тем же правом, что и на сервере.
    private var canDismiss: Bool { access?.can("hr.dismiss") ?? false }

    @State private var dismissing = false
    @State private var isLinking = false
    @State private var linkError: String?

    private var canLink: Bool { access?.can("operators.edit") ?? false }

    var body: some View {
        ScreenScroll {
            VStack(spacing: Spacing.lg) {
                header

                staffLinkCard

                if canToggle || canReset { accessCard }

                DashboardGrid {
                    MetricTile(
                        label: "Оборот за 30 дней",
                        value: Money.format(person.stats.totalTurnover),
                        icon: "banknote.fill",
                        accent: Theme.brand
                    )
                    MetricTile(
                        label: "Смен",
                        value: "\(person.stats.totalShifts)",
                        icon: "calendar",
                        accent: Theme.info
                    )
                    MetricTile(
                        label: "В среднем за смену",
                        value: Money.format(person.stats.avgPerShift),
                        icon: "chart.bar.fill",
                        accent: Theme.textMuted
                    )
                    MetricTile(
                        label: "Долги",
                        value: Money.format(person.stats.totalDebts),
                        icon: "creditcard.fill",
                        accent: person.stats.totalDebts > 0 ? Theme.warning : Theme.positive
                    )
                }

                contacts
            }
        }
        .background(Theme.background)
        .navigationTitle(person.displayName)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }

    /// Нет карточки сотрудника — и человек выпадает из системы.
    ///
    /// Смена открывается без хозяина, подтверждения регламентов не пишутся,
    /// в дисциплине его нет. Со стороны это выглядит как «у него кнопка не
    /// работает», и починить это без подсказки нельзя: в интерфейсе связки не
    /// видно вовсе.
    @ViewBuilder
    private var staffLinkCard: some View {
        if !person.hasStaffLink {
            Card(accent: Theme.warning) {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    HStack(spacing: Spacing.sm) {
                        Image(systemName: "person.crop.circle.badge.exclamationmark")
                            .foregroundStyle(Theme.warning)
                        Text("Нет карточки сотрудника")
                            .font(Typography.callout.weight(.medium))
                            .foregroundStyle(Theme.text)
                    }

                    Text("Смены этого человека открываются без хозяина, а подтверждения регламентов не сохраняются — они привязаны к карточке.")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textMuted)
                        .fixedSize(horizontal: false, vertical: true)

                    if let linkError {
                        Text(linkError)
                            .font(Typography.caption)
                            .foregroundStyle(Theme.negative)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    if canLink {
                        Button {
                            Task { await link() }
                        } label: {
                            if isLinking {
                                ProgressView().controlSize(.small)
                            } else {
                                Text("Завести карточку")
                            }
                        }
                        .buttonStyle(SecondaryButtonStyle())
                        .disabled(isLinking)

                        Text("Заведём минимальную: имя и должность. Оклад и роль — это уже повышение, оно отдельно.")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }

    private func link() async {
        isLinking = true
        linkError = nil
        defer { isLinking = false }

        do {
            try await BusinessService(api: api).linkOperatorToStaff(operatorID: person.id)
            await store.loadTeam()
        } catch let error as APIError {
            linkError = error.userMessage
        } catch {
            linkError = error.localizedDescription
        }
    }

    /// Доступ оператора.
    ///
    /// Человек уволился в середине смены — вход надо закрыть сразу, а не
    /// «когда дойду до сайта». Это не удаление: смены, выручка и ведомости
    /// остаются, иначе рассыпалась бы отчётность за прошлые недели.
    private var accessCard: some View {
        Card(accent: person.isActive ? nil : Theme.warning) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader(
                    person.isActive ? "Доступ открыт" : "Доступ закрыт",
                    subtitle: person.isActive
                        ? "Может входить в программу точки и в приложение"
                        : "Войти не может. Смены и выплаты сохранены"
                )

                if let toggleError {
                    Text(toggleError)
                        .font(Typography.caption)
                        .foregroundStyle(Theme.negative)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if canDismiss {
                    // Решение принимают на месте, а оформляют «когда дойду до
                    // компьютера» — и всё это время у уволенного открыт вход.
                    Button {
                        dismissing = true
                    } label: {
                        Label(
                            person.isActive ? "Уволить" : "Восстановить",
                            systemImage: person.isActive ? "person.badge.minus" : "person.badge.plus"
                        )
                    }
                    .buttonStyle(person.isActive ? AnyButtonStyle(DestructiveButtonStyle()) : AnyButtonStyle(SecondaryButtonStyle()))
                }

                if canReset {
                    // Пароль забывают перед сменой — сбрасывать его надо там
                    // же, где стоит человек.
                    Button {
                        resetting = true
                    } label: {
                        Label("Сбросить пароль", systemImage: "key")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }

                if canToggle {
                Button {
                    confirmingToggle = true
                } label: {
                    if isToggling {
                        ProgressView().controlSize(.small)
                    } else {
                        Label(
                            person.isActive ? "Закрыть доступ" : "Открыть доступ",
                            systemImage: person.isActive ? "lock" : "lock.open"
                        )
                    }
                }
                .buttonStyle(person.isActive ? AnyButtonStyle(DestructiveButtonStyle()) : AnyButtonStyle(SecondaryButtonStyle()))
                .disabled(isToggling)
                }
            }
        }
        .sheet(isPresented: $resetting) {
            ResetPasswordSheet(person: person) { await store.loadTeam() }
        }
        .sheet(isPresented: $dismissing) {
            DismissSheet(
                kind: "operator",
                personID: person.id,
                personName: person.displayName,
                isDismissed: !person.isActive
            ) {
                await store.loadTeam()
            }
        }
        .alert(
            person.isActive ? "Закрыть доступ?" : "Открыть доступ?",
            isPresented: $confirmingToggle
        ) {
            Button(person.isActive ? "Закрыть" : "Открыть", role: person.isActive ? .destructive : nil) {
                Task { await toggle() }
            }
            Button("Отмена", role: .cancel) {}
        } message: {
            Text(person.isActive
                ? "\(person.name) не сможет войти ни в программу точки, ни в приложение. Смены и выплаты останутся."
                : "\(person.name) снова сможет входить под своим логином.")
        }
    }

    private func toggle() async {
        isToggling = true
        toggleError = nil
        defer { isToggling = false }

        do {
            try await BusinessService(api: api).setOperatorActive(
                operatorID: person.id,
                isActive: !person.isActive
            )
            Haptics.success()
            await store.loadTeam()
        } catch let error as APIError {
            Haptics.error()
            toggleError = error.userMessage
        } catch {
            Haptics.error()
            toggleError = error.localizedDescription
        }
    }

    private var header: some View {
        Card {
            HStack(spacing: Spacing.lg) {
                OperatorAvatar(person: person, size: 64)

                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text(person.displayName)
                        .font(Typography.title)
                        .foregroundStyle(Theme.text)
                    Text(person.position ?? "Оператор")
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textMuted)
                    HStack(spacing: Spacing.sm) {
                        StatusChip(person.isActive ? "работает" : "не работает", kind: person.isActive ? .good : .neutral)
                        if person.hasTelegram {
                            StatusChip("telegram", kind: .info)
                        }
                    }
                }

                Spacer()
            }
        }
    }

    private var contacts: some View {
        Card {
            VStack(spacing: Spacing.md) {
                SectionHeader("Данные")

                if let phone = person.phone, !phone.isEmpty {
                    StatRow("Телефон", value: phone, icon: "phone")
                }
                if let username = person.username, !username.isEmpty {
                    StatRow("Логин", value: username, icon: "person.badge.key")
                }
                if let hire = person.hireDate {
                    StatRow("Принят", value: hire.formatted(.dateTime.day().month(.wide).year()), icon: "calendar.badge.plus")
                }
                if let last = person.lastLogin {
                    StatRow("Был в системе", value: last.formatted(.dateTime.day().month(.abbreviated).hour().minute()), icon: "clock")
                }
                if person.stats.totalBonuses > 0 {
                    RowDivider()
                    StatRow("Бонусы за 30 дней", value: Money.format(person.stats.totalBonuses), valueColor: Theme.positive, icon: "gift")
                }
            }
        }
    }
}

// ── Зарплата ─────────────────────────────────────────────────────────────────

/// Зарплата за неделю: итоги, кто сколько получит, что уже выплачено.
///
/// Неделя переключается стрелками, а не календарём: зарплатный цикл здесь
/// недельный, и выбор произвольной даты сервер всё равно отвергает.
struct SalaryScreen: View {
    @Environment(BusinessStore.self) private var store
    @Environment(\.surface) private var surface
    @Environment(AuthStore.self) private var auth

    /// Кому выдаём аванс. Лист открывается по строке оператора.
    @State private var advanceRow: SalaryRow?
    /// Кому из окладных сотрудников платим или начисляем.
    @State private var staffRow: StaffSalaryRow?

    /// Деньги по оператору: аванс, премия, штраф, погашение долга. Строка
    /// открывается, если разрешено хотя бы одно из них.
    private var canAdvance: Bool {
        guard let resolver = auth.resolver else { return false }
        return resolver.can("salary.create_advance")
            || resolver.can("salary.create_adjustment")
            || resolver.can("salary.mark_debt_paid")
    }

    /// Деньги по окладному сотруднику: выплата или корректировка. Строка
    /// открывается, если разрешено хотя бы одно из них.
    private var canPayStaff: Bool {
        guard let resolver = auth.resolver else { return false }
        return resolver.can("salary.create_payment") || resolver.can("salary.create_adjustment")
    }

    var body: some View {
        @Bindable var bindable = store

        return ScreenScroll {
            VStack(spacing: Spacing.lg) {
                WeekStepper(week: $bindable.salaryWeek)

                if let error = store.salaryError, store.salary == nil {
                    ErrorStateView(error: error) { Task { await store.loadSalary() } }
                } else if let report = store.salary {
                    content(report)
                } else {
                    VStack(spacing: Spacing.lg) {
                        Skeleton(height: 96, cornerRadius: Radius.lg)
                        Skeleton(height: 260, cornerRadius: Radius.lg)
                    }
                }
            }
        }
        .background(Theme.background)
        .navigationTitle("Зарплата")
        .toolbar { LogoutToolbarItem() }
        .task {
            await store.loadSalary()
            await store.loadStaffSalary()
        }
        .refreshable {
            await store.loadSalary()
            await store.loadStaffSalary()
        }
        .sheet(item: $staffRow) { row in
            StaffSalarySheet(row: row) {
                await store.loadStaffSalary()
            }
        }
        .sheet(item: $advanceRow) { row in
            AdvanceSheet(
                row: row,
                weekStart: store.salary?.weekStart ?? store.salaryWeek,
                weekEnd: store.salary?.weekEnd ?? store.salaryWeek
            ) {
                await store.loadSalary()
            }
        }
    }

    // ── Содержимое ───────────────────────────────────────────────────────────

    @ViewBuilder
    private func content(_ report: SalaryWeekReport) -> some View {
        let totals = report.totals

        VStack(spacing: Spacing.lg) {
            DashboardGrid {
                MetricTile(
                    label: "К выплате",
                    value: Money.format(totals.netAmount),
                    icon: "wallet.bifold.fill",
                    accent: Theme.brand
                )
                MetricTile(
                    label: "Выплачено",
                    value: Money.format(totals.paidAmount),
                    icon: "checkmark.circle.fill",
                    accent: Theme.positive
                )
                MetricTile(
                    label: "Осталось",
                    value: Money.format(totals.remainingAmount),
                    icon: "hourglass",
                    accent: totals.remainingAmount > 0 ? Theme.warning : Theme.positive
                )
                MetricTile(
                    label: "Рассчитано",
                    value: "\(totals.paidOperators) из \(totals.activeOperators)",
                    icon: "person.2.fill",
                    accent: Theme.info
                )
            }

            SplitDashboard {
                payroll(report)
            } side: {
                breakdown(totals)
                progress(totals)
            }

            adminStaff
        }
    }

    /// Админ-состав: бухгалтер, техник, управляющий.
    ///
    /// Их в недельной ведомости нет и быть не может — они получают оклад, а не
    /// по сменам, и сервер отдаёт их отдельным запросом. Но в вопросе «сколько
    /// я должен людям в этом месяце» они такая же половина ответа, поэтому
    /// стоят на том же экране, а не спрятаны в другом разделе.
    @ViewBuilder
    private var adminStaff: some View {
        if let summary = store.staffSalary, !summary.rows.isEmpty {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader(
                        summary.selfOnly ? "Моя зарплата" : "Административный состав",
                        subtitle: summary.isFirstHalf ? "выплата до 15-го" : "выплата после 15-го"
                    )

                    ForEach(Array(summary.rows.enumerated()), id: \.element.id) { index, row in
                        if index > 0 { RowDivider() }
                        // Строка из списка операторов — витрина: у неё нет ни
                        // оклада, ни своей записи в staff, и сервер откажет.
                        if canPayStaff && !row.isFromOperator {
                            Button {
                                staffRow = row
                            } label: {
                                StaffSalaryRowView(row: row)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.pressable)
                        } else {
                            StaffSalaryRowView(row: row)
                        }
                    }

                    if !summary.selfOnly && summary.rows.count > 1 {
                        RowDivider()
                        StatRow(
                            "Итого к выплате",
                            value: Money.format(summary.toPayTotal),
                            emphasized: true
                        )
                    }
                }
            }
        } else if store.staffSalaryError != nil, store.staffSalary == nil {
            // Молча: недельная ведомость на экране уже есть, и ронять её из-за
            // второго запроса незачем. Потянем снова при следующем обновлении.
            EmptyView()
        }
    }

    /// Кто сколько получит.
    private func payroll(_ report: SalaryWeekReport) -> some View {
        // Пустые строки скрываем: в списке операторов есть люди, которые на
        // этой неделе не работали, и нули среди сумм только мешают.
        let rows = report.operators.filter(\.hasActivity)

        return Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Начисления", subtitle: "\(rows.count) \(pluralize(rows.count, "человек", "человека", "человек"))")

                if rows.isEmpty {
                    InlineEmpty(icon: "moon.zzz", text: "На этой неделе начислений нет", tint: Theme.textDim)
                } else {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                        if index > 0 { RowDivider() }
                        if canAdvance {
                            // Строка ведёт к авансу: другого действия у неё
                            // нет, и прятать его за меню незачем.
                            Button {
                                advanceRow = row
                            } label: {
                                SalaryRowView(row: row)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.pressable)
                        } else {
                            SalaryRowView(row: row)
                        }
                    }
                }
            }
        }
    }

    /// Из чего складывается сумма.
    private func breakdown(_ totals: SalaryTotals) -> some View {
        Card {
            VStack(spacing: Spacing.md) {
                SectionHeader("Из чего складывается")

                StatRow("Начислено", value: Money.format(totals.grossAmount), icon: "plus.circle")
                if totals.bonusAmount > 0 {
                    StatRow("Бонусы", value: Money.signed(totals.bonusAmount), valueColor: Theme.positive, icon: "gift")
                }
                if totals.fineAmount > 0 {
                    StatRow("Штрафы", value: Money.signed(-totals.fineAmount), valueColor: Theme.negative, icon: "exclamationmark.triangle")
                }
                if totals.debtAmount > 0 {
                    StatRow("Долги", value: Money.signed(-totals.debtAmount), valueColor: Theme.negative, icon: "creditcard")
                }
                RowDivider()
                StatRow("Итого к выплате", value: Money.format(totals.netAmount), emphasized: true)
            }
        }
    }

    /// Насколько неделя закрыта деньгами.
    private func progress(_ totals: SalaryTotals) -> some View {
        let ratio = totals.netAmount > 0 ? min(totals.paidAmount / totals.netAmount, 1) : 0

        return Card {
            VStack(spacing: Spacing.md) {
                SectionHeader("Выплаты")
                ProgressRing(
                    progress: ratio,
                    label: Percent.format(ratio * 100),
                    caption: "выплачено",
                    color: ratio >= 1 ? Theme.positive : Theme.brand
                )
                .frame(maxWidth: .infinity)
            }
        }
    }
}

/// Строка админ-сотрудника: оклад пополам, что прибавили и что удержали.
///
/// У оператора в строке смены — у окладного сотрудника их нет, и вместо них
/// показываем, из чего вышла сумма: половина оклада, бонусы, штрафы, долги,
/// авансы. Иначе цифра «к выплате» ничем не объяснена, а спорят именно о ней.
struct StaffSalaryRowView: View {
    let row: StaffSalaryRow

    /// Что изменило половину оклада. Пустые строки не показываем: ноль
    /// штрафов — не новость.
    private var deltas: [(String, Double, Color)] {
        var result: [(String, Double, Color)] = []
        if row.bonuses > 0.01 { result.append(("бонусы", row.bonuses, Theme.positive)) }
        if row.fines > 0.01 { result.append(("штрафы", -row.fines, Theme.negative)) }
        if row.debts > 0.01 { result.append(("долги", -row.debts, Theme.negative)) }
        if row.advances > 0.01 { result.append(("авансы", -row.advances, Theme.warning)) }
        return result
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(spacing: Spacing.md) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(row.name)
                        .font(Typography.callout)
                        .foregroundStyle(row.isActive ? Theme.text : Theme.textDim)
                        .lineLimit(1)
                    Text(subtitle)
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                        .lineLimit(1)
                }

                Spacer(minLength: Spacing.sm)

                VStack(alignment: .trailing, spacing: 2) {
                    Text(Money.format(row.toPay))
                        .font(Typography.callout.weight(.medium))
                        .monospacedDigit()
                        .foregroundStyle(Theme.text)
                    if row.paidThisMonth > 0.01 {
                        Text("выплачено \(Money.format(row.paidThisMonth))")
                            .font(Typography.caption)
                            .monospacedDigit()
                            .foregroundStyle(Theme.textDim)
                    }
                }

                if !row.isActive {
                    StatusChip("Уволен", kind: .warning)
                } else if row.monthClosed {
                    StatusChip("Месяц закрыт", kind: .good)
                }
            }

            if !deltas.isEmpty {
                HStack(spacing: Spacing.sm) {
                    ForEach(deltas, id: \.0) { label, amount, color in
                        Text("\(label) \(Money.signed(amount))")
                            .font(Typography.caption)
                            .monospacedDigit()
                            .foregroundStyle(color)
                    }
                }
            }
        }
    }

    private var subtitle: String {
        // Строка, собранная из оператора-админа, оклада не имеет: показывать
        // «0 ₸/мес» значило бы соврать, что человек работает бесплатно.
        if row.isFromOperator { return "из списка операторов" }
        if let date = row.dismissalDate, !row.isActive { return "уволен \(date)" }
        return "оклад \(Money.format(row.monthlySalary))/мес"
    }
}

/// Строка зарплаты: имя, смены, сумма и статус выплаты.
struct SalaryRowView: View {
    let row: SalaryRow

    private var chipKind: StatusChip.Kind {
        switch row.week.status {
        case "paid": .good
        case "partial": .warning
        default: .neutral
        }
    }

    var body: some View {
        HStack(spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: 1) {
                Text(row.operatorName)
                    .font(Typography.callout)
                    .foregroundStyle(row.isActive ? Theme.text : Theme.textDim)
                    .lineLimit(1)
                Text("\(row.week.shiftsCount) \(pluralize(row.week.shiftsCount, "смена", "смены", "смен"))")
                    .font(Typography.caption)
                    .monospacedDigit()
                    .foregroundStyle(Theme.textDim)
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 2) {
                Text(Money.format(row.week.netAmount))
                    .font(Typography.callout.weight(.medium))
                    .monospacedDigit()
                    .foregroundStyle(Theme.text)
                // Остаток показываем только когда он есть: у закрытых недель
                // строка «осталось 0 ₸» — шум.
                if row.week.remainingAmount > 0.01 {
                    Text("осталось \(Money.format(row.week.remainingAmount))")
                        .font(Typography.caption)
                        .monospacedDigit()
                        .foregroundStyle(Theme.warning)
                }
            }

            StatusChip(row.week.statusLabel, kind: chipKind)
        }
    }
}
