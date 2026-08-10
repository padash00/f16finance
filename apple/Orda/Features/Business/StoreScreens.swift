import OrdaKit
import OrdaUI
import SwiftUI

// ── Обзор магазина ───────────────────────────────────────────────────────────

/// Склад одним взглядом.
///
/// Владелец открывает этот раздел не «посмотреть остатки», а ответить на два
/// вопроса: что кончается и что от меня ждут. Поэтому наверху — заканчивающееся
/// и заявки, а полный список остатков лежит отдельным экраном.
struct StoreScreen: View {
    @Environment(BusinessStore.self) private var store
    @Environment(\.surface) private var surface

    var body: some View {
        ScreenScroll {
            if let error = store.storeError, store.store == nil {
                ErrorStateView(error: error) { Task { await store.loadStore() } }
            } else if let overview = store.store {
                content(overview)
            } else {
                loadingState
            }
        }
        .background(Theme.background)
        .navigationTitle("Магазин")
        .toolbar { LogoutToolbarItem() }
        .task { await store.loadStore() }
        .refreshable { await store.loadStore() }
    }

    private var loadingState: some View {
        VStack(spacing: Spacing.lg) {
            Skeleton(height: 96, cornerRadius: Radius.lg)
            Skeleton(height: 220, cornerRadius: Radius.lg)
            Skeleton(height: 160, cornerRadius: Radius.lg)
        }
    }

    @ViewBuilder
    private func content(_ overview: StoreOverview) -> some View {
        VStack(spacing: Spacing.lg) {
            metrics(overview)

            SplitDashboard {
                lowStockCard(overview)
                movementsCard(overview)
            } side: {
                requestsCard(overview)
                locationsCard(overview)
            }
        }
    }

    // ── Показатели ───────────────────────────────────────────────────────────

    private func metrics(_ overview: StoreOverview) -> some View {
        let totals = overview.totalsByItem
        let low = totals.filter(\.isLow).count
        let pending = overview.pendingRequests.count
        let today = Calendar.current.startOfDay(for: Date())
        let todayMovements = overview.movements.filter { ($0.createdAt ?? .distantPast) >= today }

        return DashboardGrid {
            MetricTile(
                label: "Позиций",
                value: "\(totals.count)",
                icon: "shippingbox.fill",
                accent: Theme.brand
            )
            MetricTile(
                label: "Заканчивается",
                value: "\(low)",
                icon: "exclamationmark.triangle.fill",
                accent: low > 0 ? Theme.warning : Theme.positive
            )
            MetricTile(
                label: "Заявок ждёт",
                value: "\(pending)",
                icon: "tray.full.fill",
                accent: pending > 0 ? Theme.info : Theme.textDim
            )
            MetricTile(
                label: "Движений сегодня",
                value: "\(todayMovements.count)",
                icon: "arrow.left.arrow.right",
                accent: Theme.textMuted
            )
        }
    }

    // ── Заканчивается ────────────────────────────────────────────────────────

    private func lowStockCard(_ overview: StoreOverview) -> some View {
        let low = overview.totalsByItem.filter(\.isLow)

        return Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Заканчивается", subtitle: low.isEmpty ? nil : "\(low.count) позиций ниже порога") {
                    NavigationLink { StockScreen() } label: {
                        Text("Весь склад").font(Typography.caption)
                    }
                }

