import Foundation

// ── Аналитика владельца: /api/admin/owner-analytics ──────────────────────────
//
// Один ответ на все вкладки под общим фильтром: период, набор точек, база
// сравнения. Считает сервер — те же правила, что в отчётах сайта, — здесь
// только разбор и удобные производные вроде процента изменения.

/// С чем сравнивать выбранный период.
public enum AnalyticsCompare: String, Sendable, CaseIterable, Identifiable, Codable {
    /// Предыдущий период той же длины.
    case previous = "prev"
    /// Тот же период годом раньше — с учётом сезонности.
    case year

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .previous: "С прошлым периодом"
        case .year: "С прошлым годом"
        }
    }

    public var shortTitle: String {
        switch self {
        case .previous: "прошлый период"
        case .year: "прошлый год"
        }
    }
}

/// Шаг графика — выбирает сервер по длине периода.
public enum AnalyticsGroup: String, Decodable, Sendable {
    case day, week, month
}

public struct OwnerAnalytics: Decodable, Sendable {
    public let period: Period
    public let companies: [CompanyOption]
    public let kpi: KPIPair
    public let series: [SeriesPoint]
    public let byCompany: [CompanyRow]
    public let weekdays: [Weekday]
    /// Нет права на отчёты — разбивки по статьям нет вовсе.
    public let expenseCategories: [ExpenseCategory]?
    /// Нет права на аналитику операторов — блока нет.
    public let operators: Operators?
    /// Точки без кассы (клуб на отчётах смен) — блока нет.
    public let pos: POS?

    public struct Period: Decodable, Sendable, Hashable {
        public let from: String
        public let to: String
        /// Последний день с данными: «месяц» посреди месяца кончается сегодня.
        public let through: String
        public let prevFrom: String
        public let prevTo: String
        public let compare: String
        public let group: AnalyticsGroup
        /// Период ещё идёт — цифры будут расти.
        public let partial: Bool
    }

    public struct CompanyOption: Decodable, Sendable, Identifiable, Hashable {
        public let id: String
        public let name: String
        /// Отдельная касса, которую итоги по умолчанию не складывают.
        public let isExtra: Bool
    }

    public struct KPIPair: Decodable, Sendable {
        public let current: KPI
        public let previous: KPI
    }

    public struct KPI: Decodable, Sendable, Hashable {
        public let revenue: Double
        public let expense: Double
        /// Доход минус все расходы, включая покупку оборудования.
        public let profit: Double
        /// Прибыль как в ОПиУ: без оборудования и выплат партнёрам.
        public let pnlProfit: Double
        public let cash: Double
        public let kaspi: Double
        public let card: Double
        public let online: Double
        /// Число отчётов смен.
        public let shifts: Int

        public var cashless: Double { kaspi + card + online }

        /// Маржа в процентах; nil — выручки нет, делить не на что.
        public var marginPercent: Double? {
            revenue > 0 ? profit / revenue * 100 : nil
        }
    }

    public struct SeriesPoint: Decodable, Sendable, Hashable, Identifiable {
        public let date: String
        public let prevDate: String
        public let revenue: Double
        public let expense: Double
        public let profit: Double
        public let prevRevenue: Double
        public let prevExpense: Double
        public let prevProfit: Double

        public var id: String { date }
    }

    public struct CompanyRow: Decodable, Sendable, Hashable, Identifiable {
        public let id: String
        public let name: String
        public let revenue: Double
        public let expense: Double
        public let profit: Double
        public let prevRevenue: Double
        public let prevProfit: Double
    }

    public struct Weekday: Decodable, Sendable, Hashable, Identifiable {
        /// Понедельник = 0 … воскресенье = 6.
        public let weekday: Int
        public let total: Double
        public let days: Int
        public let average: Double

        public var id: Int { weekday }
    }

    public struct ExpenseCategory: Decodable, Sendable, Hashable, Identifiable {
        public let name: String
        public let amount: Double
        public let prevAmount: Double

        public var id: String { name }
    }

    public struct Operators: Decodable, Sendable {
        public let rows: [OperatorRow]
        /// Выручка из отчётов, где оператор не указан.
        public let unattributed: Double
    }

    public struct OperatorRow: Decodable, Sendable, Hashable, Identifiable {
        public let id: String
        public let name: String
        public let revenue: Double
        public let shifts: Int
        public let perShift: Double
        public let prevRevenue: Double
        public let prevPerShift: Double
    }

    public struct POS: Decodable, Sendable {
        public let amount: Double
        public let receipts: Int
        public let avgCheck: Double
        public let payment: Payment
        /// nil — у части товаров нет закупочной цены, и сумма соврала бы.
        public let grossProfit: Double?
        /// [день недели 0…6][час 0…23] — сумма чеков.
        public let heatmap: [[Double]]
        public let byHour: [Hour]
        public let topItems: [Item]
        public let byCategory: [Category]
        /// Чеков больше лимита — товары посчитаны не по всем.
        public let truncated: Bool
        public let previous: Previous

        public struct Payment: Decodable, Sendable, Hashable {
            public let cash: Double
            public let kaspi: Double
            public let card: Double
            public let online: Double
        }

        public struct Hour: Decodable, Sendable, Hashable, Identifiable {
            public let hour: Int
            public let amount: Double
            public let count: Int
            public var id: Int { hour }
        }

        public struct Item: Decodable, Sendable, Hashable, Identifiable {
            public let name: String
            public let qty: Double
            public let revenue: Double
            public let profit: Double?
            public var id: String { name }
        }

        public struct Category: Decodable, Sendable, Hashable, Identifiable {
            public let name: String
            public let qty: Double
            public let revenue: Double
            public var id: String { name }
        }

        public struct Previous: Decodable, Sendable, Hashable {
            public let amount: Double
            public let receipts: Int
            public let avgCheck: Double
            /// База обрезана тем же часом, что и сегодня.
            public let sameTime: Bool
        }
    }
}

public struct OwnerAnalyticsService: Sendable {
    private let api: APIClient
    public init(api: APIClient) { self.api = api }

    public func load(
        from: String,
        to: String,
        companyIDs: [String],
        compare: AnalyticsCompare,
        includeExtra: Bool = false
    ) async throws -> OwnerAnalytics {
        var query = ["from": from, "to": to, "compare": compare.rawValue]
        if includeExtra { query["include_extra"] = "1" }
        if !companyIDs.isEmpty { query["company_ids"] = companyIDs.sorted().joined(separator: ",") }
        let response: Envelope<OwnerAnalytics> = try await api.send(
            APIRequest(path: "/api/admin/owner-analytics", query: query)
        )
        return response.data
    }
}
