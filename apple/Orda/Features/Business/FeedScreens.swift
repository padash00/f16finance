import OrdaKit
import OrdaUI
import SwiftUI

// ── Общие детали ленты ───────────────────────────────────────────────────────

/// Цвет вида события календаря. Сервер присылает свои hex-коды, но брать их
/// напрямую нельзя: они подобраны под тёмную тему сайта и на светлой теме
/// приложения теряют контраст.
private func feedTint(for kind: TeamCalendarEventKind) -> Color {
    switch kind {
    case .shift: Theme.info
    case .birthday: Theme.accent
    case .holiday: Theme.warning
    case .announcement: Theme.brand
    case .other: Theme.textDim
    }
}

/// Кружок с инициалами вместо фото — узнаваемость строки в списке.
private struct FeedAvatar: View {
    let initials: String
    var side: CGFloat = 36
    var tint: Color = Theme.brand
    var photoURL: String?

    var body: some View {
        if let photoURL, !photoURL.isEmpty {
            Thumbnail(url: photoURL, side: side, cornerRadius: side / 2, fallbackText: initials)
        } else {
            Text(initials)
                .font(.system(size: side * 0.36, weight: .semibold, design: .rounded))
                .foregroundStyle(tint)
                .frame(width: side, height: side)
                .background(tint.opacity(0.14), in: Circle())
        }
    }
}

/// Разметка поста, разобранная в блоки. Сырые теги читателю показывать нельзя,
/// а списки и цитаты без оформления сливаются с обычным текстом.
private struct FeedBlocksView: View {
    let blocks: [RichText.Block]

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            ForEach(blocks) { block in
                switch block.kind {
                case .heading:
                    Text(block.text)
                        .font(Typography.headline)
                        .foregroundStyle(Theme.text)
                        .padding(.top, Spacing.xs)

                case .listItem:
                    HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                        Circle()
                            .fill(Theme.brand)
                            .frame(width: 5, height: 5)
                            .offset(y: -3)
                        Text(block.text)
                            .font(Typography.body)
                            .foregroundStyle(Theme.textMuted)
                    }

                case .quote:
                    HStack(alignment: .top, spacing: Spacing.md) {
                        RoundedRectangle(cornerRadius: 2)
                            .fill(Theme.brand.opacity(0.6))
                            .frame(width: 3)
                        Text(block.text)
                            .font(Typography.body)
                            .italic()
                            .foregroundStyle(Theme.textMuted)
                    }

                case .paragraph:
                    Text(block.text)
                        .font(Typography.body)
                        .foregroundStyle(Theme.textMuted)
                        .textSelection(.enabled)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Разделитель дня в ленте сообщений.
private struct FeedDayDivider: View {
    let label: String

    var body: some View {
        HStack(spacing: Spacing.md) {
            Rectangle().fill(Theme.border).frame(height: 1)
            Text(label)
                .font(Typography.caption.weight(.medium))
                .foregroundStyle(Theme.textDim)
            Rectangle().fill(Theme.border).frame(height: 1)
        }
        .padding(.vertical, Spacing.xs)
    }
}

/// Пузырь сообщения. Один на командный чат и личную переписку: в двух копиях
/// они неминуемо разъезжаются по мелочам, и одинаковые ленты начинают
/// выглядеть по-разному.
private struct FeedBubble: View {
    let text: String
    let senderName: String
    var roleLabel: String?
    var time: Date?
    let isMine: Bool
    var isEdited: Bool = false
    var showsSender: Bool = true
    var avatarURL: String?
    var attachments: [FeedAttachment] = []
    var replyPreview: String?
    var reactions: [FeedReactionGroup] = []

    var body: some View {
        HStack(alignment: .bottom, spacing: Spacing.sm) {
            if isMine { Spacer(minLength: Spacing.xxl) }

            if !isMine && showsSender {
                FeedAvatar(
                    initials: FeedText.initials(senderName),
                    side: 30,
                    tint: Theme.info,
                    photoURL: avatarURL
                )
            } else if !isMine {
                Color.clear.frame(width: 30, height: 1)
            }

            VStack(alignment: isMine ? .trailing : .leading, spacing: Spacing.xs) {
                if !isMine && showsSender {
                    HStack(spacing: Spacing.xs) {
                        Text(senderName)
                            .font(Typography.caption.weight(.semibold))
                            .foregroundStyle(Theme.text)
                        if let roleLabel {
                            Text(roleLabel)
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textDim)
                        }
                    }
                }

                if let replyPreview, !replyPreview.isEmpty {
                    HStack(alignment: .top, spacing: Spacing.sm) {
                        RoundedRectangle(cornerRadius: 1.5)
                            .fill(Theme.brand.opacity(0.6))
                            .frame(width: 3)
                        Text(replyPreview)
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                            .lineLimit(2)
                    }
                }

                if !text.isEmpty {
                    Text(text)
                        .font(Typography.callout)
                        .foregroundStyle(isMine ? Theme.text : Theme.textMuted)
                        .multilineTextAlignment(.leading)
                        .textSelection(.enabled)
                }

                ForEach(attachments) { attachment in
                    if attachment.isImage {
                        Thumbnail(url: attachment.url, side: 140, cornerRadius: Radius.sm)
                    } else {
                        Label(attachment.label, systemImage: attachment.isPoll ? "chart.bar" : "paperclip")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                    }
                }

                HStack(spacing: Spacing.sm) {
                    if !reactions.isEmpty {
                        ForEach(reactions) { group in
                            Text(group.count > 1 ? "\(group.emoji) \(group.count)" : group.emoji)
                                .font(Typography.caption)
                                .padding(.horizontal, Spacing.sm)
                                .padding(.vertical, 2)
                                .background(Theme.surfaceRaised, in: Capsule())
                        }
                    }
                    if isEdited {
                        Text("изменено")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                    }
                    if let time {
                        Text(time.formatted(.dateTime.hour().minute()))
                            .font(Typography.caption)
                            .monospacedDigit()
                            .foregroundStyle(Theme.textDim)
                    }
                }
            }
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, Spacing.sm)
            .background(
                isMine ? Theme.brand.opacity(0.14) : Theme.surface,
                in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
                    .strokeBorder(isMine ? Theme.brand.opacity(0.25) : Theme.border, lineWidth: 1)
            )
            .frame(maxWidth: 520, alignment: isMine ? .trailing : .leading)

            if !isMine { Spacer(minLength: Spacing.xxl) }
        }
    }
}

