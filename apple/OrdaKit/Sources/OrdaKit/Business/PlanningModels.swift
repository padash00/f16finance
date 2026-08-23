import Foundation

// ── Доверенные поставщики: /api/admin/expenses/whitelist ─────────────────────

/// Получатель, которому можно платить без фото чека.
///
/// Список ведут ради контроля: расход в пользу того, кого здесь нет, требует
/// подтверждения. Поэтому важно не «сколько записей», а кому именно и на какой
/// точке разрешено платить вслепую.
public struct TrustedVendor: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    /// `nil` — правило действует на всех точках организации.
    public let companyID: String?
    public let defaultCategoryID: String?
    public let notes: String?
    public let createdAt: Date?

    /// Ограничен ли вендор одной точкой.
    public var isCompanyScoped: Bool { companyID != nil }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        name = try c.decodeFlexibleString(forKey: .name) ?? "Без названия"
        companyID = try c.decodeFlexibleString(forKey: .companyID)
        defaultCategoryID = try c.decodeFlexibleString(forKey: .defaultCategoryID)
        notes = try c.decodeFlexibleString(forKey: .notes)
        createdAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .createdAt))
    }

    private enum CodingKeys: String, CodingKey {
        case id, notes
        case name = "vendor_name"
        case companyID = "company_id"
        case defaultCategoryID = "default_category_id"
        case createdAt = "created_at"
    }
}

/// Список вендоров вместе со справочниками, которыми он размечен.
///
/// Роут отдаёт только идентификаторы точки и статьи; названия живут в других
/// справочниках, поэтому собираем их здесь, а не показываем сырые UUID.
public struct TrustedVendorBoard: Sendable {
    public let vendors: [TrustedVendor]
    public let companies: [Company]
    public let categories: [ExpenseCategory]

    public init(vendors: [TrustedVendor], companies: [Company], categories: [ExpenseCategory]) {
        self.vendors = vendors
        self.companies = companies
        self.categories = categories
    }

    public func companyName(_ id: String?) -> String {
        guard let id else { return "Все точки" }
        return companies.first { $0.id == id }?.name ?? "Точка"
    }

    public func categoryName(_ id: String?) -> String? {
        guard let id else { return nil }
        return categories.first { $0.id == id }?.name
    }

    /// Сначала общие на всю организацию, дальше по алфавиту: правило «для всех»
    /// действует шире и о нём важнее знать.
    public var sortedVendors: [TrustedVendor] {
        vendors.sorted { left, right in
            if left.isCompanyScoped != right.isCompanyScoped { return !left.isCompanyScoped }
            return left.name.localizedCaseInsensitiveCompare(right.name) == .orderedAscending
        }
    }

    public var companyScopedCount: Int { vendors.filter(\.isCompanyScoped).count }
}

public struct TrustedVendorService: Sendable {
    private let api: APIClient
    public init(api: APIClient) { self.api = api }

    public func load() async throws -> TrustedVendorBoard {
        let vendors: DataList<TrustedVendor> = try await api.send(
            APIRequest(path: "/api/admin/expenses/whitelist")
        )
        // Справочники — вспомогательные: без права на них экран всё равно
        // должен показать сам список, пусть и без названий точки и статьи.
        var companies: [Company] = []
        if let list: DataList<Company> = try? await api.send(APIRequest(path: "/api/admin/companies")) {
            companies = list.items
        }
        var categories: [ExpenseCategory] = []
        if let list: DataList<ExpenseCategory> = try? await api.send(
            APIRequest(path: "/api/admin/expense-categories")
        ) {
            categories = list.items
        }

        return TrustedVendorBoard(
            vendors: vendors.items,
            companies: companies,
            categories: categories
        )
    }
}

// ── Симуляция выручки: /api/admin/simulation ─────────────────────────────────

