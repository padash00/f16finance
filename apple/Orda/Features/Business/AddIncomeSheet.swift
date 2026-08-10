import OrdaKit
import OrdaUI
import SwiftUI

/// Форма добавления дохода за смену.
///
/// До неё владелец мог только смотреть: любая цифра заводилась на сайте, и
/// приложение на телефоне было витриной, а не рабочим местом. Выручку сдают в
/// конце смены, стоя у стойки, — это ровно тот случай, когда телефон под
/// рукой, а ноутбука нет.
struct AddIncomeSheet: View {
    @Environment(BusinessStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var date = Date()
    @State private var companyID = ""
    @State private var operatorID = ""
    @State private var shift = "day"
    @State private var cash = ""
    @State private var kaspi = ""
    @State private var card = ""
    @State private var online = ""
    @State private var comment = ""

    @State private var errorMessage: String?
    /// Сервер нашёл такую же запись и ждёт подтверждения.
    @State private var duplicateWarning = false
    @State private var didPrepare = false

    var body: some View {
        NavigationStack {
            ScreenScroll {
                VStack(spacing: Spacing.lg) {
                    whenCard
                    amountsCard
                    totalCard
                    footer
                }
            }
            .background(Theme.background)
            .navigationTitle("Новый доход")
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
                // Точки и операторы нужны обе: без оператора сервер запись не
                // примет, а выбирать его из пустого списка нельзя.
                if store.companies.isEmpty { await store.loadCompanies() }
                if store.operators.isEmpty { await store.loadTeam() }
                if companyID.isEmpty, store.companies.count == 1 {
                    companyID = store.companies[0].id
                }
            }
        }
    }

    // ── Части формы ──────────────────────────────────────────────────────────

    private var whenCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Смена")

                DatePicker("Дата", selection: $date, in: ...Date(), displayedComponents: .date)
                    .font(Typography.callout)

                FieldLabel("Точка")
                Picker("Точка", selection: $companyID) {
                    Text("Не выбрана").tag("")
                    ForEach(store.companies) { company in
                        Text(company.name).tag(company.id)
                    }
                }
                .pickerStyle(.menu)

                FieldLabel("Оператор")
                Picker("Оператор", selection: $operatorID) {
                    Text("Не выбран").tag("")
                    ForEach(activeOperators) { person in
                        Text(person.shortName ?? person.name).tag(person.id)
                    }
                }
                .pickerStyle(.menu)

                FieldLabel("Время суток")
                Picker("Смена", selection: $shift) {
                    Text("День").tag("day")
                    Text("Ночь").tag("night")
                }
                .pickerStyle(.segmented)
            }
        }
    }

    private var amountsCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Суммы")
                MoneyField(title: "Наличные", text: $cash)
                MoneyField(title: "Kaspi", text: $kaspi)
                MoneyField(title: "Карта", text: $card)
                MoneyField(title: "Онлайн", text: $online)

                FieldLabel("Комментарий")
                TextField("Необязательно", text: $comment, axis: .vertical)
                    .lineLimit(1...3)
                    .textFieldStyle(.plain)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .padding(Spacing.md)
                    .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
            }
        }
    }

    private var totalCard: some View {
        Card(accent: Theme.positive) {
            HStack {
                Text("Итого за смену")
                    .font(Typography.callout)
                    .foregroundStyle(Theme.textMuted)
                Spacer()
                Text(Money.format(draft.total))
                    .font(Typography.monospacedDigits(Typography.title))
                    .foregroundStyle(Theme.text)
                    .contentTransition(.numericText())
            }
        }
    }

    @ViewBuilder
    private var footer: some View {
        if duplicateWarning {
            Card(accent: Theme.warning) {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    Text("Такая выручка уже заведена")
                        .font(Typography.callout.weight(.semibold))
                        .foregroundStyle(Theme.text)
                    Text("За эту дату и смену уже есть запись с теми же суммами. Обычно это повторная отправка. Если выручку правда сдавали дважды — сохраните всё равно.")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textMuted)

                    Button("Сохранить всё равно") {
                        Task { await save(force: true) }
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }
            }
        }

        if let blocker = draft.validationMessage {
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

        Button(store.isSavingIncome ? "Сохраняем…" : "Сохранить") {
            Task { await save(force: false) }
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(store.isSavingIncome || !draft.isValid)
    }

    // ── Состояние ────────────────────────────────────────────────────────────

    /// Только действующие: уволенный оператор в списке — приглашение записать
    /// смену на того, кто её не работал.
    private var activeOperators: [TeamOperator] {
        store.operators.filter(\.isActive)
    }

    private var draft: IncomeDraft {
        IncomeDraft(
            date: Self.isoDay.string(from: date),
            companyID: companyID,
            operatorID: operatorID.isEmpty ? nil : operatorID,
            shift: shift,
            cashAmount: Self.amount(cash),
            kaspiAmount: Self.amount(kaspi),
            cardAmount: Self.amount(card),
            onlineAmount: Self.amount(online),
            comment: comment
        )
    }

    private func save(force: Bool) async {
        errorMessage = nil
        switch await store.createIncome(draft, force: force) {
        case .saved:
            Haptics.success()
            dismiss()
        case .duplicate:
            duplicateWarning = true
        case let .failed(message):
            errorMessage = message
        }
    }

    /// Запятая и пробелы — то, как деньги набирают на телефоне.
    private static func amount(_ raw: String) -> Double {
        Double(
            raw.replacingOccurrences(of: ",", with: ".")
                .replacingOccurrences(of: " ", with: "")
                .replacingOccurrences(of: "\u{00A0}", with: "")
        ) ?? 0
    }

    private static let isoDay: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()
}

// ── Мелочи формы ─────────────────────────────────────────────────────────────

struct FieldLabel: View {
    private let text: String

    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text)
            .font(Typography.label)
            .foregroundStyle(Theme.textDim)
            .textCase(.uppercase)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Поле для суммы. Пустое означает ноль — заставлять набирать «0» в трёх полях
/// из четырёх значит превращать ввод одной цифры в четыре.
struct MoneyField: View {
    let title: String
    @Binding var text: String

    var body: some View {
        HStack(spacing: Spacing.md) {
            Text(title)
                .font(Typography.callout)
                .foregroundStyle(Theme.textMuted)

            Spacer(minLength: Spacing.sm)

            TextField("0", text: $text)
                .multilineTextAlignment(.trailing)
                .textFieldStyle(.plain)
                .font(Typography.callout.monospacedDigit())
                .foregroundStyle(Theme.text)
                .frame(maxWidth: 160)
                .padding(Spacing.sm)
                .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
                #if os(iOS)
                .keyboardType(.decimalPad)
                #endif
        }
    }
}
