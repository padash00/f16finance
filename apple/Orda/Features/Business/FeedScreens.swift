import OrdaKit
import OrdaUI
import PhotosUI
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
struct FeedAvatar: View {
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

                case .tableHeader:
                    Text(block.text.uppercased())
                        .font(Typography.label)
                        .foregroundStyle(Theme.textDim)

                case .tableRow:
                    // Новость может прийти таблицей из редактора сайта. Без
                    // отдельной ветки ячейки склеивались в одну строку.
                    VStack(alignment: .leading, spacing: 2) {
                        if let head = block.cells.first {
                            Text(head)
                                .font(Typography.body.weight(.semibold))
                                .foregroundStyle(Theme.text)
                        }
                        ForEach(Array(block.cells.dropFirst().enumerated()), id: \.offset) { _, cell in
                            Text(cell)
                                .font(Typography.body)
                                .foregroundStyle(Theme.textMuted)
                        }
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
    var poll: ChatPoll?
    /// Нажатие на имя или аватар автора. Пусто — имя не нажимается.
    var openSender: (() -> Void)?
    var vote: (String) -> Void = { _ in }
    /// Нажатие на уже стоящую реакцию — свой голос за неё или снятие своего.
    var react: (String) -> Void = { _ in }

    /// Угол со стороны автора почти прямой — так реплика читается как
    /// направленная, а не как ещё одна плитка в ленте.
    private var bubbleShape: UnevenRoundedRectangle {
        UnevenRoundedRectangle(
            topLeadingRadius: Radius.md,
            bottomLeadingRadius: isMine ? Radius.md : Radius.sm / 2,
            bottomTrailingRadius: isMine ? Radius.sm / 2 : Radius.md,
            topTrailingRadius: Radius.md,
            style: .continuous
        )
    }

    var body: some View {
        HStack(alignment: .bottom, spacing: Spacing.sm) {
            if isMine { Spacer(minLength: Spacing.xxl) }

            if !isMine && showsSender {
                let avatar = FeedAvatar(
                    initials: FeedText.initials(senderName),
                    side: 30,
                    tint: Theme.info,
                    photoURL: avatarURL
                )
                if let openSender {
                    Button(action: openSender) { avatar }
                        .buttonStyle(.pressable)
                } else {
                    avatar
                }
            } else if !isMine {
                Color.clear.frame(width: 30, height: 1)
            }

            VStack(alignment: isMine ? .trailing : .leading, spacing: Spacing.xs) {
                if !isMine && showsSender {
                    let header = HStack(spacing: Spacing.xs) {
                        Text(senderName)
                            .font(Typography.caption.weight(.semibold))
                            .foregroundStyle(openSender == nil ? Theme.text : Theme.brand)
                        if let roleLabel {
                            Text(roleLabel)
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textDim)
                        }
                    }

                    if let openSender {
                        // Имя в чате — вход в карточку человека: спросить «кто
                        // это и как с ним связаться» проще всего там, где его
                        // и увидел.
                        Button(action: openSender) { header.contentShape(Rectangle()) }
                            .buttonStyle(.pressable)
                    } else {
                        header
                    }
                }

                if let replyPreview, !replyPreview.isEmpty {
                    HStack(alignment: .top, spacing: Spacing.sm) {
                        RoundedRectangle(cornerRadius: 1.5)
                            .fill(isMine ? Theme.onBrand.opacity(0.7) : Theme.brand.opacity(0.6))
                            .frame(width: 3)
                        Text(replyPreview)
                            .font(Typography.caption)
                            .foregroundStyle(isMine ? Theme.onBrand.opacity(0.8) : Theme.textDim)
                            .lineLimit(2)
                    }
                }

                if !text.isEmpty {
                    Text(text)
                        .font(Typography.callout)
                        // Чужой текст был серым — он читался как второстепенный,
                        // хотя это и есть содержание сообщения.
                        .foregroundStyle(isMine ? Theme.onBrand : Theme.text)
                        .multilineTextAlignment(.leading)
                        .textSelection(.enabled)
                }

                ForEach(attachments) { attachment in
                    if attachment.isImage {
                        Thumbnail(url: attachment.url, side: 140, cornerRadius: Radius.sm)
                    } else if attachment.isAudio {
                        VoiceAttachmentView(attachment: attachment, isMine: isMine)
                    } else if !attachment.isPoll {
                        // Опрос рисуется карточкой ниже — вложение у него
                        // служебное, и «📊 Опрос» второй строкой только шумит.
                        Label(attachment.label, systemImage: "paperclip")
                            .font(Typography.caption)
                            .foregroundStyle(isMine ? Theme.onBrand.opacity(0.85) : Theme.textDim)
                    }
                }

                if let poll {
                    PollCard(poll: poll, vote: vote)
                }

                HStack(spacing: Spacing.sm) {
                    if !reactions.isEmpty {
                        ForEach(reactions) { group in
                            Button { react(group.emoji) } label: {
                                Text(group.count > 1 ? "\(group.emoji) \(group.count)" : group.emoji)
                                    .font(Typography.caption)
                                    .padding(.horizontal, Spacing.sm)
                                    .padding(.vertical, 2)
                                    .background(Theme.surfaceRaised, in: Capsule())
                            }
                            .buttonStyle(.pressable)
                            .transition(.scale.combined(with: .opacity))
                        }
                    }
                    if isEdited {
                        Text("изменено")
                            .font(Typography.caption)
                            .foregroundStyle(isMine ? Theme.onBrand.opacity(0.7) : Theme.textDim)
                    }
                    if let time {
                        Text(time.formatted(.dateTime.hour().minute()))
                            .font(Typography.caption)
                            .monospacedDigit()
                            .foregroundStyle(isMine ? Theme.onBrand.opacity(0.7) : Theme.textDim)
                    }
                }
            }
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, Spacing.sm)
            // Свой пузырь — плотный цвет, чужой — светлый. Раньше оба были
            // почти одинаковыми (свой — та же подложка с прозрачностью 14% и
            // рамкой), и понять, где чья реплика, можно было только по краю.
            // Рамок нет намеренно: они превращают реплику в карточку.
            .background(isMine ? Theme.brand : Theme.surface, in: bubbleShape)
            .frame(maxWidth: 520, alignment: isMine ? .trailing : .leading)

            if !isMine { Spacer(minLength: Spacing.xxl) }
        }
    }
}

