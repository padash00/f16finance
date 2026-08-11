import OrdaKit
import OrdaUI
import SwiftUI

// ── Задачи ───────────────────────────────────────────────────────────────────

/// Задачи оператора.
struct TasksScreen: View {
    @Environment(CabinetStore.self) private var cabinet
    @Environment(\.surface) private var surface
    @State private var error: String?
    @State private var selected: OperatorTask?

    var body: some View {
        Group {
            if surface.isCompact { compactBody } else { wideBody }
        }
        .navigationTitle("Задачи")
        .toolbar { LogoutToolbarItem() }
        .task { if cabinet.tasks.isEmpty { await cabinet.loadTasks() } }
        .refreshable { await cabinet.loadTasks() }
    }

    /// Широкий экран: список слева, карточка задачи справа.
    private var wideBody: some View {
        MasterDetail(items: cabinet.tasks, selection: $selected, listWidth: 360) { task in
            TaskRow(task: task)
        } detail: { task in
            TaskDetail(task: task) {
                Task {
                    if let failure = await cabinet.completeTask(task) {
                        error = failure
                        Haptics.error()
                    } else {
                        Haptics.success()
                    }
                }
            }
        } empty: {
            WideEmptyState(
                icon: "checkmark.seal",
                title: "Задач нет",
                message: "Как только руководитель поставит задачу, она появится здесь."
            )
        }
    }

    private var compactBody: some View {
        ScrollView {
            VStack(spacing: Spacing.md) {
                if cabinet.isLoadingTasks && cabinet.tasks.isEmpty {
                    ForEach(0..<4, id: \.self) { _ in Skeleton(height: 76, cornerRadius: Radius.lg) }
                } else if cabinet.tasks.isEmpty {
                    EmptyStateView(
                        icon: "checkmark.seal",
                        title: "Задач нет",
                        message: "Как только руководитель поставит задачу, она появится здесь."
                    )
                } else {
                    if !cabinet.activeTasks.isEmpty {
                        SectionHeader("В работе", subtitle: "\(cabinet.activeTasks.count) \(pluralize(cabinet.activeTasks.count, "задача", "задачи", "задач"))")
                            .padding(.horizontal, Spacing.xs)

                        ForEach(Array(cabinet.activeTasks.enumerated()), id: \.element.id) { index, task in
                            TaskCard(task: task) {
                                Task {
                                    if let failure = await cabinet.completeTask(task) {
                                        error = failure
                                        Haptics.error()
                                    } else {
                                        Haptics.success()
                                    }
                                }
                            }
                            .staggeredAppear(index: index)
                        }
                    }

                    let done = cabinet.tasks.filter(\.isDone)
                    if !done.isEmpty {
                        SectionHeader("Завершённые")
                            .padding(.horizontal, Spacing.xs)
                            .padding(.top, Spacing.md)
                        ForEach(done) { task in
                            TaskCard(task: task, onComplete: nil)
                        }
                    }
                }

                if let error {
                    Text(error)
                        .font(Typography.callout)
                        .foregroundStyle(Theme.negative)
                }
            }
            .padding(Spacing.lg)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.background)
    }
}

struct TaskCard: View {
    let task: OperatorTask
    let onComplete: (() -> Void)?

    var body: some View {
        Card(accent: task.isOverdue ? Theme.negative : nil) {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                HStack(alignment: .top, spacing: Spacing.md) {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        Text(task.title)
                            .font(Typography.body.weight(.medium))
                            .foregroundStyle(Theme.text)

                        if let description = task.description, !description.isEmpty {
                            Text(description)
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textMuted)
                                .lineLimit(3)
                        }
                    }
                    Spacer(minLength: 0)
                }

                HStack(spacing: Spacing.sm) {
                    if task.isOverdue {
                        StatusChip("просрочена", kind: .danger)
                    } else if task.isOnReview {
                        StatusChip("на проверке", kind: .info)
                    } else if task.isDone {
                        StatusChip("выполнена", kind: .good)
                    } else if task.priority == "high" || task.priority == "urgent" {
                        StatusChip("срочно", kind: .warning)
                    }

                    if let due = task.dueDate {
                        Text("до \(shortDate(due))")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                    }

                    if let company = task.companyName {
                        Text("· \(company)")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                            .lineLimit(1)
                    }

                    Spacer(minLength: 0)
                }

                if let onComplete, !task.isOnReview {
                    Button("Отправить на проверку", action: onComplete)
                        .buttonStyle(SecondaryButtonStyle())
                        .padding(.top, Spacing.xs)
                }
            }
        }
    }

    private func shortDate(_ iso: String) -> String {
        guard let date = DateParsing.parseDateOnly(iso) else { return iso }
        return date.formatted(.dateTime.day().month(.abbreviated))
    }
}

