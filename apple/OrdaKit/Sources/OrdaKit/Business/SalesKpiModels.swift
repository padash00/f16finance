import Foundation

/// Кому сколько доплатить за качество работы с покупателями.
///
/// Владельческий разбор продавцов магазина. На телефон берём именно эту
/// половину модуля: она отвечает на вопрос, ради которого владелец лезет в
/// раздел в дороге, — кому в этом месяце начислять и за что. Настройка модели,
/// веса метрик и выгрузки остаются на сайте: это работа за столом.
public struct SalesKpiPayout: Decodable, Sendable {
    public let month: String
    public let companyID: String
    public let rows: [Row]
    public let totals: Totals
    public let settings: Settings

    public struct Row: Decodable, Sendable, Identifiable, Hashable {
        public let cashierID: String
        public let name: String
        public let shifts: Int
        public let revenue: Double
        public let receipts: Int
        public let score: Double?
        public let status: String
        public let statusLabel: String
        public let amount: Double
        public let paid: Bool
        /// Почему ноль. `nil` — доплата есть.
        public let zeroReason: String?
        public let strengths: [String]
        public let weaknesses: [String]

        public var id: String { cashierID }

        private enum CodingKeys: String, CodingKey {
            case name, shifts, revenue, receipts, score, status, amount, paid, strengths, weaknesses
            case cashierID = "cashier_id"
            case statusLabel = "status_label"
            case zeroReason = "zero_reason"
        }

        public init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            cashierID = try c.decodeIfPresent(String.self, forKey: .cashierID) ?? UUID().uuidString
            name = try c.decodeIfPresent(String.self, forKey: .name) ?? "Без имени"
            shifts = try c.decodeIfPresent(Int.self, forKey: .shifts) ?? 0
            revenue = try c.decodeFlexibleDouble(forKey: .revenue) ?? 0
            receipts = try c.decodeIfPresent(Int.self, forKey: .receipts) ?? 0
            score = try c.decodeFlexibleDouble(forKey: .score)
            status = try c.decodeIfPresent(String.self, forKey: .status) ?? ""
            statusLabel = try c.decodeIfPresent(String.self, forKey: .statusLabel) ?? ""
            amount = try c.decodeFlexibleDouble(forKey: .amount) ?? 0
            paid = try c.decodeIfPresent(Bool.self, forKey: .paid) ?? false
            zeroReason = try c.decodeIfPresent(String.self, forKey: .zeroReason)
            strengths = try c.decodeIfPresent([String].self, forKey: .strengths) ?? []
            weaknesses = try c.decodeIfPresent([String].self, forKey: .weaknesses) ?? []
        }
    }

    public struct Totals: Decodable, Sendable {
        public let toPay: Double
        public let toPayPeople: Int
        public let alreadyPaid: Double
        public let alreadyPaidPeople: Int
        public let people: Int

        private enum CodingKeys: String, CodingKey {
            case people
            case toPay = "to_pay"
            case toPayPeople = "to_pay_people"
            case alreadyPaid = "already_paid"
            case alreadyPaidPeople = "already_paid_people"
        }

        public init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            toPay = try c.decodeFlexibleDouble(forKey: .toPay) ?? 0
            toPayPeople = try c.decodeIfPresent(Int.self, forKey: .toPayPeople) ?? 0
            alreadyPaid = try c.decodeFlexibleDouble(forKey: .alreadyPaid) ?? 0
            alreadyPaidPeople = try c.decodeIfPresent(Int.self, forKey: .alreadyPaidPeople) ?? 0
            people = try c.decodeIfPresent(Int.self, forKey: .people) ?? 0
        }
    }

    public struct Settings: Decodable, Sendable {
        public let strong: Double
        public let top: Double
        public let minQualifyingShifts: Int

        private enum CodingKeys: String, CodingKey {
            case strong = "monthly_bonus_strong"
            case top = "monthly_bonus_top"
            case minQualifyingShifts = "min_qualifying_shifts"
        }

        public init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            strong = try c.decodeFlexibleDouble(forKey: .strong) ?? 0
            top = try c.decodeFlexibleDouble(forKey: .top) ?? 0
            minQualifyingShifts = try c.decodeIfPresent(Int.self, forKey: .minQualifyingShifts) ?? 0
        }
    }

    private enum CodingKeys: String, CodingKey {
        case month, rows, totals, settings
        case companyID = "company_id"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        month = try c.decodeIfPresent(String.self, forKey: .month) ?? ""
        companyID = try c.decodeIfPresent(String.self, forKey: .companyID) ?? ""
        rows = try c.decodeIfPresent([Row].self, forKey: .rows) ?? []
        totals = try c.decode(Totals.self, forKey: .totals)
        settings = try c.decode(Settings.self, forKey: .settings)
    }
}