/// Поле ввода с кнопкой отправки.
///
/// Кроме текста умеет то, чего в смене не хватало острее всего: фотографию
/// (показать, что именно сломалось, быстрее, чем описать словами), голосовое
/// (руки заняты, а сказать — три секунды), опрос («кто выходит в субботу») и
/// упоминание с уведомлением.
private struct FeedComposer: View {
    @Binding var text: String
    var placeholder: String = "Сообщение"
    var isSending: Bool
    var errorText: String?
    /// Ничего из дополнительного нет у личной переписки: там всё это либо не
    /// нужно (опрос вдвоём), либо пока не поддержано сервером.
    var extras: ComposerExtras?
    let send: () -> Void

    #if os(iOS)
    @State private var recorder = VoiceRecorder()
    @State private var photoItem: PhotosPickerItem?
    #endif
    @State private var isPickingMention = false
    @State private var isMakingPoll = false

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

            #if os(iOS)
            if recorder.isRecording {
                recordingBar
            }
            #endif

            if let extras, !isRecordingNow {
                HStack(spacing: Spacing.lg) {
                    #if os(iOS)
                    PhotosPicker(selection: $photoItem, matching: .images) {
                        Image(systemName: "photo")
                    }
                    #endif
                    // Упоминание в переписке вдвоём бессмысленно: собеседник
                    // и так получит уведомление на каждое сообщение.
                    if extras.allowsMentions {
                        Button { isPickingMention = true } label: { Image(systemName: "at") }
                    }
                    if extras.createPoll != nil {
                        Button { isMakingPoll = true } label: { Image(systemName: "chart.bar") }
                    }
                    Spacer()
                }
                .font(.system(size: 17))
                .foregroundStyle(Theme.textDim)
                .buttonStyle(.pressable)
                .sheet(isPresented: $isPickingMention) {
                    MentionPicker { name in
                        // Пробел в конце — чтобы дальше сразу писать текст, а
                        // не упираться в слипшееся «@Асельпринял».
                        text += (text.isEmpty || text.hasSuffix(" ") ? "" : " ") + "@\(name) "
                    }
                }
                .sheet(isPresented: $isMakingPoll) {
                    if let createPoll = extras.createPoll {
                        PollComposerSheet(create: createPoll)
                    }
                }
                #if os(iOS)
                .onChange(of: photoItem) { _, item in
                    guard let item else { return }
                    Task {
                        defer { photoItem = nil }
                        guard let data = try? await item.loadTransferable(type: Data.self) else { return }
                        _ = await extras.sendFile(data, "photo.jpg", "image/jpeg", "image")
                    }
                }
                #endif
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

                #if os(iOS)
                // Микрофон вместо стрелки, пока поле пустое: так же ведут себя
                // все мессенджеры, и лишней кнопки в тесной строке не нужно.
                if let extras, !canSend, !isSending {
                    Button {
                        Task { await toggleRecording(extras) }
                    } label: {
                        Image(systemName: recorder.isRecording ? "stop.circle.fill" : "mic.circle.fill")
                            .font(.system(size: 26))
                            .foregroundStyle(recorder.isRecording ? Theme.negative : Theme.textDim)
                    }
                    .buttonStyle(.pressable)
                } else {
                    sendButton
                }
                #else
                sendButton
                #endif
            }
        }
        .padding(Spacing.lg)
        .background(Theme.background)
        .overlay(alignment: .top) {
            Rectangle().fill(Theme.border).frame(height: 1)
        }
    }

    private var sendButton: some View {
        Button(action: send) {
            Image(systemName: isSending ? "hourglass" : "arrow.up.circle.fill")
                .font(.system(size: 26))
                .foregroundStyle(canSend ? Theme.brand : Theme.textDim)
        }
        .buttonStyle(.pressable)
        .disabled(!canSend)
    }

    private var isRecordingNow: Bool {
        #if os(iOS)
        recorder.isRecording
        #else
        false
        #endif
    }

    #if os(iOS)
    private var recordingBar: some View {
        HStack(spacing: Spacing.md) {
            Circle().fill(Theme.negative).frame(width: 8, height: 8)
            Text("Запись \(VoiceRecorder.format(recorder.duration))")
                .font(Typography.caption.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(Theme.text)
            Spacer()
            Button("Отменить") { recorder.cancel() }
                .font(Typography.caption)
                .foregroundStyle(Theme.textDim)
        }
        .padding(.horizontal, Spacing.sm)
    }

    private func toggleRecording(_ extras: ComposerExtras) async {
        if recorder.isRecording {
            guard let result = recorder.stop() else { return }
            Haptics.tap()
            _ = await extras.sendFile(
                result.data,
                "voice-\(VoiceRecorder.format(result.duration).replacingOccurrences(of: ":", with: "-")).m4a",
                "audio/mp4",
                "audio"
            )
        } else {
            await recorder.start()
            Haptics.tap()
        }
    }
    #endif
}

