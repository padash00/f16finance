import OrdaKit
import OrdaUI
import SwiftUI

// ── Чеки ─────────────────────────────────────────────────────────────────────

@MainActor
@Observable
final class PosReceiptsStore {
    private(set) var receipts: [PosReceipt] = []
    /// Сколько чеков в периоде по мнению сервера — может быть больше загруженных.
    private(set) var totalCount = 0
    private(set) var companies: [Company] = []
    private(set) var isLoading = false
    private(set) var error: APIError?
    private(set) var period: PosPeriod = .today
    private(set) var companyID: String?

    /// Потолок дозагрузки. Роут отдаёт по 20 чеков, а для суммы и среднего чека
    /// нужен весь период — но не ценой двадцати запросов на большой точке.
    private static let pageLimit = 15

    private let service: CashboxService
    private let business: BusinessService

    init(api: APIClient) {
        service = CashboxService(api: api)
        business = BusinessService(api: api)
    }

    var summary: PosSalesSummary { PosSalesSummary(receipts) }

    /// Часть периода не загрузилась — сумму нельзя выдавать за полную.
    var isTruncated: Bool { receipts.count < totalCount }

    var companyName: String? {
        guard let companyID else { return nil }
        return companies.first { $0.id == companyID }?.name
    }

    func select(period: PosPeriod) async {
        guard period != self.period else { return }
        self.period = period
        await reload()
    }

    func select(companyID: String?) async {
        guard companyID != self.companyID else { return }
        self.companyID = companyID
        await reload()
    }

    /// При смене фильтра старые чеки убираем сразу: цифры прошлого периода
    /// под новой кнопкой читаются как цифры нового.
    private func reload() async {
        receipts = []
        totalCount = 0
        await load()
    }

    func load() async {
        isLoading = true
        defer { isLoading = false }

        // Список точек нужен только для фильтра: без него экран остаётся
        // рабочим, поэтому его отказ не роняет загрузку чеков.
        if companies.isEmpty {
            companies = (try? await business.companies()) ?? []
        }

        do {
            var collected: [PosReceipt] = []
            var total = 0
            var page = 1
            while page <= Self.pageLimit {
                let chunk = try await service.receipts(period: period, companyID: companyID, page: page)
                collected.append(contentsOf: chunk.receipts)
                total = chunk.total
                if chunk.receipts.isEmpty || collected.count >= total { break }
                page += 1
            }
            receipts = collected
            totalCount = max(total, collected.count)
            error = nil
        } catch let apiError as APIError {
            error = apiError
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }
}

/// Чеки кассы за период.
///
/// Владелец приходит сюда не за таблицей, а за двумя числами: сколько взяли и
/// какой средний чек. Поэтому сверху итог периода, дальше — когда именно шли
/// продажи и через какой канал их пробили, и только потом сами чеки: список
/// нужен, когда ищут конкретную покупку по номеру с бумажки.
struct ReceiptsListScreen: View {
    @Environment(\.api) private var api
    @State private var store: PosReceiptsStore?
    @State private var search = ""

    var body: some View {
        ScreenScroll {
            if let store {
                if let error = store.error, store.receipts.isEmpty {
                    ErrorStateView(error: error) { Task { await store.load() } }
                } else {
                    filters(store)

                    if store.isLoading && store.receipts.isEmpty {
                        LoadingRows(count: 5)
                    } else {
                        content(store)
                    }
                }
            } else {
                LoadingRows(count: 6)
            }
        }
        .background(Theme.background)
        .navigationTitle("Чеки")
        .toolbar { LogoutToolbarItem() }
        .task {
            if store == nil {
                let created = PosReceiptsStore(api: api)
                store = created
                await created.load()
            }
        }
        .refreshable { await store?.load() }
    }

    // ── Фильтры ──────────────────────────────────────────────────────────────

    private func filters(_ store: PosReceiptsStore) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                HStack(spacing: Spacing.sm) {
                    ForEach(PosPeriod.allCases) { period in
                        FilterChip(title: period.title, isOn: store.period == period) {
                            Task { await store.select(period: period) }
                        }
                    }
                    Spacer(minLength: 0)
                }

