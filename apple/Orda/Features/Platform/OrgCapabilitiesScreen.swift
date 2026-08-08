import OrdaKit
import OrdaUI
import SwiftUI

/// Рубильник прав организации.
///
/// Верхний слой поверх ролевых прав: выключенное здесь недоступно **всем** в
/// организации, включая владельца. Именно поэтому экран отдельный, а не
/// закопан в настройки — цена ошибки высокая.
///
/// Права на просмотр (`.view`) здесь не показываем: сервер их не режет этим
/// слоем, иначе выключение «действия» закрыло бы страницу целиком. Видимостью
/// страниц управляет пакет организации.
struct OrgCapabilitiesScreen: View {
    let organization: Organization

    @Environment(PlatformStore.self) private var store

    @State private var search = ""
    @State private var showOnlyDisabled = false
    @State private var error: String?
    @State private var pending: Set<String> = []

    var body: some View {
        ScrollView {
            LazyVStack(spacing: Spacing.md, pinnedViews: [.sectionHeaders]) {
                summaryCard
                filters

                ForEach(filteredGroups, id: \.group.id) { entry in
                    Section {
                        Card {
                            VStack(spacing: Spacing.sm) {
                                ForEach(Array(entry.capabilities.enumerated()), id: \.element.id) { index, capability in
                                    if index > 0 { RowDivider() }
                                    row(capability)
                                }
                            }
                        }
                    } header: {
                        HStack {
                            Text(entry.group.label)
                                .font(Typography.label)
                                .foregroundStyle(Theme.textDim)
                                .textCase(.uppercase)
                            Spacer()
                            Text("\(entry.capabilities.count)")
                                .font(Typography.caption)
                                .monospacedDigit()
                                .foregroundStyle(Theme.textDim)
                        }
                        .padding(.horizontal, Spacing.xs)
                        .padding(.vertical, Spacing.sm)
                        .background(Theme.background)
                    }
                }

                if filteredGroups.isEmpty {
                    EmptyStateView(
                        icon: "magnifyingglass",
                        title: "Ничего не найдено",
                        message: showOnlyDisabled ? "Выключенных действий нет." : "Попробуйте другой запрос."
                    )
                }

                if let error {
                    Text(error).font(Typography.callout).foregroundStyle(Theme.negative)
                }
            }
            .padding(Spacing.lg)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.background)
        .navigationTitle("Рубильник прав")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task { await store.loadCapabilities(organizationID: organization.id) }
    }

    // ── Шапка ────────────────────────────────────────────────────────────────

    private var summaryCard: some View {
        let disabledCount = store.disabledCapabilities[organization.id]?.count ?? 0
        return Card(accent: disabledCount > 0 ? Theme.warning : nil) {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Text(organization.name)
                    .font(Typography.title)
                    .foregroundStyle(Theme.text)

                Text("Выключенное здесь недоступно всем в организации, включая владельца.")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textMuted)

                if disabledCount > 0 {
                    StatusChip("\(disabledCount) \(pluralize(disabledCount, "действие выключено", "действия выключено", "действий выключено"))", kind: .warning)
                }
            }
        }
    }

    private var filters: some View {
        VStack(spacing: Spacing.sm) {
            HStack(spacing: Spacing.sm) {
                Image(systemName: "magnifyingglass").foregroundStyle(Theme.textDim)
                TextField("Действие или код", text: $search)
                    .textFieldStyle(.plain)
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    #endif
                    .autocorrectionDisabled()
                if !search.isEmpty {
                    Button { search = "" } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.textDim)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(Spacing.md)
            .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))

            Toggle("Только выключенные", isOn: $showOnlyDisabled)
                .font(Typography.callout)
                .tint(Theme.accent(for: .platform))
        }
    }

    // ── Строка права ─────────────────────────────────────────────────────────

    private func row(_ capability: Capability) -> some View {
        let isDisabled = store.isDisabled(capability.id, in: organization.id)
        let isPending = pending.contains(capability.id)

        return HStack(spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: Spacing.sm) {
                    Text(capability.label)
                        .font(Typography.callout)
                        .foregroundStyle(Theme.text)
                    if capability.severity == .high {
                        StatusChip("опасное", kind: .danger)
                    }
                }
                Text(capability.id)
                    .font(Typography.caption)
                    .monospaced()
                    .foregroundStyle(Theme.textDim)
            }

            Spacer(minLength: Spacing.sm)

            if isPending {
                ProgressView().controlSize(.small)
            } else {
                // Переключатель означает «действие разрешено», а не «выключено»:
                // включённое положение = работает, это читается без объяснений.
                Toggle("", isOn: Binding(
                    get: { !isDisabled },
                    set: { enabled in toggle(capability, enabled: enabled) }
                ))
                .labelsHidden()
                .tint(Theme.accent(for: .platform))
            }
        }
        .padding(.vertical, Spacing.xs)
    }

    private func toggle(_ capability: Capability, enabled: Bool) {
        pending.insert(capability.id)
        Task {
            let failure = await store.setCapability(capability.id, enabled: enabled, in: organization.id)
            pending.remove(capability.id)
            if let failure {
                error = failure
                Haptics.error()
            } else {
                Haptics.tap()
            }
        }
    }

    // ── Фильтрация ───────────────────────────────────────────────────────────

    private struct GroupEntry {
        let group: CapabilityGroup
        let capabilities: [Capability]
    }

    /// Группы с подходящими правами. Просмотровые права отфильтрованы: сервер
    /// их этим слоем не режет.
    private var filteredGroups: [GroupEntry] {
        let needle = search.trimmingCharacters(in: .whitespaces).lowercased()
        let disabled = store.disabledCapabilities[organization.id] ?? []

        return CapabilityCatalog.groups.compactMap { group in
            let capabilities = group.pages
                .flatMap(\.capabilities)
                .filter { capability in
                    guard capability.action != "view" else { return false }
                    if showOnlyDisabled, !disabled.contains(capability.id) { return false }
                    guard !needle.isEmpty else { return true }
                    return capability.label.lowercased().contains(needle)
                        || capability.id.lowercased().contains(needle)
                }

            return capabilities.isEmpty ? nil : GroupEntry(group: group, capabilities: capabilities)
        }
    }
}