/// Что композер умеет сверх текста. Отдельным типом, чтобы личная переписка
/// могла ничего этого не передавать.
struct ComposerExtras {
    /// data, имя файла, MIME, вид вложения → текст ошибки или `nil`.
    let sendFile: (Data, String, String, String) async -> String?
    /// `nil` — опросов здесь не бывает.
    let createPoll: ((String, [String]) async -> String?)?
    var allowsMentions: Bool = false
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
    /// На какое сообщение отвечаем. Цитату чат показывал давно, а ответить
    /// было нельзя — половина механизма.
    var replyTo: TeamChatMessage?

    private let service: FeedService
    private var searchTask: Task<Void, Never>?

    init(api: APIClient) { service = FeedService(api: api) }

    /// Что показывать: пришедшее с сервера плюс своё, ещё летящее.
    var visible: [TeamChatMessage] { (feed?.visible ?? []) + pending }

    var lastMessageID: String? { visible.last?.id }

    func load() async {
        // Прошлая лента — сразу. Поиск не кэшируем: там ждут именно ответа на
        // запрос, а не вчерашних сообщений.
        if feed == nil, search.isEmpty, let cached = await service.cachedTeamChat() {
            feed = cached
        }

        isLoading = feed == nil
        defer { isLoading = false }
        do {
            feed = try await service.teamChat(search: search)
            error = nil
        } catch let e as APIError {
            error = e
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
    }

    /// Тихое обновление: без скелета и без сброса того, что человек уже читает.
    func refresh() async {
        guard !isSending else { return }
        guard let fresh = try? await service.teamChat(search: search) else { return }
        feed = fresh
    }

    /// Поиск по чату. Ищет сервер — по тексту и по имени отправителя.
    var search = "" {
        didSet {
            guard oldValue != search else { return }
            searchTask?.cancel()
            searchTask = Task { [weak self] in
                // Небольшая пауза: иначе запрос уходит на каждую букву.
                try? await Task.sleep(for: .milliseconds(350))
                guard !Task.isCancelled else { return }
                await self?.load()
            }
        }
    }

    /// Реакция. Свою ставим сразу, не дожидаясь сервера: значок под пальцем
    /// должен отзываться мгновенно.
    func react(to messageID: String, emoji: String) {
        Task { [weak self] in
            guard let self else { return }
            try? await service.react(messageID: messageID, emoji: emoji)
            await refresh()
        }
    }

    func edit(_ messageID: String, text: String) async -> String? {
        do {
            try await service.editTeamMessage(id: messageID, text: text)
            await load()
            return nil
        } catch let e as APIError {
            return e.userMessage
        } catch {
            return error.localizedDescription
        }
    }

    /// Жалоба на сообщение. Молча: отправитель об этом не узнает, а владелец
    /// увидит её в модерации.
    func report(_ messageID: String) {
        Task { [weak self] in
            try? await self?.service.report(messageID: messageID, source: "team_chat")
        }
    }

    func delete(_ messageID: String) {
        Task { [weak self] in
            guard let self else { return }
            try? await service.deleteTeamMessage(id: messageID)
            await load()
        }
    }

    /// Закрепление на сутки — обычный срок объявления по смене.
    func pin(_ messageID: String, isPinned: Bool) {
        Task { [weak self] in
            guard let self else { return }
            if isPinned {
                try? await service.unpinTeamMessage(id: messageID)
            } else {
                try? await service.pinTeamMessage(id: messageID, until: Date().addingTimeInterval(24 * 3600))
            }
            await load()
        }
    }

    /// Голос в опросе. Список перечитываем: доли и имена меняются у всех.
    func vote(pollID: String, optionID: String) {
        Task { [weak self] in
            guard let self else { return }
            do {
                try await service.vote(pollID: pollID, optionID: optionID)
                await load()
            } catch let e as APIError {
                sendError = e.userMessage
            } catch {
                sendError = error.localizedDescription
            }
        }
    }

    func createPoll(question: String, options: [String]) async -> String? {
        do {
            try await service.createPoll(question: question, options: options)
            await load()
            return nil
        } catch let e as APIError {
            return e.userMessage
        } catch {
            return error.localizedDescription
        }
    }

    /// Отправка файла: фото, голосовое, документ.
    ///
    /// Здесь ждём ответа, в отличие от текста: файл летит секунды, и показать
    /// «уже отправлено» раньше времени значило бы соврать.
    func sendAttachment(
        data: Data,
        fileName: String,
        mimeType: String,
        kind: String,
        caption: String = ""
    ) async -> String? {
        isSending = true
        defer { isSending = false }
        sendError = nil

        do {
            let uploaded = try await service.upload(
                data: data,
                fileName: fileName,
                mimeType: mimeType,
                kind: kind
            )
            try await service.sendTeamMessage(caption, attachments: [uploaded])
            await load()
            await flushAttachments()
            return nil
        } catch let e as APIError {
            if case .transport = e {
                // Снимают ровно там, где связи нет: подсобка, склад. Файл
                // кладём на диск и отправим сами — потерять фото поломки
                // хуже, чем потерять текст.
                await attachments.add(
                    AttachmentOutbox.Item(
                        scope: .teamChat,
                        fileName: fileName,
                        mimeType: mimeType,
                        kind: kind,
                        caption: caption
                    ),
                    data: data
                )
                await refreshUndeliveredAttachments()
                sendError = "Нет связи. Файл сохранён и уйдёт сам."
                return nil
            }
            sendError = e.userMessage
            return e.userMessage
        } catch {
            sendError = error.localizedDescription
            return error.localizedDescription
        }
    }

    /// Что не ушло из-за связи. Ждёт своей очереди, а не теряется.
    private(set) var undelivered: [String] = []

    /// Файлы, не ушедшие из-за связи.
    private let attachments = AttachmentOutbox()
    private(set) var undeliveredAttachments: [AttachmentOutbox.Item] = []

    func refreshUndeliveredAttachments() async {
        undeliveredAttachments = await attachments.pending().filter { $0.scope == .teamChat }
    }

    /// Дослать файлы. Саму отправку делает очередь: чат и личная переписка
    /// иначе держали бы две копии одного и того же.
    func flushAttachments() async {
        let sent = await attachments.flush(using: service)
        await refreshUndeliveredAttachments()
        if sent > 0 { await load() }
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
                try await service.sendTeamMessage(trimmed, replyToID: replyTo?.id)
                replyTo = nil
                await load()
                pending.removeAll { $0.id == draft.id }
                // Связь появилась — дошлём то, что застряло раньше.
                await flushUndelivered()
            } catch let e as APIError {
                pending.removeAll { $0.id == draft.id }
                if case .transport = e {
                    // Связи нет: текст не теряем и человека не заставляем
                    // набирать заново. В клубе интернет рвётся по несколько раз
                    // за смену, и «отправьте ещё раз» — плохой ответ.
                    undelivered.append(trimmed)
                    sendError = "Нет связи. Сообщение отправится само, когда появится интернет."
                } else {
                    // Фильтр мата отвечает 422: сообщение не ушло по существу,
                    // и текст нужно вернуть человеку, а не досылать молча.
                    sendError = "\(e.userMessage)\n\n\(trimmed)"
                }
            } catch {
                pending.removeAll { $0.id == draft.id }
                sendError = "\(error.localizedDescription)\n\n\(trimmed)"
            }
        }
        return true
    }

    /// Дослать застрявшее. Порядок сохраняем: разговор без него рассыпается.
    func flushUndelivered() async {
        guard !undelivered.isEmpty else { return }
        let queue = undelivered
        undelivered = []

        for text in queue {
            do {
                try await service.sendTeamMessage(text)
            } catch {
                // Связь всё ещё не вернулась: кладём остаток обратно и ждём
                // следующего повода.
                undelivered.append(text)
            }
        }

        if undelivered.isEmpty {
            sendError = nil
            await load()
        }
    }
}

