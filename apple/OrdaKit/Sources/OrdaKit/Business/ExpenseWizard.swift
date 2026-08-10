import Foundation

// ── Заведение расхода ────────────────────────────────────────────────────────
//
// Расход, в отличие от дохода, нельзя записать одним запросом: сервер отвечает
// на `createExpense` отказом 410 и требует мастер. Причина не в технике —
// каждый расход обязан быть подтверждён документом, и порядок шагов нужен,
// чтобы файл был привязан к записи до того, как она появится.
//
//   POST   /api/admin/expenses/wizard          — открыть сессию
//   POST   /api/admin/expenses/wizard/upload   — приложить документ
//   PATCH  /api/admin/expenses/wizard          — сохранить поля
//   POST   /api/admin/expenses/wizard/submit   — создать расход
//
// Телефон здесь уместнее ноутбука: чек фотографируют там же, где платят.

/// Чем подтверждён расход.
public enum ExpenseDocumentKind: String, Sendable, CaseIterable, Identifiable {
    case receipt
    case invoice
    case bill
    /// Доверенный поставщик: документ не нужен, достаточно записи в списке доверенных.
    case whitelist
    /// Разовый платёж без документа — с получателем и объяснением.
    case oneOff = "one_off"

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .receipt: "Чек"
        case .invoice: "Накладная"
        case .bill: "Счёт"
        case .whitelist: "Доверенный поставщик"
        case .oneOff: "Разовый платёж"
        }
    }

    /// Нужен ли приложенный файл.
    public var requiresFile: Bool {
        switch self {
        case .receipt, .invoice, .bill: true
        case .whitelist, .oneOff: false
        }
    }
}

/// Что заполняет владелец. Отправляется в сессию мастера целиком.
public struct ExpenseDraft: Sendable, Equatable {
    /// `YYYY-MM-DD`.
    public var date: String
    public var companyID: String
    public var operatorID: String?
    public var categoryID: String
    public var categoryName: String
    public var amountCash: Double
    public var amountKaspi: Double
    /// Короткое название: что именно купили.
    public var itemName: String
    public var comment: String
    public var documentKind: ExpenseDocumentKind
    public var documentURLs: [String]
    public var whitelistVendorID: String?
    public var oneOffPayee: String
    public var oneOffReason: String
    /// Подтверждение, что расход правда старый: сервер требует его для дат
    /// старше недели.
    public var backdatedConfirmed: Bool

    public init(date: String, companyID: String = "") {
        self.date = date
        self.companyID = companyID
        operatorID = nil
        categoryID = ""
        categoryName = ""
        amountCash = 0
        amountKaspi = 0
        itemName = ""
        comment = ""
        documentKind = .receipt
        documentURLs = []
        whitelistVendorID = nil
        oneOffPayee = ""
        oneOffReason = ""
        backdatedConfirmed = false
    }

    public var total: Double { amountCash + amountKaspi }

    /// Требуется ли подтверждение задним числом: старше семи суток.
    public static func isBackdated(_ date: Date, now: Date = Date()) -> Bool {
        date < now.addingTimeInterval(-7 * 24 * 60 * 60)
    }

    /// Что мешает отправить. Формулировки — серверные: человек должен получить
    /// один и тот же ответ независимо от того, где сработала проверка.
    ///
    /// Мастер отвергает расход уже после загрузки файла и трёх шагов, поэтому
    /// повторение проверок на клиенте здесь не перестраховка, а единственный
    /// способ не потратить чужое время впустую.
    public var validationMessage: String? {
        if date.isEmpty { return "Дата обязательна" }
        if companyID.isEmpty { return "Точка обязательна" }
        if categoryID.isEmpty || categoryName.isEmpty { return "Категория обязательна" }
        if itemName.trimmingCharacters(in: .whitespacesAndNewlines).count < 5 {
            return "Краткое название обязательно (≥ 5 символов)"
        }
        if comment.trimmingCharacters(in: .whitespacesAndNewlines).count < 20 {
            return "Комментарий обязателен (≥ 20 символов)"
        }
        if amountCash < 0 || amountKaspi < 0 { return "Сумма не может быть отрицательной" }
        if total <= 0 { return "Сумма расхода обязательна" }

        switch documentKind {
        case .receipt, .invoice, .bill:
            if documentURLs.isEmpty { return "Прикрепите чек/накладную" }
        case .whitelist:
            if (whitelistVendorID ?? "").isEmpty { return "Выберите доверенного поставщика" }
        case .oneOff:
            if oneOffPayee.trimmingCharacters(in: .whitespacesAndNewlines).count < 3 {
                return "Укажите получателя (≥ 3 символов)"
            }
            if oneOffReason.trimmingCharacters(in: .whitespacesAndNewlines).count < 30 {
                return "Опишите причину отсутствия документа (≥ 30 символов)"
            }
        }
        return nil
    }

