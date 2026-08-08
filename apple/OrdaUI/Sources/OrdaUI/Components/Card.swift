import SwiftUI

/// Карточка — основной контейнер содержимого.
///
/// Даёт глубину через границу и тень, а не через рамку в стиле веба. На Mac
/// тень мягче: там окно и так лежит на фоне рабочего стола, и сильная тень
/// выглядит грязно.
public struct Card<Content: View>: View {
    private let content: Content
    private let padding: CGFloat
    private let accent: Color?

    public init(
        padding: CGFloat = Spacing.lg,
        accent: Color? = nil,
        @ViewBuilder content: () -> Content
    ) {
        self.padding = padding
        self.accent = accent
        self.content = content()
    }

    public var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.lg, style: .continuous)
                    .strokeBorder(accent?.opacity(0.35) ?? Theme.border, lineWidth: 1)
            }
            .shadow(color: .black.opacity(shadowOpacity), radius: 18, x: 0, y: 10)
    }

    private var shadowOpacity: Double {
        #if os(macOS)
        0.12
        #else
        0.28
        #endif
    }
}

/// Строка-заголовок раздела с необязательным действием справа.
public struct SectionHeader<Accessory: View>: View {
    private let title: String
    private let subtitle: String?
    private let accessory: Accessory

    public init(_ title: String, subtitle: String? = nil, @ViewBuilder accessory: () -> Accessory) {
        self.title = title
        self.subtitle = subtitle
        self.accessory = accessory()
    }

    public var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(title)
                    .font(Typography.title)
                    .foregroundStyle(Theme.text)
                if let subtitle {
                    Text(subtitle)
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                }
            }
            Spacer(minLength: Spacing.md)
            accessory
        }
    }
}

extension SectionHeader where Accessory == EmptyView {
    public init(_ title: String, subtitle: String? = nil) {
        self.init(title, subtitle: subtitle) { EmptyView() }
    }
}
