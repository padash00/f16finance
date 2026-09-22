import OrdaKit
import OrdaUI
import SwiftUI

// ── Общее для кадровых экранов ──────────────────────────────────────────────

/// Шапка карточки человека как профиль в банке: крупный кружок по центру,
/// имя, должность и строка статусов мелким цветным текстом. Плашки в ряд
/// съедали ширину и переносились на вторую строку.
private struct AdminProfileHeader: View {
    let name: String
    let photoURL: String?
    let subtitle: String?
    var isActive = true
    /// Статусы: текст, иконка, цвет.
    var badges: [(String, String, Color)] = []

    var body: some View {
        VStack(spacing: Spacing.sm) {
            if let photoURL, !photoURL.isEmpty {
                Thumbnail(url: photoURL, side: 84, cornerRadius: 42, fallbackText: String(name.prefix(1)))
                    .overlay(Circle().stroke(Theme.border, lineWidth: 0.5))
                    .opacity(isActive ? 1 : 0.55)
            } else {
                PersonInitial(name: name, isActive: isActive, size: 84)
            }
            Text(name)
                .font(.system(size: 24, weight: .bold, design: .rounded))
                .foregroundStyle(Theme.text)
                .multilineTextAlignment(.center)
            if let subtitle, !subtitle.isEmpty {
                Text(subtitle)
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.textMuted)
            }
            if !badges.isEmpty {
                HStack(spacing: Spacing.md) {
                    ForEach(badges, id: \.0) { text, icon, color in
                        Label(text, systemImage: icon)
                            .foregroundStyle(color)
                    }
                }
                .font(.system(size: 13, weight: .semibold))
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Spacing.md)
    }
}

/// Строка данных профиля: иконка в кружке, подпись серым, значение справа.
private struct AdminInfoRow: View {
    let icon: String
    let tint: Color
    let label: String
    let value: String
    var valueColor: Color = Theme.text