// ── Чек-листы ────────────────────────────────────────────────────────────────

/// Список чек-листов смены.
struct ChecklistsScreen: View {
    @Environment(CabinetStore.self) private var cabinet
    @Environment(OperatorStore.self) private var store
    @State private var error: String?

    var body: some View {
        ScreenScroll {
            Group {
                if store.isSomeoneElsesShift {
                    // Чек-лист привязывается к смене: пройденный на чужой
                    // окажется в её отчёте, вместе со штрафами и премиями.
                    Card(accent: Theme.info) {
                        Label(
                            "Сейчас смену ведёт \(store.shift?.operatorName ?? "сменщик"). Чек-листы проходит тот, кто на смене.",
                            systemImage: "person.fill.checkmark"
                        )
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textMuted)
                    }
                } else if !store.hasOpenShift {
                    Card(accent: Theme.warning) {
                        Label(
                            "Чек-листы проходят в открытой смене. Откройте смену, чтобы начать.",
                            systemImage: "exclamationmark.triangle"
                        )
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textMuted)
                    }
                }

                if cabinet.isLoadingKnowledge && cabinet.knowledge == nil {
                    ForEach(0..<3, id: \.self) { _ in Skeleton(height: 92, cornerRadius: Radius.lg) }
                } else if let knowledge = cabinet.knowledge {
                    if knowledge.templates.isEmpty {
                        EmptyStateView(
                            icon: "checklist",
                            title: "Чек-листов нет",
                            message: "Для вашей точки чек-листы пока не настроены."
                        )
                    } else {
                        DashboardGrid {
                        ForEach(Array(knowledge.templates.enumerated()), id: \.element.id) { index, template in
                            ChecklistCard(
                                template: template,
                                itemCount: knowledge.items(for: template.id).count,
                                completedRun: knowledge.completedRun(for: template.id),
                                canRun: store.isMyShift
                            )
                            .staggeredAppear(index: index)
                        }
                        }
                    }
                }

                if let error {
                    Text(error).font(Typography.callout).foregroundStyle(Theme.negative)
                }
            }
        }
        .navigationTitle("Чек-листы")
        .toolbar { LogoutToolbarItem() }
        .task { if cabinet.knowledge == nil { await cabinet.loadKnowledge() } }
        .refreshable { await cabinet.loadKnowledge() }
    }
}

struct ChecklistCard: View {
    let template: ChecklistTemplate
    let itemCount: Int
    let completedRun: ChecklistRun?
    let canRun: Bool

    var body: some View {
        Card(accent: accent) {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                HStack {
                    Text(template.title)
                        .font(Typography.body.weight(.medium))
                        .foregroundStyle(Theme.text)
                    Spacer()
                    if completedRun != nil {
                        StatusChip("пройден", kind: .good)
                    } else if template.blocksShift {
                        StatusChip("обязательный", kind: .warning)
                    }
                }

                if let description = template.description, !description.isEmpty {
                    Text(description)
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textMuted)
                }

                Text("\(itemCount) \(pluralize(itemCount, "пункт", "пункта", "пунктов"))")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)

                if let run = completedRun {
                    HStack(spacing: Spacing.md) {
                        if let bonus = run.bonusesTotal, bonus > 0 {
                            Text("бонус \(Money.format(bonus))")
                                .font(Typography.caption.weight(.semibold))
                                .foregroundStyle(Theme.positive)
                        }
                        if let fine = run.finesTotal, fine > 0 {
                            Text("штраф \(Money.format(fine))")
                                .font(Typography.caption.weight(.semibold))
                                .foregroundStyle(Theme.negative)
                        }
                    }
                } else {
                    NavigationLink {
                        ChecklistRunScreen(template: template)
                    } label: {
                        Text("Пройти")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(PrimaryButtonStyle(tint: Theme.accent(for: .operator)))
                    .disabled(!canRun)
                    .padding(.top, Spacing.xs)
                }
            }
        }
    }

    private var accent: Color? {
        if completedRun != nil { return Theme.positive }
        return template.blocksShift ? Theme.warning : nil
    }
}

/// Прохождение чек-листа: пункт за пунктом.
struct ChecklistRunScreen: View {
    let template: ChecklistTemplate

    @Environment(CabinetStore.self) private var cabinet
    @Environment(\.dismiss) private var dismiss

    @State private var runID: String?
    @State private var answers: [String: ChecklistAnswer] = [:]
    @State private var isStarting = true
    @State private var isSubmitting = false
    @State private var error: String?
    @State private var result: ChecklistRunResult?

