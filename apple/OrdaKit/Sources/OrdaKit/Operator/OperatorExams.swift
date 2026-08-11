import Foundation

// ── Экзамены оператора ───────────────────────────────────────────────────────
//
// Аттестация жила только в Telegram: вопросы приходили ботом, ответы — кнопками
// под сообщением. У кого Telegram не заведён, попытка помечалась
// «недоставлено»: человек числился обязанным сдать экзамен, которого не видел,
// а владелец потом гадал, лень это или не дошло.
//
// Приложение — вторая дверь к тому же экзамену. Билет и подсчёт общие, сдать
// дважды нельзя. Правильные ответы сервер не отдаёт: одного скриншота хватило
// бы, чтобы билет ушёл следующему сдающему.

/// Экзамен в списке.
public struct OperatorExam: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let title: String
    public let status: String
    /// Можно ли отвечать прямо сейчас.
    public let isOpen: Bool
    public let deadlineAt: Date?
    public let passScore: Double
    public let totalQuestions: Int
    public let answered: Int
    public let currentIndex: Int
    public let score: Double?
    public let passed: Bool?
    public let hasOpenQuestions: Bool
    /// Есть развёрнутые ответы, которых руководитель ещё не смотрел.
    public let awaitingReview: Bool
    public let completedAt: Date?

    private enum CodingKeys: String, CodingKey {
        case id, title, status, score, passed
        case isOpen = "is_open"
        case deadlineAt = "deadline_at"
        case passScore = "pass_score"
        case totalQuestions = "total_questions"
        case answered
        case currentIndex = "current_index"
        case hasOpenQuestions = "has_open"
        case awaitingReview = "awaiting_review"
        case completedAt = "completed_at"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? "Экзамен"
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? "pending"
        isOpen = try c.decodeIfPresent(Bool.self, forKey: .isOpen) ?? false
        deadlineAt = DateParsing.date(from: try c.decodeIfPresent(String.self, forKey: .deadlineAt))
        passScore = try c.decodeFlexibleDouble(forKey: .passScore) ?? 70
        totalQuestions = Int(try c.decodeFlexibleDouble(forKey: .totalQuestions) ?? 0)
        answered = Int(try c.decodeFlexibleDouble(forKey: .answered) ?? 0)
        currentIndex = Int(try c.decodeFlexibleDouble(forKey: .currentIndex) ?? 0)
        score = try c.decodeFlexibleDouble(forKey: .score)
        passed = try c.decodeIfPresent(Bool.self, forKey: .passed)
        hasOpenQuestions = try c.decodeIfPresent(Bool.self, forKey: .hasOpenQuestions) ?? false
        awaitingReview = try c.decodeIfPresent(Bool.self, forKey: .awaitingReview) ?? false
        completedAt = DateParsing.date(from: try c.decodeIfPresent(String.self, forKey: .completedAt))
    }

    /// Сколько осталось. Показываем именно остаток: «отвечено 3 из 10» человек
    /// всё равно переводит в «ещё семь».
    public var remaining: Int { max(0, totalQuestions - answered) }

    public var isCompleted: Bool { status == "completed" }

    /// Просрочен ли срок сдачи.
    public var isOverdue: Bool {
        guard isOpen, let deadlineAt else { return false }
        return deadlineAt < Date()
    }
}

/// Вопрос, на котором человек остановился.
///
/// Приходит по одному: весь билет разом означал бы, что ответы находят в
/// регламенте по ходу дела, и аттестация превращается в переписывание.
public struct ExamQuestion: Decodable, Sendable, Hashable {
    public let index: Int
    public let text: String
    /// `choice` — варианты, `open` — развёрнутый ответ.
    public let type: String
    public let choices: [String]
    public let maxScore: Double

    public var isOpen: Bool { type == "open" }

    private enum CodingKeys: String, CodingKey {
        case index, text, type, choices
        case maxScore = "max_score"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        index = Int(try c.decodeFlexibleDouble(forKey: .index) ?? 0)
        text = try c.decodeIfPresent(String.self, forKey: .text) ?? ""
        type = try c.decodeIfPresent(String.self, forKey: .type) ?? "choice"
        choices = try c.decodeIfPresent([String].self, forKey: .choices) ?? []
        maxScore = try c.decodeFlexibleDouble(forKey: .maxScore) ?? 1
    }
}

/// Состояние одной попытки: сам экзамен и текущий вопрос.
public struct ExamAttempt: Decodable, Sendable {
    public let exam: OperatorExam
    public let question: ExamQuestion?

    public init(from decoder: any Decoder) throws {
        exam = try OperatorExam(from: decoder)
        let c = try decoder.container(keyedBy: CodingKeys.self)
        question = try c.decodeIfPresent(ExamQuestion.self, forKey: .question)
    }

