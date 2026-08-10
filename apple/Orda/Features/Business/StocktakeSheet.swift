import OrdaKit
import OrdaUI
import SwiftUI

/// Пересчёт остатков.
///
/// Единственный документ, который по определению делают с телефоном в руках:
/// человек стоит у стеллажа и считает банки. Пока ревизию можно было завести
/// только на сайте, счёт вели на бумаге, а вечером переносили — и переносили с
/// ошибками, потому что почерк, потому что устал, потому что «кажется, было
/// восемь».
///
/// Поэтому здесь нет шага «добавить позицию»: список подставляется из остатков
/// сразу, и работа сводится к вводу чисел сверху вниз. Ожидаемое количество
/// намеренно спрятано за нажатием — увидев «8», человек пишет 8, не считая.
struct StocktakeSheet: View {
    @Environment(BusinessStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var draft = StocktakeDraft(countedAt: "")
    @State private var countedAt = Date()
    @State private var search = ""
    @State private var showsExpected = false
    @State private var onlyRemaining = false
    @State private var errorMessage: String?
    @State private var isSaving = false
    @State private var didPrepare = false

    var body: some View {
        NavigationStack {
            ScreenScroll {
                VStack(spacing: Spacing.lg) {
                    headerCard
                    progressCard
                    linesCard
                    footer
                }
            }
            .background(Theme.background)
            .navigationTitle("Ревизия")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .searchable(text: $search, prompt: "Название или штрихкод")
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
                reload()
            }
        }
    }

    private var headerCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                FieldLabel("Что пересчитываем")
                Picker("Место", selection: $draft.locationID) {
                    ForEach(locations) { location in
                        Text("\(location.name) · \(location.kindLabel)").tag(location.id)
                    }
                }
                .pickerStyle(.menu)
                .onChange(of: draft.locationID) { _, _ in reload() }

                DatePicker("Дата", selection: $countedAt, in: ...Date(), displayedComponents: .date)
                    .font(Typography.callout)

                Toggle(isOn: $showsExpected) {
                    Text("Показывать, сколько числится")
                        .font(Typography.callout)
                        .foregroundStyle(Theme.text)
                }
                Text("По умолчанию скрыто: увидев цифру, человек пишет её же, не считая. Ревизия при этом ничего не проверяет.")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
            }
        }
    }

    private var progressCard: some View {
        Card(accent: draft.remaining == 0 ? Theme.positive : Theme.brand) {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                StatRow("Пересчитано", value: "\(draft.countedLines.count) из \(draft.lines.count)", icon: "checkmark.circle")
                if draft.remaining > 0 {
                    StatRow("Осталось", value: "\(draft.remaining)", icon: "hourglass")
                }
                if !draft.mismatchedLines.isEmpty {
                    RowDivider()
                    StatRow(
                        "Расхождений",
                        value: "\(draft.mismatchedLines.count)",
                        valueColor: Theme.warning,
                        icon: "exclamationmark.triangle"
                    )
                }

                Toggle(isOn: $onlyRemaining) {
                    Text("Только непосчитанные")
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textMuted)
                }
            }
        }
    }

    @ViewBuilder
    private var linesCard: some View {
        let visible = filtered

        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                if visible.isEmpty {
                    InlineEmpty(
                        icon: "checklist",
                        text: draft.lines.isEmpty ? "Здесь нет остатков" : "Ничего не нашлось",
                        tint: Theme.textDim
                    )
                } else {
                    ForEach(visible, id: \.itemID) { line in
                        StocktakeLineRow(
                            line: line,
                            showsExpected: showsExpected,
                            onChange: { value in update(line.itemID, actual: value) }
                        )
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

        if draft.remaining > 0 && prepared.isValid {
            // Не запрещаем: ревизию часто делят на два захода, по стеллажам.
            // Но сказать, что часть позиций останется как есть, обязаны.
            Text("Непересчитанные \(draft.remaining) позиций останутся с прежним остатком.")
                .font(Typography.caption)
                .foregroundStyle(Theme.textDim)
                .frame(maxWidth: .infinity, alignment: .leading)
        }

        Button(isSaving ? "Проводим…" : "Провести ревизию") {
            Task { await save() }
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(isSaving || !prepared.isValid)
    }

    // ── Данные ───────────────────────────────────────────────────────────────

    private var locations: [StoreLocation] {
        (store.store?.locations ?? []).filter { $0.kind != "catalog" }
    }

    private var filtered: [StocktakeLine] {
        var result = draft.lines
        if onlyRemaining { result = result.filter { !$0.isCounted } }
        let query = search.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else { return result }
        return result.filter { $0.name.localizedCaseInsensitiveContains(query) }
    }

    private var prepared: StocktakeDraft {
        var value = draft
        value.countedAt = Self.isoDay.string(from: countedAt)
        return value
    }

    /// Подставить остатки выбранного места.
    private func reload() {
        let balances = (store.store?.balances ?? []).filter { $0.locationID == draft.locationID }
        draft.lines = balances
            .map { StocktakeLine(itemID: $0.itemID, name: $0.name, unit: $0.unit, expected: $0.quantity) }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private func update(_ itemID: String, actual: Double?) {
        guard let index = draft.lines.firstIndex(where: { $0.itemID == itemID }) else { return }
        draft.lines[index].actual = actual
    }

    private func save() async {
        guard !isSaving else { return }
        isSaving = true
        defer { isSaving = false }
        errorMessage = nil

        let companyID = store.companies.count == 1 ? store.companies[0].id : nil
        if await store.createStocktake(prepared, companyID: companyID) {
            Haptics.success()
            dismiss()
        } else {
            errorMessage = store.stocktakeSaveError
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

/// Строка пересчёта.
private struct StocktakeLineRow: View {
    let line: StocktakeLine
    let showsExpected: Bool
    let onChange: (Double?) -> Void

    @State private var text = ""
    @State private var didLoad = false

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(alignment: .firstTextBaseline) {
                Text(line.name)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .lineLimit(2)

                Spacer(minLength: Spacing.sm)

                TextField("—", text: $text)
                    .multilineTextAlignment(.trailing)
                    .textFieldStyle(.plain)
                    .font(Typography.callout.monospacedDigit())
                    .foregroundStyle(Theme.text)
                    .frame(maxWidth: 90)
                    .padding(Spacing.sm)
                    .background(
                        Theme.surfaceRaised,
                        in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous)
                    )
                    #if os(iOS)
                    .keyboardType(.decimalPad)
                    #endif
                    .onChange(of: text) { _, value in
                        // Пустое поле — «ещё не считали», а не ноль.
                        onChange(value.trimmingCharacters(in: .whitespaces).isEmpty
                            ? nil
                            : AmountParsing.value(value))
                    }

                Text(line.unit)
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
                    .frame(width: 32, alignment: .leading)
            }

            if showsExpected {
                Text("числится \(Quantity.format(line.expected))")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
            }

            if let difference = line.difference, line.hasMismatch {
                Text(difference > 0
                    ? "излишек \(Quantity.format(difference))"
                    : "недостача \(Quantity.format(abs(difference)))")
                    .font(Typography.caption.weight(.medium))
                    .foregroundStyle(difference > 0 ? Theme.info : Theme.negative)
            }
        }
        .onAppear {
            guard !didLoad else { return }
            didLoad = true
            text = line.actual.map { Quantity.format($0) } ?? ""
        }
    }
}
