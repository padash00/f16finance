import OrdaKit
import OrdaUI
import SwiftUI

/// Карточка товара: новый или правка.
///
/// Всё, что даёт сайт в окне товара: название, штрихкод, единица, цены,
/// категория, вид (товар или расходник), порог «заканчивается», срок годности,
/// фото ссылкой, заметка. Внизу — удалить или вернуть из архива.
struct CatalogItemSheet: View {
    /// `nil` — новый товар.
    let item: CatalogItem?
    var onSaved: () async -> Void

    @Environment(\.api) private var api
    @Environment(\.access) private var access
    @Environment(\.dismiss) private var dismiss
    @Environment(BusinessStore.self) private var store

    @State private var draft: CatalogItemDraft
    @State private var companyID: String?
    @State private var categories: [InventoryCategory] = []
    @State private var saleText: String
    @State private var purchaseText: String
    @State private var thresholdText: String
    @State private var isSaving = false
    @State private var error: String?
    @State private var confirmingDelete = false

    init(item: CatalogItem?, onSaved: @escaping () async -> Void) {
        self.item = item
        self.onSaved = onSaved
        let draft = item.map(CatalogItemDraft.init(item:)) ?? CatalogItemDraft(requiresExpiry: true)
        _draft = State(initialValue: draft)
        _companyID = State(initialValue: item?.companyID)
        _saleText = State(initialValue: LedgerEditForm.text(draft.salePrice))
        _purchaseText = State(initialValue: LedgerEditForm.text(draft.purchasePrice))
        _thresholdText = State(initialValue: draft.lowStockThreshold.map { Quantity.format($0) } ?? "")
    }

    private var isNew: Bool { item == nil }
    private var canDelete: Bool { access?.can("store-catalog.delete") ?? false }
    private var canEdit: Bool { access?.can("store-catalog.edit") ?? false }

    private var current: CatalogItemDraft {
        var value = draft
        value.salePrice = AmountParsing.value(saleText)
        value.purchasePrice = AmountParsing.value(purchaseText)
        let threshold = thresholdText.trimmingCharacters(in: .whitespaces)
        value.lowStockThreshold = threshold.isEmpty ? nil : AmountParsing.value(threshold)
        return value
    }

    private var problem: String? {
        if isNew, (companyID ?? "").isEmpty { return "Выберите точку-магазин" }
        return current.problem
    }

    /// Наценка — сразу видно, не продаём ли в минус.
    private var margin: String? {
        let sale = current.salePrice, cost = current.purchasePrice
        guard sale > 0, cost > 0 else { return nil }
        let percent = (sale - cost) / cost * 100
        return "наценка \(Int(percent.rounded()))% · \(Money.format(sale - cost)) с единицы"
    }

