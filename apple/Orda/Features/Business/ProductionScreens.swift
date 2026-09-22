import OrdaKit
import OrdaUI
import SwiftUI

// ── Техкарты ─────────────────────────────────────────────────────────────────

@MainActor @Observable
final class ProductionStore {
    private(set) var catalog: ProductionCatalog?
    private(set) var cards: [RecipeEconomics] = []
    private(set) var analysis: ProductionAnalysis?
    private(set) var error: APIError?
    private(set) var analysisError: APIError?
    private(set) var isLoading = false
    private(set) var range: AnalyticsPeriod = .thisMonth

    private let service: ProductionService

    init(api: APIClient) { service = ProductionService(api: api) }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let loaded = try await service.catalog()
            catalog = loaded
            cards = loaded.economics()
            error = nil
        } catch let apiError as APIError {
            error = apiError
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
        await loadAnalysis()
    }

    /// Факт продаж грузим отдельно от каталога: у него своё право
    /// (`production.view`), и отказ по нему не должен прятать сами техкарты —
    /// себестоимость видна и без статистики продаж.
    func loadAnalysis() async {
        let bounds = range.bounds()
        do {
            analysis = try await service.analysis(from: bounds.from, to: bounds.to)
            analysisError = nil
        } catch let apiError as APIError {
            analysis = nil
            analysisError = apiError
        } catch {
            analysis = nil
            analysisError = .transport(message: error.localizedDescription)
        }
    }

    func select(range newValue: AnalyticsPeriod) async {
        guard newValue != range else { return }
        range = newValue
        await loadAnalysis()
    }

    /// Сверху то, что съедает больше всего: блюда с высоким food cost.
    /// Непривязанные к чеку уходят вниз — по ним доля неизвестна.
    var sortedCards: [RecipeEconomics] {
        cards.sorted { left, right in
            switch (left.foodCostShare, right.foodCostShare) {
            case let (l?, r?) where l != r: return l > r
            case (nil, .some): return false
            case (.some, nil): return true
            default: return left.name.localizedCaseInsensitiveCompare(right.name) == .orderedAscending
            }
        }
    }

    var unpricedCount: Int { cards.filter(\.isUnpriced).count }
}

/// Техкарты: во что обходится блюдо и какая доля выручки уходит в продукт.
///
/// Экран отвечает на два вопроса: «сколько стоит порция» (каталог, есть всегда)
/// и «сколько мы на самом деле проели за период» (факт продаж). Второе точнее
/// первого — блюда продаются неравномерно, и средний food cost по меню врёт.
struct ProductionScreen: View {
    @Environment(\.api) private var api
    @Environment(\.access) private var access
    @State private var store: ProductionStore?
    @State private var tab: Tab = .dishes
    @State private var selected: RecipeEconomics?
    /// Ингредиенты добавляют по ходу дела: привезли новый сироп — он нужен в
    /// техкарте сегодня, а не когда дойдут руки до ноутбука.
    @State private var newIngredientOpen = false

    private var canCreateIngredient: Bool { access?.can("production.create_ingredient") ?? false }

    private enum Tab: Hashable { case dishes, ingredients }

    var body: some View {
        Group {
            if let store {
                if let error = store.error, store.catalog == nil {
                    ErrorStateView(error: error) { Task { await store.load() } }
                } else if store.catalog != nil {
                    content(store)
                } else {
                    LoadingRows(count: 6)
                }
            } else {
                LoadingRows(count: 6)
            }
        }
        .background(Theme.background)
        .navigationTitle("Техкарты")
        .toolbar {
            LogoutToolbarItem()
            if canCreateIngredient {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        newIngredientOpen = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
        }
        .sheet(isPresented: $newIngredientOpen) {
            NewIngredientSheet { await store?.load() }
        }
        .task {
            if store == nil {
                let created = ProductionStore(api: api)
                store = created
                await created.load()
            }
        }
        .refreshable { await store?.load() }
    }

    @ViewBuilder
    private func content(_ store: ProductionStore) -> some View {
        VStack(spacing: 0) {
            controls(store)

            switch tab {
            case .dishes: dishes(store)
            case .ingredients: ingredients(store)
            }
        }
    }

    private func controls(_ store: ProductionStore) -> some View {
        VStack(spacing: Spacing.md) {
            PillSegment(
                options: [(value: Tab.dishes, title: "Блюда"), (value: Tab.ingredients, title: "Сырьё")],
                selection: $tab
            )
            .padding(.horizontal, Spacing.lg)

            PeriodBar(selection: Binding(
                get: { store.range },
                set: { value in Task { await store.select(range: value) } }
            ))
            .padding(.horizontal, Spacing.lg)

            if let totals = store.analysis?.totals, totals.revenue > 0 {
                // Выручка блюд — главная цифра, food cost и остаток — её
                // расшифровка. Высокий food cost красит всю карточку: это
                // сигнал пересмотреть цены, а не строчка среди прочих.
                HeroSummary(
                    title: "Выручка блюд",
                    value: Money.format(totals.revenue),
                    caption: "food cost \(Percent.format(totals.foodCostPercent))" + (totals.isHigh ? " — выше нормы" : ""),
                    footer: [
                        ("Ушло в продукт", Money.format(totals.foodCost)),
                        ("Food cost", Percent.format(totals.foodCostPercent)),
                        ("Осталось", Money.format(totals.margin)),
                    ],
                    colors: totals.isHigh
                        ? Theme.heroNegative
                        : Theme.heroGradient
                )
                .padding(.horizontal, Spacing.lg)
            }
        }
        .padding(.vertical, Spacing.md)
    }

    @ViewBuilder
    private func dishes(_ store: ProductionStore) -> some View {
        MasterDetail(
            items: store.sortedCards,
            selection: $selected,
            listWidth: 340
        ) { card in
            RecipeRow(card: card)
        } detail: { card in
            RecipeDetailView(card: card, fact: store.analysis?.row(recipeID: card.id), range: store.range)
        } empty: {
            WideEmptyState(
                icon: "list.bullet.rectangle",
                title: "Техкарт нет",
                message: "Пока не заведено ни одной техкарты — себестоимость блюд считать не из чего."
            )
        }
    }

    @ViewBuilder
    private func ingredients(_ store: ProductionStore) -> some View {
        if let analysis = store.analysis {
            if analysis.ingredients.isEmpty {
                WideEmptyState(
                    icon: "leaf",
                    title: "Расхода нет",
                    message: "За период не продано ни одного блюда, связанного с техкартой."
                )
            } else {
                // Один список с долей каждой позиции вместо графика и списка
                // по отдельности: полоса под строкой показывает то же, что
                // столбик графика, но рядом с названием и суммой.
                let total = max(analysis.ingredients.reduce(0) { $0 + $1.cost }, 1)
                ScreenScroll {
                    OwnerSection("На что ушли деньги в сырье") {
                        Text("\(analysis.ingredients.count) поз.")
                            .font(.system(size: 14))
                            .foregroundStyle(Theme.textDim)
                    } content: {
                        VStack(spacing: 0) {
                            ForEach(Array(analysis.ingredients.enumerated()), id: \.element.id) { index, usage in
                                if index > 0 { PlainRowDivider(inset: 52) }
                                IngredientUsageRow(usage: usage, share: usage.cost / total, index: index)
                                    .padding(.vertical, Spacing.xs)
                            }
                        }
                    }
                }
            }
        } else if let error = store.analysisError {
            ErrorStateView(error: error) { Task { await store.loadAnalysis() } }
        } else {
            LoadingRows(count: 6)
        }
    }
}

private struct RecipeRow: View {
    let card: RecipeEconomics

