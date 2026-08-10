import Foundation
import Testing

@testable import OrdaKit

/// Проверки модели точки перед сохранением.
///
/// Сервер заменяет конфигурацию целиком и молча отбрасывает то, что не
/// проходит его условия: тариф без часов, долю несуществующего тарифа. Молча —
/// значит владелец сохранит, вернётся и не найдёт своей строки. Эти проверки
/// существуют, чтобы сказать об этом до отправки.
@Suite("Модель симуляции")
struct SimulationConfigTests {
    private func tariff(
        id: String = "t1",
        name: String = "3+2",
        paid: Double = 3,
        bonus: Double = 2,
        price: Double = 3600
    ) -> SimulationTariffConfig {
        SimulationTariffConfig(id: id, name: name, paidHours: paid, bonusHours: bonus, price: price)
    }

    private func zone(
        devices: Int = 10,
        hours: Double = 8,
        mix: [SimulationMixEntry] = [SimulationMixEntry(tariffID: "t1", sharePct: 100)]
    ) -> SimulationZoneConfig {
        SimulationZoneConfig(name: "Премиум", deviceCount: devices, assumedOccupancyHours: hours, tariffMix: mix)
    }

    @Test("Час считается с учётом бонусных часов")
    func ratePerHourIncludesBonus() {
        #expect(tariff(paid: 3, bonus: 2, price: 3600).ratePerHour == 720)
        #expect(tariff(paid: 1, bonus: 0, price: 1200).ratePerHour == 1200)
    }

    /// Тариф без часов — деление на ноль. Ставка нулевая, а не бесконечная.
    @Test("Тариф без часов не даёт ставки")
    func zeroHoursMeansZeroRate() {
        #expect(tariff(paid: 0, bonus: 0, price: 5000).ratePerHour == 0)
    }

    @Test("Пустая модель сохраняется: это способ всё стереть")
    func emptyConfigIsAllowed() {
        #expect(SimulationConfigCheck.blocker(zones: [], tariffs: []) == nil)
    }

    @Test("Тариф без часов или без цены не пропускается")
    func brokenTariffBlocks() {
        #expect(SimulationConfigCheck.blocker(zones: [], tariffs: [tariff(paid: 0, bonus: 0)]) != nil)
        #expect(SimulationConfigCheck.blocker(zones: [], tariffs: [tariff(price: 0)]) != nil)
    }

    @Test("Зона без устройств не пропускается")
    func zoneWithoutDevicesBlocks() {
        #expect(SimulationConfigCheck.blocker(zones: [zone(devices: 0)], tariffs: [tariff()]) != nil)
    }

    @Test("Верная модель проходит без замечаний")
    func validConfigPasses() {
        #expect(SimulationConfigCheck.blocker(zones: [zone()], tariffs: [tariff()]) == nil)
        #expect(SimulationConfigCheck.warnings(zones: [zone()], tariffs: [tariff()]).isEmpty)
    }

    /// Доли, не дающие сотню, — не ошибка, а небрежность: сохранить можно, но
    /// потенциал будет занижен ровно на недостающую долю.
    @Test("Недобор долей предупреждает, но не блокирует")
    func partialSharesWarn() {
        let partial = zone(mix: [SimulationMixEntry(tariffID: "t1", sharePct: 60)])
        #expect(SimulationConfigCheck.blocker(zones: [partial], tariffs: [tariff()]) == nil)
        #expect(SimulationConfigCheck.warnings(zones: [partial], tariffs: [tariff()]).count == 1)
    }

    @Test("Зона без тарифов предупреждает: она даст ноль")
    func zoneWithoutMixWarns() {
        let bare = zone(mix: [])
        #expect(SimulationConfigCheck.warnings(zones: [bare], tariffs: [tariff()]).count == 1)
    }

    @Test("Загрузка больше суток предупреждает")
    func impossibleOccupancyWarns() {
        let impossible = zone(hours: 30)
        #expect(SimulationConfigCheck.warnings(zones: [impossible], tariffs: [tariff()]).contains { $0.contains("24") })
    }

    /// Ключи тела запроса — контракт сервера. Зона уходит без идентификатора:
    /// сервер зоны пересоздаёт. Тариф — с идентификатором, потому что по нему
    /// связаны доли.
    @Test("Тело сохранения собирается по контракту сервера")
    func encodesServerContract() throws {
        let body = try JSONEncoder().encode(
            SimulationSaveRequest(companyID: "co-1", zones: [zone()], tariffs: [tariff()])
        )
        let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])

        #expect(json["company_id"] as? String == "co-1")

        let tariffs = try #require(json["tariffs"] as? [[String: Any]])
        #expect(tariffs.first?["id"] as? String == "t1")
        #expect(tariffs.first?["paid_hours"] as? Double == 3)
        #expect(tariffs.first?["bonus_hours"] as? Double == 2)

        let zones = try #require(json["zones"] as? [[String: Any]])
        #expect(zones.first?["device_count"] as? Int == 10)
        #expect(zones.first?["assumed_occupancy_hours"] as? Double == 8)
        #expect(zones.first?["id"] == nil)

        let mix = try #require(zones.first?["tariff_mix"] as? [[String: Any]])
        #expect(mix.first?["tariff_id"] as? String == "t1")
        #expect(mix.first?["share_pct"] as? Double == 100)
    }
}
