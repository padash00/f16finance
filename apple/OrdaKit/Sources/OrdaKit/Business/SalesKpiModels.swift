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

/// Разбор смен по продавцам — вкладка «По продавцам» с сайта.
///
/// Приходит тем же запросом, что и список магазинов: сервер отдаёт весь отчёт
/// разом. В приложении показывалась только доплата, хотя ответ уже лежал в
/// памяти — человек видел «кому доплатить» и не видел, за что.
public struct SalesKpiReport: Decodable, Sendable {
    public let companyName: String?
    public let cashiers: [Cashier]
    public let totals: Totals
    /// Со скольких смен ставится статус: по паре смен человека не оценивают.
    public let minQualifyingShifts: Int
    /// Разбор по сменам: почему касса получилась такой.
    ///
    /// Приходил в том же ответе и не использовался — приложение показывало
    /// «кому доплатить» и «по продавцам», а вопрос «за что» оставался на сайте.
    public let shifts: [Shift]

    /// Смена с разбором.
    ///
    /// Главное здесь — `verdict`: касса просела из-за того, что мало людей
    /// зашло, или из-за того, как продавец с ними работал. Это два разных
    /// ответа, и путать их нельзя — за пустой вечер человек не отвечает.
    public struct Shift: Decodable, Sendable, Identifiable, Hashable {
        public let date: String
        public let shift: String
        public let shiftID: String?
        public let cashierName: String?
        public let revenue: Double
        public let expectedRevenue: Double?
        public let receipts: Int
        public let verdict: String
        /// Что именно сложилось так — короткими фразами от сервера.
        public let evidence: [String]

        public var id: String { shiftID ?? "\(date)-\(shift)" }

        public var shiftLabel: String { shift == "night" ? "Ночь" : "День" }

        /// Средний чек — то, о чём спрашивают первым.
        public var averageReceipt: Double { receipts > 0 ? revenue / Double(receipts) : 0 }

        /// Насколько касса разошлась с ожидаемой. `nil` — ожидания нет.
        public var deviation: Double? {
            guard let expectedRevenue, expectedRevenue > 0 else { return nil }
            return (revenue - expectedRevenue) / expectedRevenue
        }

