import OrdaKit
import OrdaUI
import SwiftUI

// ── Правила зарплаты ─────────────────────────────────────────────────────────

@MainActor @Observable
final class SalaryRulesStore {
    private(set) var book: SalaryRuleBook?
    private(set) var error: APIError?

    private let service: TeamAdminService

    init(api: APIClient) { service = TeamAdminService(api: api) }

    func load() async {
        do {
            book = try await service.loadSalaryRules()
            error = nil
        } catch let e as APIError {
            error = e
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }
}

/// По какой формуле люди получают деньги.
///
/// Владелец приходит сюда не сверять поля таблицы, а понять: сколько стоит
/// смена, за какой оборот доплачивают и куда упирается потолок. Поэтому
/// правило показано предложениями «условие → сумма», а не сеткой колонок,
/// как на сайте.
struct SalaryRulesScreen: View {
    @Environment(\.api) private var api
    @State private var store: SalaryRulesStore?

    var body: some View {
        Group {
            if let store {
                if let error = store.error, store.book == nil {
                    ErrorStateView(error: error) { Task { await store.load() } }
                } else if let book = store.book {
                    content(book)
                } else {
                    LoadingRows(count: 6)
                }
            } else {
                LoadingRows(count: 6)
            }
        }
        .background(Theme.background)
        .navigationTitle("Правила зарплаты")
        .toolbar { LogoutToolbarItem() }
        .task {
            if store == nil {
                let s = SalaryRulesStore(api: api)
                store = s
                await s.load()
            }
        }
        .refreshable { await store?.load() }
    }

    @ViewBuilder
    private func content(_ book: SalaryRuleBook) -> some View {
        if book.rules.isEmpty {
            WideEmptyState(
                icon: "function",
                title: "Правил нет",
                message: "Пока не задано ни одной ставки — смены считаются по значению по умолчанию."
            )
        } else {
            ScreenScroll {
                DashboardGrid {
                    MetricTile(
                        label: "Правил действует",
                        value: "\(book.activeRules.count)",
                        icon: "function",
                        accent: Theme.brand
                    )
                    MetricTile(
                        label: "Потолок смены",
                        value: Money.compact(book.activeRules.map(\.ceilingPerShift).max() ?? 0),
                        icon: "arrow.up.right",
                        accent: Theme.info
                    )
                    MetricTile(
                        label: "Надбавка за стаж",
                        value: book.maxSeniorityPercent > 0 ? "до \(Percent.format(book.maxSeniorityPercent))" : "нет",
                        icon: "calendar.badge.clock",
                        accent: book.maxSeniorityPercent > 0 ? Theme.accent : Theme.textDim
                    )
                }

                if !book.activeTiers.isEmpty {
                    SeniorityCard(tiers: book.activeTiers)
                }

                DashboardGrid {
                    ForEach(sortedRules(book)) { rule in
                        SalaryRuleCard(rule: rule, book: book)
                    }
                }

                if !book.history.isEmpty {
                    SalaryHistoryCard(changes: Array(book.history.prefix(12)))
                }
            }
        }
    }

    /// Действующие правила первыми, дальше — по точке и типу смены: отключённое
    /// правило деньгами не управляет и внизу мешает меньше.
    private func sortedRules(_ book: SalaryRuleBook) -> [SalaryRule] {
        book.rules.sorted { left, right in
            if left.isActive != right.isActive { return left.isActive }
            if left.companyCode != right.companyCode { return left.companyCode < right.companyCode }
            return !left.isNight && right.isNight
        }
    }
}

private struct SalaryRuleCard: View {
    let rule: SalaryRule
    let book: SalaryRuleBook

    var body: some View {
        // Без акцента: серая рамка «отключённого» правила получалась заметнее
        // обычной, и выключённая ставка выделялась сильнее действующих.
        // Состояние несёт плашка в заголовке.
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader(
                    book.companyName(forCode: rule.companyCode),
                    subtitle: rule.isNight ? "ночная смена" : "дневная смена"
                ) {
                    if !rule.isActive {
                        StatusChip("отключено", kind: .neutral)
                    } else {
                        Image(systemName: rule.isNight ? "moon.stars.fill" : "sun.max.fill")
                            .font(.system(size: 14))
                            .foregroundStyle(rule.isNight ? Theme.accent : Theme.warning)
                    }
                }

                ForEach(rule.terms) { term in
                    HStack(spacing: Spacing.md) {
                        Image(systemName: term.icon)
                            .font(.system(size: 13))
                            .foregroundStyle(term.isBonus ? Theme.positive : Theme.textDim)
                            .frame(width: 18)
                        Text(term.text)
                            .font(Typography.callout)
                            .foregroundStyle(Theme.textMuted)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: Spacing.sm)
                        Text(term.amount)
                            .font(Typography.callout.weight(.medium))
                            .monospacedDigit()
                            .foregroundStyle(term.isBonus ? Theme.positive : Theme.text)
                    }
                }

                RowDivider()

                StatRow(
                    "Максимум за смену",
                    value: Money.format(rule.ceilingPerShift),
                    icon: "arrow.up.to.line",
                    emphasized: true
                )

                if let from = rule.effectiveFrom {
                    Text("Действует с \(from.formatted(.dateTime.day().month(.wide).year()))")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                }

