import OrdaKit
import OrdaUI
import SwiftUI

// ── Приёмки ──────────────────────────────────────────────────────────────────

/// Приходы товара: поставки от поставщиков и оприходование своими силами.
///
/// Это два разных документа и два разных пункта меню, но один журнал на
/// сервере: различает их поле `kind`. Раньше оба пункта открывали общий
/// список, и оприходование терялось среди накладных.
///
/// Отдельно помечены позиции с истекающим сроком: приёмку открывают повторно
/// именно из-за них, а не чтобы посмотреть сумму накладной.
struct ReceiptsScreen: View {
    /// Какой из двух журналов показываем.
    enum Kind {
        /// Поставка по накладной от поставщика.
        case supplier
        /// Оприходование излишков своими силами: без поставщика и накладной.
        case posting

        var title: String {
            switch self {
            case .supplier: "Приёмки"
            case .posting: "Оприходование"
            }
        }

        var emptyTitle: String {
            switch self {
            case .supplier: "Приёмок нет"
            case .posting: "Оприходований нет"
            }
        }

        var emptyMessage: String {
            switch self {
            case .supplier: "Здесь появятся поставки товара на склад."
            case .posting: "Здесь появится товар, оприходованный без поставщика."
            }
        }

        var countLabel: String {
            switch self {
            case .supplier: "Приёмок"
            case .posting: "Документов"
            }
        }

        var amountLabel: String {
            switch self {
            case .supplier: "Закуплено"
            case .posting: "На сумму"
            }
        }
    }

    var kind: Kind = .supplier

    @Environment(BusinessStore.self) private var store
    @Environment(\.access) private var access
    @State private var selected: Receipt?
    @State private var isAdding = false

    /// Приёмку и оприходование сервер закрывает разными правами.
    private var canCreate: Bool {
        access?.can(kind == .posting ? "store-postings.create" : "store-receipts.create") ?? false
    }

    var body: some View {
        VStack(spacing: 0) {
            summary

            if let error = store.receiptsError, store.receipts.isEmpty {
                ErrorStateView(error: error) { Task { await store.loadReceipts() } }
            } else if store.isLoadingReceipts && store.receipts.isEmpty {
                LoadingRows(count: 7)
            } else {
                MasterDetail(
                    items: sorted,
                    selection: $selected,
                    listWidth: 340
                ) { receipt in
                    ReceiptRow(receipt: receipt)
                } detail: { receipt in
                    ReceiptDetail(receipt: receipt) { await store.loadReceipts() }
                } empty: {
                    WideEmptyState(
                        icon: kind == .posting ? "square.and.arrow.down" : "arrow.down.circle",
                        title: kind.emptyTitle,
                        message: kind.emptyMessage
                    )
                }
            }
        }
        .background(Theme.background)
        .navigationTitle(kind.title)
        .toolbar {
            // Форма одна на оба документа: у оприходования она без
            // поставщика, накладной и оплаты — как на сайте.
            if canCreate {
                ToolbarItem(placement: .primaryAction) {
                    Button { isAdding = true } label: { Image(systemName: "plus") }
                }
            }
            LogoutToolbarItem()
        }
        .task { await store.loadReceipts() }
        .refreshable { await store.loadReceipts() }
        .sheet(isPresented: $isAdding) { AddReceiptSheet(isPosting: kind == .posting) }
    }

    private var summary: some View {
        let rows = ownKind
        let active = rows.filter { !$0.isCancelled }
        let expiring = rows.reduce(0) { $0 + $1.expiring.count }

        return Group {
            if !rows.isEmpty {
                HeroSummary(
                    title: kind.amountLabel,
                    value: Money.format(active.reduce(0) { $0 + $1.totalAmount }),
                    footer: [(kind.countLabel, "\(active.count)")]
                        + (expiring > 0 ? [("Истекает срок", "\(expiring)")] : []),
                    colors: Theme.heroAccent
                )
                // Карточка стоит над списком: без отступа градиент упирался в
                // края экрана и срезал скругления.
                .padding(.horizontal, Spacing.lg)
                .padding(.vertical, Spacing.md)
            }
        }
    }