/// Поле ввода с кнопкой отправки.
private struct FeedComposer: View {
    @Binding var text: String
    var placeholder: String = "Сообщение"
    var isSending: Bool
    var errorText: String?
    let send: () -> Void

    private var canSend: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isSending
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            if let errorText {
                Text(errorText)
                    .font(Typography.caption)
                    .foregroundStyle(Theme.negative)
            }

            HStack(alignment: .bottom, spacing: Spacing.sm) {
                TextField(placeholder, text: $text, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .lineLimit(1...5)
                    .padding(.horizontal, Spacing.md)
                    .padding(.vertical, Spacing.sm)
                    .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
                            .strokeBorder(Theme.border, lineWidth: 1)
                    )
                    .onSubmit(send)

                Button(action: send) {
                    Image(systemName: isSending ? "hourglass" : "arrow.up.circle.fill")
                        .font(.system(size: 26))
                        .foregroundStyle(canSend ? Theme.brand : Theme.textDim)
                }
                .buttonStyle(.plain)
                .disabled(!canSend)
            }
        }
        .padding(Spacing.lg)
        .background(Theme.background)
        .overlay(alignment: .top) {
            Rectangle().fill(Theme.border).frame(height: 1)
        }
    }
}

// ── Лента новостей ───────────────────────────────────────────────────────────

@MainActor
@Observable
final class NewsStore {
    private(set) var feed: NewsFeed?
    private(set) var isLoading = false
    private(set) var error: APIError?
    private(set) var isPublishing = false
    private(set) var actionError: String?

    private let service: FeedService
    /// Отметки о прочтении шлём один раз за сессию: карточка появляется на
    /// экране много раз за прокрутку, и без этого получится шквал запросов.
    private var reported: Set<String> = []

    init(api: APIClient) { service = FeedService(api: api) }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            feed = try await service.news()
            error = nil
        } catch let e as APIError {
            error = e
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }

    func markViewed(_ post: NewsPost) async {
        guard !post.viewed, !reported.contains(post.id) else { return }
        reported.insert(post.id)
        try? await service.markNewsViewed(postID: post.id)
    }

    func publish(title: String, body: String) async -> Bool {
        isPublishing = true
        defer { isPublishing = false }
        do {
            try await service.publishNews(
                title: title.trimmingCharacters(in: .whitespacesAndNewlines),
                body: body.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            actionError = nil
            await load()
            return true
        } catch let e as APIError {
            actionError = e.userMessage
            return false
        } catch {
            actionError = error.localizedDescription
            return false
        }
    }

    func delete(_ post: NewsPost) async {
        do {
            try await service.deleteNews(postID: post.id)
            actionError = nil
            await load()
        } catch let e as APIError {
            actionError = e.userMessage
        } catch {
            actionError = error.localizedDescription
        }
    }
}

/// Лента новостей компании.
///
/// Закреплённое вынесено отдельной секцией наверх: закрепление ставят ради
/// того, чтобы прочитали все, и утонуть в общем потоке оно не должно.
struct NewsScreen: View {
    @Environment(\.api) private var api
    @State private var store: NewsStore?
    @State private var isComposing = false

    var body: some View {
        Group {
            if let store {
                if let error = store.error, store.feed == nil {
                    ErrorStateView(error: error) { Task { await store.load() } }
                } else if let feed = store.feed {
                    content(feed, store: store)
                } else {
                    LoadingRows(count: 4)
                }
            } else {
                LoadingRows(count: 4)
            }
        }
        .background(Theme.background)
        .navigationTitle("Лента")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                // Публиковать может только владелец — сервер решает это сам,
                // и кнопка, которая гарантированно вернёт 403, здесь лишняя.
                if store?.feed?.canPublish == true {
                    Button { isComposing = true } label: {
                        Label("Пост", systemImage: "square.and.pencil")
                    }
                }
            }
            LogoutToolbarItem()
        }
        .sheet(isPresented: $isComposing) {
            if let store { NewsComposerSheet(store: store) }
        }
        .task { if store == nil { let s = NewsStore(api: api); store = s; await s.load() } }
        .refreshable { await store?.load() }
    }

    @ViewBuilder
    private func content(_ feed: NewsFeed, store: NewsStore) -> some View {
        if feed.posts.isEmpty {
            WideEmptyState(
                icon: "newspaper",
                title: "Новостей нет",
                message: feed.canPublish
                    ? "Опубликуйте первый пост — его увидит вся команда."
                    : "Здесь появятся объявления руководства."
            )
        } else {
            ScreenScroll {
                if let message = store.actionError {
                    Card(accent: Theme.negative) {
                        Label(message, systemImage: "exclamationmark.triangle")
                            .font(Typography.callout)
                            .foregroundStyle(Theme.negative)
                    }
                }

                if feed.unreadCount > 0 {
                    Card(accent: Theme.brand) {
                        HStack(spacing: Spacing.md) {
                            Image(systemName: "sparkles")
                                .font(.system(size: 16))
                                .foregroundStyle(Theme.brand)
                            Text("\(feed.unreadCount) \(pluralize(feed.unreadCount, "непрочитанный пост", "непрочитанных поста", "непрочитанных постов"))")
                                .font(Typography.callout)
                                .foregroundStyle(Theme.text)
                            Spacer()
                        }
                    }
                }

                if !feed.pinned.isEmpty {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        SectionHeader("Закреплено")
                        ForEach(feed.pinned) { post in
                            NewsPostCard(post: post, canDelete: feed.canPublish, store: store)
                        }
                    }
                }

                ForEach(FeedDay.group(feed.regular, date: { $0.createdAt })) { section in
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        FeedDayDivider(label: section.label)
                        ForEach(section.items) { post in
                            NewsPostCard(post: post, canDelete: feed.canPublish, store: store)
                        }
                    }
                }
            }
        }
    }
}

