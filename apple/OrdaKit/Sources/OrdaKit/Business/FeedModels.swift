import Foundation

// ── Текст ленты ──────────────────────────────────────────────────────────────

/// Текст постов и сообщений приходит из двух разных мест: часть набрана в
/// обычном поле ввода (голый текст с переносами), часть — в веб-редакторе и
/// хранится размеченной. Показать разметку «как есть» нельзя, но и гонять
/// каждое короткое сообщение через HTML-парсер незачем.
public enum FeedText {
    private static let tagPattern = #"<[a-zA-Z/][^>]*>"#

    public static func looksLikeHTML(_ text: String) -> Bool {
        text.range(of: tagPattern, options: .regularExpression) != nil
    }

    /// Блоки для длинного текста поста: абзацы, списки, цитаты.
    public static func blocks(from text: String?) -> [RichText.Block] {
        guard let text, !text.isEmpty else { return [] }
        if looksLikeHTML(text) { return RichText.blocks(from: text) }

        // Голый текст тоже режем по переносам: сервер хранит пост одной
        // строкой с \n, а SwiftUI без разбивки склеит абзацы в простыню.
        return text
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .map { RichText.Block(kind: .paragraph, text: $0) }
    }

    /// Готовый к показу текст сообщения: разметка убрана, переносы сохранены.
    public static func display(_ text: String?) -> String {
        guard let text, !text.isEmpty else { return "" }
        return looksLikeHTML(text) ? RichText.plain(from: text) : text
    }

    /// Однострочное превью для списка переписок.
    public static func preview(_ text: String?, limit: Int = 90) -> String {
        let flat = display(text)
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        guard flat.count > limit else { return flat }
        return String(flat.prefix(limit)) + "…"
    }

    /// Инициалы для аватарки-заглушки.
    public static func initials(_ name: String) -> String {
        let parts = name.split(separator: " ").prefix(2)
        let letters = parts.compactMap(\.first).map(String.init).joined()
        return letters.isEmpty ? "?" : letters.uppercased()
    }
}

// ── Группировка по дням ──────────────────────────────────────────────────────

/// Сообщения одного дня. Лента без разделителей превращается в сплошную
/// простыню, где «вчера» и «две недели назад» выглядят одинаково.
public struct FeedDaySection<Item: Identifiable & Sendable>: Identifiable, Sendable {
    public let id: String
    public let day: Date
    public let items: [Item]

    public var label: String { FeedDay.label(for: day) }
}

public enum FeedDay {
    /// Ключ дня в местном времени: группируем так, как человек видит на часах.
    public static func key(for date: Date) -> String {
        let parts = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    public static var todayKey: String { key(for: Date()) }

    public static func label(for date: Date) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(date) { return "Сегодня" }
        if calendar.isDateInYesterday(date) { return "Вчера" }

        // Внутри недели день недели читается быстрее числа.
        if let days = calendar.dateComponents([.day], from: date, to: Date()).day,
           (0...6).contains(days) {
            return date.formatted(.dateTime.weekday(.wide)).capitalized
        }
        return date.formatted(.dateTime.day().month(.wide))
    }

    /// Разложить ленту по дням, сохранив исходный порядок элементов.
    public static func group<Item: Identifiable & Sendable>(
        _ items: [Item],
        date: (Item) -> Date?
    ) -> [FeedDaySection<Item>] {
        var order: [String] = []
        var buckets: [String: [Item]] = [:]
        var days: [String: Date] = [:]

        for item in items {
            guard let moment = date(item) else { continue }
            let dayKey = key(for: moment)
            if buckets[dayKey] == nil {
                order.append(dayKey)
                days[dayKey] = Calendar.current.startOfDay(for: moment)
            }
            buckets[dayKey, default: []].append(item)
        }

        return order.compactMap { dayKey in
            guard let day = days[dayKey], let list = buckets[dayKey] else { return nil }
            return FeedDaySection(id: dayKey, day: day, items: list)
        }
    }
}

// ── Вложения и реакции ───────────────────────────────────────────────────────

/// Файл или картинка, прикреплённые к сообщению.
public struct FeedAttachment: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let kind: String
    public let url: String
    public let name: String?

    public var isImage: Bool { kind == "image" || kind == "gif" || kind == "sticker" }

    /// Голосовое. Тип приходит либо явным `audio`, либо MIME-строкой браузера
    /// (`audio/mp4`), либо угадывается по расширению — сервер кладёт файл как
    /// есть и не нормализует тип.
    public var isAudio: Bool {
        kind == "audio" || kind.hasPrefix("audio/")
            || url.hasSuffix(".m4a") || url.hasSuffix(".mp3") || url.hasSuffix(".ogg")
    }

    /// Опрос приходит вложением, но рисуется на сайте отдельным виджетом —
    /// в приложении показываем только пометку, чтобы не врать пустым блоком.
    public var isPoll: Bool { kind == "poll" }

    public var label: String {
        if let name, !name.isEmpty { return name }
        if isAudio { return "Голосовое" }
        return switch kind {
        case "image", "gif", "sticker": "Изображение"
        case "poll": "Опрос"
        case "file": "Файл"
        default: kind
        }
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = try c.decodeFlexibleString(forKey: .type) ?? "file"
        url = try c.decodeFlexibleString(forKey: .url) ?? ""
        name = try c.decodeFlexibleString(forKey: .name)
        id = url.isEmpty ? UUID().uuidString : url
    }

    private enum CodingKeys: String, CodingKey { case type, url, name }
}

