import Foundation

/// Распознанная накладная.
///
/// Товар принимают у машины: коробки на полу, водитель ждёт, накладная в
/// руках. Набивать двадцать позиций пальцем по телефону в такой обстановке
/// никто не станет — приёмку отложат «на потом», и склад весь день будет
/// показывать вчерашние остатки. Снимок решает ровно это.
///
/// Сервер уже умеет разбирать накладную и сопоставлять позиции с каталогом:
/// тот же разбор работает на сайте и в Telegram. Приложение только приносит
/// фотографию и показывает, что вышло.
public struct ScannedInvoice: Decodable, Sendable {
    public let supplierName: String?
    public let invoiceNumber: String?
    /// `YYYY-MM-DD`.
    public let invoiceDate: String?
    public let totalAmount: Double
    public let matchedCount: Int
    public let unmatchedCount: Int
    public let items: [Item]

    public struct Item: Decodable, Sendable, Identifiable, Hashable {
        /// Как позиция названа в накладной.
        public let invoiceName: String
        public let quantity: Double
        public let unitCost: Double
        public let totalCost: Double
        public let barcode: String?
        /// Товар каталога, если сопоставился. `nil` — такого товара нет.
        public let matchedItemID: String?
        public let matchedItemName: String?
        /// Прошлая закупочная цена и насколько она изменилась. Подорожание
        /// видно до того, как товар лёг на склад, а не в конце месяца.
        public let lastUnitCost: Double?
        public let unitCostChangePct: Double?

        public var id: String { (matchedItemID ?? "") + "|" + invoiceName }
        public var isMatched: Bool { matchedItemID?.isEmpty == false }

        private enum CodingKeys: String, CodingKey {
            case quantity, barcode
            case invoiceName = "invoice_name"
            case unitCost = "unit_cost"
            case totalCost = "total_cost"
            case matchedItemID = "matched_item_id"
            case matchedItemName = "matched_item_name"
            case lastUnitCost = "last_unit_cost"
            case unitCostChangePct = "unit_cost_change_pct"
        }

        public init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            invoiceName = try c.decodeIfPresent(String.self, forKey: .invoiceName) ?? "Без названия"
            quantity = try c.decodeFlexibleDouble(forKey: .quantity) ?? 0
            unitCost = try c.decodeFlexibleDouble(forKey: .unitCost) ?? 0
            totalCost = try c.decodeFlexibleDouble(forKey: .totalCost) ?? 0
            barcode = try c.decodeIfPresent(String.self, forKey: .barcode)
            matchedItemID = try c.decodeIfPresent(String.self, forKey: .matchedItemID)
            matchedItemName = try c.decodeIfPresent(String.self, forKey: .matchedItemName)
            lastUnitCost = try c.decodeFlexibleDouble(forKey: .lastUnitCost)
            unitCostChangePct = try c.decodeFlexibleDouble(forKey: .unitCostChangePct)
        }
    }

    private enum CodingKeys: String, CodingKey {
        case items
        case supplierName = "supplier_name"
        case invoiceNumber = "invoice_number"
        case invoiceDate = "invoice_date"
        case totalAmount = "total_amount"
        case matchedCount = "matched_count"
        case unmatchedCount = "unmatched_count"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        supplierName = try c.decodeIfPresent(String.self, forKey: .supplierName)
        invoiceNumber = try c.decodeIfPresent(String.self, forKey: .invoiceNumber)
        invoiceDate = try c.decodeIfPresent(String.self, forKey: .invoiceDate)
        totalAmount = try c.decodeFlexibleDouble(forKey: .totalAmount) ?? 0
        matchedCount = try c.decodeIfPresent(Int.self, forKey: .matchedCount) ?? 0
        unmatchedCount = try c.decodeIfPresent(Int.self, forKey: .unmatchedCount) ?? 0
        items = try c.decodeIfPresent([Item].self, forKey: .items) ?? []
    }
}

public struct InvoiceScanService: Sendable {
    private let api: APIClient

    public init(api: APIClient) { self.api = api }

    /// Снимок накладной → разобранные позиции.
    ///
    /// Два шага, как и на сайте: сначала файл, потом разбор по ссылке. Разбор
    /// идёт на сервере и стоит денег, поэтому запускается один раз на снимок,
    /// а не при каждом открытии экрана.
    public func scan(imageData: Data, supplierID: String? = nil) async throws -> ScannedInvoice {
        let upload: UploadResult = try await api.send(
            APIRequest.multipart(
                "/api/admin/store/receipts/upload",
                fileField: "file",
                fileName: "invoice.jpg",
                mimeType: "image/jpeg",
                fileData: imageData
            )
        )

        var body: [String: Any] = ["invoice_file_url": upload.url]
        if let supplierID, !supplierID.isEmpty { body["supplier_id"] = supplierID }

        let parsed: Envelope = try await api.send(
            APIRequest(
                path: "/api/admin/store/receipts/ai-parse",
                method: .post,
                body: try JSONSerialization.data(withJSONObject: body)
            )
        )
        return parsed.data
    }

    /// Ответ загрузчика. Ключ `document_url` — как у сайта: маршрут общий.
    private struct UploadResult: Decodable, Sendable {
        let url: String

        private enum CodingKeys: String, CodingKey { case url = "document_url" }
    }

    private struct Envelope: Decodable, Sendable {
        let data: ScannedInvoice
    }
}
