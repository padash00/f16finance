import Foundation

/// Флаг, которого может не быть в ответе.
///
/// Готовых `decodeFlexible*` для булевых нет, а «поле отсутствует» и «поле
/// `false`» здесь значат разное: непришедший `is_active` должен читаться как
/// «активен», иначе половина справочника молча погаснет.
private extension KeyedDecodingContainer {
    func flag(_ key: Key, default fallback: Bool) -> Bool {
        ((try? decodeIfPresent(Bool.self, forKey: key)) ?? nil) ?? fallback
    }

    /// Счётчик: Telegram и Postgres присылают числа то целыми, то строкой.
    func flexibleInt(_ key: Key) -> Int? {
        guard let value: Double = try? decodeFlexibleDouble(forKey: key) else { return nil }
        return Int(value)
    }
}

// ── Настройки системы: /api/admin/settings ───────────────────────────────────

/// Справочники организации: точки, команда, категории расходов.
///
/// Роут отдаёт три списка одним ответом — они и правятся вместе: завёл точку,
/// назначил на неё людей, разложил расходы по категориям.
public struct SystemSettings: Decodable, Sendable {
    public let companies: [SettingsCompany]
    public let staff: [SettingsStaff]
    public let categories: [SettingsCategory]
    /// Сколько точек разрешено тарифом. `nil` — без лимита (платформенный контекст).
    public let companyLimit: Int?

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        companies = (try? c.decodeIfPresent([SettingsCompany].self, forKey: .companies)) ?? []
        staff = (try? c.decodeIfPresent([SettingsStaff].self, forKey: .staff)) ?? []
        categories = (try? c.decodeIfPresent([SettingsCategory].self, forKey: .categories)) ?? []
        companyLimit = (try? c.decodeIfPresent(Int.self, forKey: .companyLimit)) ?? nil
    }

    private enum CodingKeys: String, CodingKey {
        case companies, staff, categories, companyLimit
    }

    /// Свободных слотов под точки. `nil` — лимита нет.
    public var freeCompanySlots: Int? {
        guard let companyLimit else { return nil }
        return max(0, companyLimit - companies.count)
    }

    /// Лимит исчерпан — новую точку завести уже нельзя.
    public var isCompanyLimitReached: Bool {
        guard let companyLimit else { return false }
        return companies.count >= companyLimit
    }

    /// Бюджет расходов на месяц по всем категориям, где он задан.
    public var monthlyBudgetTotal: Double {
        categories.reduce(0) { $0 + ($1.monthlyBudget ?? 0) }
    }
}

/// Точка продаж в справочнике настроек.
public struct SettingsCompany: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let code: String?
    /// Показывать ли точку в оргструктуре.
    public let showInStructure: Bool

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        name = try c.decodeFlexibleString(forKey: .name) ?? "Точка"
        code = try c.decodeFlexibleString(forKey: .code)
        showInStructure = c.flag(.showInStructure, default: true)
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, code
        case showInStructure = "show_in_structure"
    }
}

/// Сотрудник в справочнике настроек.
public struct SettingsStaff: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let fullName: String
    public let phone: String?
    public let email: String?
    public let role: String
    public let isActive: Bool

    public var roleLabel: String {
        switch role {
        case "owner": "Владелец"
        case "manager": "Управляющий"
        case "operator": "Оператор"
        case "accountant": "Бухгалтер"
        case "other": "Прочее"
        default: role
        }
    }

    /// Роли с админским доступом — их держат на виду отдельно.
    public var isAdministrative: Bool { role == "owner" || role == "manager" }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        fullName = try c.decodeFlexibleString(forKey: .fullName) ?? "Без имени"
        phone = try c.decodeFlexibleString(forKey: .phone)
        email = try c.decodeFlexibleString(forKey: .email)
        role = try c.decodeFlexibleString(forKey: .role) ?? "other"
        isActive = c.flag(.isActive, default: true)
    }

    private enum CodingKeys: String, CodingKey {
        case id, phone, email, role
        case fullName = "full_name"
        case isActive = "is_active"
    }
}

