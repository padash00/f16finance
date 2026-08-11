import OrdaKit
import OrdaUI
import SwiftUI

/// Продажа: сканер, каталог витрины, корзина, оплата.
struct SaleScreen: View {
    @Environment(OperatorStore.self) private var store

    @State private var search = ""
    @State private var showScanner = false
    @State private var showCheckout = false
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
                        SaleItemRow(item: item) { store.add(item) }
                            .staggeredAppear(index: index)
                    }
                }
                .listStyle(.plain)
                // Оставляем место под панель корзины, иначе она перекрывает
                // последнюю позицию.
                .safeAreaPadding(.bottom, store.cart.isEmpty ? 0 : 88)
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

    private var cartBar: some View {
        HStack(spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: 2) {
                Text("\(store.cartCount) позиц\(store.cartCount == 1 ? "ия" : "ий")")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
                Text(Money.format(store.cartTotal))
                    .font(Typography.monospacedDigits(Typography.title))
                    .foregroundStyle(Theme.text)
                    .contentTransition(.numericText())
            }

            Spacer()

            Button("К оплате") { showCheckout = true }
                .buttonStyle(PrimaryButtonStyle(tint: Theme.accent(for: .operator)))
                .frame(maxWidth: 180)
        }
        .padding(Spacing.lg)
        .background(.ultraThinMaterial)
        .overlay(alignment: .top) {
            Rectangle().fill(Theme.border).frame(height: 1)
        }
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
struct SaleItemRow: View {
    let item: SaleCatalogItem
    let onAdd: () -> Void

    var body: some View {
        Button(action: onAdd) {
            HStack(spacing: Spacing.md) {
                Thumbnail(url: item.imageURL, side: 44, fallbackText: item.name)

                VStack(alignment: .leading, spacing: 2) {
                    Text(item.name)
                        .font(Typography.body)
                        .foregroundStyle(Theme.text)
                        .lineLimit(2)
                    Text("остаток \(Quantity.format(item.displayQuantity)) \(item.unit ?? "шт")")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                }

                Spacer()

                Text(Money.format(item.salePrice))
                    .font(Typography.callout.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(Theme.text)

                Image(systemName: "plus.circle.fill")
                    .font(.system(size: 22))
                    .foregroundStyle(Theme.accent(for: .operator))
            }
            .padding(.vertical, Spacing.xs)
            .contentShape(Rectangle())
        }
        .buttonStyle(.pressable)
        .listRowBackground(Theme.background)
    }
}

/// Короткое уведомление поверх экрана.
struct ToastBanner: View {
    let text: String
    let isError: Bool

    var body: some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: isError ? "exclamationmark.circle.fill" : "checkmark.circle.fill")
            Text(text)
                .font(Typography.callout.weight(.medium))
                .lineLimit(2)
        }
        .foregroundStyle(Color.black.opacity(0.85))
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(isError ? Theme.warning : Theme.positive, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
        .shadow(color: .black.opacity(0.25), radius: 12, y: 6)
    }
}
