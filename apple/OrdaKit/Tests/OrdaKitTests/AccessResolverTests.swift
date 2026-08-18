import Testing
@testable import OrdaKit

/// Тесты расчёта доступа. Проверяют, что приложение показывает ровно то же,
/// что разрешает сервер — ни больше (403 в лицо пользователю), ни меньше
/// (спрятали то, чем человек имеет право пользоваться).
@Suite("Расчёт доступа")
struct AccessResolverTests {

    // ── Вспомогательное ──────────────────────────────────────────────────────

    private func session(
        superAdmin: Bool = false,
        staff: Bool = false,
        operatorRole: Bool = false,
        customer: Bool = false,
        staffRole: String? = nil,
        capabilities: Set<String> = [],
        orgFeatures: Set<String> = [],
        featuresAllAccess: Bool = false,
        overrides: [RolePermissionOverride] = []
    ) -> SessionRole {
        SessionRole(
            isSuperAdmin: superAdmin,
            isStaff: staff,
            isOperator: operatorRole,
            isCustomer: customer,
            persona: superAdmin ? .superAdmin : staff ? .staff : operatorRole ? .operator : customer ? .customer : .unknown,
            staffRole: staffRole,
            capabilities: capabilities,
            orgFeatures: orgFeatures,
            featuresAllAccess: featuresAllAccess,
            rolePermissionOverrides: overrides
        )
    }

    // ── Каталог ──────────────────────────────────────────────────────────────

    @Test("Каталог прав загружен и совпадает с вебом по объёму")
    func catalogIsPopulated() {
        let summary = CapabilityCatalog.summary
        #expect(summary.groups == 9)
        #expect(summary.pages == 85)
        // Было 409: из каталога убрано «Создать перемещение» — право-фантом,
        // которого не проверял ни один маршрут, а само перемещение работает
        // под правом переноса на витрину.
        #expect(summary.capabilities == 408)
    }

    @Test("Права разбираются на страницу и действие")
    func capabilityParsing() {
        let capability = try! #require(CapabilityCatalog.capability(id: "income.create"))
        #expect(capability.pageID == "income")
        #expect(capability.action == "create")
        #expect(capability.severity == .medium)
    }

    @Test("Страница находится и по основному пути, и по дополнительному")
    func pageLookupByPath() {
        #expect(CapabilityCatalog.page(path: "/income")?.id == "income")
        #expect(CapabilityCatalog.page(path: "/income/add")?.id == "income")
        // Query и fragment отбрасываются — как в вебе.
        #expect(CapabilityCatalog.page(path: "/operator-analytics?tab=achievements")?.id == "operator-analytics")
    }

    @Test("Зависимости прав раскрываются рекурсивно")
    func capabilityDeps() {
        // tasks.create зависит от operators.view — иначе некому назначать задачу.
        let expanded = CapabilityCatalog.expandingDeps("tasks.create")
        #expect(expanded.contains("tasks.create"))
        #expect(expanded.contains("operators.view"))
    }

    @Test("Опасные права опознаются как требующие подтверждения")
    func highSeverityRequiresConfirmation() {
        let resolver = AccessResolver(session: session(superAdmin: true, capabilities: ["*"]))
        #expect(resolver.requiresConfirmation("store-catalog.bulk_delete_all"))
        #expect(resolver.requiresConfirmation("operators.export_credentials"))
        #expect(!resolver.requiresConfirmation("income.view"))
    }

    // ── Роль 1: суперадминистратор ───────────────────────────────────────────

    @Test("Суперадмин видит всё и попадает в платформу")
    func superAdminSeesEverything() {
        let resolver = AccessResolver(session: session(superAdmin: true, capabilities: ["*"]))

        #expect(resolver.isAllAccess)
        #expect(resolver.workspace == .platform)
        #expect(resolver.can("store-catalog.bulk_delete_all"))
        #expect(resolver.canSeePage(id: "access"))
        #expect(resolver.visibleGroups().count == 9)
        #expect(!resolver.hasNoAccess)
    }

    @Test("Суперадмин не ограничен модулями организации")
    func superAdminIgnoresAddons() {
        let resolver = AccessResolver(session: session(superAdmin: true, capabilities: ["*"], orgFeatures: []))
        // Магазин требует shop.catalog, которого нет — суперадмина это не касается.
        #expect(resolver.canSee(path: "/store/catalog"))
    }

