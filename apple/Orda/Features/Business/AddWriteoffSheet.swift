import OrdaKit
import OrdaUI
import SwiftUI

/// Акт списания.
///
/// Списывают у полки: разбилось, испортилось, просрочено. Пока это делалось
/// только на сайте, между «разбилось» и записью проходил день — а остаток всё
/// это время врал, и ревизия потом искала недостачу, которой никто не помнит.
///
/// Поэтому форма построена вокруг поиска: человек стоит с телефоном и осколком
/// в руках, ему нужно найти позицию и вписать количество, а не заполнять
/// шапку документа.
struct AddWriteoffSheet: View {
    @Environment(BusinessStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var draft = WriteoffDraft(writtenAt: "")
    @State private var writtenAt = Date()
    @State private var search = ""
    @State private var errorMessage: String?
    @State private var isSaving = false
    @State private var didPrepare = false

    var body: some View {
        NavigationStack {
            ScreenScroll {
                VStack(spacing: Spacing.lg) {
                    headerCard
                    linesCard
                    pickerCard
                    footer
                }
            }
            .background(Theme.background)
            .navigationTitle("Списание")
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
                if draft.locationID.isEmpty, let first = locations.first {
                    draft.locationID = first.id
                }
            }
        }
    }

    // ── Шапка ────────────────────────────────────────────────────────────────

    private var headerCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                FieldLabel("Откуда списываем")
                Picker("Место", selection: $draft.locationID) {
                    Text("Не выбрано").tag("")
                    ForEach(locations) { location in
                        Text("\(location.name) · \(location.kindLabel)").tag(location.id)
                    }
                }
                .pickerStyle(.menu)

                DatePicker("Дата", selection: $writtenAt, in: ...Date(), displayedComponents: .date)
                    .font(Typography.callout)

                FieldLabel("Причина")
                TextField("Разбилось, просрочено, брак", text: $draft.reason)
                    .textFieldStyle(.plain)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .padding(Spacing.md)
                    .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))

                FieldLabel("Комментарий")
                TextField("Необязательно", text: $draft.comment, axis: .vertical)
                    .lineLimit(1...3)
                    .textFieldStyle(.plain)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .padding(Spacing.md)
                    .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
            }
        }
    }

    // ── Что списываем ────────────────────────────────────────────────────────

    @ViewBuilder
    private var linesCard: some View {
        if !draft.lines.isEmpty {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("В акте", subtitle: "\(draft.lines.count) \(pluralize(draft.lines.count, "позиция", "позиции", "позиций"))")

                    ForEach($draft.lines) { $line in
                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            HStack {
                                Text(line.name)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.text)
                                    .lineLimit(2)
                                Spacer()
                                Button(role: .destructive) {
                                    draft.lines.removeAll { $0.itemID == line.itemID }
                                } label: {
                                    Image(systemName: "trash")
                                }
                                .buttonStyle(.pressable)
                                .foregroundStyle(Theme.negative)
                            }
                            NumberField(title: "Количество", value: $line.quantity)
                            if let available = balance(of: line.itemID) {
                                Text("на месте: \(Quantity.format(available))")
                                    .font(Typography.caption)
                                    .foregroundStyle(line.quantity > available ? Theme.warning : Theme.textDim)
                            }
                        }
                        RowDivider()
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

                if draft.locationID.isEmpty {
                    Text("Сначала выберите, откуда списываем.")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                } else if candidates.isEmpty {
                    Text(search.isEmpty ? "Здесь пока нет остатков." : "Ничего не нашлось.")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                } else {
                    // Показываем не весь склад, а первые двадцать совпадений:
                    // список в тысячу строк на телефоне бесполезен.
                    ForEach(candidates.prefix(20)) { balance in
                        Button {
                            add(balance)
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(balance.name)
                                        .font(Typography.callout)
                                        .foregroundStyle(Theme.text)
                                        .lineLimit(1)
                                    Text("\(Quantity.format(balance.quantity)) \(balance.unit)")
                                        .font(Typography.caption)
                                        .foregroundStyle(Theme.textDim)
                                }
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

        Button(isSaving ? "Списываем…" : "Списать") {
            Task { await save() }
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(isSaving || !prepared.isValid)
    }

    // ── Данные ───────────────────────────────────────────────────────────────

    /// Списывают с мест хранения и витрины. Каталог сюда не входит: это
    /// справочник, а не полка.
    private var locations: [StoreLocation] {
        (store.store?.locations ?? []).filter { $0.kind != "catalog" }
    }

    private var candidates: [StockBalance] {
        let all = (store.store?.balances ?? [])
            .filter { $0.locationID == draft.locationID }
            .filter { balance in !draft.lines.contains { $0.itemID == balance.itemID } }
        let query = search.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else { return all }
        return all.filter {
            $0.name.localizedCaseInsensitiveContains(query)
                || ($0.barcode?.contains(query) ?? false)
        }
    }

    private func balance(of itemID: String) -> Double? {
        (store.store?.balances ?? [])
            .first { $0.locationID == draft.locationID && $0.itemID == itemID }?
            .quantity
    }

    private var prepared: WriteoffDraft {
        var value = draft
        value.writtenAt = Self.isoDay.string(from: writtenAt)
        return value
    }

    private func add(_ balance: StockBalance) {
        draft.lines.append(WriteoffLine(itemID: balance.itemID, name: balance.name))
        search = ""
        Haptics.tap()
    }

    private func save() async {
        guard !isSaving else { return }
        isSaving = true
        defer { isSaving = false }
        errorMessage = nil

        let companyID = locations.first { $0.id == draft.locationID }.flatMap { _ in
            store.companies.count == 1 ? store.companies[0].id : nil
        }

        if await store.createWriteoff(prepared, companyID: companyID) {
            Haptics.success()
            dismiss()
        } else {
            errorMessage = store.writeoffSaveError
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