/// Категория расходов с месячным бюджетом.
public struct SettingsCategory: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let monthlyBudget: Double?
    /// Группа учёта (постоянные / переменные и т.п.) — задаётся не всегда.
    public let accountingGroup: String?

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        name = try c.decodeFlexibleString(forKey: .name) ?? "Без названия"
        monthlyBudget = try c.decodeFlexibleDouble(forKey: .monthlyBudget)
        accountingGroup = try c.decodeFlexibleString(forKey: .accountingGroup)
    }

    private enum CodingKeys: String, CodingKey {
        case id, name
        case monthlyBudget = "monthly_budget"
        case accountingGroup = "accounting_group"
    }
}

// ── Журнал событий: /api/admin/logs ──────────────────────────────────────────

/// Разрез журнала. Значение уходит на сервер параметром `domain`.
///
/// Без разреза сервер сам прячет шум — просмотры страниц и вызовы ИИ, — иначе
/// продажи и ошибки тонут в них. Поэтому «Все» это отсутствие параметра, а не
/// какой-то отдельный фильтр «показать вообще всё».
public enum LogDomain: String, CaseIterable, Sendable, Identifiable {
    case all
    case errors
    case finance
    case team
    case operations
    case store
    case debts
    case auth
    case telegram

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .all: "Все"
        case .errors: "Ошибки"
        case .finance: "Деньги"
        case .team: "Команда"
        case .operations: "Задачи и смены"
        case .store: "Склад"
        case .debts: "Долги"
        case .auth: "Входы"
        case .telegram: "Telegram"
        }
    }

    /// Значение параметра `domain`. `nil` — не передавать.
    public var query: String? {
        switch self {
        case .all: nil
        case .errors: "site-errors"
        case .finance: "finance"
        case .team: "staff"
        case .operations: "operations"
        case .store: "receipts"
        case .debts: "debts"
        case .auth: "auth"
        case .telegram: "telegram"
        }
    }
}

/// Событие журнала: правка данных, отправленное уведомление или ошибка.
///
/// Заголовок и расшифровку собирает сервер — там живут словари сущностей и
/// действий на весь портал. Дублировать их в приложении означало бы получить
/// вторую, всегда отстающую версию тех же переводов.
public struct LogEntry: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    /// `audit` — правка данных, `notification` — отправка, `ai` — вызов ИИ.
    public let kind: String
    public let createdAt: Date?
    public let title: String
    public let subtitle: String?
    /// Построчная расшифровка: что именно изменилось.
    public let detailRows: [String]
    public let entityType: String?
    public let action: String?
    public let actorEmail: String?
    public let channel: String?
    public let status: String?

    /// Событие про сбой: провал отправки, ошибка ИИ или серверная ошибка.
    public var isError: Bool {
        if status == "failed" || status == "error" { return true }
        if entityType == "system-error" { return true }
        let act = (action ?? "").lowercased()
        return act.contains("error") || act.contains("failed")
    }

    /// Кто сделал. Без действующего лица событие породила сама система.
    public var actorLabel: String {
        guard let actorEmail, !actorEmail.isEmpty else { return "Система" }
        return actorEmail.split(separator: "@").first.map(String.init) ?? actorEmail
    }

    public var kindLabel: String {
        switch kind {
        case "notification": "Уведомление"
        case "ai": "ИИ"
        default: "Действие"
        }
    }

    /// Значок по смыслу события: сначала сбой, потом канал, потом сущность.
    public var icon: String {
        if isError { return "exclamationmark.triangle.fill" }
        if kind == "notification" { return "paperplane.fill" }
        if kind == "ai" { return "sparkles" }

        let entity = (entityType ?? "").lowercased()
        if entity.contains("income") || entity.contains("expense") { return "banknote" }
        if entity.contains("salary") || entity.contains("payment") { return "wallet.pass" }
        if entity.contains("debt") { return "creditcard" }
        if entity.contains("inventory") || entity.contains("supplier") { return "shippingbox" }
        if entity.hasPrefix("point-") { return "desktopcomputer" }
        if entity.hasPrefix("auth") { return "person.badge.key" }
        if entity.contains("task") || entity.contains("checklist") { return "checkmark.circle" }
        if entity.contains("shift") { return "calendar" }
        if entity.contains("staff") || entity.contains("operator") || entity == "user" { return "person" }
        if entity == "company" { return "building.2" }
        if entity == "page-view" || entity == "visit" { return "doc.text" }
        return "circle.dashed"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        kind = try c.decodeFlexibleString(forKey: .kind) ?? "audit"
        createdAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .createdAt))
        title = try c.decodeFlexibleString(forKey: .title) ?? "Событие"
        subtitle = try c.decodeFlexibleString(forKey: .subtitle)
        detailRows = ((try? c.decodeIfPresent([String].self, forKey: .detailRows)) ?? [])?
            .filter { !$0.isEmpty } ?? []
        entityType = try c.decodeFlexibleString(forKey: .entityType)
        action = try c.decodeFlexibleString(forKey: .action)
        actorEmail = try c.decodeFlexibleString(forKey: .actorEmail)
        channel = try c.decodeFlexibleString(forKey: .channel)
        status = try c.decodeFlexibleString(forKey: .status)
    }

    private enum CodingKeys: String, CodingKey {
        case id, kind, createdAt, title, subtitle, detailRows
        case entityType, action, actorEmail, channel, status
    }
}

