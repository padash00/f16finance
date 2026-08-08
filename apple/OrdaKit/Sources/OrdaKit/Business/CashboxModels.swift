import Foundation

// ── Чеки кассы: /api/pos/receipts ────────────────────────────────────────────
//
// Тип `Receipt` в модуле уже занят приёмкой склада, поэтому всё кассовое
// префиксуем `Pos`: чек продажи и приходная накладная — разные документы,
// и путать их в коде опаснее, чем писать четыре лишних символа.

/// Строка чека.
public struct PosReceiptLine: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let quantity: Double
    public let unitPrice: Double
    public let totalPrice: Double

    private struct NamedRef: Decodable { let name: String? }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString

        // Связь с каталогом приходит то объектом, то массивом, а у «универсальной»
        // позиции (пробили без карточки товара) её нет вовсе — тогда имя
        // хранится прямо в строке чека.
        let single = (try? c.decodeIfPresent(NamedRef.self, forKey: .inventoryItems)) ?? nil
        let many = (try? c.decodeIfPresent([NamedRef].self, forKey: .inventoryItems)) ?? nil
        let universal = try c.decodeFlexibleString(forKey: .universalName)
        name = single?.name ?? many?.first?.name ?? universal ?? "Товар"

        quantity = try c.decodeFlexibleDouble(forKey: .quantity) ?? 0
        unitPrice = try c.decodeFlexibleDouble(forKey: .unitPrice) ?? 0

        if let stored = try c.decodeFlexibleDouble(forKey: .totalPrice), stored != 0 {
            totalPrice = stored
        } else {
            totalPrice = quantity * unitPrice
        }
    }

    private enum CodingKeys: String, CodingKey {
        case id, quantity
        case universalName = "universal_name"
        case unitPrice = "unit_price"
        case totalPrice = "total_price"
        case inventoryItems = "inventory_items"
    }
}

/// Чем расплатились. Сервер хранит и метод, и суммы по каждому каналу;
/// метод бывает пустым у старых чеков, поэтому умеем выводить его из сумм.
public enum PosPaymentKind: String, Sendable, Hashable {
    case cash, kaspi, card, online, mixed

    public var label: String {
        switch self {
        case .cash: "Наличные"
        case .kaspi: "Безналичный"
        case .card: "Карта"
        case .online: "Онлайн"
        case .mixed: "Смешанный"
        }
    }

    public var icon: String {
        switch self {
        case .cash: "banknote.fill"
        case .kaspi: "qrcode"
        case .card: "creditcard.fill"
        case .online: "globe"
        case .mixed: "square.split.2x1.fill"
        }
    }
}

