import OrdaKit
import OrdaUI
import SwiftUI

/// Ревизия: список назначенных актов.
///
/// Оператор не начинает ревизию сам — акт открывает управляющий и назначает
/// кассиров на секции. Поэтому пустой список здесь нормальное состояние, а не
/// ошибка, и объяснить это нужно прямо.
struct AuditScreen: View {
    @Environment(\.api) private var api

    @State private var acts: [AuditAct] = []
    @State private var isLoading = true
    @State private var error: String?

    var body: some View {
        Group {
            if isLoading && acts.isEmpty {
                VStack(spacing: Spacing.md) {
                    ForEach(0..<3, id: \.self) { _ in Skeleton(height: 84, cornerRadius: Radius.lg) }
                }
                .padding(Spacing.lg)
            } else if let error {
                ErrorStateView(error: .transport(message: error)) {
                    Task { await load() }
                }
            } else if acts.isEmpty {
                EmptyStateView(
                    icon: "list.clipboard",
                    title: "Ревизий нет",
                    message: "Пока вас не назначили ни на один акт. Ревизию открывает управляющий."
                )
            } else {
                ScrollView {
                    VStack(spacing: Spacing.md) {
                        ForEach(Array(acts.enumerated()), id: \.element.id) { index, act in
                            NavigationLink(value: AuditActRoute(act: act)) {
                                actCard(act)
                            }
                            .buttonStyle(.pressable)
                            .staggeredAppear(index: index)
                        }
                    }
                    .padding(Spacing.lg)
                    .frame(maxWidth: 640)
                    .frame(maxWidth: .infinity)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background)
        .navigationTitle("Ревизия")
        .navigationDestination(for: AuditActRoute.self) { route in
            AuditCountScreen(act: route.act)
        }
        .task { await load() }
        .refreshable { await load() }
    }

    private func actCard(_ act: AuditAct) -> some View {
        Card(accent: Theme.accent(for: .operator)) {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Text(act.locationName)
                    .font(Typography.title)
                    .foregroundStyle(Theme.text)

                Label(act.sectionLabel, systemImage: "square.grid.2x2")
                    .font(Typography.callout)
                    .foregroundStyle(Theme.textMuted)

                if let comment = act.comment, !comment.isEmpty {
                    Text(comment)
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                }
            }
        }
    }

    private func load() async {
        error = nil
        defer { isLoading = false }
        do {
            acts = try await OperatorService(api: api).auditActs()
        } catch let apiError as APIError {
            error = apiError.operatorMessage
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Подсчёт позиций акта.
///
/// Системного остатка на экране нет намеренно: счёт слепой. Покажи мы
/// ожидаемое число — кассир начнёт подгонять под него, и ревизия перестанет
/// что-либо выявлять.
struct AuditCountScreen: View {
    let act: AuditAct

    @Environment(\.api) private var api
    /// Через хранилище идёт сохранение: там сервис с очередью отложенных
    /// действий, без которой пересчёт без связи пропадает.
    @Environment(OperatorStore.self) private var store

    @State private var sheet: AuditSheet?
    @State private var counts: [String: Double] = [:]
    @State private var isLoading = true
    @State private var error: String?
    @State private var showScanner = false
    @State private var pendingItem: AuditItem?
    @State private var quantityText = ""
    /// Что отсканировали последним — и сколько насчитали.
    ///
    /// Скан прибавлял по единице: годится, когда проводишь камерой по каждой
    /// банке, и бесполезно, когда на полке двадцать четыре. Ввести число можно
    /// было только выйдя из сканера и найдя позицию в списке руками — то есть
    /// каждый раз откладывая телефон и коробку.
    @State private var scannedItem: AuditItem?
    @State private var scanQuantity = ""
    @State private var search = ""
    @State private var onlyUncounted = false
    @State private var toast: String?
    @State private var toastIsError = false
    @State private var isSaving = false
    @State private var savedMessage: String?

    var body: some View {
        Group {
            if isLoading && sheet == nil {
                VStack(spacing: Spacing.md) {
                    ForEach(0..<6, id: \.self) { _ in Skeleton(height: 52) }
                }
                .padding(Spacing.lg)
            } else if let error {
                ErrorStateView(error: .transport(message: error)) {
                    Task { await load() }
                }
            } else if let sheet {
                content(sheet)
            }
        }
        .background(Theme.background)
        .navigationTitle("Подсчёт")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task { await load() }
        .sheet(isPresented: $showScanner) { scannerSheet }
        .sheet(item: $pendingItem) { item in quantitySheet(item) }
        .overlay(alignment: .top) {
            if let toast {
                ToastBanner(text: toast, isError: toastIsError)
                    .padding(.horizontal, Spacing.lg)
            }
        }
        .animation(Motion.value, value: toast)
    }

    private func content(_ sheet: AuditSheet) -> some View {
        VStack(spacing: 0) {
            progressHeader(sheet)

            List {
                ForEach(visibleItems(sheet)) { item in
                    AuditItemRow(
                        item: item,
                        counted: counts[item.itemID],
                        mode: sheet.mode
                    ) {
                        pendingItem = item
                        quantityText = counts[item.itemID].map { Quantity.format($0) } ?? ""
                    }
                }
            }
            .listStyle(.plain)
            .searchable(text: $search, prompt: "Название или штрихкод")

            bottomBar
        }
    }

    private func progressHeader(_ sheet: AuditSheet) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack {
                Text(act.sectionLabel)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.textMuted)
                Spacer()
                Text("\(countedCount) из \(sheet.items.count)")
                    .font(Typography.callout.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(Theme.text)
            }

            ProgressView(value: sheet.items.isEmpty ? 0 : Double(countedCount) / Double(sheet.items.count))
                .tint(Theme.accent(for: .operator))

            // Ближе к концу пересчёта вопрос один: что ещё осталось. Листать
            // ради этого весь список — то же самое, что считать заново.
            if countedCount > 0, countedCount < sheet.items.count {
                Toggle(isOn: $onlyUncounted) {
                    Text("Только непосчитанные — \(sheet.items.count - countedCount)")
                        .font(Typography.caption)
                }
                .toggleStyle(.button)
                .tint(Theme.accent(for: .operator))
            }

            if sheet.mode == .double {
                Label("Слепой счёт: чужие цифры скрыты", systemImage: "eye.slash")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
            }
        }
        .padding(Spacing.lg)
    }

    private var bottomBar: some View {
        HStack(spacing: Spacing.md) {
            Button {
                showScanner = true
            } label: {
                Label("Сканировать", systemImage: "barcode.viewfinder")
            }
            .buttonStyle(SecondaryButtonStyle())

            Button {
                Task { await save() }
            } label: {
                if isSaving {
                    ProgressView().controlSize(.small)
                } else {
                    Text(savedMessage ?? "Сохранить")
                }
            }
            .buttonStyle(PrimaryButtonStyle(tint: Theme.accent(for: .operator)))
            .disabled(isSaving || counts.isEmpty)
        }
        .padding(Spacing.lg)
        .background(.ultraThinMaterial)
    }

    private var scannerSheet: some View {
        NavigationStack {
            VStack(spacing: Spacing.md) {
                ScannerPane { code in handleScan(code) }
                    .padding(Spacing.lg)

                scannedPanel

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

    /// Что делать с только что отсканированным.
    ///
    /// Скан по-прежнему прибавляет единицу — так считают штучный товар, проводя
    /// камерой по каждой банке. Но рядом сразу стоит поле: если на полке
    /// двадцать четыре, это число вводится здесь же, не выходя из сканера.
    @ViewBuilder
    private var scannedPanel: some View {
        if let item = scannedItem {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Text(item.name)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .lineLimit(2)

                HStack(spacing: Spacing.sm) {
                    TextField("0", text: $scanQuantity)
                        .font(Typography.monospacedDigits(Typography.title))
                        .textFieldStyle(.plain)
                        #if os(iOS)
                        .keyboardType(.decimalPad)
                        #endif
                        .frame(maxWidth: 120)
                        .padding(Spacing.sm)
                        .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))

                    Text(item.unit ?? "шт")
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textDim)

                    Spacer()

                    Button("Записать") {
                        let value = Double(scanQuantity.replacingOccurrences(of: ",", with: ".")) ?? 0
                        counts[item.itemID] = max(0, value)
                        savedMessage = nil
                        toast(text: "\(item.name) — \(Quantity.format(max(0, value)))", isError: false)
                        Haptics.success()
                    }
                    .buttonStyle(PrimaryButtonStyle(tint: Theme.accent(for: .operator)))
                }

                Text("Скан прибавляет по одной. Нужно другое число — впишите и нажмите «Записать».")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(Spacing.lg)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
            .padding(.horizontal, Spacing.lg)
        }
    }

    private func quantitySheet(_ item: AuditItem) -> some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                Text(item.name)
                    .font(Typography.title)
                    .foregroundStyle(Theme.text)

                if let barcode = item.barcode {
                    Text(barcode)
                        .font(Typography.caption)
                        .monospaced()
                        .foregroundStyle(Theme.textDim)
                }

                HStack {
                    TextField("0", text: $quantityText)
                        .font(Typography.monospacedDigits(Typography.metric))
                        .textFieldStyle(.plain)
                        #if os(iOS)
                        .keyboardType(.decimalPad)
                        #endif
                    Text(item.unit ?? "шт")
                        .font(Typography.title)
                        .foregroundStyle(Theme.textDim)
                }
                .padding(Spacing.lg)
                .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))

