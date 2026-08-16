import OrdaKit
import OrdaUI
import SwiftUI

// ── Витрина и каталог ────────────────────────────────────────────────────────
//
// Раньше «Склад», «Витрина» и «Каталог товаров» открывали один экран остатков.
// Вопросы у них разные: на складе — сколько лежит, на витрине — что стоит
// перед покупателем и чего не хватает, в каталоге — что вообще заведено, по
// какой цене и с каким штрихкодом.

/// Витрина точки: что выставлено и что пора пополнить со склада.
struct ShowcaseScreen: View {
    @Environment(\.api) private var api
    @State private var store: ShowcaseStore?
    @State private var search = ""
    @State private var onlyRefill = false
    @Environment(\.access) private var access
    /// Позиция, которую двигаем. Лист открывается по строке.
    @State private var moving: ShowcaseRow?

    /// Хотя бы одно направление разрешено — значит, строка нажимается.
    private var canMove: Bool {
        (access?.can("store-showcase.move") ?? false)
            || (access?.can("store-showcase.return_to_warehouse") ?? false)
    }

    var body: some View {
        Group {
            if let store {
                if let error = store.error, store.page == nil {
                    ErrorStateView(error: error) { Task { await store.load() } }
                } else if let page = store.page {
                    list(store: store, page: page)
                } else {
                    LoadingRows(count: 8)
                }
            } else {
                LoadingRows(count: 8)
            }
        }
        .background(Theme.background)
        .sheet(item: $moving) { row in
            if let store, let companyID = store.companyID {
                ShowcaseMoveSheet(row: row, companyID: companyID) {
                    await store.load()
                }
            }
        }
        .navigationTitle("Витрина")
        .searchable(text: $search, prompt: "Название товара")
        .toolbar {
            if let store, store.page?.companies.count ?? 0 > 1 {
                ToolbarItem(placement: .primaryAction) { companyMenu(store) }
            }
            ToolbarItem(placement: .primaryAction) {
                Toggle(isOn: $onlyRefill) {
                    Label("Только пустые", systemImage: "arrow.down.to.line")
                }
                .toggleStyle(.button)
            }
            LogoutToolbarItem()
        }
        .task {
            if store == nil {
                let created = ShowcaseStore(api: api)
                store = created
                await created.load()
            }
        }
        .refreshable { await store?.load() }
    }

    private func companyMenu(_ store: ShowcaseStore) -> some View {
        Menu {
            ForEach(store.page?.companies ?? []) { company in
                Button(company.name) { Task { await store.select(companyID: company.id) } }
            }
        } label: {
            Label(store.companyName, systemImage: "building.2")
        }
    }

    @ViewBuilder
    private func list(store: ShowcaseStore, page: ShowcasePage) -> some View {
        let rows = filtered(page.balances)

        if rows.isEmpty {
            WideEmptyState(
                icon: "cabinet",
                title: search.isEmpty ? "Витрина пуста" : "Ничего не найдено",
                message: search.isEmpty
                    ? "На витрине этой точки сейчас ничего нет."
                    : "Попробуйте другой запрос."
            )
        } else {
            ScrollView {
                LazyVStack(spacing: 0) {
                    summary(page.balances)

                    ForEach(rows) { row in
                        if canMove {
                            // Строка ведёт к движению товара: другого действия
                            // у неё нет, прятать его за меню незачем.
                            Button {
                                moving = row
                            } label: {
                                ShowcaseRowView(row: row)
                                    .padding(.horizontal, Spacing.lg)
                                    .padding(.vertical, Spacing.sm)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.pressable)
                        } else {
                            ShowcaseRowView(row: row)
                                .padding(.horizontal, Spacing.lg)
                                .padding(.vertical, Spacing.sm)
                        }
                        RowDivider().padding(.horizontal, Spacing.lg)
                    }
                }
                .padding(.vertical, Spacing.sm)
            }
        }
    }

    private func summary(_ rows: [ShowcaseRow]) -> some View {
        let refill = rows.filter(\.needsRefill).count
        return Card {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                StatRow("Позиций на витрине", value: "\(rows.count)", icon: "cabinet")
                if refill > 0 {
                    RowDivider()
                    StatRow(
                        "Кончились, но есть на складе",
                        value: "\(refill)",
                        valueColor: Theme.warning,
                        icon: "arrow.down.to.line"
                    )
                }
            }
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.bottom, Spacing.sm)
    }

    private func filtered(_ rows: [ShowcaseRow]) -> [ShowcaseRow] {
        var result = rows
        if onlyRefill { result = result.filter(\.needsRefill) }
        guard !search.isEmpty else { return result }
        return result.filter { $0.name.localizedCaseInsensitiveContains(search) }
    }
}

private struct ShowcaseRowView: View {
    let row: ShowcaseRow

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(row.name)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .lineLimit(2)

                Text("на складе \(Quantity.withUnit(row.warehouseQuantity, unit: row.unit))")
                    .font(Typography.caption)
                    .foregroundStyle(row.needsRefill ? Theme.warning : Theme.textDim)
            }

            Spacer(minLength: Spacing.sm)

            Text(Quantity.withUnit(row.showcaseQuantity, unit: row.unit))
                .font(Typography.callout.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(row.showcaseQuantity > 0 ? Theme.text : Theme.textDim)
        }
    }
}