/// Общий чат команды.
/// Человек, чью карточку открыли из чата.
struct ChatPerson: Identifiable, Hashable {
    let name: String
    let roleLabel: String?
    let avatarURL: String?
    let userID: String?

    var id: String { (userID ?? "") + name }
}

struct TeamChatScreen: View {
    @Environment(\.api) private var api
    @Environment(AuthStore.self) private var auth

    /// Кого открыли по имени в чате.
    @State private var person: ChatPerson?
    /// Ленту уже довели до последнего сообщения при открытии.
    @State private var didPinToBottom = false

    @Environment(\.access) private var access

    @State private var store: TeamChatStore?
    @State private var draft = ""
    /// Сообщение, которое правим. Не флаг: лист должен знать, какое именно.
    @State private var editing: TeamChatMessage?
    @State private var editText = ""
    /// Сообщение, с которым работают: реакции и действия.
    @State private var acting: TeamChatMessage?

    private var myUserID: String? { auth.session?.userID }

    /// Закрепление — отдельное право, как и на сервере: объявление в чате
    /// команды вправе повесить не каждый.
    private var canPin: Bool { access?.can("team-chat.pin") ?? false }

    var body: some View {
        VStack(spacing: 0) {
            if let store {
                if let error = store.error, store.feed == nil {
                    ErrorStateView(error: error) { Task { await store.load() } }
                } else if let feed = store.feed {
                    messages(feed, store: store)
                } else {
                    // Загрузку видно словами, а не только серыми полосами: на
                    // светлой теме скелет почти не отличается от фона, и
                    // застрявший экран выглядит просто пустым — не понять,
                    // сломалось что-то или сообщений нет.
                    VStack(spacing: Spacing.md) {
                        ProgressView()
                        Text("Загружаем переписку…")
                            .font(Typography.callout)
                            .foregroundStyle(Theme.textMuted)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }

                if !store.undeliveredAttachments.isEmpty {
                    Label(
                        "\(store.undeliveredAttachments.count) \(pluralize(store.undeliveredAttachments.count, "файл ждёт", "файла ждут", "файлов ждут")) связи",
                        systemImage: "photo.badge.arrow.down"
                    )
                    .font(Typography.caption)
                    .foregroundStyle(Theme.warning)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, Spacing.lg)
                    .padding(.vertical, Spacing.xs)
                }

                if !store.undelivered.isEmpty {
                    // Молчаливая очередь пугает сильнее ошибки: человек не
                    // понимает, ушло сообщение или нет.
                    Label(
                        "\(store.undelivered.count) \(pluralize(store.undelivered.count, "сообщение ждёт", "сообщения ждут", "сообщений ждут")) связи",
                        systemImage: "arrow.clockwise"
                    )
                    .font(Typography.caption)
                    .foregroundStyle(Theme.warning)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, Spacing.lg)
                    .padding(.vertical, Spacing.xs)
                }

                if let reply = store.replyTo {
                    ReplyBar(message: reply) { store.replyTo = nil }
                }

                FeedComposer(
                    text: $draft,
                    placeholder: "Написать команде",
                    isSending: store.isSending,
                    errorText: store.sendError,
                    extras: ComposerExtras(
                        sendFile: { data, name, mime, kind in
                            await store.sendAttachment(
                                data: data,
                                fileName: name,
                                mimeType: mime,
                                kind: kind
                            )
                        },
                        createPoll: { question, options in
                            await store.createPoll(question: question, options: options)
                        },
                        allowsMentions: true
                    )
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
        .sheet(item: $person) { who in
            ChatPersonSheet(
                name: who.name,
                roleLabel: who.roleLabel,
                avatarURL: who.avatarURL,
                userID: who.userID
            )
        }
        .navigationTitle("Командный чат")
        #if os(iOS)
        // Непрозрачная шапка: под прозрачной проезжали пузыри, и заголовок
        // читался поверх чужого сообщения вперемешку с кнопкой профиля.
        .toolbarBackground(.visible, for: .navigationBar)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        // Поиск по чату: сервер ищет и по тексту, и по имени отправителя.
        // «Кто говорил про поставщика» иначе листают руками за неделю.
        .searchable(
            text: Binding(
                get: { store?.search ?? "" },
                set: { store?.search = $0 }
            ),
            prompt: "Найти в переписке"
        )
        .toolbar { LogoutToolbarItem() }
        .sheet(item: $editing) { message in
            EditMessageSheet(text: $editText) { text in
                await store?.edit(message.id, text: text)
            }
        }
        // Действия — листом, а не системным меню.
        //
        // В системном меню реакции выстраиваются в вертикальный столбик по
        // одному значку в строке: пять пунктов, каждый с одной картинкой. Ряд
        // значков в строку — то, как это выглядит везде, и то, чего ждёт рука.
        .sheet(item: $acting) { message in
            MessageActionsSheet(
                message: message,
                canPin: canPin,
                isMine: isMine(message),
                react: { emoji in store?.react(to: message.id, emoji: emoji) },
                reply: { store?.replyTo = message },
                pin: { store?.pin(message.id, isPinned: message.isPinned) },
                edit: {
                    editText = message.text
                    editing = message
                },
                remove: { store?.delete(message.id) },
                report: { store?.report(message.id) }
            )
        }
        .task { if store == nil { let s = TeamChatStore(api: api); store = s; await s.load() } }
        // Чат без самообновления — это не чат: сообщение сменщика видно только
        // после того, как экран закроют и откроют заново.
        // Живой поток: сервер сам говорит, когда появилось новое, и лента
        // обновляется в тот же миг. Соединение он закрывает через несколько
        // минут — открываем следующее.
        .task {
            while !Task.isCancelled {
                for await event in EventStream(api: api).events(
                    path: "/api/realtime/messages",
                    query: ["scope": "team"]
                ) {
                    if Task.isCancelled { return }
                    if event == .message { await store?.refresh() }
                }
                if Task.isCancelled { return }
                // Пауза перед новым соединением: если сервер недоступен,
                // долбиться в него без остановки — худшее, что можно сделать.
                try? await Task.sleep(for: .seconds(2))
            }
        }
        // Страховка на случай, когда поток не дошёл: сеть в подвале клуба
        // рвётся, а сообщение всё равно должно появиться.
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(15))
                if Task.isCancelled { return }
                await store?.refresh()
                // Связь есть, раз лента обновилась: самое время дослать то,
                // что не ушло, — и текст, и файлы.
                await store?.flushUndelivered()
                await store?.flushAttachments()
            }
        }
    }

    @ViewBuilder
    private func messages(_ feed: TeamChatFeed, store: TeamChatStore) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                // Обычный VStack, а не ленивый.
                //
                // Ленивая лента на первом кадре не знает высоты своих ячеек:
                // «низ» для неё — не там, где он окажется через мгновение, и
                // чат открывался пустотой, а сообщения находили, листая вниз.
                // Ни якорь, ни явная прокрутка этого не лечат — они целятся в
                // ещё не измеренную ленту.
                //
                // Здесь это дёшево: переписка живёт сутки и чистится по ночам,
                // поэтому сообщений десятки, а не десятки тысяч.
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    // Чат живёт сутки — человек должен знать заранее. Иначе
                    // исчезнувшая переписка читается как потеря данных, а
                    // важное продолжают писать сюда вместо задач.
                    Text("Сообщения старше суток удаляются. Закреплённые и объявления остаются.")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.bottom, Spacing.xs)

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

                        ForEach(Array(section.items.enumerated()), id: \.element.id) { index, message in
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
                                    showsSender: startsGroup(at: index, in: section.items),
                                    avatarURL: message.senderAvatarURL,
                                    attachments: message.attachments,
                                    replyPreview: replyPreview(for: message, in: feed),
                                    reactions: message.reactionGroups,
                                    poll: feed.poll(for: message),
                                    openSender: {
                                        person = ChatPerson(
                                            name: message.senderName,
                                            roleLabel: message.roleLabel,
                                            avatarURL: message.senderAvatarURL,
                                            userID: message.senderUserID
                                        )
                                    },
                                    vote: { optionID in
                                        guard let poll = feed.poll(for: message) else { return }
                                        store.vote(pollID: poll.id, optionID: optionID)
                                    },
                                    react: { emoji in
                                        Haptics.tap()
                                        store.react(to: message.id, emoji: emoji)
                                    }
                                )
                                .id(message.id)
                                .padding(.top, startsGroup(at: index, in: section.items) ? Spacing.sm : 0)
                                .transition(.move(edge: .bottom).combined(with: .opacity))
                                .onLongPressGesture {
                                    Haptics.tap()
                                    acting = message
                                }
                            }
                        }
                    }
                }
                .padding(Spacing.lg)
            }
            // Открывают чат ради последнего сообщения, а не первого.
            .defaultScrollAnchor(.bottom)
            #if os(iOS)
            .scrollDismissesKeyboard(.interactively)
            #endif
            .refreshable { await store.load() }
            .onChange(of: store.lastMessageID) { _, id in
                guard let id else { return }
                withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(id, anchor: .bottom) }
            }
            // Одного якоря ленивой ленте мало: на первом кадревысота ячеек
            // ещё неизвестна, и чат открывался пустотой — сообщения лежали
            // ниже экрана, и их находили, только листая вниз.
            .task(id: store.visible.last?.id) {
                guard !didPinToBottom, let id = store.visible.last?.id else { return }
                proxy.scrollTo(id, anchor: .bottom)
                // Второй проход — когда ленивые ячейки уложились и высота
                // ленты стала настоящей.
                try? await Task.sleep(for: .milliseconds(150))
                proxy.scrollTo(id, anchor: .bottom)
                didPinToBottom = true
            }
        }
    }

    /// Начинается ли новая реплика — или это продолжение той же.
    ///
    /// Человек в чате пишет очередями: три строки подряд за полминуты. Аватар
    /// и имя над каждой из них превращают ленту в перечень карточек — в
    /// мессенджерах их показывают только у первой. Пять минут — обычный
    /// порог: после паузы это уже другая реплика, даже если автор тот же.
    private func startsGroup(at index: Int, in items: [TeamChatMessage]) -> Bool {
        guard index > 0 else { return true }
        let current = items[index]
        let previous = items[index - 1]
        if previous.isAnnouncement { return true }
        if previous.senderName != current.senderName { return true }
        guard let left = previous.createdAt, let right = current.createdAt else { return true }
        return right.timeIntervalSince(left) > 5 * 60
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
        // Сначала то, что видели в прошлый раз: список появляется сразу, а
        // скелет на пол-экрана при каждом входе — главная причина ощущения,
        // что приложение «думает».
        if threads.isEmpty, let cached = await service.cachedThreads() {
            threads = cached.threads
        }

        isLoading = threads.isEmpty
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

        // Прошлая переписка — сразу, свежая — следом. Разговор, который
        // открывается пустым экраном с крутилкой, читается как сломанный.
        if conversation.isEmpty, let cached = await service.cachedConversation(with: userID) {
            conversation = cached.visible
        }

        isLoadingConversation = conversation.isEmpty
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

    /// Тихое обновление открытой переписки.
    ///
    /// Без «загружаем»: экран уже показан, и мигать скелетом каждые восемь
    /// секунд значит мешать читать.
    func refreshConversation(_ userID: String) async {
        guard openedUserID == userID, !isSending else { return }
        guard let fresh = try? await service.conversation(with: userID) else { return }
        conversation = fresh.messages
    }

    /// Кого я заблокировал.
    ///
    /// Требование App Store к приложениям с перепиской: прекратить общение
    /// человек должен уметь сам, не дожидаясь, пока владелец разберёт жалобу.
    private(set) var blocked: Set<String> = []

    func loadBlocked() async {
        blocked = Set((try? await service.blockedUsers()) ?? [])
    }

    func setBlocked(_ isBlocked: Bool, userID: String) async {
        do {
            try await service.setBlocked(isBlocked, userID: userID)
            if isBlocked { blocked.insert(userID) } else { blocked.remove(userID) }
        } catch let e as APIError {
            sendError = e.userMessage
        } catch {
            sendError = error.localizedDescription
        }
    }

    func report(messageID: String) {
        Task { [weak self] in
            try? await self?.service.report(messageID: messageID, source: "direct_messages")
        }
    }

    /// Файл в личную переписку: фото или голосовое. Ждём ответа — файл летит
    /// секунды, и «уже отправлено» раньше времени было бы неправдой.
    func sendAttachment(
        data: Data,
        fileName: String,
        mimeType: String,
        kind: String,
        to userID: String
    ) async -> String? {
        sendError = nil
        do {
            let uploaded = try await service.upload(
                data: data,
                fileName: fileName,
                mimeType: mimeType,
                kind: kind
            )
            try await service.sendDirect(to: userID, text: "", attachments: [uploaded])
            await open(userID)
            await load()
            await flushAttachments()
            return nil
        } catch let e as APIError {
            if case .transport = e {
                await attachments.add(
                    AttachmentOutbox.Item(
                        scope: .direct,
                        recipientUserID: userID,
                        fileName: fileName,
                        mimeType: mimeType,
                        kind: kind,
                        caption: ""
                    ),
                    data: data
                )
                await refreshUndeliveredAttachments()
                sendError = "Нет связи. Файл сохранён и уйдёт сам."
                return nil
            }
            sendError = e.userMessage
            return e.userMessage
        } catch {
            sendError = error.localizedDescription
            return error.localizedDescription
        }
    }

    /// Что не ушло из-за связи: кому и что. Ждёт своей очереди.
    private(set) var undelivered: [(userID: String, text: String)] = []

    /// Файлы, не ушедшие из-за связи.
    private let attachments = AttachmentOutbox()
    private(set) var undeliveredAttachments: [AttachmentOutbox.Item] = []

    func refreshUndeliveredAttachments() async {
        undeliveredAttachments = await attachments.pending().filter { $0.scope == .direct }
    }

    func flushAttachments() async {
        let sent = await attachments.flush(using: service)
        await refreshUndeliveredAttachments()
        guard sent > 0 else { return }
        if let openedUserID { await open(openedUserID) }
        await load()
    }

    /// Дослать застрявшее — по порядку, чтобы разговор не рассыпался.
    func flushUndelivered() async {
        guard !undelivered.isEmpty else { return }
        let queue = undelivered
        undelivered = []

        for item in queue {
            do {
                try await service.sendDirect(to: item.userID, text: item.text)
            } catch {
                undelivered.append(item)
            }
        }

        if undelivered.isEmpty {
            sendError = nil
            if let openedUserID { await open(openedUserID) }
            await load()
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
                await flushUndelivered()
            } catch let e as APIError {
                conversation.removeAll { $0.id == draft.id }
                if case .transport = e {
                    // Связи нет — письмо не теряем: дошлём, когда появится.
                    undelivered.append((userID, trimmed))
                    sendError = "Нет связи. Сообщение отправится само, когда появится интернет."
                    return
                }
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
    @State private var isChoosing = false
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
                            message: "Нажмите «плюс», чтобы написать первым."
                        )
                    }
                }
            } else {
                LoadingRows(count: 6)
            }
        }
        .background(Theme.background)
        .navigationTitle("Сообщения")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { isChoosing = true } label: { Image(systemName: "square.and.pencil") }
            }
            LogoutToolbarItem()
        }
        .task { if store == nil { let s = MessagesStore(api: api); store = s; await s.load() } }
        .refreshable { await store?.load() }
        .sheet(isPresented: $isChoosing) {
            ContactPickerSheet { contact in
                Task {
                    // Переписки может ещё не быть: открываем её сразу, чтобы
                    // человек попал в разговор, а не обратно в пустой список.
                    await store?.open(contact.userID)
                    await store?.load()
                    selected = store?.threads.first { $0.otherUserID == contact.userID }
                        ?? DirectThread(placeholderFor: contact)
                }
            }
        }
    }
}

