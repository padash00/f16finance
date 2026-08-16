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
            roster = try await OperatorRosterService(api: api).roster()
        } catch let error as APIError {
            loadError = error
        } catch {
            loadError = .transport(message: error.localizedDescription)
        }
        isLoading = false
    }
}
