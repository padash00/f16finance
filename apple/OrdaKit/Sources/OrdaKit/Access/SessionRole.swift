import Foundation

/// Кто вошёл. Приоритет ровно как в `lib/server/auth-persona.ts`:
/// super_admin → staff → operator → customer.
public enum Persona: String, Codable, Sendable {
    case superAdmin = "super_admin"
    case staff
    case `operator`
    case customer
    case unknown

    public init(rawServerValue: String?) {
        switch rawServerValue {
        case "super_admin": self = .superAdmin
        case "staff": self = .staff
        case "operator": self = .operator
        case "customer": self = .customer
        default: self = .unknown
        }
    }
}

/// Точечное включение/выключение маршрута для роли (таблица `role_permissions`).
public struct RolePermissionOverride: Codable, Sendable, Hashable {
    public let path: String
    public let enabled: Bool

    public init(path: String, enabled: Bool) {
        self.path = path
        self.enabled = enabled
    }
}

/// Ответ `GET /api/auth/session-role` — единственный источник правды о доступе.
///
/// Важно: сервер отдаёт `capabilities` уже **полностью разрешёнными**. В
/// `getEffectiveCapabilities()` он успел применить:
///   • базовый набор роли (staff-роли получают весь каталог, fail-open),
///   • снятия в `role_capabilities` и `org_role_capabilities`,
///   • персональные оверрайды `user_capability_overrides`,
///   • рубильник организации `organization_capability_overrides`.
///
/// Поэтому клиент **не пересчитывает** эти слои — он им доверяет. Отдельно
/// остаются только два клиентских гейта: модули организации (`orgFeatures`)
/// и выключенные маршруты (`rolePermissionOverrides`).
public struct SessionRole: Codable, Sendable, Hashable {
    public let isSuperAdmin: Bool
    public let isStaff: Bool
    public let isOperator: Bool
    public let isCustomer: Bool
    public let persona: Persona
    public let displayName: String?
    public let roleLabel: String?
    public let staffRole: String?
    public let operatorID: String?
    public let defaultPath: String?

    /// Разрешённые права. `["*"]` — суперадмин, ему можно всё.
    public let capabilities: Set<String>
    /// Модули, оплаченные организацией.
    public let orgFeatures: Set<String>
    /// Организация без ограничений по модулям (легаси-клиент или без пакета).
    public let featuresAllAccess: Bool
    public let rolePermissionOverrides: [RolePermissionOverride]

    public init(
        isSuperAdmin: Bool,
        isStaff: Bool,
        isOperator: Bool,
        isCustomer: Bool,
        persona: Persona,
        displayName: String? = nil,
        roleLabel: String? = nil,
        staffRole: String? = nil,
        operatorID: String? = nil,
        defaultPath: String? = nil,
        capabilities: Set<String>,
        orgFeatures: Set<String> = [],
        featuresAllAccess: Bool = false,
        rolePermissionOverrides: [RolePermissionOverride] = []
    ) {
        self.isSuperAdmin = isSuperAdmin
        self.isStaff = isStaff
        self.isOperator = isOperator
        self.isCustomer = isCustomer
        self.persona = persona
        self.displayName = displayName
        self.roleLabel = roleLabel
        self.staffRole = staffRole
        self.operatorID = operatorID
        self.defaultPath = defaultPath
        self.capabilities = capabilities
        self.orgFeatures = orgFeatures
        self.featuresAllAccess = featuresAllAccess
        self.rolePermissionOverrides = rolePermissionOverrides
    }

    // Сервер отдаёт camelCase, но часть полей может отсутствовать — декодируем
    // терпимо, чтобы новый ключ на бэке не ронял приложение.
    private enum CodingKeys: String, CodingKey {
        case isSuperAdmin, isStaff, isOperator, isCustomer, persona
        case displayName, roleLabel, staffRole, operatorId, defaultPath
        case capabilities, orgFeatures, featuresAllAccess, rolePermissionOverrides
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        isSuperAdmin = try container.decodeIfPresent(Bool.self, forKey: .isSuperAdmin) ?? false
        isStaff = try container.decodeIfPresent(Bool.self, forKey: .isStaff) ?? false
        isOperator = try container.decodeIfPresent(Bool.self, forKey: .isOperator) ?? false
        isCustomer = try container.decodeIfPresent(Bool.self, forKey: .isCustomer) ?? false
        persona = Persona(rawServerValue: try container.decodeIfPresent(String.self, forKey: .persona))
        displayName = try container.decodeIfPresent(String.self, forKey: .displayName)
        roleLabel = try container.decodeIfPresent(String.self, forKey: .roleLabel)
        staffRole = try container.decodeIfPresent(String.self, forKey: .staffRole)
        operatorID = try container.decodeIfPresent(String.self, forKey: .operatorId)
        defaultPath = try container.decodeIfPresent(String.self, forKey: .defaultPath)
        capabilities = Set(try container.decodeIfPresent([String].self, forKey: .capabilities) ?? [])
        orgFeatures = Set(try container.decodeIfPresent([String].self, forKey: .orgFeatures) ?? [])
        featuresAllAccess = try container.decodeIfPresent(Bool.self, forKey: .featuresAllAccess) ?? false
        rolePermissionOverrides = try container.decodeIfPresent(
            [RolePermissionOverride].self,
            forKey: .rolePermissionOverrides
        ) ?? []
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(isSuperAdmin, forKey: .isSuperAdmin)
        try container.encode(isStaff, forKey: .isStaff)
        try container.encode(isOperator, forKey: .isOperator)
        try container.encode(isCustomer, forKey: .isCustomer)
        try container.encode(persona.rawValue, forKey: .persona)
        try container.encodeIfPresent(displayName, forKey: .displayName)
        try container.encodeIfPresent(roleLabel, forKey: .roleLabel)
        try container.encodeIfPresent(staffRole, forKey: .staffRole)
        try container.encodeIfPresent(operatorID, forKey: .operatorId)
        try container.encodeIfPresent(defaultPath, forKey: .defaultPath)
        try container.encode(capabilities.sorted(), forKey: .capabilities)
        try container.encode(orgFeatures.sorted(), forKey: .orgFeatures)
        try container.encode(featuresAllAccess, forKey: .featuresAllAccess)
        try container.encode(rolePermissionOverrides, forKey: .rolePermissionOverrides)
    }
}
