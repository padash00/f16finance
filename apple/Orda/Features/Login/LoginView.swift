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
    /// Пространство геометрии заставки: по нему знак приезжает сюда из
    /// центра экрана. Своё — когда экран открыт не после заставки.
    var brandNamespace: Namespace.ID?
    /// Заставка ещё идёт: знак в шапке пока не рисуем — он в пути.
    var waitsForIntro: Bool = false

    @Environment(AuthStore.self) private var auth
    @Namespace private var ownNamespace

    @State private var login = ""
    @State private var password = ""
    @State private var appeared = false
    /// Показывать пароль открытым.
    ///
    /// Без этого набранный вслепую пароль проверить нечем: рабочие пароли
    /// выдаёт владелец, они длинные и случайные, и человек за стойкой три раза
    /// подряд получает «неверный пароль», не понимая, где промахнулся.
    @State private var revealPassword = false
    @State private var showingHelp = false
    @FocusState private var focusedField: Field?

    private enum Field { case login, password }

    @Environment(\.colorScheme) private var colorScheme

    /// Логотип navy на светлом, белый — в тёмной теме.
    private var logoColor: Color { colorScheme == .dark ? .white : Theme.navy }

    private var configuration = AppConfiguration.current

    /// Инициализатор явный, а не выведенный: у экрана есть приватное поле, и
    /// автоматический memberwise-init из-за него становится приватным — снаружи
    /// вызвать его нельзя, а вызов без аргументов работал бы по умолчанию и
    /// молча ронял связь с заставкой.
    init(brandNamespace: Namespace.ID? = nil, waitsForIntro: Bool = false) {
        self.brandNamespace = brandNamespace
        self.waitsForIntro = waitsForIntro
    }

    var body: some View {
        ZStack {
            BrandBackground()

            // Форму центрируем по высоте: на iPad и Mac экран втрое выше
            // формы, и прижатая к верху карточка выглядит поломанной.
            // GeometryReader задаёт минимальную высоту содержимого равной
            // экрану, поэтому на телефоне с клавиатурой прокрутка остаётся.
            GeometryReader { proxy in
                ScrollView {
                    // На планшете и Mac форма шириной в 420 точек посреди
                    // экрана выглядела потерянной: пустоты вокруг больше, чем
                    // содержимого. Широким экранам даём две колонки — слева
                    // фирменная часть, справа вход, — как на странице входа
                    // сайта. На телефоне порядок прежний, сверху вниз.
                    VStack(spacing: 0) {
                    layout(width: proxy.size.width) {
                        header(width: proxy.size.width)

                        VStack(spacing: Spacing.xl) {
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
                        } else if let reason = auth.automaticSignOutReason {
                            // Выход, которого человек не просил. Молчащая форма
                            // входа выглядит как «приложение опять сбросило»,
                            // и рассказать о причине было нечем.
                            Text(reason)
                                .font(Typography.caption)
                                .foregroundStyle(Theme.warning)
                                .fixedSize(horizontal: false, vertical: true)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .transition(.opacity)
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

                        // Тупик без выхода: пароль не подошёл, и человеку
                        // некуда деться с этого экрана. Восстановление у
                        // сотрудника и у оператора разное, поэтому не ссылка
                        // «забыли пароль», а объяснение — кому куда.
                        Button {
                            showingHelp = true
                        } label: {
                            Text("Не получается войти?")
                                .font(Typography.caption.weight(.medium))
                                .foregroundStyle(Theme.textDim)
                        }
                        .buttonStyle(.plain)
                        .padding(.top, Spacing.xxs)
                            }
                            .padding(Spacing.xl)
                            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Radius.xl, style: .continuous))
                            .shadow(color: Theme.navy.opacity(0.10), radius: 24, x: 0, y: 12)
                            .shake(on: auth.signInError ?? "")
                        }
                        .frame(maxWidth: 420)
                    }

                    // Адрес сервера — под обеими колонками, а не внутри
                    // формы: на планшете он тянул правую колонку вниз, и
                    // колонки переставали совпадать по середине.
                    Text(configuration.displayHost)
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                        .padding(.top, Spacing.lg)
                    }
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
        // Лицо спрашиваем сразу, как в банке: человек открыл приложение, а не
        // пришёл нажимать кнопку «войти по Face ID». Отказался — экран остаётся
        // обычным, кнопка на месте, повторно система не пристаёт.
        .task {
            guard auth.shouldOfferQuickEntry else { return }
            try? await Task.sleep(for: .milliseconds(350))
            await auth.offerQuickEntryIfPossible()
        }
        // Тёмная схема на весь экран, а не только на фон: поля и карточка
        // берут цвета из темы, и на тёмной обложке светлая форма выглядела бы
        // вырезанной из другого приложения.
        .animation(Motion.value, value: auth.signInError)
        .sheet(isPresented: $showingHelp) { LoginHelpSheet(enteredLogin: login) }
    }

    /// Одна колонка по центру — на телефоне, планшете и Mac.
    ///
    /// Раньше широкий экран раскладывался в две колонки: слева фирменный
    /// текст, справа форма. На айпаде это разъезжалось — знак с названием
    /// оставались болтаться у левого края огромного пустого поля, а форма
    /// уезжала из виду. Вход — это одно короткое действие, и разносить его по
    /// экрану незачем: колонка по центру одинаково честно смотрится и на
    /// пятидюймовом телефоне, и на тринадцатидюймовом планшете.
    @ViewBuilder
    private func layout<Content: View>(
        width: CGFloat,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(spacing: Spacing.xl) {
            content()
        }
        // На тринадцатидюймовом планшете колонка в 460 точек выглядит
        // почтовой маркой посреди стола: экран втрое шире, и глазу не за что
        // зацепиться. Даём заметно больше — но не во всю ширину: поле ввода
        // длиной в полметра читается хуже, а не лучше.
        .frame(maxWidth: isWide(width) ? 560 : 420)
        .frame(maxWidth: .infinity)
    }

    /// Широкий экран — тот, где знак можно показать крупнее.
    private func isWide(_ width: CGFloat) -> Bool { width >= 820 }

    private func header(width: CGFloat) -> some View {
        // Та же композиция, что в заставке: знак и название одной стопкой с
        // общей осью. Раньше шапка складывала их сама, своими отступами, — и
        // расходилась с заставкой, из которой знак сюда прилетает.
        // Знак на планшете крупнее не ради красоты: он там за метр от глаз,
        // на столе или на подставке, а не в руке.
        let height: CGFloat = isWide(width) ? 84 : 58

        return VStack(spacing: Spacing.lg) {
            OrdaControlLogo(
                height: height,
                color: logoColor,
                subtitleColor: Theme.textDim
            )
            VStack(spacing: Spacing.xs) {
                Text("Бизнес под контролем.")
                    .font(.system(size: isWide(width) ? 26 : 22, weight: .bold))
                    .foregroundStyle(Theme.text)
                Text("Операции, деньги, люди и склад — в одном месте.")
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.textDim)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(.bottom, Spacing.sm)
        .opacity(waitsForIntro ? 0 : 1)
        .animation(.easeIn(duration: 0.22), value: waitsForIntro)
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

            // Два поля, а не одно с переключателем: SecureField и TextField —
            // разные виды, и подмена типа на лету стирает набранное.
            Group {
                if revealPassword {
                    TextField("Пароль", text: $password)
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        #endif
                        .autocorrectionDisabled()
                } else {
                    SecureField("Пароль", text: $password)
                }
            }
            .textFieldStyle(.plain)
            .textContentType(.password)
            .focused($focusedField, equals: .password)
            .onSubmit(submit)

            Button {
                revealPassword.toggle()
                focusedField = .password
            } label: {
                Image(systemName: revealPassword ? "eye.slash" : "eye")
                    .foregroundStyle(Theme.textDim)
                    .frame(width: 20)
                    .contentTransition(.symbolEffect(.replace))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(revealPassword ? "Скрыть пароль" : "Показать пароль")
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

/// Фон входа: тёплый белый (в тёмной теме — Deep Navy) и одна мягкая
/// кобальтовая дуга в углу — тот же мотив, что в заставке. Растровой картинки
/// нет: всё рисуется по размеру экрана и резко везде.
struct BrandBackground: View {
    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            GeometryReader { proxy in
                let w = proxy.size.width
                let h = proxy.size.height
                Circle()
                    .stroke(Theme.cobalt.opacity(0.14), lineWidth: max(w, h) * 0.22)
                    .frame(width: max(w, h) * 1.1, height: max(w, h) * 1.1)
                    .position(x: w * 1.05, y: h * 1.02)
                    .blur(radius: 24)
                Circle()
                    .fill(Theme.cobalt.opacity(0.06))
                    .frame(width: w * 0.9, height: w * 0.9)
                    .position(x: w * 0.05, y: h * 0.08)
                    .blur(radius: 50)
            }
            .ignoresSafeArea()
            .allowsHitTesting(false)
        }
    }
}