        private enum CodingKeys: String, CodingKey {
            case date, shift, revenue, receipts, verdict, evidence
            case shiftID = "shift_id"
            case cashierName = "cashier_name"
            case expectedRevenue = "expected_revenue"
        }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            date = try c.decodeFlexibleString(forKey: .date) ?? ""
            shift = try c.decodeFlexibleString(forKey: .shift) ?? "day"
            shiftID = try c.decodeFlexibleString(forKey: .shiftID)
            cashierName = try c.decodeFlexibleString(forKey: .cashierName)
            revenue = try c.decodeFlexibleDouble(forKey: .revenue) ?? 0
            expectedRevenue = try c.decodeFlexibleDouble(forKey: .expectedRevenue)
            receipts = Int(try c.decodeFlexibleDouble(forKey: .receipts) ?? 0)
            verdict = try c.decodeFlexibleString(forKey: .verdict) ?? "NORMAL"
            evidence = (try? c.decode([String].self, forKey: .evidence)) ?? []
        }
    }

    public struct Cashier: Decodable, Sendable, Identifiable, Hashable {
        public let cashierID: String
        public let name: String
        public let shifts: Int
        public let revenue: Double
        public let receipts: Int
        /// Балл относительно нормы: 1,0 — норма. `nil` — смен слишком мало.
        public let score: Double?
        public let status: String
        /// Что получается лучше нормы и что хуже — ключами метрик.
        public let strengths: [String]
        public let weaknesses: [String]
        public let trainingFlag: Bool
        public let trainingReason: String?

        public var id: String { cashierID }

        /// Средний чек — то, о чём спрашивают первым.
        public var averageReceipt: Double { receipts > 0 ? revenue / Double(receipts) : 0 }

        /// «на 6% лучше нормы» — балл сам по себе никому ничего не говорит.
        public var scoreText: String {
            guard let score else { return "нет оценки" }
            let delta = Int(((score - 1) * 100).rounded())
            if delta == 0 { return "как норма" }
            return delta > 0 ? "на \(delta)% лучше нормы" : "на \(abs(delta))% ниже нормы"
        }

        public var statusLabel: String {
            switch status {
            case "TOP": "Топ"
            case "STRONG": "Сильный"
            case "OK", "NORMAL": "Норма"
            case "WEAK": "Слабее нормы"
            case "LOW_SAMPLE", "FEW_SHIFTS": "Мало смен"
            default: StatusText.humanize(status)
            }
        }

        public init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            cashierID = try c.decodeFlexibleString(forKey: .cashierID) ?? UUID().uuidString
            name = try c.decodeFlexibleString(forKey: .name) ?? "Продавец"
            shifts = Int(try c.decodeFlexibleDouble(forKey: .shifts) ?? 0)
            revenue = try c.decodeFlexibleDouble(forKey: .revenue) ?? 0
            receipts = Int(try c.decodeFlexibleDouble(forKey: .receipts) ?? 0)
            score = try c.decodeFlexibleDouble(forKey: .score)
            status = try c.decodeFlexibleString(forKey: .status) ?? "OK"
            strengths = try c.decodeIfPresent([String].self, forKey: .strengths) ?? []
            weaknesses = try c.decodeIfPresent([String].self, forKey: .weaknesses) ?? []
            trainingFlag = try c.decodeIfPresent(Bool.self, forKey: .trainingFlag) ?? false
            trainingReason = try c.decodeFlexibleString(forKey: .trainingReason)
        }

        private enum CodingKeys: String, CodingKey {
            case name, shifts, revenue, receipts, score, status, strengths, weaknesses
            case cashierID = "cashier_id"
            case trainingFlag = "training_flag"
            case trainingReason = "training_reason"
        }
    }

    public struct Totals: Decodable, Sendable, Hashable {
        public let revenue: Double
        public let receipts: Int
        public let shifts: Int

        public var averageReceipt: Double { receipts > 0 ? revenue / Double(receipts) : 0 }

        public init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            revenue = try c.decodeFlexibleDouble(forKey: .revenue) ?? 0
            receipts = Int(try c.decodeFlexibleDouble(forKey: .receipts) ?? 0)
            shifts = Int(try c.decodeFlexibleDouble(forKey: .shifts) ?? 0)
        }

        private enum CodingKeys: String, CodingKey { case revenue, receipts, shifts }
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        companyName = try c.decodeIfPresent(CompanyRef.self, forKey: .company)?.name
        cashiers = try c.decodeIfPresent([Cashier].self, forKey: .cashiers) ?? []
        totals = try c.decodeIfPresent(Totals.self, forKey: .totals) ?? Totals.empty
        minQualifyingShifts = try c.decodeIfPresent(SettingsRef.self, forKey: .settings)?.minQualifyingShifts ?? 6
        shifts = (try? c.decode([Shift].self, forKey: .shifts)) ?? []
    }

    private struct CompanyRef: Decodable { let name: String? }
    private struct SettingsRef: Decodable {
        let minQualifyingShifts: Int?
        private enum CodingKeys: String, CodingKey { case minQualifyingShifts = "min_qualifying_shifts" }
    }

    private enum CodingKeys: String, CodingKey { case company, cashiers, totals, settings, shifts }
}

extension SalesKpiReport.Totals {
    static let empty: Self = {
        let json = Data("{}".utf8)
        return try! JSONDecoder().decode(Self.self, from: json)
    }()
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

    /// Полный отчёт за месяц: продавцы, смены, итоги.
    public func report(month: String) async throws -> SalesKpiReport {
        let bounds = SalesKpiService.monthBounds(month)
        let response: DataEnvelope<SalesKpiReport> = try await api.send(
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