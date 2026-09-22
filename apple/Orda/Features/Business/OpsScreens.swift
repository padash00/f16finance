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
    /// Фильтр уже выбран — первым заходом или человеком.
    @State private var didChooseFilter = false

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
        case mine, open, done, all
        var id: String { rawValue }
        var label: String {
            switch self {
            case .mine: "Мои"
            case .open: "Активные"
            case .done: "Готовые"
            case .all: "Все"
            }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            PillSegment(options: Filter.allCases.map { ($0, $0.label) }, selection: $filter)
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
                        title: emptyTitle,
                        message: emptyMessage
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
        .task {
            // Тому, кто задачи не ставит, доска нужна не целиком: он пришёл
            // посмотреть, что на нём. Ставящему — наоборот, весь список.
            if !canCreate, !didChooseFilter { filter = .mine }
            didChooseFilter = true
            await store.loadTasks()
            await store.loadMyTasks()
        }
        .refreshable {
            await store.loadTasks()
            await store.loadMyTasks()
        }
        .sheet(isPresented: $isAdding) { AddTaskSheet() }
    }

    private var emptyTitle: String {
        switch filter {
        case .mine: "На вас ничего не висит"
        case .done: "Готовых задач нет"
        default: "Задач нет"
        }
    }

    private var emptyMessage: String {
        switch filter {
        case .mine: "Поручения, назначенные лично вам, появятся здесь."
        case .open: "Всё разобрано."
        default: "Здесь появятся задачи команды."
        }
    }

    /// Просроченные наверх, дальше срочные, дальше по сроку.
    private var filtered: [TeamTask] {
        let tasks = switch filter {
        // «Мои» приходят своим запросом: на длинной доске страница обрывается
        // раньше, чем доходит до твоей задачи, и фильтр по загруженному
        // куску показал бы пусто там, где работа есть.
        case .mine: store.myTasks
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
///
/// Состояние — иконкой в цветном кружке, как у операций в банковской
/// выписке; «срочно» — подписью, а не плашкой, чтобы не резать заголовок.
struct TeamTaskRowView: View {
    let task: TeamTask

    private var tint: Color {
        if task.isDone { return Theme.positive }
        if task.isOverdue { return Theme.negative }
        if task.isUrgent { return Color(hex: 0xF97316) }
        return Color(hex: 0x8B5CF6)
    }

    private var icon: String {
        if task.isDone { return "checkmark" }
        if task.isOverdue { return "exclamationmark.triangle.fill" }
        if task.isUrgent { return "flame.fill" }
        return "circle"
    }

    var body: some View {
        HStack(spacing: Spacing.md) {
            TintedIcon(systemName: icon, tint: tint, size: 38)

            VStack(alignment: .leading, spacing: 3) {
                Text(task.title)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(task.isDone ? Theme.textDim : Theme.text)
                    .strikethrough(task.isDone, color: Theme.textDim)
                    .lineLimit(2)

                HStack(spacing: Spacing.sm) {
                    if let due = task.dueDate {
                        Label(
                            due.formatted(.dateTime.day().month(.abbreviated)),
                            systemImage: task.isOverdue ? "exclamationmark.triangle.fill" : "calendar"
                        )
                        .foregroundStyle(task.isOverdue ? Theme.negative : Theme.textDim)
                    }
                    if !task.checklist.isEmpty {
                        Label("\(task.doneCount)/\(task.checklist.count)", systemImage: "checklist")
                            .monospacedDigit()
                            .foregroundStyle(Theme.textDim)
                    }
                    if task.commentsCount > 0 {
                        Label("\(task.commentsCount)", systemImage: "bubble.left")
                            .monospacedDigit()
                            .foregroundStyle(Theme.textDim)
                    }
                }
                .font(.system(size: 13))
            }

            Spacer(minLength: Spacing.sm)

            if task.isUrgent && !task.isDone {
                Text("срочно")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.negative)
                    .fixedSize()
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

                // Шапка задачи — белый блок: заголовок крупно, статус цветной
                // подписью, приоритет и срок строками с иконками.
                VStack(alignment: .leading, spacing: Spacing.md) {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        HStack {
                            if let number = task.number {
                                Text("№\(number)")
                                    .font(.system(size: 13))
                                    .monospacedDigit()
                                    .foregroundStyle(Theme.textDim)
                            }
                            Spacer()
                            Text(task.statusLabel)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(task.isDone ? Theme.positive : (task.isOverdue ? Theme.negative : Theme.textDim))
                        }
                        Text(task.title)
                            .font(.system(size: 22, weight: .bold, design: .rounded))
                            .foregroundStyle(Theme.text)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    if let details = task.details, !details.isEmpty {
                        Text(details)
                            .font(.system(size: 15))
                            .foregroundStyle(Theme.textMuted)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    VStack(spacing: 0) {
                        OpsInfoRow(
                            icon: "flag.fill",
                            tint: task.isUrgent ? Theme.negative : Color(hex: 0x8B5CF6),
                            title: "Приоритет",
                            value: task.priorityLabel,
                            valueColor: task.isUrgent ? Theme.negative : Theme.text
                        )
                        if let due = task.dueDate {
                            OpsDivider()
                            OpsInfoRow(
                                icon: "calendar",
                                tint: task.isOverdue ? Theme.negative : Color(hex: 0x3B82F6),
                                title: "Срок",
                                value: due.formatted(.dateTime.day().month(.wide)),
                                valueColor: task.isOverdue ? Theme.negative : Theme.text
                            )
                        }
                    }
                }
                .padding(Spacing.lg)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 24, style: .continuous))

                if !task.checklist.isEmpty {
                    OwnerSection("Чек-лист") {
                        OpsCount(text: "\(task.doneCount) из \(task.checklist.count)")
                    } content: {
                        VStack(spacing: 0) {
                            ForEach(Array(task.checklist.enumerated()), id: \.element.id) { index, item in
                                if index > 0 { OpsDivider(inset: 40) }
                                HStack(spacing: Spacing.md) {
                                    Image(systemName: item.isDone ? "checkmark.circle.fill" : "circle")
                                        .font(.system(size: 22))
                                        .foregroundStyle(item.isDone ? Theme.positive : Theme.textDim)
                                        .frame(width: 28)
                                    Text(item.text)
                                        .font(.system(size: 15))
                                        .foregroundStyle(item.isDone ? Theme.textDim : Theme.text)
                                        .strikethrough(item.isDone, color: Theme.textDim)
                                    Spacer()
                                }
                                .padding(.vertical, Spacing.sm)
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
        OwnerSection("Обсуждение") {
            OpsCount(text: comments.isEmpty ? "пока пусто" : "\(comments.count) \(pluralize(comments.count, "запись", "записи", "записей"))")
        } content: {
            VStack(alignment: .leading, spacing: Spacing.md) {
                ForEach(Array(comments.enumerated()), id: \.element.id) { index, comment in
                    if index > 0 { OpsDivider() }
                    HStack(alignment: .top, spacing: Spacing.md) {
                        PersonInitial(name: comment.authorLabel, size: 36)
                        VStack(alignment: .leading, spacing: 2) {
                            HStack {
                                Text(comment.authorLabel)
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(Theme.text)
                                Spacer()
                                if let date = comment.createdAt {
                                    Text(date.formatted(.dateTime.day().month(.abbreviated).hour().minute()))
                                        .font(.system(size: 12))
                                        .foregroundStyle(Theme.textDim)
                                }
                            }
                            Text(comment.content)
                                .font(.system(size: 15))
                                .foregroundStyle(Theme.text)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }

                HStack(spacing: Spacing.sm) {
                    TextField("Написать по задаче", text: $commentDraft, axis: .vertical)
                        .textFieldStyle(.plain)
                        .font(.system(size: 15))
                        .lineLimit(1...4)
                        .padding(.horizontal, Spacing.md)
                        .padding(.vertical, 10)
                        .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: 20, style: .continuous))

                    Button {
                        Task { await sendComment() }
                    } label: {
                        Image(systemName: isSendingComment ? "hourglass" : "arrow.up")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 36, height: 36)
                            .background(commentDraft.isEmpty ? Theme.textDim : Theme.brand, in: Circle())
                    }
                    .buttonStyle(.pressable)
                    .disabled(commentDraft.trimmingCharacters(in: .whitespaces).isEmpty || isSendingComment)
                }

                if let commentError {
                    Text(commentError)
                        .font(.system(size: 12))
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
    /// По какой заявке принимаем решение.
    @State private var deciding: ShiftIssue?

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
                    // Заявки — выше сетки: если кто-то не выйдет в четверг,
                    // это важнее, чем как расставлены остальные дни.
                    issuesCard(schedule)

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
        .sheet(item: $deciding) { issue in
            ResolveShiftIssueSheet(
                issue: issue,
                operatorNames: operatorNames(for: issue)
            )
        }
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

    /// Заявки «не смогу выйти» по этой неделе.
    ///
    /// Раньше решение принимали только на сайте, а руководитель за неделю
    /// заходит в кабинет не каждый день — заявка висела, человек ждал ответа,
    /// и в итоге всё решалось звонком мимо системы.
    @ViewBuilder
    private func issuesCard(_ schedule: ShiftSchedule) -> some View {
        let open = schedule.openRequests
        if !open.isEmpty {
            Card(accent: Theme.warning) {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    Text(open.count == 1 ? "Заявка на замену" : "Заявок на замену: \(open.count)")
                        .font(Typography.body.weight(.medium))
                        .foregroundStyle(Theme.text)

                    ForEach(Array(open.enumerated()), id: \.element.id) { index, issue in
                        if index > 0 { RowDivider() }
                        Button {
                            deciding = issue
                        } label: {
                            VStack(alignment: .leading, spacing: Spacing.xxs) {
                                HStack {
                                    Text(issue.operatorName)
                                        .font(Typography.body)
                                        .foregroundStyle(Theme.text)
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .font(Typography.caption)
                                        .foregroundStyle(Theme.textMuted)
                                }

                                Text(
                                    ScheduleWeekScreen.dayTitle(issue.shiftDate)
                                        + (issue.isNight ? ", ночная" : ", дневная")
                                        + " · " + (companyName(issue.companyID, schedule: schedule))
                                )
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textDim)

                                if let reason = issue.reason, !reason.isEmpty {
                                    Text(reason)
                                        .font(Typography.caption)
                                        .foregroundStyle(Theme.textMuted)
                                        .fixedSize(horizontal: false, vertical: true)
                                }

                                if let proposal = issue.proposalLabel {
                                    StatusChip(proposal, kind: .info)
                                        .padding(.top, Spacing.xxs)
                                }
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.pressable)
                        .disabled(!canEdit)
                    }

                    if !canEdit {
                        Text("Решение по заявке принимает тот, кто ведёт график.")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textMuted)
                    }
                }
            }
        }
    }

    private func companyName(_ id: String, schedule: ShiftSchedule) -> String {
        schedule.companies.first { $0.id == id }?.name ?? "Точка"
    }

    /// Кого можно поставить вместо: те, кто уже стоит в графике этой точки на
    /// этой неделе. Расписание хранит имена, и придумывать новое здесь нечего —
    /// сервер всё равно ищет оператора по имени.
    private func operatorNames(for issue: ShiftIssue) -> [String] {
        guard let schedule = store.schedule else { return [] }
        var names: [String] = []
        for shift in schedule.shifts where shift.companyID == issue.companyID {
            let name = shift.operatorName
            guard !name.isEmpty, name != issue.operatorName, !names.contains(name) else { continue }
            names.append(name)
        }
        if let replacement = issue.replacementName, !names.contains(replacement) {
            names.insert(replacement, at: 0)
        }
        return names
    }

    /// «Чт, 20 августа» — дата заявки словами.
    static func dayTitle(_ isoDate: String) -> String {
        guard let date = DateParsing.parseDateOnly(isoDate) else { return isoDate }
        return date.formatted(.dateTime.weekday(.abbreviated).day().month(.wide).locale(Locale(identifier: "ru_RU")))
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

                // День строкой, имена целиком: в узких клетках они обрезались
                // до «Ал…». Одна колонка — на телефоне и планшете (рядом с
                // боковым меню ему тесно), две — только на широком Mac.
                let columns = surface != .desktop
                    ? [GridItem(.flexible())]
                    : [GridItem(.flexible(), spacing: Spacing.xl), GridItem(.flexible(), spacing: Spacing.xl)]

                LazyVGrid(columns: columns, spacing: 0) {
                    ForEach(weekDays, id: \.self) { day in
                        let cell = RosterDayCell(
                            day: day,
                            asRow: true,
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
///
/// На телефоне — строка выписки: кружок с числом слева, люди справа с полными
/// именами. На планшете — клетка недели.
private struct RosterDayCell: View {
    let day: Date
    var asRow = false
    let shifts: [RosterShift]

    private var isToday: Bool {
        Calendar.current.isDateInToday(day)
    }

    var body: some View {
        if asRow { row } else { cell }
    }

    private var row: some View {
        HStack(alignment: .center, spacing: Spacing.md) {
            VStack(spacing: 0) {
                Text(day.formatted(.dateTime.weekday(.abbreviated)).uppercased())
                    .font(.system(size: 10, weight: .bold))
                Text(day.formatted(.dateTime.day()))
                    .font(.system(size: 17, weight: .bold, design: .rounded))
                    .monospacedDigit()
            }
            .foregroundStyle(isToday ? Color.white : Theme.text)
            .frame(width: 46, height: 46)
            .background(isToday ? AnyShapeStyle(Theme.brand) : AnyShapeStyle(Theme.surfaceRaised), in: Circle())

            VStack(alignment: .leading, spacing: 6) {
                if shifts.isEmpty {
                    Label("никого не поставили", systemImage: "exclamationmark.circle.fill")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(Theme.warning)
                } else {
                    ForEach(shifts) { shift in
                        HStack(spacing: Spacing.sm) {
                            Image(systemName: shift.isNight ? "moon.fill" : "sun.max.fill")
                                .font(.system(size: 12))
                                .foregroundStyle(shift.isNight ? Color(hex: 0x6366F1) : Color(hex: 0xF59E0B))
                                .frame(width: 16)
                            Text(shift.operatorName)
                                .font(.system(size: 15, weight: .medium))
                                .foregroundStyle(Theme.text)
                                .lineLimit(1)
                                .minimumScaleFactor(0.85)
                        }
                    }
                }
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.textDim)
        }
        .padding(.vertical, Spacing.sm)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Theme.borderSoft).frame(height: 1).padding(.leading, 58)
        }
    }

    private var cell: some View {
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

/// Строка клиента: кружок с буквой, контакт подписью, сумма справа —
/// как получатель в списке переводов.
struct CustomerRowView: View {
    let customer: Customer

    var body: some View {
        AmountRow(
            leading: { PersonInitial(name: customer.name, size: 40) },
            title: customer.name,
            subtitle: "\(customer.phone ?? customer.cardNumber ?? "без контакта") · \(customer.visitsCount) \(pluralize(customer.visitsCount, "визит", "визита", "визитов"))",
            amount: Money.format(customer.totalSpent)
        )
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
                // Шапка — как профиль в банке: крупная буква, имя, точка.
                HStack(spacing: Spacing.lg) {
                    PersonInitial(name: customer.name, size: 64)

                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        Text(customer.name)
                            .font(.system(size: 22, weight: .bold, design: .rounded))
                            .foregroundStyle(Theme.text)
                        if let company = customer.companyName {
                            Text(company)
                                .font(.system(size: 14))
                                .foregroundStyle(Theme.textDim)
                        }
                    }
                    Spacer()

                    if canAdjust {
                        Button {
                            adjusting = true
                        } label: {
                            Label("Баллы", systemImage: "plusminus.circle")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(Theme.brand)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 9)
                                .background(Theme.brand.opacity(0.12), in: Capsule())
                        }
                        .buttonStyle(.pressable)
                    }
                }
                .padding(Spacing.lg)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 24, style: .continuous))

                // Сколько клиент принёс — главная цифра; визиты, чек и баллы —
                // расшифровка под ней, а не три равные плитки.
                HeroSummary(
                    title: "Потрачено",
                    value: Money.format(customer.totalSpent),
                    footer: [
                        ("Визитов", "\(customer.visitsCount)"),
                        ("Средний чек", Money.format(customer.averageCheck)),
                        ("Баллы", Quantity.format(customer.loyaltyPoints)),
                    ],
                    colors: Theme.heroGradient
                )

                OwnerSection("Контакты") {
                    VStack(spacing: 0) {
                        if let phone = customer.phone, !phone.isEmpty {
                            OpsInfoRow(icon: "phone.fill", tint: Color(hex: 0x10B981), title: "Телефон", value: phone)
                            OpsDivider()
                        }
                        if let card = customer.cardNumber, !card.isEmpty {
                            OpsInfoRow(icon: "creditcard.fill", tint: Color(hex: 0x3B82F6), title: "Карта", value: card)
                            OpsDivider()
                        }
                        OpsInfoRow(icon: "star.fill", tint: Color(hex: 0xF59E0B), title: "Баллы", value: Quantity.format(customer.loyaltyPoints))
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

// ── Общие детали экранов ─────────────────────────────────────────────────────

/// Разделитель с отступом под иконку — строки читаются как один список.
private struct OpsDivider: View {
    var inset: CGFloat = 52
    var body: some View {
        Rectangle().fill(Theme.borderSoft).frame(height: 1).padding(.leading, inset)
    }
}

/// Приглушённая подпись справа от заголовка секции.
private struct OpsCount: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.system(size: 13, weight: .semibold))
            .monospacedDigit()
            .foregroundStyle(Theme.textDim)
            .lineLimit(1)
    }
}

/// Строка «иконка — название — значение», замена StatRow в белых блоках.
private struct OpsInfoRow: View {
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
            Spacer(minLength: Spacing.sm)
            Text(value)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(valueColor)
                .lineLimit(1)
                .textSelection(.enabled)
        }
        .padding(.vertical, Spacing.sm)
    }
}
