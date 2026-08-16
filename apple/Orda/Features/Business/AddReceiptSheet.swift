import OrdaKit
import OrdaUI
import SwiftUI

/// Приёмка товара от поставщика.
///
/// Товар принимают у машины: коробки на полу, водитель ждёт, накладная в руках.
/// Пока приёмку заводили только на сайте, между поставкой и записью проходил
/// день — склад показывал вчерашние остатки, а продавать начинали сегодня.
///
/// Разбор фото накладной через ИИ, шаблоны и массовая наценка остались на
/// сайте: здесь ручной ввод, потому что у машины считают позиции, а не
/// настраивают правила.
struct AddReceiptSheet: View {
    @Environment(BusinessStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var draft = ReceiptDraft(receivedAt: "")
    @State private var receivedAt = Date()
    @State private var dueDate = Date().addingTimeInterval(14 * 86_400)
    @State private var search = ""
    @State private var errorMessage: String?
    @State private var isSaving = false
    @State private var didPrepare = false

    // ── Накладная с фотографии ───────────────────────────────────────────────
    @State private var showingScanner = false
    @State private var isScanning = false
    @State private var scanError: String?
    /// Позиции, которых нет в каталоге. Их не выбросить молча: человек должен
    /// увидеть, что три строки из накладной не легли на склад.
    @State private var unmatched: [ScannedInvoice.Item] = []
    @Environment(\.api) private var api

    var body: some View {
        NavigationStack {
            ScreenScroll {
                VStack(spacing: Spacing.lg) {
                    scanCard
                    headerCard
                    paymentCard
                    linesCard
                    pickerCard
                    footer
                }
            }
            .background(Theme.background)
            .navigationTitle("Приёмка")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
            }
            .task {
                guard !didPrepare else { return }
                didPrepare = true
                if store.store == nil { await store.loadStore() }
                if store.suppliers == nil { await store.loadSuppliers() }
                if draft.locationID.isEmpty, let first = locations.first {
                    draft.locationID = first.id
                }
            }
        }
    }