public struct FeedReaction: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let userName: String?
    public let emoji: String

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        userName = try c.decodeFlexibleString(forKey: .userName)
        emoji = try c.decodeFlexibleString(forKey: .emoji) ?? "👍"
    }

    private enum CodingKeys: String, CodingKey {
        case id, emoji
        case userName = "user_name"
    }
}

/// Одинаковые эмодзи, свёрнутые в счётчик.
public struct FeedReactionGroup: Sendable, Identifiable, Hashable {
    public let id: String
    public let emoji: String
    public let count: Int
}

/// Свернуть список реакций, сохранив порядок первого появления.
private func groupReactions(_ reactions: [FeedReaction]) -> [FeedReactionGroup] {
    var order: [String] = []
    var counts: [String: Int] = [:]
    for reaction in reactions {
        if counts[reaction.emoji] == nil { order.append(reaction.emoji) }
        counts[reaction.emoji, default: 0] += 1
    }
    return order.map { FeedReactionGroup(id: $0, emoji: $0, count: counts[$0] ?? 0) }
}

// ── Лента новостей: /api/news ────────────────────────────────────────────────

/// Пост владельца в общей ленте.
public struct NewsPost: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let authorName: String
    public let title: String?
    public let body: String
    public let imageURL: String?
    public let linkURL: String?
    public let linkLabel: String?
    public let pinnedUntil: Date?
    public let createdAt: Date?
    public let viewed: Bool

    /// Закрепление живёт до даты, а не «навсегда»: истёкшее закрепление
    /// не должно держать старый пост наверху ленты.
    public var isPinned: Bool {
        guard let pinnedUntil else { return false }
        return pinnedUntil.timeIntervalSinceNow > 0
    }

    public var blocks: [RichText.Block] { FeedText.blocks(from: body) }
    public var preview: String { FeedText.preview(body, limit: 140) }
    public var initials: String { FeedText.initials(authorName) }

    public var linkTitle: String {
        if let linkLabel, !linkLabel.isEmpty { return linkLabel }
        return "Открыть ссылку"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        authorName = try c.decodeFlexibleString(forKey: .authorName) ?? "Владелец"
        title = try c.decodeFlexibleString(forKey: .title)
        body = try c.decodeFlexibleString(forKey: .body) ?? ""
        imageURL = try c.decodeFlexibleString(forKey: .imageURL)
        linkURL = try c.decodeFlexibleString(forKey: .linkURL)
        linkLabel = try c.decodeFlexibleString(forKey: .linkLabel)
        pinnedUntil = DateParsing.date(from: try c.decodeFlexibleString(forKey: .pinnedUntil))
        createdAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .createdAt))
        viewed = try c.decodeIfPresent(Bool.self, forKey: .viewed) ?? false
    }

    private enum CodingKeys: String, CodingKey {
        case id, title, body, viewed
        case authorName = "author_name"
        case imageURL = "image_url"
        case linkURL = "link_url"
        case linkLabel = "link_label"
        case pinnedUntil = "pinned_until"
        case createdAt = "created_at"
    }
}

/// Ответ `GET /api/news`.
public struct NewsFeed: Decodable, Sendable {
    public let posts: [NewsPost]
    public let unreadCount: Int
    public let canPublish: Bool

    public var pinned: [NewsPost] { posts.filter(\.isPinned) }
    public var regular: [NewsPost] { posts.filter { !$0.isPinned } }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        posts = (try? c.decodeIfPresent([NewsPost].self, forKey: .posts)) ?? []
        unreadCount = Int(try c.decodeFlexibleDouble(forKey: .unreadCount) ?? 0)
        canPublish = try c.decodeIfPresent(Bool.self, forKey: .canPublish) ?? false
    }

    private enum CodingKeys: String, CodingKey { case posts, unreadCount, canPublish }
}

// ── Командный чат: /api/team-chat ────────────────────────────────────────────

