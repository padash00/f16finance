import Testing

@testable import OrdaKit

/// Не проверка, а отчёт: сколько разделов портала уже нативны.
///
/// Держим тестом, чтобы цифра в разговоре всегда была настоящей, а не по
/// памяти: список растёт, и «примерно две трети» быстро расходится с кодом.
@Suite("Охват")
struct CoverageReport {
    @Test("Сколько страниц закрыто нативно")
    func report() {
        let pages = CapabilityCatalog.groups.flatMap(\.pages)
        let rest = pages.filter { NativeSection.forPage(id: $0.id) == nil }

        print("СТРАНИЦ КАТАЛОГА: \(pages.count)")
        print("НАТИВНО:          \(pages.count - rest.count)")
        print("ОСТАЛОСЬ:         \(rest.count)")
        for group in CapabilityCatalog.groups {
            let missing = group.pages.filter { NativeSection.forPage(id: $0.id) == nil }
            guard !missing.isEmpty else { continue }
            print("  [\(group.label)]")
            for page in missing { print("    \(page.id) — \(page.label)") }
        }

        // Храповик: охват может только расти. Если раздел выпал из
        // NativeSection, он молча исчез бы из навигации — заметить это
        // иначе можно только вручную.
        #expect(rest.count <= 15, "Охват уменьшился: было 15 незакрытых, стало \(rest.count)")
    }
}