    var body: some View {
        HStack(spacing: Spacing.md) {
            TintedIcon(
                systemName: card.recipe.isSemiFinished ? "square.stack.3d.up" : "fork.knife",
                tint: !card.recipe.isActive ? Theme.textDim : (card.isFoodCostHigh ? Theme.negative : Color(hex: 0xF97316))
            )

            VStack(alignment: .leading, spacing: 2) {
                Text(card.name)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(card.recipe.isActive ? Theme.text : Theme.textDim)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 2) {
                Text(Money.format(card.portionCost))
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(Theme.text)
                // Food cost подписью под суммой: плашка теснила себестоимость.
                if let share = card.foodCostShare {
                    StatusCaption(Percent.format(share), tint: card.isFoodCostHigh ? Theme.negative : Theme.positive)
                } else {
                    StatusCaption("нет цены")
                }
            }
        }
    }

    private var subtitle: String {
        var parts: [String] = []
        if let category = card.recipe.category, !category.isEmpty { parts.append(category) }
        parts.append("выход \(Quantity.format(card.recipe.outputQty)) \(card.recipe.outputUnit)")
        if !card.lines.isEmpty {
            parts.append("\(card.lines.count) \(pluralize(card.lines.count, "компонент", "компонента", "компонентов"))")
        }
        return parts.joined(separator: " · ")
    }
}

private struct RecipeDetailView: View {
    let card: RecipeEconomics
    let fact: ProductionAnalysisRow?
    let range: AnalyticsPeriod

    var body: some View {
        ScreenScroll {
            VStack(spacing: Spacing.lg) {
                economics
                composition
                salesFact
            }
        }
        .background(Theme.background)
        .navigationTitle("Техкарта")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }

    private var economics: some View {
        Card(accent: card.isFoodCostHigh ? Theme.negative : nil) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        Text(card.name)
                            .font(Typography.title)
                            .foregroundStyle(Theme.text)
                        if let category = card.recipe.category, !category.isEmpty {
                            Text(category)
                                .font(Typography.callout)
                                .foregroundStyle(Theme.textMuted)
                        }
                    }
                    Spacer()
                    if card.recipe.isSemiFinished {
                        StatusChip("полуфабрикат", kind: .info)
                    } else if !card.recipe.isActive {
                        StatusChip("выключена", kind: .neutral)
                    }
                }

                RowDivider()
                StatRow(
                    "Выход",
                    value: "\(Quantity.format(card.recipe.outputQty)) \(card.recipe.outputUnit)",
                    icon: "scalemass"
                )
                if let loss = card.recipe.lossPercent {
                    StatRow("Потери при готовке", value: Percent.format(loss), valueColor: Theme.warning, icon: "flame")
                }
                StatRow("Себестоимость закладки", value: Money.format(card.recipe.recipeCost))
                StatRow("Себестоимость порции", value: Money.format(card.portionCost), emphasized: true)

                RowDivider()
                if let salePrice = card.salePrice, salePrice > 0 {
                    StatRow("Цена продажи", value: Money.format(salePrice), icon: "tag")
                    if let share = card.foodCostShare {
                        StatRow(
                            "Food cost",
                            value: Percent.format(share),
                            valueColor: card.isFoodCostHigh ? Theme.negative : Theme.positive,
                            emphasized: true
                        )
                        ProportionBar(ratio: share / 100, color: card.isFoodCostHigh ? Theme.negative : Theme.positive)
                    }
                    if let margin = card.marginPerPortion {
                        StatRow("Остаётся с порции", value: Money.format(margin), valueColor: Theme.positive)
                    }
                } else {
                    // Без привязки к товару чека цену взять неоткуда: показывать
                    // «food cost 0 %» было бы прямой ложью.
                    InlineEmpty(
                        icon: "link.badge.plus",
                        text: "Техкарта не связана с блюдом в чеке — food cost посчитать не с чем",
                        tint: Theme.warning
                    )
                }

                if let notes = card.recipe.notes, !notes.isEmpty {
                    RowDivider()
                    Text(notes)
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textMuted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    private var composition: some View {
        OwnerSection("Состав") {
            Text("\(card.lines.count) поз.")
                .font(.system(size: 14))
                .foregroundStyle(Theme.textDim)
        } content: {
            if card.lines.isEmpty {
                InlineEmpty(icon: "tray", text: "Состав не заполнен — себестоимость нулевая", tint: Theme.warning)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(card.lines.enumerated()), id: \.element.id) { index, line in
                        if index > 0 { PlainRowDivider(inset: 48) }
                        RecipeComponentRow(line: line)
                            .padding(.vertical, Spacing.sm)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var salesFact: some View {
        OwnerSection("Продажи") {
            Text(range.title.lowercased())
                .font(.system(size: 14))
                .foregroundStyle(Theme.textDim)
        } content: {
            VStack(alignment: .leading, spacing: Spacing.md) {
                if let fact, fact.soldQty > 0 {
                    StatRow("Продано порций", value: Quantity.format(fact.soldQty), icon: "cart")
                    StatRow("Выручка", value: Money.format(fact.revenue), valueColor: Theme.brand)
                    StatRow("Ушло в продукт", value: Money.format(fact.foodCost), valueColor: Theme.warning)
                    RowDivider()
                    StatRow(
                        "Food cost по факту",
                        value: Percent.format(fact.foodCostPercent),
                        valueColor: fact.isFoodCostHigh ? Theme.negative : Theme.positive,
                        emphasized: true
                    )
                    StatRow("Осталось", value: Money.format(fact.margin), valueColor: Theme.positive)
                } else {
                    InlineEmpty(icon: "calendar.badge.exclamationmark", text: "За период не продавалось", tint: Theme.textDim)
                }
            }
        }
    }
}

private struct RecipeComponentRow: View {
    let line: RecipeComponentLine

    var body: some View {
        HStack(spacing: Spacing.md) {
            LetterBadge(text: line.name, tint: line.isSemiFinished ? Theme.info : Theme.brand, size: 36)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: Spacing.xs) {
                    Text(line.name)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                    if line.isSemiFinished {
                        StatusCaption("п/ф", tint: Theme.info)
                    }
                }
                if line.wastePct > 0 {
                    Text("зачистка \(Percent.format(line.wastePct))")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.warning)
                }
            }

            Spacer(minLength: Spacing.sm)

            Text("\(Quantity.format(line.qty)) \(line.unit)")
                .font(Typography.callout.weight(.medium))
                .monospacedDigit()
                .foregroundStyle(Theme.textMuted)
        }
    }
}

/// Позиция сырья: сколько ушло и какая это доля всех трат на сырьё.
private struct IngredientUsageRow: View {
    let usage: ProductionIngredientUsage
    let share: Double
    let index: Int

