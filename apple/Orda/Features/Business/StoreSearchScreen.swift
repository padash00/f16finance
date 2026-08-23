import OrdaKit
import OrdaUI
import SwiftUI

/// Поиск по складу и заведение товара камерой.
///
/// Оба действия делают стоя у полки, а не за столом: «где эта банка» и «этого
/// товара ещё нет в каталоге». На сайте они есть, в приложении не было —
/// телефон умел искать только внутри уже открытого списка, а новый товар
/// приходилось заводить с ноутбука, перепечатывая штрихкод руками.
///
/// Камера здесь и ищет, и заводит: сначала спрашиваем сервер, знает ли он этот
/// штрихкод. Знает — показываем товар. Не знает — предлагаем завести, и
/// штрихкод уже подставлен.
struct StoreSearchScreen: View {
    @Environment(\.api) private var api
    @Environment(\.access) private var access
    @Environment(BusinessStore.self) private var store

    @State private var query = ""
    @State private var hits: [StoreSearchHit] = []
    @State private var isSearching = false
    @State private var error: APIError?

    @State private var isScannerOpen = false
    @State private var scannedBarcode: String?
    @State private var foundItem: BarcodeLookup.Item?
    @State private var isLookingUp = false
    @State private var newItemOpen = false

    private var canCreateItem: Bool { access?.can("store-warehouse.create_item") ?? false }

    var body: some View {
        ScreenScroll {
            searchField

            if let error {
                ErrorStateView(error: error) { Task { await search() } }
            } else if isSearching {
                LoadingRows(count: 3)
            } else if !query.isEmpty && hits.isEmpty {
                WideEmptyState(
                    icon: "magnifyingglass",
                    title: "Ничего не нашлось",
                    message: "Поиск смотрит товары, приёмки, списания и заявки. Попробуйте часть названия или номер накладной."
                )
            } else if !hits.isEmpty {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        SectionHeader("Нашлось", subtitle: "\(hits.count)")
                        ForEach(hits) { hit in
                            hitRow(hit)
                            if hit.id != hits.last?.id { Divider().overlay(Theme.border) }
                        }
                    }
                }
            } else {
                WideEmptyState(
                    icon: "barcode.viewfinder",
                    title: "Найти или завести товар",
                    message: "Введите название, номер накладной или наведите камеру на штрихкод."
                )
            }
        }
        .background(Theme.background)
        .navigationTitle("Поиск по складу")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .sheet(isPresented: $isScannerOpen) { scannerSheet }
        .sheet(isPresented: $newItemOpen) {
            if let scannedBarcode {
                NewStoreItemSheet(barcode: scannedBarcode) { await search() }
            }
        }
    }

    // ── Поиск ────────────────────────────────────────────────────────────────

    private var searchField: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                HStack(spacing: Spacing.sm) {
                    Image(systemName: "magnifyingglass").foregroundStyle(Theme.textDim)
                    TextField("Название, накладная, поставщик", text: $query)
                        .textFieldStyle(.plain)
                        .submitLabel(.search)
                        .onSubmit { Task { await search() } }
                    if !query.isEmpty {
                        Button {
                            query = ""
                            hits = []
                        } label: {
                            Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.textDim)
                        }
                        .buttonStyle(.plain)
                    }
                }

                #if os(iOS)
                if BarcodeScanner.isSupported {
                    Button {
                        scannedBarcode = nil
                        foundItem = nil
                        isScannerOpen = true
                    } label: {
                        Label("Сканировать штрихкод", systemImage: "barcode.viewfinder")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }
                #endif
            }
        }
    }

    private func hitRow(_ hit: StoreSearchHit) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline) {
                Text(hit.title)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                Spacer()
                Text(hit.kindLabel)
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
            }
            if let subtitle = hit.subtitle, !subtitle.isEmpty {
                Text(subtitle)
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
            }
        }
        .padding(.vertical, Spacing.xs)
    }

    private func search() async {
        let text = query.trimmingCharacters(in: .whitespaces)
        guard text.count >= 2 else {
            hits = []
            return
        }
        isSearching = true
        defer { isSearching = false }
        do {
            hits = try await BusinessService(api: api).searchStore(query: text, companyID: nil)
            error = nil
        } catch let apiError as APIError {
            error = apiError
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }

    // ── Штрихкод ─────────────────────────────────────────────────────────────

    @ViewBuilder
    private var scannerSheet: some View {
        #if os(iOS)
        NavigationStack {
            VStack(spacing: 0) {
                BarcodeScanner { code in
                    guard scannedBarcode == nil else { return }
                    scannedBarcode = code
                    Task { await lookup(code) }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)

                scannerResult
                    .padding(Spacing.md)
                    .frame(maxWidth: .infinity)
                    .background(Theme.surface)
            }
            .navigationTitle("Штрихкод")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Закрыть") { isScannerOpen = false }
                }
            }
        }
        #endif
    }

    @ViewBuilder
    private var scannerResult: some View {
        if isLookingUp {
            ProgressView().tint(Theme.brand)
        } else if let item = foundItem {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(item.name).font(Typography.callout).foregroundStyle(Theme.text)
                Text("Такой товар уже есть в каталоге")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
                Button("Открыть в поиске") {
                    query = item.name
                    isScannerOpen = false
                    Task { await search() }
                }
                .buttonStyle(SecondaryButtonStyle())
            }
        } else if let code = scannedBarcode {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(code).font(Typography.callout).foregroundStyle(Theme.text)
                Text("Такого товара в каталоге нет")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
                if canCreateItem {
                    Button("Завести товар") {
                        isScannerOpen = false
                        newItemOpen = true
                    }
                    .buttonStyle(PrimaryButtonStyle())
                } else {
                    // Право не выдано — говорим прямо, а не показываем кнопку,
                    // которая ответит отказом.
                    Text("Заводить товары может тот, кому выдано это право.")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                }
            }
        } else {
            Text("Наведите камеру на штрихкод")
                .font(Typography.caption)
                .foregroundStyle(Theme.textDim)
        }
    }

    private func lookup(_ code: String) async {
        isLookingUp = true
        defer { isLookingUp = false }
        foundItem = try? await BusinessService(api: api).lookupBarcode(code)
    }
}

