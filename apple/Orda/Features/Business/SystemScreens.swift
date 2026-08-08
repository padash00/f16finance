import OrdaKit
import OrdaUI
import SwiftUI

// ── Журнал событий ───────────────────────────────────────────────────────────

@MainActor @Observable
final class LogsStore {
    private(set) var items: [LogEntry] = []
    private(set) var total = 0
    private(set) var hasMore = false
    private(set) var isLoading = false
    private(set) var isLoadingMore = false
    private(set) var error: APIError?

    private(set) var domain: LogDomain = .all
    private(set) var search = ""

    /// Загружалась ли лента хоть раз: пустой ответ и «ещё не спрашивали» —
    /// разные состояния, и рисуются они по-разному.
    private(set) var hasLoaded = false

    private var page = 1
    private let service: SystemService

    init(api: APIClient) { service = SystemService(api: api) }

    func load() async {
        isLoading = true
        defer { isLoading = false; hasLoaded = true }
        page = 1
        do {
            let feed = try await service.logs(domain: domain, search: search, page: 1)
            items = feed.items
            total = feed.total
            hasMore = feed.hasMore
            error = nil
        } catch let e as APIError {
            error = e
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }

    /// Догрузка следующей страницы. Ошибку здесь не показываем экраном целиком:
    /// уже загруженные события остаются полезными, даже если хвост не пришёл.
    func loadMore() async {
        guard hasMore, !isLoadingMore, !isLoading else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let feed = try await service.logs(domain: domain, search: search, page: page + 1)
            page += 1
            // Лента пересобирается на сервере на каждый запрос, и между
            // страницами могло приехать новое событие — тогда хвост частично
            // повторит уже показанное. Дубли отсекаем по идентификатору.
            let known = Set(items.map(\.id))
            items.append(contentsOf: feed.items.filter { !known.contains($0.id) })
            total = feed.total
            hasMore = feed.hasMore
        } catch {
            hasMore = false
        }
    }

    func select(_ domain: LogDomain) async {
        guard domain != self.domain else { return }
        self.domain = domain
        await load()
    }

    func apply(search: String) async {
        let trimmed = search.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed != self.search else { return }
        self.search = trimmed
        await load()
    }

    var errorCount: Int { items.filter(\.isError).count }
}

/// Кто что изменил и когда — и отдельно то, что сломалось.
///
/// Журнал длинный по определению, поэтому фильтр и поиск уходят на сервер, а
/// не режут уже загруженное: искать по сотне видимых строк, когда за ними
/// тысячи, — самообман. Разрез «Ошибки» вынесен первым после «Всех»: за
/// журналом чаще всего идут именно с вопросом «что упало».
struct LogsScreen: View {
    @Environment(\.api) private var api

    @State private var store: LogsStore?
    @State private var query = ""
    @State private var expanded: Set<String> = []

    var body: some View {
        VStack(spacing: 0) {
            if let store {
                filterBar(store)
                Divider().overlay(Theme.border)
                feed(store)
            } else {
                LoadingRows(count: 8)
            }
        }
        .background(Theme.background)
        .navigationTitle("Журнал событий")
        .searchable(text: $query, prompt: "Поиск по журналу")
        .onSubmit(of: .search) { Task { await store?.apply(search: query) } }
        // Крестик в поле поиска не шлёт submit — иначе очистка не сбрасывала бы фильтр.
        .onChange(of: query) { _, new in
            if new.isEmpty { Task { await store?.apply(search: "") } }
        }
        .toolbar { LogoutToolbarItem() }
        .task {
            if store == nil {
                let created = LogsStore(api: api)
                store = created
                await created.load()
            }
        }
        .refreshable { await store?.load() }
    }

    private func filterBar(_ store: LogsStore) -> some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            ScrollView(.horizontal) {
                HStack(spacing: Spacing.sm) {
                    ForEach(LogDomain.allCases) { domain in
                        FilterChip(title: domain.label, isOn: store.domain == domain) {
                            Task { await store.select(domain) }
                        }
                    }
                }
                .padding(.horizontal, Spacing.lg)
            }
            .scrollIndicators(.hidden)