private struct NewsPostCard: View {
    let post: NewsPost
    let canDelete: Bool
    let store: NewsStore

    var body: some View {
        if canDelete {
            card.contextMenu {
                Button(role: .destructive) {
                    Task { await store.delete(post) }
                } label: {
                    Label("Удалить пост", systemImage: "trash")
                }
            }
        } else {
            card
        }
    }

    private var card: some View {
        Card(accent: post.isPinned ? Theme.brand : nil) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                HStack(spacing: Spacing.md) {
                    FeedAvatar(initials: post.initials, side: 38)

                    VStack(alignment: .leading, spacing: 1) {
                        Text(post.authorName)
                            .font(Typography.callout.weight(.medium))
                            .foregroundStyle(Theme.text)
                        if let created = post.createdAt {
                            Text(created.formatted(.dateTime.day().month(.abbreviated).hour().minute()))
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textDim)
                        }
                    }

                    Spacer(minLength: Spacing.sm)

                    if post.isPinned { StatusChip("закреплено", kind: .info) }
                    if !post.viewed { StatusChip("новое", kind: .good) }
                }

                if let title = post.title, !title.isEmpty {
                    Text(title)
                        .font(Typography.title)
                        .foregroundStyle(Theme.text)
                }

                if let image = post.imageURL, !image.isEmpty {
                    Thumbnail(url: image, side: 200, cornerRadius: Radius.md)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                if !post.blocks.isEmpty {
                    FeedBlocksView(blocks: post.blocks)
                }

                if let link = post.linkURL, let url = URL(string: link) {
                    Link(destination: url) {
                        Label(post.linkTitle, systemImage: "link")
                            .font(Typography.callout.weight(.medium))
                            .foregroundStyle(Theme.brand)
                    }
                }
            }
        }
        .task { await store.markViewed(post) }
    }
}

private struct NewsComposerSheet: View {
    let store: NewsStore
    @Environment(\.dismiss) private var dismiss

    @State private var title = ""
    @State private var postText = ""

    private var canPublish: Bool {
        !postText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !store.isPublishing
    }

    var body: some View {
        NavigationStack {
            ScreenScroll {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        SectionHeader("Новый пост", subtitle: "Увидит вся команда")

                        TextField("Заголовок (необязательно)", text: $title)
                            .textFieldStyle(.plain)
                            .font(Typography.callout)
                            .foregroundStyle(Theme.text)
                            .padding(Spacing.md)
                            .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))

                        TextField("Текст поста", text: $postText, axis: .vertical)
                            .textFieldStyle(.plain)
                            .font(Typography.callout)
                            .foregroundStyle(Theme.text)
                            .lineLimit(6...14)
                            .padding(Spacing.md)
                            .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))

                        // Ограничение серверное: обрезать молча нельзя, иначе
                        // публикация упадёт уже после нажатия кнопки.
                        Text("\(postText.count) / 2000")
                            .font(Typography.caption)
                            .monospacedDigit()
                            .foregroundStyle(postText.count > 2000 ? Theme.negative : Theme.textDim)

                        if let message = store.actionError {
                            Text(message)
                                .font(Typography.caption)
                                .foregroundStyle(Theme.negative)
                        }
                    }
                }

                Button("Опубликовать") {
                    Task { if await store.publish(title: title, body: postText) { dismiss() } }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!canPublish || postText.count > 2000)
            }
            .background(Theme.background)
            .navigationTitle("Пост")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
            }
        }
    }
}

// ── Командный чат ────────────────────────────────────────────────────────────

@MainActor
@Observable
final class TeamChatStore {
    private(set) var feed: TeamChatFeed?
    private(set) var isLoading = false
    private(set) var error: APIError?
    private(set) var isSending = false
    private(set) var sendError: String?
    /// Отправленные, но ещё не подтверждённые сервером.
    private(set) var pending: [TeamChatMessage] = []

    private let service: FeedService

    init(api: APIClient) { service = FeedService(api: api) }

    /// Что показывать: пришедшее с сервера плюс своё, ещё летящее.
    var visible: [TeamChatMessage] { (feed?.visible ?? []) + pending }