    var body: some View {
        AmountRow(
            leading: { LetterBadge(text: usage.name, tint: OwnerTint.point(index)) },
            title: usage.name,
            subtitle: "\(Quantity.format(usage.qty)) \(usage.unit) · \(Percent.format(share * 100))",
            amount: Money.format(usage.cost),
            share: share,
            tint: OwnerTint.point(index)
        )
    }
}

// ── План закупа ──────────────────────────────────────────────────────────────

@MainActor @Observable
final class PurchasePlanStore {
    private(set) var companies: [Company] = []
    private(set) var companyID: String?
    private(set) var plan: PurchasePlan?
    private(set) var isLoading = false
    private(set) var error: APIError?
    private(set) var didLoadCompanies = false

    private let service: PurchasePlanService

    init(api: APIClient) { service = PurchasePlanService(api: api) }

    func load() async {
        isLoading = true
        defer { isLoading = false }

        if !didLoadCompanies {
            do {
                companies = try await service.companies()
                didLoadCompanies = true
                companyID = companies.first?.id
                error = nil
            } catch let apiError as APIError {
                error = apiError
                return
            } catch {
                self.error = .transport(message: error.localizedDescription)
                return
            }
        }
        await loadPlan()
    }

    func loadPlan() async {
        guard let companyID else { plan = nil; return }
        do {
            plan = try await service.plan(companyID: companyID)
            error = nil
        } catch let apiError as APIError {
            plan = nil
            error = apiError
        } catch {
            plan = nil
            self.error = .transport(message: error.localizedDescription)
        }
    }

    func select(companyID newValue: String) async {
        guard newValue != companyID else { return }
        companyID = newValue
        plan = nil
        isLoading = true
        defer { isLoading = false }
        await loadPlan()
    }

    var companyName: String? {
        companies.first { $0.id == companyID }?.name
    }
}

/// План закупа: сколько взять на следующую неделю и на какую сумму.
///
/// План строится по одной точке — спрос и остатки у каждой свои, и «средний по
/// сети закуп» никому не нужен. Вторая вкладка отвечает на обратный вопрос:
/// что брать НЕ надо, потому что деньги уже лежат на полке.
struct PurchasePlanScreen: View {
    @Environment(\.api) private var api
    @State private var store: PurchasePlanStore?
    @State private var tab: Tab = .buy
    @State private var selected: PurchasePlanSupplier?

    private enum Tab: Hashable { case buy, skip }

    var body: some View {
        Group {
            if let store {
                if let error = store.error, store.plan == nil {
                    ErrorStateView(error: error) { Task { await store.load() } }
                } else if store.didLoadCompanies && store.companies.isEmpty {
                    WideEmptyState(
                        icon: "building.2",
                        title: "Нет точек",
                        message: "План закупа считается по точке продаж — ни одной точки не заведено."
                    )
                } else if let plan = store.plan {
                    content(store, plan: plan)
                } else {
                    LoadingRows(count: 6)
                }
            } else {
                LoadingRows(count: 6)
            }
        }
        .background(Theme.background)
        .navigationTitle("План закупа")
        .toolbar { LogoutToolbarItem() }
        .task {
            if store == nil {
                let created = PurchasePlanStore(api: api)
                store = created
                await created.load()
            }
        }
        .refreshable { await store?.loadPlan() }
    }

    @ViewBuilder
    private func content(_ store: PurchasePlanStore, plan: PurchasePlan) -> some View {
        VStack(spacing: 0) {
            controls(store, plan: plan)

            if plan.isEmpty {
                WideEmptyState(
                    icon: "checkmark.seal",
                    title: "Закупать нечего",
                    message: "По этой точке спрос покрыт остатками — на следующую неделю заказ не нужен."
                )
            } else {
                switch tab {
                case .buy: suppliers(plan)
                case .skip: doNotBuy(plan)
                }
            }
        }
    }

    private func controls(_ store: PurchasePlanStore, plan: PurchasePlan) -> some View {
        VStack(spacing: Spacing.md) {
            if store.companies.count > 1 {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Spacing.sm) {
                        ForEach(store.companies) { company in
                            FilterChip(title: company.name, isOn: company.id == store.companyID) {
                                Task { await store.select(companyID: company.id) }
                            }
                        }
                    }
                    .padding(.horizontal, Spacing.lg)
                }
            }

            // Сумма заказа — главная цифра недели, остальное — её контекст.
            // Больше 60 % недельной выручки — карточка краснеет: такой заказ
            // съест оборотные деньги.
            HeroSummary(
                title: "Закупить на",
                value: Money.format(plan.total),
                caption: plan.weekStart.map { "неделя с \($0.formatted(.dateTime.day().month(.abbreviated)))" },
                footer: planFooter(plan),
                colors: (plan.shareOfRevenue ?? 0) > 60
                    ? Theme.heroNegative
                    : Theme.heroGradient
            )
            .padding(.horizontal, Spacing.lg)

            PillSegment(
                options: [(value: Tab.buy, title: "Закупить"), (value: Tab.skip, title: "Не брать · \(plan.doNotBuy.count)")],
                selection: $tab
            )
            .padding(.horizontal, Spacing.lg)
        }
        .padding(.vertical, Spacing.md)
    }

    private func planFooter(_ plan: PurchasePlan) -> [(String, String)] {
        var footer: [(String, String)] = []
        if let share = plan.shareOfRevenue { footer.append(("От выручки", Percent.format(share))) }
        footer.append(("Позиций", "\(plan.positionCount)"))
        footer.append(("Сейчас в нуле", "\(plan.outOfStock.count)"))
        return footer
    }

    @ViewBuilder
    private func suppliers(_ plan: PurchasePlan) -> some View {
        MasterDetail(
            items: plan.bySupplier,
            selection: $selected,
            listWidth: 320
        ) { group in
            PlanSupplierRow(group: group, planTotal: plan.total)
        } detail: { group in
            PlanSupplierDetail(group: group)
        } empty: {
            WideEmptyState(
                icon: "shippingbox",
                title: "Заказывать нечего",
                message: "Спрос покрыт текущими остатками."
            )
        }
    }

    @ViewBuilder
    private func doNotBuy(_ plan: PurchasePlan) -> some View {
        if plan.doNotBuy.isEmpty {
            WideEmptyState(
                icon: "checkmark.circle",
                title: "Затоваривания нет",
                message: "Ни по одной позиции остаток не превышает месячный спрос."
            )
        } else {
            ScreenScroll {
                OwnerSection("Деньги уже на полке") {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        Text("Запаса хватит надолго — новый заказ заморозит оборотные.")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textDim)
                        VStack(spacing: 0) {
                            ForEach(Array(plan.doNotBuy.enumerated()), id: \.element.id) { index, skip in
                                if index > 0 { PlainRowDivider(inset: 52) }
                                PlanSkipRow(skip: skip)
                                    .padding(.vertical, Spacing.sm)
                            }
                        }
                    }
                }
            }
        }
    }
}

