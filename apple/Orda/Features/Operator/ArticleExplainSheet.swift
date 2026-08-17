import OrdaKit
import OrdaUI
import SwiftUI

/// «Объясни проще» по статье регламента.
///
/// Регламент пишет владелец, а читает оператор в свою первую смену:
/// «материальная ответственность за недостачу» ему ничего не говорит, и
/// спросить он постесняется — переспрашивать при всех неловко.
///
/// Отвечает сервер строго по тексту статьи. Если в правиле ответа нет, так и
/// будет сказано: выдуманный порядок действий хуже непонятного — по нему
/// человек пойдёт и сделает не то.
struct ArticleExplainSheet: View {
    let article: KnowledgeArticle

    @Environment(\.dismiss) private var dismiss
    @Environment(CabinetStore.self) private var cabinet

    @State private var question = ""
    @State private var answer: String?
    @State private var isAsking = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScreenScroll {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.xxs) {
                        FieldLabel("Правило")
                        Text(article.title)
                            .font(Typography.title)
                            .foregroundStyle(Theme.text)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                if isAsking && answer == nil {
                    LoadingRows(count: 2)
                } else if let answer {
                    Card {
                        VStack(alignment: .leading, spacing: Spacing.sm) {
                            ForEach(Array(lines(answer).enumerated()), id: \.offset) { _, line in
                                Text(line)
                                    .font(Typography.body)
                                    .foregroundStyle(Theme.text)
                                    .fixedSize(horizontal: false, vertical: true)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                    }

                    Text("Это пересказ правила, а не новое правило. Спорные случаи решает руководитель.")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textMuted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        FieldLabel("Спросить по этому правилу")
                        TextField("Например: а если гость уже ушёл?", text: $question, axis: .vertical)
                            .textFieldStyle(.plain)
                            .lineLimit(1...3)
                            .padding(Spacing.md)
                            .background(
                                Theme.surfaceRaised,
                                in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
                            )
                    }
                }

                if let error {
                    Text(error)
                        .font(Typography.callout)
                        .foregroundStyle(Theme.negative)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Button {
                    Task { await ask() }
                } label: {
                    if isAsking {
                        ProgressView().controlSize(.small)
                    } else {
                        Text(answer == nil ? "Объяснить проще" : "Спросить")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(isAsking)
            }
            .background(Theme.background)
            .navigationTitle("Проще")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Готово") { dismiss() }
                }
            }
            // Первое объяснение просим сразу: человек открыл лист ровно за
            // этим, и лишнее нажатие здесь ничего не решает.
            .task {
                guard answer == nil, !isAsking else { return }
                await ask()
            }
        }
    }

    /// Ответ приходит списком пунктов — разбираем его на строки, чтобы каждая
    /// стояла отдельно, а не слиплась в абзац.
    private func lines(_ text: String) -> [String] {
        text
            .split(separator: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    private func ask() async {
        isAsking = true
        error = nil
        defer { isAsking = false }

        let trimmed = question.trimmingCharacters(in: .whitespaces)
        switch await cabinet.explainArticle(id: article.id, question: trimmed.isEmpty ? nil : trimmed) {
        case let .answer(text):
            answer = text
            question = ""
            Haptics.success()
        case let .failure(message):
            error = message
            Haptics.error()
        }
    }
}
