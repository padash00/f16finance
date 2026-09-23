import OrdaKit
import OrdaUI
import SwiftUI

/// Деньги по административному сотруднику: выплата, премия, штраф, аванс,
/// доп. выход.
///
/// Оклады считаются в приложении с недавних пор, но платить всё равно надо
/// было идти на сайт: ведомость показывала долг и молчала о том, как его
/// закрыть. Документ, который нельзя провести с того же экрана, где его
/// смотрят, — половина работы.
///
/// Та же карточка, что у оператора: остаток к выплате крупно, круглые кнопки
/// действий, расчёт половины месяца строками. Каждое действие — своя форма.
struct StaffSalarySheet: View {
    let row: StaffSalaryRow
    var onDone: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.api) private var api
    @Environment(AuthStore.self) private var auth

    @State private var opened: SalaryAction?

    private func can(_ capability: String) -> Bool { auth.resolver?.can(capability) ?? false }

    /// Половина месяца, которую закрывает выплата. Пусто — обе уже закрыты.
    private var slot: String? { row.openSlot }

    private var actions: [SalaryAction] {
        var result: [SalaryAction] = []
        if can("salary.create_payment"), slot != nil {
            result.append(SalaryAction(
                id: "payment", title: "Выплатить", icon: "banknote.fill",
                action: "Выплатить",
                note: "Выплата станет расходом точки и закроет корректировки этой половины месяца.",
                money: .split, point: .required,
                prefill: max(row.toPay, 0),
                overpayLimit: row.toPay
            ))
        }
        if can("salary.create_adjustment") {
            result.append(SalaryAction(
                id: "advance", title: "Аванс", icon: "arrow.up.forward.circle.fill",
                action: "Выдать аванс",
                note: "Аванс сразу станет расходом точки и уменьшит остаток к выплате.",
                money: .single, point: .required
            ))
            result.append(SalaryAction(
                id: "bonus", title: "Премия", icon: "gift.fill",
                action: "Начислить премию",
                note: "Премия прибавится к расчёту половины месяца.",
                money: .single, point: .none
            ))
            result.append(SalaryAction(
                id: "fine", title: "Штраф", icon: "exclamationmark.octagon.fill",
                action: "Удержать штраф",
                note: "Штраф вычтется из расчёта половины месяца.",
                money: .single, point: .none
            ))
        }
        if can("staff.add_extra_day") {
            result.append(SalaryAction(
                id: "extraDay", title: "Доп. выход", icon: "calendar.badge.plus",
                action: "Записать доп. выход",
                note: "Оклад платят за месяц, а выход сверх нормы — отдельные деньги. Сумму возьмём из ставки смены на его точке; своя нужна редко.",
                money: .optional, point: .none
            ))
        }
        return result
    }

    var body: some View {
        NavigationStack {
            ScreenScroll {
                SalaryPersonHeader(name: row.name, subtitle: subtitle)

                SalaryBalanceCard(
                    title: slot == nil ? "Месяц закрыт" : "К выплате за \(slotTitle)",
                    remaining: slot == nil ? 0 : max(row.toPay, 0),
                    total: slot == nil ? row.paidThisMonth : row.paidThisMonth + max(row.toPay, 0),
                    paid: row.paidThisMonth,
                    footer: row.monthlySalary > 0
                        ? [("Оклад", Money.format(row.monthlySalary)), ("Половина", Money.format(row.half))]
                        : []
                )

                if !actions.isEmpty {
                    SalaryActionRow(actions: actions) { opened = $0 }
                }

                SalaryBreakdown(title: "Расчёт половины месяца", lines: lines)

                if !row.extraDays.isEmpty {
                    extraDays
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
                SalaryActionForm(action: action, personName: row.name) { values in
                    try await submit(action, values)
                    opened = nil
                    await onDone()
                    dismiss()
                }
            }
        }
    }

    private var slotTitle: String {
        slot == "second" ? "вторую половину" : "первую половину"
    }

    private var subtitle: String {
        var parts: [String] = []
        if let role = row.role, !role.isEmpty { parts.append(Self.roleTitle(role)) }
        if !row.isActive, let date = row.dismissalDate { parts.append("уволен \(date)") }
        return parts.isEmpty ? "оклад" : parts.joined(separator: " · ")
    }

    /// Должность так, как её называют на сайте; свою — как есть.
    private static func roleTitle(_ role: String) -> String {
        switch role {
        case "owner": "Владелец"
        case "manager": "Управляющий"
        case "marketer": "Маркетолог"
        case "accountant": "Бухгалтер"
        case "senior_operator": "Старший оператор"
        case "senior_cashier": "Старший кассир"
        case "operator": "Оператор"
        case "other": "Сотрудник"
        default: role.replacingOccurrences(of: "_", with: " ")
        }
    }

    private var lines: [SalaryLine] {
        var result = [SalaryLine(label: "Половина оклада", value: row.half, sign: .plain)]
        if row.bonuses > 0 { result.append(SalaryLine(label: "Премии", value: row.bonuses, sign: .plus)) }
        if row.fines > 0 { result.append(SalaryLine(label: "Штрафы", value: row.fines, sign: .minus)) }
        if row.debts > 0 { result.append(SalaryLine(label: "Долги", value: row.debts, sign: .minus)) }
        if row.advances > 0 { result.append(SalaryLine(label: "Авансы", value: row.advances, sign: .minus)) }
        result.append(SalaryLine(label: "К выплате", value: row.toPay, sign: .total))
        if row.paidThisMonth > 0 { result.append(SalaryLine(label: "Выплачено за месяц", value: row.paidThisMonth, sign: .plain)) }
        return result
    }

    private var extraDays: some View {
        OwnerSection("Доп. выходы") {
            Text("\(row.extraDays.count)")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textDim)
        } content: {
            VStack(spacing: 0) {
                ForEach(Array(row.extraDays.enumerated()), id: \.element.id) { index, day in
                    if index > 0 { Rectangle().fill(Theme.borderSoft).frame(height: 1).padding(.leading, 52) }
                    HStack(spacing: Spacing.md) {
                        TintedIcon(systemName: "calendar.badge.plus", tint: Theme.brand, size: 40, corner: 12)
                        Text(day.shortLabel)
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(Theme.text)
                        Spacer()
                        Text("+" + Money.format(day.amount))
                            .font(.system(size: 15, weight: .semibold, design: .rounded))
                            .monospacedDigit()
                            .foregroundStyle(Theme.positive)
                    }
                    .padding(.vertical, 10)
                }
            }
        }
    }

    // ── Отправка ─────────────────────────────────────────────────────────────

    private func submit(_ action: SalaryAction, _ values: SalaryFormValues) async throws {
        let service = BusinessService(api: api)
        switch action.id {
        case "payment":
            guard let slot else { return }
            try await service.payStaffSalary(
                staffID: row.id,
                companyID: values.companyID ?? "",
                payDate: values.date,
                slot: slot,
                cashAmount: values.cash,
                kaspiAmount: values.kaspi,
                expectedAmount: row.toPay,
                comment: values.comment
            )
        case "extraDay":
            try await service.addStaffExtraDay(
                staffID: row.id,
                date: values.date,
                amount: values.amount > 0 ? values.amount : nil
            )
        default:
            try await service.createStaffAdjustment(
                staffID: row.id,
                companyID: action.id == "advance" ? values.companyID : nil,
                kind: action.id,
                amount: values.amount,
                date: values.date,
                comment: values.comment
            )
        }
    }
}