/// Выбор собеседника.
///
/// Личные сообщения умели только отвечать: адресата взять было неоткуда, и
/// написать первым мог лишь тот, кому уже написали. Список ограничен своей
/// организацией — оператор чужой сюда не попадёт, как и не пройдёт проверку
/// при отправке.
private struct ContactPickerSheet: View {
    let onPick: (DirectContact) -> Void

    @Environment(\.api) private var api
    @Environment(\.dismiss) private var dismiss

    @State private var contacts: [DirectContact] = []
    @State private var search = ""
    @State private var isLoading = true
    @State private var error: APIError?

    var body: some View {
        NavigationStack {
            Group {
                if let error, contacts.isEmpty, error.looksMissingOnServer {
                    // Сайт старше приложения: раздел уже есть в сборке, но
                    // сервер о нём не знает. Это не поломка у человека.
                    EmptyStateView(
                        icon: "clock.arrow.circlepath",
                        title: "Скоро появится",
                        message: "Выбор собеседника заработает после обновления сайта. Пока можно отвечать в существующих переписках."
                    )
                } else if let error, contacts.isEmpty {
                    ErrorStateView(error: error) { Task { await load() } }
                } else if isLoading && contacts.isEmpty {
                    LoadingRows(count: 6)
                } else if filtered.isEmpty {
                    EmptyStateView(
                        icon: "person.2.slash",
                        title: search.isEmpty ? "Писать некому" : "Никого не нашлось",
                        message: search.isEmpty
                            ? "В организации пока нет других людей с учётной записью."
                            : "Попробуйте другое имя."
                    )
                } else {
                    List(filtered) { contact in
                        Button {
                            onPick(contact)
                            dismiss()
                        } label: {
                            NavigationRow(
                                icon: contact.isOperator ? "person.crop.circle" : "person.text.rectangle",
                                iconColor: Theme.brand,
                                title: contact.name,
                                subtitle: contact.roleLabel
                            )
                        }
                        .buttonStyle(.pressable)
                        .listRowInsets(EdgeInsets(top: Spacing.xs, leading: Spacing.lg, bottom: Spacing.xs, trailing: Spacing.lg))
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                }
            }
            .background(Theme.background)
            .navigationTitle("Кому написать")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .searchable(text: $search, prompt: "Имя")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
            }
            .task { await load() }
        }
    }

