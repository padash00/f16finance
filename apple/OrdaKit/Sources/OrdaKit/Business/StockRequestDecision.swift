import Foundation

/// Решение по заявке склада: `POST /api/admin/inventory/requests`.
///
/// Заявку заводит точка — «пришлите двадцать банок», — а решение принимает
/// владелец. До этого решение принималось только на сайте: точка ждала, пока
/// он доберётся до ноутбука, хотя вопрос решается одним взглядом на остаток.
struct StockRequestDecision: Encodable {
    let action = "decideRequest"
    let requestID: String
    let approved: Bool
    let comment: String?
    /// Сколько одобрено по каждой позиции.
    ///
    /// Функция в базе требует строку на каждую позицию заявки: без неё решение
    /// не проходит вовсе. Здесь строк не было, и одобрить заявку из телефона
    /// было нельзя — кнопка просто возвращала ошибку.
    ///
    /// Кнопка «Одобрить» означает «как просили», поэтому количества берутся из
    /// самой заявки. Частичное одобрение — правка количеств — пока только на
    /// сайте.
    let items: [Line]

    struct Line: Encodable {
        let requestItemID: String
        let approvedQty: Double

        enum CodingKeys: String, CodingKey {
            case requestItemID = "request_item_id"
            case approvedQty = "approved_qty"
        }
    }

    enum CodingKeys: String, CodingKey {
        case action, approved, items
        case requestID = "requestId"
        case comment = "decision_comment"
    }
}