            HStack(spacing: Spacing.md) {
                SummaryPill(title: "Событий найдено", value: "\(store.total)", tint: Theme.brand)
                SummaryPill(
                    title: "Из них сбоев",
                    value: "\(store.errorCount)",
                    tint: store.errorCount > 0 ? Theme.negative : Theme.textDim
                )
                if !store.search.isEmpty {
                    SummaryPill(title: "Поиск", value: store.search, tint: Theme.info)
                }
            }
            .padding(.horizontal, Spacing.lg)
        }
        .padding(.vertical, Spacing.md)
    }

    @ViewBuilder
    private func feed(_ store: LogsStore) -> some View {
        if let error = store.error, store.items.isEmpty {
            ErrorStateView(error: error) { Task { await store.load() } }
        } else if store.isLoading && store.items.isEmpty {
            LoadingRows(count: 8)
        } else if store.items.isEmpty && store.hasLoaded {
            WideEmptyState(
                icon: "text.magnifyingglass",
                title: store.search.isEmpty ? "Событий нет" : "Ничего не нашлось",
                message: store.search.isEmpty
                    ? "В этом разрезе журнала пока пусто."
                    : "Попробуйте другой запрос или снимите фильтр."
            )
        } else {
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(store.items) { entry in
                        LogEntryRow(
                            entry: entry,
                            isExpanded: expanded.contains(entry.id)
                        ) {
                            if expanded.contains(entry.id) {
                                expanded.remove(entry.id)
                            } else {
                                expanded.insert(entry.id)
                            }
                        }
                        Divider().overlay(Theme.borderSoft)
                    }

                    if store.hasMore {
                        Button {
                            Task { await store.loadMore() }
                        } label: {
                            HStack(spacing: Spacing.sm) {
                                if store.isLoadingMore {
                                    ProgressView().controlSize(.small)
                                }
                                Text(store.isLoadingMore ? "Загружаем…" : "Показать ещё")
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(SecondaryButtonStyle())
                        .disabled(store.isLoadingMore)
                        .padding(Spacing.lg)
                    }
                }
                .frame(maxWidth: 960)
                .frame(maxWidth: .infinity)
            }
        }
    }
}

/// Строка журнала. Свёрнута — заголовок, кто и когда; развёрнута — построчная
/// расшифровка изменений, которую собрал сервер.
private struct LogEntryRow: View {
    let entry: LogEntry
    let isExpanded: Bool
    let toggle: () -> Void

    private var tint: Color {
        if entry.isError { return Theme.negative }
        switch entry.kind {
        case "notification": return Theme.info
        case "ai": return Theme.accent
        default: return Theme.textDim
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack(alignment: .top, spacing: Spacing.md) {
                Image(systemName: entry.icon)
                    .font(.system(size: 14))
                    .foregroundStyle(tint)
                    .frame(width: 22)

                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.title)
                        .font(Typography.callout)
                        .foregroundStyle(Theme.text)
                        .fixedSize(horizontal: false, vertical: true)
                        .multilineTextAlignment(.leading)

                    HStack(spacing: Spacing.sm) {
                        Text(entry.actorLabel)
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textMuted)
                        if let subtitle = entry.subtitle, !subtitle.isEmpty, subtitle != entry.title {
                            Text(subtitle)
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textDim)
                                .lineLimit(1)
                        }
                    }
                }

                Spacer(minLength: Spacing.sm)

                VStack(alignment: .trailing, spacing: 2) {
                    if let date = entry.createdAt {
                        Text(date.formatted(.dateTime.day().month(.abbreviated).hour().minute()))
                            .font(Typography.caption)
                            .monospacedDigit()
                            .foregroundStyle(Theme.textDim)
                    }
                    if entry.isError {
                        StatusChip("сбой", kind: .danger)
                    }
                }
            }

            if !entry.detailRows.isEmpty {
                Button(action: toggle) {
                    Label(
                        isExpanded ? "Свернуть" : "Подробности",
                        systemImage: isExpanded ? "chevron.up" : "chevron.down"
                    )
                    .font(Typography.caption)
                    .foregroundStyle(Theme.brand)
                }
                .buttonStyle(.plain)
                .padding(.leading, 34)
            }

            if isExpanded {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    ForEach(Array(entry.detailRows.enumerated()), id: \.offset) { _, row in
                        Text(row)
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textMuted)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(Spacing.md)
                .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
                .padding(.leading, 34)
            }
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.md)
        .contentShape(Rectangle())
        .onTapGesture { if !entry.detailRows.isEmpty { toggle() } }
    }
}

