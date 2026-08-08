import OrdaKit
import SwiftUI

/// Скелет загрузки — прямоугольник с бегущим бликом.
///
/// Вместо спиннера: скелет показывает будущую форму содержимого, поэтому
/// переход к данным не «дёргает» вёрстку.
public struct Skeleton: View {
    private let height: CGFloat
    private let cornerRadius: CGFloat
    @State private var shimmer = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(height: CGFloat = 16, cornerRadius: CGFloat = Radius.sm) {
        self.height = height
        self.cornerRadius = cornerRadius
    }

    public var body: some View {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .fill(Theme.surfaceRaised)
            .frame(height: height)
            .overlay {
                if !reduceMotion {
                    GeometryReader { proxy in
                        LinearGradient(
                            colors: [.clear, Theme.text.opacity(0.06), .clear],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                        .frame(width: proxy.size.width * 0.4)
                        .offset(x: shimmer ? proxy.size.width : -proxy.size.width * 0.4)
                    }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.linear(duration: 1.2).repeatForever(autoreverses: false)) {
                    shimmer = true
                }
            }
            .accessibilityHidden(true)
    }
}

/// Экран «пусто». Всегда объясняет, что делать дальше — «Нет данных» без
/// продолжения оставляет человека в тупике.
public struct EmptyStateView: View {
    private let icon: String
    private let title: String
    private let message: String
    private let actionTitle: String?
    private let action: (() -> Void)?

    public init(
        icon: String = "tray",
        title: String,
        message: String,
        actionTitle: String? = nil,
        action: (() -> Void)? = nil
    ) {
        self.icon = icon
        self.title = title
        self.message = message
        self.actionTitle = actionTitle
        self.action = action
    }

    public var body: some View {
        VStack(spacing: Spacing.lg) {
            Image(systemName: icon)
                .font(.system(size: 40, weight: .light))
                .foregroundStyle(Theme.textDim)

            VStack(spacing: Spacing.sm) {
                Text(title)
                    .font(Typography.title)
                    .foregroundStyle(Theme.text)
                Text(message)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.textMuted)
                    .multilineTextAlignment(.center)
            }

            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(PrimaryButtonStyle())
            }
        }
        .frame(maxWidth: 360)
        .padding(Spacing.xxl)
    }
}

/// Экран ошибки. Для 403 показывает, какого именно права не хватает и к кому
/// идти — вместо кода состояния.
public struct ErrorStateView: View {
    private let error: APIError
    private let retry: (() -> Void)?

    public init(error: APIError, retry: (() -> Void)? = nil) {
        self.error = error
        self.retry = retry
    }

    public var body: some View {
        VStack(spacing: Spacing.lg) {
            Image(systemName: icon)
                .font(.system(size: 40, weight: .light))
                .foregroundStyle(iconColor)

            Text(error.userMessage)
                .font(Typography.callout)
                .foregroundStyle(Theme.textMuted)
                .multilineTextAlignment(.center)

            // Повтор предлагаем только там, где он может помочь. Кнопка
            // «Повторить» на «нет прав» — издевательство.
            if let retry, error.isRetryable {
                Button("Повторить", action: retry)
                    .buttonStyle(PrimaryButtonStyle())
            }
        }
        .frame(maxWidth: 360)
        .padding(Spacing.xxl)
    }

    private var icon: String {
        switch error {
        case .transport: "wifi.slash"
        case .forbidden: "lock.fill"
        case .unauthorized: "person.crop.circle.badge.exclamationmark"
        case .notFound: "questionmark.folder"
        default: "exclamationmark.triangle"
        }
    }

    private var iconColor: Color {
        switch error {
        case .forbidden, .unauthorized: Theme.warning
        case .transport: Theme.textDim
        default: Theme.negative
        }
    }
}

// ── Кнопки ───────────────────────────────────────────────────────────────────

/// Основное действие.
public struct PrimaryButtonStyle: ButtonStyle {
    private let tint: Color
    @Environment(\.isEnabled) private var isEnabled

    public init(tint: Color = Theme.brand) {
        self.tint = tint
    }

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Typography.headline)
            .foregroundStyle(Color.black.opacity(0.85))
            .padding(.horizontal, Spacing.xl)
            .padding(.vertical, Spacing.md)
            .frame(maxWidth: .infinity)
            .background(tint.opacity(isEnabled ? 1 : 0.4), in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(Motion.tap, value: configuration.isPressed)
    }
}

/// Второстепенное действие.
public struct SecondaryButtonStyle: ButtonStyle {
    public init() {}

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Typography.headline)
            .foregroundStyle(Theme.text)
            .padding(.horizontal, Spacing.xl)
            .padding(.vertical, Spacing.md)
            .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
                    .strokeBorder(Theme.border, lineWidth: 1)
            }
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(Motion.tap, value: configuration.isPressed)
    }
}

/// Опасное действие. Применяется к правам уровня `.high` — их 106, и каждое
/// необратимо.
public struct DestructiveButtonStyle: ButtonStyle {
    public init() {}

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Typography.headline)
            .foregroundStyle(Theme.negative)
            .padding(.horizontal, Spacing.xl)
            .padding(.vertical, Spacing.md)
            .background(Theme.negative.opacity(0.12), in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
                    .strokeBorder(Theme.negative.opacity(0.35), lineWidth: 1)
            }
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(Motion.tap, value: configuration.isPressed)
    }
}
