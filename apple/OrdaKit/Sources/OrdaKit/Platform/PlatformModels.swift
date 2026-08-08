import Foundation

// ── Обзор платформы ──────────────────────────────────────────────────────────

/// Сводка по всей платформе — то, что суперадмин смотрит первым.
public struct PlatformOverview: Decodable, Sendable, Hashable {
    public let organizationCount: Int
    public let activeOrganizationCount: Int
    public let activeSubscriptions: Int
    public let trialingSubscriptions: Int
    public let pastDueSubscriptions: Int
    public let totalCompanies: Int
    public let totalMembers: Int
    /// Регулярная выручка с активных подписок.
    public let liveMrr: Double
    /// Потенциальная выручка с триалов — отдельно, это ещё не деньги.
    public let trialMrr: Double
    public let overdueInvoices: Int
    public let overdueInvoicesSum: Double
    public let paidThisMonth: Double
    public let trialsEndingSoon: Int

    public static let empty = PlatformOverview()

    private init() {
        organizationCount = 0
        activeOrganizationCount = 0
        activeSubscriptions = 0
        trialingSubscriptions = 0
        pastDueSubscriptions = 0
        totalCompanies = 0
        totalMembers = 0
        liveMrr = 0
        trialMrr = 0
        overdueInvoices = 0
        overdueInvoicesSum = 0
        paidThisMonth = 0
        trialsEndingSoon = 0
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func int(_ key: CodingKeys) throws -> Int { try c.decodeIfPresent(Int.self, forKey: key) ?? 0 }
        func money(_ key: CodingKeys) throws -> Double { try c.decodeIfPresent(Double.self, forKey: key) ?? 0 }

        organizationCount = try int(.organizationCount)
        activeOrganizationCount = try int(.activeOrganizationCount)
        activeSubscriptions = try int(.activeSubscriptions)
        trialingSubscriptions = try int(.trialingSubscriptions)
        pastDueSubscriptions = try int(.pastDueSubscriptions)
        totalCompanies = try int(.totalCompanies)
        totalMembers = try int(.totalMembers)
        liveMrr = try money(.liveMrr)
        trialMrr = try money(.trialMrr)
        overdueInvoices = try int(.overdueInvoices)
        overdueInvoicesSum = try money(.overdueInvoicesSum)
        paidThisMonth = try money(.paidThisMonth)
        trialsEndingSoon = try int(.trialsEndingSoon)
    }

    private enum CodingKeys: String, CodingKey {
        case organizationCount, activeOrganizationCount, activeSubscriptions
        case trialingSubscriptions, pastDueSubscriptions, totalCompanies, totalMembers
        case liveMrr, trialMrr, overdueInvoices, overdueInvoicesSum, paidThisMonth, trialsEndingSoon
    }
}

/// Организация, требующая внимания, и почему.
public struct AttentionOrg: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let slug: String
    public let reasons: [String]
}

// ── Организация ──────────────────────────────────────────────────────────────

/// Подписка организации.
public struct OrgSubscription: Decodable, Sendable, Hashable {
    public let status: String
    public let billingPeriod: String
    public let endsAt: String?
    public let planName: String?
    public let planCode: String?

    public var statusLabel: String {
        switch status {
        case "active": "активна"
        case "trialing": "триал"
        case "past_due": "просрочена"
        case "canceled": "отменена"
        default: status
        }
    }

    private enum CodingKeys: String, CodingKey {
        case status, billingPeriod, endsAt, plan
    }
    private struct Plan: Decodable { let name: String?; let code: String? }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? ""
        billingPeriod = try c.decodeIfPresent(String.self, forKey: .billingPeriod) ?? "monthly"
        endsAt = try c.decodeIfPresent(String.self, forKey: .endsAt)
        let plan = try c.decodeIfPresent(Plan.self, forKey: .plan)
        planName = plan?.name
        planCode = plan?.code
    }
}

/// Точка внутри организации.
public struct OrgCompany: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let code: String?
}

/// Счёт организации.
public struct OrgInvoice: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let amount: Double
    public let status: String
    public let dueDate: String?
    public let paidAt: String?

    public var isOverdue: Bool {
        guard status == "issued", let dueDate else { return false }
        return dueDate < DateParsing.dateOnlyString(from: Date())
    }

    private enum CodingKeys: String, CodingKey {
        case id, amount, status
        case dueDate = "due_date"
        case paidAt = "paid_at"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        amount = try c.decodeIfPresent(Double.self, forKey: .amount) ?? 0
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? "issued"
        dueDate = try c.decodeIfPresent(String.self, forKey: .dueDate)
        paidAt = try c.decodeIfPresent(String.self, forKey: .paidAt)
    }
}