                let versions = book.versionHistory(ofRule: rule.id)
                if versions.count > 1 {
                    RowDivider()
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        Text("Ставка по датам")
                            .font(Typography.label)
                            .foregroundStyle(Theme.textDim)
                            .textCase(.uppercase)
                        // Прошлые смены считаются по своей версии — без этого
                        // списка непонятно, почему старая неделя не сошлась с
                        // текущей ставкой.
                        ForEach(versions.prefix(4)) { version in
                            HStack(spacing: Spacing.md) {
                                Text(version.effectiveFrom?.formatted(.dateTime.day().month(.abbreviated).year()) ?? "—")
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.textMuted)
                                Spacer(minLength: Spacing.sm)
                                Text(Money.format(version.basePerShift))
                                    .font(Typography.caption.weight(.medium))
                                    .monospacedDigit()
                                    .foregroundStyle(Theme.text)
                            }
                        }
                    }
                }
            }
        }
    }
}

private struct SeniorityCard: View {
    let tiers: [SeniorityTier]

    var body: some View {
        Card(accent: Theme.accent) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Надбавка за стаж", subtitle: "процент к ставке, общий для всех точек")

                ForEach(Array(tiers.enumerated()), id: \.element.id) { index, tier in
                    if index > 0 { RowDivider() }
                    HStack(spacing: Spacing.md) {
                        Image(systemName: "calendar.badge.clock")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.accent)
                            .frame(width: 18)
                        Text("Отработал \(tier.tenureLabel)")
                            .font(Typography.callout)
                            .foregroundStyle(Theme.textMuted)
                        Spacer(minLength: Spacing.sm)
                        Text(Percent.format(tier.bonusPercent, signed: true))
                            .font(Typography.callout.weight(.medium))
                            .monospacedDigit()
                            .foregroundStyle(Theme.positive)
                    }
                }
            }
        }
    }
}

private struct SalaryHistoryCard: View {
    let changes: [SalaryRuleChange]

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Кто менял ставки", subtitle: "последние правки")

                ForEach(Array(changes.enumerated()), id: \.element.id) { index, change in
                    if index > 0 { RowDivider() }
                    HStack(spacing: Spacing.md) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(change.actorEmail ?? "Система")
                                .font(Typography.callout)
                                .foregroundStyle(Theme.text)
                                .lineLimit(1)
                            Text(subtitle(change))
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textDim)
                                .lineLimit(1)
                        }
                        Spacer(minLength: Spacing.sm)
                        if let delta = change.baseDelta {
                            Text(Money.signed(delta))
                                .font(Typography.callout.weight(.medium))
                                .monospacedDigit()
                                .foregroundStyle(delta > 0 ? Theme.negative : Theme.positive)
                        }
                    }
                }
            }
        }
    }

    /// Рост ставки для владельца — рост расхода, поэтому «плюс» подсвечен
    /// красным, а не зелёным.
    private func subtitle(_ change: SalaryRuleChange) -> String {
        var parts: [String] = [change.actionLabel]
        if let code = change.companyCode, !code.isEmpty { parts.append(code.uppercased()) }
        if let shift = change.shiftType { parts.append(shift == "night" ? "ночь" : "день") }
        if let date = change.createdAt {
            parts.append(date.formatted(.dateTime.day().month(.abbreviated).hour().minute()))
        }
        return parts.joined(separator: " · ")
    }
}

// ── Кадры ────────────────────────────────────────────────────────────────────

@MainActor @Observable
final class HRStore {
    private(set) var people: [HRPerson]?
    private(set) var error: APIError?

    private let service: TeamAdminService

    init(api: APIClient) { service = TeamAdminService(api: api) }

    func load() async {
        do {
            people = try await service.loadHR()
            error = nil
        } catch let e as APIError {
            error = e
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }
}

/// Кто работает и кто ушёл.
///
/// Главный вопрос раздела — увольнения: когда, по какой статье и с чьей
/// подачи. Поэтому уволенные не спрятаны в архив, а доступны одним фильтром,
/// и в карточке человека увольнение стоит выше контактов.
struct HRScreen: View {
    @Environment(\.api) private var api

    @State private var store: HRStore?
    @State private var selected: HRPerson?
    @State private var mode: HRFilter = .working
    @State private var search = ""

    enum HRFilter: String, CaseIterable {
        case working, dismissed, all

        var title: String {
            switch self {
            case .working: "Работают"
            case .dismissed: "Уволены"
            case .all: "Все"
            }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            if let people = store?.people {
                HStack(spacing: Spacing.md) {
                    SummaryPill(title: "Работают", value: "\(people.filter(\.isActive).count)", tint: Theme.positive)
                    SummaryPill(title: "Уволены", value: "\(people.filter(\.isDismissed).count)", tint: Theme.textMuted)
                    SummaryPill(
                        title: "Ушли за 90 дней",
                        value: "\(recentlyDismissed(people).count)",
                        tint: recentlyDismissed(people).isEmpty ? Theme.textMuted : Theme.warning
                    )
                }
                .padding(.horizontal, Spacing.lg)
                .padding(.top, Spacing.md)

                HStack(spacing: Spacing.sm) {
                    ForEach(HRFilter.allCases, id: \.self) { option in
                        FilterChip(title: option.title, isOn: mode == option) { mode = option }
                    }
                    Spacer()
                }
                .padding(.horizontal, Spacing.lg)
                .padding(.vertical, Spacing.md)
            }

            if let store {
                if let error = store.error, store.people == nil {
                    ErrorStateView(error: error) { Task { await store.load() } }
                } else if store.people == nil {
                    LoadingRows(count: 7)
                } else {
                    MasterDetail(
                        items: filtered,
                        selection: $selected,
                        listWidth: 340
                    ) { person in
                        HRPersonRow(person: person)
                    } detail: { person in
                        HRPersonDetail(person: person)
                    } empty: {
                        WideEmptyState(
                            icon: "person.2.badge.gearshape",
                            title: mode == .dismissed ? "Уволенных нет" : "Никого не найдено",
                            message: "Здесь вся команда: и штат, и операторы точек."
                        )
                    }
                }
            } else {
                LoadingRows(count: 7)
            }
        }
        .background(Theme.background)
        .navigationTitle("Кадры")
        .searchable(text: $search, prompt: "Имя, должность или телефон")
        .toolbar { LogoutToolbarItem() }
        .task {
            if store == nil {
                let s = HRStore(api: api)
                store = s
                await s.load()
            }
        }
        .refreshable { await store?.load() }
    }

