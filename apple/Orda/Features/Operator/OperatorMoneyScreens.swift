import OrdaKit
import OrdaUI
import SwiftUI

// ── Деньги ───────────────────────────────────────────────────────────────────

/// Зарплата за неделю: из чего сложилась, что уже выплачено, что удержано.
struct MoneyScreen: View {
    @Environment(CabinetStore.self) private var cabinet

    /// Какие недели долга раскрыты в общем списке.
    @State private var expandedDebtWeeks: Set<String> = []
    /// Открыт список всех непогашенных долгов.
    @State private var showingAllDebts = false

    var body: some View {
        ScreenScroll {
            // Переключатель недель: «сколько я заработала в прошлом месяце»
            // посмотреть было негде — экран всегда показывал текущую.
            weekStepper

            if let week = cabinet.salary?.week ?? cabinet.overview?.week {
                heroCard(week)

                SplitDashboard {
                    breakdownCard(week)
                    shiftsCard
                    // Пустой график хуже отсутствия: рамка с подписями дней и
                    // без столбцов читается как поломка.
                    if hasShiftAmounts {
                        CategoryBarChart(title: "Смены недели", points: shiftPoints)
                    }
                } side: {
                    debtsCard
                    incidentsCard
                }
            } else {
                Skeleton(height: 140, cornerRadius: Radius.lg)
            }
        }
        .sheet(isPresented: $showingAllDebts) {
            AllDebtsSheet(
                weeks: MoneyScreen.groupByWeek(
                    (cabinet.overview?.recentDebts ?? []).filter { $0.amount > 0 }
                ),
                currentWeek: cabinet.salaryWeek
            )
        }
        .navigationTitle("Мои деньги")
        .toolbar { LogoutToolbarItem() }
        .task {
            if cabinet.salary == nil { await cabinet.loadSalary() }
            if cabinet.incidents.isEmpty { await cabinet.loadIncidents() }
        }
        .refreshable {
            await cabinet.loadSalary()
            await cabinet.loadIncidents()
            await cabinet.loadOverview()
        }
    }

    private func heroCard(_ week: SalaryWeek) -> some View {
        Card(accent: Theme.brand) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                HStack {
                    Text("К выплате за неделю")
                        .font(Typography.label)
                        .foregroundStyle(Theme.textDim)
                        .textCase(.uppercase)
                    Spacer()
                    StatusChip(week.statusLabel, kind: week.status == "paid" ? .good : .neutral)
                }

                Text(Money.format(week.netAmount))
                    .font(Typography.monospacedDigits(Typography.hero))
                    .foregroundStyle(Theme.text)
                    .contentTransition(.numericText())
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)

                if let start = week.weekStart, let end = week.weekEnd {
                    Text("\(shortDate(start)) — \(shortDate(end))")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                }