    private var ownKind: [Receipt] {
        store.receipts.filter { kind == .posting ? $0.isPosting : !$0.isPosting }
    }

    private var sorted: [Receipt] {
        ownKind.sorted { ($0.receivedAt ?? .distantPast) > ($1.receivedAt ?? .distantPast) }
    }
}

private struct ReceiptRow: View {
    let receipt: Receipt

    var body: some View {
        // Строка как операция в выписке: иконка прихода в кружке, сумма
        // крупно справа. Отменённая — серая, чтобы не путать с живой.
        HStack(spacing: Spacing.md) {
            TintedIcon(
                systemName: receipt.isCancelled ? "xmark" : "arrow.down",
                tint: receipt.isCancelled ? Theme.textDim : Theme.positive
            )

            VStack(alignment: .leading, spacing: 2) {
                // У оприходования поставщика нет по определению — писать
                // «Без поставщика» на каждой строке значит кричать об
                // отсутствии того, чего там и не должно быть.
                Text(receipt.supplierName ?? (receipt.isPosting ? "Оприходование" : "Без поставщика"))
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(receipt.isCancelled ? Theme.textDim : Theme.text)
                    .strikethrough(receipt.isCancelled, color: Theme.textDim)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 2) {
                Text(Money.format(receipt.totalAmount))
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(receipt.isCancelled ? Theme.textDim : Theme.text)
                    .strikethrough(receipt.isCancelled, color: Theme.textDim)
                // Цветной подписью, а не плашкой: плашка съедала ширину и
                // сумма обрезалась.
                if !receipt.expiring.isEmpty {
                    Text("\(receipt.expiring.count) истекает")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.warning)
                }
            }
        }
    }

    private var subtitle: String {
        var parts: [String] = []
        if let date = receipt.receivedAt {
            parts.append(date.formatted(.dateTime.day().month(.abbreviated)))
        }
        if let invoice = receipt.invoiceNumber, !invoice.isEmpty { parts.append("№\(invoice)") }
        parts.append("\(receipt.items.count) \(pluralize(receipt.items.count, "позиция", "позиции", "позиций"))")
        return parts.joined(separator: " · ")
    }
}

private struct ReceiptDetail: View {
    let receipt: Receipt
    var onChanged: (() async -> Void)? = nil

    @Environment(\.access) private var access
    @Environment(\.api) private var api
    @State private var cancelling = false

    private var canCancel: Bool { access?.can("store-receipts.cancel") ?? false }

