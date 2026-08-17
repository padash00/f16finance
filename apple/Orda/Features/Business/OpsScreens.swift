import OrdaKit
import OrdaUI
import SwiftUI

// ── Задачи ───────────────────────────────────────────────────────────────────

/// Задачи команды, сгруппированные по состоянию.
///
/// Просроченные вынесены отдельной группой наверх, а не помечены цветом внутри
/// общего списка: если срок прошёл, это первое, что должен увидеть владелец,
/// а не то, что он найдёт, пролистав до середины.
struct TeamTasksScreen: View {
    @Environment(BusinessStore.self) private var store
    @Environment(\.access) private var access

    @State private var selected: TeamTask?
    @State private var filter: Filter = .open
    @State private var isAdding = false

    /// Право `tasks.create` проверяет и сервер.
    private var canCreate: Bool { access?.can("tasks.create") ?? false }
    /// Завершение — своё право, отдельное от правки.
    private var canComplete: Bool { access?.can("tasks.complete") ?? false }
    /// Правка, обсуждение и удаление — тоже отдельные права: переписать чужую
    /// задачу, ответить в ней и стереть её — разные полномочия, и в каталоге
    /// они заведены по отдельности.
    private var canEdit: Bool { access?.can("tasks.edit") ?? false }
    private var canComment: Bool { access?.can("tasks.add_comment") ?? false }
    private var canDelete: Bool { access?.can("tasks.delete") ?? false }

    private enum Filter: String, CaseIterable, Identifiable {
        case open, done, all
        var id: String { rawValue }
        var label: String {
            switch self {
            case .open: "Активные"
            case .done: "Готовые"
            case .all: "Все"
            }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            Picker("Фильтр", selection: $filter) {
                ForEach(Filter.allCases) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.md)

            if let error = store.tasksError, store.tasks.isEmpty {
                ErrorStateView(error: error) { Task { await store.loadTasks() } }
            } else if store.isLoadingTasks && store.tasks.isEmpty {
                LoadingRows(count: 6)
            } else {
                MasterDetail(
                    items: filtered,
                    selection: $selected,
                    listWidth: 340,
                    actions: { task in
                        // Закрыть задачу — самое частое, что с ней делают.
                        // Свайпом это одно движение вместо «открыть →
                        // прочитать → нажать → вернуться».
                        guard canComplete, !task.isDone else { return [] }
                        return [
                            RowAction("Завершить", icon: "checkmark.circle", tint: Theme.positive) {
                                Task { await store.changeTaskStatus(taskID: task.id, to: .done) }
                            }
                        ]
                    }
                ) { task in
                    TeamTaskRowView(task: task)
                } detail: { task in
                    TeamTaskDetail(
                        task: task,
                        canComplete: canComplete && !task.isDone,
                        canEdit: canEdit,
                        canComment: canComment,
                        canDelete: canDelete,
                        onComplete: {
                            Task { await store.changeTaskStatus(taskID: task.id, to: .done) }
                        }
                    )
                } empty: {
                    WideEmptyState(
                        icon: "checkmark.circle",
                        title: filter == .done ? "Готовых задач нет" : "Задач нет",
                        message: filter == .open
                            ? "Всё разобрано."
                            : "Здесь появятся задачи команды."
                    )
                }
            }
        }
        .background(Theme.background)
        .navigationTitle("Задачи")
        .toolbar {
            if canCreate {
                ToolbarItem(placement: .primaryAction) {
                    Button { isAdding = true } label: { Image(systemName: "plus") }
                }
            }
            LogoutToolbarItem()
        }
        .task { await store.loadTasks() }
        .refreshable { await store.loadTasks() }
        .sheet(isPresented: $isAdding) { AddTaskSheet() }
    }