/// Заведение товара: имя, цена, точка.
///
/// Штрихкод уже отсканирован — перепечатывать его руками не нужно, а именно на
/// этом обычно и ошибаются.
private struct NewStoreItemSheet: View {
    let barcode: String
    let onCreated: () async -> Void

    @Environment(\.api) private var api
    @Environment(\.dismiss) private var dismiss
    @Environment(BusinessStore.self) private var store

    @State private var name = ""
    @State private var unit = "шт"
    @State private var salePrice = ""
    @State private var purchasePrice = ""
    @State private var companyID = ""
    @State private var isSaving = false
    @State private var error: String?

    private var stores: [Company] { store.companies }

    var body: some View {
        NavigationStack {
            ScreenScroll {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        FieldLabel("Штрихкод")
                        Text(barcode)
                            .font(Typography.callout.weight(.semibold))
                            .foregroundStyle(Theme.text)

                        FieldLabel("Название")
                        TextField("Например: Кола 0,5", text: $name)
                            .textFieldStyle(.plain)
                            .font(Typography.callout)

                        FieldLabel("Точка")
                        Picker("Точка", selection: $companyID) {
                            Text("Не выбрана").tag("")
                            ForEach(stores) { company in Text(company.name).tag(company.id) }
                        }
                        .pickerStyle(.menu)

                        HStack(spacing: Spacing.md) {
                            VStack(alignment: .leading) {
                                FieldLabel("Единица")
                                TextField("шт", text: $unit).textFieldStyle(.plain)
                            }
                            VStack(alignment: .leading) {
                                FieldLabel("Цена продажи")
                                TextField("0", text: $salePrice)
                                    .textFieldStyle(.plain)
                                    #if os(iOS)
                                    .keyboardType(.decimalPad)
                                    #endif
                            }
                            VStack(alignment: .leading) {
                                FieldLabel("Закуп")
                                TextField("0", text: $purchasePrice)
                                    .textFieldStyle(.plain)
                                    #if os(iOS)
                                    .keyboardType(.decimalPad)
                                    #endif
                            }
                        }

                        if let error {
                            Text(error).font(Typography.caption).foregroundStyle(Theme.warning)
                        }

                        Button(isSaving ? "Сохраняем…" : "Завести товар") {
                            Task { await save() }
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(isSaving || name.trimmingCharacters(in: .whitespaces).isEmpty || companyID.isEmpty)
                    }
                }
            }
            .background(Theme.background)
            .navigationTitle("Новый товар")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } }
            }
            .task {
                if store.companies.isEmpty { await store.loadCompanies() }
                if companyID.isEmpty, stores.count == 1 { companyID = stores[0].id }
            }
        }
    }

    private func save() async {
        isSaving = true
        defer { isSaving = false }
        do {
            try await BusinessService(api: api).createStoreItem(
                NewStoreItem(
                    companyID: companyID,
                    name: name.trimmingCharacters(in: .whitespaces),
                    barcode: barcode,
                    unit: unit.trimmingCharacters(in: .whitespaces).isEmpty ? "шт" : unit,
                    salePrice: AmountParsing.value(salePrice),
                    purchasePrice: AmountParsing.value(purchasePrice)
                )
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
