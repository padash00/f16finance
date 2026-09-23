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

    /// Главная цифра — на синей карточке, как баланс в банке: сколько
    /// получу за неделю, полоса «сколько уже выплачено» и статус.
    private func heroCard(_ week: SalaryWeek) -> some View {
        SalaryBalanceCard(
            title: week.paidAmount > 0 ? "Осталось получить" : "К выплате за неделю",
            remaining: week.paidAmount > 0 ? max(week.remainingAmount, 0) : week.netAmount,
            total: week.netAmount,
            paid: week.paidAmount,
            footer: [
                ("Неделя", weekRange(week)),
                ("Статус", week.statusLabel),
            ]
        )
    }

    private func weekRange(_ week: SalaryWeek) -> String {
        guard let start = week.weekStart, let end = week.weekEnd else { return "—" }
        return "\(shortDate(start)) — \(shortDate(end))"
    }

    private func breakdownCard(_ week: SalaryWeek) -> some View {
        Card {
            VStack(spacing: Spacing.md) {
                Text("Из чего сложилось")
                    .font(Typography.label)
                    .foregroundStyle(Theme.textDim)
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
    /// Только у старших смены — у остальных пункта нет.
    case lead
    /// Зал клуба. В нижней панели он есть не у всех: у точки, где и торгуют, и
    /// сажают за станции, места на все вкладки не хватает.
    case arena
}

struct OperatorProfileScreen: View {
    @Environment(AuthStore.self) private var auth
    @Environment(OperatorStore.self) private var store
    @Environment(CabinetStore.self) private var cabinet
    @AppStorage(Appearance.storageKey) private var appearance: Appearance = .system

    @State private var confirmingLogout = false
    @State private var changingPassword = false
    @State private var lockEnabled = false
    @State private var didLoadLock = false
    #if DEBUG
    @State private var debugRoute: OperatorProfileRoute?
    #endif

    /// Торгует ли точка: от этого зависит, показывать ли ревизию.
    private var sellsGoods: Bool { cabinet.overview?.points?.sellsGoods ?? true }

    /// Есть ли зал: у клуба он в нижней панели, у смешанной точки — здесь.
    private var hasArena: Bool {
        let industries = cabinet.overview?.points?.industries ?? []
        return industries.contains("club") || industries.contains("ps_club")
    }

    private var name: String { cabinet.overview?.operatorName ?? auth.role?.displayName ?? "Оператор" }

    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.lg) {
                header
                pendingUploads
                workSection
                knowledgeSection
                talkSection
                accountSection
                appSection
                logout
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.top, Spacing.md)
            // Запас снизу под плавающую панель вкладок.
            .padding(.bottom, Spacing.xxl * 2)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.background)
        .navigationTitle("Профиль")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
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
            case .lead: LeadDeskScreen()
            case .arena: ArenaScreen()
            }
        }
        .sheet(isPresented: $changingPassword) { ChangePasswordSheet() }
        .alert("Выйти из аккаунта?", isPresented: $confirmingLogout) {
            Button("Выйти", role: .destructive) { Task { await auth.signOut() } }
            Button("Отмена", role: .cancel) {}
        } message: {
            Text("Неотправленные чеки останутся на устройстве.")
        }
        #if DEBUG
        // Снимки экрана: `-ordaOperatorRoute schedule|money|…` открывает раздел.
        .navigationDestination(item: $debugRoute) { route in
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
            case .lead: LeadDeskScreen()
            case .arena: ArenaScreen()
            }
        }
        .task {
            if let raw = UserDefaults.standard.string(forKey: "ordaOperatorRoute") {
                try? await Task.sleep(for: .milliseconds(600))
                debugRoute = OperatorProfileRoute(debugName: raw)
            }
        }
        #endif
        .task { await cabinet.refreshUnreadMessages() }
        .task {
            await cabinet.refreshUndeliveredChecklists()
            await cabinet.refreshUndeliveredFiles()
        }
        .task {
            guard !didLoadLock else { return }
            didLoadLock = true
            lockEnabled = auth.isLockEnabled
        }
        .onChange(of: lockEnabled) { _, value in auth.isLockEnabled = value }
    }

    // ── Кто я ────────────────────────────────────────────────────────────────

    private var header: some View {
        VStack(spacing: Spacing.md) {
            Text(initials)
                .font(.system(size: 30, weight: .bold, design: .rounded))
                .foregroundStyle(Theme.navy)
                .frame(width: 84, height: 84)
                .background(.white, in: Circle())
                .overlay(Circle().strokeBorder(Theme.cobalt, lineWidth: 3))
            VStack(spacing: 4) {
                Text(name)
                    .font(.system(size: 21, weight: .bold))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
                Text(auth.role?.roleLabel ?? "Оператор")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(.white.opacity(0.16), in: Capsule())
            }
            if let week = cabinet.overview?.week {
                HStack(spacing: 0) {
                    heroStat(Money.format(week.netAmount), "за неделю")
                    Rectangle().fill(.white.opacity(0.2)).frame(width: 1, height: 30)
                    heroStat(week.statusLabel, "выплата")
                }
                .padding(.top, Spacing.xs)
            }
        }
        .padding(.vertical, Spacing.xl)
        .padding(.horizontal, Spacing.lg)
        .frame(maxWidth: .infinity)
        .background(
            LinearGradient(colors: Theme.heroGradient, startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: 28, style: .continuous)
        )
        .overlay(alignment: .topTrailing) {
            OrdaControlMark(ringColor: .white.opacity(0.14))
                .frame(width: 90, height: 90)
                .offset(x: 18, y: -14)
                .allowsHitTesting(false)
        }
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
    }

    private func heroStat(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.system(size: 17, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(label)
                .font(.system(size: 12))
                .foregroundStyle(.white.opacity(0.7))
        }
        .frame(maxWidth: .infinity)
    }

    private var initials: String {
        let letters = name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined()
        return letters.isEmpty ? "О" : letters.uppercased()
    }

    // ── Разделы ──────────────────────────────────────────────────────────────

    private var workSection: some View {
        OwnerSection("Работа") { EmptyView() } content: {
            VStack(spacing: 0) {
                link(.schedule, "calendar", Theme.brand, "Мой график", "смены на неделю вперёд")
                if cabinet.isLead {
                    divider
                    link(.lead, "person.2.badge.gearshape.fill", Theme.warning, "Старший смены", "заявки команды и готовность недели", badge: cabinet.leadPendingCount)
                }
                divider
                link(.money, "wallet.bifold.fill", Theme.positive, "Мои деньги", "зарплата, авансы, долги")
                divider
                link(.salesQuality, "chart.line.uptrend.xyaxis", Color(hex: 0x0D9488), "Как я работаю", "оценка за месяц и доплата за качество")
                if hasArena, sellsGoods {
                    divider
                    link(.arena, "desktopcomputer", Theme.info, "Зал", "станции, сессии и продления")
                }
                if sellsGoods {
                    divider
                    link(.audit, "list.clipboard.fill", Color(hex: 0xD97706), "Ревизия", "пересчёт товара по актам")
                }
                divider
                link(.checklists, "checkmark.seal.fill", Theme.brand, "Чек-листы", "приём, обход, закрытие смены", badge: store.blockingChecklists.count)
            }
        }
    }

    private var knowledgeSection: some View {
        OwnerSection("Знания") { EmptyView() } content: {
            VStack(spacing: 0) {
                link(.knowledge, "book.closed.fill", Theme.info, "База знаний", "регламенты точки", badge: cabinet.pendingArticles.count)
                divider
                link(.exams, "graduationcap.fill", Theme.warning, "Экзамены", "аттестация по регламентам", badge: cabinet.openExams)
            }
        }
    }

    private var talkSection: some View {
        OwnerSection("Общение") { EmptyView() } content: {
            VStack(spacing: 0) {
                link(.chat, "bubble.left.and.bubble.right.fill", Theme.brand, "Командный чат", "общий для всей точки")
                divider
                link(.messages, "envelope.fill", Color(hex: 0x0D9488), "Сообщения", "лично сменщику или управляющему", badge: cabinet.unreadMessages)
            }
        }
    }

    private var accountSection: some View {
        OwnerSection("Аккаунт") { EmptyView() } content: {
            VStack(spacing: 0) {
                link(.pointQR, "qrcode.viewfinder", Theme.navy, "Вход на точке по QR", "подтвердить вход в программу терминала")
                divider
                NavigationLink {
                    ScreenScroll { NotificationsCard() }
                        .background(Theme.background)
                        .navigationTitle("Уведомления")
                } label: {
                    row("bell.badge.fill", Theme.negative, "Уведомления", "что присылать и проверка")
                }
                .buttonStyle(.plain)
                divider
                Button { changingPassword = true } label: {
                    row("key.fill", Color(hex: 0xD97706), "Сменить пароль", "текущий спросим для подтверждения")
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var appSection: some View {
        OwnerSection("Приложение") { EmptyView() } content: {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    row("circle.lefthalf.filled", Theme.navy, "Оформление", nil, chevron: false)
                    PillSegment(options: Appearance.allCases.map { ($0, $0.title) }, selection: $appearance)
                }
                .padding(.bottom, Spacing.sm)
                if Biometrics.isAvailable {
                    divider
                    Toggle(isOn: $lockEnabled) {
                        row(Biometrics.iconName, Theme.cobalt, "Запрашивать \(Biometrics.displayName)", "при возврате в приложение", chevron: false)
                    }
                    .tint(Theme.brand)
                }
            }
        }
    }

    /// Чеки, чек-листы и файлы, которые ждут связи, — сверху, пока они есть:
    /// человек не должен уйти со смены, не зная, что часть работы на телефоне.
    @ViewBuilder
    private var pendingUploads: some View {
        let checklists = cabinet.undeliveredChecklists.count
        let files = cabinet.undeliveredFiles.count
        let sales = store.queuedSalesCount
        let actions = store.queuedActionsCount
        if checklists + files + sales + actions > 0 {
            HStack(spacing: Spacing.md) {
                TintedIcon(systemName: "arrow.triangle.2.circlepath", tint: Theme.warning, size: 42)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Ждёт отправки: \(pendingText(sales: sales, actions: actions, checklists: checklists, files: files))")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.text)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("Сохранено на устройстве и уйдёт при связи. Не удаляйте приложение.")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textDim)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: Spacing.sm)
                Button("Отправить") {
                    Task {
                        await store.flushQueue()
                        await cabinet.flushEverything()
                    }
                }
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(Theme.brand, in: Capsule())
            }
            .padding(Spacing.lg)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
        }
    }

    private func pendingText(sales: Int, actions: Int, checklists: Int, files: Int) -> String {
        var parts: [String] = []
        if sales > 0 { parts.append("\(sales) \(pluralize(sales, "чек", "чека", "чеков"))") }
        if actions > 0 { parts.append("\(actions) \(pluralize(actions, "действие", "действия", "действий"))") }
        if checklists > 0 { parts.append("\(checklists) \(pluralize(checklists, "чек-лист", "чек-листа", "чек-листов"))") }
        if files > 0 { parts.append("\(files) \(pluralize(files, "файл", "файла", "файлов"))") }
        return parts.joined(separator: ", ")
    }

    private var logout: some View {
        Button { confirmingLogout = true } label: {
            HStack {
                Image(systemName: "rectangle.portrait.and.arrow.right")
                Text("Выйти из аккаунта")
            }
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(Theme.negative)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
        .buttonStyle(.pressable)
    }

    // ── Мелочи ───────────────────────────────────────────────────────────────

    private var divider: some View {
        Rectangle().fill(Theme.borderSoft).frame(height: 1).padding(.leading, 52)
    }

    private func link(_ route: OperatorProfileRoute, _ icon: String, _ tint: Color, _ title: String, _ subtitle: String?, badge: Int = 0) -> some View {
        NavigationLink(value: route) {
            row(icon, tint, title, subtitle, badge: badge)
        }
        .buttonStyle(.plain)
    }

    private func row(_ icon: String, _ tint: Color, _ title: String, _ subtitle: String?, badge: Int = 0, chevron: Bool = true) -> some View {
        HStack(spacing: Spacing.md) {
            TintedIcon(systemName: icon, tint: tint, size: 38, corner: 11)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Theme.text)
                if let subtitle {
                    Text(subtitle)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textDim)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: Spacing.sm)
            if badge > 0 {
                Text("\(badge)")
                    .font(.system(size: 12, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(.white)
                    .padding(.horizontal, 7)
                    .frame(minHeight: 20)
                    .background(Theme.negative, in: Capsule())
            }
            if chevron {
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.textDim)
            }
        }
        .padding(.vertical, 10)
        .contentShape(Rectangle())
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

#if DEBUG
extension OperatorProfileRoute {
    init?(debugName: String) {
        switch debugName {
        case "schedule": self = .schedule
        case "money": self = .money
        case "knowledge": self = .knowledge
        case "salesQuality": self = .salesQuality
        case "audit": self = .audit
        case "checklists": self = .checklists
        case "exams": self = .exams
        case "messages": self = .messages
        case "pointQR": self = .pointQR
        case "lead": self = .lead
        default: return nil
        }
    }
}
#endif
