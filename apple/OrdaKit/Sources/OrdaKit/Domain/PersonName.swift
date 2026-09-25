import Foundation

/// Имя для приветствия из того, что записано в карточке.
///
/// В карточках пишут по-разному: «Салим Магомедов» и «Магомедов Салим»,
/// «Сарсенгазинова Алима Асланқызы». Приветствовать по фамилии — «Добрый
/// вечер, Магомедов» — звучит как вызов к начальству. Первое слово похоже на
/// фамилию (типичные окончания) — берём второе.
public enum PersonName {
    public static func firstName(_ full: String?) -> String? {
        guard let full else { return nil }
        let words = full.split(separator: " ").map(String.init).filter { !$0.contains("@") }
        guard let first = words.first else { return nil }
        if words.count >= 2, looksLikeSurname(first) { return words[1] }
        return first
    }

    static func looksLikeSurname(_ word: String) -> Bool {
        let lower = word.lowercased()
        let endings = ["ов", "ев", "ёв", "ин", "ын", "ова", "ева", "ёва", "ина", "ына", "ский", "ская", "цкий", "цкая", "енко", "ук", "юк", "ян", "дзе", "швили", "улы", "ұлы", "кызы", "қызы", "бек", "баев", "баева"]
        return lower.count > 3 && endings.contains { lower.hasSuffix($0) }
    }
}