    /// Съёмка накладной.
    ///
    /// Товар принимают у машины: коробки на полу, водитель ждёт. Набивать
    /// двадцать позиций пальцем в такой обстановке никто не станет — приёмку
    /// откладывают, и склад весь день показывает вчерашние остатки.
    @ViewBuilder
    private var scanCard: some View {
        #if os(iOS)
        Card(accent: draft.lines.isEmpty ? Theme.brand : nil) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader(
                    "Накладная с фотографии",
                    subtitle: "Сфотографируйте — позиции заполнятся сами"
                )

                Button {
                    showingScanner = true
                } label: {
                    if isScanning {
                        HStack(spacing: Spacing.sm) {
                            ProgressView().controlSize(.small)
                            Text("Разбираем накладную…")
                        }
                    } else {
                        Label("Сфотографировать", systemImage: "doc.viewfinder")
                    }
                }
                .buttonStyle(SecondaryButtonStyle())
                .disabled(isScanning)

                if let scanError {
                    Text(scanError)
                        .font(Typography.caption)
                        .foregroundStyle(Theme.negative)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if !unmatched.isEmpty {
                    RowDivider()
                    Text("Не нашлись в каталоге")
                        .font(Typography.label)
                        .foregroundStyle(Theme.warning)
                    ForEach(unmatched) { item in
                        HStack(alignment: .top, spacing: Spacing.sm) {
                            Image(systemName: "questionmark.circle")
                                .foregroundStyle(Theme.warning)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.invoiceName)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.text)
                                Text("\(Money.format(item.unitCost)) × \(Quantity.format(item.quantity))")
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.textMuted)
                            }
                        }
                    }
                    Text("Заведите товар в каталоге и снимите накладную ещё раз — или добавьте позицию руками ниже.")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .fullScreenCover(isPresented: $showingScanner) {
            CameraCapture { data in
                Task { await scan(data) }
            }
            .ignoresSafeArea()
        }
        #endif
    }

    #if os(iOS)
    /// Разобрать снимок и разложить по строкам приёмки.
    private func scan(_ data: Data) async {
        isScanning = true
        scanError = nil
        defer { isScanning = false }

        do {
            let parsed = try await InvoiceScanService(api: api).scan(
                imageData: data,
                supplierID: draft.supplierID.isEmpty ? nil : draft.supplierID
            )

            if let number = parsed.invoiceNumber, !number.isEmpty, draft.invoiceNumber.isEmpty {
                draft.invoiceNumber = number
            }

            // Сопоставленные позиции кладём в накладную, остальные показываем
            // отдельно. Молча выбросить их нельзя: человек решит, что принял
            // всё, а трёх строк на складе не окажется.
            var added = 0
            for item in parsed.items where item.isMatched {
                guard let id = item.matchedItemID else { continue }
                if let index = draft.lines.firstIndex(where: { $0.itemID == id }) {
                    draft.lines[index].quantity += item.quantity
                    if item.unitCost > 0 { draft.lines[index].unitCost = item.unitCost }
                } else {
                    draft.lines.append(
                        ReceiptLine(
                            itemID: id,
                            name: item.matchedItemName ?? item.invoiceName,
                            unit: unitFor(id),
                            quantity: item.quantity,
                            unitCost: item.unitCost
                        )
                    )
                }
                added += 1
            }

            unmatched = parsed.items.filter { !$0.isMatched }
            if added == 0 && unmatched.isEmpty {
                scanError = "В снимке не нашлось позиций. Снимите накладную целиком, при свете и без бликов."
            }
            Haptics.success()
        } catch let error as APIError {
            Haptics.error()
            scanError = error.userMessage
        } catch {
            Haptics.error()
            scanError = error.localizedDescription
        }
    }

    /// Единица измерения из каталога: в ответе разбора её нет.
    private func unitFor(_ itemID: String) -> String {
        store.store?.balances.first { $0.itemID == itemID }?.unit ?? "шт"
    }
    #endif

    private var headerCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                FieldLabel("Куда принимаем")
                Picker("Место", selection: $draft.locationID) {
                    Text("Не выбрано").tag("")
                    ForEach(locations) { location in
                        Text("\(location.name) · \(location.kindLabel)").tag(location.id)
                    }
                }
                .pickerStyle(.menu)

                FieldLabel("Поставщик")
                Picker("Поставщик", selection: $draft.supplierID) {
                    Text("Не выбран").tag("")
                    ForEach(suppliers, id: \.id) { supplier in
                        Text(supplier.name).tag(supplier.id)
                    }
                }
                .pickerStyle(.menu)

                DatePicker("Дата поставки", selection: $receivedAt, in: ...Date(), displayedComponents: .date)
                    .font(Typography.callout)

                FieldLabel("Номер накладной")
                TextField("Необязательно", text: $draft.invoiceNumber)
                    .textFieldStyle(.plain)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .padding(Spacing.md)
                    .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
            }
        }
    }

    private var paymentCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Оплата")

                Picker("Оплата", selection: $draft.payment) {
                    ForEach(ReceiptPayment.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)

                if draft.payment == .now {
                    Picker("Чем", selection: $draft.paymentMethod) {
                        Text("Наличными").tag("cash")
                        Text("Kaspi").tag("kaspi")
                    }
                    .pickerStyle(.segmented)
                } else {
                    Toggle(isOn: $draft.isConsignment) {
                        Text("Реализация")
                            .font(Typography.callout)
                            .foregroundStyle(Theme.text)
                    }
                    Text("Платим по мере продажи — у такой поставки срока нет.")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)

                    if !draft.isConsignment {
                        DatePicker("Оплатить до", selection: $dueDate, displayedComponents: .date)
                            .font(Typography.callout)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var linesCard: some View {
        if !draft.lines.isEmpty {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("В накладной", subtitle: "\(draft.lines.count) \(pluralize(draft.lines.count, "позиция", "позиции", "позиций"))")

                    ForEach($draft.lines) { $line in
                        ReceiptLineEditor(line: $line) {
                            draft.lines.removeAll { $0.itemID == line.itemID }
                        }
                        RowDivider()
                    }

                    StatRow("Сумма накладной", value: Money.format(prepared.total), emphasized: true)
                    if prepared.bonusCount > 0 {
                        // Бонус не входит в сумму: это подарок поставщика, и
                        // включать его значит завысить себестоимость.
                        StatRow("Бонусных позиций", value: "\(prepared.bonusCount)", icon: "gift")
                    }
                }
            }
        }
    }

    private var pickerCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Добавить позицию")

                TextField("Название или штрихкод", text: $search)
                    .textFieldStyle(.plain)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .padding(Spacing.md)
                    .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
                    #if os(iOS)
                    .autocorrectionDisabled()
                    #endif

                if candidates.isEmpty {
                    Text(search.isEmpty ? "Начните вводить название." : "Ничего не нашлось.")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                } else {
                    ForEach(candidates.prefix(20), id: \.id) { item in
                        Button {
                            add(item)
                        } label: {
                            HStack {
                                Text(item.name)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.text)
                                    .lineLimit(1)
                                Spacer()
                                Image(systemName: "plus.circle")
                                    .foregroundStyle(Theme.brand)
                            }
                        }
                        .buttonStyle(.pressable)
                        RowDivider()
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var footer: some View {
        if let blocker = prepared.validationMessage {
            Text(blocker)
                .font(Typography.callout)
                .foregroundStyle(Theme.warning)
                .frame(maxWidth: .infinity, alignment: .leading)
        }

        if let errorMessage {
            Text(errorMessage)
                .font(Typography.callout)
                .foregroundStyle(Theme.negative)
                .frame(maxWidth: .infinity, alignment: .leading)
        }

        Button(isSaving ? "Принимаем…" : "Принять") {
            Task { await save() }
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(isSaving || !prepared.isValid)
    }

    // ── Данные ───────────────────────────────────────────────────────────────

    private var locations: [StoreLocation] {
        (store.store?.locations ?? []).filter { $0.kind != "catalog" }
    }

    private var suppliers: [(id: String, name: String)] {
        (store.suppliers?.suppliers ?? []).map { (id: $0.id, name: $0.name) }
    }

    /// Принимать можно и то, чего сейчас нет в остатках, — поэтому берём весь
    /// перечень позиций, а не остатки места.
    private var candidates: [(id: String, name: String, unit: String)] {
        let known = Set(draft.lines.map(\.itemID))
        var seen = Set<String>()
        var result: [(id: String, name: String, unit: String)] = []
        for balance in store.store?.balances ?? [] {
            guard !known.contains(balance.itemID), !seen.contains(balance.itemID) else { continue }
            seen.insert(balance.itemID)
            result.append((id: balance.itemID, name: balance.name, unit: balance.unit))
        }
        let query = search.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else { return [] }
        return result.filter { $0.name.localizedCaseInsensitiveContains(query) }
    }

    private var prepared: ReceiptDraft {
        var value = draft
        value.receivedAt = Self.isoDay.string(from: receivedAt)
        value.dueDate = draft.payment == .deferred && !draft.isConsignment
            ? Self.isoDay.string(from: dueDate)
            : nil
        return value
    }

    private func add(_ item: (id: String, name: String, unit: String)) {
        draft.lines.append(ReceiptLine(itemID: item.id, name: item.name, unit: item.unit))
        search = ""
        Haptics.tap()
    }

    private func save() async {
        guard !isSaving else { return }
        isSaving = true
        defer { isSaving = false }
        errorMessage = nil

        let companyID = store.companies.count == 1 ? store.companies[0].id : nil
        if await store.createReceipt(prepared, companyID: companyID) {
            Haptics.success()
            dismiss()
        } else {
            errorMessage = store.receiptSaveError
        }
    }

    private static let isoDay: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()
}

/// Строка накладной: количество, цена, наценка.
private struct ReceiptLineEditor: View {
    @Binding var line: ReceiptLine
    let onDelete: () -> Void

    @State private var salePrice = ""

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack {
                Text(line.name)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .lineLimit(2)
                Spacer()
                Button(role: .destructive, action: onDelete) {
                    Image(systemName: "trash")
                }
                .buttonStyle(.pressable)
                .foregroundStyle(Theme.negative)
            }

            NumberField(title: "Количество, \(line.unit)", value: $line.quantity)

            Toggle(isOn: $line.isBonus) {
                Text("Бонус от поставщика")
                    .font(Typography.callout)
                    .foregroundStyle(Theme.textMuted)
            }

            // У бонуса цены нет по определению — поле только мешало бы.
            if !line.isBonus {
                NumberField(title: "Цена закупки", value: $line.unitCost)

                MoneyField(title: "Новая цена продажи", text: $salePrice)
                    .onChange(of: salePrice) { _, value in
                        let amount = AmountParsing.value(value)
                        line.salePrice = value.trimmingCharacters(in: .whitespaces).isEmpty || amount <= 0
                            ? nil
                            : amount
                    }

                HStack {
                    Text(line.salePrice == nil ? "Цена продажи не изменится" : "Наценка")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                    Spacer()
                    if let markup = line.markup {
                        Text(Percent.format(markup))
                            .font(Typography.caption.weight(.semibold))
                            .monospacedDigit()
                            .foregroundStyle(markup > 0 ? Theme.positive : Theme.negative)
                    }
                }

                if line.total > 0 {
                    StatRow("Строка", value: Money.format(line.total))
                }
            }
        }
    }
}
