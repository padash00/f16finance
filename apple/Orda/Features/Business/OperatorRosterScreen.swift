import OrdaKit
import OrdaUI
import SwiftUI
#if os(iOS)
import UIKit
#endif

/// Команда: стаж и сроки документов.
///
/// На сайте страница считает по этим же данным ещё десяток разрезов — они
/// нужны за столом. Здесь то, ради чего в раздел заглядывают между делом: кто
/// сколько работает и у кого вот-вот кончится документ. Просроченная медкнижка
/// обнаруживается в момент проверки, а не в отчёте за квартал.
struct OperatorRosterScreen: View {
    @Environment(\.api) private var api

    @State private var roster: OperatorRoster?
    @State private var loadError: APIError?
    @State private var isLoading = false
    @State private var showInactive = false
    @State private var query = ""
    @State private var selected: OperatorRoster.Person?
    /// Месяц, за который показываем деньги. Раньше денег в разделе не было
    /// вовсе: их считал сайт у себя в браузере.
    @State private var month = OperatorRosterScreen.currentMonth

    private var people: [OperatorRoster.Person] {
        let all = (roster?.people ?? []).filter { showInactive || $0.isActive }
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        let filtered = needle.isEmpty
            ? all
            : all.filter {
                $0.name.lowercased().contains(needle)
                    || ($0.position ?? "").lowercased().contains(needle)
            }
        // Сначала те, у кого горит документ, потом по стажу: список нужен,
        // чтобы что-то сделать, а не чтобы полюбоваться алфавитом.
        return filtered.sorted { left, right in
            if left.documentNeedsAttention != right.documentNeedsAttention {
                return left.documentNeedsAttention
            }
            return (left.tenureDays ?? -1) > (right.tenureDays ?? -1)
        }
    }

    private var attention: [OperatorRoster.Person] {
        people.filter(\.documentNeedsAttention)
    }

    var body: some View {
        Group {
            if let loadError {
                ErrorStateView(error: loadError) { Task { await load() } }
            } else if isLoading && roster == nil {
                LoadingRows(count: 4)
            } else {
                MasterDetail(
                    items: people,
                    selection: $selected,
                    listWidth: 340
                ) { person in
                    personRow(person)
                } detail: { person in
                    personCard(person)
                } empty: {
                    WideEmptyState(
                        icon: "person.2",
                        title: query.isEmpty ? "Операторов нет" : "Никого не нашлось",
                        message: query.isEmpty
                            ? "Заведите операторов — здесь появятся стаж и сроки документов."
                            : "По запросу «\(query)» никого."
                    )
                } header: {
                    VStack(spacing: Spacing.md) {
                        if !attention.isEmpty { attentionCard }

                        Toggle("Показывать уволенных", isOn: $showInactive)
                            .font(Typography.callout)
                            .tint(Theme.brand)
                    }
                }
            }
        }
        .background(Theme.background)
        .navigationTitle("Команда")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .searchable(text: $query, prompt: "Имя или должность")
        .task { await load() }
        .refreshable { await load() }
    }