    var body: some View {
        ScreenScroll {
            VStack(spacing: Spacing.lg) {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        HStack(alignment: .top) {
                            Text(receipt.supplierName ?? "Без поставщика")
                                .font(Typography.title)
                                .foregroundStyle(Theme.text)
                            Spacer()
                            StatusChip(receipt.statusLabel, kind: receipt.isCancelled ? .danger : .good)
                        }

                        if let date = receipt.receivedAt {
                            StatRow("Принята", value: date.formatted(.dateTime.day().month(.wide).hour().minute()), icon: "calendar")
                        }
                        if let invoice = receipt.invoiceNumber, !invoice.isEmpty {
                            StatRow("Накладная", value: invoice, icon: "doc.text")
                        }
                        if let location = receipt.locationName {
                            StatRow("Куда", value: location, icon: "shippingbox")
                        }
                        RowDivider()
                        StatRow("Сумма", value: Money.format(receipt.totalAmount), emphasized: true)

                        // Ошибку в приёмке видно, когда товар уже разложили:
                        // пересчитали коробку, а там не двадцать, а
                        // восемнадцать. Отмена возвращает остатки как было.
                        if canCancel, !receipt.isCancelled {
                            RowDivider()
                            Button {
                                cancelling = true
                            } label: {
                                Label("Отменить приёмку", systemImage: "arrow.uturn.backward")
                            }
                            .buttonStyle(DestructiveButtonStyle())
                        }

                        if let reason = receipt.cancelReason, !reason.isEmpty {
                            RowDivider()
                            Text("Отменена: \(reason)")
                                .font(Typography.callout)
                                .foregroundStyle(Theme.negative)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        if let comment = receipt.comment, !comment.isEmpty {
                            Text(comment)
                                .font(Typography.callout)
                                .foregroundStyle(Theme.textMuted)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }

                OwnerSection("Состав") {
                    Text("\(receipt.items.count) поз.")
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.textDim)
                } content: {
                    if receipt.items.isEmpty {
                        InlineEmpty(icon: "tray", text: "Позиции не указаны", tint: Theme.textDim)
                    } else {
                        VStack(spacing: 0) {
                            ForEach(Array(receipt.items.enumerated()), id: \.element.id) { index, line in
                                if index > 0 { PlainRowDivider() }
                                DocumentLineRow(line: line)
                                    .padding(.vertical, Spacing.sm)
                            }
                        }
                    }
                }
            }
        }
        .background(Theme.background)
        .sheet(isPresented: $cancelling) {
            CancelDocumentSheet(
                kind: .receipt(
                    id: receipt.id,
                    title: receipt.supplierName ?? "Приёмка",
                    amount: receipt.totalAmount
                )
            ) {
                await onChanged?()
            }
        }
        .navigationTitle("Приёмка")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}

// ── Списания ─────────────────────────────────────────────────────────────────

/// Списания: что и почему ушло со склада.
///
/// Сгруппированы по причине, а не по дате: владелец смотрит сюда, чтобы
/// понять, куда утекает товар, — и «просрочка на 200 тысяч» видна только
/// в разрезе причин.
struct WriteoffsScreen: View {
    @Environment(BusinessStore.self) private var store
    @Environment(\.access) private var access
    @State private var selected: Writeoff?
    @State private var isAdding = false

    /// Право `store-writeoffs.create` проверяет и сервер.
    private var canCreate: Bool { access?.can("store-writeoffs.create") ?? false }

    var body: some View {
        VStack(spacing: 0) {
            summary

            if let error = store.writeoffsError, store.writeoffs.isEmpty {
                ErrorStateView(error: error) { Task { await store.loadWriteoffs() } }
            } else if store.isLoadingWriteoffs && store.writeoffs.isEmpty {
                LoadingRows(count: 7)
            } else {
                MasterDetail(
                    items: sorted,
                    selection: $selected,
                    listWidth: 340
                ) { writeoff in
                    WriteoffRow(writeoff: writeoff)
                } detail: { writeoff in
                    WriteoffDetail(writeoff: writeoff) { await store.loadWriteoffs() }
                } empty: {
                    WideEmptyState(
                        icon: "trash",
                        title: "Списаний нет",
                        message: "Здесь появится товар, ушедший со склада не через продажу."
                    )
                }
            }
        }
        .background(Theme.background)
        .navigationTitle("Списания")
        .toolbar {
            if canCreate {
                ToolbarItem(placement: .primaryAction) {
                    Button { isAdding = true } label: { Image(systemName: "plus") }
                }
            }
            LogoutToolbarItem()
        }
        .task { await store.loadWriteoffs() }
        .refreshable { await store.loadWriteoffs() }
        .sheet(isPresented: $isAdding) { AddWriteoffSheet() }
    }

    private var summary: some View {
        let active = store.writeoffs.filter { !$0.isCancelled }
        // Разрез по причинам: крупнейшая утечка должна быть видна сразу.
        var byReason: [String: Double] = [:]
        for writeoff in active {
            byReason[writeoff.reasonLabel, default: 0] += writeoff.totalAmount
        }
        let top = byReason.max { $0.value < $1.value }

        let total = active.reduce(0) { $0 + $1.totalAmount }
        var footer: [(String, String)] = []
        if let top { footer.append((top.key, Money.format(top.value))) }
        footer.append(("Документов", "\(active.count)"))

        // Одна главная цифра — сколько ушло, — крупнейшая причина под ней:
        // три одинаковые плашки не говорили, какая из цифр важна.
        return Group {
            if !active.isEmpty {
                HeroSummary(
                    title: "Списано всего",
                    value: Money.format(total),
                    caption: top.map { "больше всего — \($0.key.lowercased())" },
                    footer: footer,
                    colors: Theme.heroNegative
                )
                .padding(.horizontal, Spacing.lg)
                .padding(.vertical, Spacing.md)
            }
        }
    }

