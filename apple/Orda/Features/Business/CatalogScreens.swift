import OrdaKit
import OrdaUI
import SwiftUI

// ── Категории расходов ───────────────────────────────────────────────────────

/// Статьи расходов: бюджет месяца против факта.
///
/// Наверху — то, что уже вышло за лимит: смысл бюджета в том, чтобы узнать о
/// перерасходе до конца месяца, а не после. Статьи без бюджета идут отдельным
/// списком: их не с чем сравнивать, и мешать их с остальными значило бы
/// показывать «0 % израсходовано» там, где лимита просто нет.
struct ExpenseCategoriesScreen: View {
    @Environment(BusinessStore.self) private var store

    var body: some View {
        ScreenScroll {
            if let error = store.categoriesError, store.expenseCategories.isEmpty {
                ErrorStateView(error: error) { Task { await store.loadCategories() } }
            } else if store.isLoadingCategories && store.expenseCategories.isEmpty {
                LoadingRows(count: 8)
            } else if store.expenseCategories.isEmpty {
                WideEmptyState(
                    icon: "tag",
                    title: "Категорий нет",
                    message: "Заведите статьи расходов, чтобы видеть структуру трат."
                )
            } else {
                content
            }
        }
        .background(Theme.background)
        .navigationTitle("Категории")
        .toolbar { LogoutToolbarItem() }
        .task { await store.loadCategories() }
        .refreshable { await store.loadCategories() }
    }

    private var content: some View {
        let all = store.expenseCategories
        let budgeted = all.filter(\.hasBudget)
        let over = budgeted.filter(\.isOverBudget)
        let near = budgeted.filter(\.isNearLimit)
        let free = all.filter { !$0.hasBudget }

        let spent = all.reduce(0) { $0 + $1.spentThisMonth }
        let budget = budgeted.reduce(0) { $0 + $1.monthlyBudget }

        return VStack(spacing: Spacing.lg) {
            // Потраченное — главная цифра, бюджет и перерасход — её контекст.
            // Карточка краснеет, если хоть одна статья вышла за лимит: об этом
            // надо узнать до конца месяца, а не прочитать мелким шрифтом.
            HeroSummary(
                title: "Потрачено за месяц",
                value: Money.format(spent),
                caption: over.isEmpty
                    ? "все статьи в пределах бюджета"
                    : "\(over.count) \(pluralize(over.count, "статья", "статьи", "статей")) сверх бюджета",
                footer: [
                    ("Бюджет месяца", Money.format(budget)),
                    ("Превышено", "\(over.count)"),
                    ("Близко к лимиту", "\(near.count)"),
                ],
                colors: over.isEmpty
                    ? [Color(hex: 0x4F46E5), Color(hex: 0x7C3AED)]
                    : [Color(hex: 0xE11D48), Color(hex: 0x9F1239)]
            )

            if !over.isEmpty {
                categoryCard("Превышен бюджет", rows: over, accent: Theme.negative)
            }
            if !near.isEmpty {
                categoryCard("Близко к лимиту", rows: near, accent: Theme.warning)
            }

            let rest = budgeted.filter { !$0.isOverBudget && !$0.isNearLimit }
            if !rest.isEmpty {
                categoryCard("В пределах бюджета", rows: rest, accent: nil)
            }

            if !free.isEmpty {
                let sortedFree = free.sorted { $0.spentThisMonth > $1.spentThisMonth }
                let maxFree = max(sortedFree.first?.spentThisMonth ?? 0, 1)
                OwnerSection("Без бюджета") {
                    Text("сравнивать не с чем")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textDim)
                } content: {
                    VStack(spacing: 0) {
                        ForEach(Array(sortedFree.enumerated()), id: \.element.id) { index, category in
                            if index > 0 { PlainRowDivider(inset: 52) }
                            // Доля от самой крупной статьи: без лимита сравнивать
                            // больше не с чем, а масштаб трат виден сразу.
                            AmountRow(
                                leading: { LetterBadge(text: category.name, tint: Theme.textMuted) },
                                title: category.name,
                                subtitle: category.groupLabel,
                                amount: Money.format(category.spentThisMonth),
                                share: category.spentThisMonth / maxFree,
                                tint: Theme.textMuted
                            )
                            .padding(.vertical, Spacing.xs)
                        }
                    }
                }
            }
        }
    }

    /// Группа статей белым блоком; цвет группы — у счётчика в заголовке,
    /// а не полосой по краю карточки: так тише, и цвет всё равно читается.
    private func categoryCard(_ title: String, rows: [ExpenseCategory], accent: Color?) -> some View {
        let sorted = rows.sorted { ($0.usage ?? 0) > ($1.usage ?? 0) }

        return OwnerSection(title) {
            Text("\(sorted.count)")
                .font(.system(size: 15, weight: .semibold, design: .rounded))
                .foregroundStyle(accent ?? Theme.textDim)
        } content: {
            VStack(spacing: 0) {
                ForEach(Array(sorted.enumerated()), id: \.element.id) { index, category in
                    if index > 0 { PlainRowDivider(inset: 52) }
                    BudgetRow(category: category)
                        .padding(.vertical, Spacing.sm)
                }
            }
        }
    }
}

