import Testing

@testable import OrdaKit

/// Разделы, закрытые ролью, а не правом.
///
/// Часть маршрутов проверяет роль напрямую — `role === 'owner' || role ===
/// 'manager'` — и отвергает всех остальных, даже если право из каталога им
/// выдано. Пункт меню, ведущий в такой отказ, выглядит поломкой приложения:
/// человек нажимает и видит «forbidden» на пустом экране.
@Suite("Разделы, закрытые ролью")
struct RoleGatedSectionTests {
    private func resolver(
        role: String?,
        superAdmin: Bool = false,
        capabilities: Set<String>
    ) -> AccessResolver {
        AccessResolver(
            session: SessionRole(
                isSuperAdmin: superAdmin,
                isStaff: true,
                isOperator: false,
                isCustomer: false,
                persona: superAdmin ? .superAdmin : .staff,
                staffRole: role,
                capabilities: superAdmin ? ["*"] : capabilities,
                orgFeatures: [],
                featuresAllAccess: true,
                rolePermissionOverrides: []
            )
        )
    }

    private func pages(_ access: AccessResolver) -> [String] {
        access.nativeGroups().flatMap { $0.pages.map(\.id) }
    }

    @Test("Владелец и управляющий видят производство, остальные — нет")
    func productionIsOwnerAndManagerOnly() {
        let capabilities: Set<String> = ["production.view", "salary.view"]

        #expect(pages(resolver(role: "owner", capabilities: capabilities)).contains("production"))
        #expect(pages(resolver(role: "manager", capabilities: capabilities)).contains("production"))

        // Роль вне списка: право есть, но /api/admin/production/recipes
        // отвечает forbidden ещё до проверки права.
        let other = resolver(role: "marketer", capabilities: capabilities)
        #expect(!pages(other).contains("production"))
        // Соседний раздел без ограничения по роли остаётся на месте — прячем
        // адресно, а не всю группу.
        #expect(pages(other).contains("salary"))
    }

    @Test("Модерация — только владелец")
    func moderationIsOwnerOnly() {
        let capabilities: Set<String> = ["moderation.view"]

        #expect(pages(resolver(role: "owner", capabilities: capabilities)).contains("moderation"))
        #expect(!pages(resolver(role: "manager", capabilities: capabilities)).contains("moderation"))
    }

    @Test("Суперадмин проходит везде — как и на сервере")
    func superAdminPassesEverything() {
        let admin = resolver(role: nil, superAdmin: true, capabilities: [])
        let visible = pages(admin)

        #expect(visible.contains("production"))
        #expect(visible.contains("moderation"))
        #expect(visible.contains("store-advertising"))
        #expect(visible.contains("store-settings"))
    }

    /// Пустая роль — это не «любая роль»: сервер в такой ситуации отвергает.
    @Test("Без роли закрытые разделы не показываются")
    func missingRoleIsNotAPass() {
        let nobody = resolver(role: nil, capabilities: ["production.view", "moderation.view"])

        #expect(!pages(nobody).contains("production"))
        #expect(!pages(nobody).contains("moderation"))
    }

    @Test("Ограничение задано только там, где сервер правда смотрит на роль")
    func onlyKnownSectionsAreGated() {
        let gated = Set(NativeSection.allCases.filter { $0.allowedStaffRoles != nil })

        #expect(gated == [.production, .advertising, .storeSettings, .moderation])
    }
}