    private var sorted: [Writeoff] {
        store.writeoffs.sorted { ($0.writtenAt ?? .distantPast) > ($1.writtenAt ?? .distantPast) }
    }
}

private struct WriteoffRow: View {
    let writeoff: Writeoff

    var body: some View {
        HStack(spacing: Spacing.md) {
            TintedIcon(systemName: "trash", tint: writeoff.isCancelled ? Theme.textDim : Theme.negative)

            VStack(alignment: .leading, spacing: 2) {
                Text(writeoff.reasonLabel)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(writeoff.isCancelled ? Theme.textDim : Theme.text)
                    .strikethrough(writeoff.isCancelled, color: Theme.textDim)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }

            Spacer(minLength: Spacing.sm)

            Text("−" + Money.format(writeoff.totalAmount))
                .font(.system(size: 16, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(writeoff.isCancelled ? Theme.textDim : Theme.negative)
                .strikethrough(writeoff.isCancelled, color: Theme.textDim)
        }
    }

    private var subtitle: String {
        var parts: [String] = []
        if let date = writeoff.writtenAt {
            parts.append(date.formatted(.dateTime.day().month(.abbreviated)))
        }
        if let location = writeoff.locationName { parts.append(location) }
        return parts.joined(separator: " · ")
    }
}

private struct WriteoffDetail: View {
    let writeoff: Writeoff
    var onChanged: (() async -> Void)? = nil

    @Environment(\.access) private var access
    @State private var cancelling = false

    private var canCancel: Bool { access?.can("store-writeoffs.cancel") ?? false }

    var body: some View {
        ScreenScroll {
            VStack(spacing: Spacing.lg) {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        HStack(alignment: .top) {
                            Text(writeoff.reasonLabel)
                                .font(Typography.title)
                                .foregroundStyle(Theme.text)
                            Spacer()
                            if writeoff.isCancelled {
                                StatusChip("отменено", kind: .neutral)
                            }
                        }

                        if let date = writeoff.writtenAt {
                            StatRow("Списано", value: date.formatted(.dateTime.day().month(.wide).hour().minute()), icon: "calendar")
                        }

                        // Списали не то или не столько — товар должен
                        // вернуться на остаток, пока расхождение свежее.
                        if canCancel, !writeoff.isCancelled {
                            RowDivider()
                            Button {
                                cancelling = true
                            } label: {
                                Label("Отменить списание", systemImage: "arrow.uturn.backward")
                            }
                            .buttonStyle(DestructiveButtonStyle())
                        }
                        if let location = writeoff.locationName {
                            StatRow("Откуда", value: location, icon: "shippingbox")
                        }
                        if let company = writeoff.companyName {
                            StatRow("Точка", value: company, icon: "building.2")
                        }
                        RowDivider()
                        StatRow("Сумма", value: Money.format(writeoff.totalAmount), valueColor: Theme.negative, emphasized: true)

                        if let comment = writeoff.comment, !comment.isEmpty {
                            RowDivider()
                            Text(comment)
                                .font(Typography.callout)
                                .foregroundStyle(Theme.textMuted)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }

                OwnerSection("Состав") {
                    Text("\(writeoff.items.count) поз.")
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.textDim)
                } content: {
                    if writeoff.items.isEmpty {
                        InlineEmpty(icon: "tray", text: "Позиции не указаны", tint: Theme.textDim)
                    } else {
                        VStack(spacing: 0) {
                            ForEach(Array(writeoff.items.enumerated()), id: \.element.id) { index, line in
                                if index > 0 { PlainRowDivider() }
                                DocumentLineRow(line: line)
                                    .padding(.vertical, Spacing.sm)
                            }
                        }
                    }
                }
            }
        }
        .background(Theme.background)
        .sheet(isPresented: $cancelling) {
            CancelDocumentSheet(
                kind: .writeoff(
                    id: writeoff.id,
                    title: writeoff.reasonLabel,
                    amount: writeoff.totalAmount
                )
            ) {
                await onChanged?()
            }
        }
        .navigationTitle("Списание")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}

/// Строка складского документа — общая для приёмки и списания.
struct DocumentLineRow: View {
    let line: DocumentLine

    var body: some View {
        // Буква товара в кружке — как в строках склада: позиции документа
        // читаются так же, как остатки, к которым они относятся.
        HStack(spacing: Spacing.md) {
            LetterBadge(text: line.name, tint: line.expiresSoon ? Theme.warning : Theme.brand, size: 36)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: Spacing.xs) {
                    Text(line.name)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                    if line.isBonus {
                        Text("бонус")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Theme.info)
                    }
                }
                Text(detail)
                    .font(.system(size: 13))
                    .monospacedDigit()
                    .foregroundStyle(line.expiresSoon ? Theme.warning : Theme.textDim)
                    .lineLimit(1)
            }

            Spacer(minLength: Spacing.sm)

            Text(Money.format(line.totalCost))
                .font(.system(size: 15, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(Theme.text)
        }
    }

    private var detail: String {
        var text = "\(Quantity.format(line.quantity)) \(line.unit) × \(Money.format(line.unitCost))"
        if let expiry = line.expiryDate {
            text += " · до \(expiry.formatted(.dateTime.day().month(.abbreviated)))"
        }
        return text
    }
}

// ── Отчёты смен ──────────────────────────────────────────────────────────────

/// Закрытые и открытые смены точек.
///
/// Расхождение по кассе считаем только у закрытой смены: у открытой наличные
/// ещё в обороте, и «недостача» на середине смены недостачей не является.
struct ShiftReportsScreen: View {
    @Environment(BusinessStore.self) private var store
    @State private var selected: ShiftReport?