// ── Настройки системы ────────────────────────────────────────────────────────

@MainActor @Observable
final class SettingsStore {
    private(set) var data: SystemSettings?
    private(set) var isLoading = false
    private(set) var error: APIError?

    private let service: SystemService

    init(api: APIClient) { service = SystemService(api: api) }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            data = try await service.settings()
            error = nil
        } catch let e as APIError {
            error = e
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }
}

/// Справочники: точки, команда, категории расходов.
///
/// Лимит точек показан рядом с их количеством, а не спрятан в тарифе: попытка
/// завести точку сверх лимита упирается в отказ сервера, и узнавать об этом
/// в момент отказа поздно.
struct SettingsScreen: View {
    @Environment(\.api) private var api

    @State private var store: SettingsStore?

    var body: some View {
        ScreenScroll {
            if let store {
                if let error = store.error, store.data == nil {
                    ErrorStateView(error: error) { Task { await store.load() } }
                } else if let data = store.data {
                    content(data)
                } else {
                    loading
                }
            } else {
                loading
            }
        }
        .background(Theme.background)
        .navigationTitle("Настройки")
        .toolbar { LogoutToolbarItem() }
        .task {
            if store == nil {
                let created = SettingsStore(api: api)
                store = created
                await created.load()
            }
        }
        .refreshable { await store?.load() }
    }

    private var loading: some View {
        VStack(spacing: Spacing.lg) {
            Skeleton(height: 96, cornerRadius: Radius.lg)
            Skeleton(height: 220, cornerRadius: Radius.lg)
        }
    }

    @ViewBuilder
    private func content(_ data: SystemSettings) -> some View {
        VStack(spacing: Spacing.lg) {
            DashboardGrid {
                MetricTile(
                    label: "Точки",
                    value: data.companyLimit.map { "\(data.companies.count) / \($0)" } ?? "\(data.companies.count)",
                    icon: "building.2",
                    accent: data.isCompanyLimitReached ? Theme.warning : Theme.brand
                )
                MetricTile(
                    label: "Команда",
                    value: "\(data.staff.count)",
                    icon: "person.3",
                    accent: Theme.info
                )
                MetricTile(
                    label: "Категории расходов",
                    value: "\(data.categories.count)",
                    icon: "square.grid.2x2",
                    accent: Theme.accent
                )
                MetricTile(
                    label: "Бюджет в месяц",
                    value: Money.compact(data.monthlyBudgetTotal),
                    icon: "chart.pie",
                    accent: Theme.textMuted
                )
            }

            if data.isCompanyLimitReached {
                Card(accent: Theme.warning) {
                    HStack(spacing: Spacing.md) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(.system(size: 18))
                            .foregroundStyle(Theme.warning)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Лимит точек исчерпан")
                                .font(Typography.headline)
                                .foregroundStyle(Theme.text)
                            Text("Новую точку можно завести только после расширения тарифа.")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textMuted)
                        }
                        Spacer()
                    }
                }
            }

            SplitDashboard {
                companies(data)
                categories(data)
            } side: {
                team(data)
            }
        }
    }

    private func companies(_ data: SystemSettings) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader(
                    "Точки",
                    subtitle: data.freeCompanySlots.map { "свободно слотов: \($0)" }
                )

                if data.companies.isEmpty {
                    InlineEmpty(icon: "building.2", text: "Точек пока нет", tint: Theme.textDim)
                } else {
                    ForEach(Array(data.companies.enumerated()), id: \.element.id) { index, company in
                        if index > 0 { RowDivider() }
                        HStack(spacing: Spacing.md) {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(company.name)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.text)
                                if let code = company.code, !code.isEmpty {
                                    Text(code)
                                        .font(Typography.caption)
                                        .monospaced()
                                        .foregroundStyle(Theme.textDim)
                                }
                            }
                            Spacer(minLength: Spacing.sm)
                            if !company.showInStructure {
                                StatusChip("вне структуры", kind: .neutral)
                            }
                        }
                    }
                }
            }
        }
    }

    private func categories(_ data: SystemSettings) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader(
                    "Категории расходов",
                    subtitle: data.monthlyBudgetTotal > 0 ? "бюджет \(Money.format(data.monthlyBudgetTotal)) в месяц" : nil
                )

                if data.categories.isEmpty {
                    InlineEmpty(icon: "square.grid.2x2", text: "Категорий пока нет", tint: Theme.textDim)
                } else {
                    ForEach(Array(data.categories.enumerated()), id: \.element.id) { index, category in
                        if index > 0 { RowDivider() }
                        HStack(spacing: Spacing.md) {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(category.name)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.text)
                                if let group = category.accountingGroup, !group.isEmpty {
                                    Text(group)
                                        .font(Typography.caption)
                                        .foregroundStyle(Theme.textDim)
                                }
                            }
                            Spacer(minLength: Spacing.sm)
                            if let budget = category.monthlyBudget, budget > 0 {
                                Text(Money.format(budget))
                                    .font(Typography.callout.weight(.medium))
                                    .monospacedDigit()
                                    .foregroundStyle(Theme.textMuted)
                            } else {
                                Text("без бюджета")
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.textDim)
                            }
                        }
                    }
                }
            }
        }
    }

    private func team(_ data: SystemSettings) -> some View {
        // Владельцы и управляющие идут первыми: доступ к деньгам и правам —
        // именно то, что проверяют, открывая этот список.
        let sorted = data.staff.sorted { lhs, rhs in
            if lhs.isAdministrative != rhs.isAdministrative { return lhs.isAdministrative }
            return lhs.fullName < rhs.fullName
        }

        return Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Команда", subtitle: "активных: \(data.staff.filter(\.isActive).count)")

                if sorted.isEmpty {
                    InlineEmpty(icon: "person.3", text: "Сотрудников пока нет", tint: Theme.textDim)
                } else {
                    ForEach(Array(sorted.enumerated()), id: \.element.id) { index, member in
                        if index > 0 { RowDivider() }
                        HStack(spacing: Spacing.md) {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(member.fullName)
                                    .font(Typography.callout)
                                    .foregroundStyle(member.isActive ? Theme.text : Theme.textDim)
                                    .lineLimit(1)
                                if let email = member.email, !email.isEmpty {
                                    Text(email)
                                        .font(Typography.caption)
                                        .foregroundStyle(Theme.textDim)
                                        .lineLimit(1)
                                }
                            }
                            Spacer(minLength: Spacing.sm)
                            StatusChip(member.roleLabel, kind: member.isAdministrative ? .info : .neutral)
                        }
                    }
                }
            }
        }
    }
}