/// Чек продажи.
public struct PosReceipt: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let saleDate: Date?
    public let soldAt: Date?
    public let paymentMethod: String?
    public let cashAmount: Double
    public let kaspiAmount: Double
    public let cardAmount: Double
    public let onlineAmount: Double
    public let totalAmount: Double
    public let discountAmount: Double
    public let loyaltyPointsEarned: Double
    public let loyaltyPointsSpent: Double
    public let loyaltyDiscountAmount: Double
    public let customerID: String?
    public let source: String?
    public let comment: String?
    public let items: [PosReceiptLine]

    /// Номер, который напечатан на бумажном чеке и по которому ищут возврат.
    public var shortNumber: String { String(id.suffix(6)).uppercased() }

    /// Момент продажи. У части чеков время не пишется — тогда остаётся дата смены.
    public var occurredAt: Date? { soldAt ?? saleDate }

    public var paymentKind: PosPaymentKind {
        if let paymentMethod, let known = PosPaymentKind(rawValue: paymentMethod) { return known }
        let used = [
            cashAmount > 0 ? PosPaymentKind.cash : nil,
            kaspiAmount > 0 ? .kaspi : nil,
            cardAmount > 0 ? .card : nil,
            onlineAmount > 0 ? .online : nil,
        ].compactMap { $0 }
        if used.count == 1 { return used[0] }
        return used.isEmpty ? .cash : .mixed
    }

    /// Кто пробил чек. Имени кассира этот роут не отдаёт, но канал продажи
    /// различает кассу точки, оператора и самого владельца — а для вопроса
    /// «кто это провёл» разница между ними и есть главное.
    public var sourceLabel: String {
        switch source ?? "" {
        case "point-client": "Касса точки"
        case "operator-web": "Оператор (веб)"
        case "owner-web": "Владелец"
        case "web-pos": "Веб-касса"
        case "": "Канал не указан"
        case let other: other
        }
    }

    public var hasLoyalty: Bool {
        loyaltyPointsEarned > 0 || loyaltyPointsSpent > 0 || loyaltyDiscountAmount > 0
    }

    public var cashlessAmount: Double { kaspiAmount + cardAmount + onlineAmount }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        saleDate = DateParsing.date(from: try c.decodeFlexibleString(forKey: .saleDate))
        soldAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .soldAt))
        paymentMethod = try c.decodeFlexibleString(forKey: .paymentMethod)
        cashAmount = try c.decodeFlexibleDouble(forKey: .cashAmount) ?? 0
        kaspiAmount = try c.decodeFlexibleDouble(forKey: .kaspiAmount) ?? 0
        cardAmount = try c.decodeFlexibleDouble(forKey: .cardAmount) ?? 0
        onlineAmount = try c.decodeFlexibleDouble(forKey: .onlineAmount) ?? 0
        totalAmount = try c.decodeFlexibleDouble(forKey: .totalAmount) ?? 0
        discountAmount = try c.decodeFlexibleDouble(forKey: .discountAmount) ?? 0
        loyaltyPointsEarned = try c.decodeFlexibleDouble(forKey: .loyaltyPointsEarned) ?? 0
        loyaltyPointsSpent = try c.decodeFlexibleDouble(forKey: .loyaltyPointsSpent) ?? 0
        loyaltyDiscountAmount = try c.decodeFlexibleDouble(forKey: .loyaltyDiscountAmount) ?? 0
        customerID = try c.decodeFlexibleString(forKey: .customerID)
        source = try c.decodeFlexibleString(forKey: .source)
        comment = try c.decodeFlexibleString(forKey: .comment)
        items = (try? c.decodeIfPresent([PosReceiptLine].self, forKey: .items)) ?? []
    }

    private enum CodingKeys: String, CodingKey {
        case id, source, comment, items
        case saleDate = "sale_date"
        case soldAt = "sold_at"
        case paymentMethod = "payment_method"
        case cashAmount = "cash_amount"
        case kaspiAmount = "kaspi_amount"
        case cardAmount = "card_amount"
        case onlineAmount = "online_amount"
        case totalAmount = "total_amount"
        case discountAmount = "discount_amount"
        case loyaltyPointsEarned = "loyalty_points_earned"
        case loyaltyPointsSpent = "loyalty_points_spent"
        case loyaltyDiscountAmount = "loyalty_discount_amount"
        case customerID = "customer_id"
    }
}

/// Страница ответа `GET /api/pos/receipts` — поля лежат в корне рядом с `data`.
public struct PosReceiptPage: Decodable, Sendable {
    public let receipts: [PosReceipt]
    /// Сколько всего чеков попало в период — считает сервер, не мы.
    public let total: Int
    public let page: Int
    public let pageSize: Int

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        receipts = (try? c.decodeIfPresent([PosReceipt].self, forKey: .data)) ?? []
        total = Int(try c.decodeFlexibleDouble(forKey: .total) ?? 0)
        page = Int(try c.decodeFlexibleDouble(forKey: .page) ?? 1)
        let size = Int(try c.decodeFlexibleDouble(forKey: .pageSize) ?? 20)
        pageSize = size > 0 ? size : 20
    }

    private enum CodingKeys: String, CodingKey {
        case data, total, page
        case pageSize = "page_size"
    }
}

// ── Период выборки ───────────────────────────────────────────────────────────

