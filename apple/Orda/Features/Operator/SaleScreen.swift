import OrdaKit
import OrdaUI
import SwiftUI

/// Продажа: сканер, каталог витрины, корзина, оплата.
struct SaleScreen: View {
    @Environment(OperatorStore.self) private var store

    @State private var search = ""
    @State private var showScanner = false
    @State private var showCheckout = false
    /// Чек целиком: убрать позицию, поправить количество, очистить.
    @State private var showCart = false
    @State private var toast: String?
    @State private var toastIsError = false

    var body: some View {
        Group {
            if store.isSomeoneElsesShift {
                // Продажа уйдёт в чужую смену и в чужой отчёт: деньги окажутся
                // записаны не на того, кто их взял.
                EmptyStateView(
                    icon: "person.fill.checkmark",
                    title: "На смене другой",
                    message: "Сейчас смену ведёт \(store.shift?.operatorName ?? "сменщик"). Продавать можно только на своей смене."
                )
            } else if !store.hasOpenShift {
                EmptyStateView(
                    icon: "lock.circle",
                    title: "Смена не открыта",
                    message: "Продажи начинаются после открытия смены — откройте её на вкладке «Смена»."
                )
            } else {
                content
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background)
        .navigationTitle("Продажа")
        .task {
            if store.catalog.isEmpty { await store.loadCatalog() }
        }
        .refreshable { await store.loadCatalog() }
        .sheet(isPresented: $showScanner) { scannerSheet }
        .sheet(isPresented: $showCheckout) { CheckoutSheet() }
        .sheet(isPresented: $showCart) {
            CartSheet {
                showCart = false
                showCheckout = true
            }
            .presentationDetents([.medium, .large])
        }
        .overlay(alignment: .top) {
            if let toast {
                ToastBanner(text: toast, isError: toastIsError)
                    .padding(.horizontal, Spacing.lg)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(Motion.value, value: toast)
        .overlay(alignment: .bottom) {
            if !store.cart.isEmpty {
                cartBar
            }
        }
        .sheet(item: Binding(
            get: { store.lastSale },
            set: { if $0 == nil { store.dismissLastSale() } }
        )) { feedback in
            SaleReceiptSheet(feedback: feedback)
        }
    }

    private var content: some View {
        VStack(spacing: 0) {
            searchBar

            if store.isLoadingCatalog && store.catalog.isEmpty {
                VStack(spacing: Spacing.md) {
                    ForEach(0..<6, id: \.self) { _ in Skeleton(height: 56) }
                }
                .padding(Spacing.lg)
            } else if let error = store.catalogError {
                ErrorStateView(error: .transport(message: error)) {
                    Task { await store.loadCatalog() }
                }
            } else if filteredItems.isEmpty {
                EmptyStateView(
                    icon: "magnifyingglass",
                    title: search.isEmpty ? "Витрина пуста" : "Ничего не найдено",
                    message: search.isEmpty
                        ? "На витрине нет товаров с остатком. Оформите заявку со склада."
                        : "Попробуйте другое название или отсканируйте штрихкод."
                )
            } else {
                List {
                    ForEach(Array(filteredItems.enumerated()), id: \.element.id) { index, item in
                        SaleItemRow(
                            item: item,
                            inCart: store.cart.first { $0.itemID == item.id }?.quantity ?? 0,
                            onAdd: { store.add(item); Haptics.tap() },
                            onRemove: {
                                let current = store.cart.first { $0.itemID == item.id }?.quantity ?? 0
                                store.setQuantity(current - 1, for: item.id)
                                Haptics.tap()
                            }
                        )
                        .staggeredAppear(index: index)
                    }
                }
                .listStyle(.plain)
                // Оставляем место под панель корзины, иначе она перекрывает
                // последнюю позицию.
                .safeAreaPadding(.bottom, store.cart.isEmpty ? 0 : 100)
            }
        }
    }

    private var searchBar: some View {
        HStack(spacing: Spacing.md) {
            HStack(spacing: Spacing.sm) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(Theme.textDim)
                TextField("Название товара", text: $search)
                    .textFieldStyle(.plain)
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    #endif
                    .autocorrectionDisabled()
                if !search.isEmpty {
                    Button { search = "" } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.textDim)
                    }
                    .buttonStyle(.pressable)
                }
            }
            .padding(Spacing.md)
            .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))

