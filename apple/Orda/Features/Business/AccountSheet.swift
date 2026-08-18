import OrdaKit
import OrdaUI
import SwiftUI

/// Настройки аккаунта.
///
/// До этого их негде было открыть, кроме телефона: на планшете и Mac кнопка в
/// шапке предлагала только выход, а вкладка «Профиль» существует лишь в
/// компактной раскладке. Оформление и замок были доступны половине устройств.
///
/// Живёт листом, а не разделом каталога: это настройки человека, а не бизнеса,
/// и правами они не закрываются — свой аккаунт есть у каждого, кто вошёл.
struct AccountSheet: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss

    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif
    @State private var confirmingLogout = false
    @State private var changingPassword = false
    @State private var confirmingDelete = false
    @State private var isDeleting = false
    @State private var deleteError: String?
    @Environment(\.api) private var api

    /// Личные карточки — там, где нет вкладки «Профиль».
    private var showsPersonalCards: Bool {
        #if os(iOS)
        sizeClass != .compact
        #else
        true
        #endif
    }

    var body: some View {
        NavigationStack {
            ScreenScroll {
                VStack(spacing: Spacing.lg) {
                    identityCard
                    // На телефоне своё — зарплата и поручения — живёт во
                    // вкладке «Профиль»; дублировать карточки в двух местах,
                    // до которых два касания, незачем. На айпаде и Mac вкладок
                    // нет, и этот лист — единственный личный экран.
                    if showsPersonalCards {
                        MySalaryCard()
                        MyTasksCard()
                    }
                    MyContactsCard()
                    NotificationsCard()
                    AppearancePicker()
                    LargeTypeToggle()
                    BiometricLockToggle()
                    passwordCard
                    quickEntryCard
                    logoutButton
                    legalCard
                    deleteAccountCard
                }
            }
            .background(Theme.background)
            // Лист живёт своим контроллером: без этого крупный шрифт
            // включался «где-то там», а на экране, где его включают, — нет.
            .largeTypeIfEnabled()
            .navigationTitle("Аккаунт")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Готово") { dismiss() }
                }
            }
        }
    }

    private var identityCard: some View {
        Card {
            HStack(spacing: Spacing.lg) {
                Image(systemName: "person.crop.circle.fill")
                    .font(.system(size: 40))
                    .foregroundStyle(Theme.brand)

                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text(auth.role?.displayName ?? "Пользователь")
                        .font(Typography.title)
                        .foregroundStyle(Theme.text)
                    if let label = auth.role?.roleLabel {
                        Text(label)
                            .font(Typography.callout)
                            .foregroundStyle(Theme.textMuted)
                    }
                    if let email = auth.session?.email {
                        Text(email)
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                    }
                }
                Spacer()
            }
        }
    }

    /// Быстрый вход по Face ID.
    ///
    /// Включается сам при первом входе — иначе про него никто не узнает.
    /// Отключить нужно уметь: телефон могут сдать в ремонт или передать
    /// сменщику, и тогда лицо на нём будет чужое.
    @ViewBuilder
    private var quickEntryCard: some View {
        if auth.hasQuickEntry {
            Card {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    SectionHeader("Быстрый вход")
                    Text("После выхода можно вернуться по Face ID — пароль вводить не нужно. Само устройство помнит только токен доступа, а не пароль.")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textMuted)
                    Button("Забыть это устройство") {
                        auth.forgetQuickEntry()
                        Haptics.tap()
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }
            }
        }
    }

    /// Номер сборки нужен поддержке: без него на вопрос «что у вас в
    /// приложении» отвечают догадками.
    private var appVersion: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "—"
        let build = info?["CFBundleVersion"] as? String ?? ""
        return build.isEmpty ? short : "\(short) (\(build))"
    }

    /// Документы.
    ///
    /// Ссылка на политику обязательна для App Store, но нужна и без него: человек
    /// решает удалять ли аккаунт, прочитав, что именно останется у точки.
    private var legalCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                SectionHeader("Документы")
                Link("Политика конфиденциальности", destination: URL(string: "https://www.ordaops.kz/privacy")!)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.brand)
                Link("Условия использования", destination: URL(string: "https://www.ordaops.kz/terms")!)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.brand)
                Text("Версия \(appVersion)")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
            }
        }
    }

    /// Удаление своего аккаунта.
    ///
    /// Требование App Store: если в приложении можно войти, из него же должно
    /// быть можно уйти — без писем в поддержку.
    ///
    /// Пишем прямо, что произойдёт. «Удалить аккаунт» человек читает как
    /// «стереть все мои данные», а рабочие записи — смены, выручка, ведомости —
    /// останутся: на них стоит бухгалтерия точки и деньги других людей.
    private var deleteAccountCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                SectionHeader("Удаление аккаунта")
                Text("Вход перестанет работать, личные данные — телефон, почта, Telegram — будут стёрты. Отменить нельзя.")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textMuted)
                Text("Смены, выручка и зарплатные ведомости останутся: они принадлежат точке, а не учётной записи. Владелец получит уведомление.")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)

                if let deleteError {
                    Text(deleteError)
                        .font(Typography.caption)
                        .foregroundStyle(Theme.negative)
                }

                Button(isDeleting ? "Удаляем…" : "Удалить аккаунт") {
                    confirmingDelete = true
                }
                .buttonStyle(SecondaryButtonStyle())
                .disabled(isDeleting)
                .confirmationDialog(
                    "Удалить аккаунт?",
                    isPresented: $confirmingDelete,
                    titleVisibility: .visible
                ) {
                    Button("Удалить навсегда", role: .destructive) {
                        Task { await deleteAccount() }
                    }
                    Button("Отмена", role: .cancel) {}
                } message: {
                    Text("Вход перестанет работать сразу. Восстановить аккаунт сможет только владелец — заведя новый.")
                }
            }
        }
    }

    private func deleteAccount() async {
        guard !isDeleting else { return }
        isDeleting = true
        defer { isDeleting = false }
        deleteError = nil

        do {
            try await MyProfileService(api: api).deleteAccount()
            // Сессия мертва: токен указывает на удалённого пользователя. И
            // быстрый вход забываем — возвращаться больше некуда.
            auth.forgetQuickEntry()
            await auth.signOut()
        } catch let error as APIError {
            deleteError = error.userMessage
        } catch {
            deleteError = error.localizedDescription
        }
    }

    /// Смена своего пароля.
    ///
    /// Оператору её негде было сделать вовсе: временный пароль он получал от
    /// владельца и менял на сайте, то есть «когда дойду до компьютера».
    private var passwordCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                SectionHeader("Пароль")
                Text("Меняется здесь же — текущий пароль спросим для подтверждения.")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
                Button {
                    changingPassword = true
                } label: {
                    Label("Сменить пароль", systemImage: "key")
                }
                .buttonStyle(SecondaryButtonStyle())
            }
        }
        .sheet(isPresented: $changingPassword) { ChangePasswordSheet() }
    }

    private var logoutButton: some View {
        Button("Выйти из аккаунта") { confirmingLogout = true }
            .buttonStyle(DestructiveButtonStyle())
            .alert("Выйти из аккаунта?", isPresented: $confirmingLogout) {
                Button("Выйти", role: .destructive) {
                    Task { await auth.signOut() }
                }
                Button("Отмена", role: .cancel) {}
            }
    }
}