    var body: some View {
        VStack(spacing: 0) {
            summary

            if let error = store.shiftReportsError, store.shiftReports.isEmpty {
                ErrorStateView(error: error) { Task { await store.loadShiftReports() } }
            } else if store.isLoadingShiftReports && store.shiftReports.isEmpty {
                LoadingRows(count: 7)
            } else {
                MasterDetail(
                    items: store.shiftReports,
                    selection: $selected,
                    listWidth: 340
                ) { shift in
                    ShiftReportRow(shift: shift)
                } detail: { shift in
                    ShiftReportDetail(shift: shift)
                } empty: {
                    WideEmptyState(
                        icon: "calendar.badge.clock",
                        title: "Смен нет",
                        message: "Здесь появятся отчёты закрытых смен."
                    )
                }
            }
        }
        .background(Theme.background)
        .navigationTitle("Отчёты смен")
        .toolbar { LogoutToolbarItem() }
        .task { await store.loadShiftReports() }
        .refreshable { await store.loadShiftReports() }
    }

    private var summary: some View {
        let open = store.shiftReports.filter(\.isOpen)
        let closed = store.shiftReports.filter { !$0.isOpen }
        let discrepancies = closed.filter { abs($0.cashDifference ?? 0) > 1 }

        // Выручка — главная цифра, открытые смены и расхождения — её
        // расшифровка.
        return Group {
            if !store.shiftReports.isEmpty {
                HeroSummary(
                    title: "Выручка за смены",
                    value: Money.format(store.shiftReports.reduce(0) { $0 + $1.totals.sales }),
                    caption: discrepancies.isEmpty
                        ? "касса везде сошлась"
                        : "\(discrepancies.count) \(pluralize(discrepancies.count, "смена", "смены", "смен")) с расхождением",
                    footer: [
                        ("Смен", "\(store.shiftReports.count)"),
                        ("Открыто сейчас", "\(open.count)"),
                        ("С расхождением", "\(discrepancies.count)"),
                    ],
                    colors: Theme.heroGradient
                )
                .padding(.horizontal, Spacing.lg)
                .padding(.vertical, Spacing.md)
            }
        }
    }
}

private struct ShiftReportRow: View {
    let shift: ShiftReport

