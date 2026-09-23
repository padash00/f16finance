import OrdaKit
import OrdaUI
import SwiftUI

// ── Карточка человека в зарплате ─────────────────────────────────────────────
//
// Как счёт в банковском приложении: сверху остаток к выплате крупно, под ним
// круглые кнопки действий, дальше расчёт строками и история операций.
// Действие открывает отдельную форму — одну на вид, а не общий лист с
// переключателем, где половина полей к делу не относится.

/// Что можно сделать с деньгами человека.
struct SalaryAction: Identifiable, Hashable {
    enum Money: Hashable {
        /// Наличные и Kaspi — деньги уходят из кассы.
        case split
        /// Одно число — начисление или удержание.
        case single
        /// Сумма необязательна: её знает сервер.
        case optional
    }

    enum Point: Hashable {
        case none, optional, required
    }

    let id: String
    let title: String
    let icon: String
    /// Подпись кнопки в форме: «Выдать аванс».
    let action: String
    /// Что произойдёт — одной фразой под кнопкой.
    let note: String
    let money: Money
    let point: Point
    /// Сумма, с которой открывается форма (остаток к выплате).
    var prefill: Double = 0
    /// Предупреждение, если сумма больше расчёта.
    var overpayLimit: Double?
}

/// Что ввели в форме.
struct SalaryFormValues {
    var cash: Double
    var kaspi: Double
    var amount: Double
    var companyID: String?
    var date: String
    var comment: String

    var splitTotal: Double { cash + kaspi }
}

/// Шапка: инициалы, имя, подпись.
struct SalaryPersonHeader: View {
    let name: String
    let subtitle: String

    var body: some View {
        HStack(spacing: Spacing.md) {
            Text(initials)
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .frame(width: 52, height: 52)
                .background(
                    LinearGradient(colors: Theme.heroAccent, startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: Circle()
                )
            VStack(alignment: .leading, spacing: 2) {
                Text(name)
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(Theme.text)
                    .lineLimit(2)
                Text(subtitle)
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textDim)
            }
            Spacer(minLength: 0)
        }
    }

    private var initials: String {
        let letters = name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined()
        return letters.isEmpty ? "?" : letters.uppercased()
    }
}

/// Главная карточка: сколько осталось выплатить и сколько уже выплачено.
struct SalaryBalanceCard: View {
    let title: String
    let remaining: Double
    let total: Double
    let paid: Double
    let footer: [(String, String)]

    var body: some View {
        let share = total > 0 ? min(max(paid / total, 0), 1) : 0
        VStack(alignment: .leading, spacing: 0) {
            Text(title)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(.white.opacity(0.85))
            Text(OrdaKit.Money.format(remaining))
                .font(.system(size: 38, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(.white)
                .contentTransition(.numericText())
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .padding(.top, Spacing.xs)

            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(.white.opacity(0.18))
                    Capsule().fill(.white).frame(width: proxy.size.width * share)
                }
            }
            .frame(height: 6)
            .padding(.top, Spacing.md)

            Text(paid > 0 ? "выплачено \(OrdaKit.Money.format(paid)) из \(OrdaKit.Money.format(total))" : "ещё ничего не выплачено")
                .font(.system(size: 13))
                .foregroundStyle(.white.opacity(0.7))
                .padding(.top, Spacing.sm)

            if !footer.isEmpty {
                HStack(spacing: Spacing.xl) {
                    ForEach(footer, id: \.0) { label, value in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(label)
                                .font(.system(size: 13))
                                .foregroundStyle(.white.opacity(0.65))
                            Text(value)
                                .font(.system(size: 16, weight: .semibold, design: .rounded))
                                .monospacedDigit()
                                .foregroundStyle(.white)
                        }
                    }
                }
                .padding(.top, Spacing.lg)
            }
        }
        .padding(Spacing.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(colors: Theme.heroGradient, startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: Radius.xl, style: .continuous)
        )
    }
}

/// Строка расчёта: «Премии +3 000 ₸».
struct SalaryLine: Identifiable {
    enum Sign { case plus, minus, total, plain }
    let label: String
    let value: Double
    let sign: Sign
    var id: String { label }
}

struct SalaryBreakdown: View {
    let title: String
    let lines: [SalaryLine]