/// Своя зарплата — в своём аккаунте.
///
/// Право «Смотреть зарплату» открывает ведомость всей организации, и владелец
/// справедливо снимает его с обычного сотрудника. Но человек остаётся с
/// вопросом «сколько мне придёт 15-го» и идёт с ним к владельцу. Оператор
/// свою неделю видит сам — окладный сотрудник теперь тоже видит свою половину
/// месяца, и только свою: сервер отдаёт ему одну строку.
///
/// Когда строки нет, карточка не исчезает молча, а называет причину. Молчание
/// уже стоило одного разбирательства: у сотрудника с окладом в 500 000 экран
/// был пуст, и понять по нему было нечего — не заведено, не связано или не
/// загрузилось.
struct MySalaryCard: View {
    @Environment(\.api) private var api

    @State private var row: StaffSalaryRow?
    @State private var slot: String = "first"
    @State private var didLoad = false
    /// Ответ пришёл, но своей строки в нём нет.
    @State private var missing: Missing?

    /// Почему зарплаты не видно.
    enum Missing {
        /// Аккаунт не связан ни с карточкой сотрудника, ни с оператором.
        case notLinked
        /// Связан, но в ведомости строки нет — оклад не заведён.
        case noRow
        /// Сервер отказал или не ответил.
        case failed(String)