/// Страница журнала: `GET /api/admin/logs`.
public struct LogFeed: Decodable, Sendable {
    public let items: [LogEntry]
    public let total: Int
    public let page: Int
    public let limit: Int

    /// Есть ли что подгружать дальше.
    public var hasMore: Bool { page * limit < total }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        items = (try? c.decodeIfPresent([LogEntry].self, forKey: .items)) ?? []
        total = ((try? c.decodeIfPresent(Int.self, forKey: .total)) ?? nil) ?? 0
        page = ((try? c.decodeIfPresent(Int.self, forKey: .page)) ?? nil) ?? 1
        limit = ((try? c.decodeIfPresent(Int.self, forKey: .limit)) ?? nil) ?? 80
    }

    private enum CodingKeys: String, CodingKey { case items, total, page, limit }
}

// ── Telegram: /api/telegram/* ────────────────────────────────────────────────

/// Состояние бота: `GET /api/telegram/status`.
///
/// Адрес вебхука сервер не отдаёт намеренно — это инфраструктурная деталь.
/// Здесь важно другое: подключён ли бот и не копится ли у него очередь.
public struct TelegramStatus: Decodable, Sendable {
    public let hasToken: Bool
    public let hasChatId: Bool
    public let hasWebhookSecret: Bool
    public let bot: Bot?
    public let webhook: Webhook?

    public struct Bot: Decodable, Sendable, Hashable {
        public let username: String?
        public let firstName: String?

        public var displayName: String {
            if let username, !username.isEmpty { return "@\(username)" }
            return firstName ?? "бот"
        }

        public init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            username = try c.decodeFlexibleString(forKey: .username)
            firstName = try c.decodeFlexibleString(forKey: .firstName)
        }

