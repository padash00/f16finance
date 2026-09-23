import Foundation

/// Таблица для Excel, собранная в телефоне.
///
/// CSV с разделителем «;» и BOM в начале: так файл открывается в Excel с
/// кириллицей и столбцами с первого раза — без мастера импорта. Запятая как
/// разделитель в русской локали Excel склеивает всё в одну колонку, а без BOM
/// кириллица превращается в кракозябры.
public struct SpreadsheetExport: Sendable {
    public let header: [String]
    public private(set) var rows: [[String]] = []

    public init(header: [String]) {
        self.header = header
    }

    public mutating func append(_ row: [String]) {
        rows.append(row)
    }

    /// Число в ячейку: без разрядных пробелов, с запятой — так Excel в русской
    /// локали распознаёт его как число и даёт сложить столбец.
    public static func number(_ value: Double) -> String {
        if value == value.rounded() { return String(Int(value)) }
        return String(format: "%.2f", value).replacingOccurrences(of: ".", with: ",")
    }

    public var data: Data {
        let lines = ([header] + rows).map { $0.map(Self.escape).joined(separator: ";") }
        let text = lines.joined(separator: "\r\n") + "\r\n"
        return Data([0xEF, 0xBB, 0xBF]) + Data(text.utf8)
    }

    /// Кавычки — только когда нужны: разделитель, кавычка или перенос внутри.
    static func escape(_ value: String) -> String {
        guard value.contains(where: { $0 == ";" || $0 == "\"" || $0 == "\n" || $0 == "\r" }) else {
            return value
        }
        return "\"" + value.replacingOccurrences(of: "\"", with: "\"\"") + "\""
    }

    /// Имя файла без символов, которые не любят файловые системы и почта.
    public static func fileName(_ title: String, ext: String = "csv") -> String {
        let bad = CharacterSet(charactersIn: "/\\:?%*|\"<>")
        let clean = title.components(separatedBy: bad).joined(separator: "-")
        return "\(clean).\(ext)"
    }
}
