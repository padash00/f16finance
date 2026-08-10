import Foundation
import Testing

@testable import OrdaKit

/// Что именно уходит на сервер.
///
/// Причина этого файла конкретная. Роут `/api/admin/salary` обслуживает три
/// представления и различает их параметром `view`; приложение его не слало и
/// получало `unsupported-view` 400 — раздел зарплат не открывался вообще.
/// Модель при этом была написана верно, сборка проходила, тесты проходили:
/// ошибка жила ровно в одной строке сборки запроса, которую ничто не проверяло.
///
/// Здесь мы перехватываем запрос до сети и смотрим на итоговый адрес.
// `.serialized` обязателен: перехватчик хранит последний URL в статическом
// поле, а параллельные тесты перезаписывали бы его друг у друга.
@Suite("Контракты запросов", .serialized)
struct RequestContractTests {
    /// Перехватчик: запоминает URL и отвечает заранее заготовленным телом.
    private final class Interceptor: URLProtocol, @unchecked Sendable {
        nonisolated(unsafe) static var lastURL: URL?
        nonisolated(unsafe) static var body = Data("{}".utf8)

        override class func canInit(with request: URLRequest) -> Bool { true }
        override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

        override func startLoading() {
            Interceptor.lastURL = request.url
            let response = HTTPURLResponse(
                url: request.url ?? URL(string: "https://example.com")!,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Interceptor.body)
            client?.urlProtocolDidFinishLoading(self)
        }

        override func stopLoading() {}
    }

    private struct NoToken: TokenProvider {
        func currentAccessToken() async -> String? { nil }
        func refreshAccessToken() async throws -> String? { nil }
    }

    private func service(responding body: String) -> BusinessService {
        Interceptor.body = Data(body.utf8)
        Interceptor.lastURL = nil

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [Interceptor.self]

        let client = APIClient(
            baseURL: URL(string: "https://example.com")!,
            tokenProvider: NoToken(),
            session: URLSession(configuration: configuration)
        )
        return BusinessService(api: client)
    }

    private func query(of url: URL?) -> [String: String] {
        guard let url, let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return [:] }
        var result: [String: String] = [:]
        for item in components.queryItems ?? [] { result[item.name] = item.value }
        return result
    }

    @Test("Зарплата просит представление weekly")
    func salaryAsksForWeeklyView() async throws {
        let service = service(responding: #"{"data":{"weekStart":"2026-08-10","weekEnd":"2026-08-16","operators":[],"totals":{}}}"#)

        _ = try await service.salary(weekStart: "2026-08-10")

        let parameters = query(of: Interceptor.lastURL)
        #expect(parameters["view"] == "weekly")
        #expect(parameters["weekStart"] == "2026-08-10")
    }

    @Test("Доходы и расходы просят период именами, которые роут читает")
    func ledgerAsksForPeriod() async throws {
        let incomes = service(responding: #"{"data":[]}"#)
        _ = try await incomes.incomes(from: "2026-08-01", to: "2026-08-10")
        var parameters = query(of: Interceptor.lastURL)
        // Раньше слались dateFrom/dateTo — роут их не видел и молча отдавал
        // последние 2000 строк независимо от периода.
        #expect(parameters["from"] == "2026-08-01")
        #expect(parameters["to"] == "2026-08-10")

        let expenses = service(responding: #"{"data":[]}"#)
        _ = try await expenses.expenses(from: "2026-08-01", to: "2026-08-10")
        parameters = query(of: Interceptor.lastURL)
        #expect(parameters["from"] == "2026-08-01")
        #expect(parameters["to"] == "2026-08-10")
    }

    @Test("Аналитика просит год")
    func analyticsAsksForYear() async throws {
        let service = service(responding: #"{"data":{"year":2026,"companies":[],"months":[],"previousYear":[]}}"#)

        _ = try await service.monthlyAnalytics(year: 2026)

        #expect(query(of: Interceptor.lastURL)["year"] == "2026")
    }

    @Test("ОПиУ просит границы месяцами")
    func pnlAsksForMonthBounds() async throws {
        let service = service(responding: #"{"data":{"months":[]}}"#)

        _ = try await service.pnl(from: "2026-01", to: "2026-08")

        let parameters = query(of: Interceptor.lastURL)
        #expect(parameters["from"] == "2026-01")
        #expect(parameters["to"] == "2026-08")
    }
}