                Button("Записать") {
                    let value = Double(quantityText.replacingOccurrences(of: ",", with: ".")) ?? 0
                    counts[item.itemID] = max(0, value)
                    savedMessage = nil
                    pendingItem = nil
                    Haptics.tap()
                }
                .buttonStyle(PrimaryButtonStyle(tint: Theme.accent(for: .operator)))

                Spacer()
            }
            .padding(Spacing.lg)
            .background(Theme.background)
            .navigationTitle("Количество")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { pendingItem = nil }
                }
            }
        }
        .presentationDetents([.medium])
    }

    // ── Поведение ────────────────────────────────────────────────────────────

    /// Что показывать в списке.
    ///
    /// На складе четыреста позиций, а ищут одну — ту, что в руках. Без поиска
    /// её листали пальцем, стоя у стеллажа.
    private func visibleItems(_ sheet: AuditSheet) -> [AuditItem] {
        var items = sheet.items
        if onlyUncounted { items = items.filter { counts[$0.itemID] == nil } }
        let text = search.trimmingCharacters(in: .whitespaces).lowercased()
        guard !text.isEmpty else { return items }
        return items.filter {
            $0.name.lowercased().contains(text) || ($0.barcode?.contains(text) ?? false)
        }
    }

    private var countedCount: Int {
        guard let sheet else { return 0 }
        return sheet.items.filter { counts[$0.itemID] != nil }.count
    }

    private func handleScan(_ code: String) {
        guard let sheet else { return }
        let needle = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let item = sheet.items.first(where: { ($0.barcode ?? "") == needle }) else {
            toast(text: "Штрихкод \(needle) не в вашей секции", isError: true)
            Haptics.error()
            return
        }

        // Повторный скан той же позиции — плюс одна единица. Так считают
        // штучный товар: провёл камерой по каждой банке.
        let next = (counts[item.itemID] ?? 0) + 1
        counts[item.itemID] = next
        savedMessage = nil
        // Показываем отсканированное рядом с камерой: отсюда число правится
        // сразу, без выхода в список.
        scannedItem = item
        scanQuantity = Quantity.format(next)
        toast(text: "\(item.name) — \(Quantity.format(next))", isError: false)
        Haptics.success()
    }

    private func toast(text: String, isError: Bool) {
        toast = text
        toastIsError = isError
        Task {
            try? await Task.sleep(for: .seconds(isError ? 2.5 : 1.2))
            if toast == text { toast = nil }
        }
    }

    private func load() async {
        error = nil
        defer { isLoading = false }
        do {
            let loaded = try await OperatorService(api: api).auditSheet(actID: act.actID)
            sheet = loaded
            // Уже сохранённые ранее подсчёты подставляем — работу можно
            // продолжить с другого устройства.
            for item in loaded.items {
                if let counted = item.counted { counts[item.itemID] = counted }
            }
        } catch let apiError as APIError {
            error = apiError.operatorMessage
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func save() async {
        isSaving = true
        defer { isSaving = false }

        let payload = counts.map { AuditCount(itemID: $0.key, countedQuantity: $0.value) }
        do {
            // Очередь берёт на себя только обрыв связи — об этом и говорим
            // прямо: обещать «сохранено», когда данные лежат на телефоне,
            // нельзя, а терять пересчёт из-за подвала нельзя тем более.
            let result = try await store.saveAuditCounts(actID: act.actID, counts: payload)
            savedMessage = result.map { "Сохранено \($0.saved)" } ?? "Связи нет — уйдёт само"
            Haptics.success()
        } catch let apiError as APIError {
            toast(text: apiError.operatorMessage, isError: true)
            Haptics.error()
        } catch {
            toast(text: error.localizedDescription, isError: true)
        }
    }
}

/// Строка позиции в акте.
struct AuditItemRow: View {
    let item: AuditItem
    let counted: Double?
    let mode: AuditMode
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: Spacing.md) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.name)
                        .font(Typography.body)
                        .foregroundStyle(Theme.text)
                        .lineLimit(2)

                    if mode == .single, let other = item.otherQuantity {
                        Text("посчитал \(item.otherBy ?? "коллега"): \(Quantity.format(other))")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.info)
                    } else if let barcode = item.barcode {
                        Text(barcode)
                            .font(Typography.caption)
                            .monospaced()
                            .foregroundStyle(Theme.textDim)
                    }
                }

                Spacer()

                if let counted {
                    Text(Quantity.format(counted))
                        .font(Typography.callout.weight(.bold))
                        .monospacedDigit()
                        .foregroundStyle(Theme.positive)
                        .contentTransition(.numericText())
                } else {
                    Image(systemName: "circle.dashed")
                        .foregroundStyle(Theme.textDim)
                }
            }
            .padding(.vertical, Spacing.xs)
            .contentShape(Rectangle())
        }
        .buttonStyle(.pressable)
        .listRowBackground(Theme.background)
    }
}

/// Адрес акта ревизии.
struct AuditActRoute: Hashable {
    let act: AuditAct
}