    /// Просроченные наверх, дальше срочные, дальше по сроку.
    private var filtered: [TeamTask] {
        let tasks = switch filter {
        case .open: store.tasks.filter { !$0.isDone }
        case .done: store.tasks.filter(\.isDone)
        case .all: store.tasks
        }

        return tasks.sorted { left, right in
            if left.isOverdue != right.isOverdue { return left.isOverdue }
            if left.isUrgent != right.isUrgent { return left.isUrgent }
            switch (left.dueDate, right.dueDate) {
            case let (l?, r?): return l < r
            case (nil, _?): return false
            case (_?, nil): return true
            default: return left.title < right.title
            }
        }
    }
}

/// Строка задачи: состояние, заголовок, срок.
struct TeamTaskRowView: View {
    let task: TeamTask

    var body: some View {
        HStack(spacing: Spacing.md) {
            Image(systemName: task.isDone ? "checkmark.circle.fill" : "circle")
                .font(.system(size: 16))
                .foregroundStyle(task.isDone ? Theme.positive : (task.isOverdue ? Theme.negative : Theme.textDim))

            VStack(alignment: .leading, spacing: 2) {
                Text(task.title)
                    .font(Typography.callout)
                    .foregroundStyle(task.isDone ? Theme.textDim : Theme.text)
                    .strikethrough(task.isDone, color: Theme.textDim)
                    .lineLimit(2)

                HStack(spacing: Spacing.sm) {
                    if let due = task.dueDate {
                        Label(
                            due.formatted(.dateTime.day().month(.abbreviated)),
                            systemImage: task.isOverdue ? "exclamationmark.triangle.fill" : "calendar"
                        )
                        .font(Typography.caption)
                        .foregroundStyle(task.isOverdue ? Theme.negative : Theme.textDim)
                    }
                    if !task.checklist.isEmpty {
                        Label("\(task.doneCount)/\(task.checklist.count)", systemImage: "checklist")
                            .font(Typography.caption)
                            .monospacedDigit()
                            .foregroundStyle(Theme.textDim)
                    }
                    if task.commentsCount > 0 {
                        Label("\(task.commentsCount)", systemImage: "bubble.left")
                            .font(Typography.caption)
                            .monospacedDigit()
                            .foregroundStyle(Theme.textDim)
                    }
                }
            }

            Spacer(minLength: Spacing.sm)

            if task.isUrgent && !task.isDone {
                StatusChip("срочно", kind: .danger)
            }
        }
    }
}

private struct TeamTaskDetail: View {
    let task: TeamTask
    var canComplete = false
    var canEdit = false
    var canComment = false
    var canDelete = false
    var onComplete: () -> Void = {}

    @Environment(BusinessStore.self) private var store

    @State private var isEditing = false
    @State private var comments: [TaskComment] = []
    @State private var commentDraft = ""
    @State private var isSendingComment = false
    @State private var commentError: String?
    @State private var confirmingDelete = false

