import OrdaKit
import OrdaUI
import SwiftUI

/// Что поручили лично мне.
///
/// Доска задач показывает поручения всей организации и закрыта правом
/// «Задачи»: владелец справедливо снимает его с рядового сотрудника. Своё
/// поручение при этом видеть надо в любом случае — иначе о нём узнают голосом
/// или из телеграма, а в приложении его нет.
///
/// Сервер отвечает на `mine=1` без этого права, но только назначенным на
/// просителя. Карточка молча исчезает, когда поручений нет.
struct MyTasksCard: View {
    @Environment(\.api) private var api

    @State private var tasks: [TeamTask] = []
    @State private var didLoad = false

    /// Открытые поручения, срочные и просроченные сверху.
    private var open: [TeamTask] {
        tasks
            .filter { !$0.isDone && $0.status != "cancelled" && $0.status != "canceled" }
            .sorted { lhs, rhs in
                if lhs.isOverdue != rhs.isOverdue { return lhs.isOverdue }
                switch (lhs.dueDate, rhs.dueDate) {
                case let (l?, r?): return l < r
                case (nil, _?): return false
                case (_?, nil): return true
                default: return false
                }
            }
    }

    var body: some View {
        Group {
            if !open.isEmpty {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        SectionHeader(
                            "Мои задачи",
                            subtitle: "\(open.count) \(pluralize(open.count, "открытая", "открытые", "открытых"))"
                        )

                        ForEach(Array(open.prefix(5).enumerated()), id: \.element.id) { index, task in
                            if index > 0 { RowDivider() }
                            TeamTaskRowView(task: task)
                        }

                        if open.count > 5 {
                            Text("и ещё \(open.count - 5) — в разделе «Задачи»")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textDim)
                        }
                    }
                }
            }
        }
        .task {
            guard !didLoad else { return }
            didLoad = true
            // Ошибку не показываем: у того, кому ничего не поручают, карточки
            // просто нет, и красная строка в профиле пугала бы зря.
            tasks = (try? await BusinessService(api: api).myTasks()) ?? []
        }
    }
}
