import Foundation
import OrdaKit
import SwiftUI

/// Общий фильтр и данные аналитики владельца.
///
/// Один на все вкладки: период, выбранный в «Обзоре», действует и в «Деньгах»,
/// и в «Продажах». Фильтр переживает перезапуск — владелец, который смотрит
/// «этот месяц по Арене», не должен выставлять это каждое утро заново.
@MainActor
@Observable
final class AnalyticsStore {
    var filter: AnalyticsFilter {
        didSet {
            guard oldValue != filter else { return }
            save()
            reload()
        }
    }

    private(set) var data: OwnerAnalytics?
    private(set) var isLoading = false
    private(set) var error: APIError?
    /// Когда пришёл ответ — «обновлено 2 мин назад» под фильтром.
    private(set) var loadedAt: Date?

    /// Точки, известные по прошлому ответу: список для фильтра не должен
    /// пропадать, пока грузится новый период.
    private(set) var companies: [OwnerAnalytics.CompanyOption] = []

    private let service: OwnerAnalyticsService
    private let storageKey: String
    private var inFlight: Task<Void, Never>?

    init(api: APIClient, organizationID: String?) {
        self.service = OwnerAnalyticsService(api: api)
        self.storageKey = "ownerAnalytics.filter.\(organizationID ?? "none")"
        self.filter = Self.restore(key: storageKey) ?? AnalyticsFilter()
    }

    var bounds: (from: String, to: String) { filter.period.bounds() }

    /// Подпись выбранных точек: «Все точки», «F16 Arena», «3 точки».
    var companiesTitle: String {
        if filter.companyIDs.isEmpty { return "Все точки" }
        if filter.companyIDs.count == 1, let id = filter.companyIDs.first {
            return companies.first { $0.id == id }?.name ?? "1 точка"
        }
        return "\(filter.companyIDs.count) \(Self.pointsWord(filter.companyIDs.count))"
    }

    static func pointsWord(_ n: Int) -> String {
        let mod10 = n % 10, mod100 = n % 100
        if mod10 == 1 && mod100 != 11 { return "точка" }
        if (2...4).contains(mod10) && !(12...14).contains(mod100) { return "точки" }
        return "точек"
    }

    // ── Загрузка ─────────────────────────────────────────────────────────────

    /// Перезапросить под текущий фильтр. Прошлый запрос отменяется: иначе
    /// медленный ответ за «год» мог бы прийти после быстрого за «сегодня» и
    /// подменить его.
    func reload() {
        inFlight?.cancel()
        inFlight = Task { await load() }
    }

    func load() async {
        let filter = self.filter
        let bounds = filter.period.bounds()
        isLoading = true
        do {
            let result = try await service.load(
                from: bounds.from,
                to: bounds.to,
                companyIDs: Array(filter.companyIDs),
                compare: filter.compare
            )
            guard !Task.isCancelled, filter == self.filter else { return }
            data = result
            companies = result.companies
            error = nil
            loadedAt = Date()
            // Точку могли удалить или отнять доступ — выбор без неё.
            let known = Set(result.companies.map(\.id))
            if !self.filter.companyIDs.isSubset(of: known) {
                self.filter.companyIDs = self.filter.companyIDs.intersection(known)
            }
        } catch is CancellationError {
            return
        } catch let apiError as APIError {
            guard !Task.isCancelled else { return }
            error = apiError
        } catch {
            guard !Task.isCancelled else { return }
            self.error = .transport(message: error.localizedDescription)
        }
        isLoading = false
    }

    // ── Хранение фильтра ─────────────────────────────────────────────────────

    private func save() {
        guard let encoded = try? JSONEncoder().encode(filter) else { return }
        UserDefaults.standard.set(encoded, forKey: storageKey)
    }

    private static func restore(key: String) -> AnalyticsFilter? {
        guard let raw = UserDefaults.standard.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(AnalyticsFilter.self, from: raw)
    }
}
