import Foundation

// ── Правила зарплаты: /api/admin/salary-rules ────────────────────────────────

/// Правило оплаты смены для пары «компания + тип смены».
///
/// Это не расчёт зарплаты, а его условия: по какой ставке считается смена,
/// какие пороги оборота дают премию и сколько доплачивают за старшинство.
/// Сам расчёт живёт на сервере (`lib/domain/salary.ts`) — здесь только то,
/// что владелец задал руками.
public struct SalaryRule: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let companyCode: String
    public let shiftType: String
    public let basePerShift: Double
    public let seniorOperatorBonus: Double?
    public let seniorCashierBonus: Double?
    public let threshold1Turnover: Double?
    public let threshold1Bonus: Double?
    public let threshold2Turnover: Double?
    public let threshold2Bonus: Double?
    public let lowTurnoverThreshold: Double?
    public let lowTurnoverBase: Double?
    public let isActive: Bool
    public let effectiveFrom: Date?

    public var isNight: Bool { shiftType == "night" }
    public var shiftLabel: String { isNight ? "Ночь" : "День" }

    /// Сколько максимум может выйти смена по этому правилу: ставка плюс обе
    /// пороговые премии плюс самая крупная надбавка за должность. Надбавка за
    /// стаж сюда не входит — она зависит от человека, а не от правила.
    public var ceilingPerShift: Double {
        basePerShift
            + (threshold1Bonus ?? 0)
            + (threshold2Bonus ?? 0)
            + max(seniorOperatorBonus ?? 0, seniorCashierBonus ?? 0)
    }

    /// Слагаемое формулы — строка вида «условие → сколько».
    public struct Term: Sendable, Hashable, Identifiable {
        public let id: String
        public let icon: String
        public let text: String
        public let amount: String
        public let isBonus: Bool
    }

    /// Формула словами. Владелец читает не поля таблицы, а «за что платим».
    public var terms: [Term] {
        var result: [Term] = [
            Term(
                id: "base",
                icon: "banknote",
                text: "Ставка за смену",
                amount: Money.format(basePerShift),
                isBonus: false
            )
        ]

        if let threshold = lowTurnoverThreshold, let base = lowTurnoverBase {
            result.append(
                Term(
                    id: "low",
                    icon: "arrow.down.circle",
                    text: "Оборот меньше \(Money.format(threshold)) — ставка падает до",
                    amount: Money.format(base),
                    isBonus: false
                )
            )
        }

        if let turnover = threshold1Turnover, let bonus = threshold1Bonus, bonus > 0 {
            result.append(
                Term(
                    id: "t1",
                    icon: "target",
                    text: "Оборот от \(Money.format(turnover))",
                    amount: Money.signed(bonus),
                    isBonus: true
                )
            )
        }

        if let turnover = threshold2Turnover, let bonus = threshold2Bonus, bonus > 0 {
            result.append(
                Term(
                    id: "t2",
                    icon: "target",
                    text: "Оборот от \(Money.format(turnover))",
                    amount: Money.signed(bonus),
                    isBonus: true
                )
            )
        }

        if let bonus = seniorOperatorBonus, bonus > 0 {
            result.append(
                Term(
                    id: "senior-operator",
                    icon: "person.badge.shield.checkmark",
                    text: "Старший оператор на смене",
                    amount: Money.signed(bonus),
                    isBonus: true
                )
            )
        }

        if let bonus = seniorCashierBonus, bonus > 0 {
            result.append(
                Term(
                    id: "senior-cashier",
                    icon: "person.badge.shield.checkmark",
                    text: "Старший кассир на смене",
                    amount: Money.signed(bonus),
                    isBonus: true
                )
            )
        }

        return result
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        companyCode = try c.decodeFlexibleString(forKey: .companyCode) ?? ""
        shiftType = try c.decodeFlexibleString(forKey: .shiftType) ?? "day"
        basePerShift = try c.decodeFlexibleDouble(forKey: .basePerShift) ?? 0
        seniorOperatorBonus = try c.decodeFlexibleDouble(forKey: .seniorOperatorBonus)
        seniorCashierBonus = try c.decodeFlexibleDouble(forKey: .seniorCashierBonus)
        threshold1Turnover = try c.decodeFlexibleDouble(forKey: .threshold1Turnover)
        threshold1Bonus = try c.decodeFlexibleDouble(forKey: .threshold1Bonus)
        threshold2Turnover = try c.decodeFlexibleDouble(forKey: .threshold2Turnover)
        threshold2Bonus = try c.decodeFlexibleDouble(forKey: .threshold2Bonus)
        lowTurnoverThreshold = try c.decodeFlexibleDouble(forKey: .lowTurnoverThreshold)
        lowTurnoverBase = try c.decodeFlexibleDouble(forKey: .lowTurnoverBase)
        isActive = try c.decodeIfPresent(Bool.self, forKey: .isActive) ?? true
        effectiveFrom = DateParsing.date(from: try c.decodeFlexibleString(forKey: .effectiveFrom))
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case companyCode = "company_code"
        case shiftType = "shift_type"
        case basePerShift = "base_per_shift"
        case seniorOperatorBonus = "senior_operator_bonus"
        case seniorCashierBonus = "senior_cashier_bonus"
        case threshold1Turnover = "threshold1_turnover"
        case threshold1Bonus = "threshold1_bonus"
        case threshold2Turnover = "threshold2_turnover"
        case threshold2Bonus = "threshold2_bonus"
        case lowTurnoverThreshold = "low_turnover_threshold"
        case lowTurnoverBase = "low_turnover_base"
        case isActive = "is_active"
        case effectiveFrom = "effective_from"
    }
}