/// Организация-клиент платформы.
public struct Organization: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let slug: String
    public let status: String
    /// Не выставляем счета (внутренний клиент).
    public let billingExempt: Bool
    /// Жёсткая блокировка страниц по пакету.
    public let featuresEnforced: Bool
    public let companyLimit: Int
    public let companyCount: Int
    public let memberCount: Int
    public let appURL: String?
    public let createdAt: String?
    public let packageCode: String?
    public let addonCodes: [String]
    public let companies: [OrgCompany]
    public let invoices: [OrgInvoice]
    public let subscription: OrgSubscription?

    public var isActive: Bool { status == "active" }
    public var isSuspended: Bool { status == "suspended" }
    public var isArchived: Bool { status == "archived" }

    public var statusLabel: String {
        switch status {
        case "active": "активна"
        case "suspended": "заморожена"
        case "archived": "в архиве"
        default: status
        }
    }

    public var overdueInvoiceCount: Int { invoices.filter(\.isOverdue).count }

    private enum CodingKeys: String, CodingKey {
        case id, name, slug, status, billingExempt, featuresEnforced
        case companyLimit, companyCount, memberCount, appUrl, createdAt
        case packageCode, addonCodes, companies, invoices, subscription
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? "Организация"
        slug = try c.decodeIfPresent(String.self, forKey: .slug) ?? ""
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? "active"
        billingExempt = try c.decodeIfPresent(Bool.self, forKey: .billingExempt) ?? false
        featuresEnforced = try c.decodeIfPresent(Bool.self, forKey: .featuresEnforced) ?? false
        companyLimit = try c.decodeIfPresent(Int.self, forKey: .companyLimit) ?? 1
        companyCount = try c.decodeIfPresent(Int.self, forKey: .companyCount) ?? 0
        memberCount = try c.decodeIfPresent(Int.self, forKey: .memberCount) ?? 0
        appURL = try c.decodeIfPresent(String.self, forKey: .appUrl)
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
        packageCode = try c.decodeIfPresent(String.self, forKey: .packageCode)
        addonCodes = try c.decodeIfPresent([String].self, forKey: .addonCodes) ?? []
        companies = try c.decodeIfPresent([OrgCompany].self, forKey: .companies) ?? []
        invoices = try c.decodeIfPresent([OrgInvoice].self, forKey: .invoices) ?? []
        subscription = try c.decodeIfPresent(OrgSubscription.self, forKey: .subscription)
    }
}

/// Тарифный план.
public struct SubscriptionPlan: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let code: String
    public let name: String
    public let priceMonthly: Double
    public let status: String
}

/// Продаваемый пакет.
public struct PlatformPackage: Decodable, Sendable, Identifiable, Hashable {
    public let code: String
    public let name: String
    public let description: String?
    public let priceKzt: Double
    public let featureCodes: [String]

    public var id: String { code }

    private enum CodingKeys: String, CodingKey {
        case code, name, description
        case priceKzt = "price_kzt"
        case featureCodes = "feature_codes"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        code = try c.decode(String.self, forKey: .code)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? code
        description = try c.decodeIfPresent(String.self, forKey: .description)
        priceKzt = try c.decodeIfPresent(Double.self, forKey: .priceKzt) ?? 0
        featureCodes = try c.decodeIfPresent([String].self, forKey: .featureCodes) ?? []
    }
}

/// Ответ `GET /api/admin/organizations` — вся картина платформы.
public struct PlatformData: Decodable, Sendable {
    public let overview: PlatformOverview
    public let organizations: [Organization]
    public let plans: [SubscriptionPlan]
    public let packages: [PlatformPackage]
    public let attention: [AttentionOrg]

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        overview = try c.decodeIfPresent(PlatformOverview.self, forKey: .overview) ?? .empty
        organizations = try c.decodeIfPresent([Organization].self, forKey: .organizations) ?? []
        plans = try c.decodeIfPresent([SubscriptionPlan].self, forKey: .plans) ?? []
        packages = try c.decodeIfPresent([PlatformPackage].self, forKey: .packages) ?? []
        attention = try c.decodeIfPresent([AttentionOrg].self, forKey: .attention) ?? []
    }

    private enum CodingKeys: String, CodingKey {
        case overview, organizations, plans, packages, attention
    }
}

/// Ответ рубильника прав организации.
public struct OrgDisabledCapabilities: Decodable, Sendable {
    /// Права, выключенные для всей организации.
    public let disabled: [String]

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        disabled = try c.decodeIfPresent([String].self, forKey: .disabled) ?? []
    }

    private enum CodingKeys: String, CodingKey { case disabled }
}
