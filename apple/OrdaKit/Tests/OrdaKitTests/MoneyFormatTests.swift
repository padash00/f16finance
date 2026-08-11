import Testing

@testable import OrdaKit

/// Как выглядят цифры.
///
/// Сокращения вроде «1,8 млн» стояли на плитках, в отчётах и в ОПиУ — то есть
/// ровно там, куда заходят смотреть выручку. За «1,8 млн» прячется и
/// 1 750 000, и 1 849 999: сто тысяч разницы, невидимые глазом. Тесты держат
/// границу: полная сумма везде, сокращение — только на делениях оси графика.
@Suite("Форматирование цифр")
struct MoneyFormatTests {
    @Test("Сумма показывается целиком")
    func fullAmount() {
        #expect(Money.format(1_849_999) == "1\u{202F}849\u{202F}999 ₸")
        #expect(Money.format(184_500) == "184\u{202F}500 ₸")
        #expect(Money.format(0) == "0 ₸")
    }

    @Test("Пусто — прочерк, а не ноль")
    func missingAmount() {
        // Ноль и «неизвестно» — разные вещи: ноль выручки значит, что смена
        // была и не продала ничего.
        #expect(Money.format(nil) == "—")
        #expect(Money.format(.infinity) == "—")
    }

    @Test("Знак у корректировок")
    func signedAmount() {
        #expect(Money.signed(2_500) == "+2\u{202F}500 ₸")
        #expect(Money.signed(-2_500) == "−2\u{202F}500 ₸")
        #expect(Money.signed(0) == "0 ₸")
    }

    @Test("Сокращение осталось только для оси графика")
    func axisTick() {
        #expect(Money.axisTick(1_800_000) == "1,8 млн ₸")
        #expect(Money.axisTick(184_500) == "185к ₸")
        #expect(Money.axisTick(750) == "750 ₸")
    }

    @Test("Процент показывает десятую, когда она есть")
    func percent() {
        #expect(Percent.format(23.4) == "23,4\u{202F}%")
        #expect(Percent.format(23) == "23\u{202F}%")
        #expect(Percent.format(23.04) == "23\u{202F}%")
        #expect(Percent.format(-4.5) == "−4,5\u{202F}%")
        #expect(Percent.format(12.3, signed: true) == "+12,3\u{202F}%")
    }

    @Test("Количество без хвоста нулей")
    func quantity() {
        #expect(Quantity.format(12) == "12")
        #expect(Quantity.format(1.5) == "1,5")
        #expect(Quantity.withUnit(1.5, unit: "кг") == "1,5 кг")
        // Единицы в каталоге бывает нет — строка не должна обрываться числом.
        #expect(Quantity.withUnit(3, unit: nil) == "3 шт")
    }
}
