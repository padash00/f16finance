import OrdaKit
import OrdaUI
import SwiftUI

/// Состав акта ревизии: что пересчитано, где расхождение, до чего не дошли.
///
/// Приложение знало только счётчик «12 из 40». По нему нельзя ни поправить
/// количество, ни понять, где именно разошлось, — а выясняется это стоя у
/// полки, с телефоном в руке.
///
/// Порядок строк — по деньгам: сначала расхождения, которые дороже всего
/// стоят. Недостача на десять тысяч важнее, чем на сто, и искать её надо
/// первой.
struct RevisionActScreen: View {
    let act: RevisionAct

    @Environment(\.api) private var api
    @Environment(\.access) private var access
    @Environment(\.dismiss) private var dismiss

    @State private var detail: RevisionActDetail?
    @State private var isLoading = false
    @State private var error: APIError?

    @State private var editingLine: RevisionActDetail.Line?
    @State private var editingPending: RevisionActDetail.Pending?
    @State private var quantity = ""
    @State private var isSaving = false
    @State private var saveError: String?

    private var canEdit: Bool { (access?.can("store-revisions.edit") ?? false) && act.isOpen }

    var body: some View {
        NavigationStack {
            ScreenScroll {
                if let error {
                    ErrorStateView(error: error) { Task { await load() } }
                } else if isLoading && detail == nil {
                    LoadingRows(count: 5)
                } else if let detail {
                    progressCard(detail)
                    if !detail.report.isEmpty { reportCard(detail) }
                    if !detail.uncounted.isEmpty { pendingCard(detail) }
                }
            }
            .background(Theme.background)
            .navigationTitle("Состав акта")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Готово") { dismiss() } }
            }
            .task { await load() }
            .refreshable { await load() }
            .alert("Сколько на полке", isPresented: Binding(
                get: { editingLine != nil || editingPending != nil },
                set: { if !$0 { editingLine = nil; editingPending = nil } }
            )) {
                TextField("Количество", text: $quantity)
                    #if os(iOS)
                    .keyboardType(.decimalPad)
                    #endif
                Button("Записать") { Task { await save() } }
                Button("Отмена", role: .cancel) {
                    editingLine = nil
                    editingPending = nil
                }
            } message: {
                Text(editMessage)
            }
            .alert("Не удалось", isPresented: Binding(get: { saveError != nil }, set: { if !$0 { saveError = nil } })) {
                Button("Понятно", role: .cancel) { saveError = nil }
            } message: {
                Text(saveError ?? "")
            }
        }
    }

    private var editMessage: String {
        if let line = editingLine {
            return "\(line.name). Числится \(Quantity.format(line.expected)), насчитали \(Quantity.format(line.counted)). Новое число заменит прежние подсчёты."
        }
        if let pending = editingPending {
            return "\(pending.name). Числится \(Quantity.format(pending.expected)). Введите, сколько лежит на самом деле."
        }
        return ""
    }

    // ── Ход пересчёта ────────────────────────────────────────────────────────

    private func progressCard(_ detail: RevisionActDetail) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                SectionHeader(act.locationName, subtitle: act.statusLabel)
                HStack {
                    Text("Пересчитано")
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textDim)
                    Spacer()
                    Text("\(detail.countedItems) из \(detail.totalItems)")
                        .font(Typography.callout.weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(Theme.text)
                }
                if !act.isOpen {
                    Text("Акт закрыт — количества уже не меняются.")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                }
            }
        }
    }

    // ── Расхождения ──────────────────────────────────────────────────────────

    /// Сначала дорогие расхождения, потом дешёвые, потом совпавшие.
    private func sortedReport(_ detail: RevisionActDetail) -> [RevisionActDetail.Line] {
        detail.report.sorted { left, right in
            if left.conflict != right.conflict { return left.conflict }
            return abs(left.varianceCost) > abs(right.varianceCost)
        }
    }

    private func reportCard(_ detail: RevisionActDetail) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                SectionHeader("Пересчитано", subtitle: "\(detail.report.count)")
                ForEach(sortedReport(detail)) { line in
                    lineRow(line)
                    if line.id != sortedReport(detail).last?.id { RowDivider() }
                }
            }
        }
    }

    private func lineRow(_ line: RevisionActDetail.Line) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
            VStack(alignment: .leading, spacing: 1) {
                Text(line.name)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .lineLimit(2)

                HStack(spacing: Spacing.xs) {
                    Text("числится \(Quantity.format(line.expected)) · насчитали \(Quantity.format(line.counted))")
                    if let by = line.countedBy, !by.isEmpty { Text("· \(by)") }
                }
                .font(Typography.caption)
                .foregroundStyle(Theme.textDim)

                if line.conflict {
                    // Двое насчитали разное — тут нужен человек, а не арифметика.
                    Text("Считали дважды и получили разное — решите, сколько записать")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.warning)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 1) {
                Text(varianceText(line.variance))
                    .font(Typography.callout.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(varianceTint(line.variance))
                if line.variance != 0, line.purchasePrice > 0 {
                    Text(Money.format(abs(line.varianceCost)))
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                }
            }

            if canEdit {
                Button {
                    quantity = Quantity.format(line.counted)
                    editingLine = line
                } label: {
                    Image(systemName: "pencil").foregroundStyle(Theme.brand)
                }
                .buttonStyle(.plain)
                .disabled(isSaving)
            }
        }
        .padding(.vertical, 2)
    }

    private func varianceText(_ value: Double) -> String {
        if value == 0 { return "сходится" }
        return value > 0 ? "+\(Quantity.format(value))" : "−\(Quantity.format(abs(value)))"
    }

    private func varianceTint(_ value: Double) -> Color {
        if value == 0 { return Theme.textDim }
        return value > 0 ? Theme.info : Theme.warning
    }

    // ── Непосчитанное ────────────────────────────────────────────────────────

    private func pendingCard(_ detail: RevisionActDetail) -> some View {
        Card(accent: Theme.warning) {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                SectionHeader("Ещё не считали", subtitle: "\(detail.uncounted.count)")
                Text("Если провести ревизию сейчас, эти позиции спишутся в ноль.")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
                    .fixedSize(horizontal: false, vertical: true)

                ForEach(detail.uncounted) { pending in
                    HStack(spacing: Spacing.sm) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(pending.name)
                                .font(Typography.callout)
                                .foregroundStyle(Theme.text)
                                .lineLimit(2)
                            Text("числится \(Quantity.format(pending.expected))")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textDim)
                        }
                        Spacer(minLength: Spacing.sm)
                        if canEdit {
                            Button {
                                quantity = Quantity.format(pending.expected)
                                editingPending = pending
                            } label: {
                                Text("Посчитать")
                                    .font(Typography.caption.weight(.medium))
                                    .foregroundStyle(Theme.brand)
                            }
                            .buttonStyle(.plain)
                            .disabled(isSaving)
                        }
                    }
                    if pending.id != detail.uncounted.last?.id { RowDivider() }
                }
            }
        }
    }

    // ── Загрузка и запись ────────────────────────────────────────────────────

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            detail = try await BusinessService(api: api).auditActDetail(id: act.id)
            error = nil
        } catch let apiError as APIError {
            error = apiError
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }

    private func save() async {
        let itemID = editingLine?.itemID ?? editingPending?.itemID
        guard let itemID else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            try await BusinessService(api: api).recountAuditItem(
                actID: act.id,
                itemID: itemID,
                quantity: AmountParsing.value(quantity)
            )
            editingLine = nil
            editingPending = nil
            Haptics.success()
            await load()
        } catch let apiError as APIError {
            saveError = apiError.userMessage
            Haptics.error()
        } catch {
            saveError = error.localizedDescription
            Haptics.error()
        }
    }
}
