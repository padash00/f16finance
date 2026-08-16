import Foundation

/// Очередь несетевых действий смены.
///
/// Чеки свою очередь имеют давно — без неё касса в подвале просто не работала
/// бы. Но у смены есть и другие действия, которые так же теряются при обрыве
/// связи: подтверждение прочтения регламента, ответ на задачу, ответы и
/// завершение чек-листа. Человек нажал, увидел ошибку сети — и обязательный
/// чек-лист остался непройденным, а смена не закрывается.
///
/// Сюда складываются **только идемпотентные** действия: те, где повтор
/// приводит к тому же результату. Подтвердить прочтение дважды — это одно
/// подтверждение; ответить на задачу дважды — тот же статус. Создание записей
/// (расход, комментарий) сюда класть нельзя: у них нет ключа, по которому
/// сервер отличил бы повтор от второй записи, и очередь наплодила бы дубли.
public actor ActionOutbox {
    /// Одно отложенное действие.
    ///
    /// Хранится как готовый запрос, а не как «тип действия с параметрами»: так
    /// очередь не знает про домен и не ломается, когда у метода появляется
    /// новый аргумент.
    public struct Item: Codable, Sendable, Identifiable, Equatable {
        public let id: String
        public let createdAt: Date
        public let path: String
        public let method: String
        public let body: Data?
        /// Что это было, человеческими словами: показываем в списке ожидающих.
        public let title: String
        /// Ключ склейки. Повторное действие над тем же объектом заменяет
        /// предыдущее: три раза изменённый ответ на задачу должен уйти один раз
        /// и последним значением.
        public let mergeKey: String

        public init(
            id: String = UUID().uuidString,
            createdAt: Date = Date(),
            path: String,
            method: String,
            body: Data?,
            title: String,
            mergeKey: String
        ) {
            self.id = id
            self.createdAt = createdAt
            self.path = path
            self.method = method
            self.body = body
            self.title = title
            self.mergeKey = mergeKey
        }
    }

    private let fileURL: URL
    private let api: APIClient

    private var pending: [Item] = []
    private var isFlushing = false

    public var pendingCount: Int { pending.count }
    public var pendingItems: [Item] { pending }

    public init(api: APIClient, directory: URL? = nil) {
        self.api = api
        let base = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        fileURL = base.appending(path: "orda-action-outbox.json")
    }

    public func load() {
        guard
            let data = try? Data(contentsOf: fileURL),
            let decoded = try? JSONDecoder().decode([Item].self, from: data)
        else { return }
        pending = decoded.sorted { $0.createdAt < $1.createdAt }
    }

    private func persist() {
        guard let data = try? JSONEncoder().encode(pending) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }

    /// Выполнить действие. Не прошло по сети — отложить и считать сделанным.
    ///
    /// Возвращает `true`, если ушло на сервер сразу. `false` — отложено;
    /// экран должен показать это словами, а не тишиной.
    @discardableResult
    public func perform(_ item: Item) async throws -> Bool {
        do {
            _ = try await api.send(APIRequest(path: item.path, method: httpMethod(item.method), body: item.body))
            return true
        } catch let error as APIError where error.isRetryable {
            enqueue(item)
            return false
        } catch let error as APIError {
            // Отказ по существу — повтор даст тот же отказ. Пусть разбирается
            // человек, а не очередь.
            throw error
        } catch {
            enqueue(item)
            return false
        }
    }

    private func enqueue(_ item: Item) {
        pending.removeAll { $0.mergeKey == item.mergeKey }
        pending.append(item)
        persist()
    }

    @discardableResult
    public func flush() async -> FlushResult {
        guard !isFlushing, !pending.isEmpty else {
            return FlushResult(sent: 0, remaining: pending.count, failed: 0)
        }
        isFlushing = true
        defer { isFlushing = false }

        var sent = 0
        var failed = 0
        var stillPending: [Item] = []

        for item in pending {
            do {
                _ = try await api.send(
                    APIRequest(path: item.path, method: httpMethod(item.method), body: item.body)
                )
                sent += 1
            } catch let error as APIError where error.isRetryable {
                stillPending.append(item)
            } catch {
                failed += 1
            }
        }

        pending = stillPending
        persist()
        return FlushResult(sent: sent, remaining: pending.count, failed: failed)
    }

    public func drop(id: String) {
        pending.removeAll { $0.id == id }
        persist()
    }

    private func httpMethod(_ raw: String) -> HTTPMethod {
        switch raw.uppercased() {
        case "POST": return .post
        case "PATCH": return .patch
        case "PUT": return .put
        case "DELETE": return .delete
        default: return .get
        }
    }

    public struct FlushResult: Sendable {
        public let sent: Int
        public let remaining: Int
        public let failed: Int
    }
}
