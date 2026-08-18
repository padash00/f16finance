import AVFoundation
import OrdaKit
import OrdaUI
import SwiftUI

// ── Голосовое в переписке ────────────────────────────────────────────────────

/// Проигрывание голосового.
///
/// Один проигрыватель на приложение: два одновременно звучащих голосовых в
/// чате — это не «параллельно послушал», а каша, из которой не разобрать ни
/// одно.
@MainActor
@Observable
final class VoicePlayer {
    static let shared = VoicePlayer()

    private(set) var playingURL: String?
    private var player: AVPlayer?
    private var endObserver: NSObjectProtocol?

    private init() {}

    func toggle(url: String) {
        if playingURL == url {
            stop()
            return
        }
        guard let target = URL(string: url) else { return }

        stop()
        #if os(iOS)
        // Динамик, а не «наушник»: категория записи оставляет вывод на верхнем
        // разговорном динамике, и человек слышит еле-еле.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        try? AVAudioSession.sharedInstance().setActive(true)
        #endif

        let item = AVPlayerItem(url: target)
        let player = AVPlayer(playerItem: item)
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { _ in
            Task { @MainActor in VoicePlayer.shared.stop() }
        }

        self.player = player
        playingURL = url
        player.play()
    }

    func stop() {
        player?.pause()
        player = nil
        playingURL = nil
        if let endObserver {
            NotificationCenter.default.removeObserver(endObserver)
            self.endObserver = nil
        }
    }
}

/// Голосовое сообщение в пузыре.
struct VoiceAttachmentView: View {
    let attachment: FeedAttachment
    let isMine: Bool

    @State private var player = VoicePlayer.shared

    private var isPlaying: Bool { player.playingURL == attachment.url }

    var body: some View {
        Button {
            player.toggle(url: attachment.url)
        } label: {
            HStack(spacing: Spacing.sm) {
                // На своём пузыре всё поверх фирменного цвета: зелёная кнопка
                // на зелёном фоне не видна вовсе — от голосового оставалось
                // только имя файла.
                Image(systemName: isPlaying ? "pause.circle.fill" : "play.circle.fill")
                    .font(.system(size: 26))
                    .foregroundStyle(isMine ? Theme.onBrand : Theme.brand)

                // Волна нарисованная, а не настоящая: считать амплитуды на
                // каждое сообщение в списке — это секунды прокрутки, а смысла
                // ровно столько же.
                HStack(spacing: 2) {
                    ForEach(0..<18, id: \.self) { index in
                        Capsule()
                            .fill(
                                (isMine ? Theme.onBrand : Theme.brand)
                                    .opacity(isPlaying ? 0.9 : (isMine ? 0.55 : 0.35))
                            )
                            .frame(width: 2, height: waveHeight(index))
                    }
                }

                // Имя файла человеку не говорит ничего: «voice-0-08.m4a» — это
                // то, как его назвал телефон, а не то, что он услышит.
                Text("Голосовое")
                    .font(Typography.caption)
                    .foregroundStyle(isMine ? Theme.onBrand.opacity(0.8) : Theme.textDim)
            }
            .padding(.vertical, Spacing.xs)
        }
        .buttonStyle(.pressable)
    }

    private func waveHeight(_ index: Int) -> CGFloat {
        let pattern: [CGFloat] = [6, 12, 18, 10, 22, 14, 8, 16, 20, 11, 7, 15, 19, 9, 13, 17, 8, 6]
        return pattern[index % pattern.count]
    }
}

// ── Опрос ────────────────────────────────────────────────────────────────────

/// Опрос в переписке.
///
/// Голоса открытые: видно, кто за что. В чате смены опрос не про мнение, а про
/// «кто выходит в субботу», и анонимность здесь мешает.
struct PollCard: View {
    let poll: ChatPoll
    let vote: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text(poll.question)
                .font(Typography.callout.weight(.semibold))
                .foregroundStyle(Theme.text)
                .fixedSize(horizontal: false, vertical: true)

