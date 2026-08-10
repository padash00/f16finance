import Foundation

/// Форматирование денег. Валюта одна — казахстанский тенге.
///
/// Вынесено в OrdaKit, а не в дизайн-систему: правила округления влияют на то,
/// сходится ли смена, и должны быть покрыты тестами вместе с остальным доменом.
public enum Money {
    public static let currencySymbol = "₸"

    /// Полная сумма: `184 500 ₸`. Округляем до целых — тиынов в обороте нет.
    public static func format(_ value: Double?) -> String {
        guard let value, value.isFinite else { return "—" }
        return "\(groupedInteger(value.rounded())) \(currencySymbol)"
    }

    /// Компактная форма для плиток и виджетов: `1,8 млн ₸`, `184к ₸`.
    public static func compact(_ value: Double?) -> String {
        guard let value, value.isFinite else { return "—" }
        let magnitude = abs(value)

        if magnitude >= 1_000_000 {
            let millions = value / 1_000_000
            let text = String(format: "%.1f", millions).replacingOccurrences(of: ".0", with: "")
            return "\(text.replacingOccurrences(of: ".", with: ",")) млн \(currencySymbol)"
        }
        if magnitude >= 1_000 {
            return "\(groupedInteger((value / 1_000).rounded()))к \(currencySymbol)"
        }
        return "\(groupedInteger(value.rounded())) \(currencySymbol)"
    }

    /// Со знаком — для корректировок зарплаты, отклонений ревизии.
    public static func signed(_ value: Double?) -> String {
        guard let value, value.isFinite else { return "—" }
        let formatted = format(abs(value))
        if value > 0 { return "+\(formatted)" }
        if value < 0 { return "−\(formatted)" }
        return formatted
    }

    /// Разряды разделяем неразрывным узким пробелом: в вебе так же, и строка
    /// не переносится посреди суммы.
    private static func groupedInteger(_ value: Double) -> String {
        let isNegative = value < 0
        let digits = String(Int(abs(value)))
        var grouped = ""
        for (offset, character) in digits.reversed().enumerated() {
            if offset > 0, offset % 3 == 0 { grouped.append("\u{202F}") }
            grouped.append(character)
        }
        return (isNegative ? "−" : "") + String(grouped.reversed())
    }
}

/// Количество товара. Целое показываем без дробной части, иначе ревизия
/// пестрит бессмысленными `12,000`.
public enum Quantity {
    public static func format(_ value: Double?) -> String {
        guard let value, value.isFinite else { return "—" }
        if value == value.rounded() { return String(Int(value)) }
        return String(format: "%.3f", value)
            .replacingOccurrences(of: #"0+$"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: ".", with: ",")
    }

    /// Количество с единицей измерения: «12 шт», «1,5 кг».
    ///
    /// Единица приходит из каталога и бывает пустой — тогда подставляем «шт»,
    /// иначе строка обрывается числом и читается как незаконченная.
    public static func withUnit(_ value: Double?, unit: String?) -> String {
        let measure = (unit?.trimmingCharacters(in: .whitespaces)).flatMap { $0.isEmpty ? nil : $0 } ?? "шт"
        return "\(format(value)) \(measure)"
    }
}

/// Проценты: `+23 %`, `−4 %`.
public enum Percent {
    public static func format(_ value: Double?, signed: Bool = false) -> String {
        guard let value, value.isFinite else { return "—" }
        let rounded = Int(value.rounded())
        let sign = signed && rounded > 0 ? "+" : rounded < 0 ? "−" : ""
        return "\(sign)\(abs(rounded))\u{202F}%"
    }

    /// Изменение относительно прошлого периода. `nil`, если сравнивать не с чем:
    /// рост «с нуля» — не тысяча процентов, а отсутствие базы.
    public static func change(current: Double, previous: Double) -> Double? {
        guard previous != 0 else { return nil }
        return (current - previous) / abs(previous) * 100
    }
}
