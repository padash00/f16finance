import OrdaKit
import OrdaUI
import SwiftUI

/// Аттестация операторов: список экзаменов и назначение нового.
///
/// Сдают экзамен в приложении давно, а назначали только на сайте — управляющий
/// на точке видел, что человек плавает в регламенте, и не мог тут же дать ему
/// билет. Здесь то, что делают не за столом: назначить, напомнить, дать
/// пересдачу, посмотреть кто как сдал.
///
/// Правки вопросов и расписание регулярных экзаменов остались на сайте: это
/// работа с текстом, её на телефоне не делают.
struct AdminExamsScreen: View {
    @Environment(\.api) private var api

    @State private var overview: AdminExamsOverview?
    @State private var loadError: APIError?
    @State private var isLoading = false
    @State private var assigning = false
    @State private var actionError: String?

    var body: some View {
        ScreenScroll {
            if let loadError {
                ErrorStateView(error: loadError) { Task { await load() } }
            } else if isLoading && overview == nil {
                LoadingRows(count: 3)
            } else if let overview {
                if let actionError {
                    Card(accent: Theme.negative) {
                        Text(actionError)
                            .font(Typography.callout)
                            .foregroundStyle(Theme.negative)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                if overview.exams.isEmpty {
                    WideEmptyState(
                        icon: "graduationcap",
                        title: "Экзаменов пока нет",
                        message: "Вопросы собираются из базы знаний вашей точки — списать со стороны нельзя."
                    )
                } else {
                    ForEach(overview.exams) { exam in
                        NavigationLink(value: AdminExamRoute(examID: exam.id)) {
                            examCard(exam, companies: overview.companies)
                        }
                        .buttonStyle(.pressable)
                    }
                }
            }
        }
        .navigationTitle("Экзамены операторов")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    assigning = true
                } label: {
                    Image(systemName: "plus")
                }
                .disabled(overview == nil)
            }
        }
        .navigationDestination(for: AdminExamRoute.self) { route in
            AdminExamDetailScreen(
                examID: route.examID,
                operators: overview?.operators ?? []
            )
        }
        .sheet(isPresented: $assigning) {
            if let overview {
                AssignExamSheet(
                    companies: overview.companies,
                    operators: overview.operators
                ) { await load() }
            }
        }
        .task { await load() }
        .refreshable { await load() }
    }

    private func examCard(_ exam: AdminExam, companies: [Company]) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                HStack(alignment: .firstTextBaseline) {
                    Text(exam.title)
                        .font(Typography.headline)
                        .foregroundStyle(Theme.text)
                    Spacer(minLength: Spacing.sm)
                    Text(exam.statusLabel)
                        .font(Typography.caption.weight(.medium))
                        .foregroundStyle(exam.isSent ? Theme.positive : Theme.warning)
                }

                Text(pointNames(exam.companyIDs, companies: companies))
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textMuted)

                RowDivider()

                HStack(spacing: Spacing.lg) {
                    stat("Назначено", "\(exam.assigned)")
                    stat("Сдали", "\(exam.passed) из \(exam.completed)")
                    if let average = exam.averageScore {
                        stat("Средний", "\(average)%")
                    }
                }

                if let deadline = exam.deadlineAt {
                    Label(
                        "Срок: " + deadline.formatted(date: .abbreviated, time: .shortened),
                        systemImage: "clock"
                    )
                    .font(Typography.caption)
                    .foregroundStyle(deadline < Date() ? Theme.warning : Theme.textMuted)
                }
            }
        }
    }

    private func stat(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title.uppercased())
                .font(Typography.caption)
                .foregroundStyle(Theme.textMuted)
            Text(value)
                .font(Typography.callout.weight(.semibold))
                .foregroundStyle(Theme.text)
        }
    }

    private func pointNames(_ ids: [String], companies: [Company]) -> String {
        let names = ids.compactMap { id in companies.first { $0.id == id }?.name }
        return names.isEmpty ? "Точка не указана" : names.joined(separator: ", ")
    }

    private func load() async {
        isLoading = overview == nil
        loadError = nil
        do {
            overview = try await AdminExamService(api: api).overview()
        } catch let error as APIError {
            loadError = error
        } catch {
            loadError = .transport(message: error.localizedDescription)
        }
        isLoading = false
    }
}

/// Адрес экзамена в админском контуре.
///
/// Имя своё, а не общее с операторским `ExamRoute`: у оператора маршрут ведёт
/// к сдаче билета, здесь — к разбору попыток, и один тип на оба означал бы, что
/// `navigationDestination` выберет чужой экран.
struct AdminExamRoute: Hashable {
    let examID: String
}

// ── Один экзамен ─────────────────────────────────────────────────────────────