private struct BudgetRow: View {
    let category: ExpenseCategory

    private var tint: Color {
        if category.isOverBudget { return Theme.negative }
        if category.isNearLimit { return Theme.warning }
        return Theme.brand
    }

    var body: some View {
        // Буква статьи в кружке цвета её состояния — перерасход видно по
        // столбику кружков, не читая сумм.
        HStack(alignment: .top, spacing: Spacing.md) {
        LetterBadge(text: category.name, tint: tint)
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(spacing: Spacing.md) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(category.name)
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                    Text(category.groupLabel)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textDim)
                }

                Spacer(minLength: Spacing.sm)

                VStack(alignment: .trailing, spacing: 2) {
                    Text("\(Money.format(category.spentThisMonth)) из \(Money.format(category.monthlyBudget))")
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(tint == Theme.brand ? Theme.text : tint)
                    if category.isOverBudget {
                        Text("сверх на \(Money.format(category.spentThisMonth - category.monthlyBudget))")
                            .font(Typography.caption)
                            .monospacedDigit()
                            .foregroundStyle(Theme.negative)
                    } else {
                        Text("осталось \(Money.format(category.remaining))")
                            .font(Typography.caption)
                            .monospacedDigit()
                            .foregroundStyle(Theme.textDim)
                    }
                }
            }

            // Полоска обрезается на единице: перерасход показан текстом выше,
            // а полоса длиннее дорожки выглядела бы сбоем вёрстки.
            ProportionBar(ratio: min(category.usage ?? 0, 1), color: tint)
        }
        }
    }
}

// ── Аналитика магазина ───────────────────────────────────────────────────────

/// Что продаётся и что лежит мёртвым грузом.
///
/// Главный вопрос к складской аналитике — не «сколько продали», а «какие
/// деньги стоят на полке без движения». Поэтому залежавшийся товар вынесен
/// наравне с топом продаж, а не спрятан в конце.
struct StoreAnalyticsScreen: View {
    @Environment(BusinessStore.self) private var store

    private let windows = [(7, "Неделя"), (30, "Месяц"), (90, "Квартал")]

    var body: some View {
        @Bindable var bindable = store

        return ScreenScroll {
            VStack(spacing: Spacing.lg) {
                PillSegment(
                    options: windows.map { (value: $0.0, title: $0.1) },
                    selection: $bindable.analyticsDays
                )

                if let error = store.storeAnalyticsError, store.storeAnalytics == nil {
                    ErrorStateView(error: error) { Task { await store.loadStoreAnalytics() } }
                } else if let analytics = store.storeAnalytics {
                    content(analytics)
                } else {
                    VStack(spacing: Spacing.lg) {
                        Skeleton(height: 96, cornerRadius: Radius.lg)
                        Skeleton(height: 220, cornerRadius: Radius.lg)
                    }
                }
            }
        }
        .background(Theme.background)
        .navigationTitle("Аналитика магазина")
        .toolbar { LogoutToolbarItem() }
        .task { await store.loadStoreAnalytics() }
        .refreshable { await store.loadStoreAnalytics() }
    }