/// Сообщение общего чата команды.
public struct TeamChatMessage: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let senderUserID: String?
    public let senderOperatorID: String?
    public let senderName: String
    public let senderRole: String?
    public let senderAvatarURL: String?
    public let text: String
    public let attachments: [FeedAttachment]
    public let replyToID: String?
    public let editedAt: Date?
    public let deletedAt: Date?
    public let isAnnouncement: Bool
    public let pinnedUntil: Date?
    public let createdAt: Date?
    public let reactions: [FeedReaction]
    /// Сообщение уже на экране, а на сервер ещё летит.
    ///
    /// Ждать ответа, глядя на пустое поле ввода, — худшее, что может делать
    /// чат: человек не понимает, ушло или нет, и жмёт «отправить» второй раз.
    public let isPending: Bool

    public var isDeleted: Bool { deletedAt != nil }
    public var isEdited: Bool { editedAt != nil }
    public var initials: String { FeedText.initials(senderName) }
    public var displayText: String { FeedText.display(text) }
    public var reactionGroups: [FeedReactionGroup] { groupReactions(reactions) }

    /// Закрепление живёт до даты: истёкшее не держит сообщение наверху.
    public var isPinned: Bool {
        guard let pinnedUntil else { return false }
        return pinnedUntil.timeIntervalSinceNow > 0
    }

    public var roleLabel: String? {
        switch senderRole {
        case "owner": "владелец"
        case "manager": "менеджер"
        case "operator": "оператор"
        case "super_admin": "супер-админ"
        default: nil
        }
    }

    /// То, что только что набрали. Живёт на экране до ответа сервера.
    public init(pendingText: String, senderName: String, senderRole: String?) {
        id = "pending-\(UUID().uuidString)"
        senderUserID = nil
        senderOperatorID = nil
        self.senderName = senderName
        self.senderRole = senderRole
        senderAvatarURL = nil
        text = pendingText
        attachments = []
        replyToID = nil
        editedAt = nil
        deletedAt = nil
        isAnnouncement = false
        pinnedUntil = nil
        createdAt = Date()
        reactions = []
        isPending = true
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        isPending = false
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        senderUserID = try c.decodeFlexibleString(forKey: .senderUserID)
        senderOperatorID = try c.decodeFlexibleString(forKey: .senderOperatorID)
        senderName = try c.decodeFlexibleString(forKey: .senderName) ?? "Аноним"
        senderRole = try c.decodeFlexibleString(forKey: .senderRole)
        senderAvatarURL = try c.decodeFlexibleString(forKey: .senderAvatarURL)
        text = try c.decodeFlexibleString(forKey: .message) ?? ""
        attachments = (try? c.decodeIfPresent([FeedAttachment].self, forKey: .attachments)) ?? []
        replyToID = try c.decodeFlexibleString(forKey: .replyToID)
        editedAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .editedAt))
        deletedAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .deletedAt))
        isAnnouncement = try c.decodeIfPresent(Bool.self, forKey: .isAnnouncement) ?? false
        pinnedUntil = DateParsing.date(from: try c.decodeFlexibleString(forKey: .pinnedUntil))
        createdAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .createdAt))
        reactions = (try? c.decodeIfPresent([FeedReaction].self, forKey: .reactions)) ?? []
    }

    private enum CodingKeys: String, CodingKey {
        case id, message, attachments, reactions
        case senderUserID = "sender_user_id"
        case senderOperatorID = "sender_operator_id"
        case senderName = "sender_name"
        case senderRole = "sender_role"
        case senderAvatarURL = "sender_avatar_url"
        case replyToID = "reply_to_id"
        case editedAt = "edited_at"
        case deletedAt = "deleted_at"
        case isAnnouncement = "is_announcement"
        case pinnedUntil = "pinned_until"
        case createdAt = "created_at"
    }
}

/// Ответ `GET /api/team-chat`. Сообщения приходят уже от старых к новым.
/// Вариант ответа опроса.
public struct PollOption: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let label: String

    private enum CodingKeys: String, CodingKey { case id, label }

    public init(id: String, label: String) {
        self.id = id
        self.label = label
    }
}

/// Опрос с результатами.
///
/// Голоса не тайные: видно, кто за что. В чате смены это и нужно — опрос там
/// не про мнение, а про «кто выходит в субботу».
public struct ChatPoll: Decodable, Sendable, Hashable {
    public let id: String
    public let question: String
    public let options: [PollOption]
    public let isMultipleChoice: Bool
    public let counts: [String: Int]
    public let voters: [String: [String]]
    public let myVote: [String]
    public let totalVotes: Int

    public func count(for option: PollOption) -> Int { counts[option.id] ?? 0 }
    public func hasVoted(for option: PollOption) -> Bool { myVote.contains(option.id) }

    /// Доля голосов за вариант. Ноль голосов — ноль ширины, а не пустая полоса
    /// во всю карточку.
    public func share(for option: PollOption) -> Double {
        guard totalVotes > 0 else { return 0 }
        return Double(count(for: option)) / Double(totalVotes)
    }

    public func voterNames(for option: PollOption) -> [String] { voters[option.id] ?? [] }

    private enum CodingKeys: String, CodingKey {
        case poll, counts, voters, myVote, totalVotes
    }

    private enum PollKeys: String, CodingKey {
        case id, question, options
        case multipleChoice = "multiple_choice"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let pollContainer = try c.nestedContainer(keyedBy: PollKeys.self, forKey: .poll)
        id = try pollContainer.decodeFlexibleString(forKey: .id) ?? ""
        question = try pollContainer.decodeFlexibleString(forKey: .question) ?? ""
        options = (try? pollContainer.decodeIfPresent([PollOption].self, forKey: .options)) ?? []
        isMultipleChoice = (try? pollContainer.decodeIfPresent(Bool.self, forKey: .multipleChoice)) ?? false
        counts = (try? c.decodeIfPresent([String: Int].self, forKey: .counts)) ?? [:]
        voters = (try? c.decodeIfPresent([String: [String]].self, forKey: .voters)) ?? [:]
        myVote = (try? c.decodeIfPresent([String].self, forKey: .myVote)) ?? []
        totalVotes = (try? c.decodeIfPresent(Int.self, forKey: .totalVotes)) ?? 0
    }
}

public struct TeamChatFeed: Decodable, Sendable {
    public let messages: [TeamChatMessage]
    public let pinned: [TeamChatMessage]
    /// Опросы по идентификатору сообщения — так их отдаёт сервер.
    public let polls: [String: ChatPoll]

    /// Удалённые сервер отдаёт с пустым текстом — в ленте им делать нечего.
    public var visible: [TeamChatMessage] { messages.filter { !$0.isDeleted } }

