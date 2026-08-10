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

    enum CodingKeys: String, CodingKey {
        case action, approved
        case requestID = "requestId"
        case comment = "decision_comment"
    }
}