    var lastMessageID: String? { visible.last?.id }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            feed = try await service.teamChat()
            error = nil
        } catch let e as APIError {
            error = e
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }

    /// Отправка без ожидания.
    ///
    /// Сообщение появляется в переписке сразу и помечается как летящее, поле
    /// очищается. Раньше здесь стоял `await` до ответа сервера и перезагрузка
    /// всей ленты: между нажатием и появлением текста проходила секунда с
    /// лишним, и человек успевал нажать второй раз.
    ///
    /// Возвращает `true` всегда: поле очищается сразу. Неудача вернёт текст
    /// обратно сама.
    @discardableResult
    func send(_ text: String, from senderName: String, role: String?) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }

        let draft = TeamChatMessage(pendingText: trimmed, senderName: senderName, senderRole: role)
        pending.append(draft)
        sendError = nil

        Task { [weak self] in
            guard let self else { return }
            do {
                try await service.sendTeamMessage(trimmed)
                await load()
                pending.removeAll { $0.id == draft.id }
            } catch let e as APIError {
                // Фильтр мата отвечает 422: сообщение не ушло, и текст нужно
                // вернуть человеку, а не потерять молча.
                pending.removeAll { $0.id == draft.id }
                sendError = "\(e.userMessage)\n\n\(trimmed)"
            } catch {
                pending.removeAll { $0.id == draft.id }
                sendError = "\(error.localizedDescription)\n\n\(trimmed)"
            }
        }
        return true
    }
}

/// Общий чат команды.
struct TeamChatScreen: View {
    @Environment(\.api) private var api
    @Environment(AuthStore.self) private var auth

    @State private var store: TeamChatStore?
    @State private var draft = ""

    private var myUserID: String? { auth.session?.userID }

    var body: some View {
        VStack(spacing: 0) {
            if let store {
                if let error = store.error, store.feed == nil {
                    ErrorStateView(error: error) { Task { await store.load() } }
                } else if let feed = store.feed {
                    messages(feed, store: store)
                } else {
                    LoadingRows(count: 6)
                }

                FeedComposer(
                    text: $draft,
                    placeholder: "Написать команде",
                    isSending: store.isSending,
                    errorText: store.sendError
                ) {
                    // Очищаем поле сразу: сообщение уже в переписке, а на
                    // сервер летит фоном.
                    let text = draft
                    draft = ""
                    store.send(text, from: auth.role?.displayName ?? "Вы", role: auth.role?.staffRole)
                }
            } else {
                LoadingRows(count: 6)
            }
        }
        .background(Theme.background)
        .navigationTitle("Командный чат")
        .toolbar { LogoutToolbarItem() }
        .task { if store == nil { let s = TeamChatStore(api: api); store = s; await s.load() } }
    }

    @ViewBuilder
    private func messages(_ feed: TeamChatFeed, store: TeamChatStore) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: Spacing.md) {
                    if !feed.pinned.isEmpty {
                        pinnedCard(feed.pinned)
                    }

                    if store.visible.isEmpty {
                        InlineEmpty(icon: "bubble.left.and.bubble.right", text: "Сообщений пока нет")
                    }

                    // Свои летящие сообщения показываем вместе с пришедшими —
                    // иначе набранный текст исчезает до ответа сервера.
                    ForEach(FeedDay.group(store.visible, date: { $0.createdAt })) { section in
                        FeedDayDivider(label: section.label)

                        ForEach(section.items) { message in
                            if message.isAnnouncement {
                                announcement(message)
                            } else {
                                FeedBubble(
                                    text: message.displayText,
                                    senderName: message.senderName,
                                    roleLabel: message.roleLabel,
                                    time: message.createdAt,
                                    isMine: isMine(message),
                                    isEdited: message.isEdited,
                                    avatarURL: message.senderAvatarURL,
                                    attachments: message.attachments,
                                    replyPreview: replyPreview(for: message, in: feed),
                                    reactions: message.reactionGroups
                                )
                                .id(message.id)
                            }
                        }
                    }
                }
                .padding(Spacing.lg)
            }
            .refreshable { await store.load() }
            .onChange(of: store.lastMessageID) { _, id in
                guard let id else { return }
                withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(id, anchor: .bottom) }
            }
        }
    }

    private func isMine(_ message: TeamChatMessage) -> Bool {
        guard let myUserID, let sender = message.senderUserID else { return false }
        return sender == myUserID
    }

    /// Текст сообщения, на которое отвечают. Без него ответ в общем чате
    /// повисает в воздухе: «да, согласен» через двадцать реплик ничего не значит.
    private func replyPreview(for message: TeamChatMessage, in feed: TeamChatFeed) -> String? {
        guard let replyToID = message.replyToID, let source = feed.message(id: replyToID) else { return nil }
        return "\(source.senderName): \(FeedText.preview(source.text, limit: 70))"
    }

    private func pinnedCard(_ pinned: [TeamChatMessage]) -> some View {
        // Закрепление — не тревога: тот же бренд-акцент, что у закреплённого
        // поста в ленте новостей. Янтарный остаётся за предупреждениями.
        Card(accent: Theme.brand) {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                SectionHeader("Закреплено")
                ForEach(pinned) { message in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(message.senderName)
                            .font(Typography.caption.weight(.semibold))
                            .foregroundStyle(Theme.textDim)
                        Text(message.displayText)
                            .font(Typography.callout)
                            .foregroundStyle(Theme.text)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    private func announcement(_ message: TeamChatMessage) -> some View {
        Card(accent: Theme.brand) {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                HStack(spacing: Spacing.sm) {
                    Image(systemName: "megaphone.fill")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.brand)
                    Text(message.senderName)
                        .font(Typography.caption.weight(.semibold))
                        .foregroundStyle(Theme.text)
                    Spacer()
                    if let created = message.createdAt {
                        Text(created.formatted(.dateTime.hour().minute()))
                            .font(Typography.caption)
                            .monospacedDigit()
                            .foregroundStyle(Theme.textDim)
                    }
                }
                Text(message.displayText)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.textMuted)
            }
        }
        .id(message.id)
    }
}

// ── Личные сообщения ─────────────────────────────────────────────────────────

@MainActor
@Observable
final class MessagesStore {
    private(set) var threads: [DirectThread] = []
    private(set) var isLoading = false
    private(set) var error: APIError?