    var body: some View {
        HStack(spacing: Spacing.md) {
            TintedIcon(systemName: icon, tint: tint, size: 36)
            Text(label)
                .font(.system(size: 15))
                .foregroundStyle(Theme.textMuted)
            Spacer(minLength: Spacing.sm)
            Text(value)
                .font(.system(size: 15, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(valueColor)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
    }
}

/// Мелкая серая подпись справа от заголовка секции.
private struct SectionNote: View {
    let text: String
    var color: Color = Theme.textDim

    var body: some View {
        Text(text)
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(color)
            .lineLimit(1)
    }
}

// ── Правила зарплаты ─────────────────────────────────────────────────────────

@MainActor @Observable
final class SalaryRulesStore {
    private(set) var book: SalaryRuleBook?
    private(set) var error: APIError?

    private let service: TeamAdminService
    /// Восстановление живёт в кадровом маршруте — он в общем сервисе.
    private let business: BusinessService

    init(api: APIClient) {
        service = TeamAdminService(api: api)
        business = BusinessService(api: api)
    }

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
                // Потолок смены — главная цифра: это максимум, который точка
                // может отдать человеку за смену. Число правил и стаж — подписи.
                HeroSummary(
                    title: "Потолок смены",
                    value: Money.format(book.activeRules.map(\.ceilingPerShift).max() ?? 0),
                    caption: "самая высокая ставка среди действующих правил",
                    footer: [
                        ("Правил действует", "\(book.activeRules.count)"),
                        ("Надбавка за стаж", book.maxSeniorityPercent > 0 ? "до \(Percent.format(book.maxSeniorityPercent))" : "нет"),
                    ],
                    colors: Theme.heroGradient
                )

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
        // Состояние — подписью у заголовка, без рамки: серая рамка
        // «отключённого» правила выделяла его сильнее действующих.
        OwnerSection(book.companyName(forCode: rule.companyCode)) {
            if !rule.isActive {
                SectionNote(text: "отключено")
            } else {
                Label(rule.isNight ? "ночь" : "день", systemImage: rule.isNight ? "moon.stars.fill" : "sun.max.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(rule.isNight ? Theme.accent : Theme.warning)
            }
        } content: {
            VStack(alignment: .leading, spacing: Spacing.md) {
                if !rule.isActive {
                    Text(rule.isNight ? "ночная смена" : "дневная смена")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textDim)
                }

                ForEach(rule.terms) { term in
                    HStack(spacing: Spacing.md) {
                        TintedIcon(systemName: term.icon, tint: term.isBonus ? Theme.positive : Theme.textDim, size: 32)
                        Text(term.text)
                            .font(.system(size: 15))
                            .foregroundStyle(Theme.textMuted)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: Spacing.sm)
                        Text(term.amount)
                            .font(.system(size: 15, weight: .semibold, design: .rounded))
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
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.textDim)
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
        OwnerSection("Надбавка за стаж") {
            SectionNote(text: "ко всем точкам")
        } content: {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Text("Процент к ставке, общий для всех точек")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
                ForEach(tiers) { tier in
                    AmountRow(
                        leading: { TintedIcon(systemName: "calendar.badge.clock", tint: Color(hex: 0x8B5CF6)) },
                        title: "Отработал \(tier.tenureLabel)",
                        amount: Percent.format(tier.bonusPercent, signed: true)
                    )
                }
            }
        }
    }
}

private struct SalaryHistoryCard: View {
    let changes: [SalaryRuleChange]

    var body: some View {
        OwnerSection("Кто менял ставки") {
            SectionNote(text: "последние правки")
        } content: {
            VStack(spacing: Spacing.sm) {
                ForEach(changes) { change in
                    HStack(spacing: Spacing.md) {
                        PersonInitial(name: change.actorEmail ?? "Система", size: 36)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(change.actorEmail ?? "Система")
                                .font(.system(size: 16, weight: .medium))
                                .foregroundStyle(Theme.text)
                                .lineLimit(1)
                            Text(subtitle(change))
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.textDim)
                                .lineLimit(1)
                        }
                        Spacer(minLength: Spacing.sm)
                        if let delta = change.baseDelta {
                            Text(Money.signed(delta))
                                .font(.system(size: 16, weight: .semibold, design: .rounded))
                                .monospacedDigit()
                                .foregroundStyle(delta > 0 ? Theme.negative : Theme.positive)
                        }
                    }
                    .padding(.vertical, Spacing.xs)
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
    /// Восстановление живёт в кадровом маршруте — он в общем сервисе.
    private let business: BusinessService

    init(api: APIClient) {
        service = TeamAdminService(api: api)
        business = BusinessService(api: api)
    }

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

    /// Вернуть уволенного. Возвращает текст ошибки или `nil`.
    ///
    /// Человек уходит и возвращается — обычное дело в клубе, особенно у
    /// студентов. Заводить его заново значит потерять стаж, историю смен и
    /// долги, а они за ним числятся.
    func restore(_ person: HRPerson) async -> String? {
        do {
            try await business.restorePerson(kind: person.kind, id: person.id)
            await load()
            return nil
        } catch let apiError as APIError {
            return apiError.userMessage
        } catch {
            return error.localizedDescription
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

                PillSegment(
                    options: HRFilter.allCases.map { (value: $0, title: $0.title) },
                    selection: $mode
                )
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
                        HRPersonDetail(person: person, store: store)
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
            PersonInitial(name: person.fullName, isActive: !person.isDismissed)

            VStack(alignment: .leading, spacing: 1) {
                Text(person.fullName)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(person.isDismissed ? Theme.textDim : Theme.text)
                    .lineLimit(1)
                Text(person.position ?? person.roleLabel)
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }

            Spacer(minLength: Spacing.sm)

            // Статус — цветной подписью, а не плашкой: плашка съедала полстроки.
            if person.isDismissed {
                VStack(alignment: .trailing, spacing: 2) {
                    Text("уволен")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.negative)
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
        .padding(.vertical, 2)
    }
}

private struct HRPersonDetail: View {
    let person: HRPerson
    /// Хранилище кадров: восстановление обновляет тот же список.
    let store: HRStore

    @Environment(\.access) private var access

    @State private var confirming = false
    @State private var isBusy = false
    @State private var error: String?

    /// Право то же, что проверяет сервер.
    private var canRestore: Bool { access?.can("hr.restore") ?? false }

    private var badges: [(String, String, Color)] {
        var result: [(String, String, Color)] = [
            person.isDismissed
                ? ("уволен", "xmark.circle.fill", Theme.negative)
                : ("работает", "checkmark.circle.fill", Theme.positive),
            (person.isOperator ? "оператор" : "штат", "person.fill", Theme.textDim),
        ]
        if person.isHybrid { result.append(("и штат, и смены", "arrow.triangle.2.circlepath", Theme.info)) }
        return result
    }

    var body: some View {
        ScreenScroll {
            AdminProfileHeader(
                name: person.fullName,
                photoURL: person.photoURL,
                subtitle: person.position ?? person.roleLabel,
                isActive: !person.isDismissed,
                badges: badges
            )

            if person.isDismissed, canRestore {
                // Вернуть — рядом с фактом увольнения, а не в конце карточки:
                // человек звонит и говорит «выхожу с понедельника», и решение
                // принимается прямо здесь.
                OwnerSection("Человек вернулся?") {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        Text("Восстановление вернёт доступ и сохранит стаж, историю смен и долги. Заводить заново — значит всё это потерять.")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textMuted)
                            .fixedSize(horizontal: false, vertical: true)

                        if let error {
                            Text(error)
                                .font(Typography.caption)
                                .foregroundStyle(Theme.negative)
                                .fixedSize(horizontal: false, vertical: true)
                        }

                        Button {
                            confirming = true
                        } label: {
                            HStack(spacing: Spacing.md) {
                                TintedIcon(systemName: "arrow.uturn.backward.circle", tint: Theme.positive)
                                Text("Восстановить")
                                    .font(.system(size: 16, weight: .medium))
                                    .foregroundStyle(Theme.text)
                                Spacer(minLength: Spacing.sm)
                                if isBusy {
                                    ProgressView().controlSize(.small)
                                } else {
                                    Image(systemName: "chevron.right")
                                        .font(.system(size: 12, weight: .semibold))
                                        .foregroundStyle(Theme.textDim)
                                }
                            }
                            .padding(.vertical, Spacing.xs)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.pressable)
                        .disabled(isBusy)
                    }
                }
                .alert("Восстановить \(person.fullName)?", isPresented: $confirming) {
                    Button("Восстановить") { Task { await restore() } }
                    Button("Отмена", role: .cancel) {}
                } message: {
                    Text("Вернутся вход в систему и назначения на точки. Долги и история останутся за человеком.")
                }
            }

            if person.isDismissed {
                OwnerSection("Увольнение") {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        if let left = person.leftOn {
                            AdminInfoRow(
                                icon: "calendar",
                                tint: Theme.negative,
                                label: "Последний день",
                                value: left.formatted(.dateTime.day().month(.wide).year()),
                                valueColor: Theme.negative
                            )
                        }
                        if let type = person.dismissalTypeLabel {
                            AdminInfoRow(icon: "doc.text", tint: Color(hex: 0xF59E0B), label: "Основание", value: type)
                        }
                        if let who = person.dismissedByName {
                            AdminInfoRow(icon: "person.badge.shield.checkmark", tint: Color(hex: 0x3B82F6), label: "Оформил", value: who)
                        }
                        if let reason = person.dismissalReason, !reason.isEmpty {
                            Text("«\(reason)»")
                                .font(.system(size: 15))
                                .foregroundStyle(Theme.textMuted)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.top, Spacing.xs)
                        }
                    }
                }
            }

            OwnerSection("В компании") {
                VStack(spacing: Spacing.sm) {
                    if let hired = person.hireDate {
                        AdminInfoRow(icon: "calendar.badge.plus", tint: Color(hex: 0x8B5CF6), label: "Принят", value: hired.formatted(.dateTime.day().month(.wide).year()))
                    }
                    if let months = person.tenureMonths() {
                        AdminInfoRow(
                            icon: "clock",
                            tint: Color(hex: 0x14B8A6),
                            label: person.isDismissed ? "Проработал" : "Стаж",
                            value: "\(months) \(pluralize(months, "месяц", "месяца", "месяцев"))"
                        )
                    }
                    AdminInfoRow(icon: "person.text.rectangle", tint: Color(hex: 0x3B82F6), label: "Роль", value: person.roleLabel)
                    if let salary = person.monthlySalary, salary > 0 {
                        AdminInfoRow(icon: "wallet.bifold", tint: Color(hex: 0x10B981), label: "Оклад", value: Money.format(salary))
                    }
                }
            }

            if person.phone != nil || person.email != nil {
                OwnerSection("Контакты") {
                    VStack(spacing: Spacing.sm) {
                        if let phone = person.phone, !phone.isEmpty {
                            AdminInfoRow(icon: "phone", tint: Color(hex: 0x10B981), label: "Телефон", value: phone)
                        }
                        if let email = person.email, !email.isEmpty {
                            AdminInfoRow(icon: "envelope", tint: Color(hex: 0x3B82F6), label: "Почта", value: email)
                        }
                    }
                }
            }

            OwnerSection("Доступ в систему") {
                VStack(spacing: Spacing.sm) {
                    AdminInfoRow(
                        icon: "key",
                        tint: Color(hex: 0xF59E0B),
                        label: "Учётная запись",
                        value: person.hasLogin ? "есть" : "нет",
                        valueColor: person.hasLogin ? Theme.text : Theme.textDim
                    )
                    if let last = person.lastLogin {
                        AdminInfoRow(icon: "clock.arrow.circlepath", tint: Color(hex: 0x14B8A6), label: "Последний вход", value: last.formatted(.dateTime.day().month(.abbreviated).year()))
                    }
                    // Уволенный с живым доступом — открытая дверь: он всё ещё
                    // может зайти в кассу и отчёты.
                    if person.isDismissed && person.hasLogin {
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

    private func restore() async {
        isBusy = true
        error = nil
        defer { isBusy = false }
        error = await store.restore(person)
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
                // Сколько людей — главная цифра; точки и «без точки» — её
                // расшифровка. Разрыв структуры подсвечен цветом карточки.
                HeroSummary(
                    title: "Операторов в структуре",
                    value: "\(structure.operators.count)",
                    caption: orphans.isEmpty ? "все прикреплены к точкам" : "есть разрывы — смотрите ниже",
                    footer: [
                        ("Точек", "\(structure.companies.count)"),
                        ("Без точки", "\(orphans.count)"),
                        ("Без руководителя", "\(leaderless.count)"),
                    ],
                    colors: orphans.isEmpty
                        ? Theme.heroAccent
                        : Theme.heroGradient
                )

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

        return OwnerSection(company.name) {
            SectionNote(text: [
                company.code.flatMap { $0.isEmpty ? nil : $0.uppercased() },
                "\(team.count) \(pluralize(team.count, "человек", "человека", "человек"))",
            ].compactMap { $0 }.joined(separator: " · "))
        } content: {
            if team.isEmpty {
                InlineEmpty(icon: "person.slash", text: "На точке никого нет", tint: Theme.warning)
            } else {
                VStack(spacing: Spacing.sm) {
                    ForEach(sorted(team)) { member in
                        let assignment = structure.assignment(operatorID: member.id, companyID: company.id)
                        HStack(spacing: Spacing.md) {
                            PersonInitial(name: member.displayName, size: 36)

                            VStack(alignment: .leading, spacing: 1) {
                                Text(member.displayName)
                                    .font(.system(size: 16, weight: .medium))
                                    .foregroundStyle(Theme.text)
                                    .lineLimit(1)
                                Text(assignment?.roleLabel ?? "Оператор")
                                    .font(.system(size: 13))
                                    .foregroundStyle(Theme.textDim)
                            }

                            Spacer(minLength: Spacing.sm)

                            if assignment?.isPrimary == true {
                                Text("основная")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(Theme.info)
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
        OwnerSection("Руководители") {
            SectionNote(text: "кто за кого отвечает")
        } content: {
            VStack(spacing: Spacing.sm) {
                ForEach(structure.leads) { lead in
                    let team = structure.subordinates(ofLead: lead.id)
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        HStack(spacing: Spacing.md) {
                            PersonInitial(name: lead.fullName, size: 36)

                            VStack(alignment: .leading, spacing: 1) {
                                Text(lead.fullName)
                                    .font(.system(size: 16, weight: .medium))
                                    .foregroundStyle(Theme.text)
                                    .lineLimit(1)
                                Text(lead.roleLabel)
                                    .font(.system(size: 13))
                                    .foregroundStyle(Theme.textDim)
                            }

                            Spacer(minLength: Spacing.sm)

                            Text("\(team.count)")
                                .font(.system(size: 16, weight: .semibold, design: .rounded))
                                .monospacedDigit()
                                .foregroundStyle(team.isEmpty ? Theme.textDim : Theme.text)
                        }

                        if !team.isEmpty {
                            Text(team.compactMap(\.operatorName).joined(separator: ", "))
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textDim)
                                .lineLimit(2)
                                .padding(.leading, 36 + Spacing.md)
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
    /// Цвет значка и подписи.
    let accent: Color
    let operators: [TeamOperator]

    var body: some View {
        OwnerSection(title) {
            TintedIcon(systemName: icon, tint: accent, size: 32)
        } content: {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                // Разрыв в структуре — предупреждение разной силы: без точки
                // человек выпадает из графика и расчёта, без руководителя —
                // просто некому спросить. Сила — цветом подписи.
                Text(subtitle)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(accent == Theme.textDim ? Theme.textDim : accent)
                ForEach(operators) { member in
                    HStack(spacing: Spacing.md) {
                        PersonInitial(name: member.displayName, size: 32)
                        Text(member.displayName)
                            .font(.system(size: 16, weight: .medium))
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
            TintedIcon(systemName: icon, tint: role.ignoresMatrix ? Theme.warning : Color(hex: 0x3B82F6))

            VStack(alignment: .leading, spacing: 1) {
                Text(role.roleLabel)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text("\(role.openPages.count) \(pluralize(role.openPages.count, "раздел", "раздела", "разделов")) открыто")
                    .font(Typography.caption)
                    .monospacedDigit()
                    .foregroundStyle(Theme.textDim)
            }

            Spacer(minLength: Spacing.sm)

            // Статус подписью, а не плашкой — роль с длинным названием
            // иначе обрезалась.
            Text(status.0)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(status.1)
                .lineLimit(1)
                .fixedSize()
        }
        .padding(.vertical, 2)
    }

    private var status: (String, Color) {
        if role.ignoresMatrix { return ("всё", Theme.warning) }
        if role.grantsNothing { return ("нет доступа", Theme.textDim) }
        if role.dangerousCount > 0 { return ("\(role.dangerousCount) опасных", Theme.warning) }
        return ("без опасных", Theme.positive)
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
                OwnerSection(role.roleLabel) {
                    SectionNote(text: "вне настроек", color: Theme.warning)
                } content: {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        Text("Настройки на эту роль не влияют")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(Theme.warning)
                        Text(note)
                            .font(.system(size: 15))
                            .foregroundStyle(Theme.textMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }

            // Открытые права — главная цифра роли; необратимые — то, из-за
            // чего сюда заходят, поэтому карточка краснеет, когда они есть.
            HeroSummary(
                title: "\(role.roleLabel): прав открыто",
                value: "\(role.grantedCount) из \(catalogSize)",
                caption: "\(role.openPages.count) \(pluralize(role.openPages.count, "раздел", "раздела", "разделов")) открыто",
                footer: [
                    ("Необратимых", "\(role.dangerousCount)"),
                    ("Прав снято", "\(role.revokedCount)"),
                    ("Разделов", "\(role.openPages.count)"),
                ],
                colors: role.dangerousCount > 0
                    ? Theme.heroNegative
                    : Theme.heroGradient
            )

            if !role.pagesWithDanger.isEmpty {
                OwnerSection("Необратимые права") {
                    SectionNote(text: "удаления, выгрузки", color: Theme.warning)
                } content: {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        ForEach(Array(role.pagesWithDanger.prefix(20))) { page in
                            HStack(alignment: .top, spacing: Spacing.md) {
                                TintedIcon(systemName: "exclamationmark.triangle.fill", tint: Theme.warning, size: 32)
                                VStack(alignment: .leading, spacing: Spacing.xs) {
                                    Text(page.label)
                                        .font(.system(size: 16, weight: .medium))
                                        .foregroundStyle(Theme.text)
                                    Text(page.dangerousGranted.map(\.label).joined(separator: " · "))
                                        .font(Typography.caption)
                                        .foregroundStyle(Theme.warning)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
            }

            if !role.closedPages.isEmpty {
                OwnerSection("Разделы закрыты") {
                    SectionNote(text: "роль их не увидит")
                } content: {
                    Text(role.closedPages.map(\.label).sorted().joined(separator: " · "))
                        .font(.system(size: 15))
                        .foregroundStyle(Theme.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }

            if !role.closedPaths.isEmpty {
                // Отдельный рубильник страниц (role_permissions) живёт рядом с
                // матрицей и режет доступ независимо от неё.
                OwnerSection("Страницы выключены вручную") {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        Text("рубильник поверх прав")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textDim)
                        Text(role.closedPageLabels.joined(separator: " · "))
                            .font(.system(size: 15))
                            .foregroundStyle(Theme.textMuted)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }

            if role.revokedCount > 0 {
                OwnerSection("Что снято") {
                    SectionNote(text: "по разделам")
                } content: {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        ForEach(Array(revokedPages.prefix(20))) { page in
                            HStack(alignment: .top, spacing: Spacing.md) {
                                TintedIcon(systemName: "minus.circle", tint: Color(hex: 0x3B82F6), size: 32)
                                VStack(alignment: .leading, spacing: Spacing.xs) {
                                    Text(page.label)
                                        .font(.system(size: 16, weight: .medium))
                                        .foregroundStyle(Theme.text)
                                    Text(page.revokedCapabilities.map(\.label).joined(separator: " · "))
                                        .font(Typography.caption)
                                        .foregroundStyle(Theme.textDim)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
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
            OperatorAvatar(person: account, size: 40)

            VStack(alignment: .leading, spacing: 1) {
                Text(account.displayName)
                    .font(.system(size: 16, weight: .medium))
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
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(isStale ? Theme.textDim : Theme.textMuted)
                    Text("вход")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                }
            } else if account.username?.isEmpty == false {
                Text("ни разу")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.warning)
            }
        }
        .padding(.vertical, 2)
    }
}

private struct CredentialsDetail: View {
    let account: TeamOperator

    var body: some View {
        ScreenScroll {
            AdminProfileHeader(
                name: account.displayName,
                photoURL: account.photoURL,
                subtitle: account.position,
                isActive: account.isActive,
                badges: [
                    account.isActive
                        ? ("работает", "checkmark.circle.fill", Theme.positive)
                        : ("не работает", "circle.fill", Theme.textDim),
                    account.hasTelegram
                        ? ("Telegram привязан", "paperplane.fill", Theme.info)
                        : ("без Telegram", "paperplane", Theme.textDim),
                ]
            )

            OwnerSection("Вход в систему") {
                VStack(spacing: Spacing.sm) {
                    AdminInfoRow(
                        icon: "person.text.rectangle",
                        tint: Color(hex: 0x3B82F6),
                        label: "Логин",
                        value: account.username?.isEmpty == false ? account.username! : "не выдан",
                        valueColor: account.username?.isEmpty == false ? Theme.text : Theme.warning
                    )
                    if let last = account.lastLogin {
                        AdminInfoRow(
                            icon: "clock.arrow.circlepath",
                            tint: Color(hex: 0x14B8A6),
                            label: "Последний вход",
                            value: last.formatted(.dateTime.day().month(.wide).year().hour().minute())
                        )
                    } else if account.username?.isEmpty == false {
                        AdminInfoRow(icon: "clock.arrow.circlepath", tint: Theme.warning, label: "Последний вход", value: "ни разу", valueColor: Theme.warning)
                    }
                }
            }

            OwnerSection("Пароль") {
                HStack(alignment: .top, spacing: Spacing.md) {
                    TintedIcon(systemName: "lock.fill", tint: Theme.info, size: 36)
                    Text("Пароль в приложении не показывается. Выдать новый можно на сайте — там действие записывается в журнал, и видно, кто его сделал.")
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            if account.phone != nil || account.hireDate != nil {
                OwnerSection("Профиль") {
                    VStack(spacing: Spacing.sm) {
                        if let phone = account.phone, !phone.isEmpty {
                            AdminInfoRow(icon: "phone", tint: Color(hex: 0x10B981), label: "Телефон", value: phone)
                        }
                        if let hired = account.hireDate {
                            AdminInfoRow(icon: "calendar.badge.plus", tint: Color(hex: 0x8B5CF6), label: "Принят", value: hired.formatted(.dateTime.day().month(.wide).year()))
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