        var text: String {
            switch self {
            case .notLinked:
                "Аккаунт не связан с карточкой сотрудника — попросите владельца привязать её, тогда здесь появится ваш расчёт."
            case .noRow:
                "Оклад по вам не заведён. Если он должен быть — скажите владельцу."
            case let .failed(reason):
                "Не удалось загрузить: \(reason)"
            }
        }
    }

    var body: some View {
        Group {
            if let row {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        SectionHeader(
                            "Моя зарплата",
                            subtitle: slot == "first" ? "выплата до 15-го" : "выплата после 15-го"
                        )

                        HStack(alignment: .firstTextBaseline) {
                            Text(Money.format(row.toPay))
                                .font(Typography.title)
                                .monospacedDigit()
                                .foregroundStyle(Theme.text)
                            Text("к выплате")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textMuted)
                        }

                        // Из чего вышла сумма. Спорят обычно не о полутора
                        // окладах, а о вычетах, — их и показываем поимённо.
                        StatRow("Половина оклада", value: Money.format(row.half), icon: "banknote")
                        if row.bonuses > 0.01 {
                            StatRow("Бонусы", value: Money.signed(row.bonuses), valueColor: Theme.positive, icon: "gift")
                        }
                        if row.fines > 0.01 {
                            StatRow("Штрафы", value: Money.signed(-row.fines), valueColor: Theme.negative, icon: "exclamationmark.triangle")
                        }
                        if row.debts > 0.01 {
                            StatRow("Долги", value: Money.signed(-row.debts), valueColor: Theme.negative, icon: "creditcard")
                        }
                        if row.advances > 0.01 {
                            StatRow("Авансы", value: Money.signed(-row.advances), valueColor: Theme.warning, icon: "arrow.down.circle")
                        }
                        if row.paidThisMonth > 0.01 {
                            RowDivider()
                            StatRow("Выплачено в этом месяце", value: Money.format(row.paidThisMonth), icon: "checkmark.circle")
                        }
                        if row.monthClosed {
                            Text("Обе выплаты месяца проведены — следующая в следующем месяце.")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textDim)
                        }
                    }
                }
            } else {
                // Пока не загрузили — карточка с заглушкой, а не пустота.
                //
                // Дело не в красоте: `Group`, у которого не отрисовалась ни
                // одна ветка, схлопывается в `EmptyView`, а `.task` на
                // `EmptyView` не выполняется вовсе. Карточка не показывалась,
                // потому что запрос за зарплатой никогда не уходил, — и
                // «объясняющая» строка про причину не спасала: её ветка тоже
                // была пуста.
                Card {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        SectionHeader("Моя зарплата")
                        Text(missing?.text ?? "Загружаем расчёт…")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textMuted)
                    }
                }
            }
        }
        .task {
            guard !didLoad else { return }
            didLoad = true
            await load()
        }
    }

    private func load() async {
        // Отказ сервера тоже называем. Молчание уже стоило двух заходов: на
        // экране не было ни зарплаты, ни причины, и отличить «не заведено» от
        // «не доехало обновление сайта» было нечем.
        do {
            let summary = try await BusinessService(api: api).staffSalary()
            slot = summary.slot
            row = summary.rows.first(where: \.isMe) ?? (summary.selfOnly ? summary.rows.first : nil)
            // Старый сервер сводки не знает и про связь аккаунта не отвечает —
            // тогда говорим прямо про обновление, а не про человека.
            missing = row == nil
                ? (summary.meLinked.map { $0 ? Missing.noRow : Missing.notLinked }
                    ?? .failed("на сайте ещё старая версия расчёта"))
                : nil
        } catch let error as APIError {
            row = nil
            missing = .failed(error.userMessage)
        } catch {
            row = nil
            missing = .failed(error.localizedDescription)
        }
    }
}

/// Свои контакты — единственное, что человек правит о себе сам.
///
/// Раньше поменять собственный номер телефона можно было только через
/// владельца: он открывал админский раздел и вписывал то, что ему продиктовали.
/// Владелец при этом не знает контакты лучше самого человека — он их у него и
/// спрашивал.
///
/// Имя, должность и ставка показаны, но не правятся: на них считается зарплата
/// и строится подчинение, и менять их о себе — значит ломать учёт.
struct MyContactsCard: View {
    @Environment(\.api) private var api

