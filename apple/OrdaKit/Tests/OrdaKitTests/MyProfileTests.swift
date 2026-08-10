import Foundation
import Testing

@testable import OrdaKit

/// Правка своих контактов.
///
/// Смысл проверок в границе: человек меняет о себе телефон, почту и Telegram —
/// и ничего больше. Имя, должность и ставка приходят на чтение, потому что на
/// них считается зарплата и строится подчинение.
@Suite("Свои контакты")
struct MyProfileTests {
    @Test("Почта проверяется до отправки")
    func emailIsValidated() {
        #expect(MyProfileChange(email: "не почта").validationMessage == "Проверьте почту")
        #expect(MyProfileChange(email: "name@").validationMessage == "Проверьте почту")
        #expect(MyProfileChange(email: "name@example.").validationMessage == "Проверьте почту")
        #expect(MyProfileChange(email: "name@example.com").validationMessage == nil)
    }

    /// Десять цифр — минимум для казахстанского номера. Считаем цифры, а не
    /// символы: «+7 (700) 000-00-00» человек набирает как угодно.
    @Test("Телефон проверяется по числу цифр, а не по виду")
    func phoneIsValidated() {
        #expect(MyProfileChange(phone: "+7 700").validationMessage == "Проверьте телефон")
        #expect(MyProfileChange(phone: "+7 (700) 000-00-00").validationMessage == nil)
        #expect(MyProfileChange(phone: "87000000000").validationMessage == nil)
    }

    /// Пустая строка — это «стереть», и она должна проходить: человек вправе
    /// убрать свой номер.
    @Test("Пустое поле не считается ошибкой")
    func emptyIsAllowed() {
        #expect(MyProfileChange(phone: "", email: "").validationMessage == nil)
    }

    /// Не переданное поле не должно уходить на сервер вовсе: там отсутствие
    /// ключа означает «не трогать», а `null` — «стереть».
    @Test("Не менявшиеся поля не отправляются")
    func untouchedFieldsAreOmitted() throws {
        let body = try JSONEncoder().encode(MyProfileChange(phone: "+7 700 000 00 00"))
        let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])

        #expect(json["phone"] as? String == "+7 700 000 00 00")
        #expect(json["email"] == nil)
        #expect(json["telegram_chat_id"] == nil)
    }

    @Test("Telegram предлагается только оператору")
    func telegramIsOperatorOnly() throws {
        let operatorJson = #"{"kind":"operator","fullName":"Иван","position":"Кассир","phone":null,"email":null,"telegramChatId":"123"}"#
        let staffJson = #"{"kind":"staff","fullName":"Пётр","position":"manager","phone":null,"email":null,"telegramChatId":null}"#

        let asOperator = try APIClient.defaultDecoder.decode(MyProfile.self, from: Data(operatorJson.utf8))
        let asStaff = try APIClient.defaultDecoder.decode(MyProfile.self, from: Data(staffJson.utf8))

        #expect(asOperator.supportsTelegram)
        #expect(!asStaff.supportsTelegram)
        #expect(asOperator.telegramChatID == "123")
    }
}