/// Период, за который смотрят кассу.
///
/// Границы считаем по локальному календарю: сервер фильтрует по колонке
/// `sale_date` — это дата смены точки, а не момент UTC. В Казахстане (UTC+5)
/// «сегодня» по Гринвичу до пяти утра — это вчерашняя выручка.
public enum PosPeriod: String, CaseIterable, Identifiable, Sendable {
    case today, yesterday, week

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .today: "Сегодня"
        case .yesterday: "Вчера"
        case .week: "7 дней"
        }
    }

    /// Разрез внутри периода: один день читается по часам, неделя — по дням.
    public var isSingleDay: Bool { self != .week }

    public func range(now: Date = Date(), calendar: Calendar = .current) -> (from: String, to: String) {
        let today = calendar.startOfDay(for: now)
        switch self {
        case .today:
            let day = Self.dayString(today, calendar)
            return (day, day)
        case .yesterday:
            let yesterday = calendar.date(byAdding: .day, value: -1, to: today) ?? today
            let day = Self.dayString(yesterday, calendar)
            return (day, day)
        case .week:
            let start = calendar.date(byAdding: .day, value: -6, to: today) ?? today
            return (Self.dayString(start, calendar), Self.dayString(today, calendar))
        }
    }

    private static func dayString(_ date: Date, _ calendar: Calendar) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }
}

// ── Сводка по чекам ──────────────────────────────────────────────────────────

/// Итоги периода, посчитанные по загруженным чекам.
///
/// Сервер сумму за период не отдаёт — только страницы и общее количество,
/// поэтому складываем сами. Экран обязан сказать, если чеков в периоде больше,
/// чем удалось загрузить: сумма «почти за период» хуже честного «за 300 из 412».
public struct PosSalesSummary: Sendable, Hashable {
    public let revenue: Double
    public let count: Int
    public let cash: Double
    public let kaspi: Double
    public let card: Double
    public let online: Double
    public let discounts: Double
    public let loyaltyDiscounts: Double
    public let itemsSold: Double

    public var averageCheck: Double { count > 0 ? revenue / Double(count) : 0 }
    public var cashless: Double { kaspi + card + online }

    /// Доля безнала. `nil`, когда продаж нет — ноль процентов и «нет данных»
    /// это разные утверждения.
    public var cashlessShare: Double? {
        let paid = cash + cashless
        guard paid > 0 else { return nil }
        return cashless / paid
    }

    public init(_ receipts: [PosReceipt]) {
        revenue = receipts.reduce(0) { $0 + $1.totalAmount }
        count = receipts.count
        cash = receipts.reduce(0) { $0 + $1.cashAmount }
        kaspi = receipts.reduce(0) { $0 + $1.kaspiAmount }
        card = receipts.reduce(0) { $0 + $1.cardAmount }
        online = receipts.reduce(0) { $0 + $1.onlineAmount }
        discounts = receipts.reduce(0) { $0 + $1.discountAmount }
        loyaltyDiscounts = receipts.reduce(0) { $0 + $1.loyaltyDiscountAmount }
        itemsSold = receipts.reduce(0.0) { total, receipt in
            total + receipt.items.reduce(0.0) { sum, line in sum + line.quantity }
        }
    }
}

/// Столбец разреза продаж — час дня или день недели.
public struct PosSalesBucket: Identifiable, Sendable, Hashable {
    public let id: String
    public let label: String
    public let amount: Double
    public let count: Int
}

/// Доля канала продажи в выручке.
public struct PosSourceShare: Identifiable, Sendable, Hashable {
    public var id: String { label }
    public let label: String
    public let amount: Double
    public let count: Int
}

