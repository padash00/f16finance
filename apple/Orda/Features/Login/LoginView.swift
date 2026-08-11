import OrdaKit
import OrdaUI
import SwiftUI

/// Экран входа.
///
/// Одно поле на всех: сотрудники вводят почту, операторы — логин. Разделять
/// на «вход для операторов» и «вход для владельцев» не нужно: система сама
/// определит роль по учётной записи, а лишний выбор на первом экране —
/// повод ошибиться.
struct LoginView: View {
    @Environment(AuthStore.self) private var auth

    @State private var login = ""
    @State private var password = ""
    @State private var appeared = false
    @FocusState private var focusedField: Field?

    private enum Field { case login, password }

    private var configuration = AppConfiguration.current

    var body: some View {
        ZStack {
            AuroraBackground()

            // Форму центрируем по высоте: на iPad и Mac экран втрое выше
            // формы, и прижатая к верху карточка выглядит поломанной.
            // GeometryReader задаёт минимальную высоту содержимого равной
            // экрану, поэтому на телефоне с клавиатурой прокрутка остаётся.
            GeometryReader { proxy in
                ScrollView {
                    VStack(spacing: Spacing.xl) {
                        header

                    VStack(spacing: Spacing.md) {
                        field(
                            "Логин или почта",
                            text: $login,
                            icon: "person",
                            field: .login
                        )
                        .textContentType(.username)
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                        #endif
                        .autocorrectionDisabled()

                        secureField

                        if let error = auth.signInError {
                            Text(error)
                                .font(Typography.callout)
                                .foregroundStyle(Theme.negative)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .transition(.opacity.combined(with: .move(edge: .top)))
                        }

                        Button {
                            submit()
                        } label: {
                            if auth.isSigningIn {
                                ProgressView().controlSize(.small)
                            } else {
                                Text("Войти")
                            }
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(!canSubmit)
                        .padding(.top, Spacing.sm)

                        // Быстрый возврат. Выход случается: промахнулись по
                        // кнопке, обновилось приложение. Набирать рабочий
                        // пароль заново стоя за стойкой — то, из-за чего его
                        // пишут на стикере и клеят к монитору.
                        if auth.hasQuickEntry {
                            Button {
                                Task { await auth.signInWithBiometrics() }
                            } label: {
                                Label("Войти по Face ID", systemImage: "faceid")
                            }
                            .buttonStyle(SecondaryButtonStyle())
                            .disabled(auth.isSigningIn)

                            if let quickError = auth.quickEntryError {
                                Text(quickError)
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.textMuted)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                    }
                    .padding(Spacing.lg)
                    .background(Theme.surface.opacity(0.9), in: RoundedRectangle(cornerRadius: Radius.xl, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: Radius.xl, style: .continuous)
                            .strokeBorder(Theme.border, lineWidth: 1)
                    }
                    .shake(on: auth.signInError ?? "")

                    Text(configuration.displayHost)
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)

                    }
                    .frame(maxWidth: 420)
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, Spacing.xl)
                    .padding(.vertical, Spacing.xxl)
                    .frame(minHeight: proxy.size.height)
                    .opacity(appeared ? 1 : 0)
                    .offset(y: appeared ? 0 : 24)
                }
                .scrollBounceBehavior(.basedOnSize)
            }
        }
        .onAppear {
            withAnimation(Motion.appear.delay(0.1)) { appeared = true }
        }
        .animation(Motion.value, value: auth.signInError)
    }

    private var header: some View {
        VStack(spacing: Spacing.md) {
            Image(systemName: "cube.transparent.fill")
                .font(.system(size: 52, weight: .light))
                .foregroundStyle(Theme.brand)
                .shadow(color: Theme.brand.opacity(0.45), radius: 22)

            Text("Orda")
                .font(.system(size: 34, weight: .bold, design: .rounded))
                .foregroundStyle(Theme.text)

            Text("Управление клубом и точками продаж")
                .font(Typography.callout)
                .foregroundStyle(Theme.textDim)
                .multilineTextAlignment(.center)
        }
    }

    private func field(
        _ placeholder: String,
        text: Binding<String>,
        icon: String,
        field: Field
    ) -> some View {
        HStack(spacing: Spacing.md) {
            Image(systemName: icon)
                .foregroundStyle(focusedField == field ? Theme.brand : Theme.textDim)
                .frame(width: 20)
            TextField(placeholder, text: text)
                .textFieldStyle(.plain)
                .focused($focusedField, equals: field)
                .onSubmit { focusedField = .password }
        }
        .padding(Spacing.md)
        .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
                .strokeBorder(focusedField == field ? Theme.brand.opacity(0.6) : Theme.border, lineWidth: 1)
        }
        .animation(Motion.tap, value: focusedField)
    }

    private var secureField: some View {
        HStack(spacing: Spacing.md) {
            Image(systemName: "lock")
                .foregroundStyle(focusedField == .password ? Theme.brand : Theme.textDim)
                .frame(width: 20)
            SecureField("Пароль", text: $password)
                .textFieldStyle(.plain)
                .textContentType(.password)
                .focused($focusedField, equals: .password)
                .onSubmit(submit)
        }
        .padding(Spacing.md)
        .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
                .strokeBorder(focusedField == .password ? Theme.brand.opacity(0.6) : Theme.border, lineWidth: 1)
        }
        .animation(Motion.tap, value: focusedField)
    }

    private var canSubmit: Bool {
        !auth.isSigningIn
            && !login.trimmingCharacters(in: .whitespaces).isEmpty
            && !password.isEmpty
    }

    private func submit() {
        guard canSubmit else { return }
        focusedField = nil
        Task { await auth.signIn(login: login, password: password) }
    }
}

/// Живой фон входа: медленно дышащий градиент. На iOS 18+ — настоящая
/// сетка цветов, ниже — мягкий радиальный запасной вариант.
struct AuroraBackground: View {
    @State private var phase: CGFloat = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()

            if #available(iOS 18.0, macOS 15.0, *) {
                MeshGradient(
                    width: 3,
                    height: 3,
                    points: meshPoints,
                    colors: [
                        Theme.background, Theme.background, Theme.background,
                        Theme.brand.opacity(0.20), Theme.background, Theme.accent.opacity(0.14),
                        Theme.background, Theme.brand.opacity(0.10), Theme.background,
                    ]
                )
                .ignoresSafeArea()
                .blur(radius: 40)
            } else {
                RadialGradient(
                    colors: [Theme.brand.opacity(0.16), .clear],
                    center: .top,
                    startRadius: 40,
                    endRadius: 460
                )
                .ignoresSafeArea()
            }
        }
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 8).repeatForever(autoreverses: true)) {
                phase = 1
            }
        }
    }

    private var meshPoints: [SIMD2<Float>] {
        let drift = Float(phase) * 0.12
        return [
            SIMD2(0, 0), SIMD2(0.5, 0), SIMD2(1, 0),
            SIMD2(0, 0.5), SIMD2(0.5 + drift, 0.5 - drift), SIMD2(1, 0.5),
            SIMD2(0, 1), SIMD2(0.5, 1), SIMD2(1, 1),
        ]
    }
}