    public var isValid: Bool { validationMessage == nil }

    /// Тело для шага мастера.
    func payload() -> ExpenseWizardPayload {
        ExpenseWizardPayload(
            date: date,
            companyID: companyID,
            operatorID: operatorID?.isEmpty == false ? operatorID : nil,
            categoryID: categoryID,
            categoryName: categoryName,
            amountCash: amountCash,
            amountKaspi: amountKaspi,
            itemName: itemName.trimmingCharacters(in: .whitespacesAndNewlines),
            comment: comment.trimmingCharacters(in: .whitespacesAndNewlines),
            backdatedConfirmed: backdatedConfirmed,
            documentKind: documentKind.rawValue,
            documentURLs: documentURLs,
            documentURL: documentURLs.first,
            whitelistVendorID: documentKind == .whitelist ? whitelistVendorID : nil,
            oneOffPayee: documentKind == .oneOff ? oneOffPayee.trimmingCharacters(in: .whitespacesAndNewlines) : nil,
            oneOffReason: documentKind == .oneOff ? oneOffReason.trimmingCharacters(in: .whitespacesAndNewlines) : nil
        )
    }
}

struct ExpenseWizardPayload: Encodable {
    let date: String
    let companyID: String
    let operatorID: String?
    let categoryID: String
    let categoryName: String
    let amountCash: Double
    let amountKaspi: Double
    let itemName: String
    let comment: String
    let backdatedConfirmed: Bool
    let documentKind: String
    let documentURLs: [String]
    let documentURL: String?
    let whitelistVendorID: String?
    let oneOffPayee: String?
    let oneOffReason: String?

    /// Пишем и пустые поля явным `null`, а не пропускаем их.
    ///
    /// Шаг мастера на сервере — это слияние: `{...сохранённое, ...присланное}`.
    /// Пропущенный ключ означает «оставить как было», и получатель разового
    /// платежа пережил бы смену типа документа на чек, оставшись в записи
    /// мусором, который потом читают при разборе.
    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(date, forKey: .date)
        try c.encode(companyID, forKey: .companyID)
        try c.encode(operatorID, forKey: .operatorID)
        try c.encode(categoryID, forKey: .categoryID)
        try c.encode(categoryName, forKey: .categoryName)
        try c.encode(amountCash, forKey: .amountCash)
        try c.encode(amountKaspi, forKey: .amountKaspi)
        try c.encode(itemName, forKey: .itemName)
        try c.encode(comment, forKey: .comment)
        try c.encode(backdatedConfirmed, forKey: .backdatedConfirmed)
        try c.encode(documentKind, forKey: .documentKind)
        try c.encode(documentURLs, forKey: .documentURLs)
        try c.encode(documentURL, forKey: .documentURL)
        try c.encode(whitelistVendorID, forKey: .whitelistVendorID)
        try c.encode(oneOffPayee, forKey: .oneOffPayee)
        try c.encode(oneOffReason, forKey: .oneOffReason)
    }

    enum CodingKeys: String, CodingKey {
        case date, comment
        case companyID = "company_id"
        case operatorID = "operator_id"
        case categoryID = "category_id"
        case categoryName = "category_name"
        case amountCash = "amount_cash"
        case amountKaspi = "amount_kaspi"
        case itemName = "item_name"
        case backdatedConfirmed = "backdated_confirmed"
        case documentKind = "document_kind"
        case documentURLs = "document_urls"
        case documentURL = "document_url"
        case whitelistVendorID = "whitelist_vendor_id"
        case oneOffPayee = "one_off_payee"
        case oneOffReason = "one_off_reason"
    }
}