            Button {
                showScanner = true
            } label: {
                Image(systemName: "barcode.viewfinder")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(Theme.accent(for: .operator))
                    .frame(width: 48, height: 48)
                    .background(Theme.accent(for: .operator).opacity(0.14), in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
            }
            .buttonStyle(.pressable)
        }
        .padding(Spacing.lg)
    }

    private var scannerSheet: some View {
        NavigationStack {
            VStack(spacing: Spacing.lg) {
                ScannerPane { code in handleScan(code) }
                    .padding(Spacing.lg)

                if !store.cart.isEmpty {
                    Card {
                        HStack {
                            Text("В чеке \(store.cartCount) позиц\(store.cartCount == 1 ? "ия" : "ий")")
                                .font(Typography.callout)
                                .foregroundStyle(Theme.textMuted)
                            Spacer()
                            Text(Money.format(store.cartTotal))
                                .font(Typography.callout.weight(.bold))
                                .monospacedDigit()
                                .foregroundStyle(Theme.text)
                        }
                    }
                    .padding(.horizontal, Spacing.lg)
                }

                Spacer()
            }
            .background(Theme.background)
            .navigationTitle("Сканирование")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Готово") { showScanner = false }
                }
            }
            .overlay(alignment: .top) {
                if let toast {
                    ToastBanner(text: toast, isError: toastIsError)
                        .padding(.horizontal, Spacing.lg)
                }
            }
        }
    }

    /// Полоса чека внизу. Нажатие на левую часть открывает чек — там
    /// позицию убирают и правят количество. Раньше убрать товар можно было
    /// только из окна оплаты, и это никто не находил.
    private var cartBar: some View {
        HStack(spacing: Spacing.md) {
            Button { showCart = true } label: {
                HStack(spacing: Spacing.md) {
                    ZStack(alignment: .topTrailing) {
                        Image(systemName: "cart.fill")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(Theme.brand)
                            .frame(width: 44, height: 44)
                            .background(Theme.brand.opacity(0.12), in: Circle())
                        Text("\(store.cartCount)")
                            .font(.system(size: 11, weight: .bold))
                            .monospacedDigit()
                            .foregroundStyle(.white)
                            .padding(.horizontal, 5)
                            .frame(minWidth: 18, minHeight: 18)
                            .background(Theme.brand, in: Capsule())
                            .offset(x: 4, y: -4)
                    }
                    VStack(alignment: .leading, spacing: 1) {
                        Text(Money.format(store.cartTotal))
                            .font(.system(size: 20, weight: .bold, design: .rounded))
                            .monospacedDigit()
                            .foregroundStyle(Theme.text)
                            .contentTransition(.numericText())
                        Text("Открыть чек")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(Theme.brand)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.pressable)
            .accessibilityLabel("Чек: \(store.cartCount) позиций, \(Money.format(store.cartTotal))")

            Spacer()

            Button("К оплате") { showCheckout = true }
                .buttonStyle(PrimaryButtonStyle())
                .frame(maxWidth: 150)
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.md)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Radius.xl, style: .continuous))
        .shadow(color: Theme.navy.opacity(0.18), radius: 16, y: 6)
        .padding(.horizontal, Spacing.md)
        .padding(.bottom, Spacing.sm)
        .animation(Motion.appear, value: store.cartCount)
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

    private func handleScan(_ code: String) {
        guard let item = store.item(barcode: code) else {
            show(toast: "Штрихкод \(code) не найден на витрине", isError: true)
            Haptics.error()
            return
        }
        guard item.isInStock else {
            show(toast: "«\(item.name)» — нет на витрине", isError: true)
            Haptics.error()
            return
        }

        store.add(item)
        show(toast: "\(item.name) · \(Money.format(item.salePrice))", isError: false)
        Haptics.success()
    }

    private func show(toast text: String, isError: Bool) {
        toast = text
        toastIsError = isError
        Task {
            try? await Task.sleep(for: .seconds(isError ? 2.5 : 1.4))
            if toast == text { toast = nil }
        }
    }
}

/// Строка товара витрины.
///
/// Пока товара нет в чеке — «+». Когда есть — «− количество +»: убрать
/// лишнее можно прямо в списке, не открывая оплату.
struct SaleItemRow: View {
    let item: SaleCatalogItem
    var inCart: Double = 0
    let onAdd: () -> Void
    var onRemove: () -> Void = {}