extension PosSalesSummary {
    /// Разрез по часам (для одного дня) или по дням (для недели).
    ///
    /// Пустые часы в середине оставляем — провал в середине дня и есть то,
    /// ради чего на график смотрят. А вот часы до открытия и после закрытия
    /// отбрасываем: двадцать четыре столбца, из которых восемь всегда нулевые,
    /// только сжимают полезную часть.
    public static func buckets(
        _ receipts: [PosReceipt],
        byHour: Bool,
        calendar: Calendar = .current
    ) -> [PosSalesBucket] {
        let dated = receipts.compactMap { receipt -> (Date, PosReceipt)? in
            guard let date = receipt.occurredAt else { return nil }
            return (date, receipt)
        }
        guard !dated.isEmpty else { return [] }

        if byHour {
            var amounts = [Int: Double]()
            var counts = [Int: Int]()
            for (date, receipt) in dated {
                let hour = calendar.component(.hour, from: date)
                amounts[hour, default: 0] += receipt.totalAmount
                counts[hour, default: 0] += 1
            }
            guard let first = amounts.keys.min(), let last = amounts.keys.max() else { return [] }
            return (first...last).map { hour in
                PosSalesBucket(
                    id: "h\(hour)",
                    label: String(format: "%02d", hour),
                    amount: amounts[hour] ?? 0,
                    count: counts[hour] ?? 0
                )
            }
        }

        var amounts = [Date: Double]()
        var counts = [Date: Int]()
        for (date, receipt) in dated {
            let day = calendar.startOfDay(for: date)
            amounts[day, default: 0] += receipt.totalAmount
            counts[day, default: 0] += 1
        }
        return amounts.keys.sorted().map { day in
            PosSalesBucket(
                id: "d\(Int(day.timeIntervalSince1970))",
                label: day.formatted(.dateTime.day().month(.abbreviated)),
                amount: amounts[day] ?? 0,
                count: counts[day] ?? 0
            )
        }
    }

    /// Каналы продажи, от большего к меньшему.
    public static func sources(_ receipts: [PosReceipt]) -> [PosSourceShare] {
        var amounts = [String: Double]()
        var counts = [String: Int]()
        for receipt in receipts {
            amounts[receipt.sourceLabel, default: 0] += receipt.totalAmount
            counts[receipt.sourceLabel, default: 0] += 1
        }
        return amounts
            .map { PosSourceShare(label: $0.key, amount: $0.value, count: counts[$0.key] ?? 0) }
            .sorted { $0.amount > $1.amount }
    }
}

// ── Возврат: /api/pos/return ─────────────────────────────────────────────────

/// Строка чека, доступная к возврату.
public struct PosReturnLine: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let itemID: String?
    public let universalName: String?
    public let name: String
    public let quantity: Double
    public let unitPrice: Double
    /// Сколько по этой строке уже вернули раньше — сервер считает сам.
    public let returnedQuantity: Double
    public let returnableQuantity: Double

    public var isFullyReturned: Bool { returnableQuantity <= 0 }

    private struct NamedRef: Decodable { let name: String? }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        itemID = try c.decodeFlexibleString(forKey: .itemID)
        universalName = try c.decodeFlexibleString(forKey: .universalName)

        let single = (try? c.decodeIfPresent(NamedRef.self, forKey: .inventoryItems)) ?? nil
        let many = (try? c.decodeIfPresent([NamedRef].self, forKey: .inventoryItems)) ?? nil
        name = single?.name ?? many?.first?.name ?? universalName ?? "Товар"

        quantity = try c.decodeFlexibleDouble(forKey: .quantity) ?? 0
        unitPrice = try c.decodeFlexibleDouble(forKey: .unitPrice) ?? 0
        returnedQuantity = try c.decodeFlexibleDouble(forKey: .returnedQuantity) ?? 0

        // Поля может не быть у старого ответа — тогда к возврату доступно всё,
        // что продано: сервер всё равно перепроверит и не даст вернуть лишнее.
        returnableQuantity = try c.decodeFlexibleDouble(forKey: .returnableQuantity)
            ?? max(quantity - returnedQuantity, 0)
    }

    private enum CodingKeys: String, CodingKey {
        case id, quantity
        case itemID = "item_id"
        case universalName = "universal_name"
        case unitPrice = "unit_price"
        case returnedQuantity = "returned_qty"
        case returnableQuantity = "returnable_qty"
        case inventoryItems = "inventory_items"
    }
}