    var body: some View {
        ScreenScroll {
            VStack(spacing: Spacing.lg) {
                if canComplete {
                    // Закрыть задачу — самое частое, что с ней делают, и ради
                    // одного нажатия открывать сайт незачем.
                    Button("Завершить задачу", action: onComplete)
                        .buttonStyle(PrimaryButtonStyle())
                }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: Spacing.xs) {
                                if let number = task.number {
                                    Text("№\(number)")
                                        .font(Typography.caption)
                                        .monospacedDigit()
                                        .foregroundStyle(Theme.textDim)
                                }
                                Text(task.title)
                                    .font(Typography.title)
                                    .foregroundStyle(Theme.text)
                            }
                            Spacer()
                            StatusChip(task.statusLabel, kind: task.isDone ? .good : (task.isOverdue ? .danger : .neutral))
                        }

                        if let details = task.details, !details.isEmpty {
                            RowDivider()
                            Text(details)
                                .font(Typography.callout)
                                .foregroundStyle(Theme.textMuted)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }

                        RowDivider()
                        StatRow("Приоритет", value: task.priorityLabel, valueColor: task.isUrgent ? Theme.negative : Theme.text, icon: "flag")
                        if let due = task.dueDate {
                            StatRow(
                                "Срок",
                                value: due.formatted(.dateTime.day().month(.wide)),
                                valueColor: task.isOverdue ? Theme.negative : Theme.text,
                                icon: "calendar"
                            )
                        }
                    }
                }

                if !task.checklist.isEmpty {
                    Card {
                        VStack(alignment: .leading, spacing: Spacing.md) {
                            SectionHeader("Чек-лист", subtitle: "\(task.doneCount) из \(task.checklist.count)")

                            ForEach(Array(task.checklist.enumerated()), id: \.element.id) { index, item in
                                if index > 0 { RowDivider() }
                                HStack(spacing: Spacing.md) {
                                    Image(systemName: item.isDone ? "checkmark.square.fill" : "square")
                                        .font(.system(size: 14))
                                        .foregroundStyle(item.isDone ? Theme.positive : Theme.textDim)
                                    Text(item.text)
                                        .font(Typography.callout)
                                        .foregroundStyle(item.isDone ? Theme.textDim : Theme.text)
                                        .strikethrough(item.isDone, color: Theme.textDim)
                                    Spacer()
                                }
                            }
                        }
                    }
                }

                if canComment { commentsCard }
            }
        }
        .background(Theme.background)
        .navigationTitle("Задача")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            if canEdit || canDelete {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        if canEdit {
                            Button {
                                isEditing = true
                            } label: {
                                Label("Изменить", systemImage: "pencil")
                            }
                        }
                        if canDelete {
                            Button(role: .destructive) {
                                confirmingDelete = true
                            } label: {
                                Label("Удалить", systemImage: "trash")
                            }
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
        }
        .sheet(isPresented: $isEditing) { EditTaskSheet(task: task) }
        .confirmationDialog("Удалить задачу?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Удалить", role: .destructive) {
                Task { _ = await store.deleteTask(taskID: task.id) }
            }
            Button("Отмена", role: .cancel) {}
        } message: {
            Text("Вместе с ней исчезнет и переписка по задаче.")
        }
        .task(id: task.id) {
            guard canComment else { return }
            comments = await store.taskComments(taskID: task.id)
        }
    }

    /// Переписка по задаче.
    ///
    /// «Что там по задаче» спрашивают голосом или в чате, и ответ теряется.
    /// Комментарий остаётся при задаче: через месяц видно, почему сроки
    /// сдвинулись.
    private var commentsCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader(
                    "Обсуждение",
                    subtitle: comments.isEmpty ? "пока пусто" : "\(comments.count) \(pluralize(comments.count, "запись", "записи", "записей"))"
                )

                ForEach(Array(comments.enumerated()), id: \.element.id) { index, comment in
                    if index > 0 { RowDivider() }
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            Text(comment.authorLabel)
                                .font(Typography.caption.weight(.semibold))
                                .foregroundStyle(Theme.textDim)
                            Spacer()
                            if let date = comment.createdAt {
                                Text(date.formatted(.dateTime.day().month(.abbreviated).hour().minute()))
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.textDim)
                            }
                        }
                        Text(comment.content)
                            .font(Typography.callout)
                            .foregroundStyle(Theme.text)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                HStack(spacing: Spacing.sm) {
                    TextField("Написать по задаче", text: $commentDraft, axis: .vertical)
                        .textFieldStyle(.plain)
                        .font(Typography.callout)
                        .lineLimit(1...4)
                        .padding(Spacing.md)
                        .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))

                    Button {
                        Task { await sendComment() }
                    } label: {
                        Image(systemName: isSendingComment ? "hourglass" : "arrow.up.circle.fill")
                            .font(.system(size: 24))
                            .foregroundStyle(commentDraft.isEmpty ? Theme.textDim : Theme.brand)
                    }
                    .buttonStyle(.pressable)
                    .disabled(commentDraft.trimmingCharacters(in: .whitespaces).isEmpty || isSendingComment)
                }

                if let commentError {
                    Text(commentError)
                        .font(Typography.caption)
                        .foregroundStyle(Theme.negative)
                }
            }
        }
    }

    private func sendComment() async {
        let text = commentDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isSendingComment else { return }
        isSendingComment = true
        defer { isSendingComment = false }

        if let failure = await store.addTaskComment(taskID: task.id, content: text) {
            commentError = failure
            Haptics.error()
        } else {
            commentDraft = ""
            commentError = nil
            comments = await store.taskComments(taskID: task.id)
            Haptics.success()
        }
    }
}

