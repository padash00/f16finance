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

    /// Разрезы — пилюлями, как фильтры выписки; итог одной строкой под ними,
    /// а не плашками: цифр тут две, отдельная карточка им не нужна.
    private func filterBar(_ store: LogsStore) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            ScrollView(.horizontal) {
                HStack(spacing: Spacing.sm) {
                    ForEach(LogDomain.allCases) { domain in
                        SysChip(title: domain.label, isOn: store.domain == domain) {
                            Task { await store.select(domain) }
                        }
                    }
                }
                .padding(.horizontal, Spacing.lg)
            }
            .scrollIndicators(.hidden)

            HStack(spacing: Spacing.md) {
                Label("\(store.total) найдено", systemImage: "list.bullet")
                    .foregroundStyle(Theme.textDim)
                Label("\(store.errorCount) сбоев", systemImage: "exclamationmark.octagon")
                    .foregroundStyle(store.errorCount > 0 ? Theme.negative : Theme.textDim)
                if !store.search.isEmpty {
                    Label(store.search, systemImage: "magnifyingglass")
                        .foregroundStyle(Theme.info)
                        .lineLimit(1)
                }
            }
            .font(.system(size: 13, weight: .medium))
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
                // Лента — белым блоком на сером фоне с отступами под иконку,
                // как история операций в банке.
                LazyVStack(spacing: 0) {
                    ForEach(Array(store.items.enumerated()), id: \.element.id) { index, entry in
                        if index > 0 { SysDivider() }
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
                        .padding(.vertical, Spacing.md)
                    }
                }
                .padding(.horizontal, Spacing.md)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                .padding(.horizontal, Spacing.lg)
                .padding(.bottom, Spacing.xxl)
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
                TintedIcon(systemName: entry.icon, tint: tint, size: 36)

                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.title)
                        .font(.system(size: 15, weight: .medium))
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
                    // Сбой подписью, а не плашкой: плашка сжимала заголовок.
                    if entry.isError {
                        Text("сбой")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Theme.negative)
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
                .buttonStyle(.pressable)
                .padding(.leading, 48)
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
                .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .padding(.leading, 48)
            }
        }
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
            // Четыре плитки свелись к одной карточке: главное — сколько точек
            // из лимита, остальное — расшифровка. Упёрлись в лимит — карточка
            // становится оранжевой.
            HeroSummary(
                title: "Точки",
                value: data.companyLimit.map { "\(data.companies.count) из \($0)" } ?? "\(data.companies.count)",
                caption: data.freeCompanySlots.map { "свободно слотов: \($0)" },
                footer: [
                    ("Команда", "\(data.staff.count)"),
                    ("Категории", "\(data.categories.count)"),
                    ("Бюджет в месяц", Money.format(data.monthlyBudgetTotal)),
                ],
                colors: data.isCompanyLimitReached
                    ? [Color(hex: 0xF59E0B), Color(hex: 0xEA580C)]
                    : [Color(hex: 0x4F46E5), Color(hex: 0x7C3AED)]
            )

            if data.isCompanyLimitReached {
                HStack(spacing: Spacing.md) {
                    TintedIcon(systemName: "exclamationmark.triangle.fill", tint: Theme.warning, size: 42)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Лимит точек исчерпан")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(Theme.text)
                        Text("Новую точку можно завести только после расширения тарифа.")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textDim)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                }
                .padding(Spacing.lg)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
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
        OwnerSection("Точки") {
            SysCount(text: data.freeCompanySlots.map { "свободно: \($0)" } ?? "\(data.companies.count)")
        } content: {
            if data.companies.isEmpty {
                InlineEmpty(icon: "building.2", text: "Точек пока нет", tint: Theme.textDim)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(data.companies.enumerated()), id: \.element.id) { index, company in
                        if index > 0 { SysDivider() }
                        HStack(spacing: Spacing.md) {
                            LetterBadge(text: company.name, tint: OwnerTint.point(index))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(company.name)
                                    .font(.system(size: 16, weight: .medium))
                                    .foregroundStyle(Theme.text)
                                    .lineLimit(1)
                                if let code = company.code, !code.isEmpty {
                                    Text(code)
                                        .font(.system(size: 13))
                                        .monospaced()
                                        .foregroundStyle(Theme.textDim)
                                }
                            }
                            Spacer(minLength: Spacing.sm)
                            if !company.showInStructure {
                                Text("вне структуры")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(Theme.textDim)
                            }
                        }
                        .padding(.vertical, Spacing.sm)
                    }
                }
            }
        }
    }

    private func categories(_ data: SystemSettings) -> some View {
        OwnerSection("Категории расходов") {
            if data.monthlyBudgetTotal > 0 {
                SysCount(text: "бюджет \(Money.format(data.monthlyBudgetTotal))")
            }
        } content: {
            if data.categories.isEmpty {
                InlineEmpty(icon: "square.grid.2x2", text: "Категорий пока нет", tint: Theme.textDim)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(data.categories.enumerated()), id: \.element.id) { index, category in
                        if index > 0 { SysDivider() }
                        let budget = category.monthlyBudget ?? 0
                        let group = category.accountingGroup.flatMap { $0.isEmpty ? nil : $0 }
                        AmountRow(
                            leading: {
                                TintedIcon(
                                    systemName: OwnerAnalyticsScreen.expenseIcon(category.name),
                                    tint: LedgerStatementScreen.categoryTint(category.name),
                                    size: 40
                                )
                            },
                            title: category.name,
                            subtitle: group ?? (budget > 0 ? "бюджет в месяц" : "без бюджета"),
                            amount: budget > 0 ? Money.format(budget) : "—"
                        )
                        .padding(.vertical, Spacing.xs)
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

        return OwnerSection("Команда") {
            SysCount(text: "активных: \(data.staff.filter(\.isActive).count)")
        } content: {
            if sorted.isEmpty {
                InlineEmpty(icon: "person.3", text: "Сотрудников пока нет", tint: Theme.textDim)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(sorted.enumerated()), id: \.element.id) { index, member in
                        if index > 0 { SysDivider() }
                        HStack(spacing: Spacing.md) {
                            PersonInitial(name: member.fullName, isActive: member.isActive)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(member.fullName)
                                    .font(.system(size: 16, weight: .medium))
                                    .foregroundStyle(member.isActive ? Theme.text : Theme.textDim)
                                    .lineLimit(1)
                                if let email = member.email, !email.isEmpty {
                                    Text(email)
                                        .font(.system(size: 13))
                                        .foregroundStyle(Theme.textDim)
                                        .lineLimit(1)
                                }
                            }
                            Spacer(minLength: Spacing.sm)
                            // Роль подписью: плашка съедала место под имя.
                            Text(member.roleLabel)
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(member.isAdministrative ? Theme.info : Theme.textDim)
                                .fixedSize()
                        }
                        .padding(.vertical, Spacing.sm)
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

    /// Состояние канала: имя бота на цветной карточке (синяя — работает,
    /// оранжевая — нет), ниже каждая настройка строкой с иконкой и статусом.
    private func connection(_ status: TelegramStatus) -> some View {
        let webhookOK = status.webhook?.isConfigured ?? false
        return VStack(spacing: Spacing.lg) {
            HeroSummary(
                title: status.isOperational ? "Канал работает" : "Канал настроен не полностью",
                value: status.bot?.displayName ?? "Бот не подключён",
                caption: status.isOperational ? "на связи" : "требует настройки",
                footer: [
                    ("Токен", status.hasToken ? "задан" : "не задан"),
                    ("Вебхук", webhookOK ? "есть" : "нет"),
                ],
                colors: status.isOperational
                    ? [Color(hex: 0x0EA5E9), Color(hex: 0x2563EB)]
                    : [Color(hex: 0xF59E0B), Color(hex: 0xEA580C)]
            )

            OwnerSection("Настройка канала") {
                VStack(spacing: 0) {
                    SysStatusRow(icon: "key.fill", title: "Токен бота",
                                 value: status.hasToken ? "задан" : "не задан",
                                 color: status.hasToken ? Theme.positive : Theme.negative)
                    SysDivider()
                    SysStatusRow(icon: "bubble.left.and.bubble.right.fill", title: "Общий чат",
                                 value: status.hasChatId ? "задан" : "не задан",
                                 color: status.hasChatId ? Theme.positive : Theme.warning)
                    SysDivider()
                    SysStatusRow(icon: "arrow.triangle.branch", title: "Вебхук",
                                 value: webhookOK ? "зарегистрирован" : "не зарегистрирован",
                                 color: webhookOK ? Theme.positive : Theme.negative)
                    SysDivider()
                    SysStatusRow(icon: "lock.fill", title: "Секрет вебхука",
                                 value: status.hasWebhookSecret ? "задан" : "не задан",
                                 color: status.hasWebhookSecret ? Theme.positive : Theme.warning)

                    if let webhook = status.webhook {
                        if webhook.isBacklogged {
                            SysDivider()
                            SysStatusRow(icon: "tray.full.fill", title: "Необработанных сообщений",
                                         value: "\(webhook.pendingUpdateCount)",
                                         color: Theme.warning)
                        }
                        if let message = webhook.lastErrorMessage, !message.isEmpty {
                            SysDivider()
                            HStack(alignment: .top, spacing: Spacing.md) {
                                TintedIcon(systemName: "exclamationmark.octagon.fill", tint: Theme.negative, size: 40)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Последняя ошибка")
                                        .font(.system(size: 13))
                                        .foregroundStyle(Theme.textDim)
                                    Text(message)
                                        .font(.system(size: 15))
                                        .foregroundStyle(Theme.negative)
                                        .fixedSize(horizontal: false, vertical: true)
                                    if let date = webhook.lastErrorAt {
                                        Text(date.formatted(.dateTime.day().month(.abbreviated).hour().minute()))
                                            .font(.system(size: 12))
                                            .foregroundStyle(Theme.textDim)
                                    }
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(.vertical, Spacing.sm)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func recipients(_ store: TelegramStore) -> some View {
        OwnerSection("Получатели бота") {
            if let users = store.allowed?.users, !users.isEmpty {
                SysCount(text: "\(users.count)")
            }
        } content: {
            if let allowed = store.allowed, !allowed.tableExists {
                InlineEmpty(
                    icon: "wrench.and.screwdriver",
                    text: "Список получателей ещё не развёрнут в базе",
                    tint: Theme.warning
                )
            } else if let users = store.allowed?.users, !users.isEmpty {
                VStack(spacing: 0) {
                    ForEach(Array(users.enumerated()), id: \.element.id) { index, user in
                        if index > 0 { SysDivider() }
                        HStack(spacing: Spacing.md) {
                            PersonInitial(name: user.displayName)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(user.displayName)
                                    .font(.system(size: 16, weight: .medium))
                                    .foregroundStyle(Theme.text)
                                    .lineLimit(1)
                                Text(user.telegramUserID)
                                    .font(.system(size: 13))
                                    .monospaced()
                                    .foregroundStyle(Theme.textDim)
                            }
                            Spacer(minLength: Spacing.sm)
                            Text(user.canFinance ? "финансы" : "без финансов")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(user.canFinance ? Theme.info : Theme.textDim)
                                .fixedSize()
                        }
                        .padding(.vertical, Spacing.sm)
                    }
                }
            } else {
                InlineEmpty(icon: "person.badge.plus", text: "Получателей нет", tint: Theme.textDim)
            }
        }
    }

    private func unlinked(_ store: TelegramStore) -> some View {
        let unlinked = store.unlinkedStaff

        return OwnerSection("Без Telegram") {
            SysCount(text: "подключено \(store.staff.filter(\.isLinked).count) из \(store.staff.count)")
        } content: {
            if unlinked.isEmpty {
                InlineEmpty(
                    icon: "checkmark.circle",
                    text: "Все работающие сотрудники подключены",
                    tint: Theme.positive
                )
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(unlinked.enumerated()), id: \.element.id) { index, member in
                        if index > 0 { SysDivider() }
                        HStack(spacing: Spacing.md) {
                            PersonInitial(name: member.fullName)
                            Text(member.fullName)
                                .font(.system(size: 16, weight: .medium))
                                .foregroundStyle(Theme.text)
                                .lineLimit(1)
                            Spacer(minLength: Spacing.sm)
                            if let role = member.role, !role.isEmpty {
                                Text(role)
                                    .font(.system(size: 13))
                                    .foregroundStyle(Theme.textDim)
                            }
                        }
                        .padding(.vertical, Spacing.sm)
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
            // Главная цифра — сколько проверок прошло; цвет карточки сразу
            // говорит, есть ли сбои, не заставляя сравнивать три плитки.
            HeroSummary(
                title: data.failureCount > 0 ? "Есть сбои" : (data.warningCount > 0 ? "Есть предупреждения" : "Всё в порядке"),
                value: "\(data.okCount) из \(checks.count)",
                caption: "проверок пройдено",
                footer: [
                    ("Предупреждений", "\(data.warningCount)"),
                    ("Сбоев", "\(data.failureCount)"),
                ],
                colors: data.failureCount > 0
                    ? [Color(hex: 0xE11D48), Color(hex: 0x9F1239)]
                    : (data.warningCount > 0
                        ? [Color(hex: 0xF59E0B), Color(hex: 0xEA580C)]
                        : [Color(hex: 0x059669), Color(hex: 0x0F766E)])
            )

            OwnerSection("Проверки") {
                SysCount(text: "всего \(checks.count)")
            } content: {
                if checks.isEmpty {
                    InlineEmpty(icon: "stethoscope", text: "Сервер не вернул ни одной проверки", tint: Theme.textDim)
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(checks.enumerated()), id: \.element.id) { index, check in
                            if index > 0 { SysDivider() }
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

    private var color: Color {
        switch check.state {
        case .ok: Theme.positive
        case .warning: Theme.warning
        case .failure: Theme.negative
        case .unknown: Theme.textDim
        }
    }

    private var icon: String {
        switch check.state {
        case .ok: "checkmark"
        case .warning: "exclamationmark.triangle.fill"
        case .failure: "xmark"
        case .unknown: "questionmark"
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
            TintedIcon(systemName: icon, tint: color, size: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text(check.title)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Theme.text)
                    .fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(.leading)
                if let detail = check.detail, !detail.isEmpty {
                    Text(detail)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textDim)
                        .fixedSize(horizontal: false, vertical: true)
                        .multilineTextAlignment(.leading)
                }
            }

            Spacer(minLength: Spacing.sm)

            Text(label)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(color)
                .fixedSize()
        }
        .padding(.vertical, Spacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// ── Общие детали экранов системы ─────────────────────────────────────────────

/// Разделитель с отступом под иконку — строки читаются как один список.
private struct SysDivider: View {
    var body: some View {
        Rectangle().fill(Theme.borderSoft).frame(height: 1).padding(.leading, 52)
    }
}

/// Приглушённая цифра справа от заголовка секции.
private struct SysCount: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.system(size: 13, weight: .semibold))
            .monospacedDigit()
            .foregroundStyle(Theme.textDim)
            .lineLimit(1)
    }
}

/// Строка настройки: иконка в кружке, название и цветной статус справа.
private struct SysStatusRow: View {
    let icon: String
    let title: String
    let value: String
    let color: Color

    var body: some View {
        HStack(spacing: Spacing.md) {
            TintedIcon(systemName: icon, tint: color, size: 40)
            Text(title)
                .font(.system(size: 16))
                .foregroundStyle(Theme.text)
                .lineLimit(1)
            Spacer(minLength: Spacing.sm)
            Text(value)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(color)
                .lineLimit(1)
        }
        .padding(.vertical, Spacing.sm)
    }
}

/// Пилюля фильтра: выбранная — тёмная, как в выписке.
private struct SysChip: View {
    let title: String
    let isOn: Bool
    let action: () -> Void

    var body: some View {
        Button {
            withAnimation(Motion.tap) { action() }
        } label: {
            Text(title)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(isOn ? Color.white : Theme.text)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(isOn ? AnyShapeStyle(Theme.text) : AnyShapeStyle(Theme.surface), in: Capsule())
        }
        .buttonStyle(.pressable)
    }
}