/// Список магазинов и, если магазин один, — сразу его отчёт.
///
/// Смешивать точки в один рейтинг нельзя: у магазинов разный ассортимент,
/// поток и ожидания, и общий список продавцов сравнивал бы несравнимое.
/// Поэтому сервер отвечает `needs_company`, а не выбирает за нас.
public struct SalesKpiStores: Decodable, Sendable {
    public let stores: [Company]
    public let noStore: Bool
    public let needsCompany: Bool

    private enum CodingKeys: String, CodingKey {
        case stores
        case noStore = "no_store"
        case needsCompany = "needs_company"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        stores = try c.decodeIfPresent([Company].self, forKey: .stores) ?? []
        noStore = try c.decodeIfPresent(Bool.self, forKey: .noStore) ?? false
        needsCompany = try c.decodeIfPresent(Bool.self, forKey: .needsCompany) ?? false
    }
}

public struct SalesKpiService: Sendable {
    private let api: APIClient

    public init(api: APIClient) { self.api = api }

    /// Магазины, по которым модуль вообще считается.
    public func stores(month: String) async throws -> SalesKpiStores {
        let bounds = SalesKpiService.monthBounds(month)
        let response: DataEnvelope<SalesKpiStores> = try await api.send(
            APIRequest(path: "/api/admin/sales-kpi", query: ["from": bounds.from, "to": bounds.to])
        )
        return response.data
    }

    public func payout(companyID: String, month: String) async throws -> SalesKpiPayout {
        let response: DataEnvelope<SalesKpiPayout> = try await api.send(
            APIRequest(path: "/api/admin/sales-kpi/payout", query: ["company_id": companyID, "month": month])
        )
        return response.data
    }

    /// Первый и последний день месяца «2026-08».
    public static func monthBounds(_ month: String) -> (from: String, to: String) {
        let parts = month.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 2 else { return (month, month) }
        var components = DateComponents()
        components.year = parts[0]
        components.month = parts[1]
        components.day = 1
        let calendar = Calendar(identifier: .gregorian)
        guard let start = calendar.date(from: components),
              let range = calendar.range(of: .day, in: .month, for: start)
        else { return ("\(month)-01", "\(month)-28") }
        return ("\(month)-01", String(format: "%@-%02d", month, range.count))
    }
}

/// Метрики модели человеческими словами.
///
/// Сервер в этом ответе отдаёт ключи, а не подписи: страница на сайте знает их
/// сама. Держим тот же словарь здесь — иначе продавцу показалось бы
/// `attach_rate`.
public enum SalesKpiMetric {
    private static let labels: [String: String] = [
        "avg_ticket": "Средний чек",
        "items_per_receipt": "Товаров на чек",
        "attach_rate": "Допродажи",
        "revenue_efficiency": "Отдача с покупателя",
        "plan_attainment": "Выполнение плана",
        "product_knowledge": "Знание товара",
    ]

    public static func label(_ key: String) -> String {
        labels[key] ?? key
    }
}