/// Версия ставки: с какого числа действует какая сумма.
///
/// Нужна, чтобы правка ставки не переписывала уже отработанные смены —
/// сервер выбирает версию по дате смены.
public struct SalaryRuleVersion: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let ruleID: String
    public let effectiveFrom: Date?
    public let basePerShift: Double?
    public let lowTurnoverThreshold: Double?
    public let lowTurnoverBase: Double?
    public let comment: String?

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        ruleID = try c.decodeFlexibleString(forKey: .ruleID) ?? ""
        effectiveFrom = DateParsing.date(from: try c.decodeFlexibleString(forKey: .effectiveFrom))
        basePerShift = try c.decodeFlexibleDouble(forKey: .basePerShift)
        lowTurnoverThreshold = try c.decodeFlexibleDouble(forKey: .lowTurnoverThreshold)
        lowTurnoverBase = try c.decodeFlexibleDouble(forKey: .lowTurnoverBase)
        comment = try c.decodeFlexibleString(forKey: .comment)
    }

    private enum CodingKeys: String, CodingKey {
        case id, comment
        case ruleID = "rule_id"
        case effectiveFrom = "effective_from"
        case basePerShift = "base_per_shift"
        case lowTurnoverThreshold = "low_turnover_threshold"
        case lowTurnoverBase = "low_turnover_base"
    }
}

/// Надбавка за стаж: отработал N месяцев — получаешь +X % к ставке.
///
/// Общая для всех правил, поэтому и живёт отдельно от них.
public struct SeniorityTier: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let minMonths: Int
    public let bonusPercent: Double
    public let isActive: Bool
    public let effectiveFrom: Date?

    /// «6 месяцев», «1 год 2 месяца» — в месяцах после года читать неудобно.
    public var tenureLabel: String {
        let years = minMonths / 12
        let months = minMonths % 12
        if years == 0 { return "\(months) \(pluralizeMonths(months))" }
        if months == 0 { return "\(years) \(pluralizeYears(years))" }
        return "\(years) \(pluralizeYears(years)) \(months) \(pluralizeMonths(months))"
    }

    private func pluralizeYears(_ count: Int) -> String {
        let mod100 = count % 100
        let mod10 = count % 10
        if mod100 >= 11 && mod100 <= 14 { return "лет" }
        if mod10 == 1 { return "год" }
        if mod10 >= 2 && mod10 <= 4 { return "года" }
        return "лет"
    }

    private func pluralizeMonths(_ count: Int) -> String {
        let mod100 = count % 100
        let mod10 = count % 10
        if mod100 >= 11 && mod100 <= 14 { return "месяцев" }
        if mod10 == 1 { return "месяц" }
        if mod10 >= 2 && mod10 <= 4 { return "месяца" }
        return "месяцев"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        minMonths = Int(try c.decodeFlexibleDouble(forKey: .minMonths) ?? 0)
        bonusPercent = try c.decodeFlexibleDouble(forKey: .bonusPercent) ?? 0
        isActive = try c.decodeIfPresent(Bool.self, forKey: .isActive) ?? true
        effectiveFrom = DateParsing.date(from: try c.decodeFlexibleString(forKey: .effectiveFrom))
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case minMonths = "min_months"
        case bonusPercent = "bonus_percent"
        case isActive = "is_active"
        case effectiveFrom = "effective_from"
    }
}

