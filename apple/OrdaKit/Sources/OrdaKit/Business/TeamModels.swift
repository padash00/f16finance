import Foundation

// ── Команда: /api/admin/operators, /api/admin/salary ─────────────────────────

/// Оператор с профилем, учётной записью и статистикой за 30 дней.
public struct TeamOperator: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let shortName: String?
    public let isActive: Bool
    public let role: String
    public let fullName: String?
    public let phone: String?
    public let position: String?
    public let photoURL: String?
    public let hireDate: Date?
    public let username: String?
    public let lastLogin: Date?
    public let hasTelegram: Bool
    /// Учётная запись входа. Нужна, чтобы сбросить пароль: сервер работает с
    /// пользователем, а не с карточкой оператора.
    public let authUserID: String?
    /// Куда слать логин и пароль. Пусто — Telegram не привязан.
    public let telegramChatID: String?
    /// Есть ли у оператора карточка сотрудника.
    ///
    /// Без неё система теряет человека сразу в трёх местах: смена открывается
    /// без хозяина, подтверждения регламентов не пишутся (они привязаны к
    /// карточке), и в дисциплине его нет. Снаружи это выглядит как «кнопка не
    /// работает», а не как отсутствующая связка.
    public let hasStaffLink: Bool
    public let stats: Stats

    /// Показываем полное имя из профиля, если оно есть: в `name` часто
    /// служебное сокращение вроде «Алия К.».
    public var displayName: String {
        let candidate = fullName?.trimmingCharacters(in: .whitespaces)
        return (candidate?.isEmpty == false ? candidate! : name)
    }

    public var initials: String {
        let parts = displayName.split(separator: " ").prefix(2)
        return parts.compactMap(\.first).map(String.init).joined().uppercased()
    }

    public struct Stats: Decodable, Sendable, Hashable {
        public let totalShifts: Int
        public let totalTurnover: Double
        public let avgPerShift: Double
        public let totalDebts: Double
        public let totalBonuses: Double

        public static let zero = Stats(
            totalShifts: 0, totalTurnover: 0, avgPerShift: 0, totalDebts: 0, totalBonuses: 0
        )

        public init(
            totalShifts: Int, totalTurnover: Double, avgPerShift: Double,
            totalDebts: Double, totalBonuses: Double
        ) {
            self.totalShifts = totalShifts
            self.totalTurnover = totalTurnover
            self.avgPerShift = avgPerShift
            self.totalDebts = totalDebts
            self.totalBonuses = totalBonuses
        }

        public init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            totalShifts = Int(try c.decodeFlexibleDouble(forKey: .totalShifts) ?? 0)
            totalTurnover = try c.decodeFlexibleDouble(forKey: .totalTurnover) ?? 0
            avgPerShift = try c.decodeFlexibleDouble(forKey: .avgPerShift) ?? 0
            totalDebts = try c.decodeFlexibleDouble(forKey: .totalDebts) ?? 0
            totalBonuses = try c.decodeFlexibleDouble(forKey: .totalBonuses) ?? 0
        }

        private enum CodingKeys: String, CodingKey {
            case totalShifts, totalTurnover, avgPerShift, totalDebts, totalBonuses
        }
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, role
        case shortName = "short_name"
        case isActive = "is_active"
        case telegramChatID = "telegram_chat_id"
        case profiles = "operator_profiles"
        case auth, stats
        case hasStaffLink = "has_staff_link"
    }

    private struct Profile: Decodable {
        let fullName: String?
        let phone: String?
        let email: String?
        let position: String?
        let photoURL: String?
        let hireDate: String?

        private enum CodingKeys: String, CodingKey {
            case fullName = "full_name"
            case phone, email, position
            case photoURL = "photo_url"
            case hireDate = "hire_date"
        }
    }

    private struct Auth: Decodable {
        let username: String?
        let lastLogin: String?
        let userID: String?

        private enum CodingKeys: String, CodingKey {
            case username
            case lastLogin = "last_login"
            case userID = "user_id"
        }
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        name = try c.decodeFlexibleString(forKey: .name) ?? "Оператор"
        shortName = try c.decodeFlexibleString(forKey: .shortName)
        isActive = try c.decodeIfPresent(Bool.self, forKey: .isActive) ?? true
        role = try c.decodeFlexibleString(forKey: .role) ?? "operator"
        telegramChatID = try c.decodeFlexibleString(forKey: .telegramChatID)
        hasTelegram = telegramChatID?.isEmpty == false
        // Старые сборки сервера флага не присылают: считаем, что связка есть.
        // Пугать значком там, где всё в порядке, хуже, чем промолчать.
        hasStaffLink = (try? c.decodeIfPresent(Bool.self, forKey: .hasStaffLink)) as? Bool ?? true

        // `operator_profiles` приходит объектом при связи один-к-одному и
        // массивом при один-ко-многим — Supabase решает это по схеме, а не по
        // данным. Принимаем оба вида.
        let profile: Profile?
        if let single = try? c.decodeIfPresent(Profile.self, forKey: .profiles) {
            profile = single
        } else {
            profile = (try? c.decodeIfPresent([Profile].self, forKey: .profiles))??.first
        }
        fullName = profile?.fullName
        phone = profile?.phone
        position = profile?.position
        photoURL = profile?.photoURL
        hireDate = DateParsing.date(from: profile?.hireDate)

        let auth = try? c.decodeIfPresent(Auth.self, forKey: .auth)
        username = auth?.username
        lastLogin = DateParsing.date(from: auth?.lastLogin)
        authUserID = auth?.userID

        stats = (try? c.decodeIfPresent(Stats.self, forKey: .stats)) ?? .zero
    }
}