// ── Telegram ─────────────────────────────────────────────────────────────────

@MainActor @Observable
final class TelegramStore {
    private(set) var status: TelegramStatus?
    private(set) var allowed: TelegramAllowedUserList?
    private(set) var staff: [TelegramStaffLink] = []
    private(set) var isLoading = false
    private(set) var error: APIError?

    private let service: SystemService

    init(api: APIClient) { service = SystemService(api: api) }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            // Три независимых запроса: последовательная загрузка утроила бы
            // ожидание ради ровно того же экрана.
            async let status = service.telegramStatus()
            async let allowed = service.telegramAllowedUsers()
            async let staff = service.telegramStaff()
            self.status = try await status
            self.allowed = try await allowed
            self.staff = try await staff
            error = nil
        } catch let e as APIError {
            error = e
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }

    /// Работающие сотрудники, до которых бот не достучится.
    var unlinkedStaff: [TelegramStaffLink] {
        staff.filter { $0.isActive && !$0.isLinked }
    }
}

/// Telegram-бот: живой ли он и кому пишет.
///
/// Вопрос к этому разделу почти всегда один — «почему не пришло». Поэтому
/// сверху состояние канала, а ниже два списка получателей: отдельные адресаты
/// бота и сотрудники, у которых chat_id не проставлен вовсе.
struct TelegramScreen: View {
    @Environment(\.api) private var api

    @State private var store: TelegramStore?

    var body: some View {
        ScreenScroll {
            if let store {
                if let error = store.error, store.status == nil {
                    ErrorStateView(error: error) { Task { await store.load() } }
                } else if let status = store.status {
                    content(store, status)
                } else {
                    loading
                }
            } else {
                loading
            }
        }
        .background(Theme.background)
        .navigationTitle("Telegram")
        .toolbar { LogoutToolbarItem() }
        .task {
            if store == nil {
                let created = TelegramStore(api: api)
                store = created
                await created.load()
            }
        }
        .refreshable { await store?.load() }
    }