    private func recentlyDismissed(_ people: [HRPerson]) -> [HRPerson] {
        let border = Calendar.current.date(byAdding: .day, value: -90, to: Date()) ?? .distantPast
        return people.filter { person in
            guard person.isDismissed, let left = person.leftOn else { return false }
            return left >= border
        }
    }

    private var filtered: [HRPerson] {
        var items = store?.people ?? []

        switch mode {
        case .working: items = items.filter(\.isActive)
        case .dismissed: items = items.filter(\.isDismissed)
        case .all: break
        }

        if !search.isEmpty {
            items = items.filter {
                $0.fullName.localizedCaseInsensitiveContains(search)
                    || ($0.position?.localizedCaseInsensitiveContains(search) ?? false)
                    || ($0.phone?.contains(search) ?? false)
            }
        }

        return items.sorted { left, right in
            // В списке уволенных порядок обратный: свежее увольнение важнее
            // старого, а среди работающих алфавит удобнее даты найма.
            if left.isDismissed != right.isDismissed { return right.isDismissed }
            if left.isDismissed && right.isDismissed {
                return (left.leftOn ?? .distantPast) > (right.leftOn ?? .distantPast)
            }
            return left.fullName < right.fullName
        }
    }
}

private struct HRPersonRow: View {
    let person: HRPerson

    var body: some View {
        HStack(spacing: Spacing.md) {
            Text(person.initials)
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundStyle(person.isDismissed ? Theme.textDim : Theme.brand)
                .frame(width: 36, height: 36)
                .background((person.isDismissed ? Theme.textDim : Theme.brand).opacity(0.14), in: Circle())

            VStack(alignment: .leading, spacing: 1) {
                Text(person.fullName)
                    .font(Typography.callout)
                    .foregroundStyle(person.isDismissed ? Theme.textDim : Theme.text)
                    .lineLimit(1)
                Text(person.position ?? person.roleLabel)
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }

            Spacer(minLength: Spacing.sm)

            if person.isDismissed {
                VStack(alignment: .trailing, spacing: 2) {
                    StatusChip("уволен", kind: .danger)
                    if let left = person.leftOn {
                        Text(left.formatted(.dateTime.day().month(.abbreviated).year()))
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                    }
                }
            } else if let months = person.tenureMonths(), months > 0 {
                Text("\(months) \(pluralize(months, "месяц", "месяца", "месяцев"))")
                    .font(Typography.caption)
                    .monospacedDigit()
                    .foregroundStyle(Theme.textDim)
            }
        }
    }
}

private struct HRPersonDetail: View {
    let person: HRPerson

