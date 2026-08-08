import OrdaKit
import OrdaUI
import SwiftUI
import WebKit

/// Страница портала внутри приложения.
///
/// Нативных экранов пока четыре, а разделов в системе — восемьдесят два.
/// Показывать вместо остальных список прав с плашкой «подключается позже»
/// нечестно: человек на сайте эти разделы использует, а в приложении упирается
/// в заглушку.
///
/// Поэтому раздел без нативного экрана открывает настоящую веб-версию — с той
/// же сессией, без повторного входа. Мост `/api/auth/mobile-bridge` обменивает
/// Bearer приложения на куки портала.
///
/// Это временное решение по замыслу: каждый нативный экран заменяет веб на
/// своём месте, а до тех пор функция доступна, а не обещана.
struct WebPageView: View {
    let title: String
    /// Путь на портале, например `/income`.
    let path: String

    @Environment(AuthStore.self) private var auth

    @State private var isLoading = true
    @State private var loadError: String?
    @State private var progress: Double = 0
    @State private var reloadToken = UUID()

    var body: some View {
        ZStack {
            if let request = bridgeRequest {
                PortalWebView(
                    request: request,
                    reloadToken: reloadToken,
                    isLoading: $isLoading,
                    progress: $progress,
                    loadError: $loadError
                )
                .opacity(loadError == nil ? 1 : 0)
            }

            if let loadError {
                WideEmptyState(
                    icon: "wifi.slash",
                    title: "Страница не открылась",
                    message: loadError
                )
            } else if isLoading {
                loadingOverlay
            }
        }
        .background(Theme.background)
        .navigationTitle(title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    loadError = nil
                    isLoading = true
                    reloadToken = UUID()
                } label: {
                    Label("Обновить", systemImage: "arrow.clockwise")
                }
                .keyboardShortcut("r", modifiers: .command)
            }
        }
    }

    /// Полоса загрузки поверх пустоты: белая вспышка страницы на тёмной теме
    /// выглядит как сбой, поэтому держим свой фон, пока грузится.
    private var loadingOverlay: some View {
        VStack(spacing: Spacing.lg) {
            ProgressView(value: max(progress, 0.05))
                .progressViewStyle(.linear)
                .tint(Theme.brand)
                .frame(maxWidth: 240)
            Text("Открываем раздел…")
                .font(Typography.caption)
                .foregroundStyle(Theme.textDim)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background)
    }

    /// Запрос к мосту: токены уходят заголовком, а не в адресе — адрес попадает
    /// в историю, логи прокси и Referer.
    private var bridgeRequest: URLRequest? {
        guard let session = auth.session else { return nil }

        var components = URLComponents(
            url: AppConfiguration.current.apiBaseURL.appending(path: "api/auth/mobile-bridge"),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = [
            URLQueryItem(name: "redirect", value: path),
            URLQueryItem(name: "refresh_token", value: session.refreshToken),
        ]
        guard let url = components?.url else { return nil }

        var request = URLRequest(url: url)
        request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
        return request
    }
}

// ── Обёртка WKWebView ────────────────────────────────────────────────────────

#if canImport(UIKit)
struct PortalWebView: UIViewRepresentable {
    let request: URLRequest
    let reloadToken: UUID
    @Binding var isLoading: Bool
    @Binding var progress: Double
    @Binding var loadError: String?

    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView(frame: .zero, configuration: context.coordinator.configuration)
        webView.navigationDelegate = context.coordinator
        // Портал тёмный; белая подложка при загрузке выглядит вспышкой.
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        context.coordinator.observe(webView)
        webView.load(request)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        guard context.coordinator.lastToken != reloadToken else { return }
        context.coordinator.lastToken = reloadToken
        webView.load(request)
    }

    func makeCoordinator() -> WebCoordinator {
        WebCoordinator(isLoading: $isLoading, progress: $progress, loadError: $loadError, token: reloadToken)
    }
}
#elseif canImport(AppKit)
struct PortalWebView: NSViewRepresentable {
    let request: URLRequest
    let reloadToken: UUID
    @Binding var isLoading: Bool
    @Binding var progress: Double
    @Binding var loadError: String?

    func makeNSView(context: Context) -> WKWebView {
        let webView = WKWebView(frame: .zero, configuration: context.coordinator.configuration)
        webView.navigationDelegate = context.coordinator
        webView.setValue(false, forKey: "drawsBackground")
        context.coordinator.observe(webView)
        webView.load(request)
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        guard context.coordinator.lastToken != reloadToken else { return }
        context.coordinator.lastToken = reloadToken
        webView.load(request)
    }

    func makeCoordinator() -> WebCoordinator {
        WebCoordinator(isLoading: $isLoading, progress: $progress, loadError: $loadError, token: reloadToken)
    }
}
#endif

/// Общий делегат для обеих платформ.
final class WebCoordinator: NSObject, WKNavigationDelegate {
    @Binding private var isLoading: Bool
    @Binding private var progress: Double
    @Binding private var loadError: String?
    var lastToken: UUID

    private var observation: NSKeyValueObservation?

    /// Общее хранилище данных: куки сессии живут между открытиями разделов,
    /// иначе мост дёргался бы на каждый переход.
    lazy var configuration: WKWebViewConfiguration = {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        return configuration
    }()

    init(isLoading: Binding<Bool>, progress: Binding<Double>, loadError: Binding<String?>, token: UUID) {
        _isLoading = isLoading
        _progress = progress
        _loadError = loadError
        lastToken = token
    }

    func observe(_ webView: WKWebView) {
        observation = webView.observe(\.estimatedProgress, options: [.new]) { [weak self] view, _ in
            Task { @MainActor in self?.progress = view.estimatedProgress }
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Task { @MainActor in
            isLoading = false
            loadError = nil
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        report(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        report(error)
    }

    private func report(_ error: Error) {
        // Отменённая навигация — это переход, а не сбой: показывать ошибку
        // при обычном редиректе моста было бы неверно.
        if (error as NSError).code == NSURLErrorCancelled { return }
        Task { @MainActor in
            isLoading = false
            loadError = error.localizedDescription
        }
    }
}
