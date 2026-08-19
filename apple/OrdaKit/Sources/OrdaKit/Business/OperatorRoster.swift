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
    /// Деньги по операторам за период. Пусто — период не запрашивали.
    ///
    /// Раньше этих цифр в приложении не было вовсе: сайт считал их в браузере,
    /// ходя в базу напрямую. Теперь считает сервер, и телефон видит то же
    /// самое — оборот, среднюю смену, удержания.
    public let money: [String: Money]
    public let moneyTotals: MoneyTotals?

    public struct Money: Decodable, Sendable, Hashable {
        public let turnover: Double
        public let shifts: Int
        public let days: Int
        /// Средняя смена — то, о чём спрашивают об операторе, а не общий оборот:
        /// оборот зависит от того, сколько смен человек отработал.
        public let averagePerShift: Double
        /// Доля в обороте всех операторов за период.
        public let share: Double
        public let autoDebts: Double
        public let manualMinus: Double
        public let manualPlus: Double
        public let advances: Double
        /// Что премии и удержания сделали с расчётом.
        public let netEffect: Double

        public var hasDeductions: Bool { autoDebts > 0.01 || manualMinus > 0.01 }

        public init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            turnover = try c.decodeFlexibleDouble(forKey: .turnover) ?? 0
            shifts = Int(try c.decodeFlexibleDouble(forKey: .shifts) ?? 0)
            days = Int(try c.decodeFlexibleDouble(forKey: .days) ?? 0)
            averagePerShift = try c.decodeFlexibleDouble(forKey: .averagePerShift) ?? 0
            share = try c.decodeFlexibleDouble(forKey: .share) ?? 0
            autoDebts = try c.decodeFlexibleDouble(forKey: .autoDebts) ?? 0
            manualMinus = try c.decodeFlexibleDouble(forKey: .manualMinus) ?? 0
            manualPlus = try c.decodeFlexibleDouble(forKey: .manualPlus) ?? 0
            advances = try c.decodeFlexibleDouble(forKey: .advances) ?? 0
            netEffect = try c.decodeFlexibleDouble(forKey: .netEffect) ?? 0
        }

        private enum CodingKeys: String, CodingKey {
            case turnover, shifts, days, share, advances
            case averagePerShift = "avg_per_shift"
            case autoDebts = "auto_debts"
            case manualMinus = "manual_minus"
            case manualPlus = "manual_plus"
            case netEffect = "net_effect"
        }
    }

    public struct MoneyTotals: Decodable, Sendable, Hashable {
        public let turnover: Double
        /// Выручка смен, у которых не указан оператор. Её нельзя приписать
        /// никому, но и прятать нельзя: иначе доли не сходятся.
        public let unattributed: Double

        public init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            turnover = try c.decodeFlexibleDouble(forKey: .turnover) ?? 0
            unattributed = try c.decodeFlexibleDouble(forKey: .unattributed) ?? 0
        }

        private enum CodingKeys: String, CodingKey {
            case turnover
            case unattributed = "unattributed_turnover"
        }
    }

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
        case companies, operators, profiles, documents, money
    }

    private struct RawMoney: Decodable {
        struct Row: Decodable {
            let operatorID: String
            private enum CodingKeys: String, CodingKey { case operatorID = "operator_id" }
        }
        let rows: [Money]
        let ids: [Row]
        let totals: MoneyTotals?

        private enum CodingKeys: String, CodingKey { case rows, totals }

        init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            rows = try c.decodeIfPresent([Money].self, forKey: .rows) ?? []
            ids = try c.decodeIfPresent([Row].self, forKey: .rows) ?? []
            totals = try c.decodeIfPresent(MoneyTotals.self, forKey: .totals)
        }
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

        let rawMoney = try c.decodeIfPresent(RawMoney.self, forKey: .money)
        var byOperator: [String: Money] = [:]
        for (index, row) in (rawMoney?.rows ?? []).enumerated() {
            guard index < (rawMoney?.ids.count ?? 0) else { break }
            byOperator[rawMoney!.ids[index].operatorID] = row
        }
        money = byOperator
        moneyTotals = rawMoney?.totals

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

    /// Состав и, если задан период, деньги по каждому за этот период.
    public func roster(from: String? = nil, to: String? = nil) async throws -> OperatorRoster {
        var query: [String: String] = [:]
        if let from, let to { query = ["from": from, "to": to] }
        let response: Envelope = try await api.send(
            APIRequest(path: "/api/admin/operator-analytics", query: query)
        )
        return response.data
    }

    private struct Envelope: Decodable, Sendable {
        let data: OperatorRoster
    }
}