/// Недельная зарплата одного оператора.
public struct SalaryRow: Decodable, Sendable, Identifiable, Hashable {
    public let operatorID: String
    public let operatorName: String
    public let isActive: Bool
    public let week: Week
    public let hasActivity: Bool

    public var id: String { operatorID }

    public struct Week: Decodable, Sendable, Hashable {
        public let grossAmount: Double
        public let bonusAmount: Double
        public let fineAmount: Double
        public let debtAmount: Double
        public let advanceAmount: Double
        public let netAmount: Double
        public let paidAmount: Double
        public let remainingAmount: Double
        public let status: String
        public let shiftsCount: Int

        public var statusLabel: String {
            switch status {
            case "paid": "Выплачено"
            case "partial": "Частично"
            default: "Не выплачено"
            }
        }

        public init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            grossAmount = try c.decodeFlexibleDouble(forKey: .grossAmount) ?? 0
            bonusAmount = try c.decodeFlexibleDouble(forKey: .bonusAmount) ?? 0
            fineAmount = try c.decodeFlexibleDouble(forKey: .fineAmount) ?? 0
            debtAmount = try c.decodeFlexibleDouble(forKey: .debtAmount) ?? 0
            advanceAmount = try c.decodeFlexibleDouble(forKey: .advanceAmount) ?? 0
            netAmount = try c.decodeFlexibleDouble(forKey: .netAmount) ?? 0
            paidAmount = try c.decodeFlexibleDouble(forKey: .paidAmount) ?? 0
            remainingAmount = try c.decodeFlexibleDouble(forKey: .remainingAmount) ?? 0
            status = try c.decodeFlexibleString(forKey: .status) ?? "draft"
            shiftsCount = Int(try c.decodeFlexibleDouble(forKey: .shiftsCount) ?? 0)
        }