                if low.isEmpty {
                    InlineEmpty(icon: "checkmark.circle.fill", text: "Все запасы выше порога", tint: Theme.positive)
                } else {
                    ForEach(Array(low.prefix(8).enumerated()), id: \.element.id) { index, item in
                        if index > 0 { RowDivider() }
                        StockRowView(
                            name: item.name,
                            quantity: item.quantity,
                            unit: item.unit,
                            threshold: item.threshold,
                            caption: item.locationCount > 1 ? "в \(item.locationCount) точках" : nil
                        )
                    }
                }
            }
        }
    }

    // ── Движения ─────────────────────────────────────────────────────────────

    private func movementsCard(_ overview: StoreOverview) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Последние движения") {
                    NavigationLink { MovementsScreen() } label: {
                        Text("Все").font(Typography.caption)
                    }
                }

                if overview.movements.isEmpty {
                    InlineEmpty(icon: "tray", text: "Движений пока нет", tint: Theme.textDim)
                } else {
                    ForEach(Array(overview.movements.prefix(7).enumerated()), id: \.element.id) { index, movement in
                        if index > 0 { RowDivider() }
                        MovementRowView(movement: movement)
                    }
                }
            }
        }
    }

    // ── Заявки ───────────────────────────────────────────────────────────────

    private func requestsCard(_ overview: StoreOverview) -> some View {
        let pending = overview.pendingRequests

        return Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Заявки точек", subtitle: pending.isEmpty ? nil : "ждут решения") {
                    NavigationLink { RequestsScreen() } label: {
                        Text("Все").font(Typography.caption)
                    }
                }

                if pending.isEmpty {
                    InlineEmpty(icon: "checkmark.circle", text: "Нет заявок в ожидании", tint: Theme.positive)
                } else {
                    ForEach(Array(pending.prefix(5).enumerated()), id: \.element.id) { index, request in
                        if index > 0 { RowDivider() }
                        RequestRowView(request: request)
                    }
                }
            }
        }
    }

    // ── Точки хранения ───────────────────────────────────────────────────────

    private func locationsCard(_ overview: StoreOverview) -> some View {
        // Считаем позиции по точкам один раз: у крупного клиента балансов
        // десятки тысяч, и перебор на каждую строку заметно тормозил бы.
        var counts: [String: Int] = [:]
        for balance in overview.balances {
            counts[balance.locationID, default: 0] += 1
        }
        let active = overview.locations.filter(\.isActive)

        return Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Точки хранения")

                if active.isEmpty {
                    InlineEmpty(icon: "building.2", text: "Точек не заведено", tint: Theme.textDim)
                } else {
                    ForEach(Array(active.enumerated()), id: \.element.id) { index, location in
                        if index > 0 { RowDivider() }
                        HStack(spacing: Spacing.md) {
                            Image(systemName: location.icon)
                                .font(.system(size: 14))
                                .foregroundStyle(Theme.brand)
                                .frame(width: 22)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(location.name)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.text)
                                Text(location.companyName ?? location.kindLabel)
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.textDim)
                            }
                            Spacer(minLength: Spacing.sm)
                            Text("\(counts[location.id] ?? 0)")
                                .font(Typography.callout.weight(.medium))
                                .monospacedDigit()
                                .foregroundStyle(Theme.textMuted)
                        }
                    }
                }
            }
        }
    }
}

// ── Остатки ──────────────────────────────────────────────────────────────────

/// Полный склад с поиском и разрезом по точкам.
///
/// Два взгляда на одни данные: «по товару» отвечает «сколько всего этого есть»,
/// «по точкам» — «где именно лежит». Владельцу нужен первый, кладовщику второй.
struct StockScreen: View {
    @Environment(BusinessStore.self) private var store

    @State private var search = ""
    @State private var mode: Mode = .byItem
    @State private var onlyLow = false

    private enum Mode: String, CaseIterable, Identifiable {
        case byItem, byLocation
        var id: String { rawValue }
        var label: String {
            switch self {
            case .byItem: "По товару"
            case .byLocation: "По точкам"
            }
        }
    }

