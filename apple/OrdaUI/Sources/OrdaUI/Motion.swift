import SwiftUI

/// Язык движения. Один набор кривых на всё приложение — иначе интерфейс
/// ощущается собранным из разных продуктов.
///
/// Правило, которое нельзя нарушать: **анимация никогда не задерживает
/// действие**. Максимум 300 мс на переход экрана, 150 мс на отклик элемента.
/// Всё, что дольше, пользователь читает как «тормозит».
public enum Motion {
    /// Отклик элемента на касание.
    public static let tap = Animation.spring(response: 0.28, dampingFraction: 0.7)
    /// Появление содержимого.
    public static let appear = Animation.spring(response: 0.5, dampingFraction: 0.8)
    /// Переход между экранами.
    public static let transition = Animation.spring(response: 0.42, dampingFraction: 0.86)
    /// Изменение числа или короткая подсветка.
    public static let value = Animation.easeOut(duration: 0.25)
    /// Плавное, ненавязчивое — фоновые градиенты, дыхание.
    public static let ambient = Animation.easeInOut(duration: 2.4)

    /// Задержка появления элемента списка. Каскад включаем только для первых
    /// элементов: на сотой строке он превращается в раздражающую задержку.
    public static func staggerDelay(index: Int, step: Double = 0.035, limit: Int = 12) -> Double {
        guard index < limit else { return 0 }
        return Double(index) * step
    }
}

/// Каскадное появление элементов списка.
public struct StaggeredAppear: ViewModifier {
    let index: Int
    @State private var visible = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(index: Int) {
        self.index = index
    }

    public func body(content: Content) -> some View {
        content
            .opacity(visible ? 1 : 0)
            .offset(y: visible ? 0 : 12)
            .onAppear {
                guard !reduceMotion else {
                    visible = true
                    return
                }
                withAnimation(Motion.appear.delay(Motion.staggerDelay(index: index))) {
                    visible = true
                }
            }
    }
}

/// Короткая горизонтальная тряска — отказ, ошибка ввода.
public struct ShakeEffect: GeometryEffect {
    public var amount: CGFloat = 8
    public var shakesPerUnit = 3
    public var animatableData: CGFloat

    public init(animatableData: CGFloat) {
        self.animatableData = animatableData
    }

    public func effectValue(size: CGSize) -> ProjectionTransform {
        ProjectionTransform(
            CGAffineTransform(
                translationX: amount * sin(animatableData * .pi * CGFloat(shakesPerUnit)),
                y: 0
            )
        )
    }
}

extension View {
    /// Появление с задержкой по позиции в списке.
    public func staggeredAppear(index: Int) -> some View {
        modifier(StaggeredAppear(index: index))
    }

    /// Тряска при изменении триггера.
    public func shake(on trigger: some Equatable) -> some View {
        modifier(ShakeOnChange(trigger: trigger))
    }
}

struct ShakeOnChange<Trigger: Equatable>: ViewModifier {
    let trigger: Trigger
    @State private var shakes: CGFloat = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .modifier(ShakeEffect(animatableData: shakes))
            .onChange(of: trigger) { _, _ in
                guard !reduceMotion else { return }
                withAnimation(.linear(duration: 0.35)) { shakes += 1 }
            }
    }
}