    private var filtered: [DirectContact] {
        let query = search.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else { return contacts }
        return contacts.filter { $0.name.localizedCaseInsensitiveContains(query) }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            contacts = try await FeedService(api: api).contacts()
            error = nil
        } catch let apiError as APIError {
            error = apiError
        } catch {
            self.error = .transport(message: error.localizedDescription)
        }
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

struct ConversationPane: View {
    /// Открыта ли карточка собеседника.
    /// Переписку уже довели до последнего сообщения при открытии.
    @State private var didPinToBottom = false
    @State private var showingPerson = false

    let thread: DirectThread
    let store: MessagesStore

    @Environment(\.api) private var api

    @State private var draft = ""
    @State private var confirmingBlock = false

    private var isBlocked: Bool { store.blocked.contains(thread.otherUserID) }

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
                        // Не ленивый — по той же причине, что и в командном
                        // чате: иначе переписка открывается пустым экраном.
                        VStack(alignment: .leading, spacing: Spacing.md) {
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
                                    .transition(.move(edge: .bottom).combined(with: .opacity))
                                    // Пожаловаться можно и здесь: травля чаще
                                    // случается один на один, а не при всех.
                                    .contextMenu {
                                        if !message.isMine(otherUserID: thread.otherUserID) {
                                            Button(role: .destructive) {
                                                store.report(messageID: message.id)
                                                Haptics.tap()
                                            } label: {
                                                Label("Пожаловаться", systemImage: "flag")
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        .padding(Spacing.lg)
                    }
                    // Переписку открывают, чтобы прочитать последнее, а не
                    // первое: начало сверху означало пролистать весь разговор.
                    .defaultScrollAnchor(.bottom)
                    #if os(iOS)
                    .scrollDismissesKeyboard(.interactively)
                    #endif
                    .onChange(of: store.lastMessageID) { _, id in
                        guard let id else { return }
                        withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(id, anchor: .bottom) }
                    }
                    // Тот же довод, что и в командном чате: ленивая лента на
                    // первом кадре не знает своей высоты, и якоря не хватает.
                    .task(id: store.conversation.last?.id) {
                        guard !didPinToBottom, let id = store.conversation.last?.id else { return }
                        proxy.scrollTo(id, anchor: .bottom)
                        try? await Task.sleep(for: .milliseconds(150))
                        proxy.scrollTo(id, anchor: .bottom)
                        didPinToBottom = true
                    }
                }
            }