            ForEach(poll.options) { option in
                Button {
                    vote(option.id)
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Image(systemName: poll.hasVoted(for: option) ? "checkmark.circle.fill" : "circle")
                                .font(.system(size: 14))
                                .foregroundStyle(poll.hasVoted(for: option) ? Theme.brand : Theme.textDim)
                            Text(option.label)
                                .font(Typography.callout)
                                .foregroundStyle(Theme.text)
                                .multilineTextAlignment(.leading)
                            Spacer(minLength: Spacing.sm)
                            Text("\(poll.count(for: option))")
                                .font(Typography.caption.weight(.semibold))
                                .monospacedDigit()
                                .foregroundStyle(Theme.textDim)
                        }

                        GeometryReader { geometry in
                            ZStack(alignment: .leading) {
                                Capsule().fill(Theme.surfaceRaised)
                                Capsule()
                                    .fill(Theme.brand.opacity(0.35))
                                    .frame(width: max(0, geometry.size.width * poll.share(for: option)))
                            }
                        }
                        .frame(height: 4)

                        let names = poll.voterNames(for: option)
                        if !names.isEmpty {
                            Text(names.joined(separator: ", "))
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textDim)
                                .lineLimit(1)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.pressable)
            }

            Text("\(poll.totalVotes) \(pluralize(poll.totalVotes, "голос", "голоса", "голосов")) · нажмите ещё раз, чтобы снять")
                .font(Typography.caption)
                .foregroundStyle(Theme.textDim)
        }
        .padding(Spacing.md)
        .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
    }
}

/// Создание опроса.
struct PollComposerSheet: View {
    @Environment(\.dismiss) private var dismiss

    let create: (String, [String]) async -> String?

    @State private var question = ""
    @State private var options: [String] = ["", ""]
    @State private var isSending = false
    @State private var error: String?

    private var filled: [String] {
        options.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }

    private var canSend: Bool {
        !question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && filled.count >= 2
    }

    var body: some View {
        NavigationStack {
            ScreenScroll {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        FieldLabel("Вопрос")
                        TextField("Кто выходит в субботу?", text: $question, axis: .vertical)
                            .textFieldStyle(.plain)
                            .font(Typography.callout)
                            .foregroundStyle(Theme.text)
                            .lineLimit(1...3)
                            .padding(Spacing.md)
                            .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))

                        FieldLabel("Варианты")
                        ForEach(options.indices, id: \.self) { index in
                            HStack(spacing: Spacing.sm) {
                                TextField("Вариант \(index + 1)", text: $options[index])
                                    .textFieldStyle(.plain)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.text)
                                    .padding(Spacing.md)
                                    .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))

                                if options.count > 2 {
                                    Button(role: .destructive) {
                                        options.remove(at: index)
                                    } label: {
                                        Image(systemName: "minus.circle")
                                    }
                                    .buttonStyle(.pressable)
                                    .foregroundStyle(Theme.negative)
                                }
                            }
                        }

                        // Десять — предел сервера. Больше вариантов в чате
                        // всё равно не читают.
                        if options.count < 10 {
                            Button {
                                options.append("")
                            } label: {
                                Label("Добавить вариант", systemImage: "plus")
                            }
                            .buttonStyle(SecondaryButtonStyle())
                        }

                        if let error {
                            Text(error)
                                .font(Typography.caption)
                                .foregroundStyle(Theme.negative)
                        }

                        Button(isSending ? "Отправляем…" : "Создать опрос") {
                            Task {
                                isSending = true
                                defer { isSending = false }
                                if let failure = await create(question, filled) {
                                    error = failure
                                } else {
                                    dismiss()
                                }
                            }
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(!canSend || isSending)
                    }
                }
            }
            .background(Theme.background)
            .navigationTitle("Опрос")
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

// ── Упоминания ───────────────────────────────────────────────────────────────

/// Выбор, кого упомянуть.
///
/// В общем чате точки за смену десятки сообщений, и адресованное конкретному
/// человеку тонет. Упомянутый получает уведомление; `@все` зовёт всю смену.
struct MentionPicker: View {
    @Environment(\.api) private var api
    @Environment(\.dismiss) private var dismiss

    let pick: (String) -> Void

