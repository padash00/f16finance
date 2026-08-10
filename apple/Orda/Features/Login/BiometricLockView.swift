import LocalAuthentication
import OrdaUI
import SwiftUI

/// Замок Face ID / Touch ID поверх активной сессии.
///
/// Нужен потому, что из приложения можно выплатить зарплату и выгрузить
/// логины всей команды. Оставленный на столе разблокированный телефон не
/// должен давать к этому доступ.
struct BiometricLockView: View {
    @Environment(AuthStore.self) private var auth
    @State private var isAuthenticating = false
    @State private var failureCount = 0

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()

            VStack(spacing: Spacing.xl) {
                Image(systemName: Biometrics.iconName)
                    .font(.system(size: 44, weight: .light))
                    .foregroundStyle(Theme.brand)
                    .padding(Spacing.xxl)
                    .background(Theme.brand.opacity(0.12), in: RoundedRectangle(cornerRadius: Radius.xl, style: .continuous))

                VStack(spacing: Spacing.sm) {
                    Text("Orda заблокирован")
                        .font(Typography.title)
                        .foregroundStyle(Theme.text)
                    Text("Подтвердите, что это вы.")
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textMuted)
                }

                Button("Разблокировать") {
                    Task { await unlock() }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(isAuthenticating)
                .frame(maxWidth: 260)

                Button("Выйти из аккаунта") {
                    Task { await auth.signOut() }
                }
                .buttonStyle(.plain)
                .font(Typography.callout)
                .foregroundStyle(Theme.negative)
            }
            .padding(Spacing.xxl)
            .shake(on: failureCount)
        }
        .task { await unlock() }
    }

    private func unlock() async {
        guard !isAuthenticating else { return }
        isAuthenticating = true
        defer { isAuthenticating = false }

        if await Biometrics.authenticate(reason: "Вход в Orda") {
            auth.unlock()
        } else {
            // Трясём экран, а не показываем ошибку: человек и так знает, что
            // не подтвердил, а красный текст на весь экран выглядит как сбой.
            failureCount += 1
        }
    }
}

/// Обёртка над LocalAuthentication.
enum Biometrics {
    /// Доступна ли биометрия на устройстве и настроена ли она.
    static var isAvailable: Bool {
        var error: NSError?
        return LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
    }

    /// Как называется на этом устройстве: Face ID, Touch ID или просто код.
    static var displayName: String {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        switch context.biometryType {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        default: return "код устройства"
        }
    }

    static var iconName: String {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        switch context.biometryType {
        case .faceID: return "faceid"
        case .touchID: return "touchid"
        default: return "lock.fill"
        }
    }

    /// Запросить подтверждение. Падаем на код-пароль устройства, если
    /// биометрия не сработала — иначе человек с мокрыми руками остаётся
    /// заперт снаружи.
    static func authenticate(reason: String) async -> Bool {
        let context = LAContext()
        context.localizedFallbackTitle = "Ввести код"
        do {
            return try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)
        } catch {
            return false
        }
    }
}