    var body: some View {
        OwnerSection(title) {
            EmptyView()
        } content: {
            VStack(spacing: 0) {
                ForEach(Array(lines.enumerated()), id: \.element.id) { index, line in
                    if line.sign == .total {
                        Rectangle().fill(Theme.border).frame(height: 1).padding(.vertical, 4)
                    } else if index > 0 {
                        Rectangle().fill(Theme.borderSoft).frame(height: 1)
                    }
                    HStack {
                        Text(line.label)
                            .font(.system(size: 15, weight: line.sign == .total ? .semibold : .regular))
                            .foregroundStyle(line.sign == .total ? Theme.text : Theme.textMuted)
                        Spacer()
                        Text(text(line))
                            .font(.system(size: 15, weight: line.sign == .total ? .bold : .medium, design: .rounded))
                            .monospacedDigit()
                            .foregroundStyle(color(line))
                    }
                    .padding(.vertical, 11)
                }
            }
        }
    }

    private func text(_ line: SalaryLine) -> String {
        switch line.sign {
        case .plus: "+" + OrdaKit.Money.format(line.value)
        case .minus: "−" + OrdaKit.Money.format(line.value)
        case .total, .plain: OrdaKit.Money.format(line.value)
        }
    }

    private func color(_ line: SalaryLine) -> Color {
        switch line.sign {
        case .plus: Theme.positive
        case .minus: Theme.negative
        case .total, .plain: Theme.text
        }
    }
}

/// Событие в истории: выплата, премия, штраф — с отменой.
struct SalaryEvent: Identifiable {
    let id: String
    let date: String
    let title: String
    let detail: String?
    let amount: Double
    let isAddition: Bool
    let icon: String
    let tint: Color
    let isVoided: Bool
    /// `nil` — отменить нельзя (нет права или уже отменено).
    let onVoid: (() -> Void)?
}

struct SalaryHistory: View {
    let events: [SalaryEvent]
    var error: String?

    var body: some View {
        OwnerSection("История") {
            Text("\(events.count)")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textDim)
        } content: {
            VStack(spacing: 0) {
                ForEach(Array(events.enumerated()), id: \.element.id) { index, event in
                    if index > 0 {
                        Rectangle().fill(Theme.borderSoft).frame(height: 1).padding(.leading, 52)
                    }
                    row(event)
                }
                if let error {
                    Text(error)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.negative)
                        .padding(.top, Spacing.sm)
                }
            }
        }
    }

    private func row(_ event: SalaryEvent) -> some View {
        HStack(spacing: Spacing.md) {
            TintedIcon(systemName: event.icon, tint: event.isVoided ? Theme.textDim : event.tint, size: 40, corner: 12)
            VStack(alignment: .leading, spacing: 2) {
                Text(event.title)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(event.isVoided ? Theme.textDim : Theme.text)
                Text(subtitle(event))
                    .font(.system(size: 13))
                    .foregroundStyle(event.isVoided ? Theme.warning : Theme.textDim)
                    .lineLimit(1)
            }
            Spacer(minLength: Spacing.sm)
            Text((event.isAddition ? "+" : "−") + OrdaKit.Money.format(event.amount))
                .font(.system(size: 15, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .strikethrough(event.isVoided)
                .foregroundStyle(event.isVoided ? Theme.textDim : (event.isAddition ? Theme.positive : Theme.text))
            if let onVoid = event.onVoid {
                Menu {
                    Button(role: .destructive, action: onVoid) {
                        Label("Отменить", systemImage: "arrow.uturn.backward")
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.textDim)
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel("Действия с операцией")
            }
        }
        .padding(.vertical, 10)
    }

    private func subtitle(_ event: SalaryEvent) -> String {
        var parts = [DateFormatting.dayMonth(event.date)]
        if event.isVoided { parts.append("отменена") }
        if let detail = event.detail, !detail.isEmpty { parts.append(detail) }
        return parts.joined(separator: " · ")
    }
}

/// Круглые кнопки действий — как «Перевести», «Оплатить» у банка.
struct SalaryActionRow: View {
    let actions: [SalaryAction]
    let open: (SalaryAction) -> Void

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.sm) {
            ForEach(actions) { action in
                RoundAction(icon: action.icon, title: action.title, tint: Theme.brand) { open(action) }
            }
        }
    }
}