    @ViewBuilder
    private func content(_ analytics: StoreAnalytics) -> some View {
        let top = analytics.topSold
        let stale = analytics.stale

        VStack(spacing: Spacing.lg) {
            // Выручка — главная цифра; залежавшееся — рядом, а не в конце:
            // деньги на полке без движения важнее числа продаж.
            HeroSummary(
                title: "Продано за период",
                value: Money.format(analytics.totalSales),
                caption: stale.isEmpty ? "всё в обороте" : "\(stale.count) \(pluralize(stale.count, "позиция", "позиции", "позиций")) без движения",
                footer: [
                    ("Продаж", "\(analytics.salesCount)"),
                    ("Средний чек", Money.format(analytics.salesCount > 0 ? analytics.totalSales / Double(analytics.salesCount) : 0)),
                    ("Без движения", "\(stale.count)"),
                ],
                colors: [Color(hex: 0xF59E0B), Color(hex: 0xEA580C)]
            )

            let series = analytics.salesByDay
            if series.count > 1 {
                TrendChart(
                    title: "Продажи по дням",
                    points: series.map {
                        TimePoint(
                            label: $0.date.formatted(.dateTime.day().month(.abbreviated)),
                            date: $0.date,
                            value: $0.amount
                        )
                    }
                )
            }

            SplitDashboard {
                // Топ строками с долей от выручки — как «куда ушли деньги» в
                // банке: название, сумма и тонкая полоса, без осей графика.
                OwnerSection("Топ продаж") {
                    if top.isEmpty {
                        InlineEmpty(icon: "cart", text: "За период продаж не было", tint: Theme.textDim)
                    } else {
                        let total = max(analytics.totalSales, 1)
                        VStack(spacing: 0) {
                            ForEach(Array(top.prefix(10).enumerated()), id: \.element.id) { index, item in
                                if index > 0 { PlainRowDivider(inset: 52) }
                                AmountRow(
                                    leading: { LetterBadge(text: item.name, tint: OwnerTint.point(index)) },
                                    title: item.name,
                                    subtitle: "\(Quantity.format(item.quantity)) шт · \(Percent.format(item.amount / total * 100))",
                                    amount: Money.format(item.amount),
                                    share: item.amount / total,
                                    tint: OwnerTint.point(index)
                                )
                                .padding(.vertical, Spacing.xs)
                            }
                        }
                    }
                }
            } side: {
                OwnerSection("Лежит без движения") {
                    if !stale.isEmpty {
                        Text("\(stale.count)")
                            .font(.system(size: 15, weight: .semibold, design: .rounded))
                            .foregroundStyle(Theme.warning)
                    }
                } content: {
                    if stale.isEmpty {
                        InlineEmpty(icon: "checkmark.circle", text: "Всё в обороте", tint: Theme.positive)
                    } else {
                        VStack(spacing: 0) {
                            ForEach(Array(stale.prefix(12).enumerated()), id: \.element.id) { index, item in
                                if index > 0 { PlainRowDivider(inset: 52) }
                                HStack(spacing: Spacing.md) {
                                    LetterBadge(text: item.name, tint: Theme.warning)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(item.name)
                                            .font(.system(size: 16, weight: .medium))
                                            .foregroundStyle(Theme.text)
                                            .lineLimit(1)
                                        Text("ни одной продажи за период")
                                            .font(.system(size: 13))
                                            .foregroundStyle(Theme.textDim)
                                    }
                                    Spacer(minLength: Spacing.sm)
                                    Text("\(Quantity.format(item.quantity)) \(item.unit)")
                                        .font(.system(size: 16, weight: .semibold, design: .rounded))
                                        .monospacedDigit()
                                        .foregroundStyle(Theme.warning)
                                }
                                .padding(.vertical, Spacing.sm)
                            }
                        }
                    }
                }
            }
        }
    }
}

// ── База знаний ──────────────────────────────────────────────────────────────