    var body: some View {
        HStack(spacing: Spacing.md) {
            TintedIcon(
                systemName: shift.isOpen ? "play.fill" : "checkmark",
                tint: shift.isOpen ? Theme.info : Theme.positive
            )

            VStack(alignment: .leading, spacing: 2) {
                Text(shift.companyName ?? "Точка")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 2) {
                Text(Money.format(shift.totals.sales))
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(Theme.text)
                // Расхождение подписью под суммой: плашка теснила сумму.
                if let difference = shift.cashDifference, abs(difference) > 1 {
                    Text(Money.signed(difference))
                        .font(.system(size: 12, weight: .semibold))
                        .monospacedDigit()
                        .foregroundStyle(difference < 0 ? Theme.negative : Theme.warning)
                }
            }
        }
    }

    private var subtitle: String {
        var parts = [shift.typeLabel]
        if let opened = shift.openedAt {
            parts.append(opened.formatted(.dateTime.day().month(.abbreviated).hour().minute()))
        }
        parts.append("\(shift.totals.count) \(pluralize(shift.totals.count, "чек", "чека", "чеков"))")
        return parts.joined(separator: " · ")
    }
}

private struct ShiftReportDetail: View {
    let shift: ShiftReport

    @Environment(\.api) private var api
    @Environment(\.access) private var access
    @Environment(BusinessStore.self) private var store

    @State private var reopening = false
    @State private var reason = ""
    @State private var isBusy = false
    @State private var error: String?

    /// Право то же, что проверяет сервер.
    private var canReopen: Bool { access?.can("shifts-reports.reopen") ?? false }

    /// Переоткрыть можно только свежую закрытую смену. Правило то же, что на
    /// сервере: показывать кнопку там, где придёт отказ, — обманывать.
    private var isReopenable: Bool {
        guard !shift.isOpen, let closed = shift.closedAt else { return false }
        return Date().timeIntervalSince(closed) < 24 * 60 * 60
    }

    var body: some View {
        ScreenScroll {
            VStack(spacing: Spacing.lg) {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: Spacing.xs) {
                                Text(shift.companyName ?? "Точка")
                                    .font(Typography.title)
                                    .foregroundStyle(Theme.text)
                                Text(shift.typeLabel)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.textMuted)
                            }
                            Spacer()
                            StatusChip(shift.statusLabel, kind: shift.isOpen ? .info : .good)
                        }

                        RowDivider()
                        if let opened = shift.openedAt {
                            StatRow("Открыта", value: opened.formatted(.dateTime.day().month(.wide).hour().minute()), icon: "play")
                        }
                        if let closed = shift.closedAt {
                            StatRow("Закрыта", value: closed.formatted(.dateTime.day().month(.wide).hour().minute()), icon: "stop")
                        }
                        if shift.hasZReport {
                            StatRow("Z-отчёт", value: "сформирован", valueColor: Theme.positive, icon: "doc.text")
                        }
                    }
                }

                reopenCard

                // Продажи — главная цифра смены, способы оплаты — её состав.
                HeroSummary(
                    title: "Продажи за смену",
                    value: Money.format(shift.totals.sales),
                    footer: [
                        ("Наличные", Money.format(shift.totals.cash)),
                        ("Kaspi", Money.format(shift.totals.kaspi)),
                        ("Чеков", "\(shift.totals.count)"),
                    ],
                    colors: Theme.heroGradient
                )