    private var items: [ChecklistItem] {
        cabinet.knowledge?.items(for: template.id) ?? []
    }

    private var answeredCount: Int {
        items.filter { answers[$0.id] != nil }.count
    }

    private var missingRequired: [ChecklistItem] {
        items.filter { $0.isRequired && answers[$0.id] == nil }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.lg) {
                if isStarting {
                    Skeleton(height: 120, cornerRadius: Radius.lg)
                } else if let result {
                    resultCard(result)
                } else {
                    progressCard

                    ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                        ChecklistItemCard(
                            item: item,
                            answer: Binding(
                                get: { answers[item.id] },
                                set: { answers[item.id] = $0 }
                            )
                        )
                        .staggeredAppear(index: index)
                    }

                    if let error {
                        Text(error).font(Typography.callout).foregroundStyle(Theme.negative)
                    }

                    Button {
                        submit()
                    } label: {
                        if isSubmitting {
                            ProgressView().controlSize(.small)
                        } else {
                            Text("Завершить чек-лист")
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle(tint: Theme.accent(for: .operator)))
                    .disabled(isSubmitting || !missingRequired.isEmpty)

                    if !missingRequired.isEmpty {
                        Text("Осталось ответить: \(missingRequired.count) \(pluralize(missingRequired.count, "обязательный пункт", "обязательных пункта", "обязательных пунктов"))")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                    }
                }
            }
            .padding(Spacing.lg)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.background)
        .navigationTitle(template.title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task { await start() }
    }

    private var progressCard: some View {
        Card {
            HStack(spacing: Spacing.lg) {
                ProgressRing(
                    progress: items.isEmpty ? 0 : Double(answeredCount) / Double(items.count),
                    label: "\(answeredCount)/\(items.count)",
                    color: Theme.accent(for: .operator)
                )
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text("Отвечено пунктов")
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textMuted)
                    if template.blocksShift {
                        StatusChip("без него смену не закрыть", kind: .warning)
                    }
                }
                Spacer()
            }
        }
    }

    private func resultCard(_ result: ChecklistRunResult) -> some View {
        VStack(spacing: Spacing.lg) {
            Card(accent: Theme.positive) {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    Label("Чек-лист пройден", systemImage: "checkmark.seal.fill")
                        .font(Typography.title)
                        .foregroundStyle(Theme.positive)

                    if result.bonusesTotal > 0 {
                        StatRow("Начислен бонус", value: Money.format(result.bonusesTotal), valueColor: Theme.positive, icon: "plus.circle")
                    }
                    if result.finesTotal > 0 {
                        StatRow("Начислен штраф", value: Money.format(result.finesTotal), valueColor: Theme.negative, icon: "minus.circle")
                    }
                    if result.bonusesTotal == 0 && result.finesTotal == 0 {
                        Text("Без штрафов и бонусов.")
                            .font(Typography.callout)
                            .foregroundStyle(Theme.textMuted)
                    }
                }
            }

            Button("Готово") { dismiss() }
                .buttonStyle(PrimaryButtonStyle(tint: Theme.accent(for: .operator)))
        }
    }

    private func start() async {
        guard runID == nil else { return }
        isStarting = true
        defer { isStarting = false }

        if cabinet.knowledge == nil { await cabinet.loadKnowledge() }

        switch await cabinet.startChecklist(template) {
        case let .success(id):
            runID = id
        case let .failure(failure):
            error = failure.message
        }
    }

    private func submit() {
        guard let runID else { return }
        isSubmitting = true
        error = nil

        Task {
            let payload = Array(answers.values)
            if let failure = await cabinet.saveChecklist(runID: runID, answers: payload) {
                error = failure
                isSubmitting = false
                Haptics.error()
                return
            }

            switch await cabinet.completeChecklist(runID: runID) {
            case let .success(value):
                result = value
                Haptics.success()
            case let .failure(failure):
                error = failure.message
                Haptics.error()
            }
            isSubmitting = false
        }
    }
}

/// Один пункт чек-листа: ответ, комментарий, при необходимости фото.
struct ChecklistItemCard: View {
    let item: ChecklistItem
    @Binding var answer: ChecklistAnswer?

    @State private var comment = ""