        private enum CodingKeys: String, CodingKey {
            case username
            case firstName = "first_name"
        }
    }

    public struct Webhook: Decodable, Sendable, Hashable {
        public let isConfigured: Bool
        public let pendingUpdateCount: Int
        public let lastErrorMessage: String?
        public let lastErrorAt: Date?
        public let maxConnections: Int?

        /// Очередь копится — сообщения до людей не доходят.
        public var isBacklogged: Bool { pendingUpdateCount > 0 }

        public init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            isConfigured = c.flag(.isConfigured, default: false)
            pendingUpdateCount = c.flexibleInt(.pendingUpdateCount) ?? 0
            lastErrorMessage = try c.decodeFlexibleString(forKey: .lastErrorMessage)
            // Telegram отдаёт время ошибки unix-секундами, а не строкой.
            if let seconds = try c.decodeFlexibleDouble(forKey: .lastErrorDate), seconds > 0 {
                lastErrorAt = Date(timeIntervalSince1970: seconds)
            } else {
                lastErrorAt = nil
            }
            maxConnections = c.flexibleInt(.maxConnections)
        }

        private enum CodingKeys: String, CodingKey {
            case isConfigured
            case pendingUpdateCount = "pending_update_count"
            case lastErrorMessage = "last_error_message"
            case lastErrorDate = "last_error_date"
            case maxConnections = "max_connections"
        }
    }

    /// Бот работоспособен: есть токен и зарегистрирован вебхук.
    public var isOperational: Bool { hasToken && (webhook?.isConfigured ?? false) }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        hasToken = c.flag(.hasToken, default: false)
        hasChatId = c.flag(.hasChatId, default: false)
        hasWebhookSecret = c.flag(.hasWebhookSecret, default: false)
        bot = (try? c.decodeIfPresent(Bot.self, forKey: .botInfo)) ?? nil
        webhook = (try? c.decodeIfPresent(Webhook.self, forKey: .webhookInfo)) ?? nil
    }

    private enum CodingKeys: String, CodingKey {
        case hasToken, hasChatId, hasWebhookSecret, botInfo, webhookInfo
    }
}

/// Получатель сообщений бота.
public struct TelegramAllowedUser: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let telegramUserID: String
    public let label: String?
    /// Разрешено ли слать этому человеку финансовые сводки.
    public let canFinance: Bool
    public let createdAt: Date?

    public var displayName: String {
        guard let label, !label.isEmpty else { return telegramUserID }
        return label
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        telegramUserID = try c.decodeFlexibleString(forKey: .telegramUserID) ?? "—"
        label = try c.decodeFlexibleString(forKey: .label)
        canFinance = c.flag(.canFinance, default: true)
        createdAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .createdAt))
    }

    private enum CodingKeys: String, CodingKey {
        case id, label
        case telegramUserID = "telegram_user_id"
        case canFinance = "can_finance"
        case createdAt = "created_at"
    }
}

/// Ответ `GET /api/telegram/allowed-users`.
///
/// `tableExists: false` — интеграцию ещё не разворачивали в этой базе. Это не
/// ошибка, и путать её с пустым списком получателей нельзя.
public struct TelegramAllowedUserList: Decodable, Sendable {
    public let users: [TelegramAllowedUser]
    public let tableExists: Bool

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        users = (try? c.decodeIfPresent([TelegramAllowedUser].self, forKey: .data)) ?? []
        tableExists = c.flag(.tableExists, default: true)
    }

    private enum CodingKeys: String, CodingKey { case data, tableExists }
}

/// Сотрудник и его привязка к Telegram: `GET /api/telegram/staff-ids`.
public struct TelegramStaffLink: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let fullName: String
    public let role: String?
    public let chatID: String?
    public let isActive: Bool

    /// Работающий сотрудник без chat_id уведомлений не получит.
    public var isLinked: Bool { !(chatID ?? "").isEmpty }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        fullName = try c.decodeFlexibleString(forKey: .fullName) ?? "Без имени"
        role = try c.decodeFlexibleString(forKey: .role)
        chatID = try c.decodeFlexibleString(forKey: .chatID)
        isActive = c.flag(.isActive, default: true)
    }

    private enum CodingKeys: String, CodingKey {
        case id, role
        case fullName = "full_name"
        case chatID = "telegram_chat_id"
        case isActive = "is_active"
    }
}

// ── Диагностика: /api/admin/debug/system ─────────────────────────────────────