    var body: some View {
        Group {
            if let error = store.storeError, store.store == nil {
                ErrorStateView(error: error) { Task { await store.loadStore() } }
            } else if store.store == nil {
                LoadingRows(count: 8)
            } else {
                list
            }
        }
        .background(Theme.background)
        .navigationTitle("Склад")
        .searchable(text: $search, prompt: "Название или штрихкод")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Toggle(isOn: $onlyLow) {
                    Label("Только заканчивающиеся", systemImage: "exclamationmark.triangle")
                }
                .toggleStyle(.button)
            }
        }
        .task { await store.loadStore() }
        .refreshable { await store.loadStore() }
    }

    @ViewBuilder
    private var list: some View {
        VStack(spacing: 0) {
            Picker("Разрез", selection: $mode) {
                ForEach(Mode.allCases) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.md)

            switch mode {
            case .byItem: itemList
            case .byLocation: locationList
            }
        }
    }

    /// Свод по товару: одна строка на позицию.
    private var itemList: some View {
        let items = filteredTotals

        return Group {
            if items.isEmpty {
                WideEmptyState(
                    icon: "shippingbox",
                    title: search.isEmpty ? "Склад пуст" : "Ничего не найдено",
                    message: search.isEmpty ? "Остатков пока нет." : "Попробуйте другой запрос."
                )
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(items) { item in
                            StockRowView(
                                name: item.name,
                                quantity: item.quantity,
                                unit: item.unit,
                                threshold: item.threshold,
                                caption: item.locationCount > 1 ? "в \(item.locationCount) точках" : nil
                            )
                            .padding(.horizontal, Spacing.lg)
                            .padding(.vertical, Spacing.sm)
                            RowDivider().padding(.horizontal, Spacing.lg)
                        }
                    }
                    .padding(.vertical, Spacing.sm)
                }
            }
        }
    }

    /// Разрез по точкам: внутри каждой — её позиции.
    private var locationList: some View {
        let overview = store.store
        let grouped = Dictionary(grouping: filteredBalances, by: \.locationID)
        let locations = (overview?.locations ?? []).filter { grouped[$0.id]?.isEmpty == false }

        return Group {
            if locations.isEmpty {
                WideEmptyState(
                    icon: "building.2",
                    title: "Ничего не найдено",
                    message: "Ни в одной точке нет подходящих позиций."
                )
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: Spacing.lg) {
                        ForEach(locations) { location in
                            Card {
                                VStack(alignment: .leading, spacing: Spacing.sm) {
                                    HStack(spacing: Spacing.sm) {
                                        Image(systemName: location.icon)
                                            .font(.system(size: 13, weight: .semibold))
                                            .foregroundStyle(Theme.brand)
                                        Text(location.name)
                                            .font(Typography.label)
                                            .foregroundStyle(Theme.textDim)
                                            .textCase(.uppercase)
                                        Spacer()
                                        Text("\(grouped[location.id]?.count ?? 0)")
                                            .font(Typography.caption)
                                            .monospacedDigit()
                                            .foregroundStyle(Theme.textDim)
                                    }

                                    ForEach(Array((grouped[location.id] ?? []).enumerated()), id: \.element.id) { index, balance in
                                        if index > 0 { RowDivider() }
                                        StockRowView(
                                            name: balance.name,
                                            quantity: balance.quantity,
                                            unit: balance.unit,
                                            threshold: balance.lowStockThreshold,
                                            caption: nil
                                        )
                                    }
                                }
                            }
                        }
                    }
                    .padding(Spacing.lg)
                }
            }
        }
    }

    // ── Фильтрация ───────────────────────────────────────────────────────────

    /// Идентификаторы мест хранения: сам склад и подсобка.
    ///
    /// Витрина сюда не входит — у неё свой раздел. Пока все три пункта меню
    /// вели на этот экран, показывать всё вместе было единственным вариантом;
    /// теперь «Склад» отвечает ровно за склад, иначе его цифры не сходились бы
    /// с соседним разделом.
    private var stockroomLocationIDs: Set<String> {
        Set((store.store?.locations ?? []).filter(\.isStockroom).map(\.id))
    }

    private var filteredTotals: [StoreOverview.ItemTotal] {
        // Свод по товару считаем из тех же строк, что и разрез по точкам:
        // готовый `totalsByItem` складывает и витрину тоже.
        var items = StoreOverview.totals(of: stockroomBalances)
        if onlyLow { items = items.filter(\.isLow) }
        guard !search.isEmpty else { return items }
        return items.filter { $0.name.localizedCaseInsensitiveContains(search) }
    }

    private var filteredBalances: [StockBalance] {
        var items = stockroomBalances
        if onlyLow { items = items.filter(\.isLow) }
        guard !search.isEmpty else { return items }
        return items.filter {
            $0.name.localizedCaseInsensitiveContains(search)
                || ($0.barcode?.contains(search) ?? false)
        }
    }

    private var stockroomBalances: [StockBalance] {
        let allowed = stockroomLocationIDs
        // Пустой список мест — данные ещё не пришли или сервер не отдал типы.
        // Показать всё честнее, чем пустой склад при полных полках.
        guard !allowed.isEmpty else { return store.store?.balances ?? [] }
        return (store.store?.balances ?? []).filter { allowed.contains($0.locationID) }
    }
}

