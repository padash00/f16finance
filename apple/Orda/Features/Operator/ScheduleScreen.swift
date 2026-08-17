import OrdaKit
import OrdaUI
import SwiftUI

/// График смен — недельный календарь.
///
/// Списком «пятница, суббота, воскресенье» не видно главного: где в неделе
/// выходные и сколько подряд идёт рабочих дней. Календарь показывает это
/// формой, а не текстом — семь колонок, занятые дни заполнены.
struct ScheduleScreen: View {
    @Environment(CabinetStore.self) private var cabinet
    @Environment(\.surface) private var surface

    /// По какой смене пишем «не смогу выйти».
    @State private var reporting: Day?
    @State private var actionError: String?
    @State private var isBusy = false

    /// Смена конкретного дня, если она есть.
    private struct Day: Identifiable {
        let date: Date
        let shift: ScheduledShift?
        let companyName: String?

        var id: Date { date }
        var isToday: Bool { Calendar.current.isDateInToday(date) }
        var isPast: Bool { date < Calendar.current.startOfDay(for: Date()) }
        var isWorking: Bool { shift != nil }
    }

    var body: some View {
        ScreenScroll {
            if cabinet.schedule == nil {
                Skeleton(height: 220, cornerRadius: Radius.lg)
            } else {
                weekHeader
                weekGrid
                confirmationCard
                leadCard
                requestsCard
                summaryCards

                if days.allSatisfy({ !$0.isWorking }) {
                    Card {
                        Label(
                            "На эту неделю смен не назначено. График публикует руководитель.",
                            systemImage: "calendar.badge.exclamationmark"
                        )
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textMuted)
                    }
                }
            }
        }
        .navigationTitle("Мой график")
        .sheet(item: $reporting) { day in
            if let response = responseForReporting {
                ShiftIssueSheet(
                    responseID: response.id,
                    shiftDate: DateParsing.dateOnlyString(from: day.date),
                    shiftType: day.shift?.shiftType ?? "day",
                    companyName: day.companyName ?? ""
                ) {
                    await cabinet.loadSchedule()
                }
            }
        }
        .toolbar { LogoutToolbarItem() }
        .task { if cabinet.schedule == nil { await cabinet.loadSchedule() } }
        .refreshable { await cabinet.loadSchedule() }
    }

    // ── Шапка недели ─────────────────────────────────────────────────────────

    private var weekHeader: some View {
        HStack {
            // Шаг по неделям: график публикуют заранее, и «что у меня на
            // следующей» — первый вопрос после «что у меня сегодня».
            Button { cabinet.shiftScheduleWeek(by: -1) } label: {
                Image(systemName: "chevron.left")
            }
            .buttonStyle(.pressable)
            .padding(.trailing, Spacing.sm)

            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(weekTitle)
                    .font(Typography.title)
                    .foregroundStyle(Theme.text)
                Text("\(workingCount) \(pluralize(workingCount, "смена", "смены", "смен")) на неделе")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
            }
            Spacer()

            Button { cabinet.shiftScheduleWeek(by: 1) } label: {
                Image(systemName: "chevron.right")
            }
            .buttonStyle(.pressable)
        }
    }

    // ── Подтверждение недели ─────────────────────────────────────────────────

    /// Для старшего: заявки команды ждут именно здесь, рядом с графиком.
    ///
    /// Отдельный пункт в профиле есть, но человек, который открыл график,
    /// думает про смены прямо сейчас — и заявку в этот момент видеть должен.
    @ViewBuilder
    private var leadCard: some View {
        if cabinet.isLead, cabinet.leadPendingCount > 0 {
            NavigationLink {
                LeadDeskScreen()
            } label: {
                Card(accent: Theme.warning) {
                    HStack(spacing: Spacing.md) {
                        Image(systemName: "person.2.badge.gearshape")
                            .font(.system(size: 22))
                            .foregroundStyle(Theme.warning)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Заявки команды: \(cabinet.leadPendingCount)")
                                .font(Typography.body.weight(.medium))
                                .foregroundStyle(Theme.text)
                            Text("Ждут вашего предложения по замене")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textMuted)
                        }
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textMuted)
                    }
                }
            }
            .buttonStyle(.pressable)
        }
    }

    /// График опубликован — его надо принять.
    ///
    /// Подтверждение снимает вечный спор «я не знал про смену»: у руководителя
    /// видно, кто неделю принял, а кто ещё нет. Раньше это можно было сделать
    /// только на сайте или в Telegram.
    @ViewBuilder
    private var confirmationCard: some View {
        ForEach(cabinet.schedule?.groups ?? []) { group in
            if let response = group.response, group.needsConfirmation {
                Card(accent: Theme.info) {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        SectionHeader(
                            "График опубликован",
                            subtitle: group.companyName
                        )

                        Text("Подтвердите, что видели неделю и выходите. Без этого у руководителя вы числитесь не ознакомленным.")
                            .font(Typography.callout)
                            .foregroundStyle(Theme.textDim)
                            .fixedSize(horizontal: false, vertical: true)

                        Button {
                            Task { await confirm(responseID: response.id) }
                        } label: {
                            if isBusy {
                                ProgressView().controlSize(.small)
                            } else {
                                Label("Ознакомлен, выхожу", systemImage: "checkmark.circle")
                            }
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(isBusy)
                    }
                }
            }
        }
    }

    /// Уже поданные заявки на замену.
    @ViewBuilder
    private var requestsCard: some View {
        let requests = (cabinet.schedule?.groups ?? []).flatMap(\.requests).filter(\.isOpen)

        if !requests.isEmpty {
            Card(accent: Theme.warning) {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    SectionHeader("Заявки на замену", subtitle: "Решение принимает руководитель")

                    ForEach(requests) { request in
                        HStack(alignment: .top, spacing: Spacing.sm) {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(ScheduleScreen.dayTitle(request.shiftDate) + (request.shiftType == "night" ? ", ночная" : ", дневная"))
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.text)
                                if let reason = request.reason, !reason.isEmpty {
                                    Text(reason)
                                        .font(Typography.caption)
                                        .foregroundStyle(Theme.textMuted)
                                        .lineLimit(2)
                                }
                            }
                            Spacer(minLength: Spacing.sm)
                            StatusChip(request.statusLabel, kind: .warning)
                        }
                    }
                }
            }
        }
    }

    /// «12 авг.» из «2026-08-12».
    static func dayTitle(_ iso: String) -> String {
        guard let date = DateParsing.parseDateOnly(iso) else { return iso }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ru_RU")
        formatter.dateFormat = "d MMM"
        return formatter.string(from: date)
    }

    /// Заявку можно подать только по опубликованной неделе: она привязана к
    /// публикации, без неё сервер её не примет.
    private var responseForReporting: ScheduleWeekResponse? {
        (cabinet.schedule?.groups ?? []).compactMap(\.response).first
    }

    private var canReport: Bool { responseForReporting != nil }

    private func confirm(responseID: String) async {
        isBusy = true
        actionError = nil
        defer { isBusy = false }

        if let failure = await cabinet.confirmScheduleWeek(responseID: responseID) {
            actionError = failure
            Haptics.error()
        } else {
            Haptics.success()
        }
    }

    // ── Сетка ────────────────────────────────────────────────────────────────

    private var weekGrid: some View {
        Card(padding: surface == .handheld ? Spacing.md : Spacing.lg) {
            VStack(spacing: Spacing.sm) {
                // Подписи дней недели. Постоянные семь колонок — так неделя
                // читается как форма, а выходные видно провалом.
                HStack(spacing: Spacing.sm) {
                    ForEach(days) { day in
                        Text(weekdayShort(day.date))
                            .font(Typography.caption.weight(.medium))
                            .foregroundStyle(day.isToday ? Theme.accent(for: .operator) : Theme.textDim)
                            .frame(maxWidth: .infinity)
                    }
                }

                HStack(spacing: Spacing.sm) {
                    ForEach(days) { day in
                        let cell = DayCell(
                            dayNumber: dayNumber(day.date),
                            isToday: day.isToday,
                            isPast: day.isPast,
                            shift: day.shift,
                            compact: surface == .handheld
                        )

                        // Нажатие на свою будущую смену — «не смогу выйти».
                        // Прошедшую менять поздно, а чужой день не твой.
                        if day.isWorking, !day.isPast, canReport {
                            Button { reporting = day } label: {
                                cell.contentShape(Rectangle())
                            }
                            .buttonStyle(.pressable)
                            .frame(maxWidth: .infinity)
                        } else {
                            cell.frame(maxWidth: .infinity)
                        }
                    }
                }
            }
        }
    }

    // ── Сводка ───────────────────────────────────────────────────────────────

    @ViewBuilder
    private var summaryCards: some View {
        DashboardGrid {
            MetricTile(
                label: "Смен на неделе",
                value: "\(workingCount)",
                icon: "calendar",
                accent: Theme.accent(for: .operator)
            )
            MetricTile(
                label: "Ночных",
                value: "\(nightCount)",
                icon: "moon.stars",
                accent: ChartPalette.series2
            )
            if let next = nextWorkingDay {
                MetricTile(
                    label: "Ближайшая",
                    value: next.formatted(.dateTime.day().month(.abbreviated)),
                    icon: "arrow.right.circle",
                    accent: Theme.positive
                )
            }
        }

        // Точки перечисляем отдельно: оператор может работать на нескольких,
        // и по одной сетке этого не понять.
        if let groups = cabinet.schedule?.groups, groups.count > 1 {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    Text("Точки")
                        .font(Typography.label)
                        .foregroundStyle(Theme.textDim)
                        .textCase(.uppercase)
                    ForEach(groups) { group in
                        StatRow(
                            group.companyName,
                            value: "\(group.shifts.count) \(pluralize(group.shifts.count, "смена", "смены", "смен"))",
                            icon: "storefront"
                        )
                    }
                }
            }
        }
    }

    // ── Данные ───────────────────────────────────────────────────────────────

    /// Семь дней недели с привязанными сменами.
    private var days: [Day] {
        let calendar = Calendar.current
        let shifts = cabinet.schedule?.groups.flatMap { group in
            group.shifts.map { (shift: $0, company: group.companyName) }
        } ?? []

        let start = weekStartDate
        return (0..<7).compactMap { offset in
            guard let date = calendar.date(byAdding: .day, value: offset, to: start) else { return nil }
            let iso = DateParsing.dateOnlyString(from: date)
            let match = shifts.first { $0.shift.date == iso }
            return Day(date: date, shift: match?.shift, companyName: match?.company)
        }
    }

    /// Начало недели: из ответа сервера, иначе — понедельник текущей.
    private var weekStartDate: Date {
        if let start = cabinet.schedule?.weekStart, let date = DateParsing.parseDateOnly(start) {
            return date
        }
        var calendar = Calendar(identifier: .gregorian)
        calendar.firstWeekday = 2 // понедельник
        let today = calendar.startOfDay(for: Date())
        let components = calendar.dateComponents([.yearForWeekOfYear, .weekOfYear], from: today)
        return calendar.date(from: components) ?? today
    }

    private var workingCount: Int { days.filter(\.isWorking).count }
    private var nightCount: Int { days.filter { $0.shift?.isNight == true }.count }

    private var nextWorkingDay: Date? {
        let today = Calendar.current.startOfDay(for: Date())
        return days.first { $0.isWorking && $0.date >= today }?.date
    }

    private var weekTitle: String {
        guard let first = days.first?.date, let last = days.last?.date else { return "Неделя" }
        return "\(first.formatted(.dateTime.day().month(.abbreviated))) — \(last.formatted(.dateTime.day().month(.abbreviated)))"
    }

    private func weekdayShort(_ date: Date) -> String {
        date.formatted(.dateTime.weekday(.abbreviated)).uppercased()
    }

    private func dayNumber(_ date: Date) -> String {
        "\(Calendar.current.component(.day, from: date))"
    }
}