    var body: some View {
        ScreenScroll {
            Card {
                HStack(spacing: Spacing.lg) {
                    if let photo = person.photoURL, !photo.isEmpty {
                        Thumbnail(url: photo, side: 64, cornerRadius: 32, fallbackText: person.initials)
                    } else {
                        Text(person.initials)
                            .font(.system(size: 22, weight: .semibold, design: .rounded))
                            .foregroundStyle(person.isDismissed ? Theme.textDim : Theme.brand)
                            .frame(width: 64, height: 64)
                            .background((person.isDismissed ? Theme.textDim : Theme.brand).opacity(0.14), in: Circle())
                    }

                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        Text(person.fullName)
                            .font(Typography.title)
                            .foregroundStyle(Theme.text)
                        Text(person.position ?? person.roleLabel)
                            .font(Typography.callout)
                            .foregroundStyle(Theme.textMuted)
                        HStack(spacing: Spacing.sm) {
                            StatusChip(person.isDismissed ? "уволен" : "работает", kind: person.isDismissed ? .danger : .good)
                            StatusChip(person.isOperator ? "оператор" : "штат", kind: .neutral)
                            if person.isHybrid {
                                StatusChip("и штат, и смены", kind: .info)
                            }
                        }
                    }
                    Spacer()
                }
            }

            if person.isDismissed {
                Card(accent: Theme.negative) {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        SectionHeader("Увольнение")
                        if let left = person.leftOn {
                            StatRow(
                                "Последний день",
                                value: left.formatted(.dateTime.day().month(.wide).year()),
                                valueColor: Theme.negative,
                                icon: "calendar",
                                emphasized: true
                            )
                        }
                        if let type = person.dismissalTypeLabel {
                            StatRow("Основание", value: type, icon: "doc.text")
                        }
                        if let who = person.dismissedByName {
                            StatRow("Оформил", value: who, icon: "person.badge.shield.checkmark")
                        }
                        if let reason = person.dismissalReason, !reason.isEmpty {
                            RowDivider()
                            Text("«\(reason)»")
                                .font(Typography.callout)
                                .foregroundStyle(Theme.textMuted)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
            }

            Card {
                VStack(spacing: Spacing.md) {
                    SectionHeader("В компании")
                    if let hired = person.hireDate {
                        StatRow("Принят", value: hired.formatted(.dateTime.day().month(.wide).year()), icon: "calendar.badge.plus")
                    }
                    if let months = person.tenureMonths() {
                        StatRow(
                            person.isDismissed ? "Проработал" : "Стаж",
                            value: "\(months) \(pluralize(months, "месяц", "месяца", "месяцев"))",
                            icon: "clock"
                        )
                    }
                    StatRow("Роль", value: person.roleLabel, icon: "person.text.rectangle")
                    if let salary = person.monthlySalary, salary > 0 {
                        StatRow("Оклад", value: Money.format(salary), icon: "wallet.bifold")
                    }
                }
            }

            if person.phone != nil || person.email != nil {
                Card {
                    VStack(spacing: Spacing.md) {
                        SectionHeader("Контакты")
                        if let phone = person.phone, !phone.isEmpty {
                            StatRow("Телефон", value: phone, icon: "phone")
                        }
                        if let email = person.email, !email.isEmpty {
                            StatRow("Почта", value: email, icon: "envelope")
                        }
                    }
                }
            }

            Card {
                VStack(spacing: Spacing.md) {
                    SectionHeader("Доступ в систему")
                    StatRow(
                        "Учётная запись",
                        value: person.hasLogin ? "есть" : "нет",
                        valueColor: person.hasLogin ? Theme.text : Theme.textDim,
                        icon: "key"
                    )
                    if let last = person.lastLogin {
                        StatRow("Последний вход", value: last.formatted(.dateTime.day().month(.abbreviated).year()), icon: "clock.arrow.circlepath")
                    }
                    // Уволенный с живым доступом — открытая дверь: он всё ещё
                    // может зайти в кассу и отчёты.
                    if person.isDismissed && person.hasLogin {
                        RowDivider()
                        InlineEmpty(
                            icon: "exclamationmark.triangle.fill",
                            text: "Уволен, но вход не закрыт",
                            tint: Theme.negative
                        )
                    }
                }
            }
        }
        .background(Theme.background)
        .navigationTitle(person.fullName)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}

// ── Структура команды ────────────────────────────────────────────────────────

@MainActor @Observable
final class TeamStructureStore {
    private(set) var structure: TeamStructure?
    private(set) var error: APIError?

    private let service: TeamAdminService

    init(api: APIClient) { service = TeamAdminService(api: api) }

    func load() async {
        do {
            structure = try await service.loadStructure()
            error = nil
        } catch let e as APIError {
            error = e
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }
}

/// Кто на какой точке и кому подчиняется.
///
/// Разрывы структуры показаны отдельными карточками: оператор без точки не
/// попадёт ни в график, ни в расчёт по правилу компании, а оператор без
/// руководителя — ничей, и спросить за смену не с кого.
struct StructureScreen: View {
    @Environment(\.api) private var api
    @State private var store: TeamStructureStore?

    var body: some View {
        Group {
            if let store {
                if let error = store.error, store.structure == nil {
                    ErrorStateView(error: error) { Task { await store.load() } }
                } else if let structure = store.structure {
                    content(structure)
                } else {
                    LoadingRows(count: 6)
                }
            } else {
                LoadingRows(count: 6)
            }
        }
        .background(Theme.background)
        .navigationTitle("Структура команды")
        .toolbar { LogoutToolbarItem() }
        .task {
            if store == nil {
                let s = TeamStructureStore(api: api)
                store = s
                await s.load()
            }
        }
        .refreshable { await store?.load() }
    }

    @ViewBuilder
    private func content(_ structure: TeamStructure) -> some View {
        if structure.operators.isEmpty && structure.companies.isEmpty {
            WideEmptyState(
                icon: "person.3.sequence",
                title: "Структуры нет",
                message: "Здесь появятся точки, их смены и руководители."
            )
        } else {
            let orphans = structure.unassignedOperators
            let leaderless = structure.operatorsWithoutLead

            ScreenScroll {
                DashboardGrid {
                    MetricTile(
                        label: "Точек",
                        value: "\(structure.companies.count)",
                        icon: "building.2.fill",
                        accent: Theme.brand
                    )
                    MetricTile(
                        label: "Операторов",
                        value: "\(structure.operators.count)",
                        icon: "person.3.fill",
                        accent: Theme.info
                    )
                    MetricTile(
                        label: "Без точки",
                        value: "\(orphans.count)",
                        icon: "person.fill.questionmark",
                        accent: orphans.isEmpty ? Theme.textDim : Theme.warning
                    )
                }

                if !orphans.isEmpty {
                    StructureGapCard(
                        title: "Не прикреплены к точке",
                        subtitle: "не попадут ни в график, ни в расчёт смены",
                        icon: "person.fill.questionmark",
                        accent: Theme.warning,
                        operators: orphans
                    )
                }

                if !leaderless.isEmpty {
                    StructureGapCard(
                        title: "Без руководителя",
                        subtitle: "за смену спросить не с кого",
                        icon: "person.badge.minus",
                        accent: Theme.textDim,
                        operators: leaderless
                    )
                }

                DashboardGrid {
                    ForEach(structure.companies) { company in
                        CompanyTeamCard(company: company, structure: structure)
                    }
                }

                if !structure.leads.isEmpty {
                    LeadsCard(structure: structure)
                }
            }
        }
    }
}

private struct CompanyTeamCard: View {
    let company: Company
    let structure: TeamStructure

    var body: some View {
        let team = structure.staffedBy(companyID: company.id)

        return Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader(
                    company.name,
                    subtitle: "\(team.count) \(pluralize(team.count, "человек", "человека", "человек"))"
                ) {
                    if let code = company.code, !code.isEmpty {
                        StatusChip(code.uppercased(), kind: .neutral)
                    }
                }

                if team.isEmpty {
                    InlineEmpty(icon: "person.slash", text: "На точке никого нет", tint: Theme.warning)
                } else {
                    ForEach(Array(sorted(team).enumerated()), id: \.element.id) { index, member in
                        if index > 0 { RowDivider() }
                        let assignment = structure.assignment(operatorID: member.id, companyID: company.id)
                        HStack(spacing: Spacing.md) {
                            Text(member.initials)
                                .font(.system(size: 11, weight: .semibold, design: .rounded))
                                .foregroundStyle(Theme.brand)
                                .frame(width: 28, height: 28)
                                .background(Theme.brand.opacity(0.14), in: Circle())

                            VStack(alignment: .leading, spacing: 1) {
                                Text(member.displayName)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.text)
                                    .lineLimit(1)
                                Text(assignment?.roleLabel ?? "Оператор")
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.textDim)
                            }

                            Spacer(minLength: Spacing.sm)

                            if assignment?.isPrimary == true {
                                StatusChip("основная", kind: .info)
                            }
                            if assignment?.isSenior == true {
                                Image(systemName: "star.fill")
                                    .font(.system(size: 11))
                                    .foregroundStyle(Theme.warning)
                            }
                        }
                    }
                }
            }
        }
    }