/// Чек, найденный для оформления возврата.
public struct PosSaleForReturn: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let saleDate: Date?
    public let soldAt: Date?
    public let totalAmount: Double
    public let paymentMethod: String?
    public let cashAmount: Double
    public let kaspiAmount: Double
    public let cardAmount: Double
    public let onlineAmount: Double
    public let items: [PosReturnLine]

    public var shortNumber: String { String(id.suffix(6)).uppercased() }
    public var occurredAt: Date? { soldAt ?? saleDate }

    public var paymentKind: PosPaymentKind {
        if let paymentMethod, let known = PosPaymentKind(rawValue: paymentMethod) { return known }
        return cashAmount > 0 && kaspiAmount > 0 ? .mixed : (cashAmount > 0 ? .cash : .kaspi)
    }

    /// Строки, которые ещё можно вернуть.
    public var returnable: [PosReturnLine] { items.filter { !$0.isFullyReturned } }

    /// Возврат по этому чеку уже был.
    public var hasPreviousReturns: Bool { items.contains { $0.returnedQuantity > 0 } }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        saleDate = DateParsing.date(from: try c.decodeFlexibleString(forKey: .saleDate))
        soldAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .soldAt))
        totalAmount = try c.decodeFlexibleDouble(forKey: .totalAmount) ?? 0
        paymentMethod = try c.decodeFlexibleString(forKey: .paymentMethod)
        cashAmount = try c.decodeFlexibleDouble(forKey: .cashAmount) ?? 0
        kaspiAmount = try c.decodeFlexibleDouble(forKey: .kaspiAmount) ?? 0
        cardAmount = try c.decodeFlexibleDouble(forKey: .cardAmount) ?? 0
        onlineAmount = try c.decodeFlexibleDouble(forKey: .onlineAmount) ?? 0
        items = (try? c.decodeIfPresent([PosReturnLine].self, forKey: .items)) ?? []
    }

    private enum CodingKeys: String, CodingKey {
        case id, items
        case saleDate = "sale_date"
        case soldAt = "sold_at"
        case totalAmount = "total_amount"
        case paymentMethod = "payment_method"
        case cashAmount = "cash_amount"
        case kaspiAmount = "kaspi_amount"
        case cardAmount = "card_amount"
        case onlineAmount = "online_amount"
    }
}

/// Черновик возврата: что именно возвращаем и почему.
public struct PosReturnDraft: Sendable {
    public struct Line: Sendable, Hashable {
        public let itemID: String?
        public let universalName: String?
        public let quantity: Double
        public let unitPrice: Double

        public init(itemID: String?, universalName: String?, quantity: Double, unitPrice: Double) {
            self.itemID = itemID
            self.universalName = universalName
            self.quantity = quantity
            self.unitPrice = unitPrice
        }
    }

    public let saleID: String
    public let lines: [Line]
    public let reason: String

    public init(saleID: String, lines: [Line], reason: String) {
        self.saleID = saleID
        self.lines = lines
        self.reason = reason
    }

    public var amount: Double {
        lines.reduce(0) { $0 + $1.quantity * $1.unitPrice }
    }

    public func requestBody() -> [String: Any] {
        var body: [String: Any] = [
            "sale_id": saleID,
            "items": lines.map { line -> [String: Any] in
                var item: [String: Any] = ["quantity": line.quantity, "unit_price": line.unitPrice]
                item["item_id"] = line.itemID ?? NSNull()
                item["universal_name"] = line.universalName ?? NSNull()
                return item
            },
        ]
        let trimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        body["reason"] = trimmed.isEmpty ? NSNull() : trimmed
        return body
    }
}

/// Результат оформленного возврата.
public struct PosReturnResult: Decodable, Sendable {
    public let id: String
    public let amount: Double

    public var number: String { String(id.suffix(12)).uppercased() }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        amount = try c.decodeFlexibleDouble(forKey: .amount) ?? 0
    }

    private enum CodingKeys: String, CodingKey {
        case id = "return_id"
        case amount = "return_amount"
    }
}

// ── Реквизиты чека ККМ: /api/admin/store/receipt-settings ────────────────────