    // ── Роль 2: владелец ─────────────────────────────────────────────────────

    @Test("Владелец получает весь каталог прав явным списком")
    func ownerGetsFullCatalog() {
        // Сервер отдаёт владельцу все 397 прав, а не "*".
        let resolver = AccessResolver(session: session(
            staff: true,
            staffRole: "owner",
            capabilities: Set(CapabilityCatalog.allCapabilityIDs),
            featuresAllAccess: true
        ))

        #expect(!resolver.isAllAccess, "владелец не должен считаться all-access: рубильник организации режет и его")
        #expect(resolver.workspace == .owner)
        #expect(resolver.can("salary.create_payment"))
        #expect(resolver.visibleGroups().count == 9)
    }

    @Test("Рубильник организации отнимает право даже у владельца")
    func orgKillSwitchCutsOwner() {
        // Суперадмин отключил выгрузку паролей для всей организации — сервер
        // уже вычел это право из ответа session-role.
        var capabilities = Set(CapabilityCatalog.allCapabilityIDs)
        capabilities.remove("operators.export_credentials")

        let resolver = AccessResolver(session: session(
            staff: true,
            staffRole: "owner",
            capabilities: capabilities,
            featuresAllAccess: true
        ))

        #expect(!resolver.can("operators.export_credentials"))
        #expect(resolver.can("operators.view"), "остальные права страницы не задеты")
    }

    @Test("Неоплаченный модуль прячет раздел даже при наличии прав")
    func addonGateHidesSectionDespiteCapabilities() {
        // Права на склад есть, но организация не купила «Магазин».
        let resolver = AccessResolver(session: session(
            staff: true,
            staffRole: "owner",
            capabilities: Set(CapabilityCatalog.allCapabilityIDs),
            orgFeatures: ["addon.hr"],
            featuresAllAccess: false
        ))

        #expect(resolver.can("store-catalog.view"), "право осталось")
        #expect(!resolver.canSee(path: "/store/catalog"), "но страница закрыта модулем")
        #expect(resolver.canSeePage(id: "hr"), "оплаченный модуль работает")
    }

    @Test("Организация без пакета не ограничивается модулями")
    func emptyFeaturesMeansNoRestriction() {
        let resolver = AccessResolver(session: session(
            staff: true,
            staffRole: "owner",
            capabilities: Set(CapabilityCatalog.allCapabilityIDs),
            orgFeatures: []
        ))
        #expect(resolver.canSee(path: "/store/catalog"))
    }

    // ── Роль 3: сотрудник ────────────────────────────────────────────────────

    @Test("Сотрудник видит только свои разделы")
    func staffSeesOnlyGrantedSections() {
        // Роль «Бухгалтер»: только доходы, расходы и налоги.
        let resolver = AccessResolver(session: session(
            staff: true,
            staffRole: "accountant",
            capabilities: [
                "income.view", "income.create", "income.export",
                "expenses.view",
                "tax.view",
            ]
        ))

        #expect(resolver.workspace == .staff)
        #expect(resolver.canSeePage(id: "income"))
        #expect(resolver.canSeePage(id: "expenses"))
        #expect(resolver.canSeePage(id: "tax"))
        #expect(!resolver.canSeePage(id: "salary"))
        #expect(!resolver.canSeePage(id: "access"))

        let groups = resolver.visibleGroups()
        #expect(groups.count == 1, "все три страницы — в разделе «Финансы»")
        #expect(groups.first?.group.id == "finance")
        #expect(groups.first?.pages.count == 3)
    }

    @Test("Кнопки действий гейтятся отдельно от страницы")
    func actionButtonsGatedIndependently() {
        let resolver = AccessResolver(session: session(
            staff: true,
            staffRole: "accountant",
            capabilities: ["income.view", "income.create", "expenses.view"]
        ))

        let income = try! #require(CapabilityCatalog.page(id: "income"))
        let actions = resolver.availableActions(on: income).map(\.id)

        #expect(actions.contains("income.view"))
        #expect(actions.contains("income.create"))
        #expect(!actions.contains("income.delete"), "удаление не выдано — кнопки быть не должно")
        #expect(!actions.contains("income.export"))

        // Страницу расходов видит, но менять ничего не может.
        let expenses = try! #require(CapabilityCatalog.page(id: "expenses"))
        #expect(resolver.availableActions(on: expenses).map(\.id) == ["expenses.view"])
    }