/// Запись журнала: кто и когда трогал правило зарплаты.
public struct SalaryRuleChange: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let action: String
    public let createdAt: Date?
    public let actorEmail: String?
    public let companyCode: String?
    public let shiftType: String?
    public let previousBase: Double?
    public let nextBase: Double?

    public var actionLabel: String {
        switch action {
        case "create": "создано"
        case "update": "изменено"
        case "delete": "удалено"
        default: action
        }
    }

    /// Ставку подняли или срезали — только когда обе величины известны.
    public var baseDelta: Double? {
        guard let previousBase, let nextBase else { return nil }
        let delta = nextBase - previousBase
        return delta == 0 ? nil : delta
    }

    private struct Payload: Decodable {
        let companyCode: String?
        let shiftType: String?
        let basePerShift: Double?
        let previous: Snapshot?
        let next: Snapshot?

        struct Snapshot: Decodable {
            let basePerShift: Double?

            init(from decoder: any Decoder) throws {
                let c = try decoder.container(keyedBy: CodingKeys.self)
                basePerShift = try c.decodeFlexibleDouble(forKey: .basePerShift)
            }

            private enum CodingKeys: String, CodingKey { case basePerShift = "base_per_shift" }
        }

        init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            companyCode = try c.decodeFlexibleString(forKey: .companyCode)
            shiftType = try c.decodeFlexibleString(forKey: .shiftType)
            basePerShift = try c.decodeFlexibleDouble(forKey: .basePerShift)
            previous = (try? c.decodeIfPresent(Snapshot.self, forKey: .previous)) ?? nil
            next = (try? c.decodeIfPresent(Snapshot.self, forKey: .next)) ?? nil
        }

        private enum CodingKeys: String, CodingKey {
            case previous, next
            case companyCode = "company_code"
            case shiftType = "shift_type"
            case basePerShift = "base_per_shift"
        }
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        action = try c.decodeFlexibleString(forKey: .action) ?? "update"
        createdAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .createdAt))
        actorEmail = try c.decodeFlexibleString(forKey: .actorEmail)

        let payload = (try? c.decodeIfPresent(Payload.self, forKey: .payload)) ?? nil
        companyCode = payload?.companyCode
        shiftType = payload?.shiftType
        previousBase = payload?.previous?.basePerShift
        nextBase = payload?.next?.basePerShift ?? payload?.basePerShift
    }

    private enum CodingKeys: String, CodingKey {
        case id, action, payload
        case createdAt = "created_at"
        case actorEmail = "actor_email"
    }
}

/// Ответ `GET /api/admin/salary-rules`.
public struct SalaryRuleBook: Decodable, Sendable {
    public let rules: [SalaryRule]
    public let companies: [Company]
    public let versions: [SalaryRuleVersion]
    public let seniorityTiers: [SeniorityTier]
    public let history: [SalaryRuleChange]

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        rules = (try? c.decodeIfPresent([SalaryRule].self, forKey: .rules)) ?? []
        companies = (try? c.decodeIfPresent([Company].self, forKey: .companies)) ?? []
        versions = (try? c.decodeIfPresent([SalaryRuleVersion].self, forKey: .versions)) ?? []
        seniorityTiers = (try? c.decodeIfPresent([SeniorityTier].self, forKey: .seniorityTiers)) ?? []
        history = (try? c.decodeIfPresent([SalaryRuleChange].self, forKey: .history)) ?? []
    }

    private enum CodingKeys: String, CodingKey {
        case rules, companies, history
        case versions = "ruleVersions"
        case seniorityTiers
    }

    /// Правила связаны с компанией кодом, а не идентификатором.
    public func companyName(forCode code: String) -> String {
        let match = companies.first { ($0.code ?? "").lowercased() == code.lowercased() }
        return match?.name ?? code.uppercased()
    }

    public var activeRules: [SalaryRule] { rules.filter(\.isActive) }

    public var activeTiers: [SeniorityTier] {
        seniorityTiers.filter(\.isActive).sorted { $0.minMonths < $1.minMonths }
    }

    /// Максимальная надбавка за стаж — потолок, на который может рассчитывать
    /// самый долгоработающий оператор.
    public var maxSeniorityPercent: Double {
        activeTiers.map(\.bonusPercent).max() ?? 0
    }

    public func versionHistory(ofRule ruleID: String) -> [SalaryRuleVersion] {
        versions
            .filter { $0.ruleID == ruleID }
            .sorted { ($0.effectiveFrom ?? .distantPast) > ($1.effectiveFrom ?? .distantPast) }
    }

}