    private enum CodingKeys: String, CodingKey { case question }
}

/// `{ "data": ... }` — один объект. В проекте был только список.
public struct DataEnvelope<Value: Decodable & Sendable>: Decodable, Sendable {
    public let data: Value

    private enum CodingKeys: String, CodingKey { case data }
}

struct ExamAnswerRequest: Encodable {
    let index: Int
    let choice: Int?
    let text: String?
}

/// Экзамены отдельным сервисом: операторский контур большой, и держать всё в
/// одном типе значит листать тысячу строк ради двух методов.
public struct ExamService: Sendable {
    private let api: APIClient

    public init(api: APIClient) { self.api = api }

    /// Мои экзамены: открытые и недавние.
    public func exams() async throws -> [OperatorExam] {
        let response: DataList<OperatorExam> = try await api.send(
            APIRequest(path: "/api/operator/exams")
        )
        return response.items
    }

    public func examAttempt(id: String) async throws -> ExamAttempt {
        let response: DataEnvelope<ExamAttempt> = try await api.send(
            APIRequest(path: "/api/operator/exams/\(id)")
        )
        return response.data
    }

    /// Ответ на текущий вопрос. Возвращает следующее состояние — второй запрос
    /// не нужен: между вопросами пауза заметна, а экзамен сдают стоя за стойкой.
    public func answerExam(
        id: String,
        index: Int,
        choice: Int? = nil,
        text: String? = nil
    ) async throws -> ExamAttempt {
        let response: DataEnvelope<ExamAttempt> = try await api.send(
            APIRequest(
                path: "/api/operator/exams/\(id)",
                method: .post,
                body: try JSONEncoder().encode(
                    ExamAnswerRequest(index: index, choice: choice, text: text)
                )
            )
        )
        return response.data
    }
}

// ── Вход на точке по QR ──────────────────────────────────────────────────────

/// Подтверждение входа в программу на точке.
///
/// Программа на точке показывает QR, оператор сканирует его своим телефоном и
/// подтверждает — терминал входит сам. Пароль при этом нигде не звучит и не
/// набирается на общей клавиатуре, за которой стоит очередь.
public struct PointQRLogin: Sendable {
    /// Что зашито в QR: ссылка вида `.../operator/point-qr-confirm?n=<nonce>`.
    /// Иногда сканер отдаёт просто сам код — принимаем и его.
    public static func nonce(from scanned: String) -> String? {
        let trimmed = scanned.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        if let components = URLComponents(string: trimmed),
           let value = components.queryItems?.first(where: { $0.name == "n" })?.value,
           !value.isEmpty {
            return value
        }

        // Голый код: без пробелов и не ссылка на что-то другое.
        guard !trimmed.contains(" "), !trimmed.contains("://") else { return nil }
        return trimmed
    }
}

/// Чем закончилось подтверждение.
public enum PointQRResult: Sendable, Equatable {
    case approved
    /// Код просрочен: программа на точке обновляет его каждые несколько минут.
    case expired
    /// Кодом уже вошли.
    case used
    case notFound
    /// Временный пароль ещё не сменён — QR такой вход не открывает.
    case mustChangePassword
    case failed(String)

    public var message: String {
        switch self {
        case .approved: "Готово — программа на точке входит"
        case .expired: "Код просрочен. Обновите QR на терминале и отсканируйте заново."
        case .used: "Этим кодом уже вошли. Обновите QR на терминале."
        case .notFound: "Код не распознан. Наведите камеру на QR в программе точки."
        case .mustChangePassword: "Сначала смените временный пароль — войдите по паролю на терминале."
        case .failed(let text): text
        }
    }
}

extension ExamService {
    /// Подтвердить вход на точке.
    ///
    public func confirmPointQR(nonce: String) async -> PointQRResult {
        do {
            _ = try await api.send(
                APIRequest(
                    path: "/api/operator/point-qr-confirm",
                    method: .post,
                    body: try JSONSerialization.data(withJSONObject: ["nonce": nonce])
                )
            )
            return .approved
        } catch let error as APIError {
            // Сервер различает случаи — человеку нужно разное действие: обновить
            // QR, войти паролем или позвать управляющего. Просроченный код
            // приходит с кодом 410 и разбирается как «сервер», поэтому смотрим
            // и на текст ответа.
            switch error {
            case .conflict: return .used
            case .notFound: return .notFound
            case .forbidden: return .mustChangePassword
            case .server(let status, _) where status == 410: return .expired
            default: return .failed(error.userMessage)
            }
        } catch {
            return .failed(error.localizedDescription)
        }
    }
}
