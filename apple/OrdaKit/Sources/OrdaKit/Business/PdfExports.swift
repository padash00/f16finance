import Foundation

// ── PDF с сервера ────────────────────────────────────────────────────────────
//
// Те же файлы, что скачивают на сайте: собирает сервер по данным журналов.
// Роуты сами зовут соседние API и пробрасывают Bearer-токен и организацию
// (`lib/server/forward-auth.ts`), поэтому работают и из приложения.

/// Параметры PDF отчёта ОПиУ по точке — как на сайте
/// (`app/(main)/profitability`, `branchParams`).
public struct PnlPdfQuery: Sendable, Equatable {
    public let companyID: String
    /// Месяцы `YYYY-MM`.
    public let fromMonth: String
    public let toMonth: String
    public let includeExtra: Bool
    public var includeCapex: Bool = true

    public init(companyID: String, fromMonth: String, toMonth: String, includeExtra: Bool) {
        self.companyID = companyID
        self.fromMonth = fromMonth
        self.toMonth = toMonth
        self.includeExtra = includeExtra
    }

    public var queryItems: [String: String] {
        var query = ["company_id": companyID, "from": fromMonth, "to": toMonth, "capex": includeCapex ? "1" : "0"]
        if includeExtra { query["include_extra"] = "1" }
        return query
    }
}

extension BusinessService {
    /// PDF ОПиУ одной точки. Требует `profitability.export_pdf`.
    public func pnlPDF(_ query: PnlPdfQuery) async throws -> Data {
        try await api.send(APIRequest(path: "/api/admin/profitability/pdf", query: query.queryItems))
    }

    /// PDF недельного акта. `planWeek` — понедельник следующей недели: для
    /// плана закупок, как присылает сайт. Требует `weekly-report.export_pdf`.
    public func weeklyActPDF(from: String, to: String, planWeek: String) async throws -> Data {
        try await api.send(APIRequest(
            path: "/api/admin/weekly-act/pdf",
            query: ["from": from, "to": to, "plan_week": planWeek]
        ))
    }
}