/// Тариф точки с посчитанной ставкой часа.
///
/// Ставку считает сервер: бонусные часы входят в знаменатель, и повторение
/// этого деления на клиенте дало бы вторую версию «₸ за час» — а на ней стоит
/// весь дальнейший расчёт потенциала.
public struct SimulationTariff: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let paidHours: Double
    public let bonusHours: Double
    public let price: Double
    public let ratePerHour: Double

    /// «2+1» — сколько часов оплачено и сколько подарено.
    public var hoursLabel: String {
        bonusHours > 0
            ? "\(Quantity.format(paidHours))+\(Quantity.format(bonusHours)) ч"
            : "\(Quantity.format(paidHours)) ч"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        name = try c.decodeFlexibleString(forKey: .name) ?? "Тариф"
        paidHours = try c.decodeFlexibleDouble(forKey: .paidHours) ?? 0
        bonusHours = try c.decodeFlexibleDouble(forKey: .bonusHours) ?? 0
        price = try c.decodeFlexibleDouble(forKey: .price) ?? 0
        ratePerHour = try c.decodeFlexibleDouble(forKey: .ratePerHour) ?? 0
    }

    private enum CodingKeys: String, CodingKey {
        case name
        case id = "tariff_id"
        case paidHours = "paid_hours"
        case bonusHours = "bonus_hours"
        case price
        case ratePerHour = "rate_per_hour"
    }
}

/// Зона клуба с потенциалом выручки.
public struct SimulationZone: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let deviceType: String
    public let deviceCount: Double
    /// Заложенная загрузка, часов на устройство в сутки.
    public let occupancyHours: Double
    /// Средневзвешенная ставка ₸/час по миксу тарифов зоны.
    public let blendedRate: Double
    /// Сумма долей микса.
    public let shareSum: Double
    public let perDevicePerDay: Double
    public let potentialPerDay: Double
    public let potentialPerMonth: Double

    public var deviceTypeLabel: String {
        switch deviceType {
        case "pc": "ПК"
        case "ps": "PlayStation"
        case "sim_racing": "Sim Racing"
        case "vr": "VR"
        default: "Другое"
        }
    }

    /// Микс заполнен небрежно: доли не складываются в сотню, и потенциал зоны
    /// посчитан не по всем её устройствам.
    public var hasBrokenMix: Bool { shareSum > 0 && abs(shareSum - 100) > 1 }

    /// Тарифы зоне вовсе не назначены — считать нечего.
    public var hasNoMix: Bool { shareSum == 0 }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        name = try c.decodeFlexibleString(forKey: .name) ?? "Зона"
        deviceType = try c.decodeFlexibleString(forKey: .deviceType) ?? "pc"
        deviceCount = try c.decodeFlexibleDouble(forKey: .deviceCount) ?? 0
        occupancyHours = try c.decodeFlexibleDouble(forKey: .occupancyHours) ?? 0
        blendedRate = try c.decodeFlexibleDouble(forKey: .blendedRate) ?? 0
        shareSum = try c.decodeFlexibleDouble(forKey: .shareSum) ?? 0
        perDevicePerDay = try c.decodeFlexibleDouble(forKey: .perDevicePerDay) ?? 0
        potentialPerDay = try c.decodeFlexibleDouble(forKey: .potentialPerDay) ?? 0
        potentialPerMonth = try c.decodeFlexibleDouble(forKey: .potentialPerMonth) ?? 0
    }

    private enum CodingKeys: String, CodingKey {
        case name
        case id = "zone_id"
        case deviceType = "device_type"
        case deviceCount = "device_count"
        case occupancyHours = "occupancy_hours"
        case blendedRate = "blended_rate"
        case shareSum = "share_sum"
        case perDevicePerDay = "per_device_per_day"
        case potentialPerDay = "potential_per_day"
        case potentialPerMonth = "potential_per_month"
    }
}

/// Потенциал против факта. Всё считает сервер той же функцией, что и сайт.
public struct SimulationProjection: Decodable, Sendable {
    public let zones: [SimulationZone]
    public let tariffs: [SimulationTariff]
    public let totalDevices: Double
    /// Выручка за один час полной загрузки клуба.
    public let capacityRatePerHour: Double
    public let potentialPerDay: Double
    public let potentialPerMonth: Double
    public let factPerDay: Double
    public let factPerMonth: Double
    /// Потенциал минус факт: сколько клуб недозарабатывает за месяц.
    public let gapPerMonth: Double
    /// Какая загрузка нужна, чтобы выйти на текущую выручку.
    public let impliedOccupancyHours: Double?
    /// Какая загрузка заложена в конфиге.
    public let assumedOccupancyHours: Double?
    /// Расхождение факта с заложенным, в часах.
    public let occupancyGapHours: Double?