                // Выбор точки показываем, только если их несколько: на одной
                // точке этот ряд — просто шум.
                if store.companies.count > 1 {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: Spacing.sm) {
                            FilterChip(title: "Все точки", isOn: store.companyID == nil) {
                                Task { await store.select(companyID: nil) }
                            }
                            ForEach(store.companies) { company in
                                FilterChip(title: company.name, isOn: store.companyID == company.id) {
                                    Task { await store.select(companyID: company.id) }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // ── Содержимое ───────────────────────────────────────────────────────────

    @ViewBuilder
    private func content(_ store: PosReceiptsStore) -> some View {
        let summary = store.summary

        if store.receipts.isEmpty {
            WideEmptyState(
                icon: "receipt",
                title: "Чеков нет",
                message: emptyMessage(store)
            )
        } else {
            VStack(spacing: Spacing.lg) {
                DashboardGrid {
                    MetricTile(
                        label: "Выручка",
                        value: Money.compact(summary.revenue),
                        icon: "creditcard.fill",
                        accent: Theme.brand
                    )
                    MetricTile(
                        label: "Чеков",
                        value: "\(store.totalCount)",
                        icon: "receipt",
                        accent: Theme.textMuted
                    )
                    MetricTile(
                        label: "Средний чек",
                        value: Money.compact(summary.averageCheck),
                        icon: "arrow.up.arrow.down",
                        accent: Theme.info
                    )
                    MetricTile(
                        label: "Товаров в чеке",
                        value: Quantity.format(((summary.itemsSold / Double(max(summary.count, 1))) * 10).rounded() / 10),
                        icon: "basket.fill",
                        accent: Theme.textMuted
                    )
                    MetricTile(
                        label: "Скидки",
                        value: Money.compact(summary.discounts + summary.loyaltyDiscounts),
                        icon: "tag.fill",
                        accent: summary.discounts + summary.loyaltyDiscounts > 0 ? Theme.warning : Theme.textDim
                    )
                }

                // Сумма считается по загруженным чекам. Если в периоде их
                // больше, об этом нужно сказать прямо, а не показывать
                // заниженную выручку как полную.
                if store.isTruncated {
                    Card(accent: Theme.warning) {
                        InlineEmpty(
                            icon: "exclamationmark.triangle.fill",
                            text: "Загружено \(store.receipts.count) из \(store.totalCount) чеков — суммы и средний чек посчитаны по ним",
                            tint: Theme.warning
                        )
                    }
                }

                SplitDashboard {
                    salesChart(store)
                    receiptsCard(store)
                } side: {
                    paymentsCard(summary)
                    sourcesCard(store)
                }
            }
        }
    }

    private func emptyMessage(_ store: PosReceiptsStore) -> String {
        let period = store.period.title.lowercased()
        if let point = store.companyName {
            return "За \(period) на точке «\(point)» продаж не было."
        }
        return "За \(period) продаж не было."
    }

    private func salesChart(_ store: PosReceiptsStore) -> some View {
        let buckets = PosSalesSummary.buckets(store.receipts, byHour: store.period.isSingleDay)
        let peak = buckets.max { $0.amount < $1.amount }?.id

        return CategoryBarChart(
            title: store.period.isSingleDay ? "Выручка по часам" : "Выручка по дням",
            points: buckets.map {
                CategoryPoint(label: $0.label, value: $0.amount, isHighlighted: $0.id == peak)
            }
        )
    }

    private func paymentsCard(_ summary: PosSalesSummary) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader(
                    "Чем платили",
                    subtitle: summary.cashlessShare.map { "безнал \(Percent.format($0 * 100))" }
                )

                SplitBar(segments: [
                    .init(label: "Наличные", value: summary.cash, color: ChartPalette.series1),
                    .init(label: "Безналичный", value: summary.kaspi, color: ChartPalette.series2),
                    .init(label: "Карта", value: summary.card, color: ChartPalette.series3),
                    .init(label: "Онлайн", value: summary.online, color: Theme.accent),
                ])

                if summary.cash > 0 {
                    StatRow("Наличные", value: Money.format(summary.cash), icon: "banknote")
                }
                if summary.kaspi > 0 {
                    StatRow("Безналичный", value: Money.format(summary.kaspi), icon: "qrcode")
                }
                if summary.card > 0 {
                    StatRow("Карта", value: Money.format(summary.card), icon: "creditcard")
                }
                if summary.online > 0 {
                    StatRow("Онлайн", value: Money.format(summary.online), icon: "globe")
                }
            }
        }
    }

    private func sourcesCard(_ store: PosReceiptsStore) -> some View {
        let sources = PosSalesSummary.sources(store.receipts)

        return Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Кто пробил", subtitle: "по каналу продажи")

                if sources.isEmpty {
                    InlineEmpty(icon: "person.crop.circle", text: "Данных о канале нет", tint: Theme.textDim)
                } else {
                    ForEach(Array(sources.enumerated()), id: \.element.id) { index, share in
                        if index > 0 { RowDivider() }
                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            StatRow(share.label, value: Money.compact(share.amount))
                            Text("\(share.count) \(pluralize(share.count, "чек", "чека", "чеков"))")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textDim)
                        }
                    }
                }
            }
        }
    }

    private func receiptsCard(_ store: PosReceiptsStore) -> some View {
        let visible = filtered(store)
        let shown = Array(visible.prefix(30))

        return Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Чеки", subtitle: "\(visible.count) \(pluralize(visible.count, "чек", "чека", "чеков"))")

                TextField("Номер чека или сумма", text: $search)
                    .textFieldStyle(.plain)
                    .font(Typography.callout)
                    .padding(Spacing.md)
                    .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
                    #if os(iOS)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.characters)
                    #endif

                if shown.isEmpty {
                    InlineEmpty(icon: "magnifyingglass", text: "По запросу ничего не найдено", tint: Theme.textDim)
                } else {
                    ForEach(Array(shown.enumerated()), id: \.element.id) { index, receipt in
                        if index > 0 { RowDivider() }
                        NavigationLink {
                            PosReceiptDetailView(receipt: receipt)
                        } label: {
                            PosReceiptRow(receipt: receipt)
                        }
                        .buttonStyle(.plain)
                    }

                    if visible.count > shown.count {
                        Text("Показаны первые \(shown.count) — уточните поиск по номеру или сумме")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                    }
                }
            }
        }
    }

    /// Поиск по загруженным чекам: сервер применяет свой фильтр уже после
    /// нарезки на страницы, из-за чего находит только то, что попало на текущую.
    private func filtered(_ store: PosReceiptsStore) -> [PosReceipt] {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let sorted = store.receipts.sorted { ($0.occurredAt ?? .distantPast) > ($1.occurredAt ?? .distantPast) }
        guard !query.isEmpty else { return sorted }
        return sorted.filter {
            $0.shortNumber.lowercased().contains(query)
                || String(format: "%.0f", $0.totalAmount).contains(query)
        }
    }
}