    @State private var contacts: [DirectContact] = []
    @State private var search = ""
    @State private var isLoading = true

    private var filtered: [DirectContact] {
        let query = search.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else { return contacts }
        return contacts.filter { $0.name.localizedCaseInsensitiveContains(query) }
    }

    var body: some View {
        NavigationStack {
            List {
                Button {
                    pick("все")
                    dismiss()
                } label: {
                    Label("Все на точке", systemImage: "person.3.fill")
                        .font(Typography.callout)
                        .foregroundStyle(Theme.text)
                }

                if isLoading && contacts.isEmpty {
                    ForEach(0..<4, id: \.self) { _ in
                        Skeleton(height: 20, cornerRadius: Radius.sm)
                    }
                } else {
                    ForEach(filtered) { contact in
                        Button {
                            // Упоминаем первым словом: «@Асель», а не
                            // «@Асель Кадырова» — пробел разорвал бы упоминание.
                            pick(contact.name.split(separator: " ").first.map(String.init) ?? contact.name)
                            dismiss()
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(contact.name)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.text)
                                if let role = contact.role {
                                    Text(role)
                                        .font(Typography.caption)
                                        .foregroundStyle(Theme.textDim)
                                }
                            }
                        }
                    }
                }
            }
            .searchable(text: $search, prompt: "Кого позвать")
            .navigationTitle("Упомянуть")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
            }
            .task {
                defer { isLoading = false }
                contacts = (try? await FeedService(api: api).contacts()) ?? []
            }
        }
    }
}

// ── Ответ и правка ───────────────────────────────────────────────────────────

/// Панель «отвечаю на …» над полем ввода.
struct ReplyBar: View {
    let message: TeamChatMessage
    let cancel: () -> Void

    var body: some View {
        HStack(spacing: Spacing.md) {
            RoundedRectangle(cornerRadius: 1.5)
                .fill(Theme.brand)
                .frame(width: 3, height: 32)

            VStack(alignment: .leading, spacing: 1) {
                Text("Ответ \(message.senderName)")
                    .font(Typography.caption.weight(.semibold))
                    .foregroundStyle(Theme.brand)
                Text(message.displayText)
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)

            Button(action: cancel) {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 18))
                    .foregroundStyle(Theme.textDim)
            }
            .buttonStyle(.pressable)
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.sm)
        .background(Theme.surfaceRaised)
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }
}

/// Правка своего сообщения.
///
/// Опечатка в чате смены живёт вечно: её цитируют, на неё ссылаются. Сервер
/// правку принимал давно и помечает сообщение как изменённое.
struct EditMessageSheet: View {
    @Binding var text: String
    let save: (String) async -> String?

