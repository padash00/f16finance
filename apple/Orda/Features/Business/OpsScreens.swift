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

    @State private var selected: TeamTask?
    @State private var filter: Filter = .open

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
                VStack(spacing: Spacing.md) {
                    ForEach(0..<6, id: \.self) { _ in Skeleton(height: 52, cornerRadius: Radius.md) }
                }
                .padding(Spacing.lg)
            } else {
                MasterDetail(
                    items: filtered,
                    selection: $selected,
                    listWidth: 340
                ) { task in
                    TeamTaskRowView(task: task)
                } detail: { task in
                    TeamTaskDetail(task: task)
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
        .toolbar { LogoutToolbarItem() }
        .task { if store.tasks.isEmpty { await store.loadTasks() } }
        .refreshable { await store.loadTasks() }
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

    var body: some View {
        ScreenScroll {
            VStack(spacing: Spacing.lg) {
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
            }
        }
        .background(Theme.background)
        .navigationTitle("Задача")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
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
        .navigationTitle("Смены")
        .toolbar { LogoutToolbarItem() }
        .task { if store.schedule == nil { await store.loadSchedule() } }
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
                        RosterDayCell(
                            day: day,
                            shifts: schedule.shifts(
                                on: DateParsing.dateOnlyString(from: day),
                                companyID: company.id
                            )
                        )
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

    @State private var selected: Customer?
    @State private var search = ""

    var body: some View {
        Group {
            if let error = store.customersError, store.customers.isEmpty {
                ErrorStateView(error: error) { Task { await store.loadCustomers() } }
            } else if store.isLoadingCustomers && store.customers.isEmpty {
                VStack(spacing: Spacing.md) {
                    ForEach(0..<8, id: \.self) { _ in Skeleton(height: 52, cornerRadius: Radius.md) }
                }
                .padding(Spacing.lg)
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
        .navigationTitle("Клиенты")
        .searchable(text: $search, prompt: "Имя, телефон или карта")
        .toolbar { LogoutToolbarItem() }
        .task { if store.customers.isEmpty { await store.loadCustomers() } }
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
                Text(Money.compact(customer.totalSpent))
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

    var body: some View {
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
                    }
                }

                DashboardGrid {
                    MetricTile(
                        label: "Потрачено",
                        value: Money.compact(customer.totalSpent),
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
                        value: Money.compact(customer.averageCheck),
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