// ── Кадры: /api/admin/hr ─────────────────────────────────────────────────────

/// Человек в кадровом списке — и штатный сотрудник, и оператор точки.
///
/// Сервер уже склеил дубли (один человек с записью и в `staff`, и в
/// `operators` приходит одной строкой с пометкой гибрида), поэтому здесь
/// дедупликации нет.
public struct HRPerson: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let kind: String
    public let fullName: String
    public let position: String?
    public let role: String?
    public let phone: String?
    public let email: String?
    public let photoURL: String?
    public let hireDate: Date?
    public let isActive: Bool
    public let isHybrid: Bool
    public let hasLogin: Bool
    public let lastLogin: Date?
    public let dismissalDate: Date?
    public let dismissedAt: Date?
    public let dismissalType: String?
    public let dismissalReason: String?
    public let dismissedByName: String?
    public let monthlySalary: Double?

    public var isOperator: Bool { kind == "operator" }
    public var isDismissed: Bool { !isActive }

    /// День увольнения: кадровая дата важнее отметки в системе, но одна из них
    /// может отсутствовать на старых записях.
    public var leftOn: Date? { dismissalDate ?? dismissedAt }

    public var roleLabel: String {
        switch role ?? "" {
        case "owner": "Владелец"
        case "manager": "Управляющий"
        case "marketer": "Маркетолог"
        case "accountant": "Бухгалтер"
        case "operator": "Оператор"
        case "senior_operator": "Старший оператор"
        case "senior_cashier": "Старший кассир"
        case "other": "Сотрудник"
        case "": isOperator ? "Оператор" : "Сотрудник"
        // Должности заводит владелец сам — незнакомое значение показываем как
        // есть, иначе кастомная роль превратится в «Сотрудник».
        case let custom: custom
        }
    }

    public var dismissalTypeLabel: String? {
        guard let dismissalType, !dismissalType.isEmpty else { return nil }
        switch dismissalType {
        case "voluntary": return "По собственному желанию"
        case "mutual_agreement": return "По соглашению сторон"
        case "cause": return "По статье"
        case "contract_end": return "Истёк срок договора"
        case "other": return "Другое"
        default: return dismissalType
        }
    }

    public var initials: String {
        let parts = fullName.split(separator: " ").prefix(2)
        return parts.compactMap(\.first).map(String.init).joined().uppercased()
    }

    /// Полных месяцев в компании: до увольнения, а у работающих — до сегодня.
    public func tenureMonths(now: Date = Date()) -> Int? {
        guard let hireDate else { return nil }
        let end = leftOn ?? now
        guard end > hireDate else { return 0 }
        let components = Calendar.current.dateComponents([.month], from: hireDate, to: end)
        return max(components.month ?? 0, 0)
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        kind = try c.decodeFlexibleString(forKey: .kind) ?? "staff"
        let full = try c.decodeFlexibleString(forKey: .fullName)
        let short = try c.decodeFlexibleString(forKey: .shortName)
        fullName = [full, short].compactMap { $0 }.first { !$0.isEmpty } ?? "Без имени"
        position = try c.decodeFlexibleString(forKey: .position)
        role = try c.decodeFlexibleString(forKey: .role)
        phone = try c.decodeFlexibleString(forKey: .phone)
        email = try c.decodeFlexibleString(forKey: .email)
        photoURL = try c.decodeFlexibleString(forKey: .photoURL)
        hireDate = DateParsing.date(from: try c.decodeFlexibleString(forKey: .hireDate))
        isActive = try c.decodeIfPresent(Bool.self, forKey: .isActive) ?? true
        isHybrid = try c.decodeIfPresent(Bool.self, forKey: .isHybrid) ?? false
        hasLogin = try c.decodeIfPresent(Bool.self, forKey: .hasLogin) ?? false
        lastLogin = DateParsing.date(from: try c.decodeFlexibleString(forKey: .lastLogin))
        dismissalDate = DateParsing.date(from: try c.decodeFlexibleString(forKey: .dismissalDate))
        dismissedAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .dismissedAt))
        dismissalType = try c.decodeFlexibleString(forKey: .dismissalType)
        dismissalReason = try c.decodeFlexibleString(forKey: .dismissalReason)
        dismissedByName = try c.decodeFlexibleString(forKey: .dismissedByName)
        monthlySalary = try c.decodeFlexibleDouble(forKey: .monthlySalary)
    }

    private enum CodingKeys: String, CodingKey {
        case id, kind, position, role, phone, email
        case fullName = "full_name"
        case shortName = "short_name"
        case photoURL = "photo_url"
        case hireDate = "hire_date"
        case isActive = "is_active"
        case isHybrid = "is_hybrid"
        case hasLogin = "has_login"
        case lastLogin = "last_login"
        case dismissalDate = "dismissal_date"
        case dismissedAt = "dismissed_at"
        case dismissalType = "dismissal_type"
        case dismissalReason = "dismissal_reason"
        case dismissedByName = "dismissed_by_name"
        case monthlySalary = "monthly_salary"
    }
}