// ── Заявки ───────────────────────────────────────────────────────────────────

/// Заявки точек на товар: список слева, состав справа.
///
/// Два раздела на одном экране, но с разным вопросом. «Заявки» — рабочий
/// список того, что ждёт решения владельца. «Журнал заявок» — история, куда
/// заходят разбираться, что и когда отгрузили. Раньше оба пункта меню вели
/// сюда с одним и тем же начальным состоянием, и журнал приходилось
/// включать тумблером — то есть его как бы и не было.
struct RequestsScreen: View {
    enum Scope {
        /// Только ждущие решения.
        case pending
        /// Вся история заявок.
        case journal
    }

    var scope: Scope = .pending

    @Environment(BusinessStore.self) private var store
    @Environment(\.access) private var access
    @State private var selected: StockRequest?

    /// Права те же, что проверяет сервер: одобрение и отклонение раздельно.
    private var canApprove: Bool { access?.can("store-requests.approve") ?? false }
    private var canReject: Bool { access?.can("store-requests.reject") ?? false }

    var body: some View {
        let requests = scope == .journal
            ? (store.store?.requests ?? [])
            : (store.store?.pendingRequests ?? [])

        return MasterDetail(
            items: requests,
            selection: $selected,
            actions: { request in
                // Заявку заводит точка, решение принимает владелец. Вопрос
                // решается одним взглядом на остаток — открывать карточку
                // ради этого незачем.
                guard request.isPending else { return [] }
                var result: [RowAction] = []
                if canApprove {
                    result.append(
                        RowAction("Одобрить", icon: "checkmark.circle", tint: Theme.positive) {
                            Task { await store.decideStockRequest(id: request.id, approved: true) }
                        }
                    )
                }
                if canReject {
                    result.append(
                        RowAction("Отклонить", icon: "xmark.circle", isDestructive: true) {
                            Task { await store.decideStockRequest(id: request.id, approved: false) }
                        }
                    )
                }
                return result
            }
        ) { request in
            RequestRowView(request: request)
        } detail: { request in
            RequestDetail(request: request)
        } empty: {
            WideEmptyState(
                icon: "tray",
                title: scope == .journal ? "Заявок не было" : "Нет заявок в ожидании",
                message: scope == .journal
                    ? "Точки ещё не отправляли заявки."
                    : "Всё разобрано. История — в разделе «Журнал заявок»."
            )
        }
        .background(Theme.background)
        .navigationTitle(scope == .journal ? "Журнал заявок" : "Заявки")
        .task { await store.loadStore() }
        .refreshable { await store.loadStore() }
    }
}

private struct RequestDetail: View {
    let request: StockRequest

    @Environment(BusinessStore.self) private var store
    @Environment(\.access) private var access

    private var canApprove: Bool { access?.can("store-requests.approve") ?? false }
    private var canReject: Bool { access?.can("store-requests.reject") ?? false }

