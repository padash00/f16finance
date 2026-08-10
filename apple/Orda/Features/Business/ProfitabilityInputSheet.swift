import OrdaKit
import OrdaUI
import SwiftUI

/// Ручные вводы месяца для ОПиУ.
///
/// Из журналов не выводятся ни ФОТ, ни налоги, ни амортизация, ни комиссии
/// эквайринга. Пока их можно было задать только на сайте, EBITDA в приложении
/// считалась по неполной картине — и владелец видел цифру, которой нельзя
/// верить, без единого намёка почему.
struct ProfitabilityInputSheet: View {
    let month: String
    @Environment(\.api) private var api
    @Environment(\.dismiss) private var dismiss

    @State private var store: ProfitabilityInputStore?
    /// Поля держим строками: пустое поле должно оставаться пустым, а не
    /// превращаться в «0», который потом приходится стирать.
    @State private var fields: [Field: String] = [:]
    @State private var notes = ""
    @State private var didPrepare = false

    /// Поле формы. Перечислением, а не двадцатью `@State`: список полей растёт
    /// вместе с контрактом сервера, и каждый новый не должен требовать правки
    /// в пяти местах.
    private enum Field: Hashable {
        case payroll, payrollTaxes, incomeTax, depreciation, amortization, otherOperating
        case kaspiQrTurnover, kaspiQrRate
        case kaspiGoldTurnover, kaspiGoldRate
        case qrGoldTurnover, qrGoldRate
        case otherCardsTurnover, otherCardsRate
        case kaspiRedTurnover, kaspiRedRate
        case kaspiKreditTurnover, kaspiKreditRate
        case cashOverride, posOverride
    }

    var body: some View {
        NavigationStack {
            Group {
                if let store {
                    if let error = store.error, store.input == nil {
                        ErrorStateView(error: error) { Task { await load(store) } }
                    } else if store.input == nil {
                        LoadingRows(count: 6)
                    } else {
                        form(store)
                    }
                } else {
                    LoadingRows(count: 6)
                }
            }
            .background(Theme.background)
            .navigationTitle(MonthTitle.of(month))
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
                let created = ProfitabilityInputStore(api: api, month: month)
                store = created
                await load(created)
            }
        }
    }

    private func load(_ store: ProfitabilityInputStore) async {
        await store.load()
        guard let input = store.input else { return }
        fields = [
            .payroll: text(input.payrollAmount),
            .payrollTaxes: text(input.payrollTaxesAmount),
            .incomeTax: text(input.incomeTaxAmount),
            .depreciation: text(input.depreciationAmount),
            .amortization: text(input.amortizationAmount),
            .otherOperating: text(input.otherOperatingAmount),
            .kaspiQrTurnover: text(input.kaspiQrTurnover),
            .kaspiQrRate: text(input.kaspiQrRate),
            .kaspiGoldTurnover: text(input.kaspiGoldTurnover),
            .kaspiGoldRate: text(input.kaspiGoldRate),
            .qrGoldTurnover: text(input.qrGoldTurnover),
            .qrGoldRate: text(input.qrGoldRate),
            .otherCardsTurnover: text(input.otherCardsTurnover),
            .otherCardsRate: text(input.otherCardsRate),
            .kaspiRedTurnover: text(input.kaspiRedTurnover),
            .kaspiRedRate: text(input.kaspiRedRate),
            .kaspiKreditTurnover: text(input.kaspiKreditTurnover),
            .kaspiKreditRate: text(input.kaspiKreditRate),
            .cashOverride: text(input.cashRevenueOverride),
            .posOverride: text(input.posRevenueOverride),
        ]
        notes = input.notes ?? ""
    }

    @ViewBuilder
    private func form(_ store: ProfitabilityInputStore) -> some View {
        ScreenScroll {
            VStack(spacing: Spacing.lg) {
                fixedCostsCard
                acquiringCard
                overridesCard
                notesCard
                footer(store)
            }
        }
    }

    private var fixedCostsCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Постоянные расходы месяца")
                MoneyField(title: "ФОТ", text: binding(.payroll))
                MoneyField(title: "Налоги с ФОТ", text: binding(.payrollTaxes))
                MoneyField(title: "Подоходный налог", text: binding(.incomeTax))
                MoneyField(title: "Амортизация ОС", text: binding(.depreciation))
                MoneyField(title: "Амортизация НМА", text: binding(.amortization))
                MoneyField(title: "Прочие операционные", text: binding(.otherOperating))

                RowDivider()
                StatRow("Итого постоянных", value: Money.format(draft.fixedCostsTotal), emphasized: true)
            }
        }
    }

    private var acquiringCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Эквайринг")
                Text("Оборот и ставка банка в процентах. Комиссия считается как оборот × ставку.")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)

                acquiringPair("Kaspi QR", turnover: .kaspiQrTurnover, rate: .kaspiQrRate)
                acquiringPair("Kaspi Gold", turnover: .kaspiGoldTurnover, rate: .kaspiGoldRate)
                acquiringPair("QR Gold", turnover: .qrGoldTurnover, rate: .qrGoldRate)
                acquiringPair("Прочие карты", turnover: .otherCardsTurnover, rate: .otherCardsRate)
                acquiringPair("Kaspi Red", turnover: .kaspiRedTurnover, rate: .kaspiRedRate)
                acquiringPair("Kaspi Кредит", turnover: .kaspiKreditTurnover, rate: .kaspiKreditRate)

                RowDivider()
                StatRow("Комиссия за месяц", value: Money.format(draft.acquiringFeeTotal), emphasized: true)
            }
        }
    }

    private func acquiringPair(_ title: String, turnover: Field, rate: Field) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            FieldLabel(title)
            MoneyField(title: "Оборот", text: binding(turnover))
            MoneyField(title: "Ставка, %", text: binding(rate))
        }
    }

    private var overridesCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Замена выручки")
                Text("Заполняйте, только если наличную или кассовую выручку месяца считают отдельно от журнала. Ноль — берётся расчётная.")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)

                MoneyField(title: "Наличные", text: binding(.cashOverride))
                MoneyField(title: "Касса", text: binding(.posOverride))
            }
        }
    }

    private var notesCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                FieldLabel("Заметка")
                TextField("Необязательно", text: $notes, axis: .vertical)
                    .lineLimit(1...4)
                    .textFieldStyle(.plain)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .padding(Spacing.md)
                    .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
            }
        }
    }

    @ViewBuilder
    private func footer(_ store: ProfitabilityInputStore) -> some View {
        if let message = store.saveError {
            Text(message)
                .font(Typography.callout)
                .foregroundStyle(Theme.negative)
                .frame(maxWidth: .infinity, alignment: .leading)
        }

        Button(store.isSaving ? "Сохраняем…" : "Сохранить") {
            Task {
                if await store.save(draft) {
                    Haptics.success()
                    dismiss()
                }
            }
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(store.isSaving)
    }

    // ── Состояние ────────────────────────────────────────────────────────────

    private func binding(_ field: Field) -> Binding<String> {
        Binding(
            get: { fields[field] ?? "" },
            set: { fields[field] = $0 }
        )
    }

    private var draft: ProfitabilityInput {
        var input = store?.input ?? ProfitabilityInput(month: month)
        input.month = month
        input.payrollAmount = number(.payroll)
        input.payrollTaxesAmount = number(.payrollTaxes)
        input.incomeTaxAmount = number(.incomeTax)
        input.depreciationAmount = number(.depreciation)
        input.amortizationAmount = number(.amortization)
        input.otherOperatingAmount = number(.otherOperating)
        input.kaspiQrTurnover = number(.kaspiQrTurnover)
        input.kaspiQrRate = number(.kaspiQrRate)
        input.kaspiGoldTurnover = number(.kaspiGoldTurnover)
        input.kaspiGoldRate = number(.kaspiGoldRate)
        input.qrGoldTurnover = number(.qrGoldTurnover)
        input.qrGoldRate = number(.qrGoldRate)
        input.otherCardsTurnover = number(.otherCardsTurnover)
        input.otherCardsRate = number(.otherCardsRate)
        input.kaspiRedTurnover = number(.kaspiRedTurnover)
        input.kaspiRedRate = number(.kaspiRedRate)
        input.kaspiKreditTurnover = number(.kaspiKreditTurnover)
        input.kaspiKreditRate = number(.kaspiKreditRate)
        input.cashRevenueOverride = number(.cashOverride)
        input.posRevenueOverride = number(.posOverride)
        input.notes = notes
        return input
    }

    private func number(_ field: Field) -> Double {
        AmountParsing.value(fields[field] ?? "")
    }

    /// Ноль показываем пустым полем: строка «0» в двадцати полях выглядит как
    /// заполненная форма, хотя не заполнено ничего.
    private func text(_ value: Double) -> String {
        value == 0 ? "" : Quantity.format(value)
    }
}

