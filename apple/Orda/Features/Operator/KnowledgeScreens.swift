import OrdaKit
import OrdaUI
import SwiftUI

/// База знаний: список статей слева, текст справа.
///
/// На большом экране читают подряд — открыл одну, тут же следующую. Переход
/// «назад в список» между каждой статьёй только мешает.
struct KnowledgeScreen: View {
    @Environment(CabinetStore.self) private var cabinet
    @Environment(\.surface) private var surface

    @State private var selected: KnowledgeArticle?

    private var articles: [KnowledgeArticle] {
        guard let knowledge = cabinet.knowledge else { return [] }
        // Требующие подтверждения — наверх: их читают не по желанию.
        let pending = knowledge.pendingConfirmations
        let rest = knowledge.articles.filter { article in
            !pending.contains { $0.id == article.id }
        }
        return pending + rest
    }

    private var pendingIDs: Set<String> {
        Set((cabinet.knowledge?.pendingConfirmations ?? []).map(\.id))
    }

    var body: some View {
        MasterDetail(
            items: articles,
            selection: $selected,
            listWidth: 360
        ) { article in
            ArticleRow(article: article, needsConfirmation: pendingIDs.contains(article.id))
        } detail: { article in
            ArticleReader(article: article, needsConfirmation: pendingIDs.contains(article.id))
        } empty: {
            WideEmptyState(
                icon: "book.closed",
                title: "Статей нет",
                message: "База знаний для вашей точки пока пуста."
            )
        }
        .navigationTitle("Знания")
        .toolbar { LogoutToolbarItem() }
        .task { if cabinet.knowledge == nil { await cabinet.loadKnowledge() } }
        .refreshable { await cabinet.loadKnowledge() }
    }
}

/// Строка статьи в списке.
struct ArticleRow: View {
    let article: KnowledgeArticle
    let needsConfirmation: Bool

    var body: some View {
        HStack(spacing: Spacing.md) {
            RoundedRectangle(cornerRadius: 2)
                .fill(needsConfirmation ? Theme.info : .clear)
                .frame(width: 3)

            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(article.title)
                    .font(Typography.callout.weight(.medium))
                    .foregroundStyle(Theme.text)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)

                if let summary = article.summary, !summary.isEmpty {
                    Text(summary)
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }

                if needsConfirmation {
                    StatusChip("подтвердить", kind: .info)
                } else if article.isCritical {
                    StatusChip("важное", kind: .warning)
                }
            }

            Spacer(minLength: 0)
        }
        .padding(Spacing.md)
        .contentShape(Rectangle())
    }
}

/// Текст статьи с разобранной разметкой.
struct ArticleReader: View {
    let article: KnowledgeArticle
    let needsConfirmation: Bool

    @Environment(CabinetStore.self) private var cabinet
    @State private var isConfirming = false
    @State private var error: String?

    private var blocks: [RichText.Block] {
        let parsed = RichText.blocks(from: article.body)
        if !parsed.isEmpty { return parsed }
        guard let summary = article.summary, !summary.isEmpty else { return [] }
        return [RichText.Block(kind: .paragraph, text: summary)]
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    Text(article.title)
                        .font(.system(.title, design: .rounded).weight(.bold))
                        .foregroundStyle(Theme.text)

                    HStack(spacing: Spacing.sm) {
                        if article.isCritical { StatusChip("важное", kind: .warning) }
                        Text("версия \(article.version)")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                    }
                }

                if blocks.isEmpty {
                    Text("У статьи нет текста.")
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textDim)
                } else {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        ForEach(blocks) { block in
                            blockView(block)
                        }
                    }
                }

                if needsConfirmation { confirmCard }

                if let error {
                    Text(error).font(Typography.callout).foregroundStyle(Theme.negative)
                }
            }
            // Ширина строки ограничена намеренно: текст на 1400 точек читать
            // невозможно, глаз теряет начало следующей строки.
            .frame(maxWidth: 680, alignment: .leading)
            .padding(Spacing.xxl)
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .background(Theme.background)
        .navigationTitle("Статья")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }

    @ViewBuilder
    private func blockView(_ block: RichText.Block) -> some View {
        switch block.kind {
        case .heading:
            Text(block.text)
                .font(Typography.title)
                .foregroundStyle(Theme.text)
                .padding(.top, Spacing.sm)

        case .listItem:
            HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                Circle()
                    .fill(Theme.brand)
                    .frame(width: 5, height: 5)
                    .offset(y: -3)
                Text(block.text)
                    .font(Typography.body)
                    .foregroundStyle(Theme.textMuted)
            }

        case .quote:
            HStack(alignment: .top, spacing: Spacing.md) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(Theme.brand.opacity(0.6))
                    .frame(width: 3)
                Text(block.text)
                    .font(Typography.body)
                    .italic()
                    .foregroundStyle(Theme.textMuted)
            }

        case .paragraph:
            Text(block.text)
                .font(Typography.body)
                .foregroundStyle(Theme.textMuted)
                .textSelection(.enabled)
        }
    }

    private var confirmCard: some View {
        Card(accent: Theme.info) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                Text("Подтвердите, что прочитали")
                    .font(Typography.callout.weight(.semibold))
                    .foregroundStyle(Theme.text)
                Text("Подтверждение привязано к версии \(article.version): если правила изменят, вас попросят прочитать заново.")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)

                Button {
                    confirm()
                } label: {
                    if isConfirming {
                        ProgressView().controlSize(.small)
                    } else {
                        Text("Прочитал и понял")
                    }
                }
                .buttonStyle(PrimaryButtonStyle(tint: Theme.info))
                .disabled(isConfirming)
            }
        }
    }

    private func confirm() {
        isConfirming = true
        Task {
            if let failure = await cabinet.confirmArticle(article) {
                error = failure
                Haptics.error()
            } else {
                Haptics.success()
            }
            isConfirming = false
        }
    }
}