/// Каталог товаров: номенклатура с ценой, штрихкодом и категорией.
struct CatalogScreen: View {
    @Environment(\.api) private var api
    @State private var store: CatalogStore?
    @State private var search = ""
    @State private var onlyMissing = false

    var body: some View {
        Group {
            if let store {
                if let error = store.error, store.items == nil {
                    ErrorStateView(error: error) { Task { await store.load() } }
                } else if let items = store.items {
                    list(items)
                } else {
                    LoadingRows(count: 8)
                }
            } else {
                LoadingRows(count: 8)
            }
        }
        .background(Theme.background)
        .navigationTitle("Каталог товаров")
        .searchable(text: $search, prompt: "Название или штрихкод")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Toggle(isOn: $onlyMissing) {
                    Label("Только отсутствующие", systemImage: "tray")
                }
                .toggleStyle(.button)
            }
            LogoutToolbarItem()
        }
        .task {
            if store == nil {
                let created = CatalogStore(api: api)
                store = created
                await created.load()
            }
        }
        .refreshable { await store?.load() }
    }

    @ViewBuilder
    private func list(_ items: [CatalogItem]) -> some View {
        let rows = filtered(items)

        if rows.isEmpty {
            WideEmptyState(
                icon: "books.vertical",
                title: search.isEmpty ? "Каталог пуст" : "Ничего не найдено",
                message: search.isEmpty
                    ? "Товары ещё не заведены."
                    : "Попробуйте другой запрос."
            )
        } else {
            ScrollView {
                LazyVStack(spacing: 0) {
                    summary(items)

                    ForEach(rows) { item in
                        CatalogRowView(item: item)
                            .padding(.horizontal, Spacing.lg)
                            .padding(.vertical, Spacing.sm)
                        RowDivider().padding(.horizontal, Spacing.lg)
                    }
                }
                .padding(.vertical, Spacing.sm)
            }
        }
    }

    private func summary(_ items: [CatalogItem]) -> some View {
        let missing = items.filter(\.isOutOfStock).count
        return Card {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                StatRow("Позиций в каталоге", value: "\(items.count)", icon: "books.vertical")
                if missing > 0 {
                    RowDivider()
                    // Не ошибка: позиция может быть заведена заранее. Но если
                    // их сотни — каталог давно не чистили.
                    StatRow("Нет в наличии", value: "\(missing)", icon: "tray")
                }
            }
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.bottom, Spacing.sm)
    }

    private func filtered(_ items: [CatalogItem]) -> [CatalogItem] {
        var result = items
        if onlyMissing { result = result.filter(\.isOutOfStock) }
        guard !search.isEmpty else { return result }
        return result.filter {
            $0.name.localizedCaseInsensitiveContains(search)
                || ($0.barcode?.localizedCaseInsensitiveContains(search) ?? false)
        }
    }
}

private struct CatalogRowView: View {
    let item: CatalogItem

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(item.name)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .lineLimit(2)

                if let subtitle {
                    Text(subtitle)
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: Spacing.xs) {
                if let price = item.salePrice, price > 0 {
                    Text(Money.format(price))
                        .font(Typography.callout.weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(Theme.text)
                }
                Text(Quantity.withUnit(item.catalogQuantity, unit: item.unit))
                    .font(Typography.caption)
                    .monospacedDigit()
                    .foregroundStyle(item.isOutOfStock ? Theme.textDim : Theme.textMuted)
            }
        }
    }

    private var subtitle: String? {
        // Склад и витрина по отдельности — иначе непонятно, где именно лежит
        // общий остаток и надо ли пополнять витрину.
        let placement = "склад \(Quantity.format(item.warehouseQuantity)) · витрина \(Quantity.format(item.showcaseQuantity))"
        let parts = [item.categoryName, item.barcode, placement]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

// ── Хранилища ────────────────────────────────────────────────────────────────

@MainActor
@Observable
final class ShowcaseStore {
    private(set) var page: ShowcasePage?
    private(set) var error: APIError?
    private(set) var companyID: String?

    private let service: BusinessService

    init(api: APIClient) {
        self.service = BusinessService(api: api)
    }

    var companyName: String {
        guard let companyID, let page else { return "Точка" }
        return page.companies.first { $0.id == companyID }?.name ?? "Точка"
    }

    func load() async {
        do {
            let loaded = try await service.showcase(companyID: companyID)
            page = loaded
            // Сервер сам выбирает точку, если её не передали: запоминаем его
            // выбор, иначе переключатель показывал бы «Точка» вместо названия.
            companyID = companyID ?? loaded.selectedCompanyID
            error = nil
        } catch let apiError as APIError {
            error = apiError
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }

    func select(companyID newID: String) async {
        guard newID != companyID else { return }
        companyID = newID
        page = nil
        await load()
    }
}

@MainActor
@Observable
final class CatalogStore {
    private(set) var items: [CatalogItem]?
    private(set) var error: APIError?

    private let service: BusinessService

    init(api: APIClient) {
        self.service = BusinessService(api: api)
    }

    func load() async {
        do {
            items = try await service.catalogItems()
            error = nil
        } catch let apiError as APIError {
            error = apiError
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }
}