    public func message(id: String) -> TeamChatMessage? {
        messages.first { $0.id == id }
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        messages = (try? c.decodeIfPresent([TeamChatMessage].self, forKey: .messages)) ?? []
        pinned = (try? c.decodeIfPresent([TeamChatMessage].self, forKey: .pinned)) ?? []
        polls = (try? c.decodeIfPresent([String: ChatPoll].self, forKey: .polls)) ?? [:]
    }

    public func poll(for message: TeamChatMessage) -> ChatPoll? { polls[message.id] }

    private enum CodingKeys: String, CodingKey { case messages, pinned, polls }
}

// ── Личные сообщения: /api/direct-messages ───────────────────────────────────

/// Строка списка переписок.
/// Человек, которому можно написать: `/api/direct-messages/contacts`.
///
/// Список ограничен своей организацией — оператор чужой в него не попадёт, как
/// не пройдёт и проверку при отправке.
public struct DirectContact: Decodable, Sendable, Identifiable, Hashable {
    public let userID: String
    public let name: String
    public let role: String?
    /// `staff` или `operator` — по этому в списке видно, кто перед тобой.
    public let kind: String

    public var id: String { userID }

    public var isOperator: Bool { kind == "operator" }

    public var roleLabel: String? {
        switch role {
        case "owner": "владелец"
        case "manager": "менеджер"
        case "marketer": "маркетолог"
        case "operator": "оператор"
        default: role
        }
    }

    private enum CodingKeys: String, CodingKey {
        case name, role, kind
        case userID = "user_id"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        userID = try c.decodeFlexibleString(forKey: .userID) ?? ""
        name = try c.decodeFlexibleString(forKey: .name) ?? "Без имени"
        role = try c.decodeFlexibleString(forKey: .role)
        kind = try c.decodeFlexibleString(forKey: .kind) ?? "staff"
    }
}

public struct DirectThread: Decodable, Sendable, Identifiable, Hashable {
    public let otherUserID: String
    public let otherName: String
    public let lastMessage: String
    public let lastAt: Date?
    public let lastFromMe: Bool
    public let unreadCount: Int

    public var id: String { otherUserID }
    public var initials: String { FeedText.initials(otherName) }
    public var preview: String { FeedText.preview(lastMessage) }
    public var hasUnread: Bool { unreadCount > 0 }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        otherUserID = try c.decodeFlexibleString(forKey: .otherUserId) ?? ""
        otherName = try c.decodeFlexibleString(forKey: .otherName) ?? "Без имени"
        lastMessage = try c.decodeFlexibleString(forKey: .lastMessage) ?? ""
        lastAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .lastAt))
        lastFromMe = try c.decodeIfPresent(Bool.self, forKey: .lastFromMe) ?? false
        unreadCount = Int(try c.decodeFlexibleDouble(forKey: .unreadCount) ?? 0)
    }

    private enum CodingKeys: String, CodingKey {
        case otherUserId, otherName, lastMessage, lastAt, lastFromMe, unreadCount
    }
}

extension DirectThread {
    /// Пустая переписка с человеком, которому ещё не писали.
    ///
    /// Нужна, чтобы после выбора собеседника открылся разговор, а не список:
    /// на сервере такой переписки пока нет, она появится с первым сообщением.
    public init(placeholderFor contact: DirectContact) {
        self.init(withUserID: contact.userID, name: contact.name)
    }

    /// То же, но по человеку из чата: там на руках только идентификатор и имя.
    ///
    /// Нужна, чтобы из командного чата можно было написать лично, не выходя в
    /// список переписок и не отыскивая человека в списке заново.
    public init(withUserID userID: String, name: String) {
        otherUserID = userID
        otherName = name
        lastMessage = ""
        lastAt = nil
        lastFromMe = false
        unreadCount = 0
    }
}

/// Карточка коллеги из чата: `/api/team-chat/person`.
///
/// Три факта и ничего больше: где работает, сколько работает и на смене ли
/// сейчас. Телефон намеренно не приходит — рабочий чат для того и есть, а
/// личный номер коллеги человек не соглашался показывать всей смене.
public struct ChatPersonCard: Decodable, Sendable {
    public let name: String
    public let position: String?
    public let companies: [String]
    public let hireDate: Date?
    public let onShift: Bool
    /// Где именно на смене. Пусто — точка не определилась.
    public let shiftCompany: String?

    /// Сколько работает. `nil` — дата приёма не заполнена.
    public var tenureLabel: String? {
        guard let hireDate else { return nil }
        let days = Calendar.current.dateComponents([.day], from: hireDate, to: Date()).day ?? 0
        guard days >= 0 else { return nil }
        if days < 31 { return "\(days) дн." }
        let months = days / 30
        if months < 12 { return "\(months) мес." }
        let years = months / 12
        let rest = months % 12
        return rest == 0 ? "\(years) г." : "\(years) г. \(rest) мес."
    }

    private enum CodingKeys: String, CodingKey {
        case name, position, companies
        case hireDate = "hire_date"
        case onShift = "on_shift"
        case shiftCompany = "shift_company"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? "Коллега"
        position = try c.decodeIfPresent(String.self, forKey: .position)
        companies = try c.decodeIfPresent([String].self, forKey: .companies) ?? []
        hireDate = (try c.decodeIfPresent(String.self, forKey: .hireDate)).flatMap(DateParsing.parseDateOnly)
        onShift = try c.decodeIfPresent(Bool.self, forKey: .onShift) ?? false
        shiftCompany = try c.decodeIfPresent(String.self, forKey: .shiftCompany)
    }
}

public struct DirectThreadList: Decodable, Sendable {
    public let threads: [DirectThread]

