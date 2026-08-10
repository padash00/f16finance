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