    private var loading: some View {
        VStack(spacing: Spacing.lg) {
            Skeleton(height: 140, cornerRadius: Radius.lg)
            Skeleton(height: 200, cornerRadius: Radius.lg)
        }
    }

    @ViewBuilder
    private func content(_ store: TelegramStore, _ status: TelegramStatus) -> some View {
        VStack(spacing: Spacing.lg) {
            connection(status)

            SplitDashboard {
                recipients(store)
            } side: {
                unlinked(store)
            }
        }
    }

    private func connection(_ status: TelegramStatus) -> some View {
        let accent: Color? = status.isOperational ? nil : Theme.warning

        return Card(accent: accent) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        Text(status.bot?.displayName ?? "Бот не подключён")
                            .font(Typography.title)
                            .foregroundStyle(Theme.text)
                        Text(status.isOperational ? "канал работает" : "канал настроен не полностью")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                    }
                    Spacer()
                    StatusChip(
                        status.isOperational ? "на связи" : "требует настройки",
                        kind: status.isOperational ? .good : .warning
                    )
                }

                RowDivider()

                StatRow(
                    "Токен бота",
                    value: status.hasToken ? "задан" : "не задан",
                    valueColor: status.hasToken ? Theme.positive : Theme.negative,
                    icon: "key"
                )
                StatRow(
                    "Общий чат",
                    value: status.hasChatId ? "задан" : "не задан",
                    valueColor: status.hasChatId ? Theme.positive : Theme.warning,
                    icon: "bubble.left.and.bubble.right"
                )
                StatRow(
                    "Вебхук",
                    value: (status.webhook?.isConfigured ?? false) ? "зарегистрирован" : "не зарегистрирован",
                    valueColor: (status.webhook?.isConfigured ?? false) ? Theme.positive : Theme.negative,
                    icon: "arrow.triangle.branch"
                )
                StatRow(
                    "Секрет вебхука",
                    value: status.hasWebhookSecret ? "задан" : "не задан",
                    valueColor: status.hasWebhookSecret ? Theme.positive : Theme.warning,
                    icon: "lock"
                )

                if let webhook = status.webhook {
                    if webhook.isBacklogged {
                        RowDivider()
                        StatRow(
                            "Необработанных сообщений",
                            value: "\(webhook.pendingUpdateCount)",
                            valueColor: Theme.warning,
                            icon: "tray.full",
                            emphasized: true
                        )
                    }
                    if let message = webhook.lastErrorMessage, !message.isEmpty {
                        RowDivider()
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Последняя ошибка")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textDim)
                            Text(message)
                                .font(Typography.callout)
                                .foregroundStyle(Theme.negative)
                                .fixedSize(horizontal: false, vertical: true)
                            if let date = webhook.lastErrorAt {
                                Text(date.formatted(.dateTime.day().month(.abbreviated).hour().minute()))
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.textDim)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func recipients(_ store: TelegramStore) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Получатели бота")

                if let allowed = store.allowed, !allowed.tableExists {
                    InlineEmpty(
                        icon: "wrench.and.screwdriver",
                        text: "Список получателей ещё не развёрнут в базе",
                        tint: Theme.warning
                    )
                } else if let users = store.allowed?.users, !users.isEmpty {
                    ForEach(Array(users.enumerated()), id: \.element.id) { index, user in
                        if index > 0 { RowDivider() }
                        HStack(spacing: Spacing.md) {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(user.displayName)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.text)
                                Text(user.telegramUserID)
                                    .font(Typography.caption)
                                    .monospaced()
                                    .foregroundStyle(Theme.textDim)
                            }
                            Spacer(minLength: Spacing.sm)
                            StatusChip(
                                user.canFinance ? "финансы" : "без финансов",
                                kind: user.canFinance ? .info : .neutral
                            )
                        }
                    }
                } else {
                    InlineEmpty(icon: "person.badge.plus", text: "Получателей нет", tint: Theme.textDim)
                }
            }
        }
    }

    private func unlinked(_ store: TelegramStore) -> some View {
        let unlinked = store.unlinkedStaff
        let accent: Color? = unlinked.isEmpty ? nil : Theme.warning

        return Card(accent: accent) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader(
                    "Без Telegram",
                    subtitle: "подключено \(store.staff.filter(\.isLinked).count) из \(store.staff.count)"
                )

                if unlinked.isEmpty {
                    InlineEmpty(
                        icon: "checkmark.circle",
                        text: "Все работающие сотрудники подключены",
                        tint: Theme.positive
                    )
                } else {
                    ForEach(Array(unlinked.enumerated()), id: \.element.id) { index, member in
                        if index > 0 { RowDivider() }
                        HStack(spacing: Spacing.md) {
                            Text(member.fullName)
                                .font(Typography.callout)
                                .foregroundStyle(Theme.text)
                                .lineLimit(1)
                            Spacer(minLength: Spacing.sm)
                            if let role = member.role, !role.isEmpty {
                                Text(role)
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.textDim)
                            }
                        }
                    }
                }
            }
        }
    }
}