    @Environment(\.dismiss) private var dismiss
    @State private var isSaving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScreenScroll {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        FieldLabel("Сообщение")
                        TextField("Текст", text: $text, axis: .vertical)
                            .textFieldStyle(.plain)
                            .font(Typography.callout)
                            .foregroundStyle(Theme.text)
                            .lineLimit(3...10)
                            .padding(Spacing.md)
                            .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))

                        if let error {
                            Text(error)
                                .font(Typography.caption)
                                .foregroundStyle(Theme.negative)
                        }

                        Button(isSaving ? "Сохраняем…" : "Сохранить") {
                            Task {
                                isSaving = true
                                defer { isSaving = false }
                                if let failure = await save(text) {
                                    error = failure
                                } else {
                                    dismiss()
                                }
                            }
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(isSaving || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
            }
            .background(Theme.background)
            .navigationTitle("Изменить")
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

/// Действия с сообщением.
///
/// Реакции стоят рядом, в строку — так это выглядит в любом мессенджере, и так
/// их ставят одним движением большого пальца. Системное контекстное меню
/// раскладывало те же пять значков в вертикальный столбик, по пункту на
/// значок: выглядело как список команд, а не как реакции.
struct MessageActionsSheet: View {
    let message: TeamChatMessage
    let canPin: Bool
    let isMine: Bool
    let react: (String) -> Void
    let reply: () -> Void
    let pin: () -> Void
    let edit: () -> Void
    let remove: () -> Void
    /// Пожаловаться. Требование App Store к приложениям с перепиской: фильтр
    /// мата и ночная проверка ИИ ловят не всё — угрозу или травлю распознаёт
    /// только тот, кому она адресована.
    var report: (() -> Void)?

    @Environment(\.dismiss) private var dismiss
    @State private var confirmingDelete = false
    @State private var confirmingReport = false
    @State private var reported = false

    /// Пять на все случаи: «принял», «сделано», «горит», «спасибо», «смешно».
    /// Полная клавиатура эмодзи в рабочем чате превращается в развлечение.
    private let emojis = ["👍", "✅", "🔥", "❤️", "😂"]

    var body: some View {
        VStack(spacing: Spacing.lg) {
            HStack(spacing: Spacing.sm) {
                ForEach(emojis, id: \.self) { emoji in
                    Button {
                        react(emoji)
                        Haptics.tap()
                        dismiss()
                    } label: {
                        Text(emoji)
                            .font(.system(size: 30))
                            .frame(width: 52, height: 52)
                            .background(Theme.surfaceRaised, in: Circle())
                    }
                    .buttonStyle(.pressable)
                }
            }
            .frame(maxWidth: .infinity)

            // Само сообщение — чтобы не гадать, к какому относятся действия.
            Text(message.displayText)
                .font(Typography.caption)
                .foregroundStyle(Theme.textDim)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)

            Card(padding: Spacing.sm) {
                VStack(spacing: 0) {
                    actionRow("Ответить", icon: "arrowshape.turn.up.left") {
                        reply()
                        dismiss()
                    }

                    if canPin {
                        RowDivider()
                        actionRow(
                            message.isPinned ? "Открепить" : "Закрепить на сутки",
                            icon: message.isPinned ? "pin.slash" : "pin"
                        ) {
                            pin()
                            dismiss()
                        }
                    }

                    if isMine {
                        RowDivider()
                        actionRow("Изменить", icon: "pencil") {
                            dismiss()
                            edit()
                        }
                        RowDivider()
                        actionRow("Удалить", icon: "trash", tint: Theme.negative) {
                            confirmingDelete = true
                        }
                    } else if report != nil {
                        RowDivider()
                        actionRow(
                            reported ? "Жалоба отправлена" : "Пожаловаться",
                            icon: reported ? "checkmark.circle" : "flag",
                            tint: reported ? Theme.positive : Theme.warning
                        ) {
                            guard !reported else { return }
                            confirmingReport = true
                        }
                        .disabled(reported)
                    }
                }
            }

            Spacer(minLength: 0)
        }
        .padding(Spacing.lg)
        .frame(maxWidth: .infinity)
        .background(Theme.background)
        #if os(iOS)
        .presentationDetents([.height(isMine ? 380 : 280)])
        .presentationDragIndicator(.visible)
        #endif
        .confirmationDialog("Удалить сообщение?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Удалить", role: .destructive) {
                remove()
                dismiss()
            }
            Button("Отмена", role: .cancel) {}
        } message: {
            Text("У всех в чате оно исчезнет.")
        }
        .confirmationDialog("Пожаловаться на сообщение?", isPresented: $confirmingReport, titleVisibility: .visible) {
            Button("Пожаловаться", role: .destructive) {
                report?()
                reported = true
                Haptics.tap()
            }
            Button("Отмена", role: .cancel) {}
        } message: {
            Text("Владелец увидит его в разделе модерации. Отправитель об этом не узнает.")
        }
    }

    private func actionRow(
        _ title: String,
        icon: String,
        tint: Color = Theme.text,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: Spacing.md) {
                Image(systemName: icon)
                    .font(.system(size: 15))
                    .foregroundStyle(tint == Theme.text ? Theme.textMuted : tint)
                    .frame(width: 22)
                Text(title)
                    .font(Typography.callout)
                    .foregroundStyle(tint)
                Spacer(minLength: 0)
            }
            .padding(.vertical, Spacing.sm)
            .contentShape(Rectangle())
        }
        .buttonStyle(.pressable)
    }
}