/// Реквизиты фискального чека точки.
///
/// Состав полей продиктован приказом Минфина РК №626: чек без наименования
/// налогоплательщика, БИН, адреса, номеров ККМ и данных ОФД считается
/// невыданным со всеми последствиями для владельца.
public struct ReceiptSettings: Decodable, Sendable, Hashable {
    public let companyID: String?
    public let taxPayerName: String
    public let taxPayerBIN: String
    public let pointAddress: String
    public let kkmFactoryNumber: String
    public let kkmRegistrationNumber: String
    public let isVatPayer: Bool
    public let vatRate: Double
    public let ofdName: String
    public let ofdCheckURL: String
    public let receiptLanguage: String
    public let footerText: String
    public let requireBuyerIIN: Bool
    public let markingEnabled: Bool
    public let nktEnabled: Bool
    public let reviewURL: String

    public var languageLabel: String {
        switch receiptLanguage {
        case "kk": "Қазақша"
        case "both": "Два языка"
        default: "Русский"
        }
    }

    /// Обязательный реквизит и его текущее состояние.
    public struct Requirement: Identifiable, Sendable, Hashable {
        public let id: String
        public let title: String
        public let value: String
        public var isFilled: Bool { !value.isEmpty }
    }

    /// Реквизиты, без которых чек не соответствует приказу №626.
    public var requirements: [Requirement] {
        [
            Requirement(id: "name", title: "Налогоплательщик", value: taxPayerName),
            Requirement(id: "bin", title: "БИН / ИИН", value: taxPayerBIN),
            Requirement(id: "address", title: "Адрес точки", value: pointAddress),
            Requirement(id: "factory", title: "Заводской номер ККМ", value: kkmFactoryNumber),
            Requirement(id: "registration", title: "Регистрационный номер ККМ", value: kkmRegistrationNumber),
            Requirement(id: "ofd", title: "Оператор фискальных данных", value: ofdName),
            Requirement(id: "ofd-url", title: "Адрес проверки чека", value: ofdCheckURL),
        ]
    }

    public var missing: [Requirement] { requirements.filter { !$0.isFilled } }
    public var isCompliant: Bool { missing.isEmpty }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        companyID = try c.decodeFlexibleString(forKey: .companyID)
        taxPayerName = try c.decodeFlexibleString(forKey: .taxPayerName) ?? ""
        taxPayerBIN = try c.decodeFlexibleString(forKey: .taxPayerBIN) ?? ""
        pointAddress = try c.decodeFlexibleString(forKey: .pointAddress) ?? ""
        kkmFactoryNumber = try c.decodeFlexibleString(forKey: .kkmFactoryNumber) ?? ""
        kkmRegistrationNumber = try c.decodeFlexibleString(forKey: .kkmRegistrationNumber) ?? ""
        isVatPayer = try c.decodeIfPresent(Bool.self, forKey: .isVatPayer) ?? false
        vatRate = try c.decodeFlexibleDouble(forKey: .vatRate) ?? 12
        ofdName = try c.decodeFlexibleString(forKey: .ofdName) ?? ""
        ofdCheckURL = try c.decodeFlexibleString(forKey: .ofdCheckURL) ?? ""
        receiptLanguage = try c.decodeFlexibleString(forKey: .receiptLanguage) ?? "ru"
        footerText = try c.decodeFlexibleString(forKey: .footerText) ?? ""
        requireBuyerIIN = try c.decodeIfPresent(Bool.self, forKey: .requireBuyerIIN) ?? false
        markingEnabled = try c.decodeIfPresent(Bool.self, forKey: .markingEnabled) ?? false
        nktEnabled = try c.decodeIfPresent(Bool.self, forKey: .nktEnabled) ?? false
        reviewURL = try c.decodeFlexibleString(forKey: .reviewURL) ?? ""
    }

    private enum CodingKeys: String, CodingKey {
        case companyID = "company_id"
        case taxPayerName = "tax_payer_name"
        case taxPayerBIN = "tax_payer_bin"
        case pointAddress = "point_address"
        case kkmFactoryNumber = "kkm_factory_number"
        case kkmRegistrationNumber = "kkm_registration_number"
        case isVatPayer = "is_vat_payer"
        case vatRate = "vat_rate"
        case ofdName = "ofd_name"
        case ofdCheckURL = "ofd_check_url"
        case receiptLanguage = "receipt_language"
        case footerText = "receipt_footer_text"
        case requireBuyerIIN = "require_buyer_iin"
        case markingEnabled = "marking_enabled"
        case nktEnabled = "nkt_enabled"
        case reviewURL = "review_url"
    }
}

