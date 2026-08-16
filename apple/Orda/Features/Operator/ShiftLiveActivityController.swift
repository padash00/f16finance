#if os(iOS)
import ActivityKit
import Foundation
import OrdaKit

/// Живая активность смены со стороны приложения.
///
/// Приложение заводит активность при открытии смены, обновляет по мере продаж и
/// закрывает вместе со сменой. Расширение только рисует — считать и ходить в
/// сеть оно не должно.
///
/// Молчаливость намеренная: живая активность это удобство, а не работа. Если
/// система откажет — выключены в настройках, кончился лимит, устройство старое —
/// смена должна идти как шла, без единого сообщения об ошибке.
@MainActor
enum ShiftLiveActivityController {
    private static var current: Activity<ShiftActivityAttributes>?

    /// Разрешены ли живые активности. Человек мог выключить их в настройках.
    private static var isAvailable: Bool {
        ActivityAuthorizationInfo().areActivitiesEnabled
    }

    /// Начать показ смены.
    ///
    /// Повторный вызов при уже идущей активности не создаёт вторую: экран смены
    /// перезагружается часто, и каждый раз новая карточка на блокировке — это
    /// стопка одинаковых карточек.
    static func start(
        pointName: String,
        openedAt: Date,
        isNight: Bool,
        state: ShiftActivityAttributes.ContentState
    ) {
        guard isAvailable else { return }
        guard current == nil else {
            update(state)
            return
        }

        let attributes = ShiftActivityAttributes(
            pointName: pointName,
            openedAt: openedAt,
            isNight: isNight
        )
        current = try? Activity.request(
            attributes: attributes,
            content: ActivityContent(state: state, staleDate: nil)
        )
    }

    static func update(_ state: ShiftActivityAttributes.ContentState) {
        guard let activity = current else { return }
        // Идентификатор, а не сам объект: `Activity` не пересекает границу
        // изоляции, и передавать его в отдельную задачу нельзя.
        let id = activity.id
        Task { await push(id: id, state: state) }
    }

    /// Работа с самой активностью — вне главного актора.
    ///
    /// `Activity` не пересекает границу изоляции: найденный на главном потоке
    /// объект нельзя передать в задачу. Поэтому и поиск, и обновление идут в
    /// одном неизолированном месте.
    private nonisolated static func push(
        id: String,
        state: ShiftActivityAttributes.ContentState
    ) async {
        guard let live = Activity<ShiftActivityAttributes>.activities.first(where: { $0.id == id })
        else { return }
        await live.update(ActivityContent(state: state, staleDate: nil))
    }

    private nonisolated static func finish(id: String) async {
        guard let live = Activity<ShiftActivityAttributes>.activities.first(where: { $0.id == id })
        else { return }
        await live.end(nil, dismissalPolicy: .immediate)
    }

    /// Убрать карточку. Вызывается при закрытии смены и при выходе из аккаунта:
    /// оставленная активность продолжала бы показывать чужие деньги на экране
    /// блокировки.
    static func stop() {
        guard let activity = current else { return }
        let id = activity.id
        current = nil
        Task { await finish(id: id) }
    }

    /// Подобрать «хвосты» после перезапуска приложения.
    ///
    /// Активность переживает выгрузку процесса: без этого после перезапуска
    /// приложение считало бы, что её нет, и завело бы вторую.
    static func adopt() {
        guard current == nil else { return }
        current = Activity<ShiftActivityAttributes>.activities.first
    }
}
#endif