                if week.paidAmount > 0 {
                    SplitBar(segments: [
                        .init(label: "Выплачено", value: week.paidAmount, color: ChartPalette.series1),
                        .init(label: "Остаток", value: max(week.remainingAmount, 0), color: ChartPalette.series2),
                    ])
                }
            }
        }
    }

    private func breakdownCard(_ week: SalaryWeek) -> some View {
        Card {
            VStack(spacing: Spacing.md) {
                Text("Из чего сложилось")
                    .font(Typography.label)
                    .foregroundStyle(Theme.textDim)
                    .textCase(.uppercase)
                    .frame(maxWidth: .infinity, alignment: .leading)

                StatRow("Начислено за смены", value: Money.format(week.grossAmount), icon: "calendar")
                if week.seniorityBonusTotal > 0 {
                    // Стаж уже внутри начисления за смены — показываем
                    // справочно, отдельной суммой к итогу не идёт.
                    StatRow(
                        "· из них надбавка за стаж",
                        value: Money.format(week.seniorityBonusTotal),
                        valueColor: Theme.textMuted
                    )
                }
                if week.autoBonusTotal > 0 {
                    // Автобонус считают правила точки. Его отсутствие на экране
                    // и ломало арифметику: строки не сходились с итогом.
                    StatRow(
                        "Бонусы за смены",
                        value: Money.signed(week.autoBonusTotal),
                        valueColor: Theme.positive,
                        icon: "sparkles"
                    )
                }
                if week.bonusAmount > 0 {
                    StatRow("Бонусы", value: Money.signed(week.bonusAmount), valueColor: Theme.positive, icon: "plus.circle")
                }
                if week.fineAmount > 0 {
                    StatRow("Штрафы", value: Money.signed(-week.fineAmount), valueColor: Theme.negative, icon: "minus.circle")
                }
                if week.advanceAmount > 0 {
                    StatRow("Аванс", value: Money.signed(-week.advanceAmount), valueColor: Theme.warning, icon: "arrow.down.circle")
                }
                if week.debtAmount > 0 {
                    StatRow("Удержано в счёт долга", value: Money.signed(-week.debtAmount), valueColor: Theme.negative, icon: "creditcard")
                }

                // Если сервер добавит составляющую, о которой приложение ещё
                // не знает, разница окажется здесь. Строка «прочее» честнее,
                // чем цифры, которые на экране не сходятся.
                if abs(week.unexplainedAmount) >= 1 {
                    StatRow(
                        week.unexplainedAmount > 0 ? "Прочие начисления" : "Прочие удержания",
                        value: Money.signed(week.unexplainedAmount),
                        valueColor: week.unexplainedAmount > 0 ? Theme.positive : Theme.negative,
                        icon: "questionmark.circle"
                    )
                }

                RowDivider()
                StatRow("Итого к выплате", value: Money.format(week.netAmount), emphasized: true)
            }
        }
    }

    /// За что начислено — по сменам.
    ///
    /// Раньше на экране была одна строка «начислено за смены» общей суммой:
    /// сколько дала конкретная ночь и почему у соседней смены вышло больше,
    /// понять было нельзя. Спор с управляющим начинался ровно отсюда.
    @ViewBuilder
    private var shiftsCard: some View {
        let shifts = cabinet.salary?.shifts.filter { $0.salary > 0 } ?? []
        if !shifts.isEmpty {
            Card {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    SectionHeader(
                        "За что начислено",
                        subtitle: "\(shifts.count) \(pluralize(shifts.count, "смена", "смены", "смен"))"
                    )

                    ForEach(Array(shifts.enumerated()), id: \.element.id) { index, shift in
                        if index > 0 { RowDivider() }
                        SalaryShiftRow(shift: shift)
                    }
                }
            }
        }
    }

    /// Есть ли что показывать: суммы по сменам могут прийти нулями, и тогда
    /// столбцов не будет вовсе.
    private var hasShiftAmounts: Bool {
        shiftPoints.contains { $0.value > 0 }
    }

    /// Смены недели столбцами. Сегодняшняя выделена — остальные приглушены.
    private var shiftPoints: [CategoryPoint] {
        let today = DateParsing.dateOnlyString(from: Date())
        return (cabinet.salary?.shifts ?? []).map { shift in
            CategoryPoint(
                label: weekdayLabel(shift.date),
                value: shift.amount ?? 0,
                isHighlighted: shift.date == today
            )
        }
    }

    @ViewBuilder
    /// Долг перед точкой — по неделям.
    ///
    /// Долг это не недельная величина, а остаток: непогашенное с прошлых
    /// недель никуда не девается. Но карточка стоит под переключателем недель
    /// и потому читалась как «долг за эту неделю» — поэтому здесь сказано
    /// прямо, что это всё непогашенное, а неделя выбранного периода помечена.
    /// Шаг по неделям. Вперёд дальше текущей не пускаем: там ещё не работали.
    private var weekStepper: some View {
        HStack(spacing: Spacing.sm) {
            Button {
                cabinet.shiftSalaryWeek(by: -1)
            } label: {
                Image(systemName: "chevron.left")
            }
            .buttonStyle(.pressable)

            Spacer()

            VStack(spacing: 2) {
                Text(MoneyScreen.weekTitle(cabinet.salaryWeek))
                    .font(Typography.callout.weight(.semibold))
                    .foregroundStyle(Theme.text)
                if cabinet.salaryWeek == CabinetStore.currentWeekStart() {
                    Text("текущая неделя")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textMuted)
                }
            }

            Spacer()

            Button {
                cabinet.shiftSalaryWeek(by: 1)
            } label: {
                Image(systemName: "chevron.right")
            }
            .buttonStyle(.pressable)
            .disabled(cabinet.salaryWeek >= CabinetStore.currentWeekStart())
            .opacity(cabinet.salaryWeek >= CabinetStore.currentWeekStart() ? 0.35 : 1)
        }
        .padding(.horizontal, Spacing.xs)
    }

    /// Долг выбранной недели.
    ///
    /// Экран про неделю — значит и карточка про неделю: показывать под
    /// переключателем периода долги июля значит спорить с собственной шапкой.
    /// Но и прятать остальное нельзя, это деньги, — поэтому строкой ниже
    /// стоит весь непогашенный остаток и открывается отдельным списком.
    @ViewBuilder
    private var debtsCard: some View {
        let all = (cabinet.overview?.recentDebts ?? []).filter { $0.amount > 0 }
        let week = all.filter { ($0.weekStart ?? "") == cabinet.salaryWeek }
        let weekTotal = week.reduce(0) { $0 + $1.amount }
        let total = all.reduce(0) { $0 + $1.amount }
        let rest = total - weekTotal

        if !all.isEmpty {
            Card(accent: week.isEmpty ? nil : Theme.negative) {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    HStack {
                        Text("Долг за неделю")
                            .font(Typography.label)
                            .foregroundStyle(week.isEmpty ? Theme.textDim : Theme.negative)
                            .textCase(.uppercase)
                        Spacer()
                        Text(Money.format(weekTotal))
                            .font(Typography.callout.weight(.semibold))
                            .foregroundStyle(week.isEmpty ? Theme.textMuted : Theme.negative)
                    }

                    if week.isEmpty {
                        Text("За эту неделю долгов нет.")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textMuted)
                    } else {
                        ForEach(week) { debt in
                            HStack(alignment: .top, spacing: Spacing.sm) {
                                Text(MoneyScreen.debtTitle(debt))
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.textDim)
                                    .lineLimit(2)
                                Spacer(minLength: Spacing.sm)
                                Text(Money.format(debt.amount))
                                    .font(Typography.caption.monospacedDigit())
                                    .foregroundStyle(Theme.negative)
                            }
                        }
                    }

                    // Остальное — не за эту неделю, но никуда не делось.
                    if rest > 0 {
                        RowDivider()
                        Button {
                            showingAllDebts = true
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text("Всего непогашено")
                                        .font(Typography.callout)
                                        .foregroundStyle(Theme.textDim)
                                    Text("включая прошлые недели")
                                        .font(Typography.caption)
                                        .foregroundStyle(Theme.textMuted)
                                }
                                Spacer()
                                Text(Money.format(total))
                                    .font(Typography.callout.weight(.semibold).monospacedDigit())
                                    .foregroundStyle(Theme.negative)
                                Image(systemName: "chevron.right")
                                    .font(.caption2.weight(.bold))
                                    .foregroundStyle(Theme.textMuted)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.pressable)
                    }
                }
            }
        }
    }

    /// Короткая подпись записи: первая строка списка, без хвоста.
    static func debtTitle(_ debt: OperatorDebt) -> String {
        let raw = debt.comment ?? debt.companyName ?? "Долг"
        let lines = raw.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }
        guard let first = lines.first, !first.isEmpty else { return "Долг" }
        return lines.count > 1 ? "\(first) и ещё \(lines.count - 1)" : first
    }

    /// Долги, сгруппированные по неделе. Свежие сверху.
    struct DebtWeek: Identifiable {
        let key: String
        let title: String
        let total: Double
        let debts: [OperatorDebt]

        var id: String { key }
    }

    static func groupByWeek(_ debts: [OperatorDebt]) -> [DebtWeek] {
        let grouped = Dictionary(grouping: debts) { $0.weekStart ?? "" }
        return grouped
            .map { key, list in
                DebtWeek(
                    key: key,
                    title: weekTitle(key),
                    total: list.reduce(0) { $0 + $1.amount },
                    debts: list
                )
            }
            .sorted { $0.key > $1.key }
    }

    /// «17 авг. — 23 авг.» Без даты — «Без недели»: такие строки бывают у
    /// старых записей, и прятать их нельзя, это тоже деньги.
    static func weekTitle(_ weekStart: String) -> String {
        guard !weekStart.isEmpty, let start = DateParsing.parseDateOnly(weekStart) else {
            return "Без недели"
        }
        let end = start.addingTimeInterval(6 * 86_400)
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ru_RU")
        formatter.dateFormat = "d MMM"
        return "\(formatter.string(from: start)) — \(formatter.string(from: end))"
    }

    @ViewBuilder
    private var incidentsCard: some View {
        if !cabinet.incidents.isEmpty {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    Text("Штрафы и поощрения")
                        .font(Typography.label)
                        .foregroundStyle(Theme.textDim)
                        .textCase(.uppercase)

                    ForEach(cabinet.incidents.prefix(8)) { incident in
                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            HStack {
                                Text(incident.title ?? (incident.isPenalty ? "Штраф" : "Поощрение"))
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.text)
                                Spacer()
                                if let amount = incident.amount {
                                    Text(Money.signed(incident.isPenalty ? -abs(amount) : abs(amount)))
                                        .font(Typography.callout.weight(.semibold))
                                        .monospacedDigit()
                                        .foregroundStyle(incident.isPenalty ? Theme.negative : Theme.positive)
                                }
                            }
                            if let description = incident.description, !description.isEmpty {
                                Text(description)
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.textDim)
                                    .lineLimit(2)
                            }
                        }
                    }
                }
            }
        }
    }

    private func shortDate(_ iso: String) -> String {
        guard let date = DateParsing.parseDateOnly(iso) else { return iso }
        return date.formatted(.dateTime.day().month(.abbreviated))
    }

    private func weekdayLabel(_ iso: String) -> String {
        guard let date = DateParsing.parseDateOnly(iso) else { return iso }
        return date.formatted(.dateTime.weekday(.abbreviated))
    }
}