    @Test("Просмотр страницы требует именно .view, а не любое её право")
    func pageRequiresViewCapability() {
        // Выдали только создание, забыв про просмотр — сервер такую страницу
        // не откроет, и приложение не должно.
        let resolver = AccessResolver(session: session(
            staff: true,
            staffRole: "custom",
            capabilities: ["income.create"]
        ))
        #expect(!resolver.canSeePage(id: "income"))
    }

    @Test("Выключенный маршрут перекрывает наличие права")
    func pathOverrideBeatsCapability() {
        let resolver = AccessResolver(session: session(
            staff: true,
            staffRole: "manager",
            capabilities: ["income.view", "salary.view"],
            overrides: [RolePermissionOverride(path: "/salary", enabled: false)]
        ))

        #expect(resolver.canSeePage(id: "income"))
        #expect(!resolver.canSeePage(id: "salary"), "владелец явно закрыл маршрут")
    }

    @Test("При нескольких правилах побеждает самое точное")
    func longestOverrideWins() {
        let resolver = AccessResolver(session: session(
            staff: true,
            staffRole: "manager",
            capabilities: ["store-catalog.view", "store-warehouse.view"],
            overrides: [
                RolePermissionOverride(path: "/store/*", enabled: false),
                RolePermissionOverride(path: "/store/catalog", enabled: true),
            ]
        ))

        #expect(resolver.canSeePage(id: "store-catalog"), "точечное разрешение важнее общего запрета")
        #expect(!resolver.canSeePage(id: "store-warehouse"))
    }

    @Test("Сотрудник без единого права получает объясняющий экран")
    func staffWithoutCapabilities() {
        let resolver = AccessResolver(session: session(staff: true, staffRole: "marketer", capabilities: []))
        #expect(resolver.visibleGroups().isEmpty)
        #expect(resolver.hasNoAccess)
    }

    // ── Роль 4: оператор ─────────────────────────────────────────────────────

    @Test("Оператор попадает в свой контур")
    func operatorWorkspace() {
        let resolver = AccessResolver(session: session(operatorRole: true, capabilities: []))
        #expect(resolver.workspace == .operator)
        #expect(!resolver.hasNoAccess, "у оператора свои экраны, каталог прав к нему не применяется")
    }

    @Test("Оператор не видит админских страниц")
    func operatorHasNoAdminPages() {
        let resolver = AccessResolver(session: session(operatorRole: true, capabilities: []))
        #expect(!resolver.canSeePage(id: "salary"))
        #expect(!resolver.canSeePage(id: "access"))
        #expect(resolver.visibleGroups().isEmpty)
    }

    @Test("Сотрудник, который ещё и оператор, работает как сотрудник")
    func staffOperatorPrefersStaff() {
        // Приоритет персон на сервере: staff выше operator.
        let resolver = AccessResolver(session: session(
            staff: true,
            operatorRole: true,
            staffRole: "manager",
            capabilities: ["income.view"]
        ))
        #expect(resolver.workspace == .staff)
    }

    // ── Модули ───────────────────────────────────────────────────────────────

    @Test("Маршруты сопоставляются с модулями")
    func addonPathMapping() {
        #expect(AddonCatalog.addonCode(forPath: "/store/catalog") == "shop.catalog")
        #expect(AddonCatalog.addonCode(forPath: "/pos") == "addon.webpos")
        #expect(AddonCatalog.addonCode(forPath: "/hr") == "addon.hr")
        #expect(AddonCatalog.addonCode(forPath: "/dashboard") == nil, "базовая страница вне модулей")
    }

    @Test("Модуль AI выдаёт легаси-код ai.cfo")
    func addonGrantsIncludeLegacyCodes() {
        let grants = AddonCatalog.grants(forCodes: ["addon.ai"])
        #expect(grants.contains("addon.ai"))
        #expect(grants.contains("ai.cfo"), "иначе страница AI-финдиректора закроется")
    }

    @Test("Неизвестный код модуля пропускается как есть")
    func unknownAddonCodePassesThrough() {
        #expect(AddonCatalog.grants(forCodes: ["addon.future"]).contains("addon.future"))
    }
}