private struct PlanSupplierRow: View {
    let group: PurchasePlanSupplier
    let planTotal: Double

    var body: some View {
        // Доля поставщика в чеке закупа тонкой полосой под строкой: сразу
        // видно, с кем торговаться.
        AmountRow(
            leading: {
                if group.isUnknownSupplier {
                    TintedIcon(systemName: "questionmark", tint: Theme.textDim)
                } else {
                    LetterBadge(text: group.displayName, tint: Color(hex: 0x0F766E))
                }
            },
            title: group.displayName,
            subtitle: "\(group.items.count) \(pluralize(group.items.count, "позиция", "позиции", "позиций"))",
            amount: Money.format(group.total),
            share: planTotal > 0 ? group.total / planTotal : 0,
            tint: Color(hex: 0x0F766E)
        )
    }
}

private struct PlanSupplierDetail: View {
    let group: PurchasePlanSupplier

    var body: some View {
        ScreenScroll {
            VStack(spacing: Spacing.lg) {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        HStack(alignment: .top) {
                            Text(group.displayName)
                                .font(Typography.title)
                                .foregroundStyle(Theme.text)
                            Spacer()
                            if group.isUnknownSupplier {
                                StatusCaption("не приходил по накладной", tint: Theme.warning)
                            }
                        }
                        RowDivider()
                        StatRow("Сумма заказа", value: Money.format(group.total), emphasized: true)
                        StatRow("Позиций", value: "\(group.items.count)")
                    }
                }

                OwnerSection("Что взять") {
                    VStack(spacing: 0) {
                        ForEach(Array(group.items.enumerated()), id: \.element.id) { index, line in
                            if index > 0 { PlainRowDivider(inset: 0) }
                            PlanLineRow(line: line)
                                .padding(.vertical, Spacing.sm)
                        }
                    }
                }
            }
        }
        .background(Theme.background)
        .navigationTitle("Поставщик")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}

private struct PlanLineRow: View {
    let line: PurchasePlanLine

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(spacing: Spacing.md) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(line.name)
                        .font(Typography.callout)
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                    Text(demandText)
                        .font(Typography.caption)
                        .monospacedDigit()
                        .foregroundStyle(Theme.textDim)
                        .lineLimit(1)
                }

                Spacer(minLength: Spacing.sm)

                VStack(alignment: .trailing, spacing: 1) {
                    Text(Money.format(line.amount))
                        .font(Typography.callout.weight(.medium))
                        .monospacedDigit()
                        .foregroundStyle(Theme.text)
                    Text(orderText)
                        .font(Typography.caption)
                        .monospacedDigit()
                        .foregroundStyle(Theme.textMuted)
                }
            }

            // Признаки цветными подписями в строку, а не плашками: три
            // плашки подряд переносились и раздували строку вдвое.
            HStack(spacing: Spacing.md) {
                if line.wasOutOfStock {
                    StatusCaption("в нуле", tint: Theme.negative)
                }
                if line.isRising {
                    StatusCaption("спрос \(Percent.format(line.trendPercent, signed: true))", tint: Theme.positive)
                } else if line.isFalling {
                    StatusCaption("спрос \(Percent.format(line.trendPercent, signed: true))", tint: Theme.warning)
                }
                if line.marginPercent > 0 {
                    StatusCaption("маржа \(Percent.format(line.marginPercent))", tint: Theme.info)
                }
            }
        }
    }

    /// Заказ округлён до целых упаковок — в штуках его не берут.
    private var orderText: String {
        guard line.isPacked else { return "\(Quantity.format(line.order)) ед" }
        return "\(Quantity.format(line.packs)) уп × \(Quantity.format(line.packSize))"
    }

    private var demandText: String {
        var parts = ["спрос \(Quantity.format(line.weeklyDemand))/нед"]
        parts.append("остаток \(Quantity.format(line.stock))")
        if line.coverageWeeks > 0, line.coverageWeeks < 99 {
            parts.append("хватит на \(Quantity.format(line.coverageWeeks)) нед")
        }
        return parts.joined(separator: " · ")
    }
}

private struct PlanSkipRow: View {
    let skip: PurchasePlanSkip

    var body: some View {
        HStack(spacing: Spacing.md) {
            LetterBadge(text: skip.name, tint: Theme.warning)
            VStack(alignment: .leading, spacing: 2) {
                Text(skip.name)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text("остаток \(Quantity.format(skip.stock)) · спрос \(Quantity.format(skip.weeklyDemand))/нед")
                    .font(.system(size: 13))
                    .monospacedDigit()
                    .foregroundStyle(Theme.textDim)
            }

            Spacer(minLength: Spacing.sm)

            Text("на \(Quantity.format(skip.coverageWeeks)) нед")
                .font(.system(size: 15, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(Theme.warning)
        }
    }
}

// ── Заказы поставщикам ───────────────────────────────────────────────────────

@MainActor @Observable
final class PurchaseOrdersStore {
    private(set) var orders: [PurchaseOrder] = []
    /// Состав и контакты приходят только в карточке — тянем по требованию.
    private(set) var details: [String: PurchaseOrder] = [:]
    private(set) var loadingDetails: Set<String> = []
    private(set) var isLoading = false
    private(set) var error: APIError?
    private(set) var didLoad = false

    private let service: PurchaseOrdersService

    init(api: APIClient) { service = PurchaseOrdersService(api: api) }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            orders = try await service.orders()
            details.removeAll()
            didLoad = true
            error = nil
        } catch let apiError as APIError {
            error = apiError
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }

    func loadDetail(_ id: String) async {
        guard details[id] == nil, !loadingDetails.contains(id) else { return }
        loadingDetails.insert(id)
        defer { loadingDetails.remove(id) }
        // Отказ по карточке не гасим в общий `error`: список остаётся рабочим,
        // а пустой состав видно на месте.
        if let order = try? await service.order(id: id) {
            details[id] = order
        }
    }

    var inTransit: [PurchaseOrder] { orders.filter(\.isInTransit) }
    var overdue: [PurchaseOrder] { orders.filter(\.isOverdue) }
    var drafts: [PurchaseOrder] { orders.filter(\.isDraft) }
}

/// Заявки поставщикам: что заказано и до сих пор не приехало.
///
/// Отсортировано так, чтобы просроченные поставки были сверху, а полученные и
/// отменённые не мешались: закрытая заявка — история, открытая — деньги,
/// которые уже пообещали, и товар, которого ещё нет на полке.
struct PurchaseOrdersScreen: View {
    @Environment(\.api) private var api
    @Environment(\.access) private var access
    @State private var store: PurchaseOrdersStore?
    @State private var isCreating = false