// ── Профиль ──────────────────────────────────────────────────────────────────

/// Куда ведут пункты профиля.
///
/// По значению, а не замыканием с готовым экраном. Замыкание пересоздаётся на
/// каждое обновление экрана — а профиль обновляется сам, когда приходит число
/// непрочитанных, — и свежий переход схлопывался обратно: «с первого раза не
/// открывается, со второго открывается».
enum OperatorProfileRoute: Hashable {
    case schedule, money, salesQuality, knowledge, exams, chat, messages, pointQR
    /// Ревизия и чек-листы ушли из нижней панели — но не из приложения.
    case audit, checklists
}

struct OperatorProfileScreen: View {
    @Environment(AuthStore.self) private var auth

    /// Торгует ли точка: от этого зависит, показывать ли ревизию.
    private var sellsGoods: Bool { cabinet.overview?.points?.sellsGoods ?? true }
    @Environment(OperatorStore.self) private var store
    @Environment(CabinetStore.self) private var cabinet

    @State private var confirmingLogout = false

    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.lg) {
                Card {
                    HStack(spacing: Spacing.lg) {
                        Image(systemName: "person.crop.circle.fill")
                            .font(.system(size: 44))
                            .foregroundStyle(Theme.accent(for: .operator))
                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            Text(cabinet.overview?.operatorName ?? auth.role?.displayName ?? "Оператор")
                                .font(Typography.title)
                                .foregroundStyle(Theme.text)
                            if let label = auth.role?.roleLabel {
                                Text(label)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.textMuted)
                            }
                        }
                        Spacer()
                    }
                }

                Card {
                    VStack(spacing: Spacing.sm) {
                        NavigationLink(value: OperatorProfileRoute.schedule) {
                            NavigationRow(icon: "calendar", iconColor: ChartPalette.series2, title: "Мой график")
                        }
                        .buttonStyle(.pressable)

                        RowDivider()

                        NavigationLink(value: OperatorProfileRoute.money) {
                            NavigationRow(icon: "wallet.bifold", iconColor: Theme.brand, title: "Мои деньги")
                        }
                        .buttonStyle(.pressable)

                        RowDivider()

                        // Оценка работы за прилавком. Стоит рядом с деньгами
                        // намеренно: доплата за качество приходит именно
                        // отсюда, и человек должен видеть, из чего она вышла.
                        NavigationLink(value: OperatorProfileRoute.salesQuality) {
                            NavigationRow(
                                icon: "chart.line.uptrend.xyaxis",
                                iconColor: Theme.positive,
                                title: "Как я работаю",
                                subtitle: "Оценка за месяц и доплата за качество"
                            )
                        }
                        .buttonStyle(.pressable)

                        RowDivider()

                        // Ревизия нужна кассиру магазина, но не каждый день —
                        // поэтому она здесь, а не в панели, где место занимает
                        // постоянно. Оператору клуба она не нужна вовсе: он
                        // ничего не продаёт и остатки не считает.
                        if sellsGoods {
                        NavigationLink(value: OperatorProfileRoute.audit) {
                            NavigationRow(
                                icon: "list.clipboard",
                                iconColor: Theme.info,
                                title: "Ревизия",
                                subtitle: "Пересчёт товара по актам"
                            )
                        }
                        .buttonStyle(.pressable)

                        RowDivider()
                        }

                        NavigationLink(value: OperatorProfileRoute.checklists) {
                            NavigationRow(
                                icon: "checkmark.seal",
                                iconColor: Theme.positive,
                                title: "Чек-листы",
                                subtitle: "Приём, обход, закрытие смены"
                            )
                        }
                        .buttonStyle(.pressable)

                        RowDivider()

                        NavigationLink(value: OperatorProfileRoute.knowledge) {
                            NavigationRow(
                                icon: "book.closed",
                                iconColor: Theme.info,
                                title: "База знаний",
                                badge: cabinet.pendingArticles.count,
                                badgeColor: Theme.info
                            )
                        }
                        .buttonStyle(.pressable)

                        RowDivider()

                        // Экзамен раньше приходил только в Telegram: у кого его
                        // нет, тот числился обязанным сдать то, чего не видел.
                        // Вход на терминал по QR. На пересменке за спиной
                        // очередь, а логин и пароль набираются на общей
                        // клавиатуре у всех на виду.
                        NavigationLink(value: OperatorProfileRoute.pointQR) {
                            NavigationRow(
                                icon: "qrcode.viewfinder",
                                iconColor: Theme.accent(for: .operator),
                                title: "Вход на точке по QR",
                                subtitle: "Подтвердить вход в программу терминала"
                            )
                        }
                        .buttonStyle(.pressable)

                        RowDivider()

                        NavigationLink(value: OperatorProfileRoute.exams) {
                            NavigationRow(
                                icon: "graduationcap",
                                iconColor: Theme.warning,
                                title: "Экзамены",
                                subtitle: "Аттестация по регламентам точки",
                                badge: cabinet.openExams,
                                badgeColor: Theme.warning
                            )
                        }
                        .buttonStyle(.pressable)
                    }
                }

                // Общение. Смена — работа в одиночку у стойки: спросить
                // сменщика, что с должником, или сказать управляющему, что
                // кончилась бумага, раньше можно было только в личном
                // мессенджере, мимо системы и без следа.
                Card {
                    VStack(spacing: Spacing.sm) {
                        NavigationLink(value: OperatorProfileRoute.chat) {
                            NavigationRow(
                                icon: "bubble.left.and.bubble.right",
                                iconColor: Theme.accent(for: .operator),
                                title: "Командный чат",
                                subtitle: "Общий для всей точки"
                            )
                        }
                        .buttonStyle(.pressable)

                        RowDivider()

                        NavigationLink(value: OperatorProfileRoute.messages) {
                            NavigationRow(
                                icon: "envelope",
                                iconColor: ChartPalette.series2,
                                title: "Сообщения",
                                subtitle: "Лично сменщику или управляющему",
                                badge: cabinet.unreadMessages,
                                badgeColor: Theme.info
                            )
                        }
                        .buttonStyle(.pressable)
                    }
                }
                .task { await cabinet.refreshUnreadMessages() }

                if store.queuedSalesCount > 0 || store.queuedActionsCount > 0 {
                    Card(accent: Theme.warning) {
                        VStack(alignment: .leading, spacing: Spacing.md) {
                            if store.queuedSalesCount > 0 {
                                Label(
                                    "\(store.queuedSalesCount) \(pluralize(store.queuedSalesCount, "неотправленный чек", "неотправленных чека", "неотправленных чеков"))",
                                    systemImage: "arrow.triangle.2.circlepath"
                                )
                                .font(Typography.callout.weight(.semibold))
                                .foregroundStyle(Theme.warning)
                            }

                            // Чек-листы и подтверждения считаем отдельно от
                            // чеков: там деньги, здесь работа смены, и «три
                            // чека и два действия» человеку понятнее, чем
                            // общее «пять».
                            if store.queuedActionsCount > 0 {
                                Label(
                                    "\(store.queuedActionsCount) \(pluralize(store.queuedActionsCount, "действие ждёт", "действия ждут", "действий ждут")) отправки",
                                    systemImage: "checklist"
                                )
                                .font(Typography.callout.weight(.semibold))
                                .foregroundStyle(Theme.warning)
                            }

                            Text("Всё сохранено на устройстве и уйдёт при связи. Не удаляйте приложение.")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textMuted)

                            Button("Отправить сейчас") { Task { await store.flushQueue() } }
                                .buttonStyle(SecondaryButtonStyle())
                        }
                    }
                }

                Button("Выйти из аккаунта") { confirmingLogout = true }
                    .buttonStyle(DestructiveButtonStyle())
            }
            .padding(Spacing.lg)
            // Запас снизу под плавающую панель вкладок: без него последняя
            // кнопка — а это «Выйти из аккаунта» — уезжала под неё и читалась
            // наполовину.
            .padding(.bottom, Spacing.xxl * 2)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.background)
        .navigationTitle("Профиль")
        .navigationDestination(for: OperatorProfileRoute.self) { route in
            switch route {
            case .schedule: ScheduleScreen()
            case .money: MoneyScreen()
            case .knowledge: KnowledgeScreen()
            case .salesQuality: SalesQualityScreen()
            case .audit: AuditScreen()
            case .checklists: ChecklistsScreen()
            case .exams: ExamsScreen()
            case .chat: TeamChatScreen()
            case .messages: MessagesScreen()
            case .pointQR: PointQRLoginScreen()
            }
        }
        // Окно, а не всплывающая подсказка: подсказку система прижимает к
        // размеру якоря, и с крупным шрифтом текст переносился с дефисом, а
        // кнопка «Выйти» обрезалась. Окно центрируется и растёт под текст.
        .alert("Выйти из аккаунта?", isPresented: $confirmingLogout) {
            Button("Выйти", role: .destructive) { Task { await auth.signOut() } }
            Button("Отмена", role: .cancel) {}
        } message: {
            Text("Неотправленные чеки останутся на устройстве.")
        }
    }
}