/// Правила и инструкции для команды.
///
/// Черновики вынесены наверх: статья, которую написали, но не опубликовали,
/// команде не видна — а автор обычно считает, что видна.
struct KnowledgeAdminScreen: View {
    @Environment(BusinessStore.self) private var store
    @Environment(\.access) private var access
    @Environment(\.api) private var api

    @State private var search = ""
    /// Что публикуем или снимаем прямо сейчас — чтобы строка не отвечала
    /// молчанием на нажатие.
    @State private var busyArticleID: String?
    @State private var publishError: String?

    /// Обязательные чек-листы открытых смен.
    @State private var board: ShiftChecklistBoard?
    @State private var busyChecklistID: String?
    @State private var checklistError: String?
    /// Чек-лист, который прощаем: лист спрашивает причину.
    @State private var skipping: SkipTarget?

    struct SkipTarget: Identifiable {
        let companyID: String
        let companyName: String
        let item: ShiftChecklistStatus.Item
        var id: String { item.templateID + companyID }
    }

    private var canRunChecklist: Bool { access?.can("knowledge-admin.run_checklist") ?? false }
    private var canSkipChecklist: Bool { access?.can("knowledge-admin.skip_checklist") ?? false }

    /// Публикация — своё право, отдельное от правки текста: опубликованное
    /// правило команда обязана прочитать и подтвердить, а за нарушение по нему
    /// выписывают штраф.
    private var canPublish: Bool { access?.can("knowledge-admin.publish") ?? false }

    var body: some View {
        ScreenScroll {
            // Смены сверху: это то, что происходит сейчас, а статьи лежат.
            shiftChecklists

            if let error = store.knowledgeError, store.knowledge == nil {
                ErrorStateView(error: error) { Task { await store.loadKnowledge() } }
            } else if let base = store.knowledge {
                content(base)
            } else {
                LoadingRows(count: 7)
            }
        }
        .background(Theme.background)
        .navigationTitle("База знаний")
        .searchable(text: $search, prompt: "Заголовок или метка")
        .toolbar { LogoutToolbarItem() }
        .task {
            await store.loadKnowledge()
            await loadBoard()
        }
        .refreshable {
            await store.loadKnowledge()
            await loadBoard()
        }
        .sheet(item: $skipping) { target in
            SkipChecklistSheet(
                companyName: target.companyName,
                title: target.item.title
            ) { reason in
                await skip(target, reason: reason)
            }
        }
    }