    var body: some View {
        Card(accent: accentColor) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        Text(item.title)
                            .font(Typography.body)
                            .foregroundStyle(Theme.text)
                        if let description = item.description, !description.isEmpty {
                            Text(description)
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textMuted)
                        }
                    }
                    Spacer(minLength: Spacing.sm)
                    if item.isRequired {
                        Text("обяз.")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.warning)
                    }
                }

                HStack(spacing: Spacing.md) {
                    answerButton(title: "Да", value: "yes", tint: Theme.positive)
                    answerButton(title: "Нет", value: "no", tint: Theme.negative)
                }

                // Комментарий обязателен при отрицательном ответе: «нет» без
                // объяснения бесполезно тому, кто будет разбираться.
                if answer?.answer == "no" {
                    TextField("Что не так?", text: $comment, axis: .vertical)
                        .textFieldStyle(.plain)
                        .lineLimit(2...4)
                        .padding(Spacing.md)
                        .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
                        .onChange(of: comment) { _, value in
                            answer?.comment = value
                        }
                }

                if item.requiresPhoto {
                    Label("Нужно фото — снимите в веб-версии", systemImage: "camera")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                }

                if let fine = item.fineAmount, fine > 0, answer?.answer == "no" {
                    Text("штраф за нарушение: \(Money.format(fine))")
                        .font(Typography.caption.weight(.semibold))
                        .foregroundStyle(Theme.negative)
                }
            }
        }
    }

    private var accentColor: Color? {
        switch answer?.answer {
        case "yes": Theme.positive
        case "no": Theme.negative
        default: nil
        }
    }

    private func answerButton(title: String, value: String, tint: Color) -> some View {
        Button {
            answer = ChecklistAnswer(itemID: item.id, answer: value, comment: comment.isEmpty ? nil : comment)
            Haptics.tap()
        } label: {
            Text(title)
                .font(Typography.headline)
                .foregroundStyle(answer?.answer == value ? Color.black.opacity(0.85) : Theme.text)
                .frame(maxWidth: .infinity)
                .padding(.vertical, Spacing.md)
                .background(
                    answer?.answer == value ? tint : Theme.surfaceRaised,
                    in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
                )
        }
        .buttonStyle(PressableTileStyle())
    }
}

// ── Задачи: строка и карточка для широкого экрана ────────────────────────────

/// Строка задачи в списке.
struct TaskRow: View {
    let task: OperatorTask

    var body: some View {
        HStack(spacing: Spacing.md) {
            RoundedRectangle(cornerRadius: 2)
                .fill(accent)
                .frame(width: 3)

            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(task.title)
                    .font(Typography.callout.weight(.medium))
                    .foregroundStyle(task.isDone ? Theme.textDim : Theme.text)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)

                HStack(spacing: Spacing.sm) {
                    if task.isOverdue {
                        StatusChip("просрочена", kind: .danger)
                    } else if task.isOnReview {
                        StatusChip("на проверке", kind: .info)
                    } else if task.isDone {
                        StatusChip("выполнена", kind: .good)
                    }
                    if let due = task.dueDate, let date = DateParsing.parseDateOnly(due) {
                        Text("до \(date.formatted(.dateTime.day().month(.abbreviated)))")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                    }
                }
            }

            Spacer(minLength: 0)
        }
        .padding(Spacing.md)
        .contentShape(Rectangle())
    }

    private var accent: Color {
        if task.isOverdue { return Theme.negative }
        if task.isDone { return Theme.positive }
        if task.priority == "high" || task.priority == "urgent" { return Theme.warning }
        return .clear
    }
}

/// Карточка задачи справа.
struct TaskDetail: View {
    let task: OperatorTask
    let onComplete: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                Text(task.title)
                    .font(.system(.title, design: .rounded).weight(.bold))
                    .foregroundStyle(Theme.text)

                HStack(spacing: Spacing.sm) {
                    StatusChip(task.statusLabel, kind: task.isDone ? .good : task.isOverdue ? .danger : .neutral)
                    StatusChip(task.priorityLabel, kind: task.priority == "high" ? .warning : .neutral)
                }

                if let description = task.description, !description.isEmpty {
                    Text(description)
                        .font(Typography.body)
                        .foregroundStyle(Theme.textMuted)
                        .textSelection(.enabled)
                }

                Card {
                    VStack(spacing: Spacing.sm) {
                        if let due = task.dueDate, let date = DateParsing.parseDateOnly(due) {
                            StatRow("Срок", value: date.formatted(.dateTime.day().month(.wide)), icon: "calendar")
                        }
                        if let company = task.companyName {
                            StatRow("Точка", value: company, icon: "storefront")
                        }
                    }
                }

                if !task.isDone && !task.isOnReview {
                    Button("Отправить на проверку", action: onComplete)
                        .buttonStyle(PrimaryButtonStyle(tint: Theme.accent(for: .operator)))
                        .frame(maxWidth: 320)
                }
            }
            .frame(maxWidth: 680, alignment: .leading)
            .padding(Spacing.xxl)
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .background(Theme.background)
    }
}
