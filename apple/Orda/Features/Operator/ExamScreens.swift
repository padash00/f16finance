import OrdaKit
import OrdaUI
import SwiftUI

/// Экзамены оператора.
///
/// Аттестация жила только в Telegram: вопросы приходили ботом, ответы —
/// кнопками под сообщением. У кого Telegram не заведён, попытка помечалась
/// «недоставлено»: человек числился обязанным сдать экзамен, которого не видел.
///
/// Здесь тот же экзамен, тот же билет и тот же подсчёт. Вопрос показывается по
/// одному и вернуться к предыдущему нельзя — иначе оценка перестаёт что-либо
/// значить.
struct ExamsScreen: View {
    @Environment(\.api) private var api

    @State private var exams: [OperatorExam] = []
    @State private var isLoading = true
    @State private var loadError: APIError?

    private var open: [OperatorExam] { exams.filter(\.isOpen) }
    private var finished: [OperatorExam] { exams.filter { !$0.isOpen } }

    var body: some View {
        ScreenScroll {
            if let loadError, exams.isEmpty {
                ErrorStateView(error: loadError) { Task { await load() } }
            } else if isLoading && exams.isEmpty {
                LoadingRows(count: 3)
            } else if exams.isEmpty {
                WideEmptyState(
                    icon: "graduationcap",
                    title: "Экзаменов нет",
                    message: "Когда руководитель назначит аттестацию, она появится здесь."
                )
            } else {
                if !open.isEmpty {
                    Card {
                        VStack(alignment: .leading, spacing: Spacing.sm) {
                            SectionHeader("Сдать", subtitle: "вопросы задаются по одному")
                            ForEach(Array(open.enumerated()), id: \.element.id) { index, exam in
                                if index > 0 { RowDivider() }
                                // По значению: список экзаменов перечитывается
                                // сам, и переход, созданный замыканием,
                                // схлопнулся бы вместе с ним.
                                NavigationLink(value: ExamRoute(id: exam.id, title: exam.title)) {
                                    ExamRow(exam: exam)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }

                if !finished.isEmpty {
                    Card {
                        VStack(alignment: .leading, spacing: Spacing.sm) {
                            SectionHeader("Сданные")
                            ForEach(Array(finished.enumerated()), id: \.element.id) { index, exam in
                                if index > 0 { RowDivider() }
                                ExamRow(exam: exam)
                            }
                        }
                    }
                }
            }
        }
        .background(Theme.background)
        .navigationTitle("Экзамены")
        .navigationDestination(for: ExamRoute.self) { route in
            ExamRunnerScreen(examID: route.id, title: route.title)
        }
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            exams = try await ExamService(api: api).exams()
            loadError = nil
        } catch let error as APIError {
            loadError = error
        } catch {
            loadError = .transport(message: error.localizedDescription)
        }
    }
}

/// Адрес экзамена.
struct ExamRoute: Hashable {
    let id: String
    let title: String
}

/// Строка экзамена: название, срок, результат.
private struct ExamRow: View {
    let exam: OperatorExam

    var body: some View {
        HStack(spacing: Spacing.md) {
            Image(systemName: exam.isCompleted ? (exam.passed == true ? "checkmark.seal.fill" : "xmark.seal.fill") : "graduationcap.fill")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(accent)
                .frame(width: 30, height: 30)
                .background(accent.opacity(0.12), in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))

            VStack(alignment: .leading, spacing: 2) {
                Text(exam.title)
                    .font(Typography.callout.weight(.semibold))
                    .foregroundStyle(Theme.text)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                Text(subtitle)
                    .font(Typography.caption)
                    .foregroundStyle(exam.isOverdue ? Theme.negative : Theme.textDim)
            }

            Spacer(minLength: 0)

            if exam.isCompleted, let score = exam.score {
                Text(Percent.format(score))
                    .font(Typography.callout.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(exam.passed == true ? Theme.positive : Theme.negative)
            } else {
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.textDim)
            }
        }
        .padding(.vertical, Spacing.xs)
        .contentShape(Rectangle())
    }

    private var accent: Color {
        if exam.isCompleted { return exam.passed == true ? Theme.positive : Theme.negative }
        return exam.isOverdue ? Theme.negative : Theme.accent(for: .operator)
    }

    private var subtitle: String {
        if exam.isCompleted {
            // Развёрнутые ответы проверяет человек — обещать окончательный балл
            // сразу было бы неправдой.
            if exam.awaitingReview { return "Ответы проверяет руководитель" }
            return exam.passed == true ? "Сдан" : "Не сдан, порог \(Percent.format(exam.passScore))"
        }
        var parts: [String] = ["осталось \(exam.remaining) из \(exam.totalQuestions)"]
        if let deadline = exam.deadlineAt {
            parts.append(exam.isOverdue ? "срок вышел" : "до \(deadline.formatted(.dateTime.day().month(.abbreviated)))")
        }
        return parts.joined(separator: " · ")
    }
}

/// Сдача экзамена: один вопрос на экране.
struct ExamRunnerScreen: View {
    let examID: String
    let title: String

    @Environment(\.api) private var api
    @Environment(\.dismiss) private var dismiss

    @State private var attempt: ExamAttempt?
    @State private var isLoading = true
    @State private var isSending = false
    @State private var loadError: APIError?
    @State private var sendError: String?
    @State private var openAnswer = ""

    var body: some View {
        ScreenScroll {
            if let loadError, attempt == nil {
                ErrorStateView(error: loadError) { Task { await load() } }
            } else if isLoading && attempt == nil {
                LoadingRows(count: 3)
            } else if let attempt {
                if let question = attempt.question, attempt.exam.isOpen {
                    progress(attempt.exam)
                    questionCard(question, exam: attempt.exam)
                } else {
                    result(attempt.exam)
                }
            }
        }
        .background(Theme.background)
        .navigationTitle(title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task { await load() }
    }

    // ── Вопрос ───────────────────────────────────────────────────────────────

    private func progress(_ exam: OperatorExam) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                HStack {
                    Text("Вопрос \(exam.currentIndex + 1) из \(exam.totalQuestions)")
                        .font(Typography.callout.weight(.semibold))
                        .foregroundStyle(Theme.text)
                    Spacer()
                    Text("порог \(Percent.format(exam.passScore))")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                }
                ProgressView(value: Double(exam.answered), total: Double(max(1, exam.totalQuestions)))
                    .tint(Theme.accent(for: .operator))
                // Вернуться к предыдущему вопросу нельзя, и человек должен
                // знать это до того, как нажмёт, а не после.
                Text("Ответ засчитывается сразу — вернуться к вопросу нельзя.")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
            }
        }
    }