    /// Право то же, что проверяет сервер.
    private var canCreate: Bool { access?.can("store-purchase-orders.create") ?? false }
    @State private var filter: OrderFilter = .open
    @State private var selected: PurchaseOrder?

    private enum OrderFilter: Hashable, CaseIterable {
        case open, overdue, received, all

        var title: String {
            switch self {
            case .open: "В работе"
            case .overdue: "Просрочено"
            case .received: "Получено"
            case .all: "Все"
            }
        }

        func matches(_ order: PurchaseOrder) -> Bool {
            switch self {
            case .open: order.isOpen
            case .overdue: order.isOverdue
            case .received: order.isReceived
            case .all: true
            }
        }
    }

    var body: some View {
        Group {
            if let store {
                if let error = store.error, store.orders.isEmpty {
                    ErrorStateView(error: error) { Task { await store.load() } }
                } else if !store.didLoad {
                    LoadingRows(count: 6)
                } else {
                    content(store)
                }
            } else {
                LoadingRows(count: 6)
            }
        }
        .background(Theme.background)
        .navigationTitle("Заказы поставщикам")
        .toolbar {
            if canCreate {
                ToolbarItem(placement: .primaryAction) {
                    Button { isCreating = true } label: { Image(systemName: "plus") }
                }
            }
            LogoutToolbarItem()
        }
        .sheet(isPresented: $isCreating) {
            NewPurchaseOrderSheet { await store?.load() }
        }
        .task {
            if store == nil {
                let created = PurchaseOrdersStore(api: api)
                store = created
                await created.load()
            }
        }
        .refreshable { await store?.load() }
    }

    @ViewBuilder
    private func content(_ store: PurchaseOrdersStore) -> some View {
        VStack(spacing: 0) {
            summary(store)

            MasterDetail(
                items: filtered(store),
                selection: $selected,
                listWidth: 340
            ) { order in
                PurchaseOrderRow(order: order)
            } detail: { order in
                PurchaseOrderDetailView(order: order, store: store)
            } empty: {
                WideEmptyState(
                    icon: "paperplane",
                    title: emptyTitle,
                    message: "Заявки поставщикам появятся здесь — вместе с датой отправки и составом."
                )
            }
        }
    }

    private func summary(_ store: PurchaseOrdersStore) -> some View {
        VStack(spacing: Spacing.md) {
            // «В пути» — главная цифра: за ней и открывают раздел. Просрочка
            // красит карточку — это повод звонить поставщику сегодня.
            HeroSummary(
                title: "Заявок в пути",
                value: "\(store.inTransit.count)",
                caption: store.overdue.isEmpty
                    ? "всё приходит в срок"
                    : "\(store.overdue.count) \(pluralize(store.overdue.count, "заявка", "заявки", "заявок")) просрочено",
                footer: [
                    ("Просрочено", "\(store.overdue.count)"),
                    ("Черновики", "\(store.drafts.count)"),
                    ("Всего", "\(store.orders.count)"),
                ],
                colors: store.overdue.isEmpty
                    ? Theme.heroAccent
                    : Theme.heroNegative
            )
            .padding(.horizontal, Spacing.lg)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Spacing.sm) {
                    ForEach(OrderFilter.allCases, id: \.self) { option in
                        FilterChip(title: option.title, isOn: filter == option) { filter = option }
                    }
                }
                .padding(.horizontal, Spacing.lg)
            }
        }
        .padding(.vertical, Spacing.md)
    }

    private func filtered(_ store: PurchaseOrdersStore) -> [PurchaseOrder] {
        store.orders
            .filter { filter.matches($0) }
            .sorted { left, right in
                // Просроченные вперёд: это и есть повод открыть раздел.
                if left.isOverdue != right.isOverdue { return left.isOverdue }
                if left.isOpen != right.isOpen { return left.isOpen }
                return (left.createdAt ?? .distantPast) > (right.createdAt ?? .distantPast)
            }
    }

    private var emptyTitle: String {
        switch filter {
        case .open: "Открытых заявок нет"
        case .overdue: "Просроченных нет"
        case .received: "Полученных нет"
        case .all: "Заявок нет"
        }
    }
}

private struct PurchaseOrderRow: View {
    let order: PurchaseOrder

    var body: some View {
        HStack(spacing: Spacing.md) {
            TintedIcon(systemName: order.icon, tint: iconColor)

            VStack(alignment: .leading, spacing: 2) {
                Text(order.supplierName)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(order.isCancelled ? Theme.textDim : Theme.text)
                    .strikethrough(order.isCancelled, color: Theme.textDim)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }

            Spacer(minLength: Spacing.sm)

            // Статус цветной подписью: плашка отнимала место у поставщика.
            if order.isOverdue, let days = order.daysSinceSent {
                StatusCaption("\(days) \(pluralize(days, "день", "дня", "дней")) в пути", tint: Theme.negative)
            } else {
                StatusCaption(order.statusLabel, tint: statusTint)
            }
        }
    }

    private var iconColor: Color {
        if order.isOverdue { return Theme.negative }
        switch order.status {
        case "received": return Theme.positive
        case "sent": return Theme.info
        case "cancelled": return Theme.textDim
        default: return Theme.textMuted
        }
    }

    private var statusTint: Color {
        switch order.status {
        case "received": Theme.positive
        case "sent": Theme.info
        case "cancelled": Theme.textDim
        default: Theme.warning
        }
    }

    private var subtitle: String {
        var parts: [String] = []
        if let date = order.sentAt ?? order.createdAt {
            parts.append(date.formatted(.dateTime.day().month(.abbreviated)))
        }
        parts.append("\(order.itemCount) \(pluralize(order.itemCount, "позиция", "позиции", "позиций"))")
        if order.isAuto { parts.append("авто") }
        return parts.joined(separator: " · ")
    }
}

private struct PurchaseOrderDetailView: View {
    let order: PurchaseOrder
    let store: PurchaseOrdersStore

    @Environment(\.api) private var api
    @Environment(\.access) private var access

    @State private var isBusy = false
    @State private var error: String?
    @State private var cancelling = false
    @State private var cancelReason = ""

    /// Права те же, что проверяет сервер: отмена отдельно от правки.
    private var canEdit: Bool { access?.can("store-purchase-orders.edit") ?? false }
    private var canCancel: Bool { access?.can("store-purchase-orders.cancel") ?? false }