    /// Что мешает закрыть смену прямо сейчас.
    ///
    /// Звонок «не могу закрыть смену» раньше означал разговор вслепую: какой
    /// именно чек-лист висит, из телефона было не узнать. Оставалось верить на
    /// слово и либо гнать проходить, либо выключить чек-лист совсем — то есть
    /// навсегда и для всех.
    @ViewBuilder
    private var shiftChecklists: some View {
        if let board, !board.shifts.isEmpty {
            ForEach(board.shifts) { shift in
                Card(accent: shift.blocking.isEmpty ? Theme.positive : Theme.warning) {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        SectionHeader(
                            shift.companyName,
                            subtitle: shift.blocking.isEmpty
                                ? "смену закрыть можно"
                                : "\(shift.blocking.count) \(pluralize(shift.blocking.count, "чек-лист держит", "чек-листа держат", "чек-листов держат")) смену"
                        )

                        if let checklistError {
                            Text(checklistError)
                                .font(Typography.caption)
                                .foregroundStyle(Theme.negative)
                        }

                        ForEach(Array(shift.checklists.enumerated()), id: \.element.id) { index, item in
                            if index > 0 { RowDivider() }
                            VStack(alignment: .leading, spacing: Spacing.xs) {
                                HStack(spacing: Spacing.md) {
                                    Text(item.title)
                                        .font(Typography.callout)
                                        .foregroundStyle(item.isMissing ? Theme.text : Theme.textDim)
                                    Spacer(minLength: Spacing.sm)
                                    StatusChip(
                                        item.statusLabel,
                                        kind: item.isDone ? .good : item.isSkipped ? .info : item.isMissing ? .warning : .neutral
                                    )
                                }

                                if let reason = item.skipReason, !reason.isEmpty {
                                    Text("причина: \(reason)")
                                        .font(Typography.caption)
                                        .foregroundStyle(Theme.textDim)
                                }

                                if item.isMissing {
                                    HStack(spacing: Spacing.sm) {
                                        if canRunChecklist {
                                            Button(busyChecklistID == item.templateID ? "Запускаем…" : "Запустить сейчас") {
                                                Task { await start(item, companyID: shift.companyID) }
                                            }
                                            .buttonStyle(SecondaryButtonStyle())
                                            .disabled(busyChecklistID != nil)
                                        }
                                        if canSkipChecklist {
                                            Button("Простить") {
                                                skipping = SkipTarget(
                                                    companyID: shift.companyID,
                                                    companyName: shift.companyName,
                                                    item: item
                                                )
                                            }
                                            .buttonStyle(SecondaryButtonStyle())
                                            .disabled(busyChecklistID != nil)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    private func loadBoard() async {
        board = (try? await BusinessService(api: api).shiftChecklists()) ?? board
    }

    private func start(_ item: ShiftChecklistStatus.Item, companyID: String) async {
        busyChecklistID = item.templateID
        checklistError = nil
        defer { busyChecklistID = nil }
        do {
            try await BusinessService(api: api).startChecklistRun(templateID: item.templateID, companyID: companyID)
            Haptics.success()
            await loadBoard()
        } catch let error as APIError {
            Haptics.error()
            checklistError = error.userMessage
        } catch {
            Haptics.error()
            checklistError = error.localizedDescription
        }
    }

    private func skip(_ target: SkipTarget, reason: String) async {
        busyChecklistID = target.item.templateID
        checklistError = nil
        defer { busyChecklistID = nil }
        do {
            try await BusinessService(api: api).skipChecklistRun(
                templateID: target.item.templateID,
                companyID: target.companyID,
                reason: reason
            )
            Haptics.success()
            await loadBoard()
        } catch let error as APIError {
            Haptics.error()
            checklistError = error.userMessage
        } catch {
            Haptics.error()
            checklistError = error.localizedDescription
        }
    }

    @ViewBuilder
    private func content(_ base: KnowledgeBase) -> some View {
        let matching = filtered(base.articles)

        if base.articles.isEmpty {
            WideEmptyState(
                icon: "book",
                title: "Статей нет",
                message: "Здесь будут правила и инструкции для команды."
            )
        } else if matching.isEmpty {
            WideEmptyState(icon: "magnifyingglass", title: "Ничего не найдено", message: "Попробуйте другой запрос.")
        } else {
            VStack(spacing: Spacing.lg) {
                let drafts = matching.filter { !$0.isPublished }
                if !drafts.isEmpty {
                    Card(accent: Theme.warning) {
                        VStack(alignment: .leading, spacing: Spacing.md) {
                            SectionHeader("Черновики", subtitle: "команда их не видит")
                            if let publishError {
                                Text(publishError)
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.negative)
                            }
                            ForEach(Array(drafts.enumerated()), id: \.element.id) { index, article in
                                if index > 0 { RowDivider() }
                                AdminArticleRow(article: article)
                                // Черновик лежит, пока кто-нибудь не дойдёт до
                                // сайта. С телефона его теперь можно выпустить
                                // сразу — текст уже написан, решение осталось.
                                if canPublish {
                                    Button(busyArticleID == article.id ? "Публикуем…" : "Опубликовать") {
                                        Task { await setPublished(article, to: true) }
                                    }
                                    .buttonStyle(SecondaryButtonStyle())
                                    .disabled(busyArticleID != nil)
                                }
                            }
                        }
                    }
                }

                ForEach(base.categories.sorted { $0.sortOrder < $1.sortOrder }) { category in
                    let rows = matching.filter { $0.categoryID == category.id && $0.isPublished }
                    if !rows.isEmpty {
                        Card {
                            VStack(alignment: .leading, spacing: Spacing.md) {
                                SectionHeader(category.name, subtitle: "\(rows.count)")
                                ForEach(Array(rows.enumerated()), id: \.element.id) { index, article in
                                    if index > 0 { RowDivider() }
                                    AdminArticleRow(article: article)
                                        .contextMenu {
                                            if canPublish {
                                                Button("Снять с публикации", systemImage: "eye.slash") {
                                                    Task { await setPublished(article, to: false) }
                                                }
                                            }
                                        }
                                }
                            }
                        }
                    }
                }

                // Статьи без раздела иначе просто исчезли бы из списка.
                let orphans = matching.filter { article in
                    article.isPublished && !base.categories.contains { $0.id == article.categoryID }
                }
                if !orphans.isEmpty {
                    Card {
                        VStack(alignment: .leading, spacing: Spacing.md) {
                            SectionHeader("Без раздела", subtitle: "\(orphans.count)")
                            ForEach(Array(orphans.enumerated()), id: \.element.id) { index, article in
                                if index > 0 { RowDivider() }
                                AdminArticleRow(article: article)
                            }
                        }
                    }
                }
            }
        }
    }

    private func setPublished(_ article: AdminArticle, to state: Bool) async {
        busyArticleID = article.id
        publishError = nil
        defer { busyArticleID = nil }
        do {
            try await BusinessService(api: api).setArticlePublished(id: article.id, isPublished: state)
            Haptics.success()
            await store.loadKnowledge()
        } catch let error as APIError {
            Haptics.error()
            publishError = error.userMessage
        } catch {
            Haptics.error()
            publishError = error.localizedDescription
        }
    }

    private func filtered(_ articles: [AdminArticle]) -> [AdminArticle] {
        guard !search.isEmpty else { return articles }
        return articles.filter {
            $0.title.localizedCaseInsensitiveContains(search)
                || $0.tags.contains { $0.localizedCaseInsensitiveContains(search) }
        }
    }
}

private struct AdminArticleRow: View {
    let article: AdminArticle

    var body: some View {
        HStack(spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: 2) {
                Text(article.title)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .lineLimit(2)

                HStack(spacing: Spacing.sm) {
                    Text(article.audienceLabel)
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                    if article.requiresConfirmation {
                        Label("под подпись", systemImage: "signature")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.info)
                    }
                    if let updated = article.updatedAt {
                        Text(updated.formatted(.dateTime.day().month(.abbreviated)))
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                    }
                }
            }

            Spacer(minLength: Spacing.sm)

            // Штраф или бонус превращают статью из совета в правило —
            // это стоит видеть в списке, а не открывая её.
            if article.fineAmount > 0 {
                StatusChip("−\(Money.format(article.fineAmount))", kind: .danger)
            } else if article.bonusAmount > 0 {
                StatusChip("+\(Money.format(article.bonusAmount))", kind: .good)
            }
        }
    }
}

/// Простить обязательный чек-лист — с причиной.
///
/// Прощённый чек-лист это невыполненная работа: касса не пересчитана, зал не
/// осмотрен. Через месяц вопрос «почему смену закрыли без этого» должен иметь
/// письменный ответ, поэтому причина обязательна и уходит в историю смены
/// вместе с именем того, кто простил.
struct SkipChecklistSheet: View {
    let companyName: String
    let title: String
    var onConfirm: (String) async -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var reason = ""
    @State private var isBusy = false

    var body: some View {
        NavigationStack {
            ScreenScroll {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        FieldLabel("Что прощаем")
                        Text(title)
                            .font(Typography.callout.weight(.medium))
                            .foregroundStyle(Theme.text)
                        Text(companyName)
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textMuted)
                    }
                }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        FieldLabel("Причина")
                        TextField("Например: касса пересчитана при мне", text: $reason, axis: .vertical)
                            .textFieldStyle(.plain)
                            .font(Typography.callout)
                            .lineLimit(2...4)

                        Text("Останется в истории смены — по ней потом и разбираются.")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textMuted)

                        Button(isBusy ? "Сохраняем…" : "Простить чек-лист") {
                            Task {
                                isBusy = true
                                await onConfirm(reason.trimmingCharacters(in: .whitespaces))
                                isBusy = false
                                dismiss()
                            }
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(isBusy || reason.trimmingCharacters(in: .whitespaces).count < 3)
                    }
                }
            }
            .background(Theme.background)
            .navigationTitle("Пропуск чек-листа")
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
}
