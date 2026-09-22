import OrdaKit
import OrdaUI
import SwiftUI

/// Профиль владельца и сотрудника — как профиль в банковском приложении.
///
/// Сверху — кто я: аватар, имя, роль, почта. Потом своё — зарплата и задачи.
/// Ниже — настройки строками с иконками: данные, пароль, уведомления,
/// оформление, Face ID, документы. Раньше здесь были только оформление и
/// выход, а смена пароля, данные и уведомления жили лишь в листе оператора.
struct BusinessProfileScreen: View {
    let resolver: AccessResolver

    @Environment(AuthStore.self) private var auth
    @Environment(\.api) private var api
    @AppStorage(Appearance.storageKey) private var appearance: Appearance = .system
    @AppStorage(LargeType.storageKey) private var largeType = false

    @State private var confirmingLogout = false
    @State private var changingPassword = false
    @State private var confirmingDelete = false
    @State private var isDeleting = false
    @State private var deleteError: String?
    @State private var lockEnabled = false
    @State private var didLoadLock = false

    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.lg) {
                header
                accessStats
                MySalaryCard()
                MyTasksCard()
                accountSection
                appSection
                aboutSection
                logout
                deleteAccount
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.top, Spacing.md)
            .padding(.bottom, Spacing.xxl)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.background)
        .navigationTitle("Профиль")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .sheet(isPresented: $changingPassword) { ChangePasswordSheet() }
        .alert("Выйти из аккаунта?", isPresented: $confirmingLogout) {
            Button("Выйти", role: .destructive) { Task { await auth.signOut() } }
            Button("Отмена", role: .cancel) {}
        }
        .confirmationDialog("Удалить аккаунт?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Удалить навсегда", role: .destructive) { Task { await removeAccount() } }
            Button("Отмена", role: .cancel) {}
        } message: {
            Text("Вход перестанет работать сразу, личные данные сотрутся. Смены, выручка и ведомости останутся у точки.")
        }
        .task {
            guard !didLoadLock else { return }
            didLoadLock = true
            lockEnabled = auth.isLockEnabled
        }
        .onChange(of: lockEnabled) { _, value in auth.isLockEnabled = value }
    }

    // ── Кто я ────────────────────────────────────────────────────────────────

    private var name: String { auth.role?.displayName ?? "Пользователь" }

    private var header: some View {
        VStack(spacing: Spacing.md) {
            Text(initials)
                .font(.system(size: 30, weight: .bold, design: .rounded))
                .foregroundStyle(Theme.navy)
                .frame(width: 84, height: 84)
                .background(.white, in: Circle())
                .overlay(Circle().strokeBorder(Theme.cobalt, lineWidth: 3))

            VStack(spacing: 4) {
                Text(name)
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                if let email = auth.session?.email, email != name {
                    Text(email)
                        .font(.system(size: 14))
                        .foregroundStyle(.white.opacity(0.75))
                }
            }

            if let label = auth.role?.roleLabel {
                Text(label)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(.white.opacity(0.16), in: Capsule())
            }
        }
        .padding(.vertical, Spacing.xl)
        .frame(maxWidth: .infinity)
        .background(
            LinearGradient(colors: Theme.heroGradient, startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: 28, style: .continuous)
        )
        .overlay(alignment: .topTrailing) {
            // Знак бренда в углу — тихо, как водяной знак на карте.
            OrdaControlMark(ringColor: .white.opacity(0.14))
                .frame(width: 90, height: 90)
                .offset(x: 18, y: -14)
                .clipped()
                .allowsHitTesting(false)
        }
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
    }

    private var initials: String {
        let words = name.split(separator: " ").prefix(2)
        let letters = words.compactMap(\.first).map(String.init).joined()
        return letters.isEmpty ? "?" : letters.uppercased()
    }

    /// Доступ — тремя цифрами в ряд, а не табличкой.
    private var accessStats: some View {
        let groups = resolver.nativeGroups()
        return HStack(spacing: 0) {
            stat("\(groups.count)", "разделов")
            Rectangle().fill(Theme.border).frame(width: 1, height: 36)
            stat("\(groups.reduce(0) { $0 + $1.pages.count })", "страниц")
            Rectangle().fill(Theme.border).frame(width: 1, height: 36)
            stat(resolver.isAllAccess ? "Полный" : "Частичный", "доступ")
        }
        .padding(.vertical, Spacing.md)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundStyle(Theme.text)
            Text(label)
                .font(.system(size: 12))
                .foregroundStyle(Theme.textDim)
        }
        .frame(maxWidth: .infinity)
    }

    // ── Настройки ────────────────────────────────────────────────────────────

    private var accountSection: some View {
        OwnerSection("Аккаунт") {
            EmptyView()
        } content: {
            VStack(spacing: 0) {
                NavigationLink {
                    ScreenScroll { MyContactsCard() }
                        .background(Theme.background)
                        .navigationTitle("Мои данные")
                } label: {
                    settingsRow("person.text.rectangle.fill", Theme.cobalt, "Мои данные", "имя, телефон, почта, Telegram, фото")
                }
                .buttonStyle(.plain)
                divider
                Button { changingPassword = true } label: {
                    settingsRow("key.fill", Color(hex: 0xD97706), "Сменить пароль", nil)
                }
                .buttonStyle(.plain)
                divider
                NavigationLink {
                    ScreenScroll { NotificationsCard() }
                        .background(Theme.background)
                        .navigationTitle("Уведомления")
                } label: {
                    settingsRow("bell.badge.fill", Theme.negative, "Уведомления", "что присылать и проверка")
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var appSection: some View {
        OwnerSection("Приложение") {
            EmptyView()
        } content: {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    settingsRow("circle.lefthalf.filled", Theme.navy, "Оформление", nil, chevron: false)
                    PillSegment(
                        options: Appearance.allCases.map { ($0, $0.title) },
                        selection: $appearance
                    )
                }
                .padding(.bottom, Spacing.sm)
                divider
                Toggle(isOn: $largeType) {
                    settingsRow("textformat.size", Color(hex: 0x0D9488), "Крупный шрифт", "цифры и подписи крупнее", chevron: false)
                }
                .tint(Theme.brand)
                if Biometrics.isAvailable {
                    divider
                    Toggle(isOn: $lockEnabled) {
                        settingsRow(Biometrics.iconName, Theme.cobalt, "Запрашивать \(Biometrics.displayName)", "при возврате в приложение", chevron: false)
                    }
                    .tint(Theme.brand)
                }
                if auth.hasQuickEntry {
                    divider
                    Button {
                        auth.forgetQuickEntry()
                        Haptics.tap()
                    } label: {
                        settingsRow("iphone.slash", Theme.textDim, "Забыть это устройство", "быстрый вход после выхода", chevron: false)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var aboutSection: some View {
        OwnerSection("О приложении") {
            EmptyView()
        } content: {
            VStack(spacing: 0) {
                Link(destination: URL(string: "https://www.ordaops.kz/privacy")!) {
                    settingsRow("hand.raised.fill", Theme.navy, "Политика конфиденциальности", nil)
                }
                divider
                Link(destination: URL(string: "https://www.ordaops.kz/terms")!) {
                    settingsRow("doc.text.fill", Theme.navy, "Условия использования", nil)
                }
                divider
                HStack(spacing: Spacing.md) {
                    OrdaControlAppIcon(size: 40)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("ORDA CONTROL")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Theme.text)
                        Text("Версия \(appVersion)")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textDim)
                    }
                    Spacer()
                }
                .padding(.vertical, Spacing.sm)
            }
        }
    }

    private var logout: some View {
        Button { confirmingLogout = true } label: {
            HStack {
                Image(systemName: "rectangle.portrait.and.arrow.right")
                Text("Выйти из аккаунта")
            }
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(Theme.negative)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
        .buttonStyle(.pressable)
    }

    private var deleteAccount: some View {
        VStack(spacing: Spacing.xs) {
            Button(isDeleting ? "Удаляем…" : "Удалить аккаунт") { confirmingDelete = true }
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Theme.textDim)
                .disabled(isDeleting)
            if let deleteError {
                Text(deleteError)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.negative)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
    }

    // ── Мелочи ───────────────────────────────────────────────────────────────

    private var divider: some View {
        Rectangle().fill(Theme.borderSoft).frame(height: 1).padding(.leading, 52)
    }

    private func settingsRow(_ icon: String, _ tint: Color, _ title: String, _ subtitle: String?, chevron: Bool = true) -> some View {
        HStack(spacing: Spacing.md) {
            TintedIcon(systemName: icon, tint: tint, size: 38, corner: 11)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Theme.text)
                if let subtitle {
                    Text(subtitle)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textDim)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: Spacing.sm)
            if chevron {
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.textDim)
            }
        }
        .padding(.vertical, 10)
        .contentShape(Rectangle())
    }

    private var appVersion: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "—"
        let build = info?["CFBundleVersion"] as? String ?? ""
        return build.isEmpty ? short : "\(short) (\(build))"
    }

    private func removeAccount() async {
        guard !isDeleting else { return }
        isDeleting = true
        defer { isDeleting = false }
        deleteError = nil
        do {
            try await MyProfileService(api: api).deleteAccount()
            auth.forgetQuickEntry()
            await auth.signOut()
        } catch let error as APIError {
            deleteError = error.userMessage
        } catch {
            deleteError = error.localizedDescription
        }
    }
}
