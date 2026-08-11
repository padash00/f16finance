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
                    ReceiptDetail(receipt: receipt)
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
            // Форма пока одна — приёмка от поставщика. Оприходование это
            // другой документ, без накладной и денег, и делать вид, что кнопка
            // ведёт туда же, нечестно.
            if canCreate, kind == .supplier {
                ToolbarItem(placement: .primaryAction) {
                    Button { isAdding = true } label: { Image(systemName: "plus") }
                }
            }
            LogoutToolbarItem()
        }
        .task { await store.loadReceipts() }
        .refreshable { await store.loadReceipts() }
        .sheet(isPresented: $isAdding) { AddReceiptSheet() }
    }

    private var summary: some View {
        let rows = ownKind
        let active = rows.filter { !$0.isCancelled }
        let expiring = rows.reduce(0) { $0 + $1.expiring.count }

        return Group {
            if !rows.isEmpty {
                HStack(spacing: Spacing.md) {
                    SummaryPill(title: kind.amountLabel, value: Money.format(active.reduce(0) { $0 + $1.totalAmount }), tint: Theme.brand)
                    SummaryPill(title: kind.countLabel, value: "\(active.count)", tint: Theme.textMuted)
                    if expiring > 0 {
                        SummaryPill(title: "Истекает срок", value: "\(expiring)", tint: Theme.warning)
                    }
                }
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
        HStack(spacing: Spacing.md) {
            Image(systemName: receipt.isCancelled ? "xmark.circle" : "arrow.down.circle.fill")
                .font(.system(size: 15))
                .foregroundStyle(receipt.isCancelled ? Theme.textDim : Theme.positive)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 1) {
                // У оприходования поставщика нет по определению — писать
                // «Без поставщика» на каждой строке значит кричать об
                // отсутствии того, чего там и не должно быть.
                Text(receipt.supplierName ?? (receipt.isPosting ? "Оприходование" : "Без поставщика"))
                    .font(Typography.callout)
                    .foregroundStyle(receipt.isCancelled ? Theme.textDim : Theme.text)
                    .strikethrough(receipt.isCancelled, color: Theme.textDim)
                    .lineLimit(1)
                Text(subtitle)
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 2) {
                Text(Money.format(receipt.totalAmount))
                    .font(Typography.callout.weight(.medium))
                    .monospacedDigit()
                    .foregroundStyle(receipt.isCancelled ? Theme.textDim : Theme.text)
                if !receipt.expiring.isEmpty {
                    StatusChip("\(receipt.expiring.count) истекает", kind: .warning)
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

                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        SectionHeader("Состав", subtitle: "\(receipt.items.count) позиций")
                        if receipt.items.isEmpty {
                            InlineEmpty(icon: "tray", text: "Позиции не указаны", tint: Theme.textDim)
                        } else {
                            ForEach(Array(receipt.items.enumerated()), id: \.element.id) { index, line in
                                if index > 0 { RowDivider() }
                                DocumentLineRow(line: line)
                            }
                        }
                    }
                }
            }
        }
        .background(Theme.background)
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
                    WriteoffDetail(writeoff: writeoff)
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

        return Group {
            if !active.isEmpty {
                HStack(spacing: Spacing.md) {
                    SummaryPill(
                        title: "Списано всего",
                        value: Money.format(active.reduce(0) { $0 + $1.totalAmount }),
                        tint: Theme.negative
                    )
                    if let top {
                        SummaryPill(title: top.key, value: Money.format(top.value), tint: Theme.warning)
                    }
                    SummaryPill(title: "Документов", value: "\(active.count)", tint: Theme.textMuted)
                }
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
            Image(systemName: "trash.circle.fill")
                .font(.system(size: 15))
                .foregroundStyle(writeoff.isCancelled ? Theme.textDim : Theme.negative)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 1) {
                Text(writeoff.reasonLabel)
                    .font(Typography.callout)
                    .foregroundStyle(writeoff.isCancelled ? Theme.textDim : Theme.text)
                    .strikethrough(writeoff.isCancelled, color: Theme.textDim)
                    .lineLimit(1)
                Text(subtitle)
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }

            Spacer(minLength: Spacing.sm)

            Text(Money.format(writeoff.totalAmount))
                .font(Typography.callout.weight(.medium))
                .monospacedDigit()
                .foregroundStyle(writeoff.isCancelled ? Theme.textDim : Theme.negative)
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

                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        SectionHeader("Состав", subtitle: "\(writeoff.items.count) позиций")
                        if writeoff.items.isEmpty {
                            InlineEmpty(icon: "tray", text: "Позиции не указаны", tint: Theme.textDim)
                        } else {
                            ForEach(Array(writeoff.items.enumerated()), id: \.element.id) { index, line in
                                if index > 0 { RowDivider() }
                                DocumentLineRow(line: line)
                            }
                        }
                    }
                }
            }
        }
        .background(Theme.background)
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
        HStack(spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: Spacing.xs) {
                    Text(line.name)
                        .font(Typography.callout)
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                    if line.isBonus {
                        StatusChip("бонус", kind: .info)
                    }
                }
                Text(detail)
                    .font(Typography.caption)
                    .monospacedDigit()
                    .foregroundStyle(line.expiresSoon ? Theme.warning : Theme.textDim)
                    .lineLimit(1)
            }

            Spacer(minLength: Spacing.sm)

            Text(Money.format(line.totalCost))
                .font(Typography.callout.weight(.medium))
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

        return Group {
            if !store.shiftReports.isEmpty {
                HStack(spacing: Spacing.md) {
                    SummaryPill(title: "Открыто сейчас", value: "\(open.count)", tint: open.isEmpty ? Theme.textDim : Theme.info)
                    SummaryPill(
                        title: "Выручка",
                        value: Money.format(store.shiftReports.reduce(0) { $0 + $1.totals.sales }),
                        tint: Theme.brand
                    )
                    SummaryPill(
                        title: "С расхождением",
                        value: "\(discrepancies.count)",
                        tint: discrepancies.isEmpty ? Theme.positive : Theme.warning
                    )
                }
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
            Image(systemName: shift.isOpen ? "play.circle.fill" : "checkmark.circle.fill")
                .font(.system(size: 15))
                .foregroundStyle(shift.isOpen ? Theme.info : Theme.positive)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 1) {
                Text(shift.companyName ?? "Точка")
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text(subtitle)
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 2) {
                Text(Money.format(shift.totals.sales))
                    .font(Typography.callout.weight(.medium))
                    .monospacedDigit()
                    .foregroundStyle(Theme.text)
                if let difference = shift.cashDifference, abs(difference) > 1 {
                    StatusChip(Money.signed(difference), kind: difference < 0 ? .danger : .warning)
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

                DashboardGrid {
                    MetricTile(
                        label: "Продажи",
                        value: Money.format(shift.totals.sales),
                        icon: "cart.fill",
                        accent: Theme.brand
                    )
                    MetricTile(
                        label: "Наличные",
                        value: Money.format(shift.totals.cash),
                        icon: "banknote.fill",
                        accent: Theme.info
                    )
                    MetricTile(
                        label: "Kaspi",
                        value: Money.format(shift.totals.kaspi),
                        icon: "creditcard.fill",
                        accent: Theme.textMuted
                    )
                    MetricTile(
                        label: "Чеков",
                        value: "\(shift.totals.count)",
                        icon: "number",
                        accent: Theme.textMuted
                    )
                }

                Card {
                    VStack(spacing: Spacing.md) {
                        SectionHeader("Касса")
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
        .background(Theme.background)
        .navigationTitle("Смена")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
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
                    Card(accent: Theme.brand) {
                        VStack(alignment: .leading, spacing: Spacing.md) {
                            SectionHeader("Сегодня")
                            ForEach(Array(list.today.enumerated()), id: \.element.id) { index, person in
                                if index > 0 { RowDivider() }
                                BirthdayRow(person: person)
                            }
                        }
                    }
                }

                if !list.thisWeek.isEmpty {
                    Card {
                        VStack(alignment: .leading, spacing: Spacing.md) {
                            SectionHeader("На этой неделе")
                            ForEach(Array(list.thisWeek.enumerated()), id: \.element.id) { index, person in
                                if index > 0 { RowDivider() }
                                BirthdayRow(person: person)
                            }
                        }
                    }
                }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        SectionHeader("Дальше")
                        let rest = list.items.filter { !$0.isThisWeek }
                        if rest.isEmpty {
                            InlineEmpty(icon: "calendar", text: "Больше дат в ближайший месяц нет", tint: Theme.textDim)
                        } else {
                            ForEach(Array(rest.enumerated()), id: \.element.id) { index, person in
                                if index > 0 { RowDivider() }
                                BirthdayRow(person: person)
                            }
                        }
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
