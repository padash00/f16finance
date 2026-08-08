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
        // Не заменённый раздел должен остаться веб-версией.
        #expect(NativeSection.forPage(id: "telegram") == nil)
    }
}