// ── Структура команды: /api/admin/structure ──────────────────────────────────

/// Прикрепление оператора к точке.
public struct StructureAssignment: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let operatorID: String
    public let companyID: String
    public let roleInCompany: String
    public let isPrimary: Bool
    public let notes: String?

    public var roleLabel: String {
        switch roleInCompany {
        case "senior_operator": "Старший оператор"
        case "senior_cashier": "Старший кассир"
        default: "Оператор"
        }
    }

    /// Старшинство — не косметика: за него доплачивают по правилу зарплаты.
    public var isSenior: Bool { roleInCompany != "operator" }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        operatorID = try c.decodeFlexibleString(forKey: .operatorID) ?? ""
        companyID = try c.decodeFlexibleString(forKey: .companyID) ?? ""
        roleInCompany = try c.decodeFlexibleString(forKey: .roleInCompany) ?? "operator"
        isPrimary = try c.decodeIfPresent(Bool.self, forKey: .isPrimary) ?? false
        notes = try c.decodeFlexibleString(forKey: .notes)
    }

    private enum CodingKeys: String, CodingKey {
        case id, notes
        case operatorID = "operator_id"
        case companyID = "company_id"
        case roleInCompany = "role_in_company"
        case isPrimary = "is_primary"
    }
}

/// Кто у оператора руководитель. Сервер уже выбросил связи к уволенным.
public struct CareerLink: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let operatorID: String
    public let staffID: String
    public let operatorName: String?
    public let staffName: String?
    public let assignedRole: String?
    public let assignedAt: Date?

    private struct OperatorRef: Decodable {
        let name: String?
        let profileName: String?

        private struct Profile: Decodable {
            let fullName: String?
            private enum CodingKeys: String, CodingKey { case fullName = "full_name" }
        }

        init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            name = try c.decodeFlexibleString(forKey: .name)
            // Связь профиля приходит объектом или массивом — зависит от схемы,
            // а не от данных.
            // `try?` уже разворачивает двойной опционал, поэтому `single`
            // здесь обычный `Profile`, а не `Profile?`.
            if let single = try? c.decodeIfPresent(Profile.self, forKey: .profiles) {
                profileName = single.fullName
            } else {
                profileName = ((try? c.decodeIfPresent([Profile].self, forKey: .profiles)) ?? nil)?.first?.fullName
            }
        }

        private enum CodingKeys: String, CodingKey {
            case name
            case profiles = "operator_profiles"
        }
    }

    private struct StaffRef: Decodable {
        let fullName: String?
        let shortName: String?

        init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            fullName = try c.decodeFlexibleString(forKey: .fullName)
            shortName = try c.decodeFlexibleString(forKey: .shortName)
        }

        private enum CodingKeys: String, CodingKey {
            case fullName = "full_name"
            case shortName = "short_name"
        }
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        operatorID = try c.decodeFlexibleString(forKey: .operatorID) ?? ""
        staffID = try c.decodeFlexibleString(forKey: .staffID) ?? ""
        assignedRole = try c.decodeFlexibleString(forKey: .assignedRole)
        assignedAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .assignedAt))

        let op = (try? c.decodeIfPresent(OperatorRef.self, forKey: .operatorRef)) ?? nil
        operatorName = op?.profileName ?? op?.name
        let staff = (try? c.decodeIfPresent(StaffRef.self, forKey: .staffRef)) ?? nil
        staffName = staff?.fullName ?? staff?.shortName
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case operatorID = "operator_id"
        case staffID = "staff_id"
        case assignedRole = "assigned_role"
        case assignedAt = "assigned_at"
        case operatorRef = "operator"
        case staffRef = "staff"
    }
}