    public var unreadTotal: Int { threads.reduce(0) { $0 + $1.unreadCount } }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        threads = ((try? c.decodeIfPresent([DirectThread].self, forKey: .threads)) ?? [])
            .filter { !$0.otherUserID.isEmpty }
    }

    private enum CodingKeys: String, CodingKey { case threads }
}

/// Сообщение переписки один-на-один.
public struct DirectMessage: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let senderUserID: String?
    public let recipientUserID: String?
    public let senderName: String
    public let senderRole: String?
    public let text: String
    public let attachments: [FeedAttachment]
    public let replyToID: String?
    public let editedAt: Date?
    public let deletedAt: Date?
    public let readAt: Date?
    public let createdAt: Date?

    /// Уже на экране, но ещё летит на сервер.
    public let isPending: Bool

    public var isDeleted: Bool { deletedAt != nil }
    public var isEdited: Bool { editedAt != nil }
    public var isRead: Bool { readAt != nil }
    public var displayText: String { FeedText.display(text) }

    /// Своё сообщение определяем по собеседнику, а не по своему id: id текущего
    /// пользователя в ответе не приходит, а собеседник известен по маршруту.
    public func isMine(otherUserID: String) -> Bool {
        senderUserID != otherUserID
    }

    /// Только что набранное письмо. Показывается сразу, до ответа сервера.
    public init(pendingText: String, to recipientUserID: String, senderName: String) {
        id = "pending-\(UUID().uuidString)"
        senderUserID = nil
        self.recipientUserID = recipientUserID
        self.senderName = senderName
        senderRole = nil
        text = pendingText
        attachments = []
        replyToID = nil
        editedAt = nil
        deletedAt = nil
        readAt = nil
        createdAt = Date()
        isPending = true
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        isPending = false
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        senderUserID = try c.decodeFlexibleString(forKey: .senderUserID)
        recipientUserID = try c.decodeFlexibleString(forKey: .recipientUserID)
        senderName = try c.decodeFlexibleString(forKey: .senderName) ?? "Аноним"
        senderRole = try c.decodeFlexibleString(forKey: .senderRole)
        text = try c.decodeFlexibleString(forKey: .message) ?? ""
        attachments = (try? c.decodeIfPresent([FeedAttachment].self, forKey: .attachments)) ?? []
        replyToID = try c.decodeFlexibleString(forKey: .replyToID)
        editedAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .editedAt))
        deletedAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .deletedAt))
        readAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .readAt))
        createdAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .createdAt))
    }

    private enum CodingKeys: String, CodingKey {
        case id, message, attachments
        case senderUserID = "sender_user_id"
        case recipientUserID = "recipient_user_id"
        case senderName = "sender_name"
        case senderRole = "sender_role"
        case replyToID = "reply_to_id"
        case editedAt = "edited_at"
        case deletedAt = "deleted_at"
        case readAt = "read_at"
        case createdAt = "created_at"
    }
}

/// Ответ `GET /api/direct-messages/{userId}`.
public struct DirectConversation: Decodable, Sendable {
    public let messages: [DirectMessage]

    public var visible: [DirectMessage] { messages.filter { !$0.isDeleted } }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        messages = (try? c.decodeIfPresent([DirectMessage].self, forKey: .messages)) ?? []
    }

    private enum CodingKeys: String, CodingKey { case messages }
}

// ── Календарь: /api/calendar ─────────────────────────────────────────────────

public enum TeamCalendarEventKind: String, Sendable, Hashable, CaseIterable {
    case shift
    case birthday
    case holiday
    case announcement
    case other

    public init(raw: String?) {
        self = TeamCalendarEventKind(rawValue: raw ?? "") ?? .other
    }

    public var label: String {
        switch self {
        case .shift: "Смены"
        case .birthday: "Дни рождения"
        case .holiday: "Праздники"
        case .announcement: "Объявления"
        case .other: "Прочее"
        }
    }

    public var icon: String {
        switch self {
        case .shift: "clock"
        case .birthday: "gift"
        case .holiday: "flag"
        case .announcement: "megaphone"
        case .other: "circle"
        }
    }
}

/// Событие календаря. Сервер уже свёл смены, дни рождения, праздники РК и
/// объявления в один список — своя склейка на клиенте только разошлась бы с ним.
public struct TeamCalendarEvent: Decodable, Sendable, Identifiable, Hashable {
    public let id = UUID()
    public let dayKey: String
    public let date: Date?
    public let kind: TeamCalendarEventKind
    public let title: String
    public let subtitle: String?
    public let author: String?

    /// Заголовки с сервера приходят с эмодзи («🌙 Ночь»): в приложении рядом
    /// стоит нормальная иконка, и картинка в тексте выглядит мусором.
    public var cleanTitle: String {
        let scalars = title.unicodeScalars.filter { scalar in
            if scalar == "\u{FE0F}" { return false }     // селектор эмодзи-начертания
            if scalar.isASCII { return true }            // цифры считаются эмодзи-базой
            return !scalar.properties.isEmoji
        }
        let stripped = String(String.UnicodeScalarView(scalars)).trimmingCharacters(in: .whitespaces)
        return stripped.isEmpty ? title : stripped
    }

