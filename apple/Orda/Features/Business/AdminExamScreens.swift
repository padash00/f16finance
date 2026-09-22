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
    @Environment(AuthStore.self) private var auth

    /// Права решают, что человек видит. Кнопка, которую сервер отвергнет,
    /// хуже её отсутствия: человек считает, что сломалось приложение.
    private var canCreate: Bool { auth.resolver?.can("operator-exams.create") ?? false }

    @State private var overview: AdminExamsOverview?
    @State private var loadError: APIError?
    @State private var isLoading = false
    @State private var assigning = false
    @State private var selected: AdminExam?

    var body: some View {
        Group {
            if let loadError {
                ErrorStateView(error: loadError) { Task { await load() } }
            } else if isLoading && overview == nil {
                LoadingRows(count: 3)
            } else {
                // Список слева, разбор справа — как в остальных разделах. На
                // планшете переход «открыл попытки — вернулся — открыл
                // следующий экзамен» лишний: обе части помещаются рядом.
                MasterDetail(
                    items: overview?.exams ?? [],
                    selection: $selected,
                    listWidth: 360
                ) { exam in
                    examCard(exam, companies: overview?.companies ?? [])
                } detail: { exam in
                    AdminExamDetailScreen(
                        examID: exam.id,
                        operators: overview?.operators ?? []
                    )
                } empty: {
                    WideEmptyState(
                        icon: "graduationcap",
                        title: "Экзаменов пока нет",
                        message: "Вопросы собираются из базы знаний вашей точки — списать со стороны нельзя."
                    )
                }
            }
        }
        .navigationTitle("Экзамены операторов")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                if canCreate {
                    Button {
                        assigning = true
                    } label: {
                        Image(systemName: "plus")
                    }
                    .disabled(overview == nil)
                }
            }
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

    /// Строка экзамена как операция в выписке: иконка в кружке, название,
    /// точки подписью, статус цветом справа; под ними — сколько сдали.
    private func examCard(_ exam: AdminExam, companies: [Company]) -> some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            TintedIcon(
                systemName: "graduationcap.fill",
                tint: exam.isSent ? Color(hex: 0x4F46E5) : Theme.textDim
            )

            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                    Text(exam.title)
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(Theme.text)
                        .lineLimit(2)
                    Spacer(minLength: Spacing.sm)
                    Text(exam.statusLabel)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(exam.isSent ? Theme.positive : Theme.warning)
                        .fixedSize()
                }

                Text(pointNames(exam.companyIDs, companies: companies))
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)

                HStack(spacing: Spacing.lg) {
                    stat("Назначено", "\(exam.assigned)")
                    stat("Сдали", "\(exam.passed) из \(exam.completed)")
                    if let average = exam.averageScore {
                        stat("Средний", "\(average)%")
                    }
                }
                .padding(.top, 2)

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
        .padding(.vertical, Spacing.xs)
        .contentShape(Rectangle())
    }

    private func stat(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(title)
                .font(.system(size: 12))
                .foregroundStyle(Theme.textDim)
            Text(value)
                .font(.system(size: 15, weight: .semibold, design: .rounded))
                .monospacedDigit()
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

// ── Один экзамен ─────────────────────────────────────────────────────────────

struct AdminExamDetailScreen: View {
    let examID: String
    let operators: [AdminExamsOverview.ExamOperator]

    @Environment(\.api) private var api
    @Environment(AuthStore.self) private var auth

    /// Рассылка и пересдача — то же право: и то и другое отправляет человеку
    /// билет.
    private var canSend: Bool { auth.resolver?.can("operator-exams.create") ?? false }
    private var canRemind: Bool { auth.resolver?.can("operator-exams.remind") ?? false }
    /// Завершить или отменить — одно право: и то и другое закрывает экзамен.
    private var canFinish: Bool { auth.resolver?.can("operator-exams.cancel") ?? false }
    @State private var closing: Bool?

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
                hero(detail.exam)

                actionsCard(detail.exam)

                if let message {
                    OwnerSection("Не получилось") {
                        Text(message)
                            .font(.system(size: 15))
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
                    OwnerSection("Билеты") {
                        Text("\(detail.attempts.count) \(pluralize(detail.attempts.count, "человек", "человека", "человек"))")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textDim)
                    } content: {
                        VStack(spacing: Spacing.sm) {
                            ForEach(detail.attempts) { attempt in
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
        .alert(
            closing == true ? "Отменить экзамен?" : "Завершить экзамен?",
            isPresented: .constant(closing != nil)
        ) {
            Button(closing == true ? "Отменить экзамен" : "Завершить", role: closing == true ? .destructive : nil) {
                let cancelled = closing == true
                closing = nil
                Task { await run { try await AdminExamService(api: api).finish(examID: examID, cancelled: cancelled) } }
            }
            Button("Назад", role: .cancel) { closing = nil }
        } message: {
            Text(closing == true
                ? "Незавершённые билеты пропадут, результаты сдавших останутся в истории."
                : "Кто не успел — не успел: экзамен закроется, результаты сдавших останутся.")
        }
    }

    /// Сколько сдали — главная цифра экзамена, назначено и средний балл —
    /// подписи. Карточка зелёная, когда сдали все, кто дошёл до конца.
    private func hero(_ exam: AdminExam) -> some View {
        let allPassed = exam.completed > 0 && exam.passed == exam.completed
        return HeroSummary(
            title: "Сдали",
            value: "\(exam.passed) из \(exam.completed)",
            caption: "\(exam.questionCount) вопросов, порог \(exam.passScore)%",
            footer: [
                ("Назначено", "\(exam.assigned)"),
                ("Средний балл", exam.averageScore.map { "\($0)%" } ?? "—"),
                ("Статус", exam.statusLabel.isEmpty ? "—" : exam.statusLabel),
            ],
            colors: allPassed
                ? Theme.heroGradient
                : Theme.heroGradient
        )
    }

    /// Действия строками с иконкой в кружке — как меню счёта в банке.
    @ViewBuilder
    private func actionsCard(_ exam: AdminExam) -> some View {
        let canClose = canFinish && exam.status != "closed" && exam.status != "cancelled"
        if (!exam.isSent && canSend) || (exam.isSent && canRemind) || canClose {
            OwnerSection("Действия") {
                if busy { ProgressView().controlSize(.small) }
            } content: {
                VStack(spacing: Spacing.sm) {
                    if !exam.isSent, canSend {
                        // Черновик существует, чтобы посмотреть вопросы до
                        // рассылки. Отозвать разосланный билет уже нельзя.
                        Button {
                            Task { await run { try await AdminExamService(api: api).send(examID: examID) } }
                        } label: {
                            actionRow("paperplane.fill", "Разослать билеты", tint: Color(hex: 0x4F46E5))
                        }
                        .buttonStyle(.pressable)
                        .disabled(busy)
                    } else if exam.isSent, canRemind {
                        Button {
                            Task { await run { try await AdminExamService(api: api).remind(examID: examID) } }
                        } label: {
                            actionRow("bell.fill", "Напомнить не сдавшим", tint: Color(hex: 0xF59E0B))
                        }
                        .buttonStyle(.pressable)
                        .disabled(busy)
                    }

                    // Закрыть экзамен. Завершение — норма: все сдали, ждать
                    // остальных незачем. Отмена — ошиблись при назначении. Оба
                    // оставляют экзамен в истории.
                    if canClose {
                        Button { closing = false } label: {
                            actionRow("checkmark.circle.fill", "Завершить", tint: Theme.positive)
                        }
                        .buttonStyle(.pressable)
                        .disabled(busy)
                        Button { closing = true } label: {
                            actionRow("xmark.circle.fill", "Отменить экзамен", tint: Theme.negative, destructive: true)
                        }
                        .buttonStyle(.pressable)
                        .disabled(busy)
                    }
                }
            }
        }
    }

    private func actionRow(_ icon: String, _ title: String, tint: Color, destructive: Bool = false) -> some View {
        HStack(spacing: Spacing.md) {
            TintedIcon(systemName: icon, tint: tint)
            Text(title)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(destructive ? Theme.negative : Theme.text)
            Spacer(minLength: Spacing.sm)
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.textDim)
        }
        .padding(.vertical, Spacing.xs)
        .contentShape(Rectangle())
    }

    private func attemptRow(_ attempt: AdminExamAttempt) -> some View {
        let person = name(for: attempt.operatorID)
        return HStack(spacing: Spacing.md) {
            PersonInitial(name: person, size: 40)

            VStack(alignment: .leading, spacing: 2) {
                Text(person)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                HStack(spacing: Spacing.xs) {
                    Text(attempt.statusLabel)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(color(for: attempt))
                    if let correct = attempt.correctAnswers, let total = attempt.totalQuestions, total > 0 {
                        Text("· \(correct) из \(total)")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textDim)
                    }
                }
            }

            Spacer(minLength: Spacing.sm)

            if let score = attempt.score {
                Text("\(score)%")
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(color(for: attempt))
            }

            // Пересдача собирает новый билет: тот же список вопросов человек
            // уже видел, и повтор проверял бы память о разборе, а не знание.
            if attempt.isFinished, attempt.passed != true, canSend {
                Button {
                    Task { await run { try await AdminExamService(api: api).retake(attemptID: attempt.id) } }
                } label: {
                    TintedIcon(systemName: "arrow.clockwise", tint: Color(hex: 0x3B82F6), size: 32)
                }
                .buttonStyle(.pressable)
                .disabled(busy)
                .accessibilityLabel("Пересдача")
            }
        }
        .padding(.vertical, 2)
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
                OwnerSection("Название") {
                    TextField("Аттестация по регламентам", text: $assignment.title)
                        .textFieldStyle(.plain)
                        .padding(Spacing.md)
                        .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
                }

                OwnerSection("Точки") {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        Text("Вопросы берутся из их базы знаний")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textDim)
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

                OwnerSection("Кому") {
                    if !assignment.operatorIDs.isEmpty {
                        Text("выбрано \(assignment.operatorIDs.count)")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(Theme.textDim)
                    }
                } content: {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        if availableOperators.isEmpty {
                            Text("Сначала выберите точку")
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.textDim)
                        }
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

                OwnerSection("Условия") {
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
        HStack(spacing: Spacing.md) {
            Image(systemName: checked ? "checkmark.circle.fill" : "circle")
                .font(.system(size: 22))
                .foregroundStyle(checked ? Theme.brand : Theme.textDim)
            Text(title)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(Theme.text)
            Spacer(minLength: Spacing.xs)
            if let note {
                Text(note)
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textMuted)
            }
        }
        .padding(.vertical, 2)
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