    @State private var profile: MyProfile?
    @State private var phone = ""
    @State private var email = ""
    @State private var telegram = ""
    @State private var isSaving = false
    @State private var message: String?
    @State private var isError = false
    @State private var didLoad = false
    @State private var isLoading = true
    /// Почему не загрузилось. Пустое состояние и загрузка выглядят одинаково,
    /// и без этого карточка крутила скелет бесконечно.
    @State private var loadError: APIError?
    @State private var pickingPhoto = false
    @State private var isUploading = false

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Мои данные")

                if let profile {
                    // Своё фото: его меняют раз в год, но когда собираются —
                    // ищут именно здесь, рядом с остальными своими данными.
                    HStack(spacing: Spacing.md) {
                        FeedAvatar(
                            initials: FeedText.initials(profile.fullName ?? "?"),
                            side: 64,
                            tint: Theme.brand,
                            photoURL: profile.photoURL
                        )

                        VStack(alignment: .leading, spacing: Spacing.xxs) {
                            Text(profile.fullName ?? "Без имени")
                                .font(Typography.callout.weight(.semibold))
                                .foregroundStyle(Theme.text)

                            #if os(iOS)
                            Button(isUploading ? "Загружаем…" : "Сменить фото") {
                                pickingPhoto = true
                            }
                            .buttonStyle(.pressable)
                            .font(Typography.caption.weight(.medium))
                            .foregroundStyle(Theme.brand)
                            .disabled(isUploading)
                            #endif
                        }

                        Spacer()
                    }

                    RowDivider()

                    if let position = profile.position, !position.isEmpty {
                        StatRow("Должность", value: position, icon: "briefcase")
                        Text("Должность и имя меняет владелец — по ним считается зарплата.")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                    }

                    FieldLabel("Телефон")
                    field($phone, placeholder: "+7 700 000 00 00", keyboard: .phone)

                    FieldLabel("Почта")
                    field($email, placeholder: "name@example.com", keyboard: .email)

                    if profile.supportsTelegram {
                        FieldLabel("Telegram для уведомлений")
                        field($telegram, placeholder: "chat id", keyboard: .plain)
                    }

                    if let message {
                        Text(message)
                            .font(Typography.caption)
                            .foregroundStyle(isError ? Theme.negative : Theme.positive)
                    }

                    Button(isSaving ? "Сохраняем…" : "Сохранить") {
                        Task { await save() }
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(isSaving || !hasChanges)
                } else if isLoading {
                    LoadingRows(count: 2)
                } else if let loadError {
                    unavailable(loadError)
                } else {
                    // Ни профиля, ни ошибки: человек не числится ни
                    // сотрудником, ни оператором — например, суперадмин.
                    Text("Менять нечего: ваша учётная запись не привязана к сотруднику или оператору.")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                }
            }
        }
        #if os(iOS)
        .fullScreenCover(isPresented: $pickingPhoto) { photoPicker }
        #endif
        .task {
            guard !didLoad else { return }
            didLoad = true
            await load()
        }
    }

    /// Раздел недоступен. Отдельный случай — устаревший сервер: приложение
    /// обновляется само, сайт выкатывают отдельно, и человек не должен гадать,
    /// почему поле не появляется.
    @ViewBuilder
    private func unavailable(_ error: APIError) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            if error.looksMissingOnServer {
                Text("Правка своих данных появится после обновления сайта.")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
            } else {
                Text(error.userMessage)
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textMuted)
                Button("Повторить") { Task { await load() } }
                    .buttonStyle(SecondaryButtonStyle())
            }
        }
    }

    private enum Keyboard { case phone, email, plain }

    #if os(iOS)
    /// Системный выбор: камера на устройстве, галерея в симуляторе.
    private var photoPicker: some View {
        CameraCapture { data in
            Task { await upload(data) }
        }
        .ignoresSafeArea()
    }
    #endif

    @ViewBuilder
    private func field(_ text: Binding<String>, placeholder: String, keyboard: Keyboard) -> some View {
        TextField(placeholder, text: text)
            .textFieldStyle(.plain)
            .font(Typography.callout)
            .foregroundStyle(Theme.text)
            .padding(Spacing.md)
            .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
            #if os(iOS)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .keyboardType(keyboard == .phone ? .phonePad : keyboard == .email ? .emailAddress : .default)
            #endif
    }

    private var hasChanges: Bool {
        guard let profile else { return false }
        return phone != (profile.phone ?? "")
            || email != (profile.email ?? "")
            || telegram != (profile.telegramChatID ?? "")
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }

        do {
            let loaded = try await MyProfileService(api: api).load()
            profile = loaded
            phone = loaded.phone ?? ""
            email = loaded.email ?? ""
            telegram = loaded.telegramChatID ?? ""
            loadError = nil
        } catch let error as APIError {
            profile = nil
            // 404 — профиля нет вовсе: у суперадмина, который не числится ни
            // сотрудником, ни оператором, менять действительно нечего.
            // Остальное — настоящий отказ, и о нём надо сказать.
            loadError = error
        } catch {
            profile = nil
            loadError = .transport(message: error.localizedDescription)
        }
    }

    #if os(iOS)
    /// Загрузить снимок и обновить карточку.
    ///
    /// Данные приходят готовым JPEG из системного выбора — пережимать их
    /// второй раз незачем.
    ///
    private func upload(_ data: Data) async {
        isUploading = true
        defer { isUploading = false }

        do {
            _ = try await MyProfileService(api: api).uploadAvatar(data)
            await load()
            message = "Фото обновлено"
            isError = false
            Haptics.success()
        } catch let error as APIError {
            message = error.userMessage
            isError = true
            Haptics.error()
        } catch {
            message = error.localizedDescription
            isError = true
            Haptics.error()
        }
    }
    #endif

    private func save() async {
        guard !isSaving, let profile else { return }
        isSaving = true
        defer { isSaving = false }

        var change = MyProfileChange()
        if phone != (profile.phone ?? "") { change.phone = phone }
        if email != (profile.email ?? "") { change.email = email }
        if profile.supportsTelegram, telegram != (profile.telegramChatID ?? "") {
            change.telegramChatID = telegram
        }

        if let blocker = change.validationMessage {
            message = blocker
            isError = true
            return
        }

        do {
            try await MyProfileService(api: api).save(change)
            await load()
            message = "Сохранено"
            isError = false
            Haptics.success()
        } catch let error as APIError {
            message = error.userMessage
            isError = true
        } catch {
            message = error.localizedDescription
            isError = true
        }
    }
}

