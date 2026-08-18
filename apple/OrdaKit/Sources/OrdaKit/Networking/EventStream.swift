import Foundation

/// Поток событий с сервера (SSE).
///
/// Нужен ровно для одного: узнавать о новом сообщении в тот же миг, а не через
/// паузу опроса. Опрос раз в несколько секунд видно глазами — собеседник
/// ответил, а строчка появляется потом, и разговор кажется мёртвым.
///
/// Событие несёт только сигнал «появилось новое»: ленту клиент перечитывает
/// своим обычным маршрутом. Иначе разбор ответа жил бы в двух местах и однажды
/// разошёлся.
public struct EventStream: Sendable {
    private let api: APIClient

    public init(api: APIClient) { self.api = api }

    /// Имена событий, которые шлёт сервер.
    public enum Event: String, Sendable {
        case ready
        case message
        case bye
    }

    /// Держит соединение и отдаёт события по мере поступления.
    ///
    /// Поток завершается сам: сервер закрывает его через несколько минут (у
    /// бессерверных функций есть предел), а вызывающий просто открывает
    /// следующий. Ошибки не бросаем — обрыв связи здесь обычное дело, и
    /// падать из-за него экрану незачем.
    public func events(path: String, query: [String: String] = [:]) -> AsyncStream<Event> {
        AsyncStream { continuation in
            let task = Task {
                do {
                    let request = try await api.streamingURLRequest(
                        APIRequest(path: path, query: query)
                    )
                    let (bytes, response) = try await URLSession.shared.bytes(for: request)

                    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                        continuation.finish()
                        return
                    }

                    for try await line in bytes.lines {
                        if Task.isCancelled { break }
                        // Нас интересуют только строки с именем события:
                        // данные события мы не читаем, сигнала достаточно.
                        guard line.hasPrefix("event:") else { continue }
                        let name = line.dropFirst("event:".count).trimmingCharacters(in: .whitespaces)
                        if let event = Event(rawValue: name) {
                            continuation.yield(event)
                            if event == .bye { break }
                        }
                    }
                } catch {
                    // Обрыв — не ошибка: экран откроет поток заново.
                }
                continuation.finish()
            }

            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