struct AdminExamDetailScreen: View {
    let examID: String
    let operators: [AdminExamsOverview.ExamOperator]

    @Environment(\.api) private var api

    @State private var detail: AdminExamDetail?
    @State private var loadError: APIError?
    @State private var isLoading = false
    @State private var busy = false
    @State private var message: String?

    var body: some View {
        ScreenScroll {
            if let loadError {
                ErrorStateView(error: loadError) { Task { await load() } }
            } else if isLoading && detail == nil {
                LoadingRows(count: 3)
            } else if let detail {
                actionsCard(detail.exam)

                if let message {
                    Card {
                        Text(message)
                            .font(Typography.callout)
                            .foregroundStyle(Theme.textDim)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                if detail.attempts.isEmpty {
                    WideEmptyState(
                        icon: "person.badge.clock",
                        title: "Билеты не разосланы",
                        message: "Пока экзамен черновик, его видите только вы."
                    )
                } else {
                    Card {
                        VStack(spacing: Spacing.sm) {
                            ForEach(Array(detail.attempts.enumerated()), id: \.element.id) { index, attempt in
                                if index > 0 { RowDivider() }
                                attemptRow(attempt)
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle(detail?.exam.title ?? "Экзамен")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task { await load() }
        .refreshable { await load() }
    }

    private func actionsCard(_ exam: AdminExam) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader(
                    exam.statusLabel,
                    subtitle: "\(exam.questionCount) вопросов, порог \(exam.passScore)%"
                )

                if !exam.isSent {
                    // Черновик существует, чтобы посмотреть вопросы до
                    // рассылки. Отозвать разосланный билет уже нельзя.
                    Button {
                        Task { await run { try await AdminExamService(api: api).send(examID: examID) } }
                    } label: {
                        Label("Разослать билеты", systemImage: "paperplane")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(busy)
                } else {
                    Button {
                        Task { await run { try await AdminExamService(api: api).remind(examID: examID) } }
                    } label: {
                        Label("Напомнить не сдавшим", systemImage: "bell")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(busy)
                }
            }
        }
    }

    private func attemptRow(_ attempt: AdminExamAttempt) -> some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: 2) {
                Text(name(for: attempt.operatorID))
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                HStack(spacing: Spacing.xs) {
                    Text(attempt.statusLabel)
                        .font(Typography.caption.weight(.medium))
                        .foregroundStyle(color(for: attempt))
                    if let correct = attempt.correctAnswers, let total = attempt.totalQuestions, total > 0 {
                        Text("· \(correct) из \(total)")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textMuted)
                    }
                }
            }

            Spacer(minLength: Spacing.sm)

            if let score = attempt.score {
                Text("\(score)%")
                    .font(Typography.callout.weight(.semibold).monospacedDigit())
                    .foregroundStyle(color(for: attempt))
            }

            // Пересдача собирает новый билет: тот же список вопросов человек
            // уже видел, и повтор проверял бы память о разборе, а не знание.
            if attempt.isFinished, attempt.passed != true {
                Button {
                    Task { await run { try await AdminExamService(api: api).retake(attemptID: attempt.id) } }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.pressable)
                .disabled(busy)
            }
        }
    }

    private func name(for operatorID: String) -> String {
        operators.first { $0.id == operatorID }?.name ?? "Оператор"
    }

    private func color(for attempt: AdminExamAttempt) -> Color {
        switch attempt.status {
        case "completed": attempt.passed == true ? Theme.positive : Theme.negative
        case "expired", "undeliverable": Theme.warning
        default: Theme.info
        }
    }

    private func run(_ work: @escaping () async throws -> Void) async {
        busy = true
        message = nil
        defer { busy = false }
        do {
            try await work()
            await load()
            Haptics.success()
        } catch let error as APIError {
            Haptics.error()
            message = error.userMessage
        } catch {
            Haptics.error()
            message = error.localizedDescription
        }
    }

    private func load() async {
        isLoading = detail == nil
        loadError = nil
        do {
            detail = try await AdminExamService(api: api).detail(examID: examID)
        } catch let error as APIError {
            loadError = error
        } catch {
            loadError = .transport(message: error.localizedDescription)
        }
        isLoading = false
    }
}

// ── Назначение ───────────────────────────────────────────────────────────────

struct AssignExamSheet: View {
    let companies: [Company]
    let operators: [AdminExamsOverview.ExamOperator]
    var onDone: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.api) private var api

    @State private var assignment = ExamAssignment()
    @State private var hasDeadline = true
    @State private var deadline = Date().addingTimeInterval(3 * 86_400)
    @State private var isSaving = false
    @State private var error: String?

    /// Операторы выбранных точек. Экзамен по чужому регламенту сервер не
    /// пропустит, и показывать таких в списке значит вести к отказу.
    private var availableOperators: [AdminExamsOverview.ExamOperator] {
        guard !assignment.companyIDs.isEmpty else { return [] }
        let picked = Set(assignment.companyIDs)
        return operators.filter { !picked.isDisjoint(with: Set($0.companyIDs)) }
    }

    var body: some View {
        NavigationStack {
            ScreenScroll {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        FieldLabel("Название")
                        TextField("Аттестация по регламентам", text: $assignment.title)
                            .textFieldStyle(.plain)
                            .padding(Spacing.md)
                            .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
                    }
                }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        SectionHeader("Точки", subtitle: "Вопросы берутся из их базы знаний")
                        ForEach(companies) { company in
                            Button {
                                toggleCompany(company.id)
                            } label: {
                                checkRow(company.name, checked: assignment.companyIDs.contains(company.id))
                            }
                            .buttonStyle(.pressable)
                        }
                    }
                }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        SectionHeader(
                            "Кому",
                            subtitle: availableOperators.isEmpty ? "Сначала выберите точку" : nil
                        )
                        ForEach(availableOperators) { person in
                            Button {
                                toggleOperator(person.id)
                            } label: {
                                checkRow(
                                    person.name,
                                    checked: assignment.operatorIDs.contains(person.id),
                                    note: person.hasTelegram ? nil : "только в приложении"
                                )
                            }
                            .buttonStyle(.pressable)
                        }
                    }
                }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        stepper("Вопросов", value: $assignment.questionCount, range: 3...20)
                        RowDivider()
                        stepper("Из них с развёрнутым ответом", value: $assignment.openCount, range: 0...5)
                        RowDivider()
                        stepper("Порог сдачи, %", value: $assignment.passScore, range: 30...100, step: 5)
                        RowDivider()
                        Toggle("Срок сдачи", isOn: $hasDeadline)
                            .tint(Theme.brand)
                        if hasDeadline {
                            DatePicker("До", selection: $deadline, displayedComponents: [.date, .hourAndMinute])
                                .font(Typography.callout)
                        }
                    }
                }

                if let error {
                    Text(error)
                        .font(Typography.callout)
                        .foregroundStyle(Theme.negative)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                Button {
                    Task { await submit() }
                } label: {
                    if isSaving {
                        ProgressView().controlSize(.small)
                    } else {
                        Text("Назначить")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(isSaving)

                Text("Вопросы соберёт сервер из базы знаний выбранных точек. Развёрнутые ответы оценивает ИИ, последнее слово — за вами.")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .background(Theme.background)
            .navigationTitle("Новый экзамен")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
            }
        }
    }

    private func checkRow(_ title: String, checked: Bool, note: String? = nil) -> some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: checked ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(checked ? Theme.brand : Theme.textMuted)
            Text(title)
                .font(Typography.callout)
                .foregroundStyle(Theme.text)
            Spacer(minLength: Spacing.xs)
            if let note {
                Text(note)
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textMuted)
            }
        }
        .contentShape(Rectangle())
    }

    private func stepper(
        _ title: String,
        value: Binding<Int>,
        range: ClosedRange<Int>,
        step: Int = 1
    ) -> some View {
        Stepper(value: value, in: range, step: step) {
            HStack {
                Text(title)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.textDim)
                Spacer()
                Text("\(value.wrappedValue)")
                    .font(Typography.callout.weight(.semibold).monospacedDigit())
                    .foregroundStyle(Theme.text)
            }
        }
    }

    private func toggleCompany(_ id: String) {
        if let index = assignment.companyIDs.firstIndex(of: id) {
            assignment.companyIDs.remove(at: index)
            // Оператор чужой точки в списке остаться не должен: сервер такой
            // экзамен отвергнет, а человек не поймёт почему.
            let allowed = Set(availableOperators.map(\.id))
            assignment.operatorIDs.removeAll { !allowed.contains($0) }
        } else {
            assignment.companyIDs.append(id)
        }
    }

    private func toggleOperator(_ id: String) {
        if let index = assignment.operatorIDs.firstIndex(of: id) {
            assignment.operatorIDs.remove(at: index)
        } else {
            assignment.operatorIDs.append(id)
        }
    }

    private func submit() async {
        var draft = assignment
        draft.deadline = hasDeadline ? deadline : nil

        if let issue = draft.validationIssue {
            error = issue
            Haptics.error()
            return
        }

        isSaving = true
        error = nil
        defer { isSaving = false }

        do {
            _ = try await AdminExamService(api: api).create(draft)
            Haptics.success()
            await onDone()
            dismiss()
        } catch let apiError as APIError {
            Haptics.error()
            error = apiError.userMessage
        } catch {
            Haptics.error()
            self.error = error.localizedDescription
        }
    }
}
