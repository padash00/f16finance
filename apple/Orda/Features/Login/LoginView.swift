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
            AuroraBackground()

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
                            .padding(Spacing.lg)
                            .background(Theme.surface.opacity(0.92), in: RoundedRectangle(cornerRadius: Radius.xl, style: .continuous))
                            .overlay {
                                RoundedRectangle(cornerRadius: Radius.xl, style: .continuous)
                                    .strokeBorder(Theme.border, lineWidth: 1)
                            }
                            .shadow(color: .black.opacity(0.35), radius: 30, x: 0, y: 18)
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
        .environment(\.colorScheme, .dark)
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
        .frame(maxWidth: isWide(width) ? 460 : 420)
        .frame(maxWidth: .infinity)
    }

    /// Широкий экран — тот, где знак можно показать крупнее.
    private func isWide(_ width: CGFloat) -> Bool { width >= 820 }

    private func header(width: CGFloat) -> some View {
        // Та же композиция, что в заставке: знак и название одной стопкой с
        // общей осью. Раньше шапка складывала их сама, своими отступами, — и
        // расходилась с заставкой, из которой знак сюда прилетает.
        let size: CGFloat = isWide(width) ? 96 : 76

        return OrdaPointLockup(
            symbolSize: size,
            wordmarkOpacity: waitsForIntro ? 0 : 1,
            descriptor: "Управление клубом и точками продаж"
        )
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

/// Фон экрана входа.
///
/// Экран входа всегда тёмный — независимо от выбранной темы. Так делают
/// банковские приложения, и не ради моды: это единственный экран, который
/// видят до входа, и он должен читаться как обложка, а не как пустая страница
/// настроек. Светлый вариант выцветал в белый лист, особенно на планшете, где
/// карточка занимает шестую часть экрана.
///
/// Растровой картинки нет намеренно: снимок растянулся бы на планшете и мылил
/// бы на Retina. Всё рисуется по размеру экрана и остаётся резким везде.
struct AuroraBackground: View {
    @State private var phase: CGFloat = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Тёмная основа. Не чёрный: чистый чёрный на OLED даёт провал, в котором
    /// теряются края карточки.
    private let base = Color(red: 0.043, green: 0.067, blue: 0.078)

    var body: some View {
        ZStack {
            base.ignoresSafeArea()

            // Свечение там, где содержимое: на телефоне это знак и название,
            // на планшете — левая колонка. Раньше оно стояло у самого верха, и
            // на планшете форма оказывалась в сером поле, а свет грелся сам по
            // себе выше неё.
            GeometryReader { proxy in
                let wide = proxy.size.width >= 820
                ZStack {
                    RadialGradient(
                        colors: [Theme.brand.opacity(0.40), Theme.brand.opacity(0.12), .clear],
                        center: UnitPoint(x: wide ? 0.26 : 0.5, y: wide ? 0.46 : 0.28),
                        startRadius: 0,
                        endRadius: max(proxy.size.width, proxy.size.height) * 0.52
                    )

                    // Холодный отсвет с другой стороны: без него половина
                    // экрана проваливалась в одинаковую темноту.
                    RadialGradient(
                        colors: [Theme.accent.opacity(0.22), .clear],
                        center: UnitPoint(
                            x: wide ? 0.78 : 0.18 + phase * 0.06,
                            y: wide ? 0.58 : 0.9
                        ),
                        startRadius: 0,
                        endRadius: max(proxy.size.width, proxy.size.height) * 0.42
                    )
                }
                .frame(width: proxy.size.width, height: proxy.size.height)
            }
            .ignoresSafeArea()
            .allowsHitTesting(false)

            lattice
            vignette
        }
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 10).repeatForever(autoreverses: true)) {
                phase = 1
            }
        }
    }

    /// Решётка из фирменных знаков — тот же знак, что на заставке: экран
    /// входа и заставка должны выглядеть одним приложением.
    ///
    /// Рисуется в `Canvas`, а не полусотней вложенных `Shape`: столько фигур в
    /// иерархии видов заметно тормозят, а один слой рисуется за проход.
    private var lattice: some View {
        GeometryReader { proxy in
            Canvas { context, size in
                let cell: CGFloat = 108
                let mark = cell * 0.56

                var row = 0
                var y = -mark
                while y < size.height + mark {
                    let shift = row.isMultiple(of: 2) ? 0 : cell / 2
                    var x = -mark + shift
                    while x < size.width + mark {
                        let rect = CGRect(x: x, y: y, width: mark, height: mark)
                        // Четыре дуги и точка — тот же разбор знака, что и в
                        // заставке: обои не «похожи на логотип», а сделаны из
                        // него.
                        for quadrant in 0..<4 {
                            let path = ArcSegment(
                                centerDegrees: Double(quadrant) * 90 + 45,
                                spanDegrees: 70,
                                radius: 0.355,
                                width: 0.155
                            ).path(in: rect)
                            context.fill(path, with: .color(Color.white.opacity(0.026)))
                        }
                        let dot = mark * 0.196
                        context.fill(
                            Path(ellipseIn: CGRect(
                                x: rect.midX - dot / 2,
                                y: rect.midY - dot / 2,
                                width: dot,
                                height: dot
                            )),
                            with: .color(Color.white.opacity(0.05))
                        )
                        x += cell
                    }
                    y += rowStep(cell)
                    row += 1
                }
            }
            // Решётка живёт по краям: под карточкой она мешала бы читать поля.
            .mask(
                RadialGradient(
                    colors: [.clear, .black.opacity(0.6), .black],
                    center: .center,
                    startRadius: min(proxy.size.width, proxy.size.height) * 0.20,
                    endRadius: max(proxy.size.width, proxy.size.height) * 0.60
                )
            )
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }

    private func rowStep(_ cell: CGFloat) -> CGFloat { cell * 0.86 }

    /// Затемнение по краям: собирает взгляд к центру, где форма.
    private var vignette: some View {
        RadialGradient(
            colors: [.clear, base.opacity(0.85)],
            center: .center,
            startRadius: 160,
            endRadius: 760
        )
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }
}
