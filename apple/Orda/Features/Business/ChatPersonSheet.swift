import OrdaKit
import OrdaUI
import SwiftUI

/// Карточка человека из чата.
///
/// В общем чате пишут по именам, и первый вопрос — «кто это и как с ним
/// связаться». Раньше ответ искали в другом разделе: выйти из чата, открыть
/// «Сообщения», найти в списке. Теперь карточка открывается по имени там же,
/// где имя и увидели.
///
/// Написать лично можно прямо отсюда: чаще всего именно за этим в неё и
/// заходят — уточнить вопрос, который в общем чате обсуждать незачем.
struct ChatPersonSheet: View {
    let name: String
    let roleLabel: String?
    let avatarURL: String?
    /// Учётная запись собеседника. Без неё написать нельзя: у человека нет
    /// входа в систему, и сообщение просто некуда доставить.
    let userID: String?

    @Environment(\.dismiss) private var dismiss
    @Environment(\.api) private var api

    @State private var writing = false
    @State private var card: ChatPersonCard?
    @State private var isLoading = true

    var body: some View {
        NavigationStack {
            ScreenScroll {
                Card {
                    VStack(spacing: Spacing.md) {
                        FeedAvatar(
                            initials: FeedText.initials(name),
                            side: 72,
                            tint: Theme.info,
                            photoURL: avatarURL
                        )

                        VStack(spacing: Spacing.xxs) {
                            Text(card?.name ?? name)
                                .font(Typography.title)
                                .foregroundStyle(Theme.text)
                                .multilineTextAlignment(.center)

                            if let position = card?.position ?? roleLabel, !position.isEmpty {
                                Text(position)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.textMuted)
                            }

                            // На смене или нет — то, ради чего чаще всего и
                            // открывают карточку: писать человеку, который
                            // сейчас за стойкой, и человеку, который спит
                            // после ночной, — разные разговоры.
                            if let card {
                                StatusChip(
                                    card.onShift
                                        ? (card.shiftCompany.map { "на смене · \($0)" } ?? "на смене")
                                        : "не на смене",
                                    kind: card.onShift ? .good : .neutral
                                )
                                .padding(.top, Spacing.xxs)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity)
                }

                if isLoading && card == nil {
                    LoadingRows(count: 1)
                } else if let card {
                    Card {
                        VStack(spacing: Spacing.sm) {
                            if !card.companies.isEmpty {
                                StatRow(
                                    card.companies.count > 1 ? "Точки" : "Точка",
                                    value: card.companies.joined(separator: ", "),
                                    icon: "storefront"
                                )
                            }

                            if let tenure = card.tenureLabel {
                                if !card.companies.isEmpty { RowDivider() }
                                StatRow("Стаж", value: tenure, icon: "clock.arrow.circlepath")
                            }
                        }
                    }
                }

                if let userID, !userID.isEmpty {
                    Button {
                        writing = true
                    } label: {
                        Label("Написать лично", systemImage: "envelope")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                } else {
                    Card {
                        Text("У этого человека нет входа в систему — написать лично не получится. Обсудите в общем чате.")
                            .font(Typography.callout)
                            .foregroundStyle(Theme.textMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .background(Theme.background)
            .navigationTitle("Кто это")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Готово") { dismiss() }
                }
            }
            .task {
                guard let userID, !userID.isEmpty else {
                    isLoading = false
                    return
                }
                // Молча: карточка — удобство, и её отказ не должен мешать
                // написать человеку.
                card = try? await FeedService(api: api).chatPerson(userID: userID)
                isLoading = false
            }
            .navigationDestination(isPresented: $writing) {
                if let userID {
                    // Переписки на сервере может ещё не быть — она появится с
                    // первым сообщением, поэтому открываем пустую.
                    StandaloneConversation(
                        thread: DirectThread(withUserID: userID, name: name)
                    )
                }
            }
        }
    }
}

/// Разговор, открытый сам по себе — не из списка переписок.
///
/// Список сообщений живёт в своём хранилище, и разговору нужно, чтобы кто-то
/// его создал. Отдельная обёртка нужна ровно для этого.
struct StandaloneConversation: View {
    let thread: DirectThread

    @Environment(\.api) private var api
    @State private var store: MessagesStore?

    var body: some View {
        Group {
            if let store {
                ConversationPane(thread: thread, store: store)
            } else {
                LoadingRows(count: 4)
            }
        }
        .task {
            guard store == nil else { return }
            let created = MessagesStore(api: api)
            store = created
            await created.load()
        }
    }
}