    public static let empty = SimulationProjection()

    private init() {
        zones = []; tariffs = []
        totalDevices = 0; capacityRatePerHour = 0
        potentialPerDay = 0; potentialPerMonth = 0
        factPerDay = 0; factPerMonth = 0; gapPerMonth = 0
        impliedOccupancyHours = nil; assumedOccupancyHours = nil; occupancyGapHours = nil
    }

    /// Есть ли что показывать: без зон и тарифов расчёт пуст, а не нулевой.
    public var isConfigured: Bool { !zones.isEmpty && !tariffs.isEmpty }

    /// Факт ниже потенциала — обычный случай, разрыв показываем как недобор.
    public var isUnderPotential: Bool { gapPerMonth > 0 }

    /// Какую долю потенциала выбирает клуб. `nil`, если потенциал не посчитан.
    public var factShare: Double? {
        guard potentialPerMonth > 0 else { return nil }
        return factPerMonth / potentialPerMonth
    }

    /// Зоны от крупных к мелким: разговор всегда начинается с самой дорогой.
    public var zonesByPotential: [SimulationZone] {
        zones.sorted { $0.potentialPerMonth > $1.potentialPerMonth }
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        zones = (try? c.decodeIfPresent([SimulationZone].self, forKey: .zones)) as? [SimulationZone] ?? []
        tariffs = (try? c.decodeIfPresent([SimulationTariff].self, forKey: .tariffs)) as? [SimulationTariff] ?? []
        totalDevices = try c.decodeFlexibleDouble(forKey: .totalDevices) ?? 0
        capacityRatePerHour = try c.decodeFlexibleDouble(forKey: .capacityRatePerHour) ?? 0
        potentialPerDay = try c.decodeFlexibleDouble(forKey: .potentialPerDay) ?? 0
        potentialPerMonth = try c.decodeFlexibleDouble(forKey: .potentialPerMonth) ?? 0
        factPerDay = try c.decodeFlexibleDouble(forKey: .factPerDay) ?? 0
        factPerMonth = try c.decodeFlexibleDouble(forKey: .factPerMonth) ?? 0
        gapPerMonth = try c.decodeFlexibleDouble(forKey: .gapPerMonth) ?? 0
        impliedOccupancyHours = try c.decodeFlexibleDouble(forKey: .impliedOccupancyHours)
        assumedOccupancyHours = try c.decodeFlexibleDouble(forKey: .assumedOccupancyHours)
        occupancyGapHours = try c.decodeFlexibleDouble(forKey: .occupancyGapHours)
    }

    private enum CodingKeys: String, CodingKey {
        case zones, tariffs
        case totalDevices = "total_devices"
        case capacityRatePerHour = "capacity_rate_per_hour"
        case potentialPerDay = "potential_per_day"
        case potentialPerMonth = "potential_per_month"
        case factPerDay = "fact_per_day"
        case factPerMonth = "fact_per_month"
        case gapPerMonth = "gap_per_month"
        case impliedOccupancyHours = "implied_occupancy_hours"
        case assumedOccupancyHours = "assumed_occupancy_hours"
        case occupancyGapHours = "occupancy_gap_hours"
    }
}

/// Фактическая выручка точки за окно наблюдения.
public struct SimulationFact: Decodable, Sendable, Hashable {
    public let windowDays: Int
    public let totalRevenue: Double
    public let revenuePerDay: Double
    public let revenuePerMonth: Double

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        windowDays = Int(try c.decodeFlexibleDouble(forKey: .windowDays) ?? 0)
        totalRevenue = try c.decodeFlexibleDouble(forKey: .totalRevenue) ?? 0
        revenuePerDay = try c.decodeFlexibleDouble(forKey: .revenuePerDay) ?? 0
        revenuePerMonth = try c.decodeFlexibleDouble(forKey: .revenuePerMonth) ?? 0
    }

    private enum CodingKeys: String, CodingKey {
        case windowDays = "window_days"
        case totalRevenue = "total_revenue"
        case revenuePerDay = "revenue_per_day"
        case revenuePerMonth = "revenue_per_month"
    }
}