    var body: some View {
        let full = store.details[order.id] ?? order

        ScreenScroll {
            VStack(spacing: Spacing.lg) {
                header(full)
                actions(full)
                contacts(full)
                composition(full)
            }
        }
        .alert("Отменить заявку?", isPresented: $cancelling) {
            TextField("Причина", text: $cancelReason)
            Button("Отменить заявку", role: .destructive) {
                Task { await change(to: "cancelled", reason: cancelReason) }
            }
            Button("Не надо", role: .cancel) {}
        } message: {
            Text("Поставщик её не повезёт. Причина попадёт в карточку — по ней потом разбираются, почему товара нет.")
        }
        .background(Theme.background)
        .navigationTitle("Заявка")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task(id: order.id) { await store.loadDetail(order.id) }
    }

    /// Что можно сделать с заявкой сейчас.
    ///
    /// Показываем только переходы, которые сервер примет: отправить можно
    /// черновик, отметить полученной — отправленную. Кнопка, отвечающая
    /// отказом, хуже отсутствующей.
    @ViewBuilder
    private func actions(_ order: PurchaseOrder) -> some View {
        if order.isDraft || order.isInTransit {
            Card {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    if let error {
                        Text(error)
                            .font(Typography.caption)
                            .foregroundStyle(Theme.negative)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    if order.isDraft, canEdit {
                        Button {
                            Task { await change(to: "sent") }
                        } label: {
                            if isBusy {
                                ProgressView().controlSize(.small)
                            } else {
                                Label("Отправить поставщику", systemImage: "paperplane")
                            }
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(isBusy)
                    }

                    if order.isInTransit, canEdit {
                        Button {
                            Task { await change(to: "received") }
                        } label: {
                            if isBusy {
                                ProgressView().controlSize(.small)
                            } else {
                                Label("Товар приехал", systemImage: "checkmark.circle")
                            }
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(isBusy)

                        Text("Отметка «приехал» закрывает заявку. Саму приёмку с ценами оформляют документом.")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    if canCancel {
                        Button { cancelling = true } label: {
                            Label("Отменить заявку", systemImage: "xmark.circle")
                        }
                        .buttonStyle(SecondaryButtonStyle())
                        .disabled(isBusy)
                    }
                }
            }
        }
    }

    private func change(to status: String, reason: String? = nil) async {
        isBusy = true
        error = nil
        defer { isBusy = false }

        do {
            try await PurchaseOrdersService(api: api).changeStatus(
                id: order.id,
                status: status,
                cancelReason: reason?.trimmingCharacters(in: .whitespaces)
            )
            cancelReason = ""
            await store.load()
            await store.loadDetail(order.id)
        } catch let apiError as APIError {
            error = apiError.userMessage
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func header(_ full: PurchaseOrder) -> some View {
        Card(accent: full.isOverdue ? Theme.negative : nil) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                HStack(alignment: .top) {
                    Text(full.supplierName)
                        .font(Typography.title)
                        .foregroundStyle(Theme.text)
                    Spacer()
                    StatusChip(full.statusLabel, kind: full.isCancelled ? .neutral : (full.isReceived ? .good : .info))
                }

                if full.isOverdue, let days = full.daysSinceSent {
                    // Главное на карточке: заказ отправлен, товара нет.
                    StatRow(
                        "Не приехало",
                        value: "\(days) \(pluralize(days, "день", "дня", "дней")) в пути",
                        valueColor: Theme.negative,
                        icon: "exclamationmark.triangle",
                        emphasized: true
                    )
                    RowDivider()
                }

                if let created = full.createdAt {
                    StatRow("Создана", value: created.formatted(.dateTime.day().month(.wide).hour().minute()), icon: "calendar")
                }
                if let sent = full.sentAt {
                    StatRow("Отправлена", value: sent.formatted(.dateTime.day().month(.wide).hour().minute()), icon: "paperplane")
                }
                if let received = full.receivedAt {
                    StatRow(
                        "Получена",
                        value: received.formatted(.dateTime.day().month(.wide).hour().minute()),
                        valueColor: Theme.positive,
                        icon: "checkmark.circle"
                    )
                }
                if let cancelled = full.cancelledAt {
                    StatRow(
                        "Отменена",
                        value: cancelled.formatted(.dateTime.day().month(.wide).hour().minute()),
                        valueColor: Theme.negative,
                        icon: "xmark.circle"
                    )
                }
                if full.isAuto {
                    StatRow("Источник", value: "собрана автоматически", icon: "wand.and.stars")
                }

                if let reason = full.cancelReason, !reason.isEmpty {
                    RowDivider()
                    Text("Причина отмены: \(reason)")
                        .font(Typography.callout)
                        .foregroundStyle(Theme.negative)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                if let comment = full.comment, !comment.isEmpty {
                    Text(comment)
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textMuted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    @ViewBuilder
    private func contacts(_ full: PurchaseOrder) -> some View {
        let hasContacts = full.repName != nil || full.repPhone != nil || full.supplierPhone != nil || full.leadTimeDays != nil
        if hasContacts {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("Кому звонить")
                    if let name = full.repName, !name.isEmpty {
                        StatRow("Представитель", value: name, icon: "person")
                    }
                    if let phone = full.repPhone, !phone.isEmpty {
                        StatRow("Телефон", value: phone, icon: "phone")
                    }
                    if let phone = full.supplierPhone, !phone.isEmpty {
                        StatRow("Телефон компании", value: phone, icon: "phone.circle")
                    }
                    if let lead = full.leadTimeDays {
                        StatRow(
                            "Обещанный срок",
                            value: "\(lead) \(pluralize(lead, "день", "дня", "дней"))",
                            icon: "clock"
                        )
                    }
                }
            }
        }
    }

    private func composition(_ full: PurchaseOrder) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Состав", subtitle: "\(full.itemCount) \(pluralize(full.itemCount, "позиция", "позиции", "позиций"))")
                if full.lines.isEmpty {
                    if store.loadingDetails.contains(order.id) {
                        Skeleton(height: 44, cornerRadius: Radius.md)
                        Skeleton(height: 44, cornerRadius: Radius.md)
                    } else {
                        InlineEmpty(icon: "tray", text: "Позиции не загрузились", tint: Theme.textDim)
                    }
                } else {
                    ForEach(Array(full.lines.enumerated()), id: \.element.id) { index, line in
                        if index > 0 { RowDivider() }
                        PurchaseOrderLineRow(line: line)
                    }
                }
            }
        }
    }
}

private struct PurchaseOrderLineRow: View {
    let line: PurchaseOrderLine

    var body: some View {
        HStack(spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: 1) {
                Text(line.name)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text(context)
                    .font(Typography.caption)
                    .monospacedDigit()
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }

            Spacer(minLength: Spacing.sm)

            Text("\(Quantity.format(line.suggestedQty)) \(line.unit)")
                .font(Typography.callout.weight(.medium))
                .monospacedDigit()
                .foregroundStyle(Theme.text)
        }
    }

    /// Остаток на момент заявки объясняет, почему заказали именно столько.
    private var context: String {
        var parts = ["было \(Quantity.format(line.currentQty)) \(line.unit)"]
        if let threshold = line.threshold, threshold > 0 {
            parts.append("порог \(Quantity.format(threshold))")
        }
        if let comment = line.comment, !comment.isEmpty { parts.append(comment) }
        return parts.joined(separator: " · ")
    }
}

// ── Расходники ───────────────────────────────────────────────────────────────

@MainActor @Observable
final class ConsumablesStore {
    private(set) var dashboard: ConsumablesDashboard?
    private(set) var stock: [ConsumableStock] = []
    private(set) var isLoading = false
    private(set) var error: APIError?

    private let service: ConsumablesService

    init(api: APIClient) { service = ConsumablesService(api: api) }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let loaded = try await service.dashboard()
            dashboard = loaded
            stock = loaded.stock()
            error = nil
        } catch let apiError as APIError {
            error = apiError
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }

    var runningOut: [ConsumableStock] { stock.filter(\.isRunningOut) }
    var healthy: [ConsumableStock] { stock.filter { $0.urgency == .ok } }
    var withoutNorm: [ConsumableStock] { stock.filter { $0.urgency == .unknown } }
    var issues: [ConsumableIssue] { dashboard?.issues ?? [] }
}

/// Расходники: где что кончается.
///
/// Расходник не продают, поэтому «остаток» сам по себе ничего не говорит —
/// важно, на сколько дней его хватит при обычном расходе. Позиции без нормы
/// вынесены отдельно: по ним прогноза нет, и это тоже повод их завести.
struct ConsumablesScreen: View {
    @Environment(\.api) private var api
    @Environment(\.access) private var access
    @State private var store: ConsumablesStore?
    @State private var tab: Tab = .stock
    @State private var selectedIssue: ConsumableIssue?
    @State private var isAdding = false