            if isBlocked {
                // Пока заблокирован — писать некуда: сервер такое сообщение
                // отвергнет, и поле ввода обещало бы несуществующее.
                HStack(spacing: Spacing.sm) {
                    Image(systemName: "hand.raised.fill")
                        .foregroundStyle(Theme.textDim)
                    Text("Вы заблокировали этого человека. Снимите блокировку, чтобы написать.")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textMuted)
                    Spacer(minLength: 0)
                }
                .padding(Spacing.lg)
                .background(Theme.surfaceRaised)
            } else {
            FeedComposer(
                text: $draft,
                placeholder: "Сообщение для \(thread.otherName)",
                isSending: store.isSending,
                errorText: store.sendError,
                // Опрос вдвоём смысла не имеет — в личной переписке его нет.
                // Фото и голосовое есть: показать поломку или сказать на ходу
                // нужно и здесь.
                extras: ComposerExtras(
                    sendFile: { data, name, mime, kind in
                        await store.sendAttachment(
                            data: data,
                            fileName: name,
                            mimeType: mime,
                            kind: kind,
                            to: thread.otherUserID
                        )
                    },
                    createPoll: nil
                )
            ) {
                // Поле очищаем сразу: письмо уже в переписке.
                let text = draft
                draft = ""
                _ = store.send(text, to: thread.otherUserID, senderName: "Вы")
            }
            }
        }
        .background(Theme.background)
        .navigationTitle("")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .sheet(isPresented: $showingPerson) {
            ChatPersonSheet(
                name: thread.otherName,
                roleLabel: nil,
                avatarURL: nil,
                userID: thread.otherUserID
            )
        }
        // Блокировка и жалоба — там же, где всё остальное про собеседника.
        .toolbar {
            // Имя в шапке — вход в карточку: «кто это, где работает, на смене
            // ли» спрашивают прямо посреди переписки.
            ToolbarItem(placement: .principal) {
                Button {
                    showingPerson = true
                } label: {
                    Text(thread.otherName)
                        .font(Typography.headline)
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                }
                .buttonStyle(.pressable)
            }

            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button(role: isBlocked ? nil : .destructive) {
                        confirmingBlock = true
                    } label: {
                        Label(
                            isBlocked ? "Разблокировать" : "Заблокировать",
                            systemImage: isBlocked ? "person.crop.circle.badge.checkmark" : "hand.raised"
                        )
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .confirmationDialog(
            isBlocked ? "Разблокировать \(thread.otherName)?" : "Заблокировать \(thread.otherName)?",
            isPresented: $confirmingBlock,
            titleVisibility: .visible
        ) {
            Button(isBlocked ? "Разблокировать" : "Заблокировать", role: isBlocked ? nil : .destructive) {
                Task { await store.setBlocked(!isBlocked, userID: thread.otherUserID) }
            }
            Button("Отмена", role: .cancel) {}
        } message: {
            Text(isBlocked
                ? "Сообщения снова будут доходить."
                : "Его сообщения перестанут доходить. Он об этом не узнает.")
        }
        #if os(iOS)
        // Непрозрачная шапка: иначе под ней проезжают пузыри и имя собеседника
        // читается поверх чужого сообщения.
        .toolbarBackground(.visible, for: .navigationBar)
        #endif
        .task(id: thread.otherUserID) { await store.open(thread.otherUserID) }
        .task { await store.loadBlocked() }
        // Ответ должен появляться сам. Иначе переписка выглядит сломанной:
        // человек смотрит в экран, ему ответили, а он тянет список вниз.
        .task(id: thread.otherUserID) {
            while !Task.isCancelled {
                for await event in EventStream(api: api).events(
                    path: "/api/realtime/messages",
                    query: ["scope": "direct", "peer": thread.otherUserID]
                ) {
                    if Task.isCancelled { return }
                    if event == .message { await store.refreshConversation(thread.otherUserID) }
                }
                if Task.isCancelled { return }
                try? await Task.sleep(for: .seconds(2))
            }
        }
        .task(id: thread.otherUserID) {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(15))
                if Task.isCancelled { return }
                await store.refreshConversation(thread.otherUserID)
                await store.flushUndelivered()
                await store.flushAttachments()
            }
        }
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
                    .buttonStyle(.pressable)
                    .foregroundStyle(Theme.brand)

                    Spacer()

                    Text(store.month.title)
                        .font(Typography.headline)
                        .foregroundStyle(Theme.text)

                    Spacer()

                    Button { Task { await store.step(1) } } label: {
                        Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold))
                    }
                    .buttonStyle(.pressable)
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
