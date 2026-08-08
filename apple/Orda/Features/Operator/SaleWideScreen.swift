import OrdaKit
import OrdaUI
import SwiftUI

/// Касса для широкого экрана — iPad на стойке и Mac.
///
/// Здесь другой сценарий, чем на телефоне: экран большой, обе руки свободны,
/// покупатель стоит напротив. Поэтому каталог — плитками, а корзина видна
/// всегда справа. Так кассир не уходит с экрана между позициями и видит сумму
/// в момент, когда её называет.
///
/// Раскладка списком, растянутым на всю ширину, здесь неуместна: между
/// названием товара и кнопкой «+» получается полметра пустоты, и глаз каждый
/// раз проходит её заново.
struct SaleWideScreen: View {
    @Environment(OperatorStore.self) private var store
    @Environment(\.surface) private var surface

    @State private var search = ""
    @State private var showScanner = false
    @State private var showCheckout = false
    @State private var toast: String?
    @State private var toastIsError = false

    var body: some View {
        Group {
            if !store.hasOpenShift {
                closedShiftState
            } else {
                HStack(spacing: 0) {
                    catalogPane
                    Divider()
                    cartPane
                        .frame(width: surface == .desktop ? 360 : 320)
                }
            }
        }
        .background(Theme.background)
        .navigationTitle("Касса")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showScanner = true
                } label: {
                    Label("Сканировать", systemImage: "barcode.viewfinder")
                }
                .keyboardShortcut("b", modifiers: .command)
            }
            LogoutToolbarItem()
        }
        .task { if store.catalog.isEmpty { await store.loadCatalog() } }
        .sheet(isPresented: $showScanner) { scannerSheet }
        .sheet(isPresented: $showCheckout) { CheckoutSheet() }
        .sheet(item: Binding(
            get: { store.lastSale },
            set: { if $0 == nil { store.dismissLastSale() } }
        )) { feedback in
            SaleReceiptSheet(feedback: feedback)
        }
        .overlay(alignment: .top) {
            if let toast {
                ToastBanner(text: toast, isError: toastIsError)
                    .padding(Spacing.lg)
                    .frame(maxWidth: 480)
            }
        }
        .animation(Motion.value, value: toast)
    }

    // ── Каталог ──────────────────────────────────────────────────────────────

    private var catalogPane: some View {
        VStack(spacing: 0) {
            searchBar

            if store.isLoadingCatalog && store.catalog.isEmpty {
                loadingGrid
            } else if filteredItems.isEmpty {
                EmptyStateView(
                    icon: "magnifyingglass",
                    title: search.isEmpty ? "Витрина пуста" : "Ничего не найдено",
                    message: search.isEmpty
                        ? "На витрине нет товаров с остатком. Оформите заявку со склада."
                        : "Попробуйте другое название или отсканируйте штрихкод."
                )
                .frame(maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVGrid(columns: columns, spacing: Spacing.md) {
                        ForEach(filteredItems) { item in
                            ProductTile(item: item, inCart: quantity(of: item)) {
                                store.add(item)
                                Haptics.tap()
                            }
                        }
                    }
                    .padding(Spacing.lg)
                }
            }
        }
        .frame(maxWidth: .infinity)
    }

    /// Плитки фиксированной минимальной ширины: на широком окне растёт их
    /// количество, а не размер — иначе на маке товар занимал бы пол-экрана.
    private var columns: [GridItem] {
        [GridItem(.adaptive(minimum: 168, maximum: 240), spacing: Spacing.md, alignment: .top)]
    }

    private var loadingGrid: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: Spacing.md) {
                ForEach(0..<12, id: \.self) { _ in
                    Skeleton(height: 104, cornerRadius: Radius.lg)
                }
            }
            .padding(Spacing.lg)
        }
    }

    private var searchBar: some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: "magnifyingglass").foregroundStyle(Theme.textDim)
            TextField("Название или штрихкод", text: $search)
                .textFieldStyle(.plain)
                #if os(iOS)
                .textInputAutocapitalization(.never)
                #endif
                .autocorrectionDisabled()
                .onSubmit(submitSearchAsBarcode)
            if !search.isEmpty {
                Button { search = "" } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.textDim)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(Spacing.md)
        .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
        .padding(.horizontal, Spacing.lg)
        .padding(.top, Spacing.md)
    }

    // ── Корзина ──────────────────────────────────────────────────────────────

    private var cartPane: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Чек")
                    .font(Typography.title)
                    .foregroundStyle(Theme.text)
                Spacer()
                if !store.cart.isEmpty {
                    Button("Очистить") { store.clearCart() }
                        .buttonStyle(.plain)
                        .font(Typography.caption.weight(.semibold))
                        .foregroundStyle(Theme.negative)
                }
            }
            .padding(Spacing.lg)

            if store.cart.isEmpty {
                VStack(spacing: Spacing.md) {
                    Image(systemName: "cart")
                        .font(.system(size: 30, weight: .light))
                        .foregroundStyle(Theme.textDim)
                    Text("Добавьте товар")
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textDim)
                }
                .frame(maxHeight: .infinity)
            } else {
                ScrollView {
                    VStack(spacing: Spacing.sm) {
                        ForEach(store.cart) { line in
                            CartLineRow(line: line) { quantity in
                                store.setQuantity(quantity, for: line.itemID)
                            }
                        }
                    }
                    .padding(.horizontal, Spacing.lg)
                }
            }

            Divider()

            VStack(spacing: Spacing.md) {
                HStack {
                    Text("Итого")
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textMuted)
                    Spacer()
                    Text(Money.format(store.cartTotal))
                        .font(Typography.monospacedDigits(Typography.metric))
                        .foregroundStyle(Theme.text)
                        .contentTransition(.numericText())
                        .animation(Motion.value, value: store.cartTotal)
                }

                Button("К оплате") { showCheckout = true }
                    .buttonStyle(PrimaryButtonStyle(tint: Theme.accent(for: .operator)))
                    .disabled(store.cart.isEmpty)
                    .keyboardShortcut(.return, modifiers: .command)
            }
            .padding(Spacing.lg)
            .background(Theme.elevated)
        }
        .background(Theme.elevated.opacity(0.5))
    }

    // ── Смена закрыта ────────────────────────────────────────────────────────

    private var closedShiftState: some View {
        EmptyStateView(
            icon: "lock.circle",
            title: "Смена не открыта",
            message: "Продажи начинаются после открытия смены — откройте её в разделе «Смена»."
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var scannerSheet: some View {
        NavigationStack {
            VStack {
                ScannerPane { code in handleScan(code) }
                    .padding(Spacing.lg)
                Spacer()
            }
            .frame(minWidth: 420, minHeight: 420)
            .background(Theme.background)
            .navigationTitle("Сканирование")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Готово") { showScanner = false }
                }
            }
        }
    }

    // ── Поведение ────────────────────────────────────────────────────────────

    private var filteredItems: [SaleCatalogItem] {
        let inStock = store.catalog.filter(\.isInStock)
        let needle = search.trimmingCharacters(in: .whitespaces).lowercased()
        guard !needle.isEmpty else { return inStock }
        return inStock.filter {
            $0.name.lowercased().contains(needle) || ($0.barcode ?? "").contains(needle)
        }
    }

    private func quantity(of item: SaleCatalogItem) -> Double {
        store.cart.first { $0.itemID == item.id }?.quantity ?? 0
    }

    /// Ввод в поиске, совпавший со штрихкодом, сразу кладёт товар в чек:
    /// на маке к кассе часто подключён сканер-клавиатура, и он «печатает»
    /// код в активное поле.
    private func submitSearchAsBarcode() {
        let code = search.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !code.isEmpty, store.item(barcode: code) != nil else { return }
        handleScan(code)
        search = ""
    }

    private func handleScan(_ code: String) {
        guard let item = store.item(barcode: code) else {
            show("Штрихкод \(code) не найден на витрине", isError: true)
            Haptics.error()
            return
        }
        guard item.isInStock else {
            show("«\(item.name)» — нет на витрине", isError: true)
            Haptics.error()
            return
        }
        store.add(item)
        show("\(item.name) · \(Money.format(item.salePrice))", isError: false)
        Haptics.success()
    }

    private func show(_ text: String, isError: Bool) {
        toast = text
        toastIsError = isError
        Task {
            try? await Task.sleep(for: .seconds(isError ? 2.5 : 1.2))
            if toast == text { toast = nil }
        }
    }
}