// ── График смен ──────────────────────────────────────────────────────────────

/// Недельный график: дни столбцами, точки строками.
///
/// Сетка, а не список: расписание читают, чтобы найти дырку — день, где на
/// точке никого нет. В списке дырка невидима, в сетке это пустая клетка.
struct ScheduleWeekScreen: View {
    @Environment(BusinessStore.self) private var store
    @Environment(\.surface) private var surface
    @Environment(\.access) private var access

    /// Какую клетку правим. Открывается нажатием на день.
    @State private var editing: ShiftSlot?

    private var canEdit: Bool { access?.can("shifts.create") ?? false }

    /// Клетка расписания: точка и день.
    struct ShiftSlot: Identifiable, Hashable {
        let companyID: String
        let companyName: String
        let day: Date

        var id: String { companyID + DateParsing.dateOnlyString(from: day) }
    }

    var body: some View {
        @Bindable var bindable = store

        return ScreenScroll {
            VStack(spacing: Spacing.lg) {
                WeekStepper(week: $bindable.scheduleWeek, allowsFuture: true)

                if let error = store.scheduleError, store.schedule == nil {
                    ErrorStateView(error: error) { Task { await store.loadSchedule() } }
                } else if let schedule = store.schedule {
                    if schedule.companies.isEmpty {
                        Card {
                            InlineEmpty(icon: "building.2", text: "Точек не заведено", tint: Theme.textDim)
                        }
                    } else {
                        ForEach(schedule.companies) { company in
                            companyGrid(company, schedule: schedule)
                        }
                    }
                } else {
                    VStack(spacing: Spacing.lg) {
                        Skeleton(height: 64, cornerRadius: Radius.lg)
                        Skeleton(height: 180, cornerRadius: Radius.lg)
                    }
                }
            }
        }
        .background(Theme.background)
        .sheet(item: $editing) { slot in
            AssignShiftSheet(
                companyID: slot.companyID,
                companyName: slot.companyName,
                date: slot.day
            ) {
                await store.loadSchedule()
            }
        }
        .navigationTitle("Смены")
        .toolbar { LogoutToolbarItem() }
        .task { await store.loadSchedule() }
        .refreshable { await store.loadSchedule() }
    }

    private var weekDays: [Date] {
        guard let start = DateParsing.parseDateOnly(store.scheduleWeek) else { return [] }
        let calendar = Calendar(identifier: .iso8601)
        return (0..<7).compactMap { calendar.date(byAdding: .day, value: $0, to: start) }
    }

    /// Сетка одной точки: строка на день, потому что семь колонок на телефоне
    /// нечитаемы, а на планшете дни всё равно помещаются в ряд карточек.
    private func companyGrid(_ company: Company, schedule: ShiftSchedule) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader(company.name)

                let columns = surface.isCompact
                    ? [GridItem(.flexible()), GridItem(.flexible())]
                    : Array(repeating: GridItem(.flexible(), spacing: Spacing.sm), count: 7)