    @ViewBuilder
    private func questionCard(_ question: ExamQuestion, exam: OperatorExam) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                Text(question.text)
                    .font(Typography.body)
                    .foregroundStyle(Theme.text)
                    .fixedSize(horizontal: false, vertical: true)

                if question.isOpen {
                    Text("Развёрнутый ответ · до \(Int(question.maxScore)) \(pluralize(Int(question.maxScore), "балла", "баллов", "баллов"))")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)

                    TextEditor(text: $openAnswer)
                        .font(Typography.callout)
                        .foregroundStyle(Theme.text)
                        .scrollContentBackground(.hidden)
                        .frame(minHeight: 140)
                        .padding(Spacing.sm)
                        .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))

                    Button(isSending ? "Отправляем…" : "Ответить") {
                        Task { await answer(index: question.index, text: openAnswer) }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(isSending || openAnswer.trimmingCharacters(in: .whitespacesAndNewlines).count < 15)
                } else {
                    ForEach(Array(question.choices.enumerated()), id: \.offset) { index, choice in
                        Button {
                            Task { await answer(index: question.index, choice: index) }
                        } label: {
                            HStack(alignment: .top, spacing: Spacing.md) {
                                Text(letter(index))
                                    .font(Typography.callout.weight(.bold))
                                    .foregroundStyle(Theme.accent(for: .operator))
                                    .frame(width: 24, height: 24)
                                    .background(
                                        Theme.accent(for: .operator).opacity(0.12),
                                        in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous)
                                    )
                                Text(choice)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.text)
                                    .multilineTextAlignment(.leading)
                                    .fixedSize(horizontal: false, vertical: true)
                                Spacer(minLength: 0)
                            }
                            .padding(Spacing.md)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
                        }
                        .buttonStyle(.plain)
                        .disabled(isSending)
                    }
                }

                if let sendError {
                    Text(sendError)
                        .font(Typography.caption)
                        .foregroundStyle(Theme.negative)
                }
            }
        }
    }

    // ── Итог ─────────────────────────────────────────────────────────────────

    private func result(_ exam: OperatorExam) -> some View {
        VStack(spacing: Spacing.lg) {
            Card(accent: exam.passed == true ? Theme.positive : Theme.negative) {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    Label(
                        exam.passed == true ? "Экзамен сдан" : "Экзамен не сдан",
                        systemImage: exam.passed == true ? "checkmark.seal.fill" : "xmark.seal.fill"
                    )
                    .font(Typography.title)
                    .foregroundStyle(exam.passed == true ? Theme.positive : Theme.negative)

                    if let score = exam.score {
                        StatRow("Результат", value: Percent.format(score), emphasized: true)
                    }
                    StatRow("Порог", value: Percent.format(exam.passScore))

                    if exam.awaitingReview {
                        // Балл за развёрнутый ответ предлагает ИИ, а решает
                        // человек: обещать окончательный итог сразу нельзя.
                        Text("Развёрнутые ответы проверит руководитель — итог может измениться.")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textMuted)
                    }
                }
            }

            // Правильные ответы не показываем: билет один на всех сдающих, и
            // разбор с ответами утёк бы следующему через пересылку скриншота.
            Text("Разбор ошибок — у руководителя. Он же скажет, что перечитать.")
                .font(Typography.caption)
                .foregroundStyle(Theme.textDim)
                .frame(maxWidth: .infinity, alignment: .leading)

            Button("Готово") { dismiss() }
                .buttonStyle(SecondaryButtonStyle())
        }
    }

    // ── Действия ─────────────────────────────────────────────────────────────

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            attempt = try await ExamService(api: api).examAttempt(id: examID)
            loadError = nil
        } catch let error as APIError {
            loadError = error
        } catch {
            loadError = .transport(message: error.localizedDescription)
        }
    }

    private func answer(index: Int, choice: Int? = nil, text: String? = nil) async {
        guard !isSending else { return }
        isSending = true
        defer { isSending = false }
        sendError = nil

        do {
            attempt = try await ExamService(api: api).answerExam(
                id: examID,
                index: index,
                choice: choice,
                text: text
            )
            openAnswer = ""
            Haptics.success()
        } catch let error as APIError {
            sendError = error.userMessage
            Haptics.error()
        } catch {
            sendError = error.localizedDescription
            Haptics.error()
        }
    }

    private func letter(_ index: Int) -> String {
        let letters = ["А", "Б", "В", "Г", "Д"]
        return index < letters.count ? letters[index] : String(index + 1)
    }
}