private struct PosReceiptRow: View {
    let receipt: PosReceipt

    var body: some View {
        HStack(spacing: Spacing.md) {
            Image(systemName: receipt.paymentKind.icon)
                .font(.system(size: 14))
                .foregroundStyle(Theme.textMuted)
                .frame(width: 22)

            VStack(alignment: .leading, spacing: 1) {
                Text("№\(receipt.shortNumber)")
                    .font(Typography.callout.weight(.medium))
                    .monospacedDigit()
                    .foregroundStyle(Theme.text)
                Text(subtitle)
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 2) {
                Text(Money.format(receipt.totalAmount))
                    .font(Typography.callout.weight(.medium))
                    .monospacedDigit()
                    .foregroundStyle(Theme.text)
                if receipt.discountAmount + receipt.loyaltyDiscountAmount > 0 {
                    StatusChip("скидка", kind: .warning)
                }
            }
        }
        .contentShape(Rectangle())
    }

    private var subtitle: String {
        var parts: [String] = []
        if let date = receipt.occurredAt {
            parts.append(date.formatted(.dateTime.day().month(.abbreviated).hour().minute()))
        }
        parts.append(receipt.paymentKind.label)
        parts.append("\(receipt.items.count) \(pluralize(receipt.items.count, "позиция", "позиции", "позиций"))")
        return parts.joined(separator: " · ")
    }
}

private struct PosReceiptDetailView: View {
    let receipt: PosReceipt

    var body: some View {
        ScreenScroll {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            Text("№\(receipt.shortNumber)")
                                .font(Typography.title)
                                .monospacedDigit()
                                .foregroundStyle(Theme.text)
                            Text(receipt.sourceLabel)
                                .font(Typography.callout)
                                .foregroundStyle(Theme.textMuted)
                        }
                        Spacer()
                        StatusChip(receipt.paymentKind.label, kind: .info)
                    }

                    RowDivider()

                    if let date = receipt.occurredAt {
                        StatRow(
                            "Пробит",
                            value: date.formatted(.dateTime.day().month(.wide).hour().minute()),
                            icon: "clock"
                        )
                    }
                    if receipt.customerID != nil {
                        StatRow("Покупатель", value: "по карте лояльности", icon: "person.crop.circle")
                    }
                    StatRow("Итого", value: Money.format(receipt.totalAmount), emphasized: true)
                }
            }

            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("Состав", subtitle: "\(receipt.items.count) \(pluralize(receipt.items.count, "позиция", "позиции", "позиций"))")

                    if receipt.items.isEmpty {
                        InlineEmpty(icon: "tray", text: "Позиции не сохранились", tint: Theme.textDim)
                    } else {
                        ForEach(Array(receipt.items.enumerated()), id: \.element.id) { index, line in
                            if index > 0 { RowDivider() }
                            HStack(spacing: Spacing.md) {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(line.name)
                                        .font(Typography.callout)
                                        .foregroundStyle(Theme.text)
                                        .lineLimit(2)
                                    Text("\(Quantity.format(line.quantity)) × \(Money.format(line.unitPrice))")
                                        .font(Typography.caption)
                                        .monospacedDigit()
                                        .foregroundStyle(Theme.textDim)
                                }
                                Spacer(minLength: Spacing.sm)
                                Text(Money.format(line.totalPrice))
                                    .font(Typography.callout.weight(.medium))
                                    .monospacedDigit()
                                    .foregroundStyle(Theme.text)
                            }
                        }
                    }
                }
            }

            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("Оплата")
                    if receipt.cashAmount > 0 {
                        StatRow("Наличные", value: Money.format(receipt.cashAmount), icon: "banknote")
                    }
                    if receipt.kaspiAmount > 0 {
                        StatRow("Безналичный", value: Money.format(receipt.kaspiAmount), icon: "qrcode")
                    }
                    if receipt.cardAmount > 0 {
                        StatRow("Карта", value: Money.format(receipt.cardAmount), icon: "creditcard")
                    }
                    if receipt.onlineAmount > 0 {
                        StatRow("Онлайн", value: Money.format(receipt.onlineAmount), icon: "globe")
                    }
                    if receipt.discountAmount > 0 {
                        RowDivider()
                        StatRow("Скидка", value: Money.signed(-receipt.discountAmount), valueColor: Theme.warning)
                    }
                    if receipt.loyaltyDiscountAmount > 0 {
                        StatRow("Оплачено баллами", value: Money.signed(-receipt.loyaltyDiscountAmount), valueColor: Theme.warning)
                    }
                }
            }

            if receipt.hasLoyalty {
                Card(accent: Theme.warning) {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        SectionHeader("Бонусы")
                        if receipt.loyaltyPointsEarned > 0 {
                            StatRow("Начислено", value: Quantity.format(receipt.loyaltyPointsEarned), valueColor: Theme.positive)
                        }
                        if receipt.loyaltyPointsSpent > 0 {
                            StatRow("Списано", value: Quantity.format(receipt.loyaltyPointsSpent), valueColor: Theme.warning)
                        }
                    }
                }
            }

            if let comment = receipt.comment, !comment.isEmpty {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        SectionHeader("Комментарий")
                        Text(comment)
                            .font(Typography.callout)
                            .foregroundStyle(Theme.textMuted)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
        .background(Theme.background)
        .navigationTitle("Чек №\(receipt.shortNumber)")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}

