import Foundation

/// Чек-листы, пройденные без связи.
///
/// Обход точки — это двадцать минут работы: пятнадцать пунктов, фотографии,
/// комментарии. И проходят его как раз там, где связи нет: подсобка, склад,
/// дальний зал. Пока запуск чек-листа требовал сети, человек не мог даже
/// начать — а начав и потеряв связь на середине, терял всё.
///
/// Поэтому пройденный чек-лист складывается на диск целиком: шаблон, ответы,
/// время. Когда связь появится, приложение проиграет его на сервере как
/// обычно — запуск, ответы, завершение.
///
/// На диске, а не в памяти: телефон выключается, приложение выгружают, а
/// работа уже сделана, и потерять её нельзя.
public actor ChecklistOutbox {
    public struct Item: Codable, Sendable, Identifiable, Hashable {
        public let id: String
        public let templateID: String
        /// Название — для строки «ждёт связи»: показывать идентификатор
        /// человеку нечестно.
        public let title: String
        public let answers: [ChecklistAnswer]
        public let passedAt: Date

        public init(
            id: String = UUID().uuidString,
            templateID: String,
            title: String,
            answers: [ChecklistAnswer],
            passedAt: Date = Date()
        ) {
            self.id = id
            self.templateID = templateID
            self.title = title
            self.answers = answers
            self.passedAt = passedAt
        }
    }

    private let fileURL: URL
    private var items: [Item] = []
    private var isLoaded = false

    public init(directory: URL? = nil) {
        let base = directory ?? FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        fileURL = base.appendingPathComponent("orda-checklist-outbox.json")
    }

    private func loadIfNeeded() {
        guard !isLoaded else { return }
        isLoaded = true
        guard let data = try? Data(contentsOf: fileURL) else { return }
        items = (try? JSONDecoder().decode([Item].self, from: data)) ?? []
    }

    private func persist() {
        guard let data = try? JSONEncoder().encode(items) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }

    public func add(_ item: Item) {
        loadIfNeeded()
        // Один шаблон — одна запись: повторный проход того же чек-листа
        // заменяет прежний, а не копится второй строкой.
        items.removeAll { $0.templateID == item.templateID }
        items.append(item)
        persist()
    }

    public func pending() -> [Item] {
        loadIfNeeded()
        return items
    }

    public func remove(id: String) {
        loadIfNeeded()
        items.removeAll { $0.id == id }
        persist()
    }

    public func clear() {
        items = []
        isLoaded = true
        persist()
    }
}