                OwnerSection("Касса") {
                    VStack(spacing: Spacing.md) {
                        StatRow("На начало смены", value: Money.format(shift.openingCash), icon: "arrow.right.circle")
                        StatRow("Продано наличными", value: Money.format(shift.totals.cash), icon: "plus.circle")
                        RowDivider()
                        StatRow("Должно быть", value: Money.format(shift.openingCash + shift.totals.cash))
                        StatRow("Фактически", value: Money.format(shift.closingCash), emphasized: true)

                        if let difference = shift.cashDifference {
                            RowDivider()
                            StatRow(
                                difference < 0 ? "Недостача" : "Излишек",
                                value: Money.signed(difference),
                                valueColor: abs(difference) <= 1 ? Theme.positive : (difference < 0 ? Theme.negative : Theme.warning),
                                emphasized: true
                            )
                        } else {
                            // У открытой смены наличные ещё в обороте.
                            InlineEmpty(icon: "clock", text: "Расхождение считается после закрытия", tint: Theme.textDim)
                        }
                    }
                }
            }
        }

        .alert("Переоткрыть смену?", isPresented: $reopening) {
            TextField("Причина", text: $reason)
            Button("Переоткрыть") { Task { await reopen() } }
            Button("Отмена", role: .cancel) {}
        } message: {
            Text("Смена снова станет открытой: в неё можно будет добавить чек и поправить кассу. Причина уйдёт в журнал.")
        }
        .background(Theme.background)
        .navigationTitle("Смена")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
    /// Кнопка стоит внизу карточки смены, а не в панели: переоткрытие —
    /// исключение, а не обычное действие, и место у него соответствующее.
    @ViewBuilder
    private var reopenCard: some View {
        if canReopen, isReopenable {
            Card(accent: Theme.warning) {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    Text("Ошиблись при закрытии?")
                        .font(Typography.callout.weight(.medium))
                        .foregroundStyle(Theme.text)
                    Text("Смену можно переоткрыть в течение суток после закрытия — добавить забытый чек или поправить кассу. Дальше правки идут через отчёты.")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textMuted)
                        .fixedSize(horizontal: false, vertical: true)

                    if let error {
                        Text(error)
                            .font(Typography.caption)
                            .foregroundStyle(Theme.negative)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Button {
                        reopening = true
                    } label: {
                        if isBusy {
                            ProgressView().controlSize(.small)
                        } else {
                            Label("Переоткрыть смену", systemImage: "lock.open")
                        }
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(isBusy)
                }
            }
        }
    }

    private func reopen() async {
        let trimmed = reason.trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 3 else {
            error = "Причина обязательна: через месяц по журналу должно быть понятно, зачем смену открыли заново."
            return
        }

        isBusy = true
        error = nil
        defer { isBusy = false }

        do {
            try await BusinessService(api: api).reopenShift(id: shift.id, reason: trimmed)
            reason = ""
            await store.loadShiftReports()
        } catch let apiError as APIError {
            error = apiError.userMessage
        } catch {
            self.error = error.localizedDescription
        }
    }

}

// ── Дни рождения ─────────────────────────────────────────────────────────────

/// Ближайшие дни рождения команды.
struct BirthdaysScreen: View {
    @Environment(BusinessStore.self) private var store

    var body: some View {
        ScreenScroll {
            if let error = store.birthdaysError, store.birthdays == nil {
                ErrorStateView(error: error) { Task { await store.loadBirthdays() } }
            } else if let list = store.birthdays {
                content(list)
            } else {
                LoadingRows(count: 6)
            }
        }
        .background(Theme.background)
        .navigationTitle("Дни рождения")
        .toolbar { LogoutToolbarItem() }
        .task { await store.loadBirthdays() }
        .refreshable { await store.loadBirthdays() }
    }