/// Ответ роута реквизитов: список точек и настройки выбранной.
public struct ReceiptSettingsPayload: Decodable, Sendable {
    public let companies: [Company]
    /// `nil`, когда доступных точек нет вовсе — это не ошибка загрузки.
    public let settings: ReceiptSettings?

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        companies = (try? c.decodeIfPresent([Company].self, forKey: .companies)) ?? []
        settings = (try? c.decodeIfPresent(ReceiptSettings.self, forKey: .settings)) ?? nil
    }

    private enum CodingKeys: String, CodingKey { case companies, settings }
}

// ── Реклама на экране покупателя: /api/admin/advertising ─────────────────────

/// Ролик или картинка в плейлисте экрана покупателя.
public struct AdSlide: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let companyID: String
    public let mediaType: String
    public let url: String
    public let title: String?
    /// Только у картинок: видео крутится целиком, и длительность его файла
    /// серверу неизвестна.
    public let durationSec: Double?
    public let sortOrder: Int
    /// Меняется прямо в списке после успешного PATCH — перезагружать весь
    /// плейлист ради одного переключателя незачем.
    public var isActive: Bool
    public let updatedAt: Date?

    public var isVideo: Bool { mediaType == "video" }

    public var displayTitle: String {
        if let title, !title.isEmpty { return title }
        return isVideo ? "Видео без названия" : "Картинка без названия"
    }

    public var durationLabel: String {
        if isVideo { return "видео целиком" }
        guard let durationSec, durationSec > 0 else { return "8 с" }
        return "\(Int(durationSec)) с"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        companyID = try c.decodeFlexibleString(forKey: .companyID) ?? ""
        mediaType = try c.decodeFlexibleString(forKey: .mediaType) ?? "image"
        url = try c.decodeFlexibleString(forKey: .url) ?? ""
        title = try c.decodeFlexibleString(forKey: .title)
        durationSec = try c.decodeFlexibleDouble(forKey: .durationSec)
        sortOrder = Int(try c.decodeFlexibleDouble(forKey: .sortOrder) ?? 0)
        isActive = try c.decodeIfPresent(Bool.self, forKey: .isActive) ?? true
        updatedAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .updatedAt))
    }

    private enum CodingKeys: String, CodingKey {
        case id, url, title
        case companyID = "company_id"
        case mediaType = "media_type"
        case durationSec = "duration_sec"
        case sortOrder = "sort_order"
        case isActive = "is_active"
        case updatedAt = "updated_at"
    }
}

/// Плейлист одной точки.
public struct AdPlaylist: Identifiable, Sendable, Hashable {
    public let companyID: String
    public let companyName: String
    public let slides: [AdSlide]

    public var id: String { companyID }
    public var active: [AdSlide] { slides.filter(\.isActive) }

    /// Длина круга по активным картинкам. Видео сюда не входит — его
    /// длительность сервер не хранит, а выдумывать её нельзя.
    public var imageLoopSeconds: Double {
        active.filter { !$0.isVideo }.reduce(0) { $0 + ($1.durationSec ?? 8) }
    }

    public var hasVideo: Bool { active.contains(where: \.isVideo) }

    /// Экран покупателя показывает пустоту — точка молчит вместо того, чтобы
    /// продавать.
    public var isSilent: Bool { active.isEmpty }

