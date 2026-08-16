import Foundation

/// Преобразование HTML базы знаний в читаемый текст.
///
/// Статьи в вебе хранятся размеченными (редактор TipTap), и показывать их
/// «как есть» нельзя — читатель видит `<blockquote><p>…</p></blockquote>`
/// вместо текста.
///
/// Разбираем вручную, а не через `NSAttributedString(html:)`: системный
/// парсер тянет WebKit, обязан работать на главном потоке и на длинной статье
/// заметно подвешивает интерфейс. Разметка здесь простая и предсказуемая —
/// абзацы, списки, выделение — этого достаточно.
public enum RichText {

    /// Блок статьи — чтобы отрисовать список маркерами, а цитату отступом.
    public struct Block: Identifiable, Sendable, Hashable {
        public enum Kind: Sendable, Hashable {
            case paragraph
            case heading
            case listItem
            case quote
            /// Строка таблицы. Регламенты пишут таблицами «ситуация — правило»,
            /// и без отдельного вида ячейки склеивались в одну строку:
            /// «СитуацияПравилоПриходПрийти к началу смены».
            case tableRow
            /// Шапка таблицы: те же ячейки, но подписи.
            case tableHeader
        }

        public let id = UUID()
        public let kind: Kind
        public let text: String
        /// Ячейки строки таблицы. У остальных видов пусто.
        public let cells: [String]

        public init(kind: Kind, text: String, cells: [String] = []) {
            self.kind = kind
            self.text = text
            self.cells = cells
        }
    }

    /// Разобрать HTML в блоки. Если разметки нет — вернётся один абзац.
    public static func blocks(from html: String?) -> [Block] {
        guard let html, !html.isEmpty else { return [] }

        // Таблицы разбираем первыми и целиком: у них своя разметка, и общая
        // чистка тегов превратила бы ячейки в сплошной текст.
        var working = html
        working = extractTables(working)
        for (pattern, replacement) in [
            (#"<br\s*/?>"#, "\n"),
            (#"</(p|div|h[1-6]|li|blockquote)>"#, "\n"),
            (#"<li[^>]*>"#, "\u{2022} "),
            (#"<blockquote[^>]*>"#, "\u{201C}"),
            (#"<h[1-6][^>]*>"#, "\u{0001}"), // метка заголовка
        ] {
            working = working.replacingOccurrences(
                of: pattern,
                with: replacement,
                options: [.regularExpression, .caseInsensitive]
            )
        }

        // Остальные теги убираем целиком.
        working = working.replacingOccurrences(of: #"<[^>]+>"#, with: "", options: .regularExpression)
        working = decodeEntities(working)

        return working
            .components(separatedBy: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .map { line in
                if line.hasPrefix("\u{0002}") {
                    let cells = tableCells(line)
                    // Строка с ячейками `th` — это шапка, где бы она ни лежала.
                    let isHeader = line.contains("\u{0005}")
                    return Block(
                        kind: isHeader ? .tableHeader : .tableRow,
                        text: cells.joined(separator: isHeader ? " · " : " — "),
                        cells: cells
                    )
                }
                if line.hasPrefix("\u{0001}") {
                    return Block(kind: .heading, text: String(line.dropFirst()).trimmingCharacters(in: .whitespaces))
                }
                if line.hasPrefix("\u{2022}") {
                    return Block(kind: .listItem, text: String(line.dropFirst()).trimmingCharacters(in: .whitespaces))
                }
                if line.hasPrefix("\u{201C}") {
                    return Block(kind: .quote, text: String(line.dropFirst()).trimmingCharacters(in: .whitespaces))
                }
                return Block(kind: .paragraph, text: line)
            }
            .filter { !$0.text.isEmpty }
    }

    /// Пометить строки таблицы служебными знаками.
    ///
    /// Строка помечается в начале, ячейки разделяются внутри. Дальше общий
    /// разбор относится к ним как к обычным строкам, а сборка блоков узнаёт
    /// пометку и достаёт ячейки обратно.
    ///
    /// Шапку узнаём по самим ячейкам, а не по обёртке `<thead>`: редакторы
    /// сплошь и рядом кладут строку с `th` прямо в `tbody`, и пометка по
    /// обёртке такую шапку теряла — подписи колонок вставали в текст как
    /// обычные данные.
    private static func extractTables(_ html: String) -> String {
        var working = html

        // Ячейка шапки и ячейка данных получают разные знаки. Выражение для
        // `th` обязано требовать конец имени тега: иначе `<th[^>]*>` съедало и
        // `<thead>`.
        working = working.replacingOccurrences(
            of: #"<th(\s[^>]*)?>"#, with: "\u{0005}", options: [.regularExpression, .caseInsensitive]
        )
        working = working.replacingOccurrences(
            of: #"<td[^>]*>"#, with: "\u{0003}", options: [.regularExpression, .caseInsensitive]
        )
        working = working.replacingOccurrences(
            of: #"</t[dh]>"#, with: "", options: [.regularExpression, .caseInsensitive]
        )

        working = working.replacingOccurrences(
            of: #"<tr[^>]*>"#, with: "\n\u{0002}", options: [.regularExpression, .caseInsensitive]
        )
        working = working.replacingOccurrences(
            of: #"</tr>"#, with: "\n", options: [.regularExpression, .caseInsensitive]
        )
        working = working.replacingOccurrences(
            of: #"</?(table|thead|tbody)[^>]*>"#, with: "\n", options: [.regularExpression, .caseInsensitive]
        )
        return working
    }

    /// Разобрать помеченную строку таблицы на ячейки.
    private static func tableCells(_ line: String) -> [String] {
        line.dropFirst()
            .components(separatedBy: CharacterSet(charactersIn: "\u{0003}\u{0005}"))
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    /// Плоский текст без разметки — для превью и поиска.
    public static func plain(from html: String?) -> String {
        blocks(from: html).map(\.text).joined(separator: " ")
    }

    /// HTML-сущности. Список короткий намеренно: редактор выдаёт ограниченный
    /// набор, а полная таблица здесь только замедлила бы разбор.
    private static func decodeEntities(_ text: String) -> String {
        var result = text
        for (entity, character) in [
            ("&nbsp;", "\u{00A0}"),
            ("&amp;", "&"),
            ("&lt;", "<"),
            ("&gt;", ">"),
            ("&quot;", "\""),
            ("&#39;", "'"),
            ("&apos;", "'"),
            ("&mdash;", "—"),
            ("&ndash;", "–"),
            ("&laquo;", "«"),
            ("&raquo;", "»"),
            ("&hellip;", "…"),
        ] {
            result = result.replacingOccurrences(of: entity, with: character)
        }
        return result
    }
}