// ── Разбор чисел и подпись месяца ────────────────────────────────────────────

enum AmountParsing {
    /// Запятая, пробелы и неразрывные пробелы — то, как деньги набирают руками.
    static func value(_ raw: String) -> Double {
        Double(
            raw.replacingOccurrences(of: ",", with: ".")
                .replacingOccurrences(of: " ", with: "")
                .replacingOccurrences(of: "\u{00A0}", with: "")
        ) ?? 0
    }
}

enum MonthTitle {
    /// `2026-08` → «Август 2026».
    static func of(_ month: String) -> String {
        let parts = month.split(separator: "-")
        guard parts.count >= 2, let number = Int(parts[1]) else { return month }
        return "\(MonthNames.full(number)) \(parts[0])"
    }
}

@MainActor
@Observable
final class ProfitabilityInputStore {
    private(set) var input: ProfitabilityInput?
    private(set) var error: APIError?
    private(set) var saveError: String?
    private(set) var isSaving = false

    private let service: BusinessService
    private let month: String

    init(api: APIClient, month: String) {
        self.service = BusinessService(api: api)
        self.month = month
    }

    func load() async {
        do {
            let items = try await service.profitabilityInputs(from: month, to: month)
            // Месяца может не быть вовсе — это первый ввод, а не ошибка.
            input = items.first { $0.month == month } ?? ProfitabilityInput(month: month)
            error = nil
        } catch let apiError as APIError {
            error = apiError
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }

    func save(_ draft: ProfitabilityInput) async -> Bool {
        guard !isSaving else { return false }
        isSaving = true
        defer { isSaving = false }

        do {
            try await service.saveProfitabilityInput(draft)
            input = draft
            saveError = nil
            return true
        } catch let apiError as APIError {
            saveError = apiError.userMessage
            return false
        } catch {
            saveError = error.localizedDescription
            return false
        }
    }
}

/// Месяц как повод открыть лист. Обёртка нужна только для `sheet(item:)`:
/// голая строка не `Identifiable`.
struct EditingMonth: Identifiable {
    let id: String

    init(_ month: String) { id = month }
}