    @ViewBuilder
    private func content(_ list: BirthdayList) -> some View {
        if list.items.isEmpty {
            WideEmptyState(
                icon: "gift",
                title: "Дат нет",
                message: list.withoutBirthDate > 0
                    ? "Ни у кого не заполнена дата рождения (\(list.withoutBirthDate) \(pluralize(list.withoutBirthDate, "человек", "человека", "человек")))."
                    : "Здесь появятся дни рождения команды."
            )
        } else {
            VStack(spacing: Spacing.lg) {
                if !list.today.isEmpty {
                    OwnerSection("Сегодня") {
                        Image(systemName: "gift.fill").foregroundStyle(Theme.brand)
                    } content: {
                        birthdayList(list.today)
                    }
                }

                if !list.thisWeek.isEmpty {
                    OwnerSection("На этой неделе") {
                        birthdayList(list.thisWeek)
                    }
                }

                OwnerSection("Дальше") {
                    let rest = list.items.filter { !$0.isThisWeek }
                    if rest.isEmpty {
                        InlineEmpty(icon: "calendar", text: "Больше дат в ближайший месяц нет", tint: Theme.textDim)
                    } else {
                        birthdayList(rest)
                    }
                }

                // Незаполненные даты — не ошибка, но поздравить их не выйдет.
                if list.withoutBirthDate > 0 {
                    Card {
                        InlineEmpty(
                            icon: "questionmark.circle",
                            text: "У \(list.withoutBirthDate) \(pluralize(list.withoutBirthDate, "человека", "человек", "человек")) дата не заполнена",
                            tint: Theme.textDim
                        )
                    }
                }
            }
        }
    }

    /// Люди строками с тонкими разделителями под текстом, а не под фото.
    private func birthdayList(_ people: [Birthday]) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(people.enumerated()), id: \.element.id) { index, person in
                if index > 0 { PlainRowDivider(inset: 48) }
                BirthdayRow(person: person)
                    .padding(.vertical, Spacing.sm)
            }
        }
    }
}

private struct BirthdayRow: View {
    let person: Birthday

    var body: some View {
        HStack(spacing: Spacing.md) {
            Thumbnail(
                url: person.photoURL,
                side: 36,
                cornerRadius: 18,
                fallbackText: person.initials
            )

            VStack(alignment: .leading, spacing: 1) {
                Text(person.name)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text([person.position, person.companyName].compactMap { $0 }.joined(separator: " · "))
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 1) {
                Text(person.whenLabel)
                    .font(Typography.callout.weight(.medium))
                    .foregroundStyle(person.isToday ? Theme.brand : Theme.textMuted)
                if let age = person.age {
                    Text("\(age) \(pluralize(age, "год", "года", "лет"))")
                        .font(Typography.caption)
                        .monospacedDigit()
                        .foregroundStyle(Theme.textDim)
                }
            }
        }
    }
}

// ── Общее ────────────────────────────────────────────────────────────────────

/// Тонкий разделитель с отступом под текст строки, а не под иконку — как в
/// выписке банка: иконки стоят столбиком, линия отделяет только подписи.
/// Общий для складских экранов этого модуля.
struct PlainRowDivider: View {
    var inset: CGFloat = 52

    var body: some View {
        Rectangle()
            .fill(Theme.borderSoft)
            .frame(height: 1)
            .padding(.leading, inset)
    }
}

/// Белая скруглённая подложка под список строк — как операции в банковском
/// приложении. Строки на сером фоне читались как текст, а не как список.
struct WhiteRowsCard<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(spacing: 0, content: content)
            .padding(.horizontal, Spacing.md)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }
}

/// Короткий статус цветным текстом — вместо широкой плашки там, где она
/// теснит сумму в строке.
struct StatusCaption: View {
    let text: String
    var tint: Color = Theme.textDim

    init(_ text: String, tint: Color = Theme.textDim) {
        self.text = text
        self.tint = tint
    }

    var body: some View {
        Text(text)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(tint)
            .lineLimit(1)
    }
}

/// Скелет списка на время загрузки.
struct LoadingRows: View {
    var count = 6

    var body: some View {
        VStack(spacing: Spacing.md) {
            ForEach(0..<count, id: \.self) { _ in
                Skeleton(height: 52, cornerRadius: Radius.md)
            }
        }
        .padding(Spacing.lg)
    }
}