    /// Старшие первыми: за ними доплата и ответственность за смену.
    private func sorted(_ team: [TeamOperator]) -> [TeamOperator] {
        team.sorted { left, right in
            let leftSenior = structure.assignment(operatorID: left.id, companyID: company.id)?.isSenior ?? false
            let rightSenior = structure.assignment(operatorID: right.id, companyID: company.id)?.isSenior ?? false
            if leftSenior != rightSenior { return leftSenior }
            return left.displayName < right.displayName
        }
    }
}

private struct LeadsCard: View {
    let structure: TeamStructure

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Руководители", subtitle: "кто за кого отвечает")

                ForEach(Array(structure.leads.enumerated()), id: \.element.id) { index, lead in
                    if index > 0 { RowDivider() }
                    let team = structure.subordinates(ofLead: lead.id)
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        HStack(spacing: Spacing.md) {
                            Text(lead.initials)
                                .font(.system(size: 11, weight: .semibold, design: .rounded))
                                .foregroundStyle(Theme.accent)
                                .frame(width: 28, height: 28)
                                .background(Theme.accent.opacity(0.14), in: Circle())

                            VStack(alignment: .leading, spacing: 1) {
                                Text(lead.fullName)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.text)
                                    .lineLimit(1)
                                Text(lead.roleLabel)
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.textDim)
                            }

                            Spacer(minLength: Spacing.sm)

                            Text("\(team.count)")
                                .font(Typography.callout.weight(.medium))
                                .monospacedDigit()
                                .foregroundStyle(team.isEmpty ? Theme.textDim : Theme.text)
                        }

                        if !team.isEmpty {
                            Text(team.compactMap(\.operatorName).joined(separator: ", "))
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textDim)
                                .lineLimit(2)
                        }
                    }
                }
            }
        }
    }
}

private struct StructureGapCard: View {
    let title: String
    let subtitle: String
    let icon: String
    /// Цвет значка. Рамку им не красим: `Card` рисует акцент с прозрачностью
    /// 0.35, и на приглушённом цвете обводка выходила ярче, чем у карточек
    /// с настоящей тревогой.
    let accent: Color
    let operators: [TeamOperator]

    /// Разрыв в структуре — это предупреждение, но разной силы: оператор без
    /// точки не попадёт ни в график, ни в расчёт, а без руководителя — просто
    /// некому спросить. Рамкой выделяем только первое.
    var isBlocking: Bool { accent == Theme.warning || accent == Theme.negative }

    var body: some View {
        Card(accent: isBlocking ? accent : nil) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader(title, subtitle: subtitle) {
                    Image(systemName: icon)
                        .font(.system(size: 14))
                        .foregroundStyle(accent)
                }

                ForEach(Array(operators.enumerated()), id: \.element.id) { index, member in
                    if index > 0 { RowDivider() }
                    HStack(spacing: Spacing.md) {
                        Text(member.displayName)
                            .font(Typography.callout)
                            .foregroundStyle(Theme.text)
                            .lineLimit(1)
                        Spacer(minLength: Spacing.sm)
                        if let position = member.position, !position.isEmpty {
                            Text(position)
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textDim)
                        }
                    }
                }
            }
        }
    }
}

// ── Права и пароли ───────────────────────────────────────────────────────────

@MainActor @Observable
final class AccessStore {
    private(set) var overview: AccessOverview?
    private(set) var error: APIError?

    private let service: TeamAdminService

    init(api: APIClient) { service = TeamAdminService(api: api) }

    func load() async {
        do {
            overview = try await service.loadAccess()
            error = nil
        } catch let e as APIError {
            error = e
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }
}

/// Какая роль что может — и где розданы необратимые права.
///
/// Матрица прав на сайте — это 265 переключателей; читать её целиком незачем.
/// Здесь роль сведена к трём числам и списку опасного: удаления, выгрузки
/// логинов, списания долгов. Именно они превращают ошибку сотрудника в
/// потерю денег.
struct AccessScreen: View {
    @Environment(\.api) private var api

    @State private var store: AccessStore?
    @State private var selected: RoleAccessSummary?

    var body: some View {
        VStack(spacing: 0) {
            if let overview = store?.overview {
                HStack(spacing: Spacing.md) {
                    SummaryPill(title: "Ролей", value: "\(overview.roles.count)", tint: Theme.textMuted)
                    SummaryPill(
                        title: "Опасных прав выдано",
                        value: "\(overview.totalDangerous)",
                        tint: overview.totalDangerous > 0 ? Theme.warning : Theme.positive
                    )
                    SummaryPill(title: "Прав снято", value: "\(overview.totalRevoked)", tint: Theme.info)
                }
                .padding(.horizontal, Spacing.lg)
                .padding(.vertical, Spacing.md)
            }

            if let store {
                if let error = store.error, store.overview == nil {
                    ErrorStateView(error: error) { Task { await store.load() } }
                } else if let overview = store.overview {
                    MasterDetail(
                        items: sortedRoles(overview),
                        selection: $selected,
                        listWidth: 300
                    ) { role in
                        RoleAccessRow(role: role)
                    } detail: { role in
                        RoleAccessDetail(role: role, catalogSize: overview.catalogSize)
                    } empty: {
                        WideEmptyState(
                            icon: "lock.shield",
                            title: "Ролей нет",
                            message: "Выберите роль, чтобы увидеть, что ей открыто."
                        )
                    }
                } else {
                    LoadingRows(count: 6)
                }
            } else {
                LoadingRows(count: 6)
            }
        }
        .background(Theme.background)
        .navigationTitle("Права и доступ")
        .toolbar { LogoutToolbarItem() }
        .task {
            if store == nil {
                let s = AccessStore(api: api)
                store = s
                await s.load()
            }
        }
        .refreshable { await store?.load() }
    }

    /// Роли с опасными правами наверх: с них начинается разбор. Владелец,
    /// суперадмин и операторы уходят вниз — настраивать в них нечего.
    private func sortedRoles(_ overview: AccessOverview) -> [RoleAccessSummary] {
        overview.roles.sorted { left, right in
            let leftFixed = left.ignoresMatrix || left.grantsNothing
            let rightFixed = right.ignoresMatrix || right.grantsNothing
            if leftFixed != rightFixed { return rightFixed }
            if left.dangerousCount != right.dangerousCount { return left.dangerousCount > right.dangerousCount }
            return left.role < right.role
        }
    }
}

private struct RoleAccessRow: View {
    let role: RoleAccessSummary

    var body: some View {
        HStack(spacing: Spacing.md) {
            Image(systemName: icon)
                .font(.system(size: 14))
                .foregroundStyle(role.ignoresMatrix ? Theme.warning : Theme.info)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 1) {
                Text(role.roleLabel)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text("\(role.openPages.count) \(pluralize(role.openPages.count, "раздел", "раздела", "разделов")) открыто")
                    .font(Typography.caption)
                    .monospacedDigit()
                    .foregroundStyle(Theme.textDim)
            }

            Spacer(minLength: Spacing.sm)

            if role.ignoresMatrix {
                StatusChip("всё", kind: .warning)
            } else if role.grantsNothing {
                StatusChip("нет доступа", kind: .neutral)
            } else if role.dangerousCount > 0 {
                StatusChip("\(role.dangerousCount) опасных", kind: .warning)
            } else {
                StatusChip("без опасных", kind: .good)
            }
        }
    }

    private var icon: String {
        if role.ignoresMatrix { return "crown.fill" }
        if role.grantsNothing { return "person.slash" }
        return "person.badge.key.fill"
    }
}

private struct RoleAccessDetail: View {
    let role: RoleAccessSummary
    let catalogSize: Int