/// Ответ `GET /api/admin/structure` — кто где работает и кому подчиняется.
public struct TeamStructure: Decodable, Sendable {
    public let leads: [StaffMember]
    public let companies: [Company]
    public let operators: [TeamOperator]
    public let assignments: [StructureAssignment]
    public let careerLinks: [CareerLink]

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        leads = (try? c.decodeIfPresent([StaffMember].self, forKey: .leads)) ?? []
        companies = (try? c.decodeIfPresent([Company].self, forKey: .companies)) ?? []
        operators = (try? c.decodeIfPresent([TeamOperator].self, forKey: .operators)) ?? []
        assignments = (try? c.decodeIfPresent([StructureAssignment].self, forKey: .assignments)) ?? []
        careerLinks = (try? c.decodeIfPresent([CareerLink].self, forKey: .careerLinks)) ?? []
    }

    private enum CodingKeys: String, CodingKey {
        case companies, operators, assignments, careerLinks
        case leads = "staff"
    }

    public func staffedBy(companyID: String) -> [TeamOperator] {
        let ids = Set(assignments.filter { $0.companyID == companyID }.map(\.operatorID))
        return operators.filter { ids.contains($0.id) }
    }

    public func assignment(operatorID: String, companyID: String) -> StructureAssignment? {
        assignments.first { $0.operatorID == operatorID && $0.companyID == companyID }
    }

    /// Операторы без прикрепления к точке. Такой человек не попадёт ни в один
    /// график и ни в один расчёт по правилу компании — это дыра, а не деталь.
    public var unassignedOperators: [TeamOperator] {
        let assigned = Set(assignments.map(\.operatorID))
        return operators.filter { !assigned.contains($0.id) }
    }

    public func subordinates(ofLead staffID: String) -> [CareerLink] {
        careerLinks.filter { $0.staffID == staffID }
    }

    /// Операторы, за которыми не закреплён руководитель.
    public var operatorsWithoutLead: [TeamOperator] {
        let linked = Set(careerLinks.map(\.operatorID))
        return operators.filter { !linked.contains($0.id) }
    }
}

// ── Права и доступы: /api/admin/role-capabilities, /api/admin/role-permissions ─

/// Одна ячейка матрицы прав: роль × право.
public struct RoleCapability: Decodable, Sendable, Hashable, Identifiable {
    public let role: String
    public let capability: String
    public let granted: Bool

    public var id: String { "\(role):\(capability)" }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        role = try c.decodeFlexibleString(forKey: .role) ?? ""
        capability = try c.decodeFlexibleString(forKey: .capability) ?? ""
        granted = try c.decodeIfPresent(Bool.self, forKey: .granted) ?? false
    }

    private enum CodingKeys: String, CodingKey { case role, capability, granted }
}

/// Что роль может в разрезе одной страницы.
///
/// Названия страниц и действий берём из `CapabilityCatalog` — он сгенерирован
/// из того же `lib/core/capabilities.ts`, которым живёт сайт. Роут отдаёт
/// голые идентификаторы, и без каталога владелец читал бы `store-billing.
/// write_off_debt` вместо «Списать долг поставщику».
public struct PageAccess: Sendable, Hashable, Identifiable {
    public let page: String
    public let granted: [String]
    public let revoked: [String]

    public var id: String { page }

    public var label: String {
        CapabilityCatalog.page(id: page)?.label ?? page
    }

    /// Права уровня `.high` — необратимые: удаления, выгрузки логинов, списания
    /// долгов. Владельца интересуют именно они.
    public var dangerousGranted: [Capability] {
        granted.compactMap(CapabilityCatalog.capability(id:)).filter { $0.severity == .high }
    }

    public var revokedCapabilities: [Capability] {
        revoked.compactMap(CapabilityCatalog.capability(id:))
    }

    /// Страница закрыта целиком — просмотра нет, значит и раздела человек не
    /// увидит.
    public var isClosed: Bool {
        !granted.contains { $0 == "\(page).view" }
    }
}

/// Сводка по одной роли: что открыто, что закрыто, где опасное.
public struct RoleAccessSummary: Sendable, Hashable, Identifiable {
    public let role: String
    public let pages: [PageAccess]
    public let closedPaths: [String]

    public var id: String { role }