    private struct Meta: Decodable {
        let author: String?
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let raw = try c.decodeFlexibleString(forKey: .date) ?? ""
        dayKey = String(raw.prefix(10))
        date = DateParsing.parseDateOnly(dayKey)
        kind = TeamCalendarEventKind(raw: try c.decodeFlexibleString(forKey: .type))
        title = try c.decodeFlexibleString(forKey: .title) ?? "Событие"
        subtitle = try c.decodeFlexibleString(forKey: .subtitle)
        author = ((try? c.decodeIfPresent(Meta.self, forKey: .meta)) ?? nil)?.author
    }

    private enum CodingKeys: String, CodingKey { case date, type, title, subtitle, meta }
}

/// Ответ `GET /api/calendar`.
public struct TeamCalendar: Decodable, Sendable {
    public let events: [TeamCalendarEvent]
    /// Разложено по дням сразу: сетка спрашивает события 42 раза за перерисовку,
    /// и линейный поиск по списку на каждой клетке заметно тормозит прокрутку.
    public let byDay: [String: [TeamCalendarEvent]]

    public func events(on dayKey: String) -> [TeamCalendarEvent] {
        byDay[dayKey] ?? []
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let list = ((try? c.decodeIfPresent([TeamCalendarEvent].self, forKey: .events)) ?? [])
            .filter { !$0.dayKey.isEmpty }
        events = list
        byDay = Dictionary(grouping: list, by: \.dayKey)
    }

    private enum CodingKeys: String, CodingKey { case events }
}

/// Сетка месяца: шесть недель по семь дней, понедельник первым.
///
/// Считаем в UTC, потому что сервер отдаёт даты событий строками `yyyy-MM-dd`
/// без часового пояса. Собери сетку в местном времени — и в UTC+5 события
/// ночных смен переедут на соседнюю клетку.
public struct FeedCalendarMonth: Sendable, Hashable {
    public let monthStart: Date
    public let days: [Date]

    private static let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0) ?? .gmt
        calendar.firstWeekday = 2
        return calendar
    }()

    public static let weekdayTitles = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

    public init(anchor: Date = Date()) {
        let calendar = Self.calendar
        var parts = calendar.dateComponents([.year, .month], from: anchor)
        parts.day = 1
        parts.hour = 12
        let start = calendar.date(from: parts) ?? anchor
        monthStart = start

        let weekday = calendar.component(.weekday, from: start)
        let lead = (weekday - calendar.firstWeekday + 7) % 7
        let gridStart = calendar.date(byAdding: .day, value: -lead, to: start) ?? start

        // Всегда шесть недель: сетка переменной высоты прыгает при листании,
        // и взгляд теряет строку, за которую держался.
        days = (0..<42).compactMap { calendar.date(byAdding: .day, value: $0, to: gridStart) }
    }

    public func shifted(by months: Int) -> FeedCalendarMonth {
        let next = Self.calendar.date(byAdding: .month, value: months, to: monthStart) ?? monthStart
        return FeedCalendarMonth(anchor: next)
    }

    public var title: String {
        monthStart.formatted(.dateTime.month(.wide).year()).capitalized
    }

    public var fromKey: String { key(for: days.first ?? monthStart) }
    public var toKey: String { key(for: days.last ?? monthStart) }

    public func key(for day: Date) -> String {
        DateParsing.dateOnlyString(from: day)
    }

    public func dayNumber(_ day: Date) -> Int {
        Self.calendar.component(.day, from: day)
    }

    public func isInMonth(_ day: Date) -> Bool {
        Self.calendar.isDate(day, equalTo: monthStart, toGranularity: .month)
    }

    public func isWeekend(_ day: Date) -> Bool {
        let weekday = Self.calendar.component(.weekday, from: day)
        return weekday == 1 || weekday == 7
    }

    public var weeks: [[Date]] {
        stride(from: 0, to: days.count, by: 7).map { Array(days[$0..<min($0 + 7, days.count)]) }
    }
}

// ── Модерация ИИ: /api/admin/moderation ──────────────────────────────────────

/// Флаг, который ИИ поставил подозрительному сообщению.
public struct ModerationFlag: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let source: String
    public let authorName: String
    public let messageText: String
    public let severity: Int
    public let categories: [String]
    public let aiSummary: String?
    public let status: String
    public let reviewerNote: String?
    public let createdAt: Date?

    public var isPending: Bool { status == "pending" }
    public var isConfirmed: Bool { status == "confirmed" }
    public var initials: String { FeedText.initials(authorName) }

    public var sourceLabel: String {
        switch source {
        case "team_chat": "Командный чат"
        case "direct_messages": "Личное сообщение"
        default: source
        }
    }

    /// Порог 8 — то, из-за чего стоит поднять трубку; 6 — то, что читают
    /// сегодня; ниже — то, что разбирают, когда дойдут руки.
    public var isCritical: Bool { severity >= 8 }
    public var isSerious: Bool { severity >= 6 }

    public var categoryLabels: [String] {
        categories.map { Self.categoryNames[$0] ?? $0 }
    }

    private static let categoryNames: [String: String] = [
        "cash_skim": "Сговор / кража",
        "data_leak": "Утечка данных",
        "harassment": "Харассмент",
        "threat": "Угрозы",
        "profanity": "Грубость",
        "other": "Другое",
    ]

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        source = try c.decodeFlexibleString(forKey: .sourceTable) ?? "team_chat"
        authorName = try c.decodeFlexibleString(forKey: .authorName) ?? "Аноним"
        messageText = try c.decodeFlexibleString(forKey: .messageText) ?? ""
        severity = Int(try c.decodeFlexibleDouble(forKey: .severity) ?? 0)
        categories = (try? c.decodeIfPresent([String].self, forKey: .categories)) ?? []
        aiSummary = try c.decodeFlexibleString(forKey: .aiSummary)
        status = try c.decodeFlexibleString(forKey: .status) ?? "pending"
        reviewerNote = try c.decodeFlexibleString(forKey: .reviewerNote)
        createdAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .createdAt))
    }

    private enum CodingKeys: String, CodingKey {
        case id, severity, categories, status
        case sourceTable = "source_table"
        case authorName = "author_name"
        case messageText = "message_text"
        case aiSummary = "ai_summary"
        case reviewerNote = "reviewer_note"
        case createdAt = "created_at"
    }
}

