import Foundation
import Testing
@testable import OrdaKit

@Suite("Правка каталога и карточки оператора")
struct CatalogOperatorEditTests {
    private func object(_ data: Data) throws -> [String: Any] {
        try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    @Test("Правка товара уходит полной карточкой, как на сайте")
    func updateItemBody() throws {
        let json = #"{"id":"i1","name":"Кола","barcode":"123","unit":"шт","sale_price":500,"default_purchase_price":300,"category_id":"c1","item_type":"product","notes":null,"low_stock_threshold":5,"requires_expiry":true,"image_url":"https://x/y.jpg","catalog_qty":10}"#
        let item = try JSONDecoder().decode(CatalogItem.self, from: Data(json.utf8))
        var draft = CatalogItemDraft(item: item)
        draft.salePrice = 550
        let body = try object(draft.updateBody(itemID: item.id))
        #expect(body["action"] as? String == "updateItem")
        #expect(body["item_id"] as? String == "i1")
        let fields = try #require(body["fields"] as? [String: Any])
        #expect(fields["sale_price"] as? Double == 550)
        #expect(fields["default_purchase_price"] as? Double == 300)
        #expect(fields["category_id"] as? String == "c1")
        #expect(fields["low_stock_threshold"] as? Double == 5)
        #expect(fields["requires_expiry"] as? Bool == true)
        #expect(fields["notes"] is NSNull)
    }

    @Test("Новый товар — с точкой-магазином, без неё сервер откажет")
    func createItemBody() throws {
        let draft = CatalogItemDraft(name: " Чипсы ", barcode: "999", salePrice: 400)
        let body = try object(draft.createBody(companyID: "shop1"))
        #expect(body["action"] as? String == "createItem")
        #expect(body["company_id"] as? String == "shop1")
        let payload = try #require(body["payload"] as? [String: Any])
        #expect(payload["name"] as? String == "Чипсы")
        #expect(payload["category_id"] is NSNull)
        #expect(CatalogItemDraft(name: "X").problem == "Укажите штрихкод")
    }

    @Test("Карточка оператора: Telegram уходит обратно, иначе сервер его сотрёт")
    func operatorBodies() throws {
        let json = #"{"ok":true,"data":{"operator":{"id":"op1","name":"Алима","short_name":"Али","telegram_chat_id":123456789,"is_active":true},"profile":{"full_name":"Сарсенгазинова Алима","phone":"+7 700","email":null,"position":"Кассир","hire_date":"2026-01-10"}}}"#
        let card = try JSONDecoder().decode(OperatorCard.self, from: Data(json.utf8))
        #expect(card.telegramChatID == "123456789")
        var edit = OperatorEdit(card: card)
        edit.profile.phone = "+7 701"
        let patch = try object(edit.profileBody())
        #expect(patch["operator_id"] as? String == "op1")
        #expect(patch["telegram_chat_id"] as? String == "123456789")
        let profile = try #require(patch["profile"] as? [String: Any])
        #expect(profile["phone"] as? String == "+7 701")
        #expect(profile["hire_date"] as? String == "2026-01-10")
        #expect(profile["email"] is NSNull)

        let update = try object(edit.operatorBody())
        #expect(update["action"] as? String == "updateOperator")
        #expect(update["operatorId"] as? String == "op1")
        let payload = try #require(update["payload"] as? [String: Any])
        #expect(payload["name"] as? String == "Алима")
        #expect(payload["position"] as? String == "Кассир")
        #expect(payload["phone"] as? String == "+7 701")
    }

    @Test("Карточка без профиля разбирается")
    func operatorWithoutProfile() throws {
        let json = #"{"ok":true,"data":{"operator":{"id":"op2","name":"Дамир"},"profile":null}}"#
        let card = try JSONDecoder().decode(OperatorCard.self, from: Data(json.utf8))
        #expect(card.profile == OperatorCard.Profile())
        #expect(card.telegramChatID == nil)
    }
}