    var body: some View {
        ScreenScroll {
            if let note = specialNote {
                Card(accent: Theme.warning) {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        SectionHeader(role.roleLabel, subtitle: "настройки на эту роль не влияют")
                        Text(note)
                            .font(Typography.callout)
                            .foregroundStyle(Theme.textMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }

            Card {
                VStack(spacing: Spacing.md) {
                    SectionHeader(role.roleLabel, subtitle: "что открыто роли")
                    StatRow("Прав открыто", value: "\(role.grantedCount) из \(catalogSize)", icon: "checkmark.circle")
                    StatRow(
                        "Прав снято",
                        value: "\(role.revokedCount)",
                        valueColor: role.revokedCount > 0 ? Theme.info : Theme.textDim,
                        icon: "minus.circle"
                    )
                    StatRow("Разделов открыто", value: "\(role.openPages.count)", icon: "square.grid.2x2")
                    RowDivider()
                    StatRow(
                        "Необратимых прав",
                        value: "\(role.dangerousCount)",
                        valueColor: role.dangerousCount > 0 ? Theme.warning : Theme.positive,
                        icon: "exclamationmark.triangle",
                        emphasized: true
                    )
                }
            }

            if !role.pagesWithDanger.isEmpty {
                Card(accent: Theme.warning) {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        SectionHeader("Необратимые права", subtitle: "удаления, выгрузки, списания")

                        ForEach(Array(role.pagesWithDanger.prefix(20).enumerated()), id: \.element.id) { index, page in
                            if index > 0 { RowDivider() }
                            VStack(alignment: .leading, spacing: Spacing.xs) {
                                Text(page.label)
                                    .font(Typography.callout.weight(.medium))
                                    .foregroundStyle(Theme.text)
                                Text(page.dangerousGranted.map(\.label).joined(separator: " · "))
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.warning)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
            }

            if !role.closedPages.isEmpty {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        SectionHeader("Разделы закрыты", subtitle: "роль их не увидит")
                        Text(role.closedPages.map(\.label).sorted().joined(separator: " · "))
                            .font(Typography.callout)
                            .foregroundStyle(Theme.textMuted)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }

            if !role.closedPaths.isEmpty {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        // Отдельный рубильник страниц (role_permissions) живёт
                        // рядом с матрицей и режет доступ независимо от неё.
                        SectionHeader("Страницы выключены вручную", subtitle: "рубильник поверх прав")
                        Text(role.closedPageLabels.joined(separator: " · "))
                            .font(Typography.callout)
                            .foregroundStyle(Theme.textMuted)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }

            if role.revokedCount > 0 {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        SectionHeader("Что снято", subtitle: "по разделам")
                        ForEach(Array(revokedPages.prefix(20).enumerated()), id: \.element.id) { index, page in
                            if index > 0 { RowDivider() }
                            VStack(alignment: .leading, spacing: Spacing.xs) {
                                Text(page.label)
                                    .font(Typography.callout.weight(.medium))
                                    .foregroundStyle(Theme.text)
                                Text(page.revokedCapabilities.map(\.label).joined(separator: " · "))
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.textDim)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
            }
        }
        .background(Theme.background)
        .navigationTitle(role.roleLabel)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }

    private var revokedPages: [PageAccess] {
        role.pages
            .filter { !$0.revoked.isEmpty }
            .sorted { $0.revoked.count > $1.revoked.count }
    }

    /// Три роли живут вне матрицы, и без объяснения цифры вводят в заблуждение.
    private var specialNote: String? {
        switch role.role {
        case "owner":
            "Владелец организации всегда получает весь каталог прав. Ограничить его можно пакетом подписки, но не переключателями."
        case "super_admin":
            "Супер-админ обходит проверки прав целиком."
        case "other":
            "Роль операторов. В веб-админку они не заходят — работают в программе точки, и права отсюда на них не распространяются."
        default:
            nil
        }
    }
}

// ── Учётные записи ───────────────────────────────────────────────────────────

@MainActor @Observable
final class CredentialsStore {
    private(set) var accounts: [TeamOperator]?
    private(set) var error: APIError?

    private let service: TeamAdminService

    init(api: APIClient) { service = TeamAdminService(api: api) }

    func load() async {
        do {
            accounts = try await service.loadOperatorAccounts()
            error = nil
        } catch let e as APIError {
            error = e
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }
}

/// Кто чем заходит в систему.
///
/// Пароли здесь не показываются и не хранятся — ни в списке, ни в карточке.
/// Экран отвечает на другой вопрос: у кого вообще нет учётной записи и кто
/// давно не заходил. Выдача и сброс пароля остаются на сайте, где действие
/// попадает в журнал.
struct CredentialsScreen: View {
    @Environment(\.api) private var api

    @State private var store: CredentialsStore?
    @State private var selected: TeamOperator?
    @State private var search = ""
    @State private var onlyProblems = false

    private static let staleLoginDays = 30

    var body: some View {
        VStack(spacing: 0) {
            if let accounts = store?.accounts {
                HStack(spacing: Spacing.md) {
                    SummaryPill(title: "Учётных записей", value: "\(accounts.filter(hasLogin).count)", tint: Theme.brand)
                    SummaryPill(
                        title: "Без входа в систему",
                        value: "\(accounts.filter { !hasLogin($0) }.count)",
                        tint: accounts.contains { !hasLogin($0) } ? Theme.warning : Theme.positive
                    )
                    SummaryPill(
                        title: "Не заходили \(Self.staleLoginDays)+ дней",
                        value: "\(accounts.filter(isStale).count)",
                        tint: Theme.textMuted
                    )
                }
                .padding(.horizontal, Spacing.lg)
                .padding(.vertical, Spacing.md)
            }

            if let store {
                if let error = store.error, store.accounts == nil {
                    ErrorStateView(error: error) { Task { await store.load() } }
                } else if store.accounts == nil {
                    LoadingRows(count: 7)
                } else {
                    MasterDetail(
                        items: filtered,
                        selection: $selected,
                        listWidth: 320
                    ) { account in
                        CredentialsRow(account: account, isStale: isStale(account))
                    } detail: { account in
                        CredentialsDetail(account: account)
                    } empty: {
                        WideEmptyState(
                            icon: "key.horizontal",
                            title: "Учётных записей нет",
                            message: "Здесь появятся логины операторов действующих точек."
                        )
                    }
                }
            } else {
                LoadingRows(count: 7)
            }
        }
        .background(Theme.background)
        .navigationTitle("Учётные записи")
        .searchable(text: $search, prompt: "Имя или логин")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Toggle(isOn: $onlyProblems) {
                    Label("Только проблемные", systemImage: "exclamationmark.triangle")
                }
                .toggleStyle(.button)
            }
            LogoutToolbarItem()
        }
        .task {
            if store == nil {
                let s = CredentialsStore(api: api)
                store = s
                await s.load()
            }
        }
        .refreshable { await store?.load() }
    }

    private func hasLogin(_ account: TeamOperator) -> Bool {
        (account.username?.isEmpty == false)
    }

    /// Оператор с учёткой, который давно не заходил, — либо уже не работает,
    /// либо работает под чужим логином. И то и другое стоит проверить.
    private func isStale(_ account: TeamOperator) -> Bool {
        guard hasLogin(account) else { return false }
        guard let last = account.lastLogin else { return true }
        let border = Calendar.current.date(byAdding: .day, value: -Self.staleLoginDays, to: Date()) ?? .distantPast
        return last < border
    }

    private var filtered: [TeamOperator] {
        var items = store?.accounts ?? []

        if onlyProblems {
            items = items.filter { !hasLogin($0) || isStale($0) }
        }

        if !search.isEmpty {
            items = items.filter {
                $0.displayName.localizedCaseInsensitiveContains(search)
                    || ($0.username?.localizedCaseInsensitiveContains(search) ?? false)
            }
        }

        // Сначала те, у кого учётки нет вовсе: это дыра в работе точки, а не
        // мелочь оформления.
        return items.sorted { left, right in
            if hasLogin(left) != hasLogin(right) { return !hasLogin(left) }
            return left.displayName < right.displayName
        }
    }
}

private struct CredentialsRow: View {
    let account: TeamOperator
    let isStale: Bool

    var body: some View {
        HStack(spacing: Spacing.md) {
            Thumbnail(url: account.photoURL, side: 36, cornerRadius: 18, fallbackText: account.initials)

            VStack(alignment: .leading, spacing: 1) {
                Text(account.displayName)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                if let login = account.username, !login.isEmpty {
                    Text(login)
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                        .lineLimit(1)
                } else {
                    Text("нет учётной записи")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.warning)
                }
            }

            Spacer(minLength: Spacing.sm)

            if let last = account.lastLogin {
                VStack(alignment: .trailing, spacing: 1) {
                    Text(last.formatted(.dateTime.day().month(.abbreviated)))
                        .font(Typography.caption)
                        .foregroundStyle(isStale ? Theme.textDim : Theme.textMuted)
                    Text("вход")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                }
            } else if account.username?.isEmpty == false {
                StatusChip("ни разу", kind: .warning)
            }
        }
    }
}

private struct CredentialsDetail: View {
    let account: TeamOperator

    var body: some View {
        ScreenScroll {
            Card {
                HStack(spacing: Spacing.lg) {
                    Thumbnail(url: account.photoURL, side: 64, cornerRadius: 32, fallbackText: account.initials)

                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        Text(account.displayName)
                            .font(Typography.title)
                            .foregroundStyle(Theme.text)
                        if let position = account.position, !position.isEmpty {
                            Text(position)
                                .font(Typography.callout)
                                .foregroundStyle(Theme.textMuted)
                        }
                        HStack(spacing: Spacing.sm) {
                            StatusChip(account.isActive ? "работает" : "не работает", kind: account.isActive ? .good : .neutral)
                            StatusChip(account.hasTelegram ? "Telegram привязан" : "без Telegram", kind: account.hasTelegram ? .info : .neutral)
                        }
                    }
                    Spacer()
                }
            }

            Card {
                VStack(spacing: Spacing.md) {
                    SectionHeader("Вход в систему")
                    StatRow(
                        "Логин",
                        value: account.username?.isEmpty == false ? account.username! : "не выдан",
                        valueColor: account.username?.isEmpty == false ? Theme.text : Theme.warning,
                        icon: "person.text.rectangle",
                        emphasized: true
                    )
                    if let last = account.lastLogin {
                        StatRow(
                            "Последний вход",
                            value: last.formatted(.dateTime.day().month(.wide).year().hour().minute()),
                            icon: "clock.arrow.circlepath"
                        )
                    } else if account.username?.isEmpty == false {
                        StatRow("Последний вход", value: "ни разу", valueColor: Theme.warning, icon: "clock.arrow.circlepath")
                    }
                }
            }

            Card(accent: Theme.info) {
                HStack(alignment: .top, spacing: Spacing.md) {
                    Image(systemName: "lock.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.info)
                    Text("Пароль в приложении не показывается. Выдать новый можно на сайте — там действие записывается в журнал, и видно, кто его сделал.")
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            if account.phone != nil || account.hireDate != nil {
                Card {
                    VStack(spacing: Spacing.md) {
                        SectionHeader("Профиль")
                        if let phone = account.phone, !phone.isEmpty {
                            StatRow("Телефон", value: phone, icon: "phone")
                        }
                        if let hired = account.hireDate {
                            StatRow("Принят", value: hired.formatted(.dateTime.day().month(.wide).year()), icon: "calendar.badge.plus")
                        }
                    }
                }
            }
        }
        .background(Theme.background)
        .navigationTitle(account.displayName)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}