// ── Возвраты ─────────────────────────────────────────────────────────────────

@MainActor
@Observable
final class PosReturnStore {
    private(set) var sale: PosSaleForReturn?
    private(set) var result: PosReturnResult?
    private(set) var isSearching = false
    private(set) var isSubmitting = false
    private(set) var searchError: String?
    private(set) var submitError: String?

    /// Сколько возвращаем по каждой строке чека.
    var quantities: [String: Double] = [:]

    private let service: CashboxService

    init(api: APIClient) {
        service = CashboxService(api: api)
    }

    var selectedLines: [PosReturnLine] {
        (sale?.returnable ?? []).filter { (quantities[$0.id] ?? 0) > 0 }
    }

    var amount: Double {
        selectedLines.reduce(0) { $0 + (quantities[$1.id] ?? 0) * $1.unitPrice }
    }

    func find(_ number: String) async {
        let trimmed = number.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        isSearching = true
        defer { isSearching = false }
        searchError = nil
        submitError = nil
        result = nil
        quantities = [:]

        do {
            sale = try await service.saleForReturn(number: trimmed)
        } catch let apiError as APIError {
            sale = nil
            searchError = apiError.userMessage
        } catch {
            sale = nil
            searchError = error.localizedDescription
        }
    }

    func toggle(_ line: PosReturnLine) {
        if (quantities[line.id] ?? 0) > 0 {
            quantities[line.id] = 0
        } else {
            // По умолчанию возвращают позицию целиком — частичный возврат
            // редкость, и лишний шаг на нём оправдан.
            quantities[line.id] = line.returnableQuantity
        }
    }

    func submit(reason: String) async {
        guard let sale, !selectedLines.isEmpty else { return }

        isSubmitting = true
        defer { isSubmitting = false }
        submitError = nil

        let draft = PosReturnDraft(
            saleID: sale.id,
            lines: selectedLines.map { line in
                PosReturnDraft.Line(
                    itemID: line.itemID,
                    universalName: line.itemID == nil ? line.universalName ?? line.name : nil,
                    quantity: quantities[line.id] ?? 0,
                    unitPrice: line.unitPrice
                )
            },
            reason: reason
        )

        do {
            result = try await service.createReturn(draft)
            Haptics.success()
        } catch let apiError as APIError {
            submitError = apiError.userMessage
            Haptics.error()
        } catch {
            submitError = error.localizedDescription
            Haptics.error()
        }
    }

    func reset() {
        sale = nil
        result = nil
        quantities = [:]
        searchError = nil
        submitError = nil
    }
}

/// Возврат товара по чеку.
///
/// Возврат — это всегда вопрос «почему»: сумма вернётся клиенту тем же
/// способом, каким он платил, и без причины в журнале остаётся только минус,
/// который потом никто не объяснит. Поэтому причина здесь обязательна, хотя
/// сервер и принимает её пустой.
struct ReturnsScreen: View {
    @Environment(\.api) private var api
    @Environment(\.access) private var access

    @State private var store: PosReturnStore?
    @State private var number = ""
    @State private var reason = ""

    private var canReturn: Bool { access?.can("pos-returns.return") == true }

    var body: some View {
        ScreenScroll {
            if let store {
                if let result = store.result {
                    successCard(store, result)
                } else {
                    searchCard(store)

                    if let sale = store.sale {
                        saleCard(sale)
                        linesCard(store, sale)
                        if !store.selectedLines.isEmpty {
                            reasonCard(store, sale)
                        }
                    }
                }
            } else {
                LoadingRows(count: 3)
            }
        }
        .background(Theme.background)
        .navigationTitle("Возврат")
        .toolbar { LogoutToolbarItem() }
        .task { if store == nil { store = PosReturnStore(api: api) } }
    }

    // ── Поиск чека ───────────────────────────────────────────────────────────

    private func searchCard(_ store: PosReturnStore) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Какой чек возвращаем", subtitle: "последние 6 символов номера — они напечатаны внизу чека")