/// Одна смена в разборе зарплаты: дата, точка и из чего сложилась сумма.
private struct SalaryShiftRow: View {
    let shift: SalaryShift

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline) {
                Text(dayLabel)
                    .font(Typography.callout.weight(.semibold))
                    .foregroundStyle(Theme.text)
                Text(shift.shiftLabel)
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
                Spacer(minLength: Spacing.sm)
                Text(Money.format(shift.salary))
                    .font(Typography.callout.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(Theme.text)
            }

            // Из чего сложилась смена. Выручку показываем рядом: процент
            // считается от неё, и без неё цифра выглядит взятой с потолка.
            Text(parts)
                .font(Typography.caption)
                .foregroundStyle(Theme.textDim)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, Spacing.xs)
    }

    private var dayLabel: String {
        guard let date = DateParsing.parseDateOnly(shift.date) else { return shift.date }
        return date.formatted(.dateTime.day().month(.abbreviated))
    }

    private var parts: String {
        var items: [String] = []
        if shift.baseSalary > 0 { items.append("ставка \(Money.format(shift.baseSalary))") }
        if shift.seniorityBonus > 0 {
            let percent = shift.seniorityPercent > 0 ? " (\(Percent.format(shift.seniorityPercent)))" : ""
            items.append("стаж \(Money.format(shift.seniorityBonus))\(percent)")
        }
        if shift.autoBonus > 0 { items.append("бонус \(Money.format(shift.autoBonus))") }
        if shift.roleBonus > 0 { items.append("за роль \(Money.format(shift.roleBonus))") }
        if shift.totalIncome > 0 { items.append("выручка \(Money.format(shift.totalIncome))") }
        if let company = shift.companyName, !company.isEmpty { items.append(company) }
        return items.joined(separator: " · ")
    }
}