    var body: some View {
        ScreenScroll {
            VStack(spacing: Spacing.lg) {
                // Решение и в карточке: свайп хорош для очереди, но когда
                // человек открыл заявку и читает состав, кнопка должна быть
                // здесь же, а не «вернитесь в список и потяните строку».
                if request.isPending, canApprove || canReject {
                    Card {
                        VStack(spacing: Spacing.md) {
                            if let message = store.requestDecisionError {
                                Text(message)
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.negative)
                            }
                            HStack(spacing: Spacing.md) {
                                if canReject {
                                    Button("Отклонить") {
                                        Task { await store.decideStockRequest(id: request.id, approved: false) }
                                    }
                                    .buttonStyle(SecondaryButtonStyle())
                                }
                                if canApprove {
                                    Button("Одобрить") {
                                        Task { await store.decideStockRequest(id: request.id, approved: true) }
                                    }
                                    .buttonStyle(PrimaryButtonStyle())
                                }
                            }
                        }
                    }
                }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        HStack {
                            Text(request.companyName ?? "Точка")
                                .font(Typography.title)
                                .foregroundStyle(Theme.text)
                            Spacer()
                            StatusChip(request.statusLabel, kind: request.isPending ? .warning : .good)
                        }

                        if let from = request.sourceName, let to = request.targetName {
                            StatRow("Маршрут", value: "\(from) → \(to)", icon: "arrow.right")
                        }
                        if let date = request.createdAt {
                            StatRow("Создана", value: date.formatted(.dateTime.day().month(.abbreviated).hour().minute()), icon: "calendar")
                        }
                        if let comment = request.comment, !comment.isEmpty {
                            RowDivider()
                            Text(comment)
                                .font(Typography.callout)
                                .foregroundStyle(Theme.textMuted)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        SectionHeader("Состав", subtitle: "\(request.lines.count) позиций")

                        if request.lines.isEmpty {
                            InlineEmpty(icon: "tray", text: "Позиции не указаны", tint: Theme.textDim)
                        } else {
                            ForEach(Array(request.lines.enumerated()), id: \.element.id) { index, line in
                                if index > 0 { RowDivider() }
                                HStack(spacing: Spacing.md) {
                                    Text(line.name)
                                        .font(Typography.callout)
                                        .foregroundStyle(Theme.text)
                                    Spacer(minLength: Spacing.sm)
                                    // Одобренное количество часто меньше
                                    // запрошенного — показываем оба, иначе
                                    // непонятно, что урезали.
                                    if let approved = line.approved, approved != line.requested {
                                        Text(Quantity.format(line.requested))
                                            .font(Typography.caption)
                                            .monospacedDigit()
                                            .strikethrough()
                                            .foregroundStyle(Theme.textDim)
                                        Text("\(Quantity.format(approved)) \(line.unit)")
                                            .font(Typography.callout.weight(.medium))
                                            .monospacedDigit()
                                            .foregroundStyle(Theme.positive)
                                    } else {
                                        Text("\(Quantity.format(line.requested)) \(line.unit)")
                                            .font(Typography.callout.weight(.medium))
                                            .monospacedDigit()
                                            .foregroundStyle(Theme.text)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        .background(Theme.background)
        .navigationTitle("Заявка")
    }
}

// ── Движения ─────────────────────────────────────────────────────────────────

/// История движений с фильтром по типу.
struct MovementsScreen: View {
    @Environment(BusinessStore.self) private var store
    @State private var kind: String?

    var body: some View {
        let movements = filtered

        return VStack(spacing: 0) {
            filterBar

            if movements.isEmpty {
                WideEmptyState(icon: "arrow.left.arrow.right", title: "Движений нет", message: "За выбранный тип записей нет.")
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(movements) { movement in
                            MovementRowView(movement: movement)
                                .padding(.horizontal, Spacing.lg)
                                .padding(.vertical, Spacing.sm)
                            RowDivider().padding(.horizontal, Spacing.lg)
                        }
                    }
                    .padding(.vertical, Spacing.sm)
                }
            }
        }
        .background(Theme.background)
        .navigationTitle("Движения")
        .task { await store.loadStore() }
        .refreshable { await store.loadStore() }
    }

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Spacing.sm) {
                FilterChip(title: "Все", isOn: kind == nil) { kind = nil }
                ForEach(kinds, id: \.self) { value in
                    FilterChip(title: label(for: value), isOn: kind == value) {
                        kind = kind == value ? nil : value
                    }
                }
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.md)
        }
    }

    private var kinds: [String] {
        Array(Set((store.store?.movements ?? []).map(\.kind))).sorted()
    }

    private func label(for value: String) -> String {
        (store.store?.movements ?? []).first { $0.kind == value }?.kindLabel ?? value
    }

    private var filtered: [StockMovement] {
        let all = store.store?.movements ?? []
        guard let kind else { return all }
        return all.filter { $0.kind == kind }
    }
}

// ── Строки и мелочи ──────────────────────────────────────────────────────────

/// Строка остатка: имя слева, количество справа, порог подсказкой.
struct StockRowView: View {
    let name: String
    let quantity: Double
    let unit: String
    let threshold: Double?
    let caption: String?

