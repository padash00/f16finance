import Foundation

#if os(iOS)
import UIKit
#endif

/// Тактильный отклик.
///
/// Для кассира это не украшение: при сканировании потока товаров смотреть на
/// экран после каждой позиции невозможно, и разница «нашёлся / не нашёлся»
/// считывается пальцами.
@MainActor
enum Haptics {
    static func success() {
        #if os(iOS)
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        #endif
    }

    static func error() {
        #if os(iOS)
        UINotificationFeedbackGenerator().notificationOccurred(.error)
        #endif
    }

    static func warning() {
        #if os(iOS)
        UINotificationFeedbackGenerator().notificationOccurred(.warning)
        #endif
    }

    /// Лёгкий щелчок — подтверждение обычного действия.
    static func tap() {
        #if os(iOS)
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        #endif
    }
}
