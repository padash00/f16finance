import OrdaKit
import OrdaUI
import SwiftUI

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
        ScreenScroll {
            if let loadError {
                ErrorStateView(error: loadError) { Task { await load() } }
            } else if isLoading && roster == nil {
                LoadingRows(count: 4)
            } else if people.isEmpty {
                WideEmptyState(
                    icon: "person.2",
                    title: query.isEmpty ? "Операторов нет" : "Никого не нашлось",
                    message: query.isEmpty
                        ? "Заведите операторов — здесь появятся стаж и сроки документов."
                        : "По запросу «\(query)» никого."
                )
            } else {
                if !attention.isEmpty { attentionCard }

                Card {
                    VStack(spacing: Spacing.sm) {
                        ForEach(Array(people.enumerated()), id: \.element.id) { index, person in
                            if index > 0 { RowDivider() }
                            personRow(person)
                        }
                    }
                }

                Toggle("Показывать уволенных", isOn: $showInactive)
                    .font(Typography.callout)
                    .tint(Theme.brand)
                    .padding(.horizontal, Spacing.xs)
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
