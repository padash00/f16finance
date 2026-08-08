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
        }

        public let id = UUID()
        public let kind: Kind
        public let text: String

        public init(kind: Kind, text: String) {
            self.kind = kind
            self.text = text
        }
    }

    /// Разобрать HTML в блоки. Если разметки нет — вернётся один абзац.
    public static func blocks(from html: String?) -> [Block] {
        guard let html, !html.isEmpty else { return [] }

        // Переносы строк из блочных тегов ставим до вырезания разметки,
        // иначе абзацы склеятся в одну простыню.
        var working = html
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
