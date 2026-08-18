import OrdaKit
import OrdaUI
import SwiftUI

/// База знаний: список статей слева, текст справа.
///
/// На большом экране читают подряд — открыл одну, тут же следующую. Переход
/// «назад в список» между каждой статьёй только мешает.
///
/// Список был плоским: два десятка одинаковых строк подряд, а то, что четыре
/// из них требуют подтверждения, читалось по тонкой синей полоске слева и
/// значку «подтвердить», похожему на кнопку. Оператор в начале смены не видел
/// главного — сколько ему осталось прочитать и что именно.
struct KnowledgeScreen: View {
    @Environment(CabinetStore.self) private var cabinet
    @Environment(\.surface) private var surface

    @State private var selected: KnowledgeArticle?
    @State private var search = ""

    /// Все статьи: сначала непрочитанные, потом важные, потом остальные.
    private var ordered: [KnowledgeArticle] {
        guard let knowledge = cabinet.knowledge else { return [] }
        let pending = knowledge.pendingConfirmations
        let pendingIDs = Set(pending.map(\.id))
        let rest = knowledge.articles.filter { !pendingIDs.contains($0.id) }
        // Важное выше обычного: правила про кассу и безопасность ищут в спешке.
        let critical = rest.filter(\.isCritical)
        let ordinary = rest.filter { !$0.isCritical }
        return pending + critical + ordinary
    }

    /// Поиск по названию и краткому описанию.
    ///
    /// Статей десятки, а нужную ищут в конкретной ситуации — «не работает
    /// компьютер», «долг клиента». Листать до неё в такой момент некогда.
    private var articles: [KnowledgeArticle] {
        let query = search.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else { return ordered }
        return ordered.filter { article in
            article.title.localizedCaseInsensitiveContains(query)
                || (article.summary ?? "").localizedCaseInsensitiveContains(query)
        }
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
                title: search.isEmpty ? "Статей нет" : "Ничего не нашлось",
                message: search.isEmpty
                    ? "База знаний для вашей точки пока пуста."
                    : "По запросу «\(search)» статей нет."
            )
        } header: {
            KnowledgeSummary(
                pending: pendingIDs.count,
                total: cabinet.knowledge?.articles.count ?? 0
            )
        }
        .searchable(text: $search, prompt: "Найти статью")
        .navigationTitle("Знания")
        .toolbar { LogoutToolbarItem() }
        .task { if cabinet.knowledge == nil { await cabinet.loadKnowledge() } }
        .refreshable { await cabinet.loadKnowledge() }
    }
}

/// Сводка над списком.
///
/// Отвечает на единственный вопрос, с которым сюда заходят в начале смены:
/// «сколько мне ещё читать». Раньше это число было только значком на вкладке.
private struct KnowledgeSummary: View {
    let pending: Int
    let total: Int

    var body: some View {
        Card(accent: pending > 0 ? Theme.info : nil) {
            HStack(spacing: Spacing.md) {
                Image(systemName: pending > 0 ? "book.pages" : "checkmark.seal.fill")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(pending > 0 ? Theme.info : Theme.positive)
                    .frame(width: 34, height: 34)
                    .background(
                        (pending > 0 ? Theme.info : Theme.positive).opacity(0.12),
                        in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous)
                    )

                VStack(alignment: .leading, spacing: 2) {
                    Text(pending > 0
                        ? "\(pending) \(pluralize(pending, "статья ждёт", "статьи ждут", "статей ждут")) подтверждения"
                        : "Всё прочитано")
                        .font(Typography.callout.weight(.semibold))
                        .foregroundStyle(Theme.text)
                    Text(pending > 0
                        ? "Они наверху списка. Откройте и подтвердите — это фиксируется по версии правила."
                        : "В базе \(total) \(pluralize(total, "статья", "статьи", "статей")). Пригодится, когда что-то пойдёт не так.")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                }

                Spacer(minLength: 0)
            }

            // Полоса прогресса, а не только число: «осталось 27» звучит как
            // приговор, «14 из 27 подтверждено» — как работа, которая идёт.
            if total > 0, pending > 0 {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    GeometryReader { proxy in
                        ZStack(alignment: .leading) {
                            Capsule()
                                .fill(Theme.info.opacity(0.15))
                            Capsule()
                                .fill(Theme.info)
                                .frame(width: max(4, proxy.size.width * ratio))
                        }
                    }
                    .frame(height: 6)

                    Text("\(total - pending) из \(total) подтверждено")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textMuted)
                }
                .padding(.top, Spacing.sm)
            }
        }
    }

    /// Доля подтверждённого. Ноль статей — делить не на что.
    private var ratio: Double {
        guard total > 0 else { return 0 }
        return Double(total - pending) / Double(total)
    }
}

/// Строка статьи в списке.
///
/// Карточка со значком слева — как в остальном приложении. Значок несёт
/// состояние: непрочитанное синим, важное жёлтым, прочитанное спокойным серым.
/// Раньше состояние читалось значком «подтвердить», который выглядел кнопкой,
/// хотя нажимать надо было саму строку.
struct ArticleRow: View {
    let article: KnowledgeArticle
    let needsConfirmation: Bool

    private var accent: Color {
        if needsConfirmation { return Theme.info }
        if article.isCritical { return Theme.warning }
        return Theme.textDim
    }

    private var icon: String {
        if needsConfirmation { return "exclamationmark.circle.fill" }
        if article.isCritical { return "exclamationmark.triangle.fill" }
        return "doc.text"
    }