    private(set) var conversation: [DirectMessage] = []
    private(set) var openedUserID: String?
    private(set) var isLoadingConversation = false
    private(set) var conversationError: APIError?

    private(set) var isSending = false
    private(set) var sendError: String?

    private let service: FeedService

    init(api: APIClient) { service = FeedService(api: api) }

    var lastMessageID: String? { conversation.last?.id }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            threads = try await service.threads().threads
            error = nil
        } catch let e as APIError {
            error = e
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }

    func open(_ userID: String) async {
        // Смена собеседника обязана обнулить ленту: иначе на долю секунды
        // чужая переписка отрисуется под именем нового контакта.
        if openedUserID != userID {
            conversation = []
            sendError = nil
        }
        openedUserID = userID

        isLoadingConversation = true
        defer { isLoadingConversation = false }
        do {
            conversation = try await service.conversation(with: userID).visible
            conversationError = nil
        } catch let e as APIError {
            conversationError = e
        } catch {
            conversationError = .transport(message: error.localizedDescription)
        }
    }

    /// Отправка без ожидания: письмо появляется в переписке сразу, на сервер
    /// уходит фоном. Раньше между нажатием и появлением текста проходила
    /// секунда с лишним — её съедала проверка текста через ИИ на сервере.
    @discardableResult
    func send(_ text: String, to userID: String, senderName: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }

        let draft = DirectMessage(pendingText: trimmed, to: userID, senderName: senderName)
        conversation.append(draft)
        sendError = nil

        Task { [weak self] in
            guard let self else { return }
            do {
                try await service.sendDirect(to: userID, text: trimmed)
                await open(userID)
                await load()
            } catch let e as APIError {
                conversation.removeAll { $0.id == draft.id }
                sendError = "\(e.userMessage)\n\n\(trimmed)"
            } catch {
                conversation.removeAll { $0.id == draft.id }
                sendError = "\(error.localizedDescription)\n\n\(trimmed)"
            }
        }
        return true
    }
}

/// Личная переписка: список контактов и лента сообщений.
///
/// Новых собеседников выбирать негде — сервер отдаёт только уже начатые
/// переписки. Начать первым можно с сайта; здесь это чтение и ответ.
struct MessagesScreen: View {
    @Environment(\.api) private var api
    @State private var store: MessagesStore?
    @State private var selected: DirectThread?

    var body: some View {
        Group {
            if let store {
                if let error = store.error, store.threads.isEmpty {
                    ErrorStateView(error: error) { Task { await store.load() } }
                } else if store.isLoading && store.threads.isEmpty {
                    LoadingRows(count: 6)
                } else {
                    MasterDetail(
                        items: store.threads,
                        selection: $selected,
                        listWidth: 320
                    ) { thread in
                        ThreadRow(thread: thread)
                    } detail: { thread in
                        ConversationPane(thread: thread, store: store)
                    } empty: {
                        WideEmptyState(
                            icon: "envelope",
                            title: "Переписок нет",
                            message: "Здесь появятся личные сообщения от коллег."
                        )
                    }
                }
            } else {
                LoadingRows(count: 6)
            }
        }
        .background(Theme.background)
        .navigationTitle("Сообщения")
        .toolbar { LogoutToolbarItem() }
        .task { if store == nil { let s = MessagesStore(api: api); store = s; await s.load() } }
        .refreshable { await store?.load() }
    }
}

private struct ThreadRow: View {
    let thread: DirectThread

    var body: some View {
        HStack(spacing: Spacing.md) {
            FeedAvatar(initials: thread.initials, side: 38, tint: thread.hasUnread ? Theme.brand : Theme.info)

            VStack(alignment: .leading, spacing: 1) {
                Text(thread.otherName)
                    .font(Typography.callout.weight(thread.hasUnread ? .semibold : .regular))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)

                HStack(spacing: Spacing.xs) {
                    if thread.lastFromMe {
                        Image(systemName: "arrowshape.turn.up.right")
                            .font(.system(size: 9))
                            .foregroundStyle(Theme.textDim)
                    }
                    Text(thread.preview)
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: Spacing.sm)

            VStack(alignment: .trailing, spacing: Spacing.xs) {
                if let last = thread.lastAt {
                    Text(last.formatted(.dateTime.day().month(.abbreviated)))
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                }
                if thread.unreadCount > 0 {
                    Text("\(thread.unreadCount)")
                        .font(Typography.caption.weight(.bold))
                        .monospacedDigit()
                        .foregroundStyle(Theme.background)
                        .padding(.horizontal, Spacing.sm)
                        .padding(.vertical, 2)
                        .background(Theme.brand, in: Capsule())
                }
            }
        }
    }
}

private struct ConversationPane: View {
    let thread: DirectThread
    let store: MessagesStore

    @State private var draft = ""

    /// Переписка загружена именно для этого собеседника. Пустой список сам по
    /// себе ещё ничего не значит: тем же он выглядит до первого ответа сервера.
    private var isReady: Bool {
        store.openedUserID == thread.otherUserID && !store.isLoadingConversation
    }

