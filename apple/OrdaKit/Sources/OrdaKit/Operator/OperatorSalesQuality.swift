import Foundation

/// Как оператор работал с покупателями в этом месяце.
///
/// Личный экран: человек видит только себя. Ни рейтинга команды, ни чужих
/// баллов — сравнение людей между собой это инструмент управляющего, а у
/// кассы оно превращается в повод для обид.
///
/// Сервер отдаёт оценку словами, а не коэффициентами: «средний чек»,
/// «допродажи», а не веса модели. Приложение их и показывает — задача экрана
/// дать предмет для разговора с управляющим, а не научить читать формулу.
public struct SalesQualityMonth: Decodable, Sendable {
    /// Есть ли что показывать. Продавец без продаж за месяц — обычное дело:
    /// оператор клуба за прилавком магазина не стоит.
    public let available: Bool
    /// Почему пусто: `no-sales` — не продавал, `no-shifts` — смен не было.
    public let reason: String?
    public let month: String

    public let shifts: Int
    public let receipts: Int
    /// Машинный статус: TOP, STRONG, NORMAL, NEEDS_TRAINING, INSUFFICIENT_DATA.
    public let status: String
    public let statusLabel: String
    public let statusMeaning: String
    public let strengths: [String]
    public let weaknesses: [String]
    public let bonus: Bonus?

    public struct Bonus: Decodable, Sendable {
        public let amount: Double
        public let paid: Bool
        /// Что нужно сделать, чтобы доплата появилась. `nil` — уже заработана.
        public let nextStep: String?
        public let strong: Double
        public let top: Double

        private enum CodingKeys: String, CodingKey {
            case amount, paid, strong, top
            case nextStep = "next_step"
        }

        public init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            amount = try c.decodeFlexibleDouble(forKey: .amount) ?? 0
            paid = try c.decodeIfPresent(Bool.self, forKey: .paid) ?? false
            nextStep = try c.decodeIfPresent(String.self, forKey: .nextStep)
            strong = try c.decodeFlexibleDouble(forKey: .strong) ?? 0
            top = try c.decodeFlexibleDouble(forKey: .top) ?? 0
        }
    }

    private enum CodingKeys: String, CodingKey {
        case available, reason, month, shifts, receipts, status, strengths, weaknesses, bonus
        case statusLabel = "status_label"
        case statusMeaning = "status_meaning"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        available = try c.decodeIfPresent(Bool.self, forKey: .available) ?? false
        reason = try c.decodeIfPresent(String.self, forKey: .reason)
        month = try c.decodeIfPresent(String.self, forKey: .month) ?? ""
        shifts = try c.decodeIfPresent(Int.self, forKey: .shifts) ?? 0
        receipts = try c.decodeIfPresent(Int.self, forKey: .receipts) ?? 0
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? ""
        statusLabel = try c.decodeIfPresent(String.self, forKey: .statusLabel) ?? ""
        statusMeaning = try c.decodeIfPresent(String.self, forKey: .statusMeaning) ?? ""
        strengths = try c.decodeIfPresent([String].self, forKey: .strengths) ?? []
        weaknesses = try c.decodeIfPresent([String].self, forKey: .weaknesses) ?? []
        bonus = try c.decodeIfPresent(Bonus.self, forKey: .bonus)
    }

    /// Пустой месяц — чтобы экран не разбирал опционал в разметке.
    public static func unavailable(month: String, reason: String) -> SalesQualityMonth {
        SalesQualityMonth(month: month, reason: reason)
    }

    private init(month: String, reason: String) {
        available = false
        self.reason = reason
        self.month = month
        shifts = 0
        receipts = 0
        status = ""
        statusLabel = ""
        statusMeaning = ""
        strengths = []
        weaknesses = []
        bonus = nil
    }
}

public struct SalesQualityService: Sendable {
    private let api: APIClient

    public init(api: APIClient) { self.api = api }

    /// Мой месяц. `month` — «2026-08»; пусто — текущий.
    public func myMonth(month: String? = nil) async throws -> SalesQualityMonth {
        var path = "/api/operator/sales-kpi"
        if let month, !month.isEmpty { path += "?month=\(month)" }
        let response: DataEnvelope<SalesQualityMonth> = try await api.send(APIRequest(path: path))
        return response.data
    }
}
