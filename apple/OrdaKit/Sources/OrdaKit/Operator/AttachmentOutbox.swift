import Foundation

/// Фотографии и голосовые, не ушедшие из-за связи.
///
/// Фото в чате — это не «ещё одно сообщение»: им показывают сломанный монитор,
/// разлитую витрину, накладную от поставщика. Снимают ровно там, где связи
/// нет, — в подсобке и на складе. Раньше такой снимок просто исчезал: файл
/// уходил отдельным запросом, и обрыв уносил его вместе с подписью.
///
/// Сам файл кладём на диск, а не держим в памяти: снимок весит мегабайты,
/// приложение выгружают, телефон выключают — а показать поломку всё ещё надо.
public actor AttachmentOutbox {
    public struct Item: Codable, Sendable, Identifiable, Hashable {
        public let id: String
        /// Чьё это. Телефон на точке общий, и работа сменщика не должна уйти
        /// под именем того, кто сейчас вошёл.
        public var owner: String?
        /// Куда отправлять: общий чат или личная переписка.
        public let scope: Scope
        /// Собеседник для личной переписки. Для чата пусто.
        public let recipientUserID: String?
        public let fileName: String
        public let mimeType: String
        /// `photo`, `voice`, `file` — сервер различает их при показе.
        public let kind: String
        public let caption: String
        public let createdAt: Date

        public enum Scope: String, Codable, Sendable {
            case teamChat
            case direct
        }

        public init(
            id: String = UUID().uuidString,
            owner: String? = nil,
            scope: Scope,
            recipientUserID: String? = nil,
            fileName: String,
            mimeType: String,
            kind: String,
            caption: String,
            createdAt: Date = Date()
        ) {
            self.id = id
            self.owner = owner
            self.scope = scope
            self.recipientUserID = recipientUserID
            self.fileName = fileName
            self.mimeType = mimeType
            self.kind = kind
            self.caption = caption
            self.createdAt = createdAt
        }
    }

    private let directory: URL
    private var items: [Item] = []
    private var isLoaded = false
    private var owner: String?

    public func setOwner(_ owner: String?) {
        self.owner = owner
    }

    public init(directory: URL? = nil) {
        let base = directory ?? FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("orda-attachments", isDirectory: true)
        self.directory = base
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
    }

    private var indexURL: URL { directory.appendingPathComponent("index.json") }
    private func fileURL(for id: String) -> URL { directory.appendingPathComponent("\(id).bin") }

    private func loadIfNeeded() {
        guard !isLoaded else { return }
        isLoaded = true
        guard let data = try? Data(contentsOf: indexURL) else { return }
        items = (try? JSONDecoder().decode([Item].self, from: data)) ?? []
    }

    private func persist() {
        guard let data = try? JSONEncoder().encode(items) else { return }
        try? data.write(to: indexURL, options: .atomic)
    }

    /// Отложить файл. Данные пишем первыми: запись в описи без файла — это
    /// вечная попытка отправить пустоту.
    public func add(_ item: Item, data: Data) {
        loadIfNeeded()
        do {
            try data.write(to: fileURL(for: item.id), options: .atomic)
        } catch {
            return
        }

        var stamped = item
        stamped.owner = item.owner ?? owner
        items.append(stamped)
        persist()
    }

    /// Только свои файлы: чужие ждут хозяина.
    public func pending() -> [Item] {
        loadIfNeeded()
        return items.filter { $0.owner == nil || $0.owner == owner }
    }

    public func data(for id: String) -> Data? {
        try? Data(contentsOf: fileURL(for: id))
    }

    /// Убрать вместе с файлом: иначе снимки копятся в памяти телефона молча.
    public func remove(id: String) {
        loadIfNeeded()
        items.removeAll { $0.id == id }
        try? FileManager.default.removeItem(at: fileURL(for: id))
        persist()
    }

    /// Отправить всё своё: загрузить файл и отослать сообщение.
    ///
    /// Отправка живёт здесь, а не в экранах: чат и личная переписка делали
    /// одно и то же двумя копиями, и профиль оператора завёл бы третью.
    /// Возвращает, сколько ушло.
    @discardableResult
    public func flush(using feed: FeedService) async -> Int {
        loadIfNeeded()
        var sent = 0

        for item in pending() {
            guard let data = data(for: item.id) else {
                // Файла нет — запись бессмысленна: вечная попытка отправить
                // пустоту, о которой никто не узнает.
                remove(id: item.id)
                continue
            }

            do {
                let uploaded = try await feed.upload(
                    data: data,
                    fileName: item.fileName,
                    mimeType: item.mimeType,
                    kind: item.kind
                )

                switch item.scope {
                case .teamChat:
                    try await feed.sendTeamMessage(item.caption, attachments: [uploaded])
                case .direct:
                    guard let userID = item.recipientUserID else {
                        // Личный файл без адресата отправлять некуда.
                        remove(id: item.id)
                        continue
                    }
                    try await feed.sendDirect(to: userID, text: item.caption, attachments: [uploaded])
                }

                remove(id: item.id)
                sent += 1
            } catch {
                // Связь снова пропала — остальное подождёт своей очереди.
                break
            }
        }

        return sent
    }

    public func clear() {
        loadIfNeeded()
        for item in items { try? FileManager.default.removeItem(at: fileURL(for: item.id)) }
        items = []
        persist()
    }
}
