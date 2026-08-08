import Testing

@testable import OrdaKit

@Suite("Нативные разделы")
struct NativeSectionTests {
    /// Главная проверка этого файла.
    ///
    /// Опечатка в идентификаторе ничего не ломает: `forPage` вернёт `nil`, и
    /// раздел молча откроется веб-версией. Именно так и случилось с
    /// придуманными `store-stock` и `store-clients` — в каталоге их нет.
    /// Такое видно только руками на устройстве, поэтому проверяем здесь.
    @Test("Каждый нативный раздел ссылается на существующую страницу каталога")
    func everyPageIDExists() {
        for section in NativeSection.allCases {
            for id in section.pageIDs {
                #expect(
                    CapabilityCatalog.page(id: id) != nil,
                    "Страницы «\(id)» нет в каталоге прав — раздел \(section.rawValue) уйдёт в веб"
                )
            }
        }
    }

    @Test("У каждого раздела есть хотя бы одна страница")
    func everySectionHasPages() {
        for section in NativeSection.allCases {
            #expect(!section.pageIDs.isEmpty, "Раздел \(section.rawValue) недостижим")
        }
    }

    /// Один идентификатор не может вести на два разных экрана: обратный индекс
    /// молча оставил бы последний, и раздел открывался бы не тем экраном.
    @Test("Страница не закреплена за двумя разделами")
    func pageIDsAreUnique() {
        var owners: [String: NativeSection] = [:]
        for section in NativeSection.allCases {
            for id in section.pageIDs {
                #expect(
                    owners[id] == nil,
                    "«\(id)» закреплён и за \(owners[id]?.rawValue ?? "?"), и за \(section.rawValue)"
                )
                owners[id] = section
            }
        }
    }

    @Test("Разрешение страницы возвращает ожидаемый раздел")
    func lookupResolves() {
        #expect(NativeSection.forPage(id: "salary") == .salary)
        #expect(NativeSection.forPage(id: "store-warehouse") == .stock)
        #expect(NativeSection.forPage(id: "analytics") == .reports)
        // Раздел без нативного экрана в навигацию не попадает.
        #expect(NativeSection.forPage(id: "telegram") == nil)
    }
}

/// Навигация приложения строится из `nativeGroups()`. Проверяем, что фильтр
/// «только нативное» не ослабил гейт по подписке: раздел, чей модуль
/// организация не оплатила, не должен появиться, даже если экран для него
/// написан.
@Suite("Навигация только по нативным разделам")
struct NativeGroupsTests {
    private func resolver(
        capabilities: Set<String>,
        orgFeatures: Set<String> = [],
        featuresAllAccess: Bool = true
    ) -> AccessResolver {
        AccessResolver(
            session: SessionRole(
                isSuperAdmin: false,
                isStaff: true,
                isOperator: false,
                isCustomer: false,
                persona: .staff,
                staffRole: "manager",
                capabilities: capabilities,
                orgFeatures: orgFeatures,
                featuresAllAccess: featuresAllAccess,
                rolePermissionOverrides: []
            )
        )
    }

    @Test("Показываются только разделы с нативным экраном")
    func onlyNativePages() {
        // `telegram` нативного экрана не имеет — в навигацию попасть не должен,
        // хотя право на него есть.
        let access = resolver(capabilities: ["salary.view", "telegram.view"])
        let pageIDs = access.nativeGroups().flatMap { $0.pages.map(\.id) }

        #expect(pageIDs.contains("salary"))
        #expect(!pageIDs.contains("telegram"))
    }

    @Test("Неоплаченный модуль прячет раздел, даже если экран написан")
    func subscriptionStillGates() {
        // Право есть, нативный экран есть — но модуль «Магазин / Склад»
        // организации не подключён.
        //
        // Важно: пустой orgFeatures означает «организация без пакета» и
        // ничего не ограничивает — так же ведёт себя веб. Поэтому для
        // проверки запрета список должен быть непустым, но без нужного кода.
        let addon = AddonCatalog.addonCode(forPath: "/store/warehouse")
        #expect(addon == "shop.catalog")

        let denied = resolver(
            capabilities: ["store-warehouse.view"],
            orgFeatures: ["addon.arena"],
            featuresAllAccess: false
        )
        #expect(!denied.nativeGroups().flatMap { $0.pages.map(\.id) }.contains("store-warehouse"))

        let allowed = resolver(
            capabilities: ["store-warehouse.view"],
            orgFeatures: ["shop.catalog"],
            featuresAllAccess: false
        )
        #expect(allowed.nativeGroups().flatMap { $0.pages.map(\.id) }.contains("store-warehouse"))
    }

    @Test("Организация без пакета не ограничивается модулями")
    func emptyFeaturesDoNotRestrict() {
        // Зеркало веба: пустой список фич — это «пакет не назначен», а не
        // «ничего не оплачено». Иначе новый клиент не увидел бы ничего.
        let access = resolver(
            capabilities: ["store-warehouse.view"],
            orgFeatures: [],
            featuresAllAccess: false
        )
        #expect(access.nativeGroups().flatMap { $0.pages.map(\.id) }.contains("store-warehouse"))
    }

    @Test("Без прав навигация пуста, а не показывает недоступное")
    func nothingWithoutCapabilities() {
        #expect(resolver(capabilities: []).nativeGroups().isEmpty)
    }

    @Test("Пустые группы не показываются")
    func noEmptyGroups() {
        let access = resolver(capabilities: ["salary.view"])
        for (_, pages) in access.nativeGroups() {
            #expect(!pages.isEmpty)
        }
    }
}