/// Результат одной проверки. Экран показывает их списком, ничего не считая сам.
public struct DiagnosticCheck: Sendable, Identifiable, Hashable {
    public enum State: Sendable, Hashable {
        case ok
        case warning
        case failure
        /// Проверить не удалось — это не «всё хорошо» и не «всё плохо».
        case unknown
    }

    public let id: String
    public let title: String
    public let detail: String?
    public let state: State

    public init(id: String, title: String, detail: String?, state: State) {
        self.id = id
        self.title = title
        self.detail = detail
        self.state = state
    }
}

/// Запланированная задача Vercel Cron.
public struct DiagnosticCron: Decodable, Sendable, Identifiable, Hashable {
    public let path: String
    public let schedule: String
    public let lastRunAt: Date?

    public var id: String { path }

    /// Сутки без запуска у задачи, которая ходит хотя бы раз в день, —
    /// признак, что она отвалилась. Точное расписание разбирать не пытаемся:
    /// cron-выражение без календаря соврёт чаще, чем поможет.
    public var looksStale: Bool {
        guard let lastRunAt else { return false }
        return Date().timeIntervalSince(lastRunAt) > 48 * 3600
    }

    /// Запусков не видно вовсе. Отдельно от `looksStale`: задача могла просто
    /// не писать о себе в журнал, и пугать этим владельца не нужно.
    public var neverLogged: Bool { lastRunAt == nil }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        path = try c.decodeFlexibleString(forKey: .path) ?? "—"
        schedule = try c.decodeFlexibleString(forKey: .schedule) ?? ""
        lastRunAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .lastRunAt))
    }

    private enum CodingKeys: String, CodingKey {
        case path, schedule
        case lastRunAt = "last_run_at"
    }
}

/// Состояние миграций базы.
public struct DiagnosticMigrations: Decodable, Sendable, Hashable {
    public let appliedCount: Int
    public let fileCount: Int
    /// Есть в репозитории, но не применены к базе.
    public let pending: [String]
    /// Применены к базе, но файла в репозитории нет.
    public let extra: [String]
    /// Почему сверку не удалось выполнить.
    public let error: String?

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        appliedCount = c.flexibleInt(.appliedCount) ?? 0
        fileCount = c.flexibleInt(.fileCount) ?? 0
        pending = (try? c.decodeIfPresent([String].self, forKey: .pending)) ?? []
        extra = (try? c.decodeIfPresent([String].self, forKey: .extra)) ?? []
        error = try c.decodeFlexibleString(forKey: .error)
    }

    private enum CodingKeys: String, CodingKey {
        case pending, extra, error
        case appliedCount = "applied_count"
        case fileCount = "file_count"
    }
}

