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
                Card {
                    Text("Выключенное сюда не приходит. Всё остальное — как раньше.")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                        .fixedSize(horizontal: false, vertical: true)
                }

                ForEach(order, id: \.self) { group in
                    let events = prefs.events.filter { NotificationEventLabels.group($0) == group }
                    if !events.isEmpty {
                        Card {
                            VStack(alignment: .leading, spacing: Spacing.sm) {
                                SectionHeader(group)
                                ForEach(events, id: \.self) { event in
                                    row(event, prefs: prefs)
                                    if event != events.last { RowDivider() }
                                }
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

    private func row(_ event: String, prefs: NotificationPrefs) -> some View {
        Toggle(isOn: Binding(
            get: { prefs.isEnabled(event) },
            set: { value in Task { await toggle(event, to: value) } }
        )) {
            Text(NotificationEventLabels.title(event))
                .font(Typography.callout)
                .foregroundStyle(Theme.text)
        }
        .tint(Theme.brand)
        .disabled(saving.contains(event))
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