    /// Горящие документы — строкой с иконкой на белой подложке, как
    /// предупреждение в банковском приложении, а не карточкой с рамкой.
    private var attentionCard: some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            TintedIcon(systemName: "exclamationmark.triangle.fill", tint: Theme.warning, size: 44)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(attention.count) \(pluralize(attention.count, "документ", "документа", "документов")) требует внимания")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Theme.text)
                Text("Просрочен или кончается в течение месяца. Такие люди наверху списка.")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(Spacing.lg)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private func personRow(_ person: OperatorRoster.Person) -> some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            PersonInitial(name: person.name, isActive: person.isActive)

            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: Spacing.xs) {
                    Text(person.name)
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                    if !person.isActive {
                        Text("уволен")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Theme.textDim)
                    }
                }

                if let position = person.position, !position.isEmpty {
                    Text(position)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textDim)
                }

                // В списке — одна цифра, по которой людей и сравнивают: средняя
                // смена. Карточка с разбором живёт в карточке человека: в
                // колонке списка она не помещается и переносит слова по слогам.
                if let money = roster?.money[person.id], money.shifts > 0 {
                    Text("ср. смена \(Money.format(money.averagePerShift)) · \(money.shifts) \(pluralize(money.shifts, "смена", "смены", "смен"))")
                        .font(.system(size: 13))
                        .monospacedDigit()
                        .foregroundStyle(Theme.textDim)
                        .lineLimit(1)
                }

                if let expiry = expiryLabel(person) {
                    Text(expiry)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(person.documentNeedsAttention ? Theme.warning : Theme.textDim)
                }
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 2) {
                if let tenure = person.tenureLabel {
                    Text(tenure)
                        .font(.system(size: 16, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(Theme.text)
                    Text("стаж")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textDim)
                }
            }
        }
        .padding(.vertical, Spacing.xs)
        .contentShape(Rectangle())
    }

    /// Карточка человека: то же, что в строке, но с местом под подробности.
    private func personCard(_ person: OperatorRoster.Person) -> some View {
        ScreenScroll {
            VStack(spacing: Spacing.lg) {
                // Кто это — крупно, с кружком инициала, как профиль в банке.
                VStack(spacing: Spacing.sm) {
                    PersonInitial(name: person.name, isActive: person.isActive, size: 72)
                    Text(person.name)
                        .font(.system(size: 22, weight: .bold, design: .rounded))
                        .foregroundStyle(Theme.text)
                        .multilineTextAlignment(.center)
                    if let position = person.position, !position.isEmpty {
                        Text(position)
                            .font(.system(size: 15))
                            .foregroundStyle(Theme.textMuted)
                    }
                    if !person.isActive {
                        Text("уволен")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.textDim)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.top, Spacing.sm)

                // Деньги за месяц. Средняя смена — главной цифрой: оборот
                // зависит от того, сколько смен человек отработал, и
                // сравнивать по нему нечестно.
                if let money = roster?.money[person.id] {
                    HeroSummary(
                        title: "Средняя смена за месяц",
                        value: Money.format(money.averagePerShift),
                        caption: "\(money.shifts) \(pluralize(money.shifts, "смена", "смены", "смен"))",
                        footer: moneyFooter(money),
                        colors: [Color(hex: 0x4F46E5), Color(hex: 0x7C3AED)]
                    )

                    if money.manualPlus > 0.01 || money.hasDeductions || money.advances > 0.01 {
                        OwnerSection("Премии и удержания") {
                            VStack(spacing: Spacing.md) {
                                if money.manualPlus > 0.01 {
                                    moneyRow("Премии", icon: "gift.fill", tint: Theme.positive, value: Money.signed(money.manualPlus), valueColor: Theme.positive)
                                }
                                if money.manualMinus > 0.01 {
                                    moneyRow("Штрафы", icon: "exclamationmark.triangle.fill", tint: Theme.negative, value: Money.signed(-money.manualMinus), valueColor: Theme.negative)
                                }
                                if money.autoDebts > 0.01 {
                                    moneyRow("Долги", icon: "creditcard.fill", tint: Color(hex: 0xF59E0B), value: Money.signed(-money.autoDebts), valueColor: Theme.negative)
                                }
                                if money.advances > 0.01 {
                                    moneyRow("Авансы", icon: "banknote.fill", tint: Color(hex: 0x3B82F6), value: Money.format(money.advances), valueColor: Theme.text)
                                }
                                if money.hasDeductions || money.manualPlus > 0.01 {
                                    RowDivider()
                                    StatRow(
                                        "Итого",
                                        value: Money.signed(money.netEffect),
                                        valueColor: money.netEffect < 0 ? Theme.negative : Theme.positive,
                                        emphasized: true
                                    )
                                }
                            }
                        }
                    }
                }

                OwnerSection("О сотруднике") {
                    VStack(spacing: Spacing.md) {
                        if let tenure = person.tenureLabel {
                            infoRow("Стаж", tenure)
                        }
                        if let hire = person.hireDate {
                            infoRow("Принят", hire.formatted(date: .abbreviated, time: .omitted))
                        }
                        if let phone = person.phone, !phone.isEmpty {
                            // Телефон нажимается: человека с горящим документом
                            // проще набрать сразу, чем переписывать номер.
                            Button {
                                call(phone)
                            } label: {
                                HStack {
                                    Text("Телефон")
                                        .font(Typography.callout)
                                        .foregroundStyle(Theme.textDim)
                                    Spacer()
                                    Text(phone)
                                        .font(Typography.callout.weight(.medium))
                                        .foregroundStyle(Theme.brand)
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.pressable)
                        }
                    }
                }

                if let expiry = expiryLabel(person) {
                    OwnerSection("Документы") {
                        HStack(alignment: .top, spacing: Spacing.md) {
                            TintedIcon(
                                systemName: person.documentNeedsAttention ? "exclamationmark.triangle.fill" : "doc.text.fill",
                                tint: person.documentNeedsAttention ? Theme.warning : Color(hex: 0x3B82F6),
                                size: 40
                            )
                            VStack(alignment: .leading, spacing: 2) {
                                Text(expiry)
                                    .font(.system(size: 15, weight: .medium))
                                    .foregroundStyle(person.documentNeedsAttention ? Theme.warning : Theme.text)
                                    .fixedSize(horizontal: false, vertical: true)
                                Text("Сроки заводятся на сайте, в карточке оператора.")
                                    .font(.system(size: 13))
                                    .foregroundStyle(Theme.textDim)
                            }
                        }
                    }
                }
            }
        }
        .background(Theme.background)
    }

    private func moneyFooter(_ money: OperatorRoster.Money) -> [(String, String)] {
        var footer: [(String, String)] = [("Оборот", Money.format(money.turnover))]
        if money.share > 0 {
            footer.append(("Доля в обороте", Percent.format(money.share * 100)))
        }
        return footer
    }

    private func moneyRow(_ title: String, icon: String, tint: Color, value: String, valueColor: Color) -> some View {
        HStack(spacing: Spacing.md) {
            TintedIcon(systemName: icon, tint: tint, size: 36)
            Text(title)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(Theme.text)
            Spacer()
            Text(value)
                .font(.system(size: 16, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(valueColor)
        }
    }

    private func infoRow(_ title: String, _ value: String) -> some View {
        HStack {
            Text(title)
                .font(Typography.callout)
                .foregroundStyle(Theme.textDim)
            Spacer()
            Text(value)
                .font(Typography.callout.weight(.medium))
                .foregroundStyle(Theme.text)
        }
    }

    /// Текущий месяц «2026-08».
    private static var currentMonth: String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM"
        return formatter.string(from: Date())
    }

    private static func monthBounds(_ month: String) -> (from: String, to: String) {
        let parts = month.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 2 else { return (month, month) }
        var components = DateComponents()
        components.year = parts[0]
        components.month = parts[1]
        components.day = 1
        let calendar = Calendar(identifier: .gregorian)
        guard let start = calendar.date(from: components),
              let range = calendar.range(of: .day, in: .month, for: start)
        else { return ("\(month)-01", "\(month)-28") }
        return ("\(month)-01", String(format: "%@-%02d", month, range.count))
    }

    private func call(_ phone: String) {
        #if os(iOS)
        let digits = phone.filter { $0.isNumber || $0 == "+" }
        guard let url = URL(string: "tel:\(digits)") else { return }
        UIApplication.shared.open(url)
        #endif
    }

    private func expiryLabel(_ person: OperatorRoster.Person) -> String? {
        guard let days = person.daysToExpiry else { return nil }
        if days < 0 { return "документ просрочен \(-days) \(pluralize(-days, "день", "дня", "дней")) назад" }
        if days == 0 { return "документ кончается сегодня" }
        if days <= 30 { return "документ кончается через \(days) \(pluralize(days, "день", "дня", "дней"))" }
        guard let date = person.nearestExpiry else { return nil }
        return "документ до " + date.formatted(date: .abbreviated, time: .omitted)
    }

    private func load() async {
        isLoading = roster == nil
        loadError = nil
        do {
            let bounds = OperatorRosterScreen.monthBounds(month)
            roster = try await OperatorRosterService(api: api).roster(from: bounds.from, to: bounds.to)
        } catch let error as APIError {
            loadError = error
        } catch {
            loadError = .transport(message: error.localizedDescription)
        }
        isLoading = false
    }
}
