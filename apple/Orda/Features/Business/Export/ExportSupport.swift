import OrdaKit
import OrdaUI
import SwiftUI
#if os(iOS)
import UIKit
#endif

/// Готовый файл выгрузки — во временной папке, до «Поделиться».
struct ExportedFile: Identifiable {
    let url: URL
    var id: String { url.path }

    /// Записать данные во временный файл с понятным именем: его увидят в
    /// почте и мессенджере, `tmp-8F3A.csv` там никому ничего не скажет.
    static func write(_ data: Data, name: String) throws -> ExportedFile {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("exports", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appendingPathComponent(name)
        try? FileManager.default.removeItem(at: url)
        try data.write(to: url, options: .atomic)
        return ExportedFile(url: url)
    }
}

#if os(iOS)
/// Системное «Поделиться»: почта, Telegram, WhatsApp, «Файлы».
struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
#endif

extension View {
    /// Показать «Поделиться» для готового файла.
    func shareSheet(_ file: Binding<ExportedFile?>) -> some View {
        #if os(iOS)
        sheet(item: file) { file in
            ShareSheet(items: [file.url])
                .presentationDetents([.medium, .large])
                .ignoresSafeArea()
        }
        #else
        self
        #endif
    }
}

/// Кнопка выгрузки в панели: круглая, как «+» рядом.
struct ExportToolbarButton: View {
    var isWorking = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            if isWorking {
                ProgressView().controlSize(.small)
            } else {
                Image(systemName: "square.and.arrow.up")
            }
        }
        .disabled(isWorking)
        .accessibilityLabel("Выгрузить в Excel")
    }
}