                HStack(spacing: Spacing.sm) {
                    TextField("Например, 1C54E4", text: $number)
                        .textFieldStyle(.plain)
                        .font(Typography.body.monospaced())
                        .padding(Spacing.md)
                        .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
                        .onSubmit { Task { await store.find(number) } }
                        #if os(iOS)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.characters)
                        #endif

                    Button("Найти") {
                        Task { await store.find(number) }
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(store.isSearching || number.trimmingCharacters(in: .whitespaces).isEmpty)
                }

                if store.isSearching {
                    Skeleton(height: 44, cornerRadius: Radius.md)
                }
                if let error = store.searchError {
                    Text(error)
                        .font(Typography.callout)
                        .foregroundStyle(Theme.negative)
                }
            }
        }
    }

    // ── Найденный чек ────────────────────────────────────────────────────────

    private func saleCard(_ sale: PosSaleForReturn) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        Text("№\(sale.shortNumber)")
                            .font(Typography.title)
                            .monospacedDigit()
                            .foregroundStyle(Theme.text)
                        if let date = sale.occurredAt {
                            Text(date.formatted(.dateTime.day().month(.wide).hour().minute()))
                                .font(Typography.callout)
                                .foregroundStyle(Theme.textMuted)
                        }
                    }
                    Spacer()
                    StatusChip(sale.paymentKind.label, kind: .info)
                }

                RowDivider()
                StatRow("Сумма чека", value: Money.format(sale.totalAmount), emphasized: true)

                if sale.hasPreviousReturns {
                    StatusChip("по чеку уже были возвраты", kind: .warning)
                }
            }
        }
    }

    private func linesCard(_ store: PosReturnStore, _ sale: PosSaleForReturn) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Что возвращают")

                if sale.returnable.isEmpty {
                    InlineEmpty(
                        icon: "checkmark.circle.fill",
                        text: "Все товары по этому чеку уже возвращены",
                        tint: Theme.positive
                    )
                } else {
                    ForEach(Array(sale.returnable.enumerated()), id: \.element.id) { index, line in
                        if index > 0 { RowDivider() }
                        PosReturnLineRow(
                            line: line,
                            quantity: store.quantities[line.id] ?? 0,
                            onToggle: { store.toggle(line) },
                            onChange: { store.quantities[line.id] = $0 }
                        )
                    }
                }
            }
        }
    }

    private func reasonCard(_ store: PosReturnStore, _ sale: PosSaleForReturn) -> some View {
        Card(accent: Theme.warning) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Почему возвращают", subtitle: "причину увидят в журнале смены")

                TextField("Например: не подошёл размер", text: $reason, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(Typography.callout)
                    .lineLimit(2...5)
                    .padding(Spacing.md)
                    .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))

                RowDivider()
                StatRow(
                    "К возврату",
                    value: Money.format(store.amount),
                    valueColor: Theme.negative,
                    emphasized: true
                )
                Text("Деньги вернутся тем же способом, каким платил клиент — \(sale.paymentKind.label.lowercased()).")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)

                if let error = store.submitError {
                    Text(error)
                        .font(Typography.callout)
                        .foregroundStyle(Theme.negative)
                }

                if canReturn {
                    Button(store.isSubmitting ? "Оформляем…" : "Оформить возврат") {
                        Task { await store.submit(reason: reason) }
                    }
                    .buttonStyle(DestructiveButtonStyle())
                    .disabled(store.isSubmitting || reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                } else {
                    InlineEmpty(
                        icon: "lock.fill",
                        text: "Оформить возврат может сотрудник с правом «Оформить возврат»",
                        tint: Theme.warning
                    )
                }
            }
        }
    }

    // ── Итог ─────────────────────────────────────────────────────────────────

    private func successCard(_ store: PosReturnStore, _ result: PosReturnResult) -> some View {
        Card(accent: Theme.positive) {
            VStack(spacing: Spacing.md) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 40))
                    .foregroundStyle(Theme.positive)

                Text("Возврат оформлен")
                    .font(Typography.title)
                    .foregroundStyle(Theme.text)

                Text(Money.format(result.amount))
                    .font(Typography.monospacedDigits(Typography.metric))
                    .foregroundStyle(Theme.positive)

                Text("№ \(result.number)")
                    .font(Typography.caption.monospaced())
                    .foregroundStyle(Theme.textDim)

                Text("Сумма уже учтена в смене и записана в журнал.")
                    .font(Typography.callout)
                    .foregroundStyle(Theme.textMuted)
                    .multilineTextAlignment(.center)

                Button("Оформить ещё возврат") {
                    number = ""
                    reason = ""
                    store.reset()
                }
                .buttonStyle(PrimaryButtonStyle())
            }
            .frame(maxWidth: .infinity)
        }
    }
}

private struct PosReturnLineRow: View {
    let line: PosReturnLine
    let quantity: Double
    let onToggle: () -> Void
    let onChange: (Double) -> Void

    private var isSelected: Bool { quantity > 0 }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Button(action: onToggle) {
                HStack(spacing: Spacing.md) {
                    Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 18))
                        .foregroundStyle(isSelected ? Theme.brand : Theme.textDim)

