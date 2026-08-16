import Foundation

/// Аттестация операторов со стороны руководителя.
///
/// Сдают экзамен в приложении давно, а назначали только на сайте: управляющий
/// на точке видел, что человек плавает в регламенте, и не мог тут же дать ему
/// билет. Здесь ровно то, что делают не за столом, — назначить, напомнить,
/// дать пересдачу и посмотреть, кто как сдал.
///
/// Правка вопросов и расписание регулярных экзаменов остаются на сайте: это
/// работа с текстом, её на телефоне не делают.
public struct AdminExamsOverview: Decodable, Sendable {
    public let exams: [AdminExam]
    public let companies: [Company]
    public let operators: [ExamOperator]

    public struct ExamOperator: Decodable, Sendable, Identifiable, Hashable {
        public let id: String
        public let name: String
        /// Точки, где человек работает. Экзамен по чужому регламенту сервер не
        /// пропустит, поэтому список нужен и для выбора.
        public let companyIDs: [String]
        /// Привязан ли Telegram. Без него билет придёт только в приложение.
        public let hasTelegram: Bool

        private enum CodingKeys: String, CodingKey {
            case id, name
            case companyIDs = "company_ids"
            case telegramChatID = "telegram_chat_id"
        }

        public init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decode(String.self, forKey: .id)
            name = try c.decodeIfPresent(String.self, forKey: .name) ?? "Без имени"
            companyIDs = try c.decodeIfPresent([String].self, forKey: .companyIDs) ?? []
            let chat = try? c.decodeFlexibleString(forKey: .telegramChatID)
            hasTelegram = (chat ?? nil)?.isEmpty == false
        }
    }

    private enum CodingKeys: String, CodingKey { case exams, companies, operators }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        exams = try c.decodeIfPresent([AdminExam].self, forKey: .exams) ?? []
        companies = try c.decodeIfPresent([Company].self, forKey: .companies) ?? []
        operators = try c.decodeIfPresent([ExamOperator].self, forKey: .operators) ?? []
    }
}

/// Экзамен в списке: сколько назначено, сколько сдали.
public struct AdminExam: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let title: String
    public let companyIDs: [String]
    public let questionCount: Int
    public let openCount: Int
    public let passScore: Int
    public let deadlineAt: Date?
    public let status: String
    public let createdAt: Date?

    public let assigned: Int
    public let completed: Int
    public let passed: Int
    public let averageScore: Int?

    /// Билеты разосланы. До этого экзамен — черновик, и вопросы ещё правятся.
    public var isSent: Bool { status != "draft" }

    public var statusLabel: String {
        switch status {
        case "draft": "Черновик"
        case "sent": "Разослан"
        case "closed": "Закрыт"
        default: status
        }
    }

    private enum CodingKeys: String, CodingKey {
        case id, title, status, assigned, completed, passed
        case companyIDs = "company_ids"
        case questionCount = "question_count"
        case openCount = "open_count"
        case passScore = "pass_score"
        case deadlineAt = "deadline_at"
        case createdAt = "created_at"
        case averageScore = "avg_score"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? "Экзамен"
        companyIDs = try c.decodeIfPresent([String].self, forKey: .companyIDs) ?? []
        questionCount = try c.decodeIfPresent(Int.self, forKey: .questionCount) ?? 0
        openCount = try c.decodeIfPresent(Int.self, forKey: .openCount) ?? 0
        passScore = try c.decodeIfPresent(Int.self, forKey: .passScore) ?? 70
        deadlineAt = (try c.decodeIfPresent(String.self, forKey: .deadlineAt)).flatMap(DateParsing.parse)
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? "draft"
        createdAt = (try c.decodeIfPresent(String.self, forKey: .createdAt)).flatMap(DateParsing.parse)
        assigned = try c.decodeIfPresent(Int.self, forKey: .assigned) ?? 0
        completed = try c.decodeIfPresent(Int.self, forKey: .completed) ?? 0
        passed = try c.decodeIfPresent(Int.self, forKey: .passed) ?? 0
        averageScore = try c.decodeIfPresent(Int.self, forKey: .averageScore)
    }
}

/// Попытка одного оператора.
public struct AdminExamAttempt: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let operatorID: String
    public let status: String
    public let score: Int?
    public let passed: Bool?
    public let correctAnswers: Int?
    public let totalQuestions: Int?

    public var isFinished: Bool {
        ["completed", "expired", "undeliverable"].contains(status)
    }

    public var statusLabel: String {
        switch status {
        case "pending": "Ждёт"
        case "in_progress": "Сдаёт"
        case "completed": passed == true ? "Сдал" : "Не сдал"
        case "expired": "Просрочен"
        case "undeliverable": "Не доставлен"
        default: status
        }
    }

    private enum CodingKeys: String, CodingKey {
        case id, status, score, passed
        case operatorID = "operator_id"
        case correctAnswers = "correct_answers"
        case totalQuestions = "total_questions"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        operatorID = try c.decodeIfPresent(String.self, forKey: .operatorID) ?? ""
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? "pending"
        score = try c.decodeIfPresent(Int.self, forKey: .score)
        passed = try c.decodeIfPresent(Bool.self, forKey: .passed)
        correctAnswers = try c.decodeIfPresent(Int.self, forKey: .correctAnswers)
        totalQuestions = try c.decodeIfPresent(Int.self, forKey: .totalQuestions)
    }
}

