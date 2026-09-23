import Testing
@testable import OrdaKit

@Suite("PDF с сервера")
struct PdfExportTests {
    @Test("ОПиУ: те же параметры, что шлёт сайт")
    func pnlQuery() {
        let query = PnlPdfQuery(companyID: "c1", fromMonth: "2026-08", toMonth: "2026-08", includeExtra: true)
        #expect(query.queryItems == ["company_id": "c1", "from": "2026-08", "to": "2026-08", "capex": "1", "include_extra": "1"])
        let plain = PnlPdfQuery(companyID: "c1", fromMonth: "2026-08", toMonth: "2026-09", includeExtra: false)
        #expect(plain.queryItems["include_extra"] == nil)
    }
}