    var body: some View {
        Card(padding: Spacing.md, accent: needsConfirmation ? Theme.info : nil) {
            HStack(alignment: .top, spacing: Spacing.md) {
                Image(systemName: icon)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(accent)
                    .frame(width: 30, height: 30)
                    .background(
                        accent.opacity(0.12),
                        in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous)
                    )

                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text(article.title)
                        .font(Typography.callout.weight(.semibold))
                        .foregroundStyle(Theme.text)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)

                    if let summary = article.summary, !summary.isEmpty {
                        Text(summary)
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textMuted)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    HStack(spacing: Spacing.xs) {
                        if needsConfirmation {
                            Text("нужно подтвердить")
                                .font(Typography.caption.weight(.semibold))
                                .foregroundStyle(Theme.info)
                        } else if article.isCritical {
                            Text("важное")
                                .font(Typography.caption.weight(.semibold))
                                .foregroundStyle(Theme.warning)
                        }
                    }
                }

                Spacer(minLength: 0)

                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.textDim)
                    .padding(.top, Spacing.xs)
            }
        }
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
    @State private var explaining = false

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
                    // Регламент читают не как книгу, а глазами по диагонали,
                    // ища нужный кусок. Воздуха между блоками больше обычного:
                    // сплошная простыня заставляет перечитывать.
                    VStack(alignment: .leading, spacing: Spacing.lg) {
                        ForEach(blocks) { block in
                            blockView(block)
                        }
                    }
                }

            }
            // Ширина строки ограничена намеренно: текст на 1400 точек читать
            // невозможно, глаз теряет начало следующей строки.
            .frame(maxWidth: 680, alignment: .leading)
            .padding(Spacing.xxl)
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .background(Theme.background)
        // Подтверждение закреплено снизу, а не спрятано в конце текста: у
        // длинного регламента до него надо было домотать, и человек уходил,
        // прочитав, но не подтвердив, — а смену это потом не давало закрыть.
        .safeAreaInset(edge: .bottom) {
            if needsConfirmation {
                confirmBar
            }
        }
        .navigationTitle("Статья")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        // «Объясни проще» — в панели, а не в тексте: за ним тянутся, когда уже
        // прочитали и не поняли, и искать кнопку в конце длинного регламента
        // человек не станет.
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    explaining = true
                } label: {
                    Label("Проще", systemImage: "text.bubble")
                }
            }
        }
        .sheet(isPresented: $explaining) {
            ArticleExplainSheet(article: article)
        }
    }

    /// Можно ли подтвердить прочтение.
    ///
    /// Подтверждение пишется на карточку сотрудника, и если аккаунт оператора
    /// с ней не связан, сервер откажет — сколько ни нажимай. Показывать в этом
    /// случае кнопку значит обещать то, чего не будет.
    private var canConfirm: Bool { cabinet.knowledge?.canConfirm ?? true }

    /// Полоса подтверждения над нижним краем.
    @ViewBuilder
    private var confirmBar: some View {
        if canConfirm {
            confirmControls
        } else {
            VStack(spacing: Spacing.xs) {
                Text("Подтвердить прочтение пока нельзя")
                    .font(Typography.callout.weight(.medium))
                    .foregroundStyle(Theme.text)
                Text("Ваш аккаунт не связан с карточкой сотрудника. Скажите руководителю — он свяжет её в разделе «Команда», и подтверждение заработает.")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textMuted)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: 680)
            .frame(maxWidth: .infinity)
            .padding(Spacing.lg)
            .background(.bar)
        }
    }

    private var confirmControls: some View {
        VStack(spacing: Spacing.sm) {
            if let error {
                Text(error)
                    .font(Typography.caption)
                    .foregroundStyle(Theme.negative)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            Button {
                Task { await confirm() }
            } label: {
                if isConfirming {
                    ProgressView().controlSize(.small)
                } else {
                    Text("Прочитал и понял")
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(isConfirming)

            Text("Подтверждение привязано к версии \(article.version): если правила изменят, вас попросят прочитать заново.")
                .font(Typography.caption)
                .foregroundStyle(Theme.textMuted)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: 680)
        .frame(maxWidth: .infinity)
        .padding(Spacing.lg)
        .background(.bar)
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

        case .tableHeader:
            // Шапку таблицы показываем подписью, а не строкой данных: она
            // объясняет колонки, а не содержит правило.
            Text(block.cells.joined(separator: " · ").uppercased())
                .font(Typography.label)
                .foregroundStyle(Theme.textDim)
                .padding(.top, Spacing.sm)

        case .tableRow:
            // Регламенты пишут таблицами «ситуация — правило». На телефоне
            // две колонки не помещаются, поэтому левая ячейка становится
            // заголовком строки, остальные — текстом под ней. Так читается и
            // на узком экране, и на планшете.
            VStack(alignment: .leading, spacing: Spacing.xs) {
                if let head = block.cells.first {
                    Text(head)
                        .font(Typography.body.weight(.semibold))
                        .foregroundStyle(Theme.text)
                }
                ForEach(Array(block.cells.dropFirst().enumerated()), id: \.offset) { _, cell in
                    Text(cell)
                        .font(Typography.body)
                        .foregroundStyle(Theme.textMuted)
                        .textSelection(.enabled)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Spacing.md)
            .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))

        case .paragraph:
            Text(block.text)
                .font(Typography.body)
                .foregroundStyle(Theme.textMuted)
                // Межстрочный интервал: строки регламента длинные, и без него
                // глаз теряет начало следующей.
                .lineSpacing(4)
                .textSelection(.enabled)
        }
    }

    private func confirm() async {
        isConfirming = true
        error = nil
        defer { isConfirming = false }

        if let failure = await cabinet.confirmArticle(article) {
            error = failure
            Haptics.error()
        } else {
            Haptics.success()
        }
    }
}