/// Ответ `GET /api/admin/simulation?company_id=…`.
public struct RevenueSimulation: Decodable, Sendable {
    public let companies: [Company]
    public let companyID: String?
    public let fact: SimulationFact?
    public let projection: SimulationProjection
    /// Сама модель — зоны и тарифы. Нужна не для показа (для него есть
    /// `projection`), а чтобы её можно было править прямо в приложении.
    public let zones: [SimulationZoneConfig]
    public let tariffs: [SimulationTariffConfig]

    public var companyName: String {
        companies.first { $0.id == companyID }?.name ?? "Точка"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        companies = (try? c.decodeIfPresent([Company].self, forKey: .companies)) as? [Company] ?? []
        companyID = try c.decodeFlexibleString(forKey: .companyID)
        fact = (try? c.decodeIfPresent(SimulationFact.self, forKey: .fact)) as? SimulationFact
        projection = (try? c.decodeIfPresent(SimulationProjection.self, forKey: .projection)) as? SimulationProjection ?? .empty
        zones = (try? c.decodeIfPresent([SimulationZoneConfig].self, forKey: .zones)) as? [SimulationZoneConfig] ?? []
        tariffs = (try? c.decodeIfPresent([SimulationTariffConfig].self, forKey: .tariffs)) as? [SimulationTariffConfig] ?? []
    }

    private enum CodingKeys: String, CodingKey {
        case companies, fact, projection, zones, tariffs
        case companyID = "company_id"
    }
}

public struct SimulationService: Sendable {
    private let api: APIClient
    public init(api: APIClient) { self.api = api }

    /// Без `companyID` сервер сам берёт первую доступную точку.
    public func load(companyID: String? = nil) async throws -> RevenueSimulation {
        var query: [String: String] = [:]
        if let companyID, !companyID.isEmpty { query["company_id"] = companyID }
        let response: Envelope<RevenueSimulation> = try await api.send(
            APIRequest(path: "/api/admin/simulation", query: query)
        )
        return response.data
    }

    /// Сохранить модель точки. Требует `simulation.edit`.
    ///
    /// Сервер заменяет конфиг целиком, поэтому отправляем весь набор зон и
    /// тарифов, а не изменённые.
    public func save(
        companyID: String,
        zones: [SimulationZoneConfig],
        tariffs: [SimulationTariffConfig]
    ) async throws {
        let body = try JSONEncoder().encode(
            SimulationSaveRequest(companyID: companyID, zones: zones, tariffs: tariffs)
        )
        _ = try await api.send(
            APIRequest(path: "/api/admin/simulation", method: .post, body: body)
        )
    }
}

// ── Долги поставщикам: /api/admin/store/debts ────────────────────────────────