                LazyVGrid(columns: columns, spacing: Spacing.sm) {
                    ForEach(weekDays, id: \.self) { day in
                        let cell = RosterDayCell(
                            day: day,
                            shifts: schedule.shifts(
                                on: DateParsing.dateOnlyString(from: day),
                                companyID: company.id
                            )
                        )

                        if canEdit {
                            // График правят по дороге: кто-то заболел утром,
                            // кого-то переставили вечером.
                            Button {
                                editing = ShiftSlot(
                                    companyID: company.id,
                                    companyName: company.name,
                                    day: day
                                )
                            } label: {
                                cell.contentShape(Rectangle())
                            }
                            .buttonStyle(.pressable)
                        } else {
                            cell
                        }
                    }
                }
            }
        }
    }
}

/// Клетка дня: дата, кто в смене, пусто — если никого.
private struct RosterDayCell: View {
    let day: Date
    let shifts: [RosterShift]

    private var isToday: Bool {
        Calendar.current.isDateInToday(day)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(spacing: Spacing.xs) {
                Text(day.formatted(.dateTime.weekday(.abbreviated)).uppercased())
                    .font(Typography.caption.weight(.semibold))
                    .foregroundStyle(isToday ? Theme.brand : Theme.textDim)
                Text(day.formatted(.dateTime.day()))
                    .font(Typography.caption)
                    .monospacedDigit()
                    .foregroundStyle(Theme.textDim)
            }

            if shifts.isEmpty {
                // Пустая клетка — это находка, а не отсутствие данных.
                // Помечаем явно, иначе взгляд проскакивает мимо.
                Text("никого")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.warning)
            } else {
                ForEach(shifts) { shift in
                    HStack(spacing: Spacing.xxs) {
                        Image(systemName: shift.isNight ? "moon.fill" : "sun.max.fill")
                            .font(.system(size: 9))
                            .foregroundStyle(shift.isNight ? Theme.info : Theme.warning)
                        Text(shift.operatorName)
                            .font(Typography.caption)
                            .foregroundStyle(Theme.text)
                            .lineLimit(1)
                    }
                }
            }

            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, minHeight: 64, alignment: .topLeading)
        .padding(Spacing.sm)
        .background(isToday ? Theme.brand.opacity(0.08) : Theme.surfaceRaised)
        .clipShape(RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Radius.sm, style: .continuous)
                .stroke(isToday ? Theme.brand.opacity(0.4) : Color.clear, lineWidth: 1)
        )
    }
}

// ── Клиенты ──────────────────────────────────────────────────────────────────

/// Клиентская база: кто сколько тратит и как часто приходит.
struct CustomersScreen: View {
    @Environment(BusinessStore.self) private var store
    @Environment(\.access) private var access

    @State private var selected: Customer?
    @State private var search = ""
    @State private var isAdding = false

    private var canCreate: Bool { access?.can("customers.create") ?? false }

    var body: some View {
        Group {
            if let error = store.customersError, store.customers.isEmpty {
                ErrorStateView(error: error) { Task { await store.loadCustomers() } }
            } else if store.isLoadingCustomers && store.customers.isEmpty {
                LoadingRows(count: 8)
            } else {
                MasterDetail(
                    items: filtered,
                    selection: $selected,
                    listWidth: 320
                ) { customer in
                    CustomerRowView(customer: customer)
                } detail: { customer in
                    CustomerDetail(customer: customer)
                } empty: {
                    WideEmptyState(
                        icon: "person.crop.circle",
                        title: search.isEmpty ? "Клиентов нет" : "Никого не найдено",
                        message: search.isEmpty
                            ? "База наполнится с первыми продажами по карте."
                            : "Попробуйте другой запрос."
                    )
                }
            }
        }
        .background(Theme.background)
        .sheet(isPresented: $isAdding) {
            AddCustomerSheet { await store.loadCustomers() }
        }
        .navigationTitle("Клиенты")
        .searchable(text: $search, prompt: "Имя, телефон или карта")
        .toolbar {
            if canCreate {
                ToolbarItem(placement: .primaryAction) {
                    Button { isAdding = true } label: { Image(systemName: "plus") }
                }
            }
            LogoutToolbarItem()
        }
        .task { await store.loadCustomers() }
        .refreshable { await store.loadCustomers() }
    }

