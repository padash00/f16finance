import Foundation

/// `try?` поверх `decodeIfPresent` даёт двойной optional: «ключа не было» и
/// «разобрать не удалось» — для экрана это одно и то же.
private func flatten<T>(_ value: T??) -> T? { value ?? nil }

/// Стол старшего смены.
///
/// Заявку «не смогу выйти» подаёт оператор, а замену ищет не руководитель из
/// офиса — он не знает, кто сегодня отоспался и кто уже отработал две ночи
/// подряд. Знает старший на точке, и на сервере это его работа: он предлагает
/// решение, руководитель утверждает.
///
/// В приложении этого не было совсем, и предложение до сих пор передавалось
/// голосом, а в системе появлялось задним числом.
public struct LeadDesk: Decodable, Sendable {
    public let leadName: String
    public let companies: [LeadCompany]
    public let requests: [LeadShiftRequest]
    public let team: [LeadTeamMember]

    /// Заявки, которые ждут именно старшего: открытые и без его предложения.
    public var awaitingProposal: [LeadShiftRequest] {
        requests.filter { $0.isOpen && !$0.hasProposal }
    }

    /// Предложенные, но ещё не утверждённые руководителем.
    public var awaitingDecision: [LeadShiftRequest] {
        requests.filter { $0.isOpen && $0.hasProposal }
    }

    public var settled: [LeadShiftRequest] {
        requests.filter { !$0.isOpen }
    }

    /// Кого можно предложить на замену на этой точке, кроме самого заявителя.
    public func replacements(companyID: String, excluding operatorID: String) -> [LeadTeamMember] {
        team
            .filter { $0.companyID == companyID && $0.operatorID != operatorID }
            .reduce(into: [LeadTeamMember]()) { unique, member in
                if !unique.contains(where: { $0.operatorID == member.operatorID }) { unique.append(member) }
            }
    }

    private enum CodingKeys: String, CodingKey {
        case lead, companies, requests
        case team = "teamAssignments"
    }

    /// Сервер кладёт человека внутрь `lead.operator` — рядом с его точками.
    private struct Lead: Decodable {
        struct Person: Decodable { let name: String? }
        let `operator`: Person?
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        leadName = flatten(try? c.decodeIfPresent(Lead.self, forKey: .lead))?.operator?.name ?? "Старший"
        companies = flatten(try? c.decodeIfPresent([LeadCompany].self, forKey: .companies)) ?? []
        requests = flatten(try? c.decodeIfPresent([LeadShiftRequest].self, forKey: .requests)) ?? []
        team = flatten(try? c.decodeIfPresent([LeadTeamMember].self, forKey: .team)) ?? []
    }
}

/// Точка, за которую отвечает старший, и готовность её недели.
public struct LeadCompany: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    /// Всего людей в составе точки.
    public let total: Int
    /// Сколько подтвердило опубликованную неделю.
    public let confirmed: Int
    public let pending: Int
    /// Открытые заявки «не смогу выйти».
    public let issues: Int
    /// Из них уже с предложением старшего.
    public let proposals: Int
    /// График ещё не опубликован — подтверждать и нечего.
    public let isDraft: Bool

    public var weekStart: String?
    public var weekEnd: String?

    private enum CodingKeys: String, CodingKey {
        case id, name, weeklyStatus, publication
    }

    private struct Weekly: Decodable {
        let state: String?
        let total: Int?
        let confirmed: Int?
        let pending: Int?
        let issues: Int?
        let proposals: Int?
    }

    private struct Publication: Decodable {
        let week_start: String?
        let week_end: String?
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? ""
        name = try c.decodeFlexibleString(forKey: .name) ?? "Точка"

        let weekly = flatten(try? c.decodeIfPresent(Weekly.self, forKey: .weeklyStatus))
        total = weekly?.total ?? 0
        confirmed = weekly?.confirmed ?? 0
        pending = weekly?.pending ?? 0
        issues = weekly?.issues ?? 0
        proposals = weekly?.proposals ?? 0
        isDraft = (weekly?.state ?? "draft") == "draft"

        let publication = flatten(try? c.decodeIfPresent(Publication.self, forKey: .publication))
        weekStart = publication?.week_start
        weekEnd = publication?.week_end
    }
}

