import Testing
@testable import OrdaKit

@Suite("Таблицы в статьях")
struct RichTextTableTests {
    /// Регламенты пишут таблицами «ситуация — правило». Без разбора ячейки
    /// склеивались в «СитуацияПравилоПриходПрийти к началу смены».
    @Test("Ячейки таблицы не склеиваются")
    func tableCellsStaySeparate() {
        let html = """
        <table><thead><tr><th>Ситуация</th><th>Правило</th></tr></thead>\
        <tbody><tr><td>Приход</td><td>Прийти к началу смены.</td></tr>\
        <tr><td>Пересменка</td><td>Сдающий показывает состояние точки.</td></tr></tbody></table>
        """

        let blocks = RichText.blocks(from: html)
        let rows = blocks.filter { $0.kind == .tableRow }

        #expect(rows.count == 2)
        #expect(rows.first?.cells == ["Приход", "Прийти к началу смены."])
        #expect(rows.last?.cells == ["Пересменка", "Сдающий показывает состояние точки."])

        let header = blocks.first { $0.kind == .tableHeader }
        #expect(header?.cells == ["Ситуация", "Правило"])

        // Ни один блок не должен содержать склейки соседних ячеек.
        #expect(!blocks.contains { $0.text.contains("СитуацияПравило") })
        #expect(!blocks.contains { $0.text.contains("ПриходПрийти") })
    }

    @Test("Обычный текст разбирается как прежде")
    func plainMarkupUnchanged() {
        let blocks = RichText.blocks(from: "<p>Первый абзац.</p><p>Второй абзац.</p><ul><li>Пункт</li></ul>")
        #expect(blocks.map(\.kind) == [.paragraph, .paragraph, .listItem])
        #expect(blocks.first?.text == "Первый абзац.")
    }
}
