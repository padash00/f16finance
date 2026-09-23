import Foundation
import Testing
@testable import OrdaKit

@Suite("Выгрузка в Excel")
struct SpreadsheetExportTests {
    @Test("BOM, точка с запятой и экранирование — чтобы Excel открыл с первого раза")
    func format() throws {
        var sheet = SpreadsheetExport(header: ["Дата", "Комментарий", "Сумма"])
        sheet.append(["2026-09-20", "аренда; свет", SpreadsheetExport.number(1500)])
        sheet.append(["2026-09-21", "сказал \"потом\"", SpreadsheetExport.number(10.5)])
        let data = sheet.data
        #expect(Array(data.prefix(3)) == [0xEF, 0xBB, 0xBF])
        let text = try #require(String(data: data.dropFirst(3), encoding: .utf8))
        let lines = text.components(separatedBy: "\r\n")
        #expect(lines[0] == "Дата;Комментарий;Сумма")
        #expect(lines[1] == "2026-09-20;\"аренда; свет\";1500")
        #expect(lines[2] == "2026-09-21;\"сказал \"\"потом\"\"\";10,50")
    }

    @Test("Имя файла без запрещённых символов")
    func fileName() {
        #expect(SpreadsheetExport.fileName("Доходы 01/09—30/09") == "Доходы 01-09—30-09.csv")
    }
}

@Suite("Выгрузка продавцов")
struct SalesKpiExportTests {
    @Test("Границы месяца — с учётом февраля и високосного года")
    func bounds() {
        #expect(SalesKpiService.monthBounds("2026-09") == ("2026-09-01", "2026-09-30"))
        #expect(SalesKpiService.monthBounds("2028-02") == ("2028-02-01", "2028-02-29"))
    }
}
