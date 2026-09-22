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
            OperatorAvatar(person: person, size: 42)

            VStack(alignment: .leading, spacing: 1) {
                Text(person.displayName)
                    .font(.system(size: 16, weight: .medium))
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
        if person.photoURL == nil {
            // Без фото — цветной кружок с буквой: у каждого свой цвет, и
            // список не сливается в серую колонку одинаковых кругов.
            PersonInitial(name: person.displayName, isActive: person.isActive, size: size)
        } else {
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

    /// Смена логина и повышение — были только на сайте. Оба решения
    /// принимаются на точке: логин выясняется, когда человек не может войти
    /// перед сменой, а повышение — когда оператор уже месяц работает старшим.
    @State private var loginOpen = false
    @State private var promoteOpen = false

    private var canLink: Bool { access?.can("operators.edit") ?? false }
    private var canEditLogin: Bool { access?.can("operators.edit_login") ?? false }
    private var canPromote: Bool { access?.can("operators.promote") ?? false }

    var body: some View {
        ScreenScroll {
            VStack(spacing: Spacing.lg) {
                header

                // Цифры за 30 дней — одной карточкой: оборот главный, смены,
                // средний чек смены и долги — его расшифровка. Четыре равные
                // плитки заставляли искать, что тут важнее.
                HeroSummary(
                    title: "Оборот за 30 дней",
                    value: Money.format(person.stats.totalTurnover),
                    caption: person.stats.totalBonuses > 0
                        ? "бонусы \(Money.format(person.stats.totalBonuses))"
                        : nil,
                    footer: [
                        ("Смен", "\(person.stats.totalShifts)"),
                        ("За смену", Money.format(person.stats.avgPerShift)),
                        ("Долги", Money.format(person.stats.totalDebts)),
                    ],
                    colors: person.isActive
                        ? [Color(hex: 0x4F46E5), Color(hex: 0x7C3AED)]
                        : [Color(hex: 0x64748B), Color(hex: 0x475569)]
                )

                staffLinkCard

                if canToggle || canReset || canEditLogin || canPromote { accessCard }

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
        OwnerSection(person.isActive ? "Доступ открыт" : "Доступ закрыт") {
            Text(person.isActive ? "может входить" : "вход закрыт")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(person.isActive ? Theme.positive : Theme.warning)
        } content: {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Text(person.isActive
                    ? "Может входить в программу точки и в приложение"
                    : "Войти не может. Смены и выплаты сохранены")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
                    .fixedSize(horizontal: false, vertical: true)

                if let toggleError {
                    Text(toggleError)
                        .font(Typography.caption)
                        .foregroundStyle(Theme.negative)
                        .fixedSize(horizontal: false, vertical: true)
                }

                // Действия строками с иконкой в кружке, как в профиле банка:
                // пять кнопок одинаковой ширины друг под другом читались как
                // форма, а не как меню человека.
                if canDismiss {
                    // Решение принимают на месте, а оформляют «когда дойду до
                    // компьютера» — и всё это время у уволенного открыт вход.
                    Button {
                        dismissing = true
                    } label: {
                        OperatorActionRow(
                            icon: person.isActive ? "person.badge.minus" : "person.badge.plus",
                            title: person.isActive ? "Уволить" : "Восстановить",
                            tint: person.isActive ? Theme.negative : Theme.positive
                        )
                    }
                    .buttonStyle(.pressable)
                }

                if canReset {
                    // Пароль забывают перед сменой — сбрасывать его надо там
                    // же, где стоит человек.
                    Button {
                        resetting = true
                    } label: {
                        OperatorActionRow(icon: "key", title: "Сбросить пароль", tint: Color(hex: 0xF59E0B))
                    }
                    .buttonStyle(.pressable)
                }

                if canEditLogin {
                    Button {
                        loginOpen = true
                    } label: {
                        OperatorActionRow(icon: "person.text.rectangle", title: "Изменить логин", tint: Color(hex: 0x3B82F6))
                    }
                    .buttonStyle(.pressable)
                }

                if canPromote {
                    Button {
                        promoteOpen = true
                    } label: {
                        OperatorActionRow(icon: "arrow.up.circle", title: "Повысить в должности", tint: Color(hex: 0x8B5CF6))
                    }
                    .buttonStyle(.pressable)
                }

                if canToggle {
                    Button {
                        confirmingToggle = true
                    } label: {
                        OperatorActionRow(
                            icon: person.isActive ? "lock" : "lock.open",
                            title: person.isActive ? "Закрыть доступ" : "Открыть доступ",
                            tint: person.isActive ? Theme.negative : Theme.positive,
                            isLoading: isToggling
                        )
                    }
                    .buttonStyle(.pressable)
                    .disabled(isToggling)
                }
            }
        }
        .sheet(isPresented: $resetting) {
            ResetPasswordSheet(person: person) { await store.loadTeam() }
        }
        .sheet(isPresented: $loginOpen) {
            OperatorLoginSheet(person: person) { await store.loadTeam() }
        }
        .sheet(isPresented: $promoteOpen) {
            PromoteOperatorSheet(person: person) { await store.loadTeam() }
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

    /// Шапка как профиль в банке: крупный аватар по центру, имя, должность
    /// и статус мелким цветным текстом — плашки съедали строку.
    private var header: some View {
        VStack(spacing: Spacing.sm) {
            OperatorAvatar(person: person, size: 84)
            Text(person.displayName)
                .font(.system(size: 24, weight: .bold, design: .rounded))
                .foregroundStyle(Theme.text)
                .multilineTextAlignment(.center)
            Text(person.position ?? "Оператор")
                .font(.system(size: 15))
                .foregroundStyle(Theme.textMuted)
            HStack(spacing: Spacing.md) {
                Label(person.isActive ? "работает" : "не работает", systemImage: person.isActive ? "checkmark.circle.fill" : "circle.fill")
                    .foregroundStyle(person.isActive ? Theme.positive : Theme.textDim)
                if person.hasTelegram {
                    Label("telegram", systemImage: "paperplane.fill")
                        .foregroundStyle(Theme.info)
                }
            }
            .font(.system(size: 13, weight: .semibold))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Spacing.md)
    }

    private var contacts: some View {
        OwnerSection("Данные") {
            VStack(spacing: Spacing.sm) {
                if let phone = person.phone, !phone.isEmpty {
                    OperatorInfoRow(icon: "phone", tint: Color(hex: 0x10B981), label: "Телефон", value: phone)
                }
                if let username = person.username, !username.isEmpty {
                    OperatorInfoRow(icon: "person.badge.key", tint: Color(hex: 0x3B82F6), label: "Логин", value: username)
                }
                if let hire = person.hireDate {
                    OperatorInfoRow(icon: "calendar.badge.plus", tint: Color(hex: 0x8B5CF6), label: "Принят", value: hire.formatted(.dateTime.day().month(.wide).year()))
                }
                if let last = person.lastLogin {
                    OperatorInfoRow(icon: "clock", tint: Color(hex: 0x14B8A6), label: "Был в системе", value: last.formatted(.dateTime.day().month(.abbreviated).hour().minute()))
                }
                if person.stats.totalBonuses > 0 {
                    OperatorInfoRow(icon: "gift", tint: Color(hex: 0xF59E0B), label: "Бонусы за 30 дней", value: Money.format(person.stats.totalBonuses), valueColor: Theme.positive)
                }
            }
        }
    }
}

/// Действие в карточке человека: иконка в кружке, название, шеврон.
/// Пока запрос идёт, вместо шеврона крутится индикатор — кнопка не прыгает.
private struct OperatorActionRow: View {
    let icon: String
    let title: String
    let tint: Color
    var isLoading = false

    var body: some View {
        HStack(spacing: Spacing.md) {
            TintedIcon(systemName: icon, tint: tint)
            Text(title)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(tint == Theme.negative ? Theme.negative : Theme.text)
            Spacer(minLength: Spacing.sm)
            if isLoading {
                ProgressView().controlSize(.small)
            } else {
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.textDim)
            }
        }
        .padding(.vertical, Spacing.xs)
        .contentShape(Rectangle())
    }
}

/// Строка данных профиля: иконка в кружке, подпись серым, значение справа.
private struct OperatorInfoRow: View {
    let icon: String
    let tint: Color
    let label: String
    let value: String
    var valueColor: Color = Theme.text

    var body: some View {
        HStack(spacing: Spacing.md) {
            TintedIcon(systemName: icon, tint: tint, size: 36)
            Text(label)
                .font(.system(size: 15))
                .foregroundStyle(Theme.textMuted)
            Spacer(minLength: Spacing.sm)
            Text(value)
                .font(.system(size: 15, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(valueColor)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
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
            SalaryHero(totals: totals)

            SplitDashboard {
                payroll(report)
            } side: {
                breakdown(totals)
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
                PersonInitial(name: row.name, isActive: row.isActive)
                VStack(alignment: .leading, spacing: 1) {
                    Text(row.name)
                        .font(.system(size: 16, weight: .medium))
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
                        .font(.system(size: 16, weight: .semibold, design: .rounded))
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
        let salary = "оклад \(Money.format(row.monthlySalary))/мес"
        // Доп. выходы — то, чем месяц одного окладника отличается от месяца
        // другого. В ведомости это первое, о чём спрашивают.
        guard !row.extraDays.isEmpty else { return salary }
        return "\(salary) · \(row.extraDays.count) \(pluralize(row.extraDays.count, "доп. выход", "доп. выхода", "доп. выходов"))"
    }
}

/// Кружок с первой буквой имени — у человека в списке есть «лицо».
struct PersonInitial: View {
    let name: String
    var isActive = true
    var size: CGFloat = 40

    private static let palette: [Color] = [
        Color(hex: 0x10B981), Color(hex: 0x3B82F6), Color(hex: 0xF59E0B),
        Color(hex: 0x8B5CF6), Color(hex: 0xEC4899), Color(hex: 0x14B8A6),
    ]

    var body: some View {
        // Цвет закреплён за именем: у одного человека он один на всех экранах.
        let hash = name.unicodeScalars.reduce(0) { ($0 &* 31 &+ Int($1.value)) & 0x7FFFFFFF }
        let tint = isActive ? Self.palette[hash % Self.palette.count] : Theme.textDim
        Text(String(name.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased())
            .font(.system(size: size * 0.4, weight: .bold, design: .rounded))
            .foregroundStyle(tint)
            .frame(width: size, height: size)
            .background(tint.opacity(0.14), in: Circle())
    }
}

/// Главная цифра зарплаты: сколько отдать за неделю и сколько уже отдано.
struct SalaryHero: View {
    let totals: SalaryTotals

    var body: some View {
        let ratio = totals.netAmount > 0 ? min(max(totals.paidAmount / totals.netAmount, 0), 1) : 0
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text("К выплате за неделю")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(.white.opacity(0.85))
            Text(Money.format(totals.netAmount))
                .font(.system(size: 36, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            VStack(alignment: .leading, spacing: 6) {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(.white.opacity(0.25))
                        Capsule().fill(.white).frame(width: max(6, geo.size.width * ratio))
                    }
                }
                .frame(height: 8)
                Text("выплачено \(Money.format(totals.paidAmount)) · \(Percent.format(ratio * 100))")
                    .font(.system(size: 13, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(.white.opacity(0.85))
            }
            HStack(spacing: Spacing.xl) {
                footer("Осталось", Money.format(totals.remainingAmount))
                footer("Рассчитано", "\(totals.paidOperators) из \(totals.activeOperators)")
            }
        }
        .padding(Spacing.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(colors: [Color(hex: 0x2563EB), Color(hex: 0x7C3AED)], startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: 28, style: .continuous)
        )
    }

    private func footer(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.system(size: 12))
                .foregroundStyle(.white.opacity(0.7))
            Text(value)
                .font(.system(size: 16, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(.white)
        }
    }
}

/// Строка зарплаты: имя, смены, сумма и статус выплаты.
struct SalaryRowView: View {
    let row: SalaryRow

    var body: some View {
        HStack(spacing: Spacing.md) {
            PersonInitial(name: row.operatorName, isActive: row.isActive)
            VStack(alignment: .leading, spacing: 1) {
                Text(row.operatorName)
                    .font(.system(size: 16, weight: .medium))
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
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                    .fixedSize()
                // Статус — подписью под суммой, а не плашкой: плашка съедала
                // полстроки, и имя обрезалось до трёх букв.
                Text(statusText)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(statusColor)
                    .lineLimit(1)
                    .fixedSize()
            }
        }
        .padding(.vertical, Spacing.xs)
    }

    private var statusText: String {
        if row.week.status == "partial", row.week.remainingAmount > 0.01 {
            return "осталось \(Money.format(row.week.remainingAmount))"
        }
        return row.week.statusLabel.lowercased()
    }

    private var statusColor: Color {
        switch row.week.status {
        case "paid": Theme.positive
        case "partial": Theme.warning
        default: Theme.textDim
        }
    }
}


/// Смена логина оператора.
///
/// Логин — это то, чем человек входит в программу точки. Меняют его, когда при
/// заведении ошиблись или человек его не помнит; выясняется это перед сменой,
/// а не за ноутбуком, — поэтому действие и переехало в телефон.
private struct OperatorLoginSheet: View {
    let person: TeamOperator
    let onDone: () async -> Void

    @Environment(\.api) private var api
    @Environment(\.dismiss) private var dismiss

    @State private var username = ""
    @State private var isSaving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScreenScroll {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        SectionHeader(person.displayName, subtitle: "Новый логин для входа")

                        TextField("например: aidos", text: $username)
                            .textFieldStyle(.plain)
                            .font(Typography.callout)
                            #if os(iOS)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            #endif

                        Text("Строчные латинские буквы и цифры. Пароль не меняется.")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)

                        if let error {
                            Text(error).font(Typography.caption).foregroundStyle(Theme.negative)
                        }

                        Button(isSaving ? "Сохраняем…" : "Сохранить логин") {
                            Task { await save() }
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(isSaving || username.trimmingCharacters(in: .whitespaces).count < 3)
                    }
                }
            }
            .background(Theme.background)
            .navigationTitle("Логин")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } } }
        }
    }

    private func save() async {
        isSaving = true
        defer { isSaving = false }
        do {
            try await BusinessService(api: api).changeOperatorLogin(
                operatorID: person.id,
                username: username.trimmingCharacters(in: .whitespaces).lowercased()
            )
            await onDone()
            dismiss()
        } catch let apiError as APIError {
            error = apiError.userMessage
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Повышение оператора до сотрудника.
///
/// Решение принимают, когда человек уже месяц тянет старшего, — и до сих пор
/// оно ждало ноутбука. Оклад необязателен: если не задан, сервер оставляет
/// прежний расчёт.
private struct PromoteOperatorSheet: View {
    let person: TeamOperator
    let onDone: () async -> Void

    @Environment(\.api) private var api
    @Environment(\.dismiss) private var dismiss

    @State private var role = "other"
    @State private var salary = ""
    @State private var isSaving = false
    @State private var error: String?

    private let roles: [(String, String)] = [
        ("manager", "Управляющий"),
        ("marketer", "Маркетолог"),
        ("other", "Сотрудник"),
    ]

    var body: some View {
        NavigationStack {
            ScreenScroll {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        SectionHeader(person.displayName, subtitle: "Новая должность")

                        PillSegment(
                            options: roles.map { (value: $0.0, title: $0.1) },
                            selection: $role
                        )

                        FieldLabel("Оклад в месяц")
                        TextField("не менять", text: $salary)
                            .textFieldStyle(.plain)
                            .font(Typography.callout)
                            #if os(iOS)
                            .keyboardType(.numberPad)
                            #endif

                        Text("Оператор станет сотрудником: смены и выплаты сохранятся, а доступ будет по должности.")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                            .fixedSize(horizontal: false, vertical: true)

                        if let error {
                            Text(error).font(Typography.caption).foregroundStyle(Theme.negative)
                        }

                        Button(isSaving ? "Оформляем…" : "Повысить") {
                            Task { await save() }
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(isSaving)
                    }
                }
            }
            .background(Theme.background)
            .navigationTitle("Повышение")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } } }
        }
    }

    private func save() async {
        isSaving = true
        defer { isSaving = false }
        let amount = AmountParsing.value(salary)
        do {
            try await BusinessService(api: api).promoteOperator(
                operatorID: person.id,
                role: role,
                monthlySalary: amount > 0 ? amount : nil
            )
            await onDone()
            dismiss()
        } catch let apiError as APIError {
            error = apiError.userMessage
        } catch {
            self.error = error.localizedDescription
        }
    }
}