    public var grantedCount: Int { pages.reduce(0) { $0 + $1.granted.count } }
    public var revokedCount: Int { pages.reduce(0) { $0 + $1.revoked.count } }
    public var dangerousCount: Int { pages.reduce(0) { $0 + $1.dangerousGranted.count } }
    public var openPages: [PageAccess] { pages.filter { !$0.isClosed } }
    public var closedPages: [PageAccess] { pages.filter(\.isClosed) }

    /// Страницы с розданными необратимыми правами — от самых «горячих».
    public var pagesWithDanger: [PageAccess] {
        pages
            .filter { !$0.dangerousGranted.isEmpty }
            .sorted { $0.dangerousGranted.count > $1.dangerousGranted.count }
    }

    /// Закрытые рубильником страницы, названиями из каталога.
    public var closedPageLabels: [String] {
        closedPaths.map { CapabilityCatalog.page(path: $0)?.label ?? $0 }
    }

    public var roleLabel: String {
        switch role {
        case "owner": "Владелец"
        case "manager": "Управляющий"
        case "marketer": "Маркетолог"
        case "other": "Оператор / без роли"
        case "super_admin": "Супер-админ"
        default: role
        }
    }

    /// Роли, которым правка матрицы ничего не меняет: владелец всегда получает
    /// весь каталог, супер-админ обходит проверки. Молчать об этом нельзя —
    /// иначе владелец решит, что снял с себя право.
    public var ignoresMatrix: Bool { role == "owner" || role == "super_admin" }

    /// Роль операторов: доступа к админке у неё нет ни при каких настройках.
    public var grantsNothing: Bool { role == "other" }
}

/// Ответ `GET /api/admin/role-capabilities`.
public struct RoleCapabilityMatrix: Decodable, Sendable {
    public let items: [RoleCapability]
    public let roles: [String]

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        items = (try? c.decodeIfPresent([RoleCapability].self, forKey: .items)) ?? []
        roles = (try? c.decodeIfPresent([String].self, forKey: .roles)) ?? []
    }

    private enum CodingKeys: String, CodingKey { case items, roles }

    /// `store-billing.write_off_debt` → `store-billing`.
    private static func pageID(of capability: String) -> String {
        guard let dot = capability.firstIndex(of: ".") else { return capability }
        return String(capability[capability.startIndex..<dot])
    }

    /// Сводка по ролям. `closedPaths` приходят из отдельного роута, поэтому
    /// передаются снаружи.
    ///
    /// Права считаем «от обратного», как сервер в `loadUserCapabilities`:
    /// staff-роль базово получает ВЕСЬ каталог, а строки с `granted = false`
    /// его урезают; строки с `granted = true` ничего не меняют. Если читать
    /// таблицу буквально — как список галочек, — роль, которой сид не проставил
    /// строки, выглядела бы бесправной, хотя на сервере может всё.
    /// Роль `other` — операторы: прав у неё нет вовсе.
    public func summaries(closedPathsByRole: [String: [String]] = [:]) -> [RoleAccessSummary] {
        var revokedByRole: [String: Set<String>] = [:]
        for item in items where !item.role.isEmpty && !item.capability.isEmpty && !item.granted {
            revokedByRole[item.role, default: []].insert(item.capability)
        }

        let knownRoles = Set(roles)
            .union(items.map(\.role).filter { !$0.isEmpty })
            .union(closedPathsByRole.keys)

        return knownRoles.sorted().map { role in
            // Владелец и суперадмин получают каталог целиком независимо от
            // таблицы — показывать им «снято» значило бы врать.
            let ignoresMatrix = role == "owner" || role == "super_admin"
            let revokedIDs: Set<String> = ignoresMatrix ? [] : (revokedByRole[role] ?? [])

            var granted: [String: [String]] = [:]
            var revoked: [String: [String]] = [:]

            // Операторам админские права не выдаются вообще, и снятия для них
            // тоже бессмысленны — перечислять нечего.
            for capability in CapabilityCatalog.allCapabilityIDs where role != "other" {
                let page = Self.pageID(of: capability)
                if revokedIDs.contains(capability) {
                    revoked[page, default: []].append(capability)
                } else {
                    granted[page, default: []].append(capability)
                }
            }

            let pages = Set(granted.keys).union(revoked.keys).sorted().map { page in
                PageAccess(
                    page: page,
                    granted: granted[page] ?? [],
                    revoked: revoked[page] ?? []
                )
            }

            return RoleAccessSummary(
                role: role,
                pages: pages,
                closedPaths: (closedPathsByRole[role] ?? []).sorted()
            )
        }
    }
}

