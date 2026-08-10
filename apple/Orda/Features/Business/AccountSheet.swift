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

    @State private var confirmingLogout = false

    var body: some View {
        NavigationStack {
            ScreenScroll {
                VStack(spacing: Spacing.lg) {
                    identityCard
                    MyContactsCard()
                    AppearancePicker()
                    BiometricLockToggle()
                    logoutButton
                }
            }
            .background(Theme.background)
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

    private var logoutButton: some View {
        Button("Выйти из аккаунта") { confirmingLogout = true }
            .buttonStyle(DestructiveButtonStyle())
            .confirmationDialog("Выйти из аккаунта?", isPresented: $confirmingLogout, titleVisibility: .visible) {
                Button("Выйти", role: .destructive) {
                    Task { await auth.signOut() }
                }
                Button("Отмена", role: .cancel) {}
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

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Мои данные")

                if let profile {
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
