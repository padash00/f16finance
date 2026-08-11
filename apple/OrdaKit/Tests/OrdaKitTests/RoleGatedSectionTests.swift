import Testing

@testable import OrdaKit

/// Разделы, закрытые ролью, а не правом.
///
/// Так было почти везде: маршрут проверял `role === 'owner' || role ===
/// 'manager'` и отвергал остальных, даже если право из каталога им выдано.
/// Пункт меню, ведущий в такой отказ, выглядит поломкой приложения — человек
/// нажимает и видит «forbidden» на пустом экране, при том что владелец право
/// ему выдал.
///
/// Роуты переведены на права. Осталась одна осознанная запись — оценка
/// стоимости бизнеса. Тесты держат границу с двух сторон: закрытое остаётся
/// закрытым, открытое по праву открывается любой роли.
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

    @Test("Производство открывается по праву, а не по должности")
    func productionFollowsCapability() {
        let capabilities: Set<String> = ["production.view", "salary.view"]

        #expect(pages(resolver(role: "owner", capabilities: capabilities)).contains("production"))
        #expect(pages(resolver(role: "manager", capabilities: capabilities)).contains("production"))
        // Своя роль в организации — хоть «маркетолог», хоть «технолог». Раньше
        // такой человек видел пункт и упирался в отказ.
        #expect(pages(resolver(role: "marketer", capabilities: capabilities)).contains("production"))

        // Без права раздела нет ни у кого.
        #expect(!pages(resolver(role: "owner", capabilities: ["salary.view"])).contains("production"))
    }

    @Test("Модерация и Telegram — тоже по праву")
    func moderationFollowsCapability() {
        #expect(pages(resolver(role: "manager", capabilities: ["moderation.view"])).contains("moderation"))
        #expect(pages(resolver(role: "marketer", capabilities: ["telegram.view"])).contains("telegram"))
    }

    @Test("Оценка бизнеса — только владельцу")
    func valuationStaysOwnerOnly() {
        let capabilities: Set<String> = ["valuation.view"]

        #expect(pages(resolver(role: "owner", capabilities: capabilities)).contains("valuation"))
        // Сервер называет раздел «крайне чувствительным» и отвергает всех
        // остальных — показывать пункт значит вести в отказ.
        #expect(!pages(resolver(role: "manager", capabilities: capabilities)).contains("valuation"))
        // Пустая роль — не «любая роль»: сервер в такой ситуации отвергает.
        #expect(!pages(resolver(role: nil, capabilities: capabilities)).contains("valuation"))
    }

    @Test("Суперадмин проходит везде — как и на сервере")
    func superAdminPassesEverything() {
        let admin = resolver(role: nil, superAdmin: true, capabilities: [])
        let visible = pages(admin)

        #expect(visible.contains("production"))
        #expect(visible.contains("moderation"))
        #expect(visible.contains("store-advertising"))
        #expect(visible.contains("store-settings"))
        #expect(visible.contains("valuation"))
    }

    @Test("Ограничение по роли осталось ровно одно")
    func onlyValuationIsGated() {
        let gated = Set(NativeSection.allCases.filter { $0.allowedStaffRoles != nil })

        // Реклама и настройки магазина сюда не входят намеренно: их GET
        // открыт любому сотруднику, роль там решает только правки. Спрятать
        // их значило бы отобрать чтение у того, кому оно разрешено.
        #expect(gated == [.valuation])
    }

    @Test("План закупа и настройки магазина открываются своим правом")
    func ownCapabilityIsEnough() {
        // Раньше `/api/admin/store/purchase-plan/suggest` спрашивал право
        // соседней страницы — «Заказы поставщикам», — и владелец, которому
        // выдали только план закупа, упирался в «Нет доступа: Просмотр» при
        // том, что просмотр плана у него был.
        #expect(pages(resolver(role: "owner", capabilities: ["store-purchase-plan.view"])).contains("store-purchase-plan"))
        #expect(pages(resolver(role: "manager", capabilities: ["store-settings.view"])).contains("store-settings"))
    }

    @Test("Чужих прав меню больше не спрашивает")
    func noForeignCapabilities() {
        let gated = Set(NativeSection.allCases.filter { !$0.requiredCapabilities.isEmpty })
        #expect(gated.isEmpty)
    }
}