/// Закрытая для роли страница сайта.
public struct RolePagePermission: Decodable, Sendable, Hashable, Identifiable {
    public let role: String
    public let path: String
    public let enabled: Bool

    public var id: String { "\(role):\(path)" }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        role = try c.decodeFlexibleString(forKey: .role) ?? ""
        path = try c.decodeFlexibleString(forKey: .path) ?? ""
        enabled = try c.decodeIfPresent(Bool.self, forKey: .enabled) ?? true
    }

    private enum CodingKeys: String, CodingKey { case role, path, enabled }
}

/// Ответ `GET /api/admin/role-permissions`.
public struct RolePermissionList: Decodable, Sendable {
    public let items: [RolePagePermission]
    /// Таблица может быть не накатана — тогда рубильников страниц просто нет.
    public let tableExists: Bool

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        items = (try? c.decodeIfPresent([RolePagePermission].self, forKey: .items)) ?? []
        tableExists = try c.decodeIfPresent(Bool.self, forKey: .tableExists) ?? true
    }

    private enum CodingKeys: String, CodingKey {
        case items = "data"
        case tableExists
    }

    /// Роль → закрытые для неё страницы.
    public var closedPathsByRole: [String: [String]] {
        var result: [String: [String]] = [:]
        for item in items where !item.enabled && !item.role.isEmpty {
            result[item.role, default: []].append(item.path)
        }
        return result
    }
}

/// Права и рубильники страниц, загруженные вместе: одна без другой картину
/// не даёт.
public struct AccessOverview: Sendable {
    public let roles: [RoleAccessSummary]

    public init(matrix: RoleCapabilityMatrix, permissions: RolePermissionList) {
        roles = matrix.summaries(closedPathsByRole: permissions.closedPathsByRole)
    }

    /// Роли, которых матрица реально касается: владелец и супер-админ получают
    /// всё независимо от настроек, и считать их — вводить себя в заблуждение.
    public var editableRoles: [RoleAccessSummary] {
        roles.filter { !$0.ignoresMatrix }
    }

    public var totalDangerous: Int {
        editableRoles.reduce(0) { $0 + $1.dangerousCount }
    }

    public var totalRevoked: Int {
        roles.reduce(0) { $0 + $1.revokedCount }
    }

    /// Сколько прав в каталоге всего — точка отсчёта для «открыто N из M».
    public var catalogSize: Int { CapabilityCatalog.allCapabilityIDs.count }
}

// ── Сервис ───────────────────────────────────────────────────────────────────

/// Загрузка разделов «команда и доступ».
public struct TeamAdminService: Sendable {
    private let api: APIClient

    public init(api: APIClient) { self.api = api }

    public func loadSalaryRules() async throws -> SalaryRuleBook {
        let response: Envelope<SalaryRuleBook> = try await api.send(
            APIRequest(path: "/api/admin/salary-rules")
        )
        return response.data
    }

    public func loadHR() async throws -> [HRPerson] {
        let response: DataList<HRPerson> = try await api.send(APIRequest(path: "/api/admin/hr"))
        return response.items
    }

    public func loadStructure() async throws -> TeamStructure {
        let response: Envelope<TeamStructure> = try await api.send(
            APIRequest(path: "/api/admin/structure")
        )
        return response.data
    }

    /// Матрица прав и рубильники страниц. Роуты разные, но по отдельности
    /// каждый отвечает лишь на половину вопроса «что может роль».
    public func loadAccess() async throws -> AccessOverview {
        async let matrix: RoleCapabilityMatrix = api.send(
            APIRequest(path: "/api/admin/role-capabilities")
        )
        async let permissions: RolePermissionList = api.send(
            APIRequest(path: "/api/admin/role-permissions")
        )
        return AccessOverview(matrix: try await matrix, permissions: try await permissions)
    }

    /// Учётные записи операторов.
    ///
    /// Пароль сюда не приходит и приходить не должен: роут отдаёт только логин,
    /// время последнего входа и признак привязки Telegram. Сброс пароля —
    /// действие с сайта, где оно попадает в журнал.
    public func loadOperatorAccounts() async throws -> [TeamOperator] {
        let response: DataList<TeamOperator> = try await api.send(
            APIRequest(path: "/api/admin/operators", query: ["active_only": "true"])
        )
        return response.items
    }
}
