import SwiftUI

/// Короткое подтверждение поверх экрана.
///
/// Хаптика говорит «нажалось», но не говорит «получилось»: записал количество,
/// оплатил долг, поправил остаток — окно закрылось, и человек не уверен,
/// сохранилось ли. У оператора такая полоска была давно и себя оправдала;
/// здесь она общая, чтобы бизнес-контур не оставался молчаливым.
public struct ToastBanner: View {
    public let text: String
    public let isError: Bool

    public init(text: String, isError: Bool = false) {
        self.text = text
        self.isError = isError
    }

    public var body: some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: isError ? "exclamationmark.circle.fill" : "checkmark.circle.fill")
            Text(text)
                .font(Typography.callout.weight(.medium))
                .lineLimit(2)
        }
        .foregroundStyle(Color.black.opacity(0.85))
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(isError ? Theme.warning : Theme.positive, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
        .shadow(color: .black.opacity(0.25), radius: 12, y: 6)
    }
}

public extension View {
    /// Показать подтверждение и убрать его само.
    ///
    /// Время подобрано по делу: удачу читают мельком, ошибку — читают. Поэтому
    /// у ошибки вдвое дольше.
    func toast(_ message: Binding<ToastMessage?>) -> some View {
        overlay(alignment: .top) {
            if let value = message.wrappedValue {
                ToastBanner(text: value.text, isError: value.isError)
                    .padding(.horizontal, Spacing.lg)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .task(id: value.id) {
                        try? await Task.sleep(for: .seconds(value.isError ? 3 : 1.6))
                        message.wrappedValue = nil
                    }
            }
        }
        .animation(Motion.value, value: message.wrappedValue?.id)
    }
}

/// Текст подтверждения. Идентификатор нужен, чтобы два одинаковых сообщения
/// подряд считались разными: иначе второе не показалось бы вовсе.
public struct ToastMessage: Equatable, Identifiable, Sendable {
    public let id: UUID
    public let text: String
    public let isError: Bool

    public init(_ text: String, isError: Bool = false) {
        self.id = UUID()
        self.text = text
        self.isError = isError
    }
}
