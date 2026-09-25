import Testing
@testable import OrdaKit

@Suite("Кабинеты должностей")
struct StaffRolePlaybookTests {
    private func resolver(role: String?, capabilities: Set<String>) -> AccessResolver {
        AccessResolver(session: SessionRole(
            isSuperAdmin: false,
            isStaff: true,
            isOperator: false,
            isCustomer: false,
            persona: .staff,
            staffRole: role,
            capabilities: capabilities,
            orgFeatures: [],
            featuresAllAccess: true,
            rolePermissionOverrides: []
        ))
    }

    private static let playbooks: [StaffRolePlaybook] = [
        .owner, .manager, .accountant, .marketer, .seniorOperator, .seniorCashier,
        .employee(title: "Сотрудник"),
    ]

    @Test("Каждый раздел в наборах есть в приложении — опечатка молча спрятала бы кнопку")
    func everyPageIsNative() {
        for playbook in Self.playbooks {
            var ids = playbook.tabPageIDs + playbook.favoritePageIDs
            for case let .page(id) in playbook.actions { ids.append(id) }
            for id in ids {
                #expect(NativeSection.forPage(id: id) != nil, "\(playbook.title): \(id)")
            }
        }
    }

    @Test("Должность выбирает свой набор, незнакомая — общий с её названием")
    func roleMapping() {
        #expect(StaffRolePlaybook.forRole("accountant") == .accountant)
        #expect(StaffRolePlaybook.forRole("marketer") == .marketer)
        #expect(StaffRolePlaybook.forRole(nil).title == "Сотрудник")
        #expect(StaffRolePlaybook.forRole("Бариста").title == "Бариста")
    }

    @Test("Набор не открывает невыданное")
    func filtersByAccess() {
        let access = resolver(role: "accountant", capabilities: ["income.view", "tasks.view"])
        let pages = access.playbookPages(access.playbook.favoritePageIDs)
        #expect(pages.contains("income"))
        #expect(!pages.contains("salary"))
        #expect(!pages.contains("expenses"))
    }
}

@Suite("Имя для приветствия")
struct PersonNameTests {
    @Test("Фамилия первой — берём имя")
    func surnameFirst() {
        #expect(PersonName.firstName("Магомедов Салим") == "Салим")
        #expect(PersonName.firstName("Сарсенгазинова Алима Асланқызы") == "Алима")
        #expect(PersonName.firstName("Салим Магомедов") == "Салим")
        #expect(PersonName.firstName("Асан") == "Асан")
        #expect(PersonName.firstName("owner@mail.kz") == nil)
    }
}
