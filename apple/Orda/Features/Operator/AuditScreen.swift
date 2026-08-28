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
    @Environment(OperatorStore.self) private var store

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
                        // Пересчёт, не сохранившийся при уходе с экрана. Сказать
                        // об этом больше негде, а считать заново придётся.
                        if let saveError = store.auditSaveError {
                            Card(accent: Theme.warning) {
                                VStack(alignment: .leading, spacing: Spacing.xs) {
                                    Text("Последний пересчёт не сохранился")
                                        .font(Typography.callout.weight(.semibold))
                                        .foregroundStyle(Theme.text)
                                    Text(saveError)
                                        .font(Typography.caption)
                                        .foregroundStyle(Theme.textMuted)
                                        .fixedSize(horizontal: false, vertical: true)
                                    Button("Понятно") { store.auditSaveError = nil }
                                        .font(Typography.caption.weight(.semibold))
                                        .foregroundStyle(Theme.brand)
                                        .buttonStyle(.plain)
                                }
                            }
                        }

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
    /// Что отсканировали и ждёт количества.
    ///
    /// Скан прибавлял по единице сам: годится, когда проводишь камерой по
    /// каждой банке, и бесполезно, когда на полке двадцать четыре. Теперь скан
    /// открывает поле — как на сайте: навёл, вписал число, «Готово», следующий
    /// товар. Пока поле открыто, камера не ищет коды, иначе соседний штрихкод
    /// перебивает набранное.
    @State private var scannedItem: AuditItem?
    @State private var scanQuantity = ""
    @FocusState private var scanFieldFocused: Bool

    /// Посчитанное, но ещё не улетевшее на сервер.
    ///
    /// Пересчёт на четыреста позиций — это час работы. Держать его только в
    /// памяти телефона, который у кассира падает в ящик с бутылками, нельзя.
    @State private var unsaved: Set<String> = []
    @State private var autosave: Task<Void, Never>?
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
        // Отметки «уже посчитал коллега» подтягиваем раз в двадцать секунд —
        // так же, как страница на сайте. Без этого двое считают одну полку и
        // узнают об этом из расхождения в акте, когда переделывать поздно.
        .task(id: act.actID) {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(20))
                if Task.isCancelled { break }
                await refreshMarks()
            }
        }
        .sheet(isPresented: $showScanner) { scannerSheet }
        .sheet(item: $pendingItem) { item in quantitySheet(item) }
        .overlay(alignment: .top) {
            if let toast {
                ToastBanner(text: toast, isError: toastIsError)
                    .padding(.horizontal, Spacing.lg)
            }
        }
        .animation(Motion.value, value: toast)
        // Ушли с экрана — досылаем последнее число, не дожидаясь таймера.
        // Кнопку «назад» жмут ровно тогда, когда считать закончили.
        .onDisappear {
            autosave?.cancel()
            let ids = unsaved
            guard !ids.isEmpty else { return }
            unsaved.removeAll()
            let payload = ids.compactMap { id in counts[id].map { AuditCount(itemID: id, countedQuantity: $0) } }
            guard !payload.isEmpty else { return }
            let store = store
            let actID = act.actID
            Task { await store.flushAuditCounts(actID: actID, counts: payload) }
        }
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
            .refreshable { await refreshMarks() }

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
        VStack(spacing: Spacing.sm) {
            if !unsaved.isEmpty {
                Text("не сохранено \(unsaved.count) — уйдёт само или по кнопке")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.warning)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            scanAndSaveRow
        }
        .padding(Spacing.lg)
        .background(.ultraThinMaterial)
    }

    private var scanAndSaveRow: some View {
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
    }

    private var scannerSheet: some View {
        NavigationStack {
            VStack(spacing: Spacing.md) {
                ScannerPane(isPaused: scannedItem != nil, refocusAfterManual: false) { code in handleScan(code) }
                    .padding(.horizontal, Spacing.lg)
                    .padding(.top, Spacing.lg)

                if let sheet {
                    // Сколько осталось — единственное, что хочется знать, не
                    // выходя из камеры.
                    HStack {
                        Text("посчитано \(countedCount) из \(sheet.items.count)")
                            .font(Typography.caption)
                            .monospacedDigit()
                            .foregroundStyle(Theme.textMuted)
                        Spacer()
                        if !unsaved.isEmpty {
                            Text("не сохранено \(unsaved.count)")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.warning)
                        }
                    }
                    .padding(.horizontal, Spacing.lg)
                }

                Spacer()

                if scannedItem == nil {
                    Text("Наведите камеру на штрихкод — откроется поле для количества.")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, Spacing.xl)
                        .padding(.bottom, Spacing.xl)
                }
            }
            .background(Theme.background)
            .navigationTitle("Сканирование")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Готово") {
                        closeScanned()
                        showScanner = false
                    }
                }
            }
            // Поле держим в safeAreaInset: так оно само поднимается над
            // клавиатурой, а камера остаётся на своём месте.
            .safeAreaInset(edge: .bottom) {
                if let item = scannedItem { quantityPad(item) }
            }
            .overlay(alignment: .top) {
                if let toast {
                    ToastBanner(text: toast, isError: toastIsError)
                        .padding(.horizontal, Spacing.lg)
                }
            }
            .animation(Motion.value, value: scannedItem?.itemID)
        }
    }

    /// Поле количества поверх камеры.
    ///
    /// Порядок один в один как на сайте: название, крупное поле, коробки,
    /// «Готово». Системный остаток не показываем и здесь — счёт слепой.
    private func quantityPad(_ item: AuditItem) -> some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            HStack(alignment: .top, spacing: Spacing.sm) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.name)
                        .font(Typography.callout.weight(.semibold))
                        .foregroundStyle(Theme.text)
                        .lineLimit(2)
                    if let barcode = item.barcode {
                        Text(barcode)
                            .font(Typography.caption)
                            .monospaced()
                            .foregroundStyle(Theme.textDim)
                    }
                }
                Spacer(minLength: Spacing.sm)
                Button {
                    closeScanned()
                } label: {
                    Image(systemName: "xmark")
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textDim)
                }
                .buttonStyle(.plain)
            }

            if sheet?.mode == .single, let other = item.otherQuantity {
                Text("уже посчитал \(item.otherBy ?? "коллега"): \(Quantity.format(other))")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.info)
            }

            HStack(spacing: Spacing.sm) {
                TextField("0", text: $scanQuantity)
                    .font(Typography.monospacedDigits(Typography.metric))
                    .textFieldStyle(.plain)
                    .focused($scanFieldFocused)
                    .multilineTextAlignment(.center)
                    #if os(iOS)
                    .keyboardType(.decimalPad)
                    #endif
                    .onSubmit { commitScanned(item) }
                Text(item.unit ?? "шт")
                    .font(Typography.callout)
                    .foregroundStyle(Theme.textDim)
            }
            .padding(Spacing.md)
            .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))

            quickAddRow($scanQuantity)

            Button("Готово") { commitScanned(item) }
                .buttonStyle(PrimaryButtonStyle(tint: Theme.accent(for: .operator)))
        }
        .padding(Spacing.lg)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
        .padding(Spacing.md)
        .transition(.move(edge: .bottom).combined(with: .opacity))
        // Курсор ставим здесь, а не в момент скана: поля тогда ещё нет на
        // экране, и присвоение фокуса уходило бы в никуда.
        .onAppear { scanFieldFocused = true }
    }

    /// Коробки. Прибавляют к тому, что уже набрано: считают полку по частям.
    private func quickAddRow(_ text: Binding<String>) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Spacing.xs) {
                ForEach(auditQuickAdd, id: \.self) { step in
                    Button("+\(step)") {
                        let current = Double(text.wrappedValue.replacingOccurrences(of: ",", with: ".")) ?? 0
                        text.wrappedValue = Quantity.format(max(0, current) + Double(step))
                        Haptics.tap()
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .font(Typography.monospacedDigits(Typography.caption))
                }
                Button("сброс") {
                    text.wrappedValue = ""
                    Haptics.tap()
                }
                .buttonStyle(SecondaryButtonStyle())
                .font(Typography.caption)
            }
            .padding(.horizontal, 1)
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

                quickAddRow($quantityText)

                Button("Записать") {
                    let value = max(0, Double(quantityText.replacingOccurrences(of: ",", with: ".")) ?? 0)
                    counts[item.itemID] = value
                    record(item.itemID)
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

        // Раньше скан сам прибавлял единицу. Для штучного товара это удобно, а
        // для полки с двадцатью четырьмя бутылками — нет: приходилось искать
        // позицию в списке и переписывать. Теперь скан открывает поле, а уже
        // введённое подставляет — полку пересчитывают, а не набирают заново.
        scannedItem = item
        scanQuantity = counts[item.itemID].map { Quantity.format($0) } ?? ""
        Haptics.tap()
    }

    /// «Готово»: число записано, поле уходит, камера просыпается.
    private func commitScanned(_ item: AuditItem) {
        let value = max(0, Double(scanQuantity.replacingOccurrences(of: ",", with: ".")) ?? 0)
        counts[item.itemID] = value
        record(item.itemID)
        closeScanned()
        toast(text: "\(item.name) — \(Quantity.format(value))", isError: false)
        Haptics.success()
    }

    private func closeScanned() {
        scanFieldFocused = false
        scannedItem = nil
        scanQuantity = ""
    }

    /// Записанное число уходит на сервер само, через полторы секунды тишины.
    ///
    /// Кнопка «Сохранить» осталась, но полагаться на неё нельзя: час пересчёта
    /// пропадает, если телефон разрядился или приложение убили. Шлём только
    /// изменённое — сервер кладёт его поверх, а не заменяет весь акт.
    private func record(_ itemID: String) {
        savedMessage = nil
        unsaved.insert(itemID)
        autosave?.cancel()
        autosave = Task {
            try? await Task.sleep(for: .seconds(1.5))
            guard !Task.isCancelled else { return }
            await flushUnsaved()
        }
    }

    private func flushUnsaved() async {
        let ids = unsaved
        guard !ids.isEmpty else { return }
        unsaved.removeAll()
        let payload = ids.compactMap { id in counts[id].map { AuditCount(itemID: id, countedQuantity: $0) } }
        guard !payload.isEmpty else { return }
        do {
            _ = try await store.saveAuditCounts(actID: act.actID, counts: payload)
        } catch {
            // Не ушло — возвращаем в очередь. Следующее число попробует снова,
            // и кнопка «Сохранить» отправит всё разом.
            unsaved.formUnion(ids)
        }
    }

    private func toast(text: String, isError: Bool) {
        toast = text
        toastIsError = isError
        Task {
            try? await Task.sleep(for: .seconds(isError ? 2.5 : 1.2))
            if toast == text { toast = nil }
        }
    }

    /// Тихое обновление: чужие отметки меняются, мой ввод — нет.
    ///
    /// Своё число с сервера подставляем только там, где локально ничего не
    /// ждёт отправки, иначе обновление затрёт только что набранное.
    private func refreshMarks() async {
        // В слепом режиме чужих отметок нет вовсе — и опрашивать нечего.
        guard sheet?.mode == .single, scannedItem == nil, pendingItem == nil else { return }
        do {
            let loaded = try await OperatorService(api: api).auditSheet(actID: act.actID)
            sheet = loaded
            for item in loaded.items where !unsaved.contains(item.itemID) {
                if let counted = item.counted { counts[item.itemID] = counted }
            }
        } catch {
            // Фоновое обновление. Отказ означает лишь, что отметки постарели;
            // экран продолжает работать, а следующий круг попробует снова.
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
        autosave?.cancel()
        let queued = unsaved
        unsaved.removeAll()

        let payload = counts.map { AuditCount(itemID: $0.key, countedQuantity: $0.value) }
        do {
            // Очередь берёт на себя только обрыв связи — об этом и говорим
            // прямо: обещать «сохранено», когда данные лежат на телефоне,
            // нельзя, а терять пересчёт из-за подвала нельзя тем более.
            let result = try await store.saveAuditCounts(actID: act.actID, counts: payload)
            savedMessage = result.map { "Сохранено \($0.saved)" } ?? "Связи нет — уйдёт само"
            Haptics.success()
        } catch let apiError as APIError {
            unsaved.formUnion(queued)
            toast(text: apiError.operatorMessage, isError: true)
            Haptics.error()
        } catch {
            unsaved.formUnion(queued)
            toast(text: error.localizedDescription, isError: true)
        }
    }
}

/// Коробка, полкоробки, блок — то, чем считают на самом деле.
/// Набрать «144» на телефоне у стеллажа дольше, чем нажать дважды.
private let auditQuickAdd: [Int] = [1, 6, 12, 24, 96, 144]

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
