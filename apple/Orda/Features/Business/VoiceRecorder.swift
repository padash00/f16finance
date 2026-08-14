#if os(iOS)
import AVFoundation
import Foundation
import Observation

/// Запись голосового сообщения.
///
/// В смене руки заняты: набирать «принял смену, в кассе не хватает 2000, разбираюсь»
/// одной рукой у стойки долго, а сказать — три секунды. Поэтому голосовое, а не
/// «прикрепить файл».
///
/// Формат — m4a: он играется без конвертации и в браузере на сайте, и в самом
/// приложении. Один регламент на оба конца дешевле, чем два кодека.
@MainActor
@Observable
final class VoiceRecorder {
    private(set) var isRecording = false
    private(set) var duration: TimeInterval = 0
    private(set) var error: String?

    private var recorder: AVAudioRecorder?
    private var timer: Timer?
    private var fileURL: URL?

    /// Разрешение спрашиваем в момент первой записи, а не при открытии чата:
    /// системный запрос посреди переписки выглядит подозрительно.
    func start() async {
        error = nil
        guard await requestPermission() else {
            error = "Разрешите доступ к микрофону в настройках"
            return
        }

        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .spokenAudio, options: [.defaultToSpeaker])
            try session.setActive(true)

            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("voice-\(UUID().uuidString).m4a")
            let settings: [String: Any] = [
                AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                // 22 кГц моно: речь на этом не теряет ничего, а минута весит
                // около трёхсот килобайт — важно там, где интернет за стойкой
                // держится на одной палке.
                AVSampleRateKey: 22_050,
                AVNumberOfChannelsKey: 1,
                AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
            ]

            let recorder = try AVAudioRecorder(url: url, settings: settings)
            recorder.record()

            self.recorder = recorder
            fileURL = url
            isRecording = true
            duration = 0

            timer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in
                Task { @MainActor in
                    guard let self, let recorder = self.recorder else { return }
                    self.duration = recorder.currentTime
                }
            }
        } catch {
            self.error = "Не удалось начать запись"
        }
    }

    /// Остановить и отдать файл. `nil` — записи не было или она пустая.
    func stop() -> (data: Data, duration: TimeInterval)? {
        timer?.invalidate()
        timer = nil
        recorder?.stop()
        isRecording = false

        defer {
            recorder = nil
            fileURL = nil
            duration = 0
        }

        guard let fileURL, let data = try? Data(contentsOf: fileURL) else { return nil }
        try? FileManager.default.removeItem(at: fileURL)

        // Меньше секунды — это случайное касание, а не сообщение.
        guard duration >= 1, !data.isEmpty else { return nil }
        return (data, duration)
    }

    /// Бросить запись, ничего не отправляя.
    func cancel() {
        timer?.invalidate()
        timer = nil
        recorder?.stop()
        isRecording = false
        if let fileURL { try? FileManager.default.removeItem(at: fileURL) }
        recorder = nil
        fileURL = nil
        duration = 0
    }

    private func requestPermission() async -> Bool {
        // Минимум приложения — iOS 17, поэтому ветки для старых систем нет.
        await AVAudioApplication.requestRecordPermission()
    }

    /// `1:05` — так же, как показывают длину голосового везде.
    static func format(_ seconds: TimeInterval) -> String {
        let total = Int(seconds.rounded())
        return String(format: "%d:%02d", total / 60, total % 60)
    }
}
#endif
