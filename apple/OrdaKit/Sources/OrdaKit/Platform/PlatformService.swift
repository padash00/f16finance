import Foundation

/// Контур платформы — только для суперадмина.
///
/// Единственная роль, работающая **между** организациями. Все роуты здесь
/// проверяют `isSuperAdmin` напрямую, а не через каталог прав: платформа стоит
/// над тенантами, и capability-модель к ней неприменима.
public struct PlatformService: Sendable {
    private let api: APIClient

    public init(api: APIClient) {
        self.api = api
    }

    /// Вся картина платформы одним запросом: обзор, организации, тарифы,
    /// пакеты и список требующих внимания.
    public func load() async throws -> PlatformData {
        // Заголовок организации здесь только помешает: запрос платформенный,
        // а не тенантный.
        try await api.send(APIRequest(path: "/api/admin/organizations", skipsOrganizationHeader: true))
    }

    // ── Управление организацией ──────────────────────────────────────────────

    /// Изменить параметры организации. Передаются только заданные поля.
    public func updateOrganization(
        id: String,
        name: String? = nil,
        status: String? = nil,
        billingExempt: Bool? = nil,
        featuresEnforced: Bool? = nil,
        companyLimit: Int? = nil
    ) async throws {
        var body: [String: Any] = ["organizationId": id]
        if let name { body["name"] = name }
        if let status { body["organizationStatus"] = status }
        if let billingExempt { body["billingExempt"] = billingExempt }
        if let featuresEnforced { body["featuresEnforced"] = featuresEnforced }
        if let companyLimit { body["companyLimit"] = companyLimit }

        _ = try await api.send(
            APIRequest(
                path: "/api/admin/organizations",
                method: .patch,
                body: try JSONSerialization.data(withJSONObject: body),
                skipsOrganizationHeader: true
            )
        )
    }

    /// Заморозить или разморозить организацию.
    ///
    /// Заморозка отключает вход всем её сотрудникам — действие видимое и
    /// мгновенное, поэтому интерфейс обязан спрашивать подтверждение.
    public func setSuspended(id: String, suspended: Bool) async throws {
        try await updateOrganization(id: id, status: suspended ? "suspended" : "active")
    }

    /// Архивировать организацию.
    public func archive(id: String, archived: Bool) async throws {
        let body: [String: Any] = [
            "organizationId": id,
            "action": archived ? "archiveOrg" : "unarchiveOrg",
        ]
        _ = try await api.send(
            APIRequest(
                path: "/api/admin/organizations",
                method: .patch,
                body: try JSONSerialization.data(withJSONObject: body),
                skipsOrganizationHeader: true
            )
        )
    }

    // ── Рубильник прав организации ───────────────────────────────────────────

    /// Права, выключенные для всей организации.
    public func disabledCapabilities(organizationID: String) async throws -> Set<String> {
        let response: OrgDisabledCapabilities = try await api.send(
            APIRequest(
                path: "/api/admin/organizations/capabilities",
                query: ["organization_id": organizationID],
                skipsOrganizationHeader: true
            )
        )
        return Set(response.disabled)
    }

    /// Включить или выключить право для всей организации.
    ///
    /// Режет право у **всех** в организации, включая владельца — это верхний
    /// слой поверх ролевых прав. Возвращает обновлённый набор выключенных.
    @discardableResult
    public func setCapability(
        organizationID: String,
        capability: String,
        enabled: Bool
    ) async throws -> Set<String> {
        let body: [String: Any] = [
            "organization_id": organizationID,
            "items": [["capability": capability, "enabled": enabled]],
        ]
        let response: OrgDisabledCapabilities = try await api.send(
            APIRequest(
                path: "/api/admin/organizations/capabilities",
                method: .post,
                body: try JSONSerialization.data(withJSONObject: body),
                skipsOrganizationHeader: true
            )
        )
        return Set(response.disabled)
    }
}
