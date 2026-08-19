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
        .navigationTitle("Команда")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .searchable(text: $query, prompt: "Имя или должность")
        .task { await load() }
        .refreshable { await load() }
    }

    private var attentionCard: some View {
        Card(accent: Theme.warning) {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Label(
                    "\(attention.count) \(pluralize(attention.count, "документ", "документа", "документов")) требует внимания",
                    systemImage: "exclamationmark.triangle.fill"
                )
                .font(Typography.callout.weight(.semibold))
                .foregroundStyle(Theme.warning)

                Text("Просрочен или кончается в течение месяца. Такие люди наверху списка.")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func personRow(_ person: OperatorRoster.Person) -> some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            avatar(person)

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: Spacing.xs) {
                    Text(person.name)
                        .font(Typography.callout.weight(.medium))
                        .foregroundStyle(Theme.text)
                    if !person.isActive {
                        Text("уволен")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textMuted)
                    }
                }

                if let position = person.position, !position.isEmpty {
                    Text(position)
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textMuted)
                }

                // В списке — одна цифра, по которой людей и сравнивают: средняя
                // смена. Карточка с разбором живёт в карточке человека: в
                // колонке списка она не помещается и переносит слова по слогам.
                if let money = roster?.money[person.id], money.shifts > 0 {
                    Text("ср. смена \(Money.format(money.averagePerShift)) · \(money.shifts) \(pluralize(money.shifts, "смена", "смены", "смен"))")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                        .lineLimit(1)
                }

            if let expiry = expiryLabel(person) {
                    Text(expiry)
                        .font(Typography.caption.weight(.medium))
                        .foregroundStyle(person.documentNeedsAttention ? Theme.warning : Theme.textMuted)
                }
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 2) {
                if let tenure = person.tenureLabel {
                    Text(tenure)
                        .font(Typography.callout.weight(.semibold).monospacedDigit())
                        .foregroundStyle(Theme.text)
                    Text("стаж")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textMuted)
                }
            }
        }
        .contentShape(Rectangle())
    }

    /// Карточка человека: то же, что в строке, но с местом под подробности.
    private func personCard(_ person: OperatorRoster.Person) -> some View {
        ScreenScroll {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    HStack(spacing: Spacing.md) {
                        avatar(person)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(person.name)
                                .font(Typography.title)
                                .foregroundStyle(Theme.text)
                            if let position = person.position, !position.isEmpty {
                                Text(position)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.textMuted)
                            }
                        }
                        Spacer()
                        if !person.isActive { StatusChip("уволен", kind: .neutral) }
                    }

                    RowDivider()

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

            // Деньги за месяц. Плитками не рисуем: в карточке колонка узкая, и
            // сетка складывалась в столбик, а подписи переносились по слогам.
            // Строки читаются в любой ширине.
            if let money = roster?.money[person.id] {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        SectionHeader(
                            "Деньги за месяц",
                            subtitle: "\(money.shifts) \(pluralize(money.shifts, "смена", "смены", "смен"))"
                        )

                        // Средняя смена первой: оборот зависит от того, сколько
                        // смен человек отработал, и сравнивать по нему нечестно.
                        StatRow("Средняя смена", value: Money.format(money.averagePerShift), emphasized: true)
                        StatRow("Оборот", value: Money.format(money.turnover))
                        if money.share > 0 {
                            StatRow("Доля в обороте", value: Percent.format(money.share * 100))
                        }
                        if money.manualPlus > 0.01 {
                            StatRow("Премии", value: Money.signed(money.manualPlus), valueColor: Theme.positive)
                        }
                        if money.manualMinus > 0.01 {
                            StatRow("Штрафы", value: Money.signed(-money.manualMinus), valueColor: Theme.negative)
                        }
                        if money.autoDebts > 0.01 {
                            StatRow("Долги", value: Money.signed(-money.autoDebts), valueColor: Theme.negative)
                        }
                        if money.advances > 0.01 {
                            StatRow("Авансы", value: Money.format(money.advances))
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

            if let expiry = expiryLabel(person) {
                Card(accent: person.documentNeedsAttention ? Theme.warning : nil) {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        SectionHeader("Документы")
                        Text(expiry)
                            .font(Typography.callout)
                            .foregroundStyle(person.documentNeedsAttention ? Theme.warning : Theme.textDim)
                            .fixedSize(horizontal: false, vertical: true)
                        Text("Сроки заводятся на сайте, в карточке оператора.")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textMuted)
                    }
                }
            }
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

    private func avatar(_ person: OperatorRoster.Person) -> some View {
        // Инициалы, а не подгрузка фотографии: список длинный, а фотографии
        // операторов заполнены у единиц — ради них тянуть картинки на каждую
        // строку незачем.
        Text(initials(person.name))
            .font(Typography.caption.weight(.bold))
            .foregroundStyle(Theme.brand)
            .frame(width: 34, height: 34)
            .background(Theme.brand.opacity(0.12), in: Circle())
    }

    private func initials(_ name: String) -> String {
        let parts = name.split(separator: " ").prefix(2)
        return parts.compactMap { $0.first.map(String.init) }.joined().uppercased()
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
