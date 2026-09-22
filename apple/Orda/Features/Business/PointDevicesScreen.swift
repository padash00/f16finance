import OrdaKit
import OrdaUI
import SwiftUI

/// Программы точек: операторские и киоски, кто на связи.
///
/// Этот раздел открывают с одним вопросом — почему точка не продаёт. Поэтому
/// первое, что видно, — программы, не выходившие на связь; полный список
/// ниже. Токен здесь не показывается: он даёт полный доступ к продажам точки,
/// а прописывают его один раз при установке, с компьютера.
struct PointDevicesScreen: View {
    @Environment(BusinessStore.self) private var store
    @Environment(\.access) private var access
    @Environment(\.api) private var api

    @State private var toggling: PointProject?
    @State private var actionError: String?

    /// Включение и отключение устройства — право высокой важности: отключённая
    /// касса не работает вовсе.
    private var canToggle: Bool { access?.can("point-devices.toggle_active") ?? false }

    var body: some View {
        ScreenScroll {
            if let error = store.devicesError, store.devices == nil {
                ErrorStateView(error: error) { Task { await store.loadDevices() } }
            } else if let list = store.devices {
                content(list)
            } else {
                VStack(spacing: Spacing.lg) {
                    Skeleton(height: 96, cornerRadius: Radius.lg)
                    Skeleton(height: 220, cornerRadius: Radius.lg)
                }
            }
        }
        .background(Theme.background)
        .navigationTitle("Точки и устройства")
        .toolbar { LogoutToolbarItem() }
        .alert(
            toggling?.isActive == true ? "Отключить устройство?" : "Включить устройство?",
            isPresented: .constant(toggling != nil)
        ) {
            Button(toggling?.isActive == true ? "Отключить" : "Включить", role: toggling?.isActive == true ? .destructive : nil) {
                if let project = toggling { Task { await toggle(project) } }
            }
            Button("Отмена", role: .cancel) { toggling = nil }
        } message: {
            if let project = toggling {
                Text(project.isActive
                    ? "\(project.name) перестанет работать: касса не откроется и чеки не пробьются. Токен сохранится — включить обратно можно здесь же."
                    : "\(project.name) снова заработает с прежним токеном, настраивать заново не нужно.")
            }
        }
        .overlay(alignment: .top) {
            if let actionError {
                Text(actionError)
                    .font(Typography.caption)
                    .foregroundStyle(Theme.negative)
                    .padding(Spacing.md)
                    .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
                    .padding(Spacing.md)
            }
        }
        .task { await store.loadDevices() }
        .refreshable { await store.loadDevices() }
    }

    private func toggle(_ project: PointProject) async {
        toggling = nil
        actionError = nil
        do {
            try await BusinessService(api: api).setPointDeviceActive(
                projectID: project.id,
                isActive: !project.isActive
            )
            Haptics.success()
            await store.loadDevices()
        } catch let error as APIError {
            Haptics.error()
            actionError = error.userMessage
        } catch {
            Haptics.error()
            actionError = error.localizedDescription
        }
    }

    @ViewBuilder
    private func content(_ list: PointProjectList) -> some View {
        if list.projects.isEmpty {
            WideEmptyState(
                icon: "desktopcomputer",
                title: "Программ нет",
                message: "Здесь появятся операторские программы и киоски точек."
            )
        } else {
            let offline = list.offline

            VStack(spacing: Spacing.lg) {
                // Одна цифра вместо трёх плиток: главное — сколько на связи,
                // а цвет карточки сразу говорит, есть ли молчащие точки.
                let online = list.projects.filter(\.isOnline).count
                HeroSummary(
                    title: offline.isEmpty ? "Все программы на связи" : "Есть молчащие программы",
                    value: "\(online) из \(list.projects.count)",
                    caption: "на связи сейчас",
                    footer: [
                        ("Всего программ", "\(list.projects.count)"),
                        ("Молчат сутки", "\(offline.count)"),
                    ],
                    colors: offline.isEmpty
                        ? Theme.heroGradient
                        : Theme.heroNegative
                )

                if !offline.isEmpty {
                    OwnerSection("Не выходят на связь") {
                        Text("точка может не продавать")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(Theme.negative)
                    } content: {
                        VStack(spacing: 0) {
                            ForEach(Array(offline.enumerated()), id: \.element.id) { index, project in
                                if index > 0 { DevicesDivider() }
                                ProjectRow(project: project)
                            }
                        }
                    }
                }

                OwnerSection("Все программы") {
                    Text("\(list.projects.count)")
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                        .foregroundStyle(Theme.textDim)
                } content: {
                    VStack(spacing: 0) {
                        ForEach(Array(list.projects.enumerated()), id: \.element.id) { index, project in
                            if index > 0 { DevicesDivider() }
                            if canToggle {
                                // Планшет забыли на точке, компьютер увезли в
                                // ремонт — доступ закрывают в ту же минуту.
                                Button {
                                    toggling = project
                                } label: {
                                    ProjectRow(project: project)
                                        .contentShape(Rectangle())
                                }
                                .buttonStyle(.pressable)
                            } else {
                                ProjectRow(project: project)
                            }
                        }
                    }
                }
            }
        }
    }
}

/// Разделитель с отступом под иконку — как в списках банковского приложения.
private struct DevicesDivider: View {
    var body: some View {
        Rectangle().fill(Theme.borderSoft).frame(height: 1).padding(.leading, 56)
    }
}

/// Строка программы: иконка в кружке цвета статуса, статус подписью —
/// широкая плашка съедала место под название точки.
private struct ProjectRow: View {
    let project: PointProject

    private var statusColor: Color {
        if !project.isActive { return Theme.textDim }
        if project.neverSeen { return Theme.warning }
        return project.isOnline ? Theme.positive : Theme.negative
    }

    private var statusText: String {
        if !project.isActive { return "выключена" }
        if project.neverSeen { return "не подключалась" }
        return project.isOnline ? "на связи" : "молчит"
    }

    var body: some View {
        HStack(spacing: Spacing.md) {
            TintedIcon(systemName: project.icon, tint: project.isActive ? statusColor : Theme.textDim, size: 42)

            VStack(alignment: .leading, spacing: 3) {
                Text(project.name)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(project.isActive ? Theme.text : Theme.textDim)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: 3) {
                Text(statusText)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(statusColor)
                if let seen = project.lastSeenAt {
                    Text(seen.formatted(.dateTime.day().month(.abbreviated).hour().minute()))
                        .font(.system(size: 12))
                        .monospacedDigit()
                        .foregroundStyle(Theme.textDim)
                }
            }
            .fixedSize()
        }
        .padding(.vertical, Spacing.sm)
    }

    /// Режим и точки, за которыми закреплена программа.
    private var subtitle: String {
        let points = project.companies.map(\.name).joined(separator: ", ")
        return points.isEmpty ? project.modeLabel : "\(project.modeLabel) · \(points)"
    }
}