    private var canCreate: Bool { access?.can("store-consumables.create") ?? false }

    private enum Tab: Hashable { case stock, issues }

    var body: some View {
        Group {
            if let store {
                if let error = store.error, store.dashboard == nil {
                    ErrorStateView(error: error) { Task { await store.load() } }
                } else if store.dashboard != nil {
                    content(store)
                } else {
                    LoadingRows(count: 6)
                }
            } else {
                LoadingRows(count: 6)
            }
        }
        .background(Theme.background)
        .sheet(isPresented: $isAdding) {
            // Расходник заводится тем же вызовом, что и товар: отличается
            // только видом — он не продаётся, а списывается.
            AddItemSheet(isConsumable: true) { await store?.load() }
        }
        .navigationTitle("Расходники")
        .toolbar {
            if canCreate {
                ToolbarItem(placement: .primaryAction) {
                    Button { isAdding = true } label: { Image(systemName: "plus") }
                }
            }
            LogoutToolbarItem()
        }
        .task {
            if store == nil {
                let created = ConsumablesStore(api: api)
                store = created
                await created.load()
            }
        }
        .refreshable { await store?.load() }
    }

    @ViewBuilder
    private func content(_ store: ConsumablesStore) -> some View {
        VStack(spacing: 0) {
            summary(store)

            switch tab {
            case .stock: stockList(store)
            case .issues: issuesList(store)
            }
        }
    }

    private func summary(_ store: ConsumablesStore) -> some View {
        VStack(spacing: Spacing.md) {
            // Главная цифра — что кончается: ради неё раздел и открывают.
            // Оранжевый — цвет склада во всём приложении.
            HeroSummary(
                title: "Кончается",
                value: "\(store.runningOut.count)",
                caption: store.runningOut.isEmpty ? "запаса везде хватает" : "заказать до того, как встанет точка",
                footer: [
                    ("В норме", "\(store.healthy.count)"),
                    ("Без нормы", "\(store.withoutNorm.count)"),
                    ("Выдач", "\(store.issues.count)"),
                ],
                colors: Theme.heroGradient
            )
            .padding(.horizontal, Spacing.lg)

            PillSegment(
                options: [(value: Tab.stock, title: "Остатки"), (value: Tab.issues, title: "Выдачи · \(store.issues.count)")],
                selection: $tab
            )
            .padding(.horizontal, Spacing.lg)
        }
        .padding(.vertical, Spacing.md)
    }

    @ViewBuilder
    private func stockList(_ store: ConsumablesStore) -> some View {
        if store.stock.isEmpty {
            WideEmptyState(
                icon: "shippingbox",
                title: "Расходников нет",
                message: "На складах нет остатков по товарам с типом «расходник»."
            )
        } else {
            ScreenScroll {
                VStack(spacing: Spacing.lg) {
                    if !store.runningOut.isEmpty {
                        consumableSection("Кончается", note: "Заказать до того, как встанет точка.", rows: store.runningOut, countTint: Theme.negative)
                    }

                    if !store.healthy.isEmpty {
                        consumableSection("Запаса хватает", note: nil, rows: store.healthy, countTint: Theme.textDim)
                    }

                    if !store.withoutNorm.isEmpty {
                        consumableSection(
                            "Без нормы расхода",
                            note: "Прогноз не построить, пока не задана месячная норма.",
                            rows: store.withoutNorm,
                            countTint: Theme.warning
                        )
                    }
                }
            }
        }
    }

