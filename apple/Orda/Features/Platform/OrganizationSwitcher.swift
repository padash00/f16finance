import OrdaKit
import OrdaUI
import SwiftUI

/// Переключатель активной организации для суперадмина.
///
/// Без него «своя компания» — понятие неопределённое: суперадмин видит все
/// организации сразу, и данные бизнес-разделов приходят по всем точкам разом.
/// Выбор организации проставляет заголовок `x-organization-id`, и дальше
/// сервер отдаёт ровно её данные — так же, как владельцу.
///
/// Выбранная организация запоминается: возвращаться каждый раз к «всем» — это
/// каждый раз заново искать свою компанию в списке.
struct OrganizationSwitcher: ToolbarContent {
    @Environment(AuthStore.self) private var auth
    @Environment(PlatformStore.self) private var platform

    var body: some ToolbarContent {
        ToolbarItem(placement: .principal) {
            Menu {
                Button {
                    select(nil)
                } label: {
                    Label("Вся платформа", systemImage: auth.organizationID == nil ? "checkmark" : "building.2")
                }

                if !platform.organizations.isEmpty {
                    Divider()
                    ForEach(platform.organizations) { organization in
                        Button {
                            select(organization.id)
                        } label: {
                            if auth.organizationID == organization.id {
                                Label(organization.name, systemImage: "checkmark")
                            } else {
                                Text(organization.name)
                            }
                        }
                    }
                }
            } label: {
                HStack(spacing: Spacing.xs) {
                    Image(systemName: "building.2")
                        .font(.system(size: 12, weight: .semibold))
                    Text(currentName)
                        .font(Typography.callout.weight(.medium))
                        .lineLimit(1)
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.system(size: 9, weight: .bold))
                }
                .foregroundStyle(Theme.accent(for: .platform))
            }
        }
    }

    private var currentName: String {
        guard let id = auth.organizationID else { return "Вся платформа" }
        return platform.organizations.first { $0.id == id }?.name ?? "Организация"
    }

    private func select(_ id: String?) {
        Task { await auth.setOrganization(id) }
    }
}

/// Полоса-напоминание, что суперадмин смотрит данные конкретной организации.
///
/// Постоянно на виду намеренно: перепутать чужую организацию со своей при
/// управлении деньгами и правами — дорогая ошибка.
struct OrganizationContextBanner: View {
    @Environment(AuthStore.self) private var auth
    @Environment(PlatformStore.self) private var platform

    var body: some View {
        if let id = auth.organizationID {
            let name = platform.organizations.first { $0.id == id }?.name ?? "организация"
            HStack(spacing: Spacing.sm) {
                Image(systemName: "eye.fill")
                    .font(.system(size: 11, weight: .bold))
                Text("Смотрите как владелец: \(name)")
                    .font(Typography.caption.weight(.semibold))
                    .lineLimit(1)
                Spacer(minLength: Spacing.sm)
                Button("Вся платформа") {
                    Task { await auth.setOrganization(nil) }
                }
                .buttonStyle(.pressable)
                .font(Typography.caption.weight(.bold))
            }
            .foregroundStyle(Color.black.opacity(0.85))
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.sm)
            .frame(maxWidth: .infinity)
            .background(Theme.accent(for: .platform))
        }
    }
}