/// Счёт поставщика: приняли товар, деньги ещё не отдали.
public struct SupplierDebt: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let supplierName: String
    public let binIIN: String?
    public let companyName: String?
    public let amount: Double
    public let status: String
    public let dueDate: Date?
    /// Реализация: платим по мере продажи, а не к сроку.
    public let isConsignment: Bool
    public let invoiceNumber: String?
    public let receivedAt: Date?
    public let paidAt: Date?
    public let paidCash: Double
    public let paidKaspi: Double
    public let comment: String?
    /// Просрочен ли счёт. Решает сервер — тем же правилом, каким считает
    /// сумму просроченного: иначе красные строки не сошлись бы с шапкой.
    public let isOverdue: Bool

    public var isOpen: Bool { status == "open" }
    public var isPaid: Bool { status == "paid" }
    public var isWrittenOff: Bool { status == "written_off" }

    public var statusLabel: String {
        switch status {
        case "open": "Не оплачен"
        case "paid": "Оплачен"
        case "written_off": "Списан"
        default: StatusText.humanize(status)
        }
    }

    /// Сколько дней осталось до срока. Отрицательное — столько уже просрочено.
    /// Величина справочная, для подписи: просрочку определяет `isOverdue`.
    public var daysUntilDue: Int? {
        guard isOpen, let dueDate else { return nil }
        let today = Calendar.current.startOfDay(for: Date())
        return Calendar.current.dateComponents([.day], from: today, to: dueDate).day
    }

    public var initials: String {
        let parts = supplierName.split(separator: " ").prefix(2)
        return parts.compactMap(\.first).map(String.init).joined().uppercased()
    }

    private struct SupplierRef: Decodable {
        let name: String?
        let organizationName: String?
        let binIIN: String?

        init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            name = try c.decodeFlexibleString(forKey: .name)
            organizationName = try c.decodeFlexibleString(forKey: .organizationName)
            binIIN = try c.decodeFlexibleString(forKey: .binIIN)
        }

        private enum CodingKeys: String, CodingKey {
            case name
            case organizationName = "organization_name"
            case binIIN = "bin_iin"
        }
    }

    private struct CompanyRef: Decodable {
        let name: String?

        init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            name = try c.decodeFlexibleString(forKey: .name)
        }

        private enum CodingKeys: String, CodingKey { case name }
    }

    private struct ReceiptRef: Decodable {
        let invoiceNumber: String?
        let receivedAt: String?

        init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            invoiceNumber = try c.decodeFlexibleString(forKey: .invoiceNumber)
            receivedAt = try c.decodeFlexibleString(forKey: .receivedAt)
        }

        private enum CodingKeys: String, CodingKey {
            case invoiceNumber = "invoice_number"
            case receivedAt = "received_at"
        }
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let supplier = (try? c.decodeIfPresent(SupplierRef.self, forKey: .supplier)) as? SupplierRef
        let company = (try? c.decodeIfPresent(CompanyRef.self, forKey: .company)) as? CompanyRef
        let receipt = (try? c.decodeIfPresent(ReceiptRef.self, forKey: .receipt)) as? ReceiptRef

        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        // Юридическое лицо важнее имени контакта: платят именно ему.
        supplierName = supplier?.organizationName?.nilIfBlank
            ?? supplier?.name?.nilIfBlank
            ?? "Поставщик"
        binIIN = supplier?.binIIN
        companyName = company?.name
        amount = try c.decodeFlexibleDouble(forKey: .amount) ?? 0
        status = try c.decodeFlexibleString(forKey: .status) ?? "open"
        dueDate = DateParsing.date(from: try c.decodeFlexibleString(forKey: .dueDate))
        isConsignment = (try? c.decodeIfPresent(Bool.self, forKey: .isConsignment)) as? Bool ?? false
        invoiceNumber = receipt?.invoiceNumber
        receivedAt = DateParsing.date(from: receipt?.receivedAt)
        paidAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .paidAt))
        paidCash = try c.decodeFlexibleDouble(forKey: .paidCash) ?? 0
        paidKaspi = try c.decodeFlexibleDouble(forKey: .paidKaspi) ?? 0
        comment = try c.decodeFlexibleString(forKey: .comment)
        isOverdue = (try? c.decodeIfPresent(Bool.self, forKey: .isOverdue)) as? Bool ?? false
    }

    private enum CodingKeys: String, CodingKey {
        case id, status, supplier, company, receipt
        case amount = "total_amount"
        case dueDate = "due_date"
        case isOverdue = "is_overdue"
        case isConsignment = "is_consignment"
        case paidAt = "payment_paid_at"
        case paidCash = "payment_cash_amount"
        case paidKaspi = "payment_kaspi_amount"
        case comment = "payment_comment"
    }
}

/// Свод по долгам. Считает сервер: по этим цифрам решают, кому платить сегодня.
public struct SupplierDebtTotals: Decodable, Sendable, Hashable {
    public let open: Double
    public let openCount: Int
    public let overdue: Double
    public let overdueCount: Int

    public static let zero = SupplierDebtTotals()

    private init() { open = 0; openCount = 0; overdue = 0; overdueCount = 0 }

    public var hasOverdue: Bool { overdueCount > 0 }

    /// Какая часть долга уже просрочена — от 0 до 1.
    public var overdueShare: Double {
        guard open > 0 else { return 0 }
        return min(1, max(0, overdue / open))
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        open = try c.decodeFlexibleDouble(forKey: .open) ?? 0
        openCount = Int(try c.decodeFlexibleDouble(forKey: .openCount) ?? 0)
        overdue = try c.decodeFlexibleDouble(forKey: .overdue) ?? 0
        overdueCount = Int(try c.decodeFlexibleDouble(forKey: .overdueCount) ?? 0)
    }