    /// Группа остатков белым блоком: заголовок, пояснение и строки с
    /// тонкими разделителями — одна форма на все три группы.
    private func consumableSection(_ title: String, note: String?, rows: [ConsumableStock], countTint: Color) -> some View {
        OwnerSection(title) {
            Text("\(rows.count)")
                .font(.system(size: 15, weight: .semibold, design: .rounded))
                .foregroundStyle(countTint)
        } content: {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                if let note {
                    Text(note)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textDim)
                }
                VStack(spacing: 0) {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                        if index > 0 { PlainRowDivider(inset: 52) }
                        ConsumableStockRow(row: row)
                            .padding(.vertical, Spacing.sm)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func issuesList(_ store: ConsumablesStore) -> some View {
        MasterDetail(
            items: store.issues,
            selection: $selectedIssue,
            listWidth: 340
        ) { issue in
            ConsumableIssueRow(issue: issue)
        } detail: { issue in
            ConsumableIssueDetail(issue: issue)
        } empty: {
            WideEmptyState(
                icon: "tray.and.arrow.down",
                title: "Выдач нет",
                message: "Здесь появятся выдачи расходников на точки."
            )
        }
    }
}

private struct ConsumableStockRow: View {
    let row: ConsumableStock

    var body: some View {
        // Как строка склада: буква в кружке цвета срочности, остаток
        // крупно справа, на сколько дней хватит — подписью под ним.
        HStack(spacing: Spacing.md) {
            LetterBadge(text: row.itemName, tint: urgencyTint == Theme.textDim ? Theme.brand : urgencyTint)

            VStack(alignment: .leading, spacing: 2) {
                Text(row.itemName)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 2) {
                Text("\(Quantity.format(row.quantity)) \(row.unit)")
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(Theme.text)
                if let days = row.daysLeft {
                    StatusCaption("на \(days) \(pluralize(days, "день", "дня", "дней"))", tint: urgencyTint)
                }
            }
        }
    }

    private var urgencyTint: Color {
        switch row.urgency {
        case .critical: Theme.negative
        case .soon: Theme.warning
        case .ok: Theme.positive
        case .unknown: Theme.textDim
        }
    }

    private var subtitle: String {
        var parts = [row.locationName]
        if let company = row.companyName, company != row.locationName { parts.append(company) }
        if let norm = row.monthlyNorm, norm > 0 {
            parts.append("норма \(Quantity.format(norm))/мес")
        }
        if let limit = row.monthlyLimit, limit > 0 {
            parts.append("лимит \(Quantity.format(limit))")
        }
        return parts.joined(separator: " · ")
    }
}

private struct ConsumableIssueRow: View {
    let issue: ConsumableIssue

    var body: some View {
        HStack(spacing: Spacing.md) {
            TintedIcon(
                systemName: issue.isDisputed ? "exclamationmark.triangle.fill" : "tray.and.arrow.down.fill",
                tint: issue.isDisputed ? Theme.negative : Color(hex: 0xF59E0B)
            )

            VStack(alignment: .leading, spacing: 2) {
                Text(issue.locationName ?? issue.companyName ?? "Точка")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }

            Spacer(minLength: Spacing.sm)

            if issue.isDisputed {
                StatusCaption("расхождение", tint: Theme.negative)
            } else {
                Text(Quantity.format(issue.totalQty))
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(Theme.text)
            }
        }
    }

    private var subtitle: String {
        var parts: [String] = []
        if let date = issue.issueDate {
            parts.append(date.formatted(.dateTime.day().month(.abbreviated)))
        }
        parts.append("\(issue.items.count) \(pluralize(issue.items.count, "позиция", "позиции", "позиций"))")
        return parts.joined(separator: " · ")
    }
}

private struct ConsumableIssueDetail: View {
    let issue: ConsumableIssue

    var body: some View {
        ScreenScroll {
            VStack(spacing: Spacing.lg) {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        HStack(alignment: .top) {
                            Text(issue.locationName ?? "Точка")
                                .font(Typography.title)
                                .foregroundStyle(Theme.text)
                            Spacer()
                            StatusCaption(issue.statusLabel, tint: issue.isDisputed ? Theme.negative : Theme.positive)
                        }

                        if let company = issue.companyName {
                            StatRow("Точка", value: company, icon: "building.2")
                        }
                        if let date = issue.issueDate {
                            StatRow("Дата выдачи", value: date.formatted(.dateTime.day().month(.wide)), icon: "calendar")
                        }
                        if let received = issue.receivedAt {
                            StatRow(
                                "Подтверждено",
                                value: received.formatted(.dateTime.day().month(.wide).hour().minute()),
                                icon: "checkmark.circle"
                            )
                        }
                        if let comment = issue.comment, !comment.isEmpty {
                            RowDivider()
                            Text(comment)
                                .font(Typography.callout)
                                .foregroundStyle(Theme.textMuted)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }

                OwnerSection("Что выдано") {
                    if issue.items.isEmpty {
                        InlineEmpty(icon: "tray", text: "Позиции не указаны", tint: Theme.textDim)
                    } else {
                        VStack(spacing: 0) {
                            ForEach(Array(issue.items.enumerated()), id: \.element.id) { index, line in
                                if index > 0 { PlainRowDivider(inset: 48) }
                                ConsumableIssueLineRow(line: line)
                                    .padding(.vertical, Spacing.sm)
                            }
                        }
                    }
                }
            }
        }
        .background(Theme.background)
        .navigationTitle("Выдача")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}

private struct ConsumableIssueLineRow: View {
    let line: ConsumableIssueLine

    var body: some View {
        HStack(spacing: Spacing.md) {
            LetterBadge(text: line.name, tint: Theme.brand, size: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text(line.name)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                // Одобрили меньше, чем просили, — на точке будет меньше, чем ждали.
                if line.approvedQty > 0, line.approvedQty < line.requestedQty {
                    Text("просили \(Quantity.format(line.requestedQty)) \(line.unit)")
                        .font(Typography.caption)
                        .monospacedDigit()
                        .foregroundStyle(Theme.warning)
                }
            }

            Spacer(minLength: Spacing.sm)

            Text("\(Quantity.format(line.approvedQty > 0 ? line.approvedQty : line.requestedQty)) \(line.unit)")
                .font(Typography.callout.weight(.medium))
                .monospacedDigit()
                .foregroundStyle(Theme.text)
        }
    }
}


/// Новый ингредиент: название, единица, цена закупа.
///
/// Три поля — потому что больше и не нужно, чтобы поставить его в техкарту.
/// Остальное (категория, поставщики) дописывается на сайте, когда дойдут руки.
private struct NewIngredientSheet: View {
    let onCreated: () async -> Void

    @Environment(\.api) private var api
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var unit = "г"
    @State private var price = ""
    @State private var isSaving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScreenScroll {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        FieldLabel("Название")
                        TextField("Например: сироп карамель", text: $name)
                            .textFieldStyle(.plain)
                            .font(Typography.callout)

                        HStack(spacing: Spacing.md) {
                            VStack(alignment: .leading) {
                                FieldLabel("Единица")
                                TextField("г", text: $unit).textFieldStyle(.plain)
                            }
                            VStack(alignment: .leading) {
                                FieldLabel("Цена закупа за единицу")
                                TextField("0", text: $price)
                                    .textFieldStyle(.plain)
                                    #if os(iOS)
                                    .keyboardType(.decimalPad)
                                    #endif
                            }
                        }

                        Text("Цена нужна, чтобы техкарта считала себестоимость. Её можно поправить позже.")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                            .fixedSize(horizontal: false, vertical: true)

                        if let error {
                            Text(error).font(Typography.caption).foregroundStyle(Theme.negative)
                        }

                        Button(isSaving ? "Сохраняем…" : "Добавить") {
                            Task { await save() }
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(isSaving || name.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
            .background(Theme.background)
            .navigationTitle("Ингредиент")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } } }
        }
    }

    private func save() async {
        isSaving = true
        defer { isSaving = false }
        do {
            try await ProductionService(api: api).createIngredient(
                name: name.trimmingCharacters(in: .whitespaces),
                unit: unit.trimmingCharacters(in: .whitespaces).isEmpty ? "г" : unit,
                purchasePrice: AmountParsing.value(price)
            )
            await onCreated()
            dismiss()
        } catch let apiError as APIError {
            error = apiError.userMessage
        } catch {
            self.error = error.localizedDescription
        }
    }
}