struct ExpenseWizardStepRequest: Encodable {
    let sessionID: String
    let step: Int
    let payload: ExpenseWizardPayload

    enum CodingKeys: String, CodingKey {
        case step, payload
        case sessionID = "session_id"
    }
}

struct ExpenseWizardSubmitRequest: Encodable {
    let sessionID: String

    enum CodingKeys: String, CodingKey { case sessionID = "session_id" }
}

struct ExpenseWizardSession: Decodable, Sendable {
    let id: String

    private enum Outer: String, CodingKey { case data }
    private enum Inner: String, CodingKey { case id }

    init(from decoder: any Decoder) throws {
        let outer = try decoder.container(keyedBy: Outer.self)
        let inner = try outer.nestedContainer(keyedBy: Inner.self, forKey: .data)
        id = try inner.decodeFlexibleString(forKey: .id) ?? ""
    }
}

struct ExpenseUploadResult: Decodable, Sendable {
    let documentURLs: [String]

    private enum CodingKeys: String, CodingKey { case documentURLs = "document_urls" }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        documentURLs = try c.decodeIfPresent([String].self, forKey: .documentURLs) ?? []
    }
}

/// Доверенный поставщик: платёж ему не требует документа.
public struct ExpenseVendor: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let defaultCategoryID: String?
    public let companyID: String?

    private enum CodingKeys: String, CodingKey {
        case id
        case name = "vendor_name"
        case defaultCategoryID = "default_category_id"
        case companyID = "company_id"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? ""
        name = try c.decodeFlexibleString(forKey: .name) ?? "Без названия"
        defaultCategoryID = try c.decodeFlexibleString(forKey: .defaultCategoryID)
        companyID = try c.decodeFlexibleString(forKey: .companyID)
    }
}

/// Мастер расхода целиком.
public struct ExpenseWizardService: Sendable {
    private let api: APIClient
    public init(api: APIClient) { self.api = api }

    public func categories() async throws -> [ExpenseCategory] {
        let response: DataList<ExpenseCategory> = try await api.send(
            APIRequest(path: "/api/admin/expense-categories")
        )
        return response.items
    }

    public func vendors() async throws -> [ExpenseVendor] {
        let response: DataList<ExpenseVendor> = try await api.send(
            APIRequest(path: "/api/admin/expenses/whitelist")
        )
        return response.items
    }

    /// Открыть сессию. Она живёт ограниченное время и одноразовая.
    public func startSession() async throws -> String {
        let response: ExpenseWizardSession = try await api.send(
            APIRequest(path: "/api/admin/expenses/wizard", method: .post, body: Data("{}".utf8))
        )
        return response.id
    }

    /// Приложить документ. Возвращает все ссылки сессии, включая прежние.
    public func upload(
        sessionID: String,
        fileData: Data,
        fileName: String,
        mimeType: String
    ) async throws -> [String] {
        let response: ExpenseUploadResult = try await api.send(
            APIRequest.multipart(
                "/api/admin/expenses/wizard/upload",
                fields: ["session_id": sessionID],
                fileField: "file",
                fileName: fileName,
                mimeType: mimeType,
                fileData: fileData
            )
        )
        return response.documentURLs
    }

    /// Сохранить поля в сессии и создать расход.
    ///
    /// Шаг и отправка идут подряд: разбивать их на два действия человека
    /// незачем — форма на телефоне и так одна.
    public func submit(sessionID: String, draft: ExpenseDraft) async throws {
        let step = try JSONEncoder().encode(
            ExpenseWizardStepRequest(sessionID: sessionID, step: 3, payload: draft.payload())
        )
        _ = try await api.send(
            APIRequest(path: "/api/admin/expenses/wizard", method: .patch, body: step)
        )

        let submit = try JSONEncoder().encode(ExpenseWizardSubmitRequest(sessionID: sessionID))
        _ = try await api.send(
            APIRequest(path: "/api/admin/expenses/wizard/submit", method: .post, body: submit)
        )
    }
}
