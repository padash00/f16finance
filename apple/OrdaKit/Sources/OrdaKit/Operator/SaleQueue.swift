import Foundation

/// Очередь неотправленных продаж.
///
/// Точка может оказаться в подвале без связи, а очередь у кассы ждать не
/// будет. Чек записывается на устройство сразу и уходит на сервер, как только
/// появится сеть.
///
/// Безопасность повторов держится на `local_ref`: сервер дедуплицирует по
/// нему, поэтому «отправили, но не дождались ответа» не превращается во второй
/// чек. Именно поэтому отправлять можно смело, а удалять из очереди — только
/// после подтверждённого ответа.
public actor SaleQueue {
    /// Где лежит очередь. Файл, а не UserDefaults: чеки переживают падение
    /// приложения и не имеют лимита размера.
    private let fileURL: URL
    private let service: OperatorService

    /// Чек вместе с тем, кто его пробил.
    ///
    /// Телефон на точке общий. Неотправленный чек, ушедший под другим входом,
    /// попадёт в чужую смену — то есть в чужую кассу и чужой отчёт. Поэтому у
    /// каждого чека есть хозяин, и отправляем мы только своё.
    private struct Entry: Codable, Sendable {
        var draft: SaleDraft
        var owner: String?
    }

    private var pending: [Entry] = []
    private var isFlushing = false
    private var owner: String?

    /// Сколько чеков ждёт отправки. Показываем кассиру — он должен видеть,
    /// что деньги ещё не ушли на сервер. Чужие сюда не попадают: он их не
    /// пробивал и отвечать за них не должен.
    public var pendingCount: Int { mine.count }
    public var pendingDrafts: [SaleDraft] { mine.map(\.draft) }

    private var mine: [Entry] {
        pending.filter { $0.owner == nil || $0.owner == owner }
    }

    /// Кто вошёл. Чужие чеки останутся ждать своего кассира.
    public func setOwner(_ owner: String?) {
        self.owner = owner
    }

    public init(service: OperatorService, directory: URL? = nil) {
        self.service = service
        let base = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        fileURL = base.appending(path: "orda-sale-queue.json")
    }

    /// Загрузить очередь с диска при старте.
    public func load() {
        guard let data = try? Data(contentsOf: fileURL) else { return }

        if let decoded = try? JSONDecoder().decode([Entry].self, from: data) {
            pending = decoded.sorted { $0.draft.createdAt < $1.draft.createdAt }
            return
        }

        // Очередь, записанная прошлой версией: чеки без хозяина. Отправляем их
        // как раньше — других владельцев у них не было.
        if let legacy = try? JSONDecoder().decode([SaleDraft].self, from: data) {
            pending = legacy
                .sorted { $0.createdAt < $1.createdAt }
                .map { Entry(draft: $0, owner: nil) }
        }
    }

    private func persist() {
        guard let data = try? JSONEncoder().encode(pending) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }

    /// Провести продажу.
    ///
    /// Сначала пробуем отправить сразу — в норме сеть есть, и кассир должен
    /// получить чек и ссылку на него немедленно. Если не вышло по сетевой
    /// причине, чек уходит в очередь и продажа считается состоявшейся: товар
    /// уже отдан, отказывать поздно.
    public func submit(_ draft: SaleDraft) async -> SubmitOutcome {
        if let issue = draft.validate() {
            return .rejected(issue)
        }

        do {
            let result = try await service.createSale(draft)
            return .sent(result)
        } catch let error as APIError where error.isRetryable {
            enqueue(draft)
            return .queued(pendingCount: mine.count)
        } catch let error as APIError {
            // Отказ по существу — нет открытой смены, нет товара на витрине.
            // Складывать такой чек в очередь бессмысленно: повтор даст тот же
            // отказ, а кассир будет думать, что продажа прошла.
            return .failed(error)
        } catch {
            enqueue(draft)
            return .queued(pendingCount: mine.count)
        }
    }

    private func enqueue(_ draft: SaleDraft) {
        guard !pending.contains(where: { $0.draft.localRef == draft.localRef }) else { return }
        pending.append(Entry(draft: draft, owner: owner))
        persist()
    }

    /// Попытаться отправить всё накопленное. Вызывать при появлении сети и при
    /// открытии экрана продажи.
    @discardableResult
    public func flush() async -> FlushResult {
        guard !isFlushing, !mine.isEmpty else {
            return FlushResult(sent: 0, remaining: mine.count, failed: 0)
        }
        isFlushing = true
        defer { isFlushing = false }

        var sent = 0
        var failed = 0
        var stillPending: [Entry] = []

        for entry in pending {
            // Чужой чек не отправляем: он попал бы в смену того, кто сейчас
            // вошёл, — в чужую кассу и чужой отчёт. Дождётся своего кассира.
            guard entry.owner == nil || entry.owner == owner else {
                stillPending.append(entry)
                continue
            }

            do {
                _ = try await service.createSale(entry.draft)
                sent += 1
            } catch let error as APIError where error.isRetryable {
                // Сеть снова пропала — остаток оставляем на следующий раз.
                stillPending.append(entry)
            } catch {
                // Сервер отверг чек по существу. Держать его в очереди вечно
                // нельзя: он будет отвергаться при каждой попытке. Убираем и
                // сообщаем — разбираться придётся человеку.
                failed += 1
            }
        }

        pending = stillPending
        persist()
        return FlushResult(sent: sent, remaining: mine.count, failed: failed)
    }

    /// Убрать чек из очереди вручную (после разбора).
    public func drop(localRef: String) {
        pending.removeAll { $0.draft.localRef == localRef }
        persist()
    }

    public enum SubmitOutcome: Sendable {
        /// Ушло на сервер, чек создан.
        case sent(SaleResult)
        /// Сети нет, чек в очереди — продажа состоялась.
        case queued(pendingCount: Int)
        /// Сервер отказал по существу.
        case failed(APIError)
        /// Чек не прошёл проверку на устройстве.
        case rejected(SaleDraft.ValidationIssue)
    }

    public struct FlushResult: Sendable {
        public let sent: Int
        public let remaining: Int
        public let failed: Int
    }
}
