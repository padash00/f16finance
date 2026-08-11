import Foundation
import Testing

@testable import OrdaKit

/// Итоги ОПиУ за период.
///
/// Складываются в приложении: сервер отдаёт месяцы, а период выбирает
/// владелец. Главное здесь — маржа. Среднее из месячных процентов не равно
/// проценту от суммы, и месяц с крошечной выручкой и случайной маржой в 300 %
/// перекосил бы годовой итог.
@Suite("Итоги ОПиУ")
struct PnlTotalsTests {
    private func month(_ id: String, revenue: Double, ebitda: Double, net: Double, payroll: Double = 0) -> MonthlyPnl {
        let json = """
        {"month":"\(id)","revenue":\(revenue),"ebitda":\(ebitda),"netProfit":\(net),"payroll":\(payroll)}
        """
        return try! JSONDecoder().decode(MonthlyPnl.self, from: Data(json.utf8))
    }

    @Test("Суммы складываются, маржа берётся от суммарной выручки")
    func totals() {
        let report = PnlReport(months: [
            month("2026-01", revenue: 1_000_000, ebitda: 200_000, net: 150_000),
            month("2026-02", revenue: 3_000_000, ebitda: 300_000, net: 250_000),
        ])
        let totals = report.totals

        #expect(totals.revenue == 4_000_000)
        #expect(totals.ebitda == 500_000)
        #expect(totals.netProfit == 400_000)
        // 12,5 %, а не среднее из 20 % и 10 %.
        #expect(totals.ebitdaMargin == 12.5)
        #expect(totals.netMargin == 10)
    }

    @Test("Без выручки доли нет — делить не на что")
    func emptyRevenue() {
        let report = PnlReport(months: [month("2026-01", revenue: 0, ebitda: -50_000, net: -50_000)])
        #expect(report.totals.share(10_000) == nil)
        #expect(report.totals.ebitdaMargin == 0)
    }

    @Test("Незаполненный ФОТ виден по месяцу")
    func payrollFlag() {
        #expect(month("2026-01", revenue: 100, ebitda: 100, net: 100).hasManualPayroll == false)
        #expect(month("2026-01", revenue: 100, ebitda: 100, net: 100, payroll: 5).hasManualPayroll == true)
    }
}