    var body: some View {
        VStack(spacing: 0) {
            if let error = store.conversationError, store.conversation.isEmpty {
                ErrorStateView(error: error) { Task { await store.open(thread.otherUserID) } }
            } else if store.conversation.isEmpty && !isReady {
                LoadingRows(count: 5)
            } else if store.conversation.isEmpty {
                WideEmptyState(
                    icon: "bubble.left",
                    title: "Пока пусто",
                    message: "Напишите \(thread.otherName) первым."
                )
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: Spacing.md) {
                            ForEach(FeedDay.group(store.conversation, date: { $0.createdAt })) { section in
                                FeedDayDivider(label: section.label)
                                ForEach(section.items) { message in
                                    FeedBubble(
                                        text: message.displayText,
                                        senderName: message.senderName,
                                        time: message.createdAt,
                                        isMine: message.isMine(otherUserID: thread.otherUserID),
                                        isEdited: message.isEdited,
                                        showsSender: false,
                                        attachments: message.attachments
                                    )
                                    .id(message.id)
                                }
                            }
                        }
                        .padding(Spacing.lg)
                    }
                    .onChange(of: store.lastMessageID) { _, id in
                        guard let id else { return }
                        withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(id, anchor: .bottom) }
                    }
                }
            }

            FeedComposer(
                text: $draft,
                placeholder: "Сообщение для \(thread.otherName)",
                isSending: store.isSending,
                errorText: store.sendError
            ) {
                // Поле очищаем сразу: письмо уже в переписке.
                let text = draft
                draft = ""
                store.send(text, to: thread.otherUserID, senderName: "Вы")
            }
        }
        .background(Theme.background)
        .navigationTitle(thread.otherName)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task(id: thread.otherUserID) { await store.open(thread.otherUserID) }
    }
}

// ── Календарь ────────────────────────────────────────────────────────────────

@MainActor
@Observable
final class TeamCalendarStore {
    private(set) var month = FeedCalendarMonth()
    private(set) var calendar: TeamCalendar?
    private(set) var isLoading = false
    private(set) var error: APIError?

    var selectedDay: String?
    var hiddenKinds: Set<TeamCalendarEventKind> = []

    private let service: FeedService

    init(api: APIClient) { service = FeedService(api: api) }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            calendar = try await service.calendar(from: month.fromKey, to: month.toKey)
            error = nil
        } catch let e as APIError {
            error = e
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }

    func step(_ months: Int) async {
        month = month.shifted(by: months)
        selectedDay = nil
        await load()
    }

    func toggle(_ kind: TeamCalendarEventKind) {
        if hiddenKinds.contains(kind) { hiddenKinds.remove(kind) } else { hiddenKinds.insert(kind) }
    }

    func events(on dayKey: String) -> [TeamCalendarEvent] {
        (calendar?.events(on: dayKey) ?? []).filter { !hiddenKinds.contains($0.kind) }
    }
}

/// Календарь команды: смены, дни рождения, праздники РК и объявления.
///
/// Сетка месяца, а не список: дырка в расписании — день, на который никого не
/// поставили, — в списке просто отсутствует и потому невидима. В сетке это
/// пустая клетка между занятыми, и её видно с одного взгляда.
struct CalendarScreen: View {
    @Environment(\.api) private var api
    @State private var store: TeamCalendarStore?

    var body: some View {
        Group {
            if let store {
                if let error = store.error, store.calendar == nil {
                    ErrorStateView(error: error) { Task { await store.load() } }
                } else {
                    content(store)
                }
            } else {
                LoadingRows(count: 5)
            }
        }
        .background(Theme.background)
        .navigationTitle("Календарь")
        .toolbar { LogoutToolbarItem() }
        .task { if store == nil { let s = TeamCalendarStore(api: api); store = s; await s.load() } }
        .refreshable { await store?.load() }
    }

    private func content(_ store: TeamCalendarStore) -> some View {
        ScreenScroll {
            Card {
                HStack(spacing: Spacing.md) {
                    Button { Task { await store.step(-1) } } label: {
                        Image(systemName: "chevron.left").font(.system(size: 14, weight: .semibold))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.brand)

                    Spacer()

                    Text(store.month.title)
                        .font(Typography.headline)
                        .foregroundStyle(Theme.text)

                    Spacer()

                    Button { Task { await store.step(1) } } label: {
                        Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.brand)
                }
            }

            Card {
                VStack(spacing: Spacing.md) {
                    CalendarMonthGrid(store: store)

                    RowDivider()

                    // Фильтры под сеткой: они уточняют уже увиденное, а не
                    // предваряют его. Наверху они бы отодвинули сам календарь.
                    HStack(spacing: Spacing.sm) {
                        ForEach(TeamCalendarEventKind.allCases.filter { $0 != .other }, id: \.self) { kind in
                            FilterChip(title: kind.label, isOn: !store.hiddenKinds.contains(kind)) {
                                store.toggle(kind)
                            }
                        }
                        Spacer()
                    }
                }
            }

            selectedDayCard(store)
        }
    }

    @ViewBuilder
    private func selectedDayCard(_ store: TeamCalendarStore) -> some View {
        let dayKey = store.selectedDay ?? FeedDay.todayKey
        let events = store.events(on: dayKey)

        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader(
                    dayTitle(dayKey),
                    subtitle: events.isEmpty ? nil : "\(events.count) \(pluralize(events.count, "событие", "события", "событий"))"
                )

                if events.isEmpty {
                    InlineEmpty(icon: "calendar", text: "На этот день ничего не назначено", tint: Theme.textDim)
                } else {
                    ForEach(Array(events.enumerated()), id: \.element.id) { index, event in
                        if index > 0 { RowDivider() }
                        CalendarEventRow(event: event)
                    }
                }
            }
        }
    }

    private func dayTitle(_ dayKey: String) -> String {
        guard let date = DateParsing.parseDateOnly(dayKey) else { return dayKey }
        return date.formatted(.dateTime.weekday(.wide).day().month(.wide)).capitalized
    }
}

private struct CalendarMonthGrid: View {
    let store: TeamCalendarStore

    private let columns = Array(repeating: GridItem(.flexible(), spacing: Spacing.xs), count: 7)