/// Ячейка дня в недельной сетке.
///
/// Рабочий день заливается, выходной остаётся пустым — неделя читается формой.
/// Сегодняшний день обведён, чтобы взгляд находил точку отсчёта.
struct DayCell: View {
    let dayNumber: String
    let isToday: Bool
    let isPast: Bool
    let shift: ScheduledShift?
    let compact: Bool

    var body: some View {
        VStack(spacing: Spacing.xs) {
            Text(dayNumber)
                .font(.system(size: compact ? 15 : 17, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(numberColor)

            if let shift {
                Image(systemName: shift.isNight ? "moon.fill" : "sun.max.fill")
                    .font(.system(size: compact ? 9 : 11, weight: .semibold))
                    .foregroundStyle(iconColor)

                if !compact {
                    Text(shift.typeLabel)
                        .font(.system(size: 9, weight: .medium))
                        .foregroundStyle(iconColor.opacity(0.8))
                        .lineLimit(1)
                }
            } else {
                // Держим высоту одинаковой: иначе сетка «пляшет» по дням.
                Circle()
                    .fill(Theme.textDim.opacity(0.25))
                    .frame(width: 4, height: 4)
                    .padding(.vertical, compact ? 2 : 6)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: compact ? 62 : 84)
        .background(background)
        .overlay {
            RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
                .strokeBorder(
                    isToday ? Theme.accent(for: .operator) : .clear,
                    lineWidth: 2
                )
        }
        // Прошедшие дни приглушаем: они уже не действие, а история.
        .opacity(isPast && shift == nil ? 0.45 : 1)
    }

    private var background: some View {
        RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
            .fill(shift == nil ? Theme.surfaceRaised.opacity(0.5) : fillColor)
    }

    private var fillColor: Color {
        guard let shift else { return .clear }
        return (shift.isNight ? ChartPalette.series2 : Theme.accent(for: .operator))
            .opacity(isPast ? 0.18 : 0.28)
    }

    private var iconColor: Color {
        guard let shift else { return Theme.textDim }
        return shift.isNight ? ChartPalette.series2 : Theme.accent(for: .operator)
    }

    private var numberColor: Color {
        if isToday { return Theme.accent(for: .operator) }
        return shift == nil ? Theme.textDim : Theme.text
    }
}