// ── Диагностика ──────────────────────────────────────────────────────────────

@MainActor @Observable
final class DiagnosticsStore {
    private(set) var data: SystemDiagnostics?
    private(set) var isLoading = false
    private(set) var error: APIError?

    private let service: SystemService

    init(api: APIClient) { service = SystemService(api: api) }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            data = try await service.diagnostics()
            error = nil
        } catch let e as APIError {
            error = e
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }
}

/// Серверная самопроверка: миграции базы и регулярные задачи.
///
/// Ответ сервера — сырые списки; здесь он показан как набор проверок со
/// статусами. «Проверить не удалось» — отдельное состояние, а не зелёная
/// галочка: неприменённая миграция и невозможность её увидеть — разные беды,
/// и лечатся они по-разному.
struct DiagnosticsScreen: View {
    @Environment(\.api) private var api

    @State private var store: DiagnosticsStore?

    var body: some View {
        ScreenScroll {
            if let store {
                if let error = store.error, store.data == nil {
                    ErrorStateView(error: error) { Task { await store.load() } }
                } else if let data = store.data {
                    content(data)
                } else {
                    loading
                }
            } else {
                loading
            }
        }
        .background(Theme.background)
        .navigationTitle("Диагностика")
        .toolbar { LogoutToolbarItem() }
        .task {
            if store == nil {
                let created = DiagnosticsStore(api: api)
                store = created
                await created.load()
            }
        }
        .refreshable { await store?.load() }
    }

    private var loading: some View {
        VStack(spacing: Spacing.lg) {
            Skeleton(height: 96, cornerRadius: Radius.lg)
            Skeleton(height: 240, cornerRadius: Radius.lg)
        }
    }

    @ViewBuilder
    private func content(_ data: SystemDiagnostics) -> some View {
        let checks = data.checks

        VStack(spacing: Spacing.lg) {
            DashboardGrid {
                MetricTile(
                    label: "Проверок пройдено",
                    value: "\(data.okCount)",
                    icon: "checkmark.seal",
                    accent: Theme.positive
                )
                MetricTile(
                    label: "Предупреждений",
                    value: "\(data.warningCount)",
                    icon: "exclamationmark.triangle",
                    accent: data.warningCount > 0 ? Theme.warning : Theme.textDim
                )
                MetricTile(
                    label: "Сбоев",
                    value: "\(data.failureCount)",
                    icon: "xmark.octagon",
                    accent: data.failureCount > 0 ? Theme.negative : Theme.textDim
                )
            }

            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader("Проверки", subtitle: "всего \(checks.count)")

                    if checks.isEmpty {
                        InlineEmpty(icon: "stethoscope", text: "Сервер не вернул ни одной проверки", tint: Theme.textDim)
                    } else {
                        ForEach(Array(checks.enumerated()), id: \.element.id) { index, check in
                            if index > 0 { RowDivider() }
                            DiagnosticCheckRow(check: check)
                        }
                    }
                }
            }
        }
    }
}

private struct DiagnosticCheckRow: View {
    let check: DiagnosticCheck

    private var kind: StatusChip.Kind {
        switch check.state {
        case .ok: .good
        case .warning: .warning
        case .failure: .danger
        case .unknown: .neutral
        }
    }

    private var label: String {
        switch check.state {
        case .ok: "ок"
        case .warning: "внимание"
        case .failure: "сбой"
        case .unknown: "неизвестно"
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: 2) {
                Text(check.title)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(.leading)
                if let detail = check.detail, !detail.isEmpty {
                    Text(detail)
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                        .fixedSize(horizontal: false, vertical: true)
                        .multilineTextAlignment(.leading)
                }
            }

            Spacer(minLength: Spacing.sm)

            StatusChip(label, kind: kind)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