/// Форма одного действия: сумма крупно, поля строками, одна кнопка.
struct SalaryActionForm: View {
    let action: SalaryAction
    let personName: String
    let submit: (SalaryFormValues) async throws -> Void

    @Environment(BusinessStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var cashText = ""
    @State private var kaspiText = ""
    @State private var amountText = ""
    @State private var companyID: String?
    @State private var date = Date()
    @State private var comment = ""
    @State private var isSaving = false
    @State private var error: String?

    private var cash: Double { AmountParsing.value(cashText) }
    private var kaspi: Double { AmountParsing.value(kaspiText) }
    private var total: Double { action.money == .split ? cash + kaspi : AmountParsing.value(amountText) }

    private var problem: String? {
        if action.money != .optional && total <= 0 { return "Укажите сумму" }
        if action.point == .required && (companyID ?? "").isEmpty { return "Выберите точку — деньги уходят из её кассы" }
        return nil
    }

    var body: some View {
        ScreenScroll {
            VStack(spacing: 4) {
                Text(action.money == .optional && total <= 0 ? "по ставке" : OrdaKit.Money.format(total))
                    .font(.system(size: 40, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(Theme.text)
                    .contentTransition(.numericText())
                    .animation(Motion.value, value: total)
                Text(personName)
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textDim)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, Spacing.md)

            if action.prefill > 0, action.money == .split, abs(total - action.prefill) > 0.5 {
                Button {
                    cashText = Quantity.format(action.prefill)
                    kaspiText = ""
                } label: {
                    Label("Весь остаток · \(OrdaKit.Money.format(action.prefill))", systemImage: "arrow.down.to.line")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.brand)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(Theme.brand.opacity(0.12), in: Capsule())
                }
                .buttonStyle(.pressable)
                .frame(maxWidth: .infinity)
            }

            LedgerEditForm.section("Сумма") {
                switch action.money {
                case .split:
                    LedgerEditForm.amountRow("Наличными", icon: "banknote.fill", text: $cashText)
                    LedgerEditForm.divider
                    LedgerEditForm.amountRow("Kaspi", icon: "qrcode", text: $kaspiText)
                case .single:
                    LedgerEditForm.amountRow(action.title, icon: action.icon, text: $amountText)
                case .optional:
                    LedgerEditForm.amountRow("Своя сумма", icon: action.icon, text: $amountText)
                }
            }

            if let limit = action.overpayLimit, total > limit + 0.5 {
                Text("Больше расчёта на \(OrdaKit.Money.format(total - limit)) — разница уйдёт авансом и вычтется из следующей выплаты.")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.warning)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            LedgerEditForm.section("Подробности") {
                if action.point != .none {
                    LedgerEditForm.menuRow(
                        "Точка",
                        icon: "building.2.fill",
                        value: store.companyName(companyID) ?? (action.point == .required ? "Выбрать" : "Не указана")
                    ) {
                        if action.point == .optional {
                            Button("Не указана") { companyID = nil }
                        }
                        ForEach(store.companies) { company in
                            Button(company.name) { companyID = company.id }
                        }
                    }
                    LedgerEditForm.divider
                }
                LedgerEditForm.dateRow($date)
                LedgerEditForm.divider
                LedgerEditForm.commentRow($comment)
            }

            Text(action.note)
                .font(.system(size: 13))
                .foregroundStyle(Theme.textDim)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Spacing.xs)

            LedgerEditForm.saveButton(title: action.action, isSaving: isSaving, problem: problem, error: error) {
                Task { await save() }
            }
        }
        .background(Theme.background)
        .navigationTitle(action.title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task {
            if action.prefill > 0, action.money == .split, cashText.isEmpty {
                cashText = Quantity.format(action.prefill)
            }
            if action.point == .required, companyID == nil {
                companyID = store.companies.first?.id
            }
            if store.companies.isEmpty { await store.loadCompanies() }
        }
    }

    private func save() async {
        guard problem == nil else { return }
        isSaving = true
        defer { isSaving = false }
        error = nil
        let values = SalaryFormValues(
            cash: cash,
            kaspi: kaspi,
            amount: total,
            companyID: companyID,
            date: DateParsing.dateOnlyString(from: date),
            comment: comment.trimmingCharacters(in: .whitespacesAndNewlines)
        )
        do {
            try await submit(values)
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