    private var isLow: Bool {
        guard let threshold, threshold > 0 else { return false }
        return quantity <= threshold
    }

    var body: some View {
        HStack(spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: 1) {
                Text(name)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                if let caption {
                    Text(caption)
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                } else if isLow, let threshold {
                    Text("порог \(Quantity.format(threshold)) \(unit)")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.warning)
                }
            }

            Spacer(minLength: Spacing.sm)

            Text("\(Quantity.format(quantity)) \(unit)")
                .font(Typography.callout.weight(.medium))
                .monospacedDigit()
                .foregroundStyle(isLow ? Theme.warning : Theme.text)

            if isLow {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.warning)
            }
        }
    }
}

/// Строка движения: тип иконкой, товар, куда/откуда, количество.
struct MovementRowView: View {
    let movement: StockMovement

    private var tint: Color {
        switch movement.direction {
        case 1: Theme.positive
        case -1: Theme.negative
        default: Theme.textMuted
        }
    }

    var body: some View {
        HStack(spacing: Spacing.md) {
            Image(systemName: movement.icon)
                .font(.system(size: 15))
                .foregroundStyle(tint)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 1) {
                Text(movement.itemName)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text(route)
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 1) {
                Text(signedQuantity)
                    .font(Typography.callout.weight(.medium))
                    .monospacedDigit()
                    .foregroundStyle(tint)
                if let date = movement.createdAt {
                    Text(date.formatted(.dateTime.hour().minute()))
                        .font(Typography.caption)
                        .monospacedDigit()
                        .foregroundStyle(Theme.textDim)
                }
            }
        }
    }

    private var route: String {
        switch (movement.fromName, movement.toName) {
        case let (from?, to?): "\(movement.kindLabel) · \(from) → \(to)"
        case let (from?, nil): "\(movement.kindLabel) · из \(from)"
        case let (nil, to?): "\(movement.kindLabel) · в \(to)"
        default: movement.kindLabel
        }
    }

    private var signedQuantity: String {
        let value = Quantity.format(movement.quantity)
        return switch movement.direction {
        case 1: "+\(value)"
        case -1: "−\(value)"
        default: value
        }
    }
}

/// Строка заявки в списке.
struct RequestRowView: View {
    let request: StockRequest

    var body: some View {
        HStack(spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: 1) {
                Text(request.companyName ?? "Точка")
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text("\(request.lines.count) \(pluralize(request.lines.count, "позиция", "позиции", "позиций"))")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 3) {
                StatusChip(request.statusLabel, kind: request.isPending ? .warning : .good)
                if let date = request.createdAt {
                    Text(date.formatted(.dateTime.day().month(.abbreviated)))
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                }
            }
        }
    }
}

/// Компактная подсказка внутри карточки вместо полноэкранной пустоты.
struct InlineEmpty: View {
    let icon: String
    let text: String
    var tint: Color = Theme.textDim

    var body: some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: icon)
                .font(.system(size: 13))
                .foregroundStyle(tint)
            Text(text)
                .font(Typography.callout)
                .foregroundStyle(Theme.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, Spacing.sm)
    }
}

/// Чип фильтра — переключатель без рамки вокруг всего ряда.
struct FilterChip: View {
    let title: String
    let isOn: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(Typography.caption.weight(.medium))
                .padding(.horizontal, Spacing.md)
                .padding(.vertical, Spacing.sm)
                .background(isOn ? Theme.brand.opacity(0.16) : Theme.surfaceRaised)
                .foregroundStyle(isOn ? Theme.brand : Theme.textMuted)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}