/// Все непогашенные долги — по неделям.
///
/// Отдельным списком, а не на экране недели: там разговор про выбранный
/// период, а здесь про остаток целиком. Недели свёрнуты — в одной записи
/// лежит весь список товаров, и раскрытые они дают стену текста.
struct AllDebtsSheet: View {
    let weeks: [MoneyScreen.DebtWeek]
    let currentWeek: String

    @Environment(\.dismiss) private var dismiss
    @State private var expanded: Set<String> = []

    private var total: Double { weeks.reduce(0) { $0 + $1.total } }

    var body: some View {
        NavigationStack {
            ScreenScroll {
                Card(accent: Theme.negative) {
                    HStack {
                        Text("Всего непогашено")
                            .font(Typography.callout)
                            .foregroundStyle(Theme.textDim)
                        Spacer()
                        Text(Money.format(total))
                            .font(Typography.title.monospacedDigit())
                            .foregroundStyle(Theme.negative)
                    }
                }

                Card {
                    VStack(spacing: Spacing.sm) {
                        ForEach(Array(weeks.enumerated()), id: \.element.key) { index, group in
                            if index > 0 { RowDivider() }

                            VStack(alignment: .leading, spacing: Spacing.xs) {
                                Button {
                                    if expanded.contains(group.key) {
                                        expanded.remove(group.key)
                                    } else {
                                        expanded.insert(group.key)
                                    }
                                } label: {
                                    HStack(spacing: Spacing.xs) {
                                        Image(systemName: expanded.contains(group.key) ? "chevron.down" : "chevron.right")
                                            .font(.caption2.weight(.bold))
                                            .foregroundStyle(Theme.textMuted)

                                        VStack(alignment: .leading, spacing: 1) {
                                            Text(group.title)
                                                .font(Typography.callout.weight(.medium))
                                                .foregroundStyle(Theme.text)
                                            Text(
                                                "\(group.debts.count) \(pluralize(group.debts.count, "запись", "записи", "записей"))"
                                                    + (group.key == currentWeek ? " · текущая" : "")
                                            )
                                            .font(Typography.caption)
                                            .foregroundStyle(Theme.textMuted)
                                        }

                                        Spacer()

                                        Text(Money.format(group.total))
                                            .font(Typography.callout.weight(.semibold).monospacedDigit())
                                            .foregroundStyle(Theme.negative)
                                    }
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.pressable)

                                if expanded.contains(group.key) {
                                    ForEach(group.debts) { debt in
                                        HStack(alignment: .top, spacing: Spacing.sm) {
                                            Text(MoneyScreen.debtTitle(debt))
                                                .font(Typography.caption)
                                                .foregroundStyle(Theme.textDim)
                                                .lineLimit(2)
                                            Spacer(minLength: Spacing.sm)
                                            Text(Money.format(debt.amount))
                                                .font(Typography.caption.monospacedDigit())
                                                .foregroundStyle(Theme.negative)
                                        }
                                        .padding(.leading, Spacing.lg)
                                    }
                                }
                            }
                        }
                    }
                }

                Text("Долг гасят на точке: отметить оплату может управляющий.")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .background(Theme.background)
            .navigationTitle("Непогашенный долг")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Готово") { dismiss() }
                }
            }
            .animation(Motion.value, value: expanded)
        }
    }
}