                    VStack(alignment: .leading, spacing: 1) {
                        Text(line.name)
                            .font(Typography.callout)
                            .foregroundStyle(Theme.text)
                            .lineLimit(2)
                        Text(subtitle)
                            .font(Typography.caption)
                            .monospacedDigit()
                            .foregroundStyle(Theme.textDim)
                    }

                    Spacer(minLength: Spacing.sm)

                    Text(Money.format(line.unitPrice * (isSelected ? quantity : line.returnableQuantity)))
                        .font(Typography.callout.weight(.medium))
                        .monospacedDigit()
                        .foregroundStyle(isSelected ? Theme.negative : Theme.textMuted)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            // Шаг количества показываем только там, где выбор вообще есть:
            // на единственной штуке возвращать «часть» нечего.
            if isSelected && line.returnableQuantity > 1 {
                Stepper(
                    value: Binding(get: { quantity }, set: onChange),
                    in: 1...line.returnableQuantity,
                    step: 1
                ) {
                    Text("Возвращаем \(Quantity.format(quantity)) из \(Quantity.format(line.returnableQuantity))")
                        .font(Typography.caption)
                        .monospacedDigit()
                        .foregroundStyle(Theme.textMuted)
                }
            }
        }
    }

    private var subtitle: String {
        var parts = ["доступно \(Quantity.format(line.returnableQuantity)) × \(Money.format(line.unitPrice))"]
        if line.returnedQuantity > 0 {
            parts.append("уже вернули \(Quantity.format(line.returnedQuantity))")
        }
        return parts.joined(separator: " · ")
    }
}

// ── Реквизиты чека ККМ ───────────────────────────────────────────────────────

@MainActor
@Observable
final class ReceiptSettingsStore {
    private(set) var payload: ReceiptSettingsPayload?
    private(set) var isLoading = false
    private(set) var error: APIError?
    private(set) var companyID: String?

    private let service: CashboxService

    init(api: APIClient) {
        service = CashboxService(api: api)
    }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let loaded = try await service.receiptSettings(companyID: companyID)
            payload = loaded
            // Сервер сам выбирает первую доступную точку — запоминаем её,
            // иначе чипсы не покажут, что именно сейчас на экране.
            if companyID == nil { companyID = loaded.settings?.companyID ?? loaded.companies.first?.id }
            error = nil
        } catch let apiError as APIError {
            error = apiError
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }

    func select(companyID: String) async {
        guard companyID != self.companyID else { return }
        self.companyID = companyID
        await load()
    }
}

/// Реквизиты фискального чека точки.
///
/// Владельца здесь интересует ровно одно: выдаёт ли касса чек, который
/// налоговая признает. Поэтому сверху — чего не хватает по приказу МФ РК №626,
/// а сами реквизиты ниже, для сверки с регистрационной карточкой ККМ.
struct ReceiptSettingsScreen: View {
    @Environment(\.api) private var api
    @State private var store: ReceiptSettingsStore?

    var body: some View {
        ScreenScroll {
            if let store {
                if let error = store.error, store.payload == nil {
                    ErrorStateView(error: error) { Task { await store.load() } }
                } else if let payload = store.payload {
                    content(store, payload)
                } else {
                    LoadingRows(count: 5)
                }
            } else {
                LoadingRows(count: 5)
            }
        }
        .background(Theme.background)
        .navigationTitle("Реквизиты чека")
        .toolbar { LogoutToolbarItem() }
        .task {
            if store == nil {
                let created = ReceiptSettingsStore(api: api)
                store = created
                await created.load()
            }
        }
        .refreshable { await store?.load() }
    }