/// Ответ `GET /api/admin/moderation`.
public struct ModerationFlagList: Decodable, Sendable {
    public let flags: [ModerationFlag]
    public let pendingCount: Int

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        flags = (try? c.decodeIfPresent([ModerationFlag].self, forKey: .flags)) ?? []
        pendingCount = Int(try c.decodeFlexibleDouble(forKey: .pendingCount) ?? 0)
    }

    private enum CodingKeys: String, CodingKey { case flags, pendingCount }
}

public enum ModerationStatus: String, Sendable, CaseIterable, Identifiable {
    case pending
    case confirmed
    case dismissed

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .pending: "На рассмотрении"
        case .confirmed: "Подтверждённые"
        case .dismissed: "Отклонённые"
        }
    }
}

// ── Сервис ───────────────────────────────────────────────────────────────────

/// Пространство команды: лента, чаты, календарь, модерация.
/// Загруженный файл — то, что уходит в сообщение.
public struct UploadedAttachment: Sendable, Hashable {
    public let type: String
    public let url: String
    public let name: String

    public init(type: String, url: String, name: String) {
        self.type = type
        self.url = url
        self.name = name
    }
}

struct UploadResponse: Decodable, Sendable {
    let url: String
    let name: String?
}

public struct FeedService: Sendable {
    private let api: APIClient

    public init(api: APIClient) { self.api = api }

    // Новости

    public func news(limit: Int = 30) async throws -> NewsFeed {
        try await api.send(APIRequest(path: "/api/news", query: ["limit": String(limit)]))
    }

    public func publishNews(title: String?, body: String) async throws {
        var payload: [String: Any] = ["body": body]
        if let title, !title.isEmpty { payload["title"] = title }
        _ = try await api.send(
            APIRequest(
                path: "/api/news",
                method: .post,
                body: try JSONSerialization.data(withJSONObject: payload)
            )
        )
    }

    public func markNewsViewed(postID: String) async throws {
        _ = try await api.send(
            APIRequest(
                path: "/api/news/view",
                method: .post,
                body: try JSONSerialization.data(withJSONObject: ["postId": postID])
            )
        )
    }

    public func deleteNews(postID: String) async throws {
        _ = try await api.send(
            APIRequest(
                path: "/api/news",
                method: .delete,
                body: try JSONSerialization.data(withJSONObject: ["id": postID])
            )
        )
    }

    // Командный чат

    public func teamChat(limit: Int = 80, search: String = "") async throws -> TeamChatFeed {
        var query = ["limit": String(limit)]
        if !search.isEmpty { query["q"] = search }
        return try await api.send(APIRequest(path: "/api/team-chat", query: query))
    }

    public func sendTeamMessage(
        _ text: String,
        replyToID: String? = nil,
        attachments: [UploadedAttachment] = []
    ) async throws {
        var payload: [String: Any] = ["message": text]
        if let replyToID { payload["replyToId"] = replyToID }
        if !attachments.isEmpty {
            payload["attachments"] = attachments.map { attachment in
                ["type": attachment.type, "url": attachment.url, "name": attachment.name]
            }
        }
        _ = try await api.send(
            APIRequest(
                path: "/api/team-chat",
                method: .post,
                body: try JSONSerialization.data(withJSONObject: payload)
            )
        )
    }

    /// Загрузить файл в чат: фото, голосовое, документ.
    ///
    /// Двумя шагами — сначала файл, потом сообщение с ссылкой на него: так
    /// сервер и работает, и так же ведёт себя сайт.
    public func upload(
        data: Data,
        fileName: String,
        mimeType: String,
        kind: String
    ) async throws -> UploadedAttachment {
        let response: UploadResponse = try await api.send(
            APIRequest.multipart(
                "/api/team-chat/upload",
                fileField: "file",
                fileName: fileName,
                mimeType: mimeType,
                fileData: data
            )
        )
        return UploadedAttachment(type: kind, url: response.url, name: response.name ?? fileName)
    }

    /// Карточка коллеги из чата.
    public func chatPerson(userID: String) async throws -> ChatPersonCard {
        let response: DataEnvelope<ChatPersonCard> = try await api.send(
            APIRequest(path: "/api/team-chat/person", query: ["userId": userID])
        )
        return response.data
    }

    /// Реакция на сообщение. Повторная с тем же значком — снимает.
    public func react(messageID: String, emoji: String) async throws {
        _ = try await api.send(
            APIRequest(
                path: "/api/team-chat/reactions",
                method: .post,
                body: try JSONSerialization.data(
                    withJSONObject: ["messageId": messageID, "emoji": emoji]
                )
            )
        )
    }