/// Заявка команды глазами старшего.
public struct LeadShiftRequest: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let companyID: String
    public let companyName: String
    public let operatorID: String
    public let operatorName: String
    /// `YYYY-MM-DD`.
    public let shiftDate: String
    public let shiftType: String
    public let status: String
    public let reason: String?
    public let createdAt: Date?

    /// Что предложил старший: `keep` / `remove` / `replace`.
    public let leadAction: String?
    public let leadStatus: String?
    public let leadNote: String?
    public let replacementName: String?
    public let resolutionNote: String?

    public var isOpen: Bool { status == "open" || status == "awaiting_reason" }
    public var hasProposal: Bool { (leadStatus ?? "") == "proposed" }
    public var isNight: Bool { shiftType == "night" }

    public var proposalLabel: String? {
        switch leadAction {
        case "keep": "Оставить смену за человеком"
        case "remove": "Снять со смены"
        case "replace": replacementName.map { "Заменить: \($0)" } ?? "Заменить"
        default: nil
        }
    }

    public var statusLabel: String {
        switch status {
        case "open", "awaiting_reason": hasProposal ? "Ждёт руководителя" : "Ждёт вашего решения"
        case "resolved", "closed": "Решено"
        case "rejected": "Отклонено"
        default: StatusText.humanize(status)
        }
    }

    private enum CodingKeys: String, CodingKey {
        case id, status, reason
        case companyID = "company_id"
        case companyName = "company_name"
        case operatorID = "operator_id"
        case operatorName = "operator_name"
        case shiftDate = "shift_date"
        case shiftType = "shift_type"
        case createdAt = "created_at"
        case leadAction = "lead_action"
        case leadStatus = "lead_status"
        case leadNote = "lead_note"
        case replacementName = "lead_replacement_operator_name"
        case resolutionNote = "resolution_note"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? ""
        companyID = try c.decodeFlexibleString(forKey: .companyID) ?? ""
        companyName = try c.decodeFlexibleString(forKey: .companyName) ?? "Точка"
        operatorID = try c.decodeFlexibleString(forKey: .operatorID) ?? ""
        operatorName = try c.decodeFlexibleString(forKey: .operatorName) ?? "Оператор"
        shiftDate = try c.decodeFlexibleString(forKey: .shiftDate) ?? ""
        shiftType = try c.decodeFlexibleString(forKey: .shiftType) ?? "day"
        status = try c.decodeFlexibleString(forKey: .status) ?? "open"
        reason = try c.decodeFlexibleString(forKey: .reason)
        createdAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .createdAt))
        leadAction = try c.decodeFlexibleString(forKey: .leadAction)
        leadStatus = try c.decodeFlexibleString(forKey: .leadStatus)
        leadNote = try c.decodeFlexibleString(forKey: .leadNote)
        replacementName = try c.decodeFlexibleString(forKey: .replacementName)
        resolutionNote = try c.decodeFlexibleString(forKey: .resolutionNote)
    }
}

/// Человек в составе точки.
public struct LeadTeamMember: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let operatorID: String
    public let operatorName: String
    public let companyID: String
    public let role: String?
    public let isPrimary: Bool

    public var roleLabel: String {
        switch role {
        case "senior_operator", "lead": "Старший"
        case "trainee": "Стажёр"
        default: "Оператор"
        }
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case operatorID = "operator_id"
        case operatorName = "operator_name"
        case companyID = "company_id"
        case role = "role_in_company"
        case isPrimary = "is_primary"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? ""
        operatorID = try c.decodeFlexibleString(forKey: .operatorID) ?? ""
        operatorName = try c.decodeFlexibleString(forKey: .operatorName) ?? "Оператор"
        companyID = try c.decodeFlexibleString(forKey: .companyID) ?? ""
        role = try c.decodeFlexibleString(forKey: .role)
        isPrimary = flatten(try? c.decodeIfPresent(Bool.self, forKey: .isPrimary)) ?? false
    }
}