    @ViewBuilder
    private func content(_ store: ReceiptSettingsStore, _ payload: ReceiptSettingsPayload) -> some View {
        if payload.companies.count > 1 {
            Card {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Spacing.sm) {
                        ForEach(payload.companies) { company in
                            FilterChip(title: company.name, isOn: store.companyID == company.id) {
                                Task { await store.select(companyID: company.id) }
                            }
                        }
                    }
                }
            }
        }

        if let settings = payload.settings {
            complianceCard(settings)
            detailsCard(settings)
            printingCard(settings)
        } else {
            WideEmptyState(
                icon: "doc.text",
                title: "Точек нет",
                message: "Реквизиты чека задаются для точки, а доступных точек не нашлось."
            )
        }
    }

    private func complianceCard(_ settings: ReceiptSettings) -> some View {
        Card(accent: settings.isCompliant ? Theme.positive : Theme.negative) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader(
                    settings.isCompliant ? "Чек заполнен полностью" : "Чек неполный",
                    subtitle: "обязательные реквизиты по приказу МФ РК №626"
                )

                if !settings.isCompliant {
                    Text("Без этих полей чек считается невыданным — заполнить их можно в веб-кабинете.")
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textMuted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                ForEach(Array(settings.requirements.enumerated()), id: \.element.id) { index, requirement in
                    if index > 0 { RowDivider() }
                    HStack(spacing: Spacing.md) {
                        Image(systemName: requirement.isFilled ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
                            .font(.system(size: 14))
                            .foregroundStyle(requirement.isFilled ? Theme.positive : Theme.negative)
                            .frame(width: 20)

                        Text(requirement.title)
                            .font(Typography.callout)
                            .foregroundStyle(requirement.isFilled ? Theme.textMuted : Theme.text)

                        Spacer(minLength: Spacing.sm)

                        Text(requirement.isFilled ? requirement.value : "не заполнено")
                            .font(Typography.callout.weight(.medium))
                            .foregroundStyle(requirement.isFilled ? Theme.text : Theme.negative)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }
            }
        }
    }

    private func detailsCard(_ settings: ReceiptSettings) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Касса и налоги")
                StatRow(
                    "НДС",
                    value: settings.isVatPayer ? "плательщик, \(Percent.format(settings.vatRate))" : "не плательщик",
                    valueColor: settings.isVatPayer ? Theme.text : Theme.textMuted,
                    icon: "percent"
                )
                StatRow("Заводской № ККМ", value: settings.kkmFactoryNumber.isEmpty ? "—" : settings.kkmFactoryNumber, icon: "number")
                StatRow("Регистрационный № ККМ", value: settings.kkmRegistrationNumber.isEmpty ? "—" : settings.kkmRegistrationNumber, icon: "doc.badge.gearshape")
                StatRow("ОФД", value: settings.ofdName.isEmpty ? "—" : settings.ofdName, icon: "antenna.radiowaves.left.and.right")
                if !settings.ofdCheckURL.isEmpty {
                    StatRow("Проверка чека", value: settings.ofdCheckURL, icon: "link")
                }
            }
        }
    }

    private func printingCard(_ settings: ReceiptSettings) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Что печатается на чеке")
                StatRow("Язык", value: settings.languageLabel, icon: "textformat")
                StatRow(
                    "ИИН покупателя",
                    value: settings.requireBuyerIIN ? "спрашивать" : "не спрашивать",
                    icon: "person.text.rectangle"
                )
                StatRow(
                    "Маркировка",
                    value: settings.markingEnabled ? "включена" : "выключена",
                    valueColor: settings.markingEnabled ? Theme.positive : Theme.textMuted,
                    icon: "barcode"
                )
                StatRow(
                    "НКТ",
                    value: settings.nktEnabled ? "включён" : "выключен",
                    valueColor: settings.nktEnabled ? Theme.positive : Theme.textMuted,
                    icon: "shippingbox"
                )
                if !settings.reviewURL.isEmpty {
                    StatRow("Ссылка на отзыв", value: settings.reviewURL, icon: "star")
                }
                if settings.footerText.isEmpty {
                    InlineEmpty(icon: "text.append", text: "Текст в подвале чека не задан", tint: Theme.textDim)
                } else {
                    RowDivider()
                    Text(settings.footerText)
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textMuted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }
}

// ── Реклама на экране покупателя ─────────────────────────────────────────────

@MainActor
@Observable
final class AdvertisingStore {
    private(set) var slides: [AdSlide] = []
    private(set) var companies: [Company] = []
    private(set) var isLoading = false
    private(set) var error: APIError?
    private(set) var actionError: String?

    private let service: CashboxService
    private let business: BusinessService

    init(api: APIClient) {
        service = CashboxService(api: api)
        business = BusinessService(api: api)
    }

    var playlists: [AdPlaylist] { AdPlaylist.group(slides: slides, companies: companies) }

    func load() async {
        isLoading = true
        defer { isLoading = false }

        if companies.isEmpty {
            companies = (try? await business.companies()) ?? []
        }

        do {
            slides = try await service.advertising()
            error = nil
        } catch let apiError as APIError {
            error = apiError
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }

    func setActive(_ slide: AdSlide, isActive: Bool) async {
        actionError = nil
        do {
            try await service.setSlideActive(id: slide.id, isActive: isActive)
            if let index = slides.firstIndex(where: { $0.id == slide.id }) {
                slides[index].isActive = isActive
            }
            Haptics.tap()
        } catch let apiError as APIError {
            actionError = apiError.userMessage
            Haptics.error()
        } catch {
            actionError = error.localizedDescription
            Haptics.error()
        }
    }

    func delete(_ slide: AdSlide) async {
        actionError = nil
        do {
            try await service.deleteSlide(id: slide.id)
            slides.removeAll { $0.id == slide.id }
            Haptics.success()
        } catch let apiError as APIError {
            actionError = apiError.userMessage
            Haptics.error()
        } catch {
            actionError = error.localizedDescription
            Haptics.error()
        }
    }
}

/// Реклама на экране покупателя.
///
/// Вопрос владельца — что сейчас видит человек у кассы. Поэтому точки, где
/// экран молчит, вынесены наверх: пустой плейлист выглядит как исправная
/// техника, но продаёт ноль.
struct AdvertisingScreen: View {
    @Environment(\.api) private var api
    @Environment(\.access) private var access

    @State private var store: AdvertisingStore?
    @State private var deleting: AdSlide?

    private var canEdit: Bool { access?.can("store-advertising.edit") == true }
    private var canDelete: Bool { access?.can("store-advertising.delete") == true }