// ── Части, общие для листа и вкладки «Профиль» ───────────────────────────────

/// Выбор оформления.
///
/// Цвета в приложении адаптивные и следуют за системой сами. Этот выбор нужен,
/// чтобы её перебить: телефон уходит в тёмное по расписанию, а смотреть цифры
/// кому-то удобнее на светлом; в зале клуба наоборот.
struct AppearancePicker: View {
    @AppStorage(Appearance.storageKey) private var appearance: Appearance = .system

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                FieldLabel("Оформление")
                Picker("Оформление", selection: $appearance) {
                    ForEach(Appearance.allCases) { option in
                        Label(option.title, systemImage: option.icon).tag(option)
                    }
                }
                .pickerStyle(.segmented)

                Text("«Как в системе» — приложение темнеет и светлеет вместе с телефоном.")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
            }
        }
    }
}

/// Состояние уведомлений.
///
/// «Мне не приходят уведомления» — жалоба, которую нельзя проверить со стороны:
/// причина либо в выключенном разрешении, либо в том, что телефон не успел
/// зарегистрироваться. Карточка показывает, что именно, и ведёт туда, где это
/// чинится, — иначе разбираться приходится вслепую.
struct NotificationsCard: View {
    @State private var status: PushManager.Status = .unknown
    @Environment(\.openURL) private var openURL

    @State private var isTesting = false
    @State private var testResult: String?