    private enum CodingKeys: String, CodingKey {
        case open, overdue
        case openCount = "open_count"
        case overdueCount = "overdue_count"
    }
}

/// Ответ `GET /api/admin/store/debts`.
public struct SupplierDebtBoard: Decodable, Sendable {
    public let debts: [SupplierDebt]
    public let totals: SupplierDebtTotals

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        debts = (try? c.decodeIfPresent([SupplierDebt].self, forKey: .debts)) as? [SupplierDebt] ?? []
        totals = (try? c.decodeIfPresent(SupplierDebtTotals.self, forKey: .totals)) as? SupplierDebtTotals ?? .zero
    }

    private enum CodingKeys: String, CodingKey { case debts, totals }

    public var openDebts: [SupplierDebt] { debts.filter(\.isOpen) }

    /// Открытые счета в порядке срочности: просроченные первыми, дальше по
    /// сроку оплаты. Бессрочные — в конце, они никого не подгоняют.
    public var byUrgency: [SupplierDebt] {
        openDebts.sorted { left, right in
            switch (left.dueDate, right.dueDate) {
            case let (leftDue?, rightDue?): return leftDue < rightDue
            case (nil, _?): return false
            case (_?, nil): return true
            default: return left.amount > right.amount
            }
        }
    }
}

public struct SupplierDebtService: Sendable {
    private let api: APIClient
    public init(api: APIClient) { self.api = api }

    /// `status`: `all`, `open`, `paid`, `written_off`.
    public func load(status: String = "all") async throws -> SupplierDebtBoard {
        let response: Envelope<SupplierDebtBoard> = try await api.send(
            APIRequest(path: "/api/admin/store/debts", query: ["status": status])
        )
        return response.data
    }

    /// Загрузить чек об оплате и получить его адрес.
    ///
    /// Отдельным шагом, потому что оплата без чека не принимается: сервер
    /// требует подтверждение платежа, и это правильно — иначе долг закрывается
    /// со слов. Фотографируют его тут же, телефоном.
    public func uploadPaymentReceipt(fileName: String, mimeType: String, data: Data) async throws -> String {
        struct Response: Decodable { let documentURL: String
            private enum CodingKeys: String, CodingKey { case documentURL = "document_url" }
        }
        let request = APIRequest.multipart(
            "/api/admin/store/receipts/upload",
            fileField: "file",
            fileName: fileName,
            mimeType: mimeType,
            fileData: data
        )
        let response: Response = try await api.send(request)
        return response.documentURL
    }

    /// Оплатить долг поставщику. Требует `store-billing.pay_debt`.
    ///
    /// `receiptURL` обязателен — см. `uploadPaymentReceipt`.
    public func payDebt(
        id: String,
        paidAt: String,
        method: String,
        receiptURL: String,
        comment: String?
    ) async throws {
        struct Body: Encodable {
            let paid_at: String
            let payment_method: String
            let receipt_file_url: String
            let comment: String?
        }
        let request = try APIRequest.json(
            "/api/admin/store/debts/\(id)/pay",
            body: Body(paid_at: paidAt, payment_method: method, receipt_file_url: receiptURL, comment: comment)
        )
        _ = try await api.send(request)
    }

    /// Списать долг без оплаты. Требует `store-billing.write_off_debt`.
    ///
    /// Причина обязательна: списание — это признание, что денег поставщик не
    /// получит, и через полгода никто не вспомнит, почему так решили.
    public func writeOffDebt(id: String, reason: String) async throws {
        struct Body: Encodable { let reason: String }
        let request = try APIRequest.json("/api/admin/store/debts/\(id)/write-off", body: Body(reason: reason))
        _ = try await api.send(request)
    }

    /// Перенести срок оплаты. Требует `store-billing.reschedule_debt`.
    public func rescheduleDebt(id: String, dueDate: String, reason: String?) async throws {
        struct Body: Encodable {
            let due_date: String
            let reason: String?
        }
        let request = try APIRequest.json(
            "/api/admin/store/debts/\(id)/due-date",
            method: .patch,
            body: Body(due_date: dueDate, reason: reason)
        )
        _ = try await api.send(request)
    }
}

extension String {
    /// Пустая строка из JSON — это отсутствие значения, а не значение.
    fileprivate var nilIfBlank: String? {
        trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : self
    }
}
