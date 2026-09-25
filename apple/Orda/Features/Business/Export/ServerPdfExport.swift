import OrdaKit
import OrdaUI
import SwiftUI

/// Кнопка «PDF» в панели: скачивает файл с сервера и открывает «Поделиться».
///
/// Собирает сервер — тот же PDF, что на сайте. Сборка идёт несколько секунд
/// (сервер рендерит страницу), поэтому в кнопке крутится индикатор.
struct ServerPdfButton<Label: View>: View {
    let fileName: String
    let load: () async throws -> Data
    @ViewBuilder var label: () -> Label

    @State private var isLoading = false
    @State private var file: ExportedFile?
    @State private var error: String?

    var body: some View {
        Button {
            Task { await run() }
        } label: {
            if isLoading {
                ProgressView().controlSize(.small)
            } else {
                label()
            }
        }
        .disabled(isLoading)
        .shareSheet($file)
        #if DEBUG
        .task {
            if UserDefaults.standard.string(forKey: "ordaAutoExport") == "pdf" { await run() }
        }
        #endif
        .alert("Не удалось собрать PDF", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) {
            Button("Понятно", role: .cancel) {}
        } message: {
            Text(error ?? "")
        }
    }

    private func run() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let data = try await load()
            file = try ExportedFile.write(data, name: SpreadsheetExport.fileName(fileName, ext: "pdf"))
            Haptics.success()
        } catch let apiError as APIError {
            error = apiError.userMessage
        } catch {
            self.error = error.localizedDescription
        }
    }
}

extension View {
    /// PDF недельного акта в панели — по праву `weekly-report.export_pdf`.
    /// `week` — понедельник недели `yyyy-MM-dd`, `weekEnd` — воскресенье.
    func weeklyActPdfExport(week: String, weekEnd: String) -> some View {
        modifier(WeeklyActPdfToolbar(week: week, weekEnd: weekEnd))
    }
}

private struct WeeklyActPdfToolbar: ViewModifier {
    let week: String
    let weekEnd: String

    @Environment(\.api) private var api
    @Environment(\.access) private var access

    func body(content: Content) -> some View {
        content.toolbar {
            if access?.can("weekly-report.export_pdf") == true {
                ToolbarItem(placement: .primaryAction) {
                    ServerPdfButton(fileName: "Недельный акт \(week) — \(weekEnd)") {
                        try await BusinessService(api: api).weeklyActPDF(
                            from: week,
                            to: weekEnd,
                            planWeek: PayWeek.shifted(week, by: 1)
                        )
                    } label: {
                        Image(systemName: "doc.richtext")
                    }
                    .accessibilityLabel("PDF недельного акта")
                }
            }
        }
    }
}