    var body: some View {
        ScreenScroll {
            if let store {
                if let error = store.error, store.slides.isEmpty {
                    ErrorStateView(error: error) { Task { await store.load() } }
                } else if store.isLoading && store.slides.isEmpty {
                    LoadingRows(count: 5)
                } else {
                    content(store)
                }
            } else {
                LoadingRows(count: 5)
            }
        }
        .background(Theme.background)
        .navigationTitle("Реклама на экране")
        .toolbar { LogoutToolbarItem() }
        .task {
            if store == nil {
                let created = AdvertisingStore(api: api)
                store = created
                await created.load()
            }
        }
        .refreshable { await store?.load() }
        .confirmationDialog(
            "Удалить ролик?",
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            titleVisibility: .visible
        ) {
            Button("Удалить", role: .destructive) {
                if let slide = deleting, let store {
                    Task { await store.delete(slide) }
                }
                deleting = nil
            }
            Button("Отмена", role: .cancel) { deleting = nil }
        } message: {
            Text("Файл удалится из хранилища — вернуть его можно будет только повторной загрузкой.")
        }
    }

    @ViewBuilder
    private func content(_ store: AdvertisingStore) -> some View {
        let playlists = store.playlists
        let silent = playlists.filter(\.isSilent)
        let activeCount = playlists.reduce(0) { $0 + $1.active.count }
        let pausedCount = store.slides.count - activeCount

        if playlists.isEmpty {
            WideEmptyState(
                icon: "play.rectangle",
                title: "Роликов нет",
                message: "Экран покупателя ничего не показывает. Файлы загружают в веб-кабинете — оттуда они уходят в хранилище напрямую."
            )
        } else {
            DashboardGrid {
                MetricTile(
                    label: "Крутится сейчас",
                    value: "\(activeCount)",
                    icon: "play.circle.fill",
                    accent: Theme.brand
                )
                MetricTile(
                    label: "Выключено",
                    value: "\(pausedCount)",
                    icon: "pause.circle",
                    accent: Theme.textDim
                )
                MetricTile(
                    label: "Экранов молчит",
                    value: "\(silent.count)",
                    icon: "rectangle.slash",
                    accent: silent.isEmpty ? Theme.positive : Theme.warning
                )
            }

            if let actionError = store.actionError {
                Text(actionError)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.negative)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            ForEach(playlists) { playlist in
                playlistCard(store, playlist)
            }
        }
    }

    private func playlistCard(_ store: AdvertisingStore, _ playlist: AdPlaylist) -> some View {
        Card(accent: playlist.isSilent ? Theme.warning : nil) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader(playlist.companyName, subtitle: loopSubtitle(playlist))

                if playlist.slides.isEmpty {
                    InlineEmpty(icon: "rectangle.slash", text: "Плейлист пуст", tint: Theme.warning)
                } else {
                    ForEach(Array(playlist.slides.enumerated()), id: \.element.id) { index, slide in
                        if index > 0 { RowDivider() }
                        AdSlideRow(
                            slide: slide,
                            canEdit: canEdit,
                            canDelete: canDelete,
                            onToggle: { Task { await store.setActive(slide, isActive: !slide.isActive) } },
                            onDelete: { deleting = slide }
                        )
                    }
                }
            }
        }
    }

    private func loopSubtitle(_ playlist: AdPlaylist) -> String {
        if playlist.isSilent { return "экран ничего не показывает" }
        var text = "круг \(Int(playlist.imageLoopSeconds)) с"
        if playlist.hasVideo { text += " плюс видео" }
        return text
    }
}

private struct AdSlideRow: View {
    let slide: AdSlide
    let canEdit: Bool
    let canDelete: Bool
    let onToggle: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(spacing: Spacing.md) {
            // У видео превью нет — сервер хранит только ссылку на файл,
            // поэтому вместо картинки честная иконка.
            if slide.isVideo {
                Image(systemName: "film.fill")
                    .font(.system(size: 16))
                    .foregroundStyle(Theme.textMuted)
                    .frame(width: 44, height: 44)
                    .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
            } else {
                Thumbnail(url: slide.url, side: 44, cornerRadius: Radius.sm, fallbackText: "IMG")
            }

            VStack(alignment: .leading, spacing: 1) {
                Text(slide.displayTitle)
                    .font(Typography.callout)
                    .foregroundStyle(slide.isActive ? Theme.text : Theme.textDim)
                    .lineLimit(1)
                Text("\(slide.isVideo ? "Видео" : "Картинка") · \(slide.durationLabel)")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
            }

            Spacer(minLength: Spacing.sm)

            StatusChip(slide.isActive ? "в эфире" : "выключен", kind: slide.isActive ? .good : .neutral)

            if canEdit || canDelete {
                Menu {
                    if canEdit {
                        Button(slide.isActive ? "Выключить" : "Включить", action: onToggle)
                    }
                    if canDelete {
                        Button("Удалить", role: .destructive, action: onDelete)
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.system(size: 15))
                        .foregroundStyle(Theme.textDim)
                }
                .buttonStyle(.plain)
                .fixedSize()
            }
        }
    }
}