    var body: some View {
        VStack(spacing: Spacing.sm) {
            HStack(spacing: Spacing.xs) {
                ForEach(FeedCalendarMonth.weekdayTitles, id: \.self) { title in
                    Text(title)
                        .font(Typography.caption.weight(.semibold))
                        .foregroundStyle(Theme.textDim)
                        .frame(maxWidth: .infinity)
                }
            }

            LazyVGrid(columns: columns, spacing: Spacing.xs) {
                ForEach(store.month.days, id: \.self) { day in
                    let key = store.month.key(for: day)
                    CalendarDayCell(
                        number: store.month.dayNumber(day),
                        events: store.events(on: key),
                        isCurrentMonth: store.month.isInMonth(day),
                        isToday: key == FeedDay.todayKey,
                        isSelected: key == store.selectedDay
                    )
                    .contentShape(Rectangle())
                    .onTapGesture { store.selectedDay = key }
                }
            }
        }
    }
}

private struct CalendarDayCell: View {
    let number: Int
    let events: [TeamCalendarEvent]
    let isCurrentMonth: Bool
    let isToday: Bool
    let isSelected: Bool

    /// По одной точке на вид события, а не на каждое: три ночные смены подряд
    /// дают три одинаковые точки и ничего не сообщают сверх одной.
    private var kinds: [TeamCalendarEventKind] {
        var seen: [TeamCalendarEventKind] = []
        for event in events where !seen.contains(event.kind) { seen.append(event.kind) }
        return Array(seen.prefix(4))
    }

    var body: some View {
        VStack(spacing: Spacing.xs) {
            Text("\(number)")
                .font(Typography.caption.weight(isToday ? .bold : .regular))
                .monospacedDigit()
                .foregroundStyle(numberColor)

            HStack(spacing: 2) {
                if kinds.isEmpty {
                    Circle().fill(Color.clear).frame(width: 4, height: 4)
                } else {
                    ForEach(kinds, id: \.self) { kind in
                        Circle()
                            .fill(feedTint(for: kind))
                            .frame(width: 4, height: 4)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, minHeight: 42)
        .padding(.vertical, Spacing.xs)
        .background(background)
        .clipShape(RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Radius.sm, style: .continuous)
                .strokeBorder(isToday ? Theme.brand.opacity(0.5) : Color.clear, lineWidth: 1)
        )
    }

    private var numberColor: Color {
        if !isCurrentMonth { return Theme.textDim.opacity(0.5) }
        return isToday ? Theme.brand : Theme.text
    }

    private var background: Color {
        if isSelected { return Theme.brand.opacity(0.16) }
        if isToday { return Theme.brand.opacity(0.08) }
        return isCurrentMonth ? Theme.surfaceRaised : Color.clear
    }
}

private struct CalendarEventRow: View {
    let event: TeamCalendarEvent

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            Image(systemName: event.kind.icon)
                .font(.system(size: 13))
                .foregroundStyle(feedTint(for: event.kind))
                .frame(width: 22)

            VStack(alignment: .leading, spacing: 1) {
                Text(event.cleanTitle)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                if let subtitle = event.subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textMuted)
                }
                if let author = event.author, !author.isEmpty {
                    Text(author)
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                }
            }

            Spacer(minLength: Spacing.sm)
        }
    }
}

// ── Модерация ИИ ─────────────────────────────────────────────────────────────

@MainActor
@Observable
final class ModerationStore {
    private(set) var list: ModerationFlagList?
    private(set) var isLoading = false
    private(set) var error: APIError?
    private(set) var actingID: String?
    private(set) var actionError: String?

    var status: ModerationStatus = .pending

    private let service: FeedService

    init(api: APIClient) { service = FeedService(api: api) }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            list = try await service.moderation(status: status)
            error = nil
        } catch let e as APIError {
            error = e
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }

    func review(_ flag: ModerationFlag, as decision: ModerationStatus) async {
        actingID = flag.id
        defer { actingID = nil }
        do {
            try await service.reviewFlag(id: flag.id, status: decision)
            actionError = nil
            await load()
        } catch let e as APIError {
            actionError = e.userMessage
        } catch {
            actionError = error.localizedDescription
        }
    }
}

/// Флаги ИИ-модерации чатов.
///
/// Сортировку задаёт сервер — сначала по тяжести, потом по свежести. Своя
/// сортировка на клиенте разошлась бы с бейджем «на рассмотрении» на сайте.
struct ModerationScreen: View {
    @Environment(\.api) private var api
    @Environment(\.access) private var access
    @State private var store: ModerationStore?
    @State private var selected: ModerationFlag?

    /// Те же права, что проверяет карточка и сервер.
    private var canConfirm: Bool { access?.can("moderation.confirm") == true }
    private var canDismiss: Bool { access?.can("moderation.dismiss") == true }

    var body: some View {
        Group {
            if let store {
                content(store)
            } else {
                LoadingRows(count: 5)
            }
        }
        .background(Theme.background)
        .navigationTitle("Модерация ИИ")
        .toolbar { LogoutToolbarItem() }
        .task { if store == nil { let s = ModerationStore(api: api); store = s; await s.load() } }
        .refreshable { await store?.load() }
    }