    var body: some View {
        NavigationStack {
            ScreenScroll {
                header

                LedgerEditForm.section("Товар") {
                    textRow("Название", icon: "shippingbox.fill", text: $draft.name, prompt: "Кола 0,5 л")
                    LedgerEditForm.divider
                    textRow("Штрихкод", icon: "barcode", text: $draft.barcode, prompt: "4870000000000", numeric: true)
                    LedgerEditForm.divider
                    textRow("Единица", icon: "scalemass.fill", text: $draft.unit, prompt: "шт")
                    LedgerEditForm.divider
                    LedgerEditForm.menuRow("Вид", icon: "square.grid.2x2.fill", value: draft.itemType == "consumable" ? "Расходник" : "Товар") {
                        Button("Товар — продаётся") { draft.itemType = "product" }
                        Button("Расходник — списывается") { draft.itemType = "consumable" }
                    }
                }

                LedgerEditForm.section("Цены") {
                    LedgerEditForm.amountRow("Продажа", icon: "tag.fill", text: $saleText)
                    LedgerEditForm.divider
                    LedgerEditForm.amountRow("Закупка", icon: "cart.fill", text: $purchaseText)
                }
                if let margin {
                    Text(margin)
                        .font(.system(size: 13))
                        .foregroundStyle(current.salePrice < current.purchasePrice ? Theme.negative : Theme.textDim)
                        .padding(.horizontal, Spacing.xs)
                }

                LedgerEditForm.section("Учёт") {
                    if isNew {
                        LedgerEditForm.menuRow("Точка", icon: "building.2.fill", value: store.companyName(companyID) ?? "Выбрать") {
                            ForEach(store.companies) { company in
                                Button(company.name) {
                                    companyID = company.id
                                    draft.categoryID = nil
                                    Task { await loadCategories() }
                                }
                            }
                        }
                        LedgerEditForm.divider
                    }
                    LedgerEditForm.menuRow("Категория", icon: "folder.fill", value: categoryName) {
                        Button("Без категории") { draft.categoryID = nil }
                        ForEach(categories) { category in
                            Button(category.name) { draft.categoryID = category.id }
                        }
                    }
                    LedgerEditForm.divider
                    HStack {
                        Label {
                            Text("Заканчивается при")
                                .font(.system(size: 16))
                                .foregroundStyle(Theme.text)
                                .lineLimit(1)
                                .fixedSize()
                        } icon: {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(Theme.brand)
                                .frame(width: 28)
                        }
                        Spacer(minLength: Spacing.md)
                        TextField("не задано", text: $thresholdText)
                            .multilineTextAlignment(.trailing)
                            .font(.system(size: 17, weight: .semibold, design: .rounded))
                            .monospacedDigit()
                            #if os(iOS)
                            .keyboardType(.decimalPad)
                            #endif
                        Text(draft.unit.isEmpty ? "шт" : draft.unit).foregroundStyle(Theme.textDim)
                    }
                    .padding(.vertical, 13)
                    if draft.itemType != "consumable" {
                        LedgerEditForm.divider
                        Toggle(isOn: $draft.requiresExpiry) {
                            Label {
                                Text("Срок годности")
                                    .font(.system(size: 16))
                                    .foregroundStyle(Theme.text)
                            } icon: {
                                Image(systemName: "calendar.badge.clock")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(Theme.brand)
                                    .frame(width: 28)
                            }
                        }
                        .tint(Theme.brand)
                        .padding(.vertical, 8)
                    }
                }

                LedgerEditForm.section("Карточка") {
                    textRow("Фото", icon: "photo.fill", text: $draft.imageURL, prompt: "ссылка https://…", url: true)
                    LedgerEditForm.divider
                    LedgerEditForm.commentRow($draft.notes)
                }

                if isNew || canEdit {
                    LedgerEditForm.saveButton(
                        title: isNew ? "Добавить товар" : "Сохранить",
                        isSaving: isSaving,
                        problem: problem,
                        error: error
                    ) { Task { await save() } }
                }

                if let item, !isNew {
                    if !item.isActive, canEdit {
                        Button {
                            Task { await restore() }
                        } label: {
                            Label("Вернуть из архива", systemImage: "arrow.uturn.backward")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(Theme.brand)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .background(Theme.brand.opacity(0.10), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        }
                        .buttonStyle(.pressable)
                    } else if item.isActive, canDelete {
                        Button(role: .destructive) {
                            confirmingDelete = true
                        } label: {
                            Label("Удалить товар", systemImage: "trash")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(Theme.negative)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .background(Theme.negative.opacity(0.10), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        }
                        .buttonStyle(.pressable)
                    }
                }
            }
            .background(Theme.background)
            .navigationTitle(isNew ? "Новый товар" : "Товар")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } }
            }
            .confirmationDialog("Удалить «\(draft.name)»?", isPresented: $confirmingDelete, titleVisibility: .visible) {
                Button("Удалить", role: .destructive) { Task { await delete() } }
                Button("Отмена", role: .cancel) {}
            } message: {
                Text("Товар с остатком удалить нельзя. Если по нему уже были движения, он уйдёт в архив — история сохранится.")
            }
            .task {
                if store.companies.isEmpty { await store.loadCompanies() }
                if companyID == nil { companyID = store.companies.first?.id }
                await loadCategories()
            }
        }
    }

    private var header: some View {
        VStack(spacing: Spacing.sm) {
            if let url = URL(string: current.imageURL), !current.imageURL.isEmpty {
                Thumbnail(url: url.absoluteString, side: 84, fallbackText: current.name)
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            } else {
                TintedIcon(systemName: "shippingbox.fill", tint: Theme.brand, size: 64)
            }
            Text(current.salePrice > 0 ? Money.format(current.salePrice) : "Цена не задана")
                .font(.system(size: 32, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(current.salePrice > 0 ? Theme.text : Theme.textDim)
            if let item, !isNew {
                Text("склад \(Quantity.format(item.warehouseQuantity)) · витрина \(Quantity.format(item.showcaseQuantity))\(item.isActive ? "" : " · в архиве")")
                    .font(.system(size: 13))
                    .foregroundStyle(item.isActive ? Theme.textDim : Theme.warning)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Spacing.md)
    }

    private var categoryName: String {
        guard let id = draft.categoryID else { return "Без категории" }
        return categories.first { $0.id == id }?.name ?? item?.categoryName ?? "…"
    }

    private func textRow(_ title: String, icon: String, text: Binding<String>, prompt: String, numeric: Bool = false, url: Bool = false) -> some View {
        HStack {
            Label {
                Text(title)
                    .font(.system(size: 16))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                    .fixedSize()
            } icon: {
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.brand)
                    .frame(width: 28)
            }
            Spacer(minLength: Spacing.md)
            TextField(prompt, text: text)
                .multilineTextAlignment(.trailing)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(Theme.text)
                #if os(iOS)
                .keyboardType(numeric ? .numberPad : (url ? .URL : .default))
                .textInputAutocapitalization(url ? .never : .sentences)
                #endif
                .autocorrectionDisabled(numeric || url)
        }
        .padding(.vertical, 13)
    }

    /// Все категории организации, как на сайте, плюс категория самого
    /// товара: у старых товаров она бывает без привязки к организации и в
    /// общий список не попадает.
    private func loadCategories() async {
        var list = (try? await BusinessService(api: api).inventoryCategories()) ?? []
        if let id = item?.categoryID, let name = item?.categoryName, !list.contains(where: { $0.id == id }) {
            list.append(InventoryCategory(id: id, name: name))
        }
        categories = list.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
    }

    private func save() async {
        guard problem == nil else { return }
        await run {
            let service = BusinessService(api: api)
            if let item {
                try await service.updateCatalogItem(id: item.id, draft: current, previousImageURL: item.imageURL)
            } else if let companyID {
                try await service.createCatalogItem(current, companyID: companyID)
            }
            await onSaved()
            dismiss()
        }
    }

    private func delete() async {
        guard let item else { return }
        await run {
            try await BusinessService(api: api).deleteCatalogItem(id: item.id)
            await onSaved()
            dismiss()
        }
    }

    private func restore() async {
        guard let item else { return }
        await run {
            try await BusinessService(api: api).restoreCatalogItem(id: item.id)
            await onSaved()
            dismiss()
        }
    }

    private func run(_ work: () async throws -> Void) async {
        isSaving = true
        defer { isSaving = false }
        error = nil
        do {
            try await work()
            Haptics.success()
        } catch let apiError as APIError {
            error = apiError.userMessage
            Haptics.error()
        } catch {
            self.error = error.localizedDescription
            Haptics.error()
        }
    }
}

/// Категории товаров точки: добавить, переименовать, удалить.
struct CatalogCategoriesSheet: View {
    var onChanged: () async -> Void

    @Environment(\.api) private var api
    @Environment(\.access) private var access
    @Environment(\.dismiss) private var dismiss
    @Environment(BusinessStore.self) private var store

    @State private var companyID: String?
    @State private var categories: [InventoryCategory] = []
    @State private var isLoading = false
    @State private var newName = ""
    @State private var renaming: InventoryCategory?
    @State private var renameText = ""
    @State private var deleting: InventoryCategory?
    @State private var error: String?

    private var canCreate: Bool { access?.can("store-catalog.create") ?? false }
    private var canEdit: Bool { access?.can("store-catalog.edit") ?? false }
    private var canDelete: Bool { access?.can("store-catalog.delete") ?? false }

    var body: some View {
        NavigationStack {
            ScreenScroll {
                LedgerEditForm.section("Точка") {
                    LedgerEditForm.menuRow("Магазин", icon: "building.2.fill", value: store.companyName(companyID) ?? "Выбрать") {
                        ForEach(store.companies) { company in
                            Button(company.name) {
                                companyID = company.id
                                Task { await load() }
                            }
                        }
                    }
                }

                if canCreate {
                    LedgerEditForm.section("Новая категория") {
                        HStack {
                            TextField("Напитки, снеки…", text: $newName)
                                .font(.system(size: 16))
                            Button("Добавить") { Task { await add() } }
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(newName.trimmingCharacters(in: .whitespaces).isEmpty ? Theme.textDim : Theme.brand)
                                .disabled(newName.trimmingCharacters(in: .whitespaces).isEmpty || companyID == nil)
                        }
                        .padding(.vertical, 13)
                    }
                }

                OwnerSection("Категории") {
                    Text("\(categories.count)")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textDim)
                } content: {
                    if isLoading && categories.isEmpty {
                        ProgressView().frame(maxWidth: .infinity).padding()
                    } else if categories.isEmpty {
                        Text("В этой точке категорий пока нет.")
                            .font(.system(size: 14))
                            .foregroundStyle(Theme.textDim)
                    } else {
                        VStack(spacing: 0) {
                            ForEach(Array(categories.enumerated()), id: \.element.id) { index, category in
                                if index > 0 { LedgerEditForm.divider }
                                HStack(spacing: Spacing.md) {
                                    TintedIcon(systemName: "folder.fill", tint: Theme.brand, size: 36, corner: 10)
                                    Text(category.name)
                                        .font(.system(size: 16, weight: .medium))
                                        .foregroundStyle(Theme.text)
                                    Spacer()
                                    if canEdit || canDelete {
                                        Menu {
                                            if canEdit {
                                                Button {
                                                    renameText = category.name
                                                    renaming = category
                                                } label: { Label("Переименовать", systemImage: "pencil") }
                                            }
                                            if canDelete {
                                                Button(role: .destructive) { deleting = category } label: {
                                                    Label("Удалить", systemImage: "trash")
                                                }
                                            }
                                        } label: {
                                            Image(systemName: "ellipsis")
                                                .font(.system(size: 14, weight: .semibold))
                                                .foregroundStyle(Theme.textDim)
                                                .frame(width: 32, height: 32)
                                                .contentShape(Rectangle())
                                        }
                                    }
                                }
                                .padding(.vertical, 8)
                            }
                        }
                    }
                }

                if let error {
                    Text(error)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.negative)
                }
            }
            .background(Theme.background)
            .navigationTitle("Категории")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Готово") { dismiss() } }
            }
            .alert("Переименовать категорию", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
                TextField("Название", text: $renameText)
                Button("Сохранить") { Task { await rename() } }
                Button("Отмена", role: .cancel) {}
            }
            .confirmationDialog(
                "Удалить категорию «\(deleting?.name ?? "")»?",
                isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                titleVisibility: .visible
            ) {
                Button("Удалить", role: .destructive) { Task { await remove() } }
                Button("Отмена", role: .cancel) {}
            } message: {
                Text("Товары останутся — они станут «Без категории».")
            }
            .task {
                if store.companies.isEmpty { await store.loadCompanies() }
                if companyID == nil { companyID = store.companies.first?.id }
                await load()
            }
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        // Весь список организации — как на сайте. С фильтром по точке он был
        // пуст: категории заведены на уровне организации, а не точки.
        categories = ((try? await BusinessService(api: api).inventoryCategories()) ?? [])
            .sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
    }

    private func add() async {
        guard let companyID else { return }
        await run {
            try await BusinessService(api: api).createInventoryCategory(name: newName, companyID: companyID)
            newName = ""
        }
    }

    private func rename() async {
        guard let target = renaming else { return }
        let name = renameText
        await run { try await BusinessService(api: api).renameInventoryCategory(id: target.id, name: name) }
    }

    private func remove() async {
        guard let target = deleting else { return }
        await run { try await BusinessService(api: api).deleteInventoryCategory(id: target.id) }
    }

    private func run(_ work: () async throws -> Void) async {
        error = nil
        do {
            try await work()
            Haptics.success()
            await load()
            await onChanged()
        } catch let apiError as APIError {
            error = apiError.userMessage
            Haptics.error()
        } catch {
            self.error = error.localizedDescription
            Haptics.error()
        }
    }
}
