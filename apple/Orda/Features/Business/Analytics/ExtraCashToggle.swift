import OrdaKit
import OrdaUI
import SwiftUI

/// Складывать ли отдельную кассу («F16 Extra») в итоги отчётов.
///
/// Одна настройка на все отчёты и запоминается: включил в налогах — те же
/// цифры и в ОПиУ, и в движении денег. Раньше касса выпадала из итогов
/// везде без возможности её вернуть, и сумма расходилась с тем, что
/// владелец считал сам.
@MainActor
@Observable
final class ExtraCashPreference {
    static let shared = ExtraCashPreference()

    private static let key = "orda.reports.includeExtra"

    var includeExtra: Bool = UserDefaults.standard.bool(forKey: ExtraCashPreference.key) {
        didSet { UserDefaults.standard.set(includeExtra, forKey: Self.key) }
    }

    /// Та же проверка, что на сервере (`isExtraCompany`): код `extra` или
    /// точное имя «F16 Extra».
    static func isExtra(_ company: Company) -> Bool {
        company.code?.lowercased() == "extra" || company.name == "F16 Extra"
    }
}

/// Кнопка «+ F16 Extra» — включает отдельную кассу в итоги.
///
/// Показывается, только если такая касса у организации есть.
struct ExtraCashToggle: View {
    @Environment(BusinessStore.self) private var business
    private var preference = ExtraCashPreference.shared

    var body: some View {
        if let extra = business.companies.first(where: ExtraCashPreference.isExtra) {
            let isOn = preference.includeExtra
            Button {
                withAnimation(Motion.tap) { preference.includeExtra.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: isOn ? "checkmark.circle.fill" : "plus.circle")
                        .font(.system(size: 14, weight: .semibold))
                    Text(isOn ? "С учётом \(extra.name)" : "Учесть \(extra.name)")
                        .font(.system(size: 14, weight: .semibold))
                        .lineLimit(1)
                }
                .foregroundStyle(isOn ? Color.white : Theme.text)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(isOn ? AnyShapeStyle(Theme.brand) : AnyShapeStyle(Theme.surface), in: Capsule())
                .overlay {
                    if !isOn { Capsule().strokeBorder(Theme.border, lineWidth: 1) }
                }
            }
            .buttonStyle(.pressable)
            .accessibilityHint(isOn ? "Касса входит в итоги. Нажмите, чтобы исключить." : "Касса не входит в итоги. Нажмите, чтобы учесть.")
        }
    }
}