    private func content(_ store: ModerationStore) -> some View {
        @Bindable var bindable = store

        return VStack(spacing: 0) {
            Picker("Статус", selection: $bindable.status) {
                ForEach(ModerationStatus.allCases) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.md)
            .onChange(of: store.status) { _, _ in
                selected = nil
                Task { await store.load() }
            }

            if let error = store.error, store.list == nil {
                ErrorStateView(error: error) { Task { await store.load() } }
            } else if store.isLoading && store.list == nil {
                LoadingRows(count: 5)
            } else {
                MasterDetail(
                    items: store.list?.flags ?? [],
                    selection: $selected,
                    listWidth: 340,
                    actions: { flag in
                        // Те же два решения, что и в карточке, и по тем же
                        // правам. Модерация — это разбор очереди: открывать
                        // каждый флаг ради одного нажатия долго.
                        guard flag.isPending else { return [] }
                        var result: [RowAction] = []
                        if canDismiss {
                            result.append(
                                RowAction("Отклонить", icon: "xmark.circle", tint: Theme.textDim) {
                                    Task { await store.review(flag, as: .dismissed) }
                                }
                            )
                        }
                        if canConfirm {
                            result.append(
                                RowAction("Нарушение", icon: "exclamationmark.triangle", isDestructive: true) {
                                    Task { await store.review(flag, as: .confirmed) }
                                }
                            )
                        }
                        return result
                    }
                ) { flag in
                    ModerationFlagRow(flag: flag)
                } detail: { flag in
                    // Разобранный флаг уходит из текущего списка, и выделение
                    // должно уйти вместе с ним — иначе справа висит карточка,
                    // которой в списке слева больше нет.
                    ModerationFlagDetail(flag: flag, store: store) { selected = nil }
                } empty: {
                    WideEmptyState(
                        icon: store.status == .pending ? "checkmark.shield" : "tray",
                        title: store.status == .pending ? "Всё чисто" : "Список пуст",
                        message: store.status == .pending
                            ? "ИИ не нашёл подозрительных сообщений."
                            : "Здесь появятся разобранные флаги."
                    )
                }
            }
        }
    }
}

private struct ModerationFlagRow: View {
    let flag: ModerationFlag

    var body: some View {
        HStack(spacing: Spacing.md) {
            Text("\(flag.severity)")
                .font(.system(size: 15, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(severityColor)
                .frame(width: 34, height: 34)
                .background(severityColor.opacity(0.14), in: Circle())

            VStack(alignment: .leading, spacing: 1) {
                Text(flag.authorName)
                    .font(Typography.callout.weight(.medium))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text(FeedText.preview(flag.messageText, limit: 60))
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }

            Spacer(minLength: Spacing.sm)

            if let category = flag.categoryLabels.first {
                StatusChip(category, kind: flag.isCritical ? .danger : .warning)
            }
        }
    }

    private var severityColor: Color {
        if flag.isCritical { return Theme.negative }
        if flag.isSerious { return Theme.warning }
        return Theme.textMuted
    }
}

private struct ModerationFlagDetail: View {
    let flag: ModerationFlag
    let store: ModerationStore
    let onReviewed: () -> Void

    @Environment(\.access) private var access

    private var canConfirm: Bool { access?.can("moderation.confirm") == true }
    private var canDismiss: Bool { access?.can("moderation.dismiss") == true }

    var body: some View {
        ScreenScroll {
            Card(accent: flag.isCritical ? Theme.negative : nil) {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    HStack(alignment: .top, spacing: Spacing.md) {
                        FeedAvatar(initials: flag.initials, side: 42, tint: Theme.negative)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(flag.authorName)
                                .font(Typography.title)
                                .foregroundStyle(Theme.text)
                            Text(flag.sourceLabel)
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textDim)
                        }

                        Spacer()

                        StatusChip(
                            "тяжесть \(flag.severity)",
                            kind: flag.isCritical ? .danger : (flag.isSerious ? .warning : .neutral)
                        )
                    }

                    if !flag.categoryLabels.isEmpty {
                        HStack(spacing: Spacing.sm) {
                            ForEach(flag.categoryLabels, id: \.self) { label in
                                StatusChip(label, kind: .warning)
                            }
                            Spacer()
                        }
                    }

                    RowDivider()

                    if let created = flag.createdAt {
                        StatRow(
                            "Отправлено",
                            value: created.formatted(.dateTime.day().month(.abbreviated).hour().minute()),
                            icon: "clock"
                        )
                    }
                }
            }

            Card {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    SectionHeader("Сообщение")
                    Text(FeedText.display(flag.messageText))
                        .font(Typography.body)
                        .foregroundStyle(Theme.text)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }

            if let summary = flag.aiSummary, !summary.isEmpty {
                Card(accent: Theme.warning) {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        Label("Анализ ИИ", systemImage: "sparkles")
                            .font(Typography.caption.weight(.semibold))
                            .foregroundStyle(Theme.warning)
                        Text(summary)
                            .font(Typography.callout)
                            .foregroundStyle(Theme.textMuted)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }

            if let note = flag.reviewerNote, !note.isEmpty {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        SectionHeader("Заметка проверяющего")
                        Text(note)
                            .font(Typography.callout)
                            .foregroundStyle(Theme.textMuted)
                    }
                }
            }

            if let message = store.actionError {
                Text(message)
                    .font(Typography.caption)
                    .foregroundStyle(Theme.negative)
            }

            // Решение по флагу — отдельные права. Без них сервер ответит 403,
            // а кнопка, которая заведомо не сработает, только злит.
            if flag.isPending {
                if canConfirm || canDismiss {
                    HStack(spacing: Spacing.md) {
                        if canDismiss {
                            Button("Отклонить") {
                                Task { await store.review(flag, as: .dismissed); onReviewed() }
                            }
                            .buttonStyle(SecondaryButtonStyle())
                        }

                        if canConfirm {
                            Button("Подтвердить нарушение") {
                                Task { await store.review(flag, as: .confirmed); onReviewed() }
                            }
                            .buttonStyle(DestructiveButtonStyle())
                        }
                    }
                    .disabled(store.actingID == flag.id)
                } else {
                    Card {
                        InlineEmpty(
                            icon: "lock.fill",
                            text: "Решение по флагу принимает сотрудник с правом модерации",
                            tint: Theme.textDim
                        )
                    }
                }
            }
        }
        .background(Theme.background)
        .navigationTitle("Флаг")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}