    var body: some View {
        Card(accent: accent) {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                HStack(spacing: Spacing.sm) {
                    Image(systemName: icon)
                        .foregroundStyle(accent ?? Theme.positive)
                    Text(title)
                        .font(Typography.callout.weight(.medium))
                        .foregroundStyle(Theme.text)
                    Spacer()
                }

                Text(explanation)
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
                    .fixedSize(horizontal: false, vertical: true)

                #if os(iOS)
                if case .denied = status {
                    Button("Открыть настройки") {
                        if let url = URL(string: UIApplication.openSettingsURLString) {
                            openURL(url)
                        }
                    }
                    .buttonStyle(SecondaryButtonStyle())
                } else if case .notRequested = status {
                    Button("Включить уведомления") {
                        Task {
                            await PushManager.shared.request()
                            await refresh()
                        }
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }

                // Проверка на себе. «Не приходит» — это три разные поломки:
                // не спросили разрешение, устройство не зарегистрировалось,
                // сервер не настроен. Кнопка отвечает, какая именно.
                if case .denied = status {} else {
                    Button {
                        Task {
                            isTesting = true
                            testResult = await PushManager.shared.sendTest()
                            isTesting = false
                            await refresh()
                        }
                    } label: {
                        if isTesting {
                            ProgressView().controlSize(.small)
                        } else {
                            Text("Проверить уведомления")
                        }
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(isTesting)
                }

                if let testResult {
                    Text(testResult)
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                #endif
            }
        }
        .task { await refresh() }
    }

    private func refresh() async {
        await PushManager.shared.refreshStatus()
        status = PushManager.shared.status
    }

    private var accent: Color? {
        switch status {
        case .authorized(true): nil
        case .unknown: nil
        default: Theme.warning
        }
    }

    private var icon: String {
        switch status {
        case .authorized(true): "bell.badge.fill"
        case .authorized(false): "bell.slash"
        case .denied: "bell.slash.fill"
        case .notRequested: "bell"
        case .unknown: "bell"
        }
    }

    private var title: String {
        switch status {
        case .authorized(true): "Уведомления приходят"
        case .authorized(false): "Уведомления разрешены, но телефон не зарегистрирован"
        case .denied: "Уведомления выключены"
        case .notRequested: "Уведомления не включены"
        case .unknown: "Уведомления"
        }
    }

    private var explanation: String {
        switch status {
        case .authorized(true):
            "Придут упоминания в чате, личные сообщения, задачи и напоминания об экзаменах."
        case .authorized(false):
            "Разрешение есть, но телефон ещё не отметился на сервере. Обычно проходит само; если нет — перезапустите приложение."
        case .denied:
            "Разрешение отозвано в настройках телефона. Пока оно выключено, упоминание в чате не придёт — его видно только в самом чате."
        case .notRequested:
            "Пока не включены. Без них упоминание в чате и сообщение от управляющего можно заметить только зайдя в приложение."
        case .unknown:
            "Проверяем состояние…"
        }
    }
}

/// Крупный шрифт за стойкой.
///
/// Кассир смотрит на телефон мельком, между покупателем и терминалом, часто с
/// вытянутой руки. Системный размер текста при этом трогать не хочется: тем же
/// телефоном человек пользуется и вне смены.
///
/// Не фиксированный размер, а нижняя граница: если в системе выставлен ещё
/// более крупный шрифт, он и останется — иначе настройка доступности молча
/// отменялась бы.
struct LargeTypeToggle: View {
    @AppStorage(LargeType.storageKey) private var isEnabled = false

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Toggle(isOn: $isEnabled) {
                    Label("Крупный шрифт", systemImage: "textformat.size")
                        .font(Typography.callout.weight(.medium))
                }
                .tint(Theme.brand)

                Text("Цифры и подписи крупнее — чтобы видеть их с вытянутой руки. Системный размер текста не меняется.")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
            }
        }
    }
}

/// Настройка крупного шрифта. Живёт на устройстве: это настройка глаз, а не
/// учётной записи — на планшете у стойки и на личном телефоне удобно
/// по-разному.
enum LargeType {
    static let storageKey = "orda.type.large"
}

/// Замок по биометрии.
///
/// Из приложения видно зарплаты и логины всей команды — телефон, оставленный
/// на стойке разблокированным, не должен давать к этому доступ. Но и запирать
/// каждое переключение незачем, поэтому это настройка, а не правило.
struct BiometricLockToggle: View {
    @Environment(AuthStore.self) private var auth
    @State private var isEnabled = false
    @State private var didLoad = false

    var body: some View {
        if Biometrics.isAvailable {
            Card {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    Toggle(isOn: $isEnabled) {
                        Label("Запрашивать \(Biometrics.displayName)", systemImage: Biometrics.iconName)
                            .font(Typography.callout)
                            .foregroundStyle(Theme.text)
                    }
                    Text("При возврате в приложение. Сессия остаётся — заново входить не придётся.")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                }
            }
            .onChange(of: isEnabled) { _, value in
                auth.isLockEnabled = value
            }
            .task {
                guard !didLoad else { return }
                didLoad = true
                isEnabled = auth.isLockEnabled
            }
        }
    }
}