    public static func group(slides: [AdSlide], companies: [Company]) -> [AdPlaylist] {
        let names = Dictionary(companies.map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first })
        let grouped = Dictionary(grouping: slides, by: \.companyID)
        return grouped
            .map { companyID, slides in
                AdPlaylist(
                    companyID: companyID,
                    companyName: names[companyID] ?? "Точка",
                    slides: slides.sorted { $0.sortOrder < $1.sortOrder }
                )
            }
            .sorted { $0.companyName.localizedCaseInsensitiveCompare($1.companyName) == .orderedAscending }
    }
}

// ── Сервис кассы ─────────────────────────────────────────────────────────────

/// Чеки, возвраты, реквизиты ККМ и реклама на экране покупателя.
public struct CashboxService: Sendable {
    private let api: APIClient

    public init(api: APIClient) {
        self.api = api
    }

    // ── Чеки ─────────────────────────────────────────────────────────────────

    /// Страница чеков за период. Требует `pos-receipts.view`.
    ///
    /// Параметр `search` роут применяет уже после нарезки на страницы, поэтому
    /// сюда его не передаём: искать по загруженному списку и точнее, и честнее.
    public func receipts(period: PosPeriod, companyID: String?, page: Int) async throws -> PosReceiptPage {
        let range = period.range()
        var query = ["date_from": range.from, "date_to": range.to, "page": String(page)]
        if let companyID, !companyID.isEmpty { query["company_id"] = companyID }
        return try await api.send(APIRequest(path: "/api/pos/receipts", query: query))
    }

    // ── Возврат ──────────────────────────────────────────────────────────────

    /// Найти чек для возврата по номеру с бумажного чека или полному id.
    public func saleForReturn(number: String) async throws -> PosSaleForReturn {
        let trimmed = number.trimmingCharacters(in: .whitespacesAndNewlines)
        let isFullID = trimmed.count == 36 && trimmed.contains("-")
        let key = isFullID ? "sale_id" : "short_id"
        let response: Envelope<PosSaleForReturn> = try await api.send(
            APIRequest(path: "/api/pos/return", query: [key: trimmed])
        )
        return response.data
    }

    /// Оформить возврат. Требует `pos-returns.return`.
    ///
    /// Деньги сервер возвращает тем же способом, каким платил клиент, и сам
    /// раскладывает сумму по каналам оплаты — на клиенте это не считается.
    public func createReturn(_ draft: PosReturnDraft) async throws -> PosReturnResult {
        let response: Envelope<PosReturnResult> = try await api.send(
            APIRequest(
                path: "/api/pos/return",
                method: .post,
                body: try JSONSerialization.data(withJSONObject: draft.requestBody())
            )
        )
        return response.data
    }

    // ── Реквизиты чека ───────────────────────────────────────────────────────

    /// Реквизиты ККМ точки. Без `companyID` сервер отдаёт первую доступную.
    /// Требует `store-receipt-settings.view`.
    public func receiptSettings(companyID: String? = nil) async throws -> ReceiptSettingsPayload {
        var query: [String: String] = [:]
        if let companyID, !companyID.isEmpty { query["company_id"] = companyID }
        let response: Envelope<ReceiptSettingsPayload> = try await api.send(
            APIRequest(path: "/api/admin/store/receipt-settings", query: query)
        )
        return response.data
    }

    // ── Реклама ──────────────────────────────────────────────────────────────

    /// Плейлисты всех доступных точек. Требует `store-advertising.view`.
    public func advertising() async throws -> [AdSlide] {
        let response: DataList<AdSlide> = try await api.send(APIRequest(path: "/api/admin/advertising"))
        return response.items
    }

    /// Включить или выключить ролик. Требует `store-advertising.edit`.
    public func setSlideActive(id: String, isActive: Bool) async throws {
        _ = try await api.send(
            APIRequest(
                path: "/api/admin/advertising",
                method: .patch,
                body: try JSONSerialization.data(withJSONObject: ["id": id, "is_active": isActive])
            )
        )
    }

    /// Удалить ролик вместе с файлом. Требует `store-advertising.delete`.
    public func deleteSlide(id: String) async throws {
        _ = try await api.send(
            APIRequest(path: "/api/admin/advertising", method: .delete, query: ["id": id])
        )
    }
}