    /// Правка своего сообщения.
    public func editTeamMessage(id: String, text: String) async throws {
        _ = try await api.send(
            APIRequest(
                path: "/api/team-chat",
                method: .patch,
                body: try JSONSerialization.data(withJSONObject: ["id": id, "message": text])
            )
        )
    }

    public func deleteTeamMessage(id: String) async throws {
        _ = try await api.send(
            APIRequest(
                path: "/api/team-chat",
                method: .delete,
                body: try JSONSerialization.data(withJSONObject: ["id": id])
            )
        )
    }

    /// Закрепить сообщение до указанного момента.
    ///
    /// Срок обязателен: закрепление без срока превращает шапку чата в свалку,
    /// которую никто не разбирает.
    public func pinTeamMessage(id: String, until: Date) async throws {
        _ = try await api.send(
            APIRequest(
                path: "/api/team-chat/pin",
                method: .post,
                body: try JSONSerialization.data(withJSONObject: [
                    "id": id,
                    "until": ISO8601DateFormatter().string(from: until),
                ])
            )
        )
    }

    public func unpinTeamMessage(id: String) async throws {
        _ = try await api.send(
            APIRequest(
                path: "/api/team-chat/pin",
                method: .delete,
                body: try JSONSerialization.data(withJSONObject: ["id": id])
            )
        )
    }

    /// Пожаловаться на сообщение.
    ///
    /// Требование App Store к приложениям с перепиской: пожаловаться нужно
    /// уметь из приложения, а не письмом в поддержку. Жалоба ложится в тот же
    /// журнал модерации, что и находки ИИ, — владелец разбирает их в одном
    /// месте.
    public func report(messageID: String, source: String, reason: String = "") async throws {
        var payload: [String: Any] = ["messageId": messageID, "source": source]
        if !reason.isEmpty { payload["reason"] = reason }
        _ = try await api.send(
            APIRequest(
                path: "/api/chat/report",
                method: .post,
                body: try JSONSerialization.data(withJSONObject: payload)
            )
        )
    }

    // Блокировка собеседника

    public func blockedUsers() async throws -> [String] {
        struct Response: Decodable, Sendable { let data: [String] }
        let response: Response = try await api.send(APIRequest(path: "/api/direct-messages/block"))
        return response.data
    }

    public func setBlocked(_ blocked: Bool, userID: String) async throws {
        _ = try await api.send(
            APIRequest(
                path: "/api/direct-messages/block",
                method: blocked ? .post : .delete,
                body: try JSONSerialization.data(withJSONObject: ["userId": userID])
            )
        )
    }

    // Опросы

    /// Создать опрос. Сообщение в чате сервер заведёт сам.
    public func createPoll(question: String, options: [String]) async throws {
        let payload: [String: Any] = [
            "question": question,
            "options": options.enumerated().map { index, label in
                ["id": "opt\(index + 1)", "label": label]
            },
        ]
        _ = try await api.send(
            APIRequest(
                path: "/api/team-chat/polls",
                method: .post,
                body: try JSONSerialization.data(withJSONObject: payload)
            )
        )
    }

    /// Проголосовать. Повторный голос за тот же вариант его снимает — так же,
    /// как на сайте.
    public func vote(pollID: String, optionID: String) async throws {
        _ = try await api.send(
            APIRequest(
                path: "/api/team-chat/polls/\(pollID)/vote",
                method: .post,
                body: try JSONSerialization.data(withJSONObject: ["optionId": optionID])
            )
        )
    }

    // Личные сообщения

    public func threads() async throws -> DirectThreadList {
        try await api.send(APIRequest(path: "/api/direct-messages/threads"))
    }

    /// Кому можно написать. Пустой запрос — все, кто доступен.
    public func contacts(search: String = "") async throws -> [DirectContact] {
        var query: [String: String] = [:]
        if !search.isEmpty { query["search"] = search }
        let response: DataList<DirectContact> = try await api.send(
            APIRequest(path: "/api/direct-messages/contacts", query: query)
        )
        return response.items
    }

    public func conversation(with userID: String, limit: Int = 100) async throws -> DirectConversation {
        try await api.send(
            APIRequest(path: "/api/direct-messages/\(userID)", query: ["limit": String(limit)])
        )
    }

    public func sendDirect(
        to userID: String,
        text: String,
        attachments: [UploadedAttachment] = []
    ) async throws {
        var payload: [String: Any] = ["recipientUserId": userID, "message": text]
        if !attachments.isEmpty {
            payload["attachments"] = attachments.map { attachment in
                ["type": attachment.type, "url": attachment.url, "name": attachment.name]
            }
        }
        _ = try await api.send(
            APIRequest(
                path: "/api/direct-messages",
                method: .post,
                body: try JSONSerialization.data(withJSONObject: payload)
            )
        )
    }

    // Календарь

    public func calendar(from: String, to: String) async throws -> TeamCalendar {
        try await api.send(APIRequest(path: "/api/calendar", query: ["from": from, "to": to]))
    }

    // Модерация

    public func moderation(status: ModerationStatus) async throws -> ModerationFlagList {
        try await api.send(
            APIRequest(path: "/api/admin/moderation", query: ["status": status.rawValue])
        )
    }

    public func reviewFlag(id: String, status: ModerationStatus) async throws {
        _ = try await api.send(
            APIRequest(
                path: "/api/admin/moderation",
                method: .patch,
                body: try JSONSerialization.data(
                    withJSONObject: ["id": id, "status": status.rawValue]
                )
            )
        )
    }
}