    private var filtered: [Customer] {
        guard !search.isEmpty else { return store.customers }
        return store.customers.filter {
            $0.name.localizedCaseInsensitiveContains(search)
                || ($0.phone?.contains(search) ?? false)
                || ($0.cardNumber?.contains(search) ?? false)
        }
    }
}

struct CustomerRowView: View {
    let customer: Customer

    var body: some View {
        HStack(spacing: Spacing.md) {
            Text(customer.initials)
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundStyle(Theme.brand)
                .frame(width: 36, height: 36)
                .background(Theme.brand.opacity(0.14), in: Circle())

            VStack(alignment: .leading, spacing: 1) {
                Text(customer.name)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text(customer.phone ?? customer.cardNumber ?? "без контакта")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 1) {
                Text(Money.format(customer.totalSpent))
                    .font(Typography.callout.weight(.medium))
                    .monospacedDigit()
                    .foregroundStyle(Theme.text)
                Text("\(customer.visitsCount) \(pluralize(customer.visitsCount, "визит", "визита", "визитов"))")
                    .font(Typography.caption)
                    .monospacedDigit()
                    .foregroundStyle(Theme.textDim)
            }
        }
    }
}

private struct CustomerDetail: View {
    let customer: Customer

    @Environment(BusinessStore.self) private var store
    @Environment(\.access) private var access
    @State private var adjusting = false

    /// Право то же, что проверяет сервер: корректировка баллов — это деньги.
    private var canAdjust: Bool { access?.can("customers.adjust_points") ?? false }

    var body: some View {
        content
            .sheet(isPresented: $adjusting) {
                AdjustPointsSheet(customer: customer) { await store.loadCustomers() }
            }
    }

    private var content: some View {
        ScreenScroll {
            VStack(spacing: Spacing.lg) {
                Card {
                    HStack(spacing: Spacing.lg) {
                        Text(customer.initials)
                            .font(.system(size: 22, weight: .semibold, design: .rounded))
                            .foregroundStyle(Theme.brand)
                            .frame(width: 64, height: 64)
                            .background(Theme.brand.opacity(0.14), in: Circle())

                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            Text(customer.name)
                                .font(Typography.title)
                                .foregroundStyle(Theme.text)
                            if let company = customer.companyName {
                                Text(company)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.textMuted)
                            }
                            if customer.loyaltyPoints > 0 {
                                StatusChip("\(Quantity.format(customer.loyaltyPoints)) баллов", kind: .info)
                            }
                        }
                        Spacer()

                        if canAdjust {
                            Button {
                                adjusting = true
                            } label: {
                                Label("Баллы", systemImage: "plusminus.circle")
                            }
                            .buttonStyle(SecondaryButtonStyle())
                        }
                    }
                }

                DashboardGrid {
                    MetricTile(
                        label: "Потрачено",
                        value: Money.format(customer.totalSpent),
                        icon: "banknote.fill",
                        accent: Theme.brand
                    )
                    MetricTile(
                        label: "Визитов",
                        value: "\(customer.visitsCount)",
                        icon: "figure.walk",
                        accent: Theme.info
                    )
                    MetricTile(
                        label: "Средний чек",
                        value: Money.format(customer.averageCheck),
                        icon: "receipt.fill",
                        accent: Theme.textMuted
                    )
                }

                Card {
                    VStack(spacing: Spacing.md) {
                        SectionHeader("Контакты")
                        if let phone = customer.phone, !phone.isEmpty {
                            StatRow("Телефон", value: phone, icon: "phone")
                        }
                        if let card = customer.cardNumber, !card.isEmpty {
                            StatRow("Карта", value: card, icon: "creditcard")
                        }
                        StatRow("Баллы", value: Quantity.format(customer.loyaltyPoints), icon: "star")
                    }
                }
            }
        }
        .background(Theme.background)
        .navigationTitle(customer.name)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}