        private enum CodingKeys: String, CodingKey {
            case grossAmount, bonusAmount, fineAmount, debtAmount, advanceAmount
            case netAmount, paidAmount, remainingAmount, status, shiftsCount
        }
    }

    private enum CodingKeys: String, CodingKey {
        case `operator`, week, hasActivity
    }

    private struct OperatorRef: Decodable {
        let id: String?
        let name: String?
        let fullName: String?
        let isActive: Bool?

        private enum CodingKeys: String, CodingKey {
            case id, name
            case fullName = "full_name"
            case isActive = "is_active"
        }

        init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decodeFlexibleString(forKey: .id)
            name = try c.decodeFlexibleString(forKey: .name)
            fullName = try c.decodeFlexibleString(forKey: .fullName)
            isActive = try c.decodeIfPresent(Bool.self, forKey: .isActive)
        }
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let ref = try c.decodeIfPresent(OperatorRef.self, forKey: .operator)
        operatorID = ref?.id ?? UUID().uuidString
        let full = ref?.fullName?.trimmingCharacters(in: .whitespaces)
        operatorName = (full?.isEmpty == false ? full! : ref?.name) ?? "Оператор"
        isActive = ref?.isActive ?? true
        week = try c.decode(Week.self, forKey: .week)
        hasActivity = try c.decodeIfPresent(Bool.self, forKey: .hasActivity) ?? false
    }
}

/// Итоги недели по всей команде.
public struct SalaryTotals: Decodable, Sendable, Hashable {
    public let grossAmount: Double
    public let bonusAmount: Double
    public let fineAmount: Double
    public let debtAmount: Double
    public let netAmount: Double
    public let paidAmount: Double
    public let remainingAmount: Double
    public let paidOperators: Int
    public let activeOperators: Int

    public static let zero = SalaryTotals(
        grossAmount: 0, bonusAmount: 0, fineAmount: 0, debtAmount: 0,
        netAmount: 0, paidAmount: 0, remainingAmount: 0,
        paidOperators: 0, activeOperators: 0
    )

    public init(
        grossAmount: Double, bonusAmount: Double, fineAmount: Double, debtAmount: Double,
        netAmount: Double, paidAmount: Double, remainingAmount: Double,
        paidOperators: Int, activeOperators: Int
    ) {
        self.grossAmount = grossAmount
        self.bonusAmount = bonusAmount
        self.fineAmount = fineAmount
        self.debtAmount = debtAmount
        self.netAmount = netAmount
        self.paidAmount = paidAmount
        self.remainingAmount = remainingAmount
        self.paidOperators = paidOperators
        self.activeOperators = activeOperators
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        grossAmount = try c.decodeFlexibleDouble(forKey: .grossAmount) ?? 0
        bonusAmount = try c.decodeFlexibleDouble(forKey: .bonusAmount) ?? 0
        fineAmount = try c.decodeFlexibleDouble(forKey: .fineAmount) ?? 0
        debtAmount = try c.decodeFlexibleDouble(forKey: .debtAmount) ?? 0
        netAmount = try c.decodeFlexibleDouble(forKey: .netAmount) ?? 0
        paidAmount = try c.decodeFlexibleDouble(forKey: .paidAmount) ?? 0
        remainingAmount = try c.decodeFlexibleDouble(forKey: .remainingAmount) ?? 0
        paidOperators = Int(try c.decodeFlexibleDouble(forKey: .paidOperators) ?? 0)
        activeOperators = Int(try c.decodeFlexibleDouble(forKey: .activeOperators) ?? 0)
    }

    private enum CodingKeys: String, CodingKey {
        case grossAmount, bonusAmount, fineAmount, debtAmount
        case netAmount, paidAmount, remainingAmount, paidOperators, activeOperators
    }
}

/// Ответ `GET /api/admin/salary?weekStart=…`.
public struct SalaryWeekReport: Decodable, Sendable {
    public let weekStart: String
    public let weekEnd: String
    public let operators: [SalaryRow]
    public let totals: SalaryTotals

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        weekStart = try c.decodeFlexibleString(forKey: .weekStart) ?? ""
        weekEnd = try c.decodeFlexibleString(forKey: .weekEnd) ?? ""
        operators = try c.decodeIfPresent([SalaryRow].self, forKey: .operators) ?? []
        totals = (try? c.decodeIfPresent(SalaryTotals.self, forKey: .totals)) ?? .zero
    }

    private enum CodingKeys: String, CodingKey {
        case weekStart, weekEnd, operators, totals
    }
}