/// Ответ `GET /api/admin/debug/system` (в конверте `{ data: … }`).
public struct SystemDiagnostics: Decodable, Sendable {
    public let crons: [DiagnosticCron]
    public let migrations: DiagnosticMigrations?

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        crons = (try? c.decodeIfPresent([DiagnosticCron].self, forKey: .crons)) ?? []
        migrations = (try? c.decodeIfPresent(DiagnosticMigrations.self, forKey: .migrations)) ?? nil
    }

    private enum CodingKeys: String, CodingKey { case crons, migrations }

    /// Ответ сервера — сырые списки; владельцу нужен вердикт «ок / не ок».
    /// Правила перевода одни и те же для всех платформ, поэтому живут здесь,
    /// а не во вьюхе.
    public var checks: [DiagnosticCheck] {
        var result: [DiagnosticCheck] = []

        if let migrations {
            if let error = migrations.error, !error.isEmpty {
                result.append(DiagnosticCheck(
                    id: "migrations",
                    title: "Миграции базы",
                    detail: error,
                    state: .unknown
                ))
            } else if !migrations.pending.isEmpty {
                result.append(DiagnosticCheck(
                    id: "migrations",
                    title: "Не применено миграций: \(migrations.pending.count)",
                    detail: migrations.pending.prefix(5).joined(separator: "\n"),
                    state: .failure
                ))
            } else {
                result.append(DiagnosticCheck(
                    id: "migrations",
                    title: "Миграции базы применены",
                    detail: "в репозитории \(migrations.fileCount), в базе \(migrations.appliedCount)",
                    state: .ok
                ))
            }

            if !migrations.extra.isEmpty {
                result.append(DiagnosticCheck(
                    id: "migrations-extra",
                    title: "В базе есть миграции без файлов: \(migrations.extra.count)",
                    detail: migrations.extra.prefix(5).joined(separator: "\n"),
                    state: .warning
                ))
            }
        } else {
            result.append(DiagnosticCheck(
                id: "migrations",
                title: "Миграции базы",
                detail: "сервер не вернул состояние",
                state: .unknown
            ))
        }

        if crons.isEmpty {
            result.append(DiagnosticCheck(
                id: "crons",
                title: "Регулярные задачи не настроены",
                detail: "автоматические отчёты и рассылки не запускаются",
                state: .warning
            ))
        } else {
            for cron in crons {
                let state: DiagnosticCheck.State = cron.neverLogged
                    ? .unknown
                    : (cron.looksStale ? .warning : .ok)
                let when: String = {
                    guard let date = cron.lastRunAt else { return "запусков в журнале нет" }
                    return "последний запуск \(date.formatted(.dateTime.day().month(.abbreviated).hour().minute()))"
                }()
                result.append(DiagnosticCheck(
                    id: "cron:\(cron.path)",
                    title: cron.path,
                    detail: [cron.schedule, when].filter { !$0.isEmpty }.joined(separator: " · "),
                    state: state
                ))
            }
        }

        return result
    }

    public var failureCount: Int { checks.filter { $0.state == .failure }.count }
    public var warningCount: Int { checks.filter { $0.state == .warning }.count }
    public var okCount: Int { checks.filter { $0.state == .ok }.count }
}

// ── Сервис ───────────────────────────────────────────────────────────────────

/// Системные разделы: настройки, журнал, Telegram, диагностика.
public struct SystemService: Sendable {
    private let api: APIClient

    public init(api: APIClient) { self.api = api }

    public func settings() async throws -> SystemSettings {
        let response: SystemSettings = try await api.send(APIRequest(path: "/api/admin/settings"))
        return response
    }

    /// Страница журнала. Сервер зажимает `limit` в 20…200, поэтому просить
    /// больше бессмысленно — лишнее всё равно обрежется.
    public func logs(
        domain: LogDomain = .all,
        search: String = "",
        page: Int = 1,
        limit: Int = 100
    ) async throws -> LogFeed {
        var query: [String: String] = [
            "page": String(max(1, page)),
            "limit": String(min(200, max(20, limit))),
        ]
        if let domainQuery = domain.query { query["domain"] = domainQuery }
        let trimmed = search.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { query["q"] = trimmed }
        let response: LogFeed = try await api.send(APIRequest(path: "/api/admin/logs", query: query))
        return response
    }

    public func telegramStatus() async throws -> TelegramStatus {
        let response: TelegramStatus = try await api.send(APIRequest(path: "/api/telegram/status"))
        return response
    }

    public func telegramAllowedUsers() async throws -> TelegramAllowedUserList {
        let response: TelegramAllowedUserList = try await api.send(
            APIRequest(path: "/api/telegram/allowed-users")
        )
        return response
    }

    public func telegramStaff() async throws -> [TelegramStaffLink] {
        let response: DataList<TelegramStaffLink> = try await api.send(
            APIRequest(path: "/api/telegram/staff-ids")
        )
        return response.items
    }

    public func diagnostics() async throws -> SystemDiagnostics {
        let response: Envelope<SystemDiagnostics> = try await api.send(
            APIRequest(path: "/api/admin/debug/system")
        )
        return response.data
    }
}
