import Foundation

/// Состав команды: стаж и сроки документов.
///
/// Страница на сайте считает по этим же данным ещё десяток разрезов — они
/// нужны за столом. На телефон берём то, ради чего в раздел заглядывают между
/// делом: кто сколько работает и у кого вот-вот кончится документ. Просроченная
/// медкнижка обнаруживается в момент проверки, а не в отчёте за квартал.
public struct OperatorRoster: Decodable, Sendable {
    public let companies: [Company]
    public let people: [Person]

    /// Оператор с профилем и документами, собранный из плоских списков ответа.
    public struct Person: Sendable, Identifiable, Hashable {
        public let id: String
        public let name: String
        public let isActive: Bool
        public let position: String?
        public let phone: String?
        public let photoURL: String?
        public let hireDate: Date?
        /// Ближайший срок среди документов.
        public let nearestExpiry: Date?

        /// Сколько отработал. `nil` — дата приёма не заполнена.
        public var tenureDays: Int? {
            guard let hireDate else { return nil }
            return Calendar.current.dateComponents([.day], from: hireDate, to: Date()).day
        }

        public var tenureLabel: String? {
            guard let days = tenureDays, days >= 0 else { return nil }
            if days < 31 { return "\(days) дн." }
            let months = days / 30
            if months < 12 { return "\(months) мес." }
            let years = months / 12
            let rest = months % 12
            return rest == 0 ? "\(years) г." : "\(years) г. \(rest) мес."
        }

        /// Сколько дней до ближайшего срока. Отрицательное — уже просрочен.
        public var daysToExpiry: Int? {
            guard let nearestExpiry else { return nil }
            return Calendar.current.dateComponents([.day], from: Date(), to: nearestExpiry).day
        }

        /// Документ требует внимания: просрочен или кончается в течение месяца.
        public var documentNeedsAttention: Bool {
            guard let days = daysToExpiry else { return false }
            return days <= 30
        }
    }

    // ── Разбор ───────────────────────────────────────────────────────────────

    private enum CodingKeys: String, CodingKey {
        case companies, operators, profiles, documents
    }

    private struct RawOperator: Decodable {
        let id: String
        let name: String?
        let shortName: String?
        let isActive: Bool?

        private enum CodingKeys: String, CodingKey {
            case id, name
            case shortName = "short_name"
            case isActive = "is_active"
        }
    }

    private struct RawProfile: Decodable {
        let operatorID: String
        let photoURL: String?
        let position: String?
        let phone: String?
        let hireDate: String?

        private enum CodingKeys: String, CodingKey {
            case position, phone
            case operatorID = "operator_id"
            case photoURL = "photo_url"
            case hireDate = "hire_date"
        }
    }

    private struct RawDocument: Decodable {
        let operatorID: String
        let expiryDate: String?

        private enum CodingKeys: String, CodingKey {
            case operatorID = "operator_id"
            case expiryDate = "expiry_date"
        }
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        companies = try c.decodeIfPresent([Company].self, forKey: .companies) ?? []

        let rawOperators = try c.decodeIfPresent([RawOperator].self, forKey: .operators) ?? []
        let rawProfiles = try c.decodeIfPresent([RawProfile].self, forKey: .profiles) ?? []
        let rawDocuments = try c.decodeIfPresent([RawDocument].self, forKey: .documents) ?? []

        let profileByOperator = Dictionary(
            rawProfiles.map { ($0.operatorID, $0) },
            uniquingKeysWith: { first, _ in first }
        )

        // Ближайший срок на человека: показываем один, самый срочный. Список
        // всех документов — работа за столом, здесь нужен сигнал.
        var soonest: [String: Date] = [:]
        for document in rawDocuments {
            guard let raw = document.expiryDate, let date = DateParsing.parseDateOnly(raw) else { continue }
            if let current = soonest[document.operatorID], current <= date { continue }
            soonest[document.operatorID] = date
        }

        people = rawOperators.map { row in
            let profile = profileByOperator[row.id]
            return Person(
                id: row.id,
                name: row.name ?? row.shortName ?? "Без имени",
                isActive: row.isActive ?? true,
                position: profile?.position,
                phone: profile?.phone,
                photoURL: profile?.photoURL,
                hireDate: profile?.hireDate.flatMap(DateParsing.parseDateOnly),
                nearestExpiry: soonest[row.id]
            )
        }
    }
}

public struct OperatorRosterService: Sendable {
    private let api: APIClient

    public init(api: APIClient) { self.api = api }

    public func roster() async throws -> OperatorRoster {
        let response: Envelope = try await api.send(
            APIRequest(path: "/api/admin/operator-analytics")
        )
        return response.data
    }

    private struct Envelope: Decodable, Sendable {
        let data: OperatorRoster
    }
}
