import Foundation
import OrdaKit
import SwiftUI

/// Состояние платформы: организации, тарифы, рубильник прав.
@MainActor
@Observable
final class PlatformStore {
    private(set) var data: PlatformData?
    private(set) var isLoading = false
    private(set) var error: APIError?

    /// Выключенные права по организациям. Заполняется по мере открытия
    /// карточек — грузить рубильник для всех организаций сразу незачем.
    private(set) var disabledCapabilities: [String: Set<String>] = [:]

    var overview: PlatformOverview { data?.overview ?? .empty }
    var organizations: [Organization] { data?.organizations ?? [] }
    var attention: [AttentionOrg] { data?.attention ?? [] }
    var packages: [PlatformPackage] { data?.packages ?? [] }

    /// Поиск по названию и поддомену.
    var search = ""

    var filteredOrganizations: [Organization] {
        let needle = search.trimmingCharacters(in: .whitespaces).lowercased()
        guard !needle.isEmpty else { return organizations }
        return organizations.filter {
            $0.name.lowercased().contains(needle) || $0.slug.lowercased().contains(needle)
        }
    }

    /// Распределение организаций по статусу подписки — для графика.
    var subscriptionBreakdown: [(label: String, count: Int)] {
        [
            ("Активные", overview.activeSubscriptions),
            ("Триал", overview.trialingSubscriptions),
            ("Просрочены", overview.pastDueSubscriptions),
        ]
    }

    private let service: PlatformService

    init(api: APIClient) {
        self.service = PlatformService(api: api)
    }

    // ── Загрузка ─────────────────────────────────────────────────────────────

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            data = try await service.load()
            error = nil
        } catch let apiError as APIError {
            error = apiError
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }

    func loadCapabilities(organizationID: String) async {
        guard disabledCapabilities[organizationID] == nil else { return }
        disabledCapabilities[organizationID] = (try? await service.disabledCapabilities(organizationID: organizationID)) ?? []
    }

    func isDisabled(_ capability: String, in organizationID: String) -> Bool {
        disabledCapabilities[organizationID]?.contains(capability) ?? false
    }

    // ── Управление ───────────────────────────────────────────────────────────

    func setCapability(_ capability: String, enabled: Bool, in organizationID: String) async -> String? {
        do {
            let updated = try await service.setCapability(
                organizationID: organizationID,
                capability: capability,
                enabled: enabled
            )
            disabledCapabilities[organizationID] = updated
            return nil
        } catch let apiError as APIError {
            return apiError.userMessage
        } catch {
            return error.localizedDescription
        }
    }

    func setSuspended(_ organization: Organization, suspended: Bool) async -> String? {
        do {
            try await service.setSuspended(id: organization.id, suspended: suspended)
            await load()
            return nil
        } catch let apiError as APIError {
            return apiError.userMessage
        } catch {
            return error.localizedDescription
        }
    }

    func setFeaturesEnforced(_ organization: Organization, enforced: Bool) async -> String? {
        do {
            try await service.updateOrganization(id: organization.id, featuresEnforced: enforced)
            await load()
            return nil
        } catch let apiError as APIError {
            return apiError.userMessage
        } catch {
            return error.localizedDescription
        }
    }

    func setBillingExempt(_ organization: Organization, exempt: Bool) async -> String? {
        do {
            try await service.updateOrganization(id: organization.id, billingExempt: exempt)
            await load()
            return nil
        } catch let apiError as APIError {
            return apiError.userMessage
        } catch {
            return error.localizedDescription
        }
    }
}
