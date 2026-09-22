import OrdaKit
import OrdaUI
import SwiftUI

/// Что присылать на телефон.
///
/// Выбор был один на всё: либо все уведомления, либо ни одного. Когда чат
/// шумит, выключают вместе с ним просроченные долги и назначенные смены — а
/// потом удивляются, что важное не приходит. Сервер различает события давно,
/// экрана не было.
///
/// По умолчанию включено всё: человек, который сюда не заходил, получает то
/// же, что и раньше.
struct NotificationPrefsScreen: View {
    @Environment(\.api) private var api

    @State private var prefs: NotificationPrefs?
    @State private var isLoading = true
    @State private var error: APIError?
    /// Что сейчас переключается — чтобы не дать нажать дважды подряд.
    @State private var saving: Set<String> = []
    @State private var toast: ToastMessage?

    /// Разделы в том порядке, в каком о них думают.
    private let order = ["Общение", "Смены", "Задачи", "Деньги", "Прочее"]

    var body: some View {
        ScreenScroll {
            if let error {
                ErrorStateView(error: error) { Task { await load() } }
            } else if isLoading && prefs == nil {
                LoadingRows(count: 4)
            } else if let prefs {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    OwnerFootnote(text: "Выключенное сюда не приходит. Всё остальное — как раньше.")

                    // Разделы — белыми группами, как настройки в банковском
                    // приложении: иконка раздела слева, переключатель справа.
                    ForEach(order, id: \.self) { group in
                        let events = prefs.events.filter { NotificationEventLabels.group($0) == group }
                        if !events.isEmpty {
                            VStack(alignment: .leading, spacing: Spacing.sm) {
                                Text(group)
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(Theme.textDim)
                                    .padding(.horizontal, Spacing.xs)
                                VStack(spacing: 0) {
                                    ForEach(Array(events.enumerated()), id: \.element) { index, event in
                                        if index > 0 {
                                            Rectangle().fill(Theme.borderSoft).frame(height: 1).padding(.leading, 56)
                                        }
                                        row(event, group: group, prefs: prefs)
                                    }
                                }
                                .padding(.horizontal, Spacing.md)
                                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                            }
                        }
                    }
                }
            }
        }
        .background(Theme.background)
        .navigationTitle("Уведомления")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toast($toast)
        .task { await load() }
        .refreshable { await load() }
    }

    private func row(_ event: String, group: String, prefs: NotificationPrefs) -> some View {
        let style = Self.groupStyle(group)
        return Toggle(isOn: Binding(
            get: { prefs.isEnabled(event) },
            set: { value in Task { await toggle(event, to: value) } }
        )) {
            HStack(spacing: Spacing.md) {
                TintedIcon(systemName: style.icon, tint: style.tint, size: 36)
                Text(NotificationEventLabels.title(event))
                    .font(.system(size: 16))
                    .foregroundStyle(Theme.text)
            }
        }
        .tint(Theme.positive)
        .padding(.vertical, Spacing.sm)
        .disabled(saving.contains(event))
    }

    /// Иконка и цвет раздела: один цвет на раздел, чтобы глаз находил
    /// группу до того, как прочтёт подпись.
    private static func groupStyle(_ group: String) -> (icon: String, tint: Color) {
        switch group {
        case "Общение": ("bubble.left.and.bubble.right.fill", Color(hex: 0x3B82F6))
        case "Смены": ("calendar", Color(hex: 0x8B5CF6))
        case "Задачи": ("checklist", Color(hex: 0xF97316))
        case "Деньги": ("banknote.fill", Color(hex: 0x10B981))
        default: ("bell.fill", Color(hex: 0x64748B))
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            prefs = try await BusinessService(api: api).notificationPrefs()
            error = nil
        } catch let apiError as APIError {
            error = apiError
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }

    private func toggle(_ event: String, to value: Bool) async {
        saving.insert(event)
        defer { saving.remove(event) }
        do {
            try await BusinessService(api: api).setNotificationPref(event: event, enabled: value)
            // Перечитываем, а не правим на месте: настройка живёт на сервере, и
            // расхождение между экраном и правдой хуже, чем секунда ожидания.
            await load()
            Haptics.tap()
        } catch let apiError as APIError {
            toast = ToastMessage(apiError.userMessage, isError: true)
            Haptics.error()
        } catch {
            toast = ToastMessage(error.localizedDescription, isError: true)
            Haptics.error()
        }
    }
}