/// Один экзамен с попытками.
public struct AdminExamDetail: Decodable, Sendable {
    public let exam: AdminExam
    public let attempts: [AdminExamAttempt]

    private enum CodingKeys: String, CodingKey { case exam, attempts }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        exam = try c.decode(AdminExam.self, forKey: .exam)
        attempts = try c.decodeIfPresent([AdminExamAttempt].self, forKey: .attempts) ?? []
    }
}

/// Что нужно, чтобы назначить экзамен.
public struct ExamAssignment: Sendable {
    public var title: String
    public var companyIDs: [String]
    public var operatorIDs: [String]
    public var questionCount: Int
    public var openCount: Int
    public var passScore: Int
    /// Срок сдачи. `nil` — без срока.
    public var deadline: Date?

    public init(
        title: String = "",
        companyIDs: [String] = [],
        operatorIDs: [String] = [],
        questionCount: Int = 10,
        openCount: Int = 2,
        passScore: Int = 70,
        deadline: Date? = nil
    ) {
        self.title = title
        self.companyIDs = companyIDs
        self.operatorIDs = operatorIDs
        self.questionCount = questionCount
        self.openCount = openCount
        self.passScore = passScore
        self.deadline = deadline
    }

    /// Чего не хватает. `nil` — можно отправлять.
    public var validationIssue: String? {
        if title.trimmingCharacters(in: .whitespaces).isEmpty { return "Укажите название экзамена" }
        if companyIDs.isEmpty { return "Выберите хотя бы одну точку" }
        if operatorIDs.isEmpty { return "Выберите операторов" }
        return nil
    }

    var payload: [String: Any] {
        var body: [String: Any] = [
            "action": "create",
            "title": title.trimmingCharacters(in: .whitespaces),
            "company_ids": companyIDs,
            "operator_ids": operatorIDs,
            "question_count": questionCount,
            "open_count": openCount,
            "pass_score": passScore,
        ]
        if let deadline {
            let formatter = ISO8601DateFormatter()
            body["deadline_at"] = formatter.string(from: deadline)
        }
        return body
    }
}

public struct AdminExamService: Sendable {
    private let api: APIClient

    public init(api: APIClient) { self.api = api }

    public func overview() async throws -> AdminExamsOverview {
        let response: Envelope<AdminExamsOverview> = try await api.send(
            APIRequest(path: "/api/admin/operator-exams")
        )
        return response.data
    }

    public func detail(examID: String) async throws -> AdminExamDetail {
        let response: Envelope<AdminExamDetail> = try await api.send(
            APIRequest(path: "/api/admin/operator-exams", query: ["id": examID])
        )
        return response.data
    }

    /// Создать экзамен. Вопросы собирает сервер из базы знаний точки.
    @discardableResult
    public func create(_ assignment: ExamAssignment) async throws -> String {
        let response: CreateResult = try await api.send(
            APIRequest(
                path: "/api/admin/operator-exams",
                method: .post,
                body: try JSONSerialization.data(withJSONObject: assignment.payload)
            )
        )
        return response.data.examID
    }

    /// Разослать билеты. До этого экзамен — черновик.
    public func send(examID: String) async throws {
        try await post(["action": "send", "exam_id": examID])
    }

    /// Напомнить тем, кто ещё не сдал.
    public func remind(examID: String) async throws {
        try await post(["action": "remind", "exam_id": examID])
    }

    /// Пересдача: собирается новый билет, старый результат остаётся в истории.
    public func retake(attemptID: String) async throws {
        try await post(["action": "retake", "attempt_id": attemptID])
    }

    public func delete(examID: String) async throws {
        try await post(["action": "delete", "exam_id": examID])
    }

    private func post(_ body: [String: Any]) async throws {
        _ = try await api.send(
            APIRequest(
                path: "/api/admin/operator-exams",
                method: .post,
                body: try JSONSerialization.data(withJSONObject: body)
            )
        )
    }

    private struct Envelope<Value: Decodable & Sendable>: Decodable, Sendable {
        let data: Value
    }

    private struct CreateResult: Decodable, Sendable {
        let data: Inner

        struct Inner: Decodable, Sendable {
            let examID: String

            private enum CodingKeys: String, CodingKey { case examID = "exam_id" }
        }
    }
}
