import OrdaKit
import OrdaUI
import SwiftUI

/// Деньги по оператору за неделю: выплата, аванс, премия, штраф, долг.
///
/// Все эти решения принимают у стойки, посреди смены, а сделать их можно
/// было только на сайте — то есть «вечером, когда дойду до компьютера».
/// Премия, назначенная через два дня, уже не работает как премия.
///
/// Карточка как счёт в банке: сверху сколько осталось выплатить, под ним
/// круглые кнопки действий, расчёт недели строками и история с отменой.
/// Каждое действие — своя форма, а не общий лист с переключателем.
struct AdvanceSheet: View {
    let row: SalaryRow
    let weekStart: String
    /// Конец недели: расчёт отправляется за период, а не за день.
    let weekEnd: String
    var onDone: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.api) private var api
    @Environment(AuthStore.self) private var auth

    @State private var opened: SalaryAction?
    @State private var voidPaymentTarget: SalaryRow.Week.Payment?
    @State private var voidAdjustmentTarget: SalaryRow.Week.Adjustment?
    @State private var isWorking = false
    @State private var error: String?
    @State private var notice: String?

    private func can(_ capability: String) -> Bool { auth.resolver?.can(capability) ?? false }

    private var week: SalaryRow.Week { row.week }

    // ── Действия ─────────────────────────────────────────────────────────────

    private var actions: [SalaryAction] {
        var result: [SalaryAction] = []
        if can("salary.create_payment") {
            result.append(SalaryAction(
                id: "payment", title: "Выплатить", icon: "banknote.fill",
                action: "Выплатить",
                note: "Выплата закроет неделю. Выданный аванс зачтётся в неё, а не повиснет отдельным долгом.",
                money: .split, point: .none,
                prefill: max(week.remainingAmount, 0)
            ))
        }
        if can("salary.create_advance") {
            result.append(SalaryAction(
                id: "advance", title: "Аванс", icon: "arrow.up.forward.circle.fill",
                action: "Выдать аванс",
                note: "Аванс сразу станет расходом точки и уменьшит остаток к выплате за неделю.",
                money: .split, point: .required
            ))
        }
        if can("salary.create_adjustment") {
            result.append(SalaryAction(
                id: "bonus", title: "Премия", icon: "gift.fill",
                action: "Начислить премию",
                note: "Премия прибавится к расчёту недели.",
                money: .single, point: .optional
            ))
            result.append(SalaryAction(
                id: "fine", title: "Штраф", icon: "exclamationmark.octagon.fill",
                action: "Удержать штраф",
                note: "Штраф вычтется из расчёта недели.",
                money: .single, point: .optional
            ))
        }
        return result
    }

    var body: some View {
        NavigationStack {
            ScreenScroll {
                SalaryPersonHeader(name: row.operatorName, subtitle: "\(weekTitle) · \(week.statusLabel.lowercased())")

                SalaryBalanceCard(
                    title: "Осталось выплатить",
                    remaining: max(week.remainingAmount, 0),
                    total: week.netAmount,
                    paid: week.paidAmount,
                    footer: [
                        ("К выплате", Money.format(week.netAmount)),
                        ("Смен", "\(week.shiftsCount)"),
                    ]
                )

                if !actions.isEmpty {
                    SalaryActionRow(actions: actions) { opened = $0 }
                }

                if let notice {
                    Label(notice, systemImage: "checkmark.circle.fill")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Theme.positive)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                if week.debtAmount > 0, can("salary.mark_debt_paid") {
                    debtCard
                }

                SalaryBreakdown(title: "Расчёт недели", lines: lines)

                if !events.isEmpty {
                    SalaryHistory(events: events, error: error)
                } else if let error {
                    Text(error)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.negative)
                }

                if can("salary.send_telegram") {
                    telegramRow
                }
            }
            .background(Theme.background)
            .navigationTitle("Зарплата")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Закрыть") { dismiss() }
                }
            }
            #if DEBUG
            .task {
                // Снимки экрана: `-ordaSalaryAction payment|advance|bonus|fine`.
                if let id = UserDefaults.standard.string(forKey: "ordaSalaryAction") {
                    try? await Task.sleep(for: .milliseconds(500))
                    opened = actions.first { $0.id == id }
                }
            }
            #endif
            .navigationDestination(item: $opened) { action in
                SalaryActionForm(action: action, personName: row.operatorName) { values in
                    try await submit(action, values)
                    opened = nil
                    await onDone()
                    dismiss()
                }
            }
            // Откат выплаты — деньги уже отданы человеку. Спрашиваем прежде,
            // чем менять расчёт недели.
            .confirmationDialog(
                "Отменить выплату?",
                isPresented: Binding(get: { voidPaymentTarget != nil }, set: { if !$0 { voidPaymentTarget = nil } }),
                titleVisibility: .visible
            ) {
                if let payment = voidPaymentTarget {
                    Button("Отменить \(Money.format(payment.total))", role: .destructive) {
                        Task { await voidPayment(payment) }
                    }
                }
                Button("Оставить", role: .cancel) { voidPaymentTarget = nil }
            } message: {
                Text("Сумма вернётся в остаток к выплате. Деньги, отданные человеку, программа вернуть не может — это делаете вы.")
            }
            .confirmationDialog(
                "Отменить корректировку?",
                isPresented: Binding(get: { voidAdjustmentTarget != nil }, set: { if !$0 { voidAdjustmentTarget = nil } }),
                titleVisibility: .visible
            ) {
                if let adjustment = voidAdjustmentTarget {
                    Button("Отменить: \(adjustment.kindLabel.lowercased()) \(Money.format(adjustment.amount))", role: .destructive) {
                        Task { await voidAdjustment(adjustment) }
                    }
                }
                Button("Оставить", role: .cancel) { voidAdjustmentTarget = nil }
            } message: {
                Text("Расчёт недели пересчитается. Запись останется в истории как отменённая.")
            }
        }
    }

    private var weekTitle: String {
        "неделя \(DateFormatting.dayMonth(weekStart)) — \(DateFormatting.dayMonth(weekEnd))"
    }

    // ── Расчёт ───────────────────────────────────────────────────────────────

    private var lines: [SalaryLine] {
        var result = [SalaryLine(label: "Начислено за смены", value: week.grossAmount, sign: .plain)]
        if week.bonusAmount > 0 { result.append(SalaryLine(label: "Премии", value: week.bonusAmount, sign: .plus)) }
        if week.fineAmount > 0 { result.append(SalaryLine(label: "Штрафы", value: week.fineAmount, sign: .minus)) }
        if week.debtAmount > 0 { result.append(SalaryLine(label: "Долги", value: week.debtAmount, sign: .minus)) }
        if week.advanceAmount > 0 { result.append(SalaryLine(label: "Авансы", value: week.advanceAmount, sign: .minus)) }
        result.append(SalaryLine(label: "К выплате", value: week.netAmount, sign: .total))
        if week.paidAmount > 0 { result.append(SalaryLine(label: "Выплачено", value: week.paidAmount, sign: .minus)) }
        return result
    }

    // ── История ──────────────────────────────────────────────────────────────

    private var events: [SalaryEvent] {
        let canVoidPayment = can("salary.void_payment")
        let canVoidAdjustment = can("salary.void_adjustment")
        let payments = week.payments.map { payment in
            SalaryEvent(
                id: "p." + payment.id,
                date: payment.date,
                title: "Выплата",
                detail: payment.comment,
                amount: payment.total,
                isAddition: false,
                icon: "banknote.fill",
                tint: Theme.brand,
                isVoided: !payment.isActive,
                onVoid: payment.isActive && canVoidPayment ? { voidPaymentTarget = payment } : nil
            )
        }
        let adjustments = week.adjustments.map { adjustment in
            SalaryEvent(
                id: "a." + adjustment.id,
                date: adjustment.date,
                title: adjustment.kindLabel,
                detail: adjustment.comment,
                amount: adjustment.amount,
                isAddition: adjustment.isAddition,
                icon: Self.icon(for: adjustment.kind),
                tint: adjustment.isAddition ? Theme.positive : (adjustment.kind == "advance" ? Theme.warning : Theme.negative),
                isVoided: !adjustment.isActive,
                onVoid: adjustment.isActive && canVoidAdjustment ? { voidAdjustmentTarget = adjustment } : nil
            )
        }
        return (payments + adjustments).sorted { $0.date > $1.date }
    }

    private static func icon(for kind: String) -> String {
        switch kind {
        case "bonus": "gift.fill"
        case "fine": "exclamationmark.octagon.fill"
        case "debt": "creditcard.trianglebadge.exclamationmark"
        case "advance": "arrow.up.forward.circle.fill"
        default: "plusminus.circle.fill"
        }
    }

    // ── Долг и расчётный лист ────────────────────────────────────────────────

    /// Долг относится к неделе целиком, а не к сумме в поле, — поэтому
    /// отдельной карточкой, а не ещё одним действием.
    private var debtCard: some View {
        HStack(spacing: Spacing.md) {
            TintedIcon(systemName: "creditcard.trianglebadge.exclamationmark", tint: Theme.warning, size: 42)
            VStack(alignment: .leading, spacing: 2) {
                Text("Долг \(Money.format(week.debtAmount))")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Theme.text)
                Text("Отмечайте, только когда деньги вернули")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
            }
            Spacer(minLength: Spacing.sm)
            Button("Погашен") { Task { await markDebtPaid() } }
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(Theme.brand, in: Capsule())
                .disabled(isWorking)
        }
        .padding(Spacing.lg)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
    }

    private var telegramRow: some View {
        Button {
            Task { await sendPayslip() }
        } label: {
            HStack(spacing: Spacing.md) {
                TintedIcon(systemName: "paperplane.fill", tint: Color(hex: 0x0284C7), size: 42)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Отправить расчёт в Telegram")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(Theme.text)
                    Text("смены, надбавки, удержания и итог")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textDim)
                }
                Spacer(minLength: Spacing.sm)
                if isWorking {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.textDim)
                }
            }
            .padding(Spacing.lg)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
        }
        .buttonStyle(.pressable)
        .disabled(isWorking)
    }

    // ── Отправка ─────────────────────────────────────────────────────────────

    private func submit(_ action: SalaryAction, _ values: SalaryFormValues) async throws {
        let service = BusinessService(api: api)
        switch action.id {
        case "payment":
            try await service.paySalaryWeek(
                operatorID: row.operatorID,
                weekStart: weekStart,
                paymentDate: values.date,
                cashAmount: values.cash,
                kaspiAmount: values.kaspi,
                comment: values.comment,
                // Аванс за эту неделю закрываем той же выплатой: иначе он
                // останется висеть отдельным долгом, хотя деньги отданы.
                withAdvance: week.advanceAmount > 0
            )
        case "advance":
            try await service.createSalaryAdvance(
                operatorID: row.operatorID,
                companyID: values.companyID ?? "",
                weekStart: weekStart,
                paymentDate: values.date,
                cashAmount: values.cash,
                kaspiAmount: values.kaspi,
                comment: values.comment
            )
        default:
            try await service.createSalaryAdjustment(
                operatorID: row.operatorID,
                companyID: values.companyID,
                date: values.date,
                amount: values.amount,
                kind: action.id,
                comment: values.comment
            )
        }
    }

    private func voidPayment(_ payment: SalaryRow.Week.Payment) async {
        await run {
            try await BusinessService(api: api).voidSalaryPayment(
                paymentID: payment.id,
                operatorID: row.operatorID,
                weekStart: weekStart
            )
            await onDone()
            dismiss()
        }
    }

    private func voidAdjustment(_ adjustment: SalaryRow.Week.Adjustment) async {
        await run {
            try await BusinessService(api: api).voidSalaryAdjustment(
                adjustmentID: adjustment.id,
                operatorID: row.operatorID,
                weekStart: weekStart
            )
            await onDone()
            dismiss()
        }
    }

    private func markDebtPaid() async {
        await run {
            try await BusinessService(api: api).markOperatorDebtsPaid(operatorID: row.operatorID, weekStart: weekStart)
            await onDone()
            dismiss()
        }
    }

    private func sendPayslip() async {
        await run {
            try await BusinessService(api: api).sendSalaryToTelegram(
                operatorID: row.operatorID,
                weekStart: weekStart,
                weekEnd: weekEnd
            )
            notice = "Расчёт отправлен в Telegram"
        }
    }

    private func run(_ work: () async throws -> Void) async {
        isWorking = true
        defer { isWorking = false }
        error = nil
        do {
            try await work()
            Haptics.success()
        } catch let apiError as APIError {
            error = apiError.userMessage
            Haptics.error()
        } catch {
            self.error = error.localizedDescription
            Haptics.error()
        }
    }
}