    var body: some View {
        HStack(spacing: Spacing.md) {
            Button(action: onAdd) {
                HStack(spacing: Spacing.md) {
                    Thumbnail(url: item.imageURL, side: 48, fallbackText: item.name)

                    VStack(alignment: .leading, spacing: 3) {
                        Text(item.name)
                            .font(.system(size: 16, weight: .medium))
                            .foregroundStyle(Theme.text)
                            .lineLimit(2)
                        HStack(spacing: 6) {
                            Text(Money.format(item.salePrice))
                                .font(.system(size: 15, weight: .semibold, design: .rounded))
                                .monospacedDigit()
                                .foregroundStyle(Theme.text)
                            Text("· \(Quantity.format(item.displayQuantity)) \(item.unit ?? "шт")")
                                .font(.system(size: 13))
                                .foregroundStyle(item.displayQuantity <= 3 ? Theme.warning : Theme.textDim)
                        }
                    }
                    Spacer(minLength: Spacing.sm)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if inCart > 0 {
                HStack(spacing: 0) {
                    stepButton("minus", action: onRemove)
                        .accessibilityLabel("Убрать одну")
                    Text(Quantity.format(inCart))
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(.white)
                        .frame(minWidth: 26)
                    stepButton("plus", action: onAdd)
                        .accessibilityLabel("Добавить ещё")
                }
                .background(Theme.brand, in: Capsule())
                .transition(.scale.combined(with: .opacity))
            } else {
                Button(action: onAdd) {
                    Image(systemName: "plus")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Theme.brand)
                        .frame(width: 36, height: 36)
                        .background(Theme.brand.opacity(0.12), in: Circle())
                }
                .buttonStyle(.pressable)
                .accessibilityLabel("Добавить в чек")
            }
        }
        .animation(Motion.tap, value: inCart)
        .padding(.vertical, Spacing.xs)
        .listRowBackground(Theme.background)
    }

    private func stepButton(_ icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 34, height: 36)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// Чек перед оплатой: позиции с количеством, убрать одну или все.
struct CartSheet: View {
    var onCheckout: () -> Void

    @Environment(OperatorStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var confirmingClear = false

    var body: some View {
        NavigationStack {
            Group {
                if store.cart.isEmpty {
                    EmptyStateView(icon: "cart", title: "Чек пуст", message: "Добавьте товары из витрины.")
                } else {
                    List {
                        Section {
                            ForEach(store.cart) { line in
                                HStack(spacing: Spacing.md) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(line.name)
                                            .font(.system(size: 16, weight: .medium))
                                            .foregroundStyle(Theme.text)
                                            .lineLimit(2)
                                        Text("\(Money.format(line.unitPrice)) за шт.")
                                            .font(.system(size: 13))
                                            .foregroundStyle(Theme.textDim)
                                    }
                                    Spacer(minLength: Spacing.sm)
                                    HStack(spacing: 0) {
                                        qtyButton("minus") { store.setQuantity(line.quantity - 1, for: line.itemID) }
                                        Text(Quantity.format(line.quantity))
                                            .font(.system(size: 15, weight: .bold, design: .rounded))
                                            .monospacedDigit()
                                            .frame(minWidth: 26)
                                        qtyButton("plus") { store.setQuantity(line.quantity + 1, for: line.itemID) }
                                    }
                                    .background(Theme.surfaceRaised, in: Capsule())
                                    Text(Money.format(line.total))
                                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                                        .monospacedDigit()
                                        .foregroundStyle(Theme.text)
                                        .frame(minWidth: 72, alignment: .trailing)
                                }
                                .padding(.vertical, 4)
                                .listRowBackground(Theme.surface)
                                .swipeActions(edge: .trailing) {
                                    Button(role: .destructive) {
                                        store.remove(itemID: line.itemID)
                                        Haptics.tap()
                                    } label: {
                                        Label("Убрать", systemImage: "trash")
                                    }
                                }
                            }
                        } footer: {
                            Text("Смахните позицию влево, чтобы убрать её из чека.")
                                .font(.system(size: 12))
                        }

                        Section {
                            Button(role: .destructive) { confirmingClear = true } label: {
                                Label("Очистить чек", systemImage: "trash")
                                    .foregroundStyle(Theme.negative)
                            }
                            .listRowBackground(Theme.surface)
                        }
                    }
                    #if os(iOS)
                    .listStyle(.insetGrouped)
                    #endif
                    .scrollContentBackground(.hidden)
                    .safeAreaInset(edge: .bottom) {
                        HStack {
                            VStack(alignment: .leading, spacing: 1) {
                                Text("Итого")
                                    .font(.system(size: 13))
                                    .foregroundStyle(Theme.textDim)
                                Text(Money.format(store.cartTotal))
                                    .font(.system(size: 22, weight: .bold, design: .rounded))
                                    .monospacedDigit()
                                    .foregroundStyle(Theme.text)
                            }
                            Spacer()
                            Button("К оплате", action: onCheckout)
                                .buttonStyle(PrimaryButtonStyle())
                                .frame(maxWidth: 170)
                        }
                        .padding(Spacing.lg)
                        .background(Theme.background)
                    }
                }
            }
            .background(Theme.background)
            .navigationTitle("Чек")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Закрыть") { dismiss() }
                }
            }
            .confirmationDialog("Очистить чек?", isPresented: $confirmingClear, titleVisibility: .visible) {
                Button("Убрать все позиции", role: .destructive) {
                    store.clearCart()
                    dismiss()
                }
                Button("Отмена", role: .cancel) {}
            }
        }
    }

    private func qtyButton(_ icon: String, action: @escaping () -> Void) -> some View {
        Button {
            action()
            Haptics.tap()
        } label: {
            Image(systemName: icon)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(Theme.text)
                .frame(width: 32, height: 32)
                .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
    }
}

/// Короткое уведомление поверх экрана.