/// Плитка товара в каталоге кассы.
struct ProductTile: View {
    let item: SaleCatalogItem
    let inCart: Double
    let onAdd: () -> Void

    var body: some View {
        Button(action: onAdd) {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Text(item.name)
                    .font(Typography.callout.weight(.medium))
                    .foregroundStyle(Theme.text)
                    .lineLimit(3)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Spacer(minLength: 0)

                HStack(alignment: .firstTextBaseline) {
                    Text(Money.format(item.salePrice))
                        .font(Typography.headline)
                        .monospacedDigit()
                        .foregroundStyle(Theme.text)
                    Spacer()
                    Text("\(Quantity.format(item.displayQuantity))")
                        .font(Typography.caption)
                        .monospacedDigit()
                        .foregroundStyle(item.displayQuantity <= 3 ? Theme.warning : Theme.textDim)
                }
            }
            .padding(Spacing.md)
            .frame(height: 104, alignment: .topLeading)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.lg, style: .continuous)
                    .strokeBorder(inCart > 0 ? Theme.accent(for: .operator) : Theme.border, lineWidth: inCart > 0 ? 2 : 1)
            }
            // Счётчик на плитке: видно, что уже в чеке, без взгляда вправо.
            .overlay(alignment: .topTrailing) {
                if inCart > 0 {
                    Text("\(Quantity.format(inCart))")
                        .font(Typography.caption.weight(.bold))
                        .monospacedDigit()
                        .foregroundStyle(Color.black.opacity(0.85))
                        .padding(.horizontal, Spacing.sm)
                        .padding(.vertical, 2)
                        .background(Theme.accent(for: .operator), in: Capsule())
                        .padding(Spacing.sm)
                        .transition(.scale.combined(with: .opacity))
                }
            }
            .animation(Motion.tap, value: inCart)
        }
        .buttonStyle(PressableTileStyle())
    }
}

/// Строка чека в боковой корзине.
struct CartLineRow: View {
    let line: SaleLine
    let onQuantityChange: (Double) -> Void

    var body: some View {
        HStack(spacing: Spacing.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text(line.name)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .lineLimit(2)
                Text(Money.format(line.unitPrice))
                    .font(Typography.caption)
                    .monospacedDigit()
                    .foregroundStyle(Theme.textDim)
            }

            Spacer(minLength: Spacing.sm)

            HStack(spacing: Spacing.xs) {
                stepButton("minus") { onQuantityChange(line.quantity - 1) }
                Text(Quantity.format(line.quantity))
                    .font(Typography.callout.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(Theme.text)
                    .frame(minWidth: 26)
                stepButton("plus") { onQuantityChange(line.quantity + 1) }
            }

            Text(Money.format(line.total))
                .font(Typography.callout.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(Theme.text)
                .frame(minWidth: 78, alignment: .trailing)
        }
        .padding(.vertical, Spacing.sm)
    }

    private func stepButton(_ icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(Theme.text)
                .frame(width: 24, height: 24)
                .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}
