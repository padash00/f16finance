import OrdaKit
import OrdaUI
import SwiftUI

// ── Обзор платформы ──────────────────────────────────────────────────────────

/// Дашборд суперадмина.
///
/// Другая оптика, чем у владельца: здесь показатель не «выручка точки», а
/// здоровье платформы — сколько организаций платят, сколько на триале,
/// сколько просрочили. И сразу под этим — кто требует вмешательства.
///
/// Подача та же, что у главной владельца: одна большая цифра в тёмно-синей
/// карточке, под ней белые блоки со строками.
struct PlatformOverviewScreen: View {
    @Environment(PlatformStore.self) private var store

    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.lg) {
                if let error = store.error, store.data == nil {
                    ErrorStateView(error: error) { Task { await store.load() } }
                } else if store.isLoading && store.data == nil {
                    Skeleton(height: 190, cornerRadius: 28)
                    Skeleton(height: 220, cornerRadius: 24)
                } else {
                    hero
                    billing
                    if !store.attention.isEmpty { attention }
                    scale
                    subscriptions
                }
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.top, Spacing.sm)
            .padding(.bottom, Spacing.xxl)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.background)
        .navigationTitle("Платформа")
        .navigationDestination(for: OrganizationRoute.self) { route in
            OrganizationDetailScreen(organization: route.organization)
        }
        .toolbar { LogoutToolbarItem() }
        .task { if store.data == nil { await store.load() } }
        .refreshable { await store.load() }
    }

    // ── Главная цифра ────────────────────────────────────────────────────────

    private var hero: some View {
        let overview = store.overview
        // Триальная выручка отдельной строкой: это ещё не деньги, и
        // складывать её с живой было бы самообманом.
        return HeroSummary(
            title: "Регулярная выручка в месяц",
            value: Money.format(overview.liveMrr),
            caption: overview.trialMrr > 0 ? "на триале ещё \(Money.format(overview.trialMrr))" : nil,
            footer: [
                ("Оплачено в месяце", Money.format(overview.paidThisMonth)),
                ("Платящих", "\(overview.activeSubscriptions)"),
                ("На триале", "\(overview.trialingSubscriptions)"),
            ]
        )
        .overlay(alignment: .topTrailing) {
            OrdaControlMark(ringColor: .white.opacity(0.10))
                .frame(width: 110, height: 110)
                .offset(x: 28, y: -22)
                .allowsHitTesting(false)
        }
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
    }

    // ── Масштаб ──────────────────────────────────────────────────────────────

    private var scale: some View {
        let overview = store.overview
        return OwnerSection("Масштаб") {
            EmptyView()
        } content: {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: Spacing.md), GridItem(.flexible())], spacing: Spacing.md) {
                scaleCell("building.2.fill", Theme.brand, "\(overview.organizationCount)", "организаций")
                scaleCell("checkmark.seal.fill", Theme.positive, "\(overview.activeOrganizationCount)", "активных")
                scaleCell("storefront.fill", Color(hex: 0x0D9488), "\(overview.totalCompanies)", "точек")
                scaleCell("person.2.fill", Color(hex: 0xD97706), "\(overview.totalMembers)", "сотрудников")
            }
        }
    }

    private func scaleCell(_ icon: String, _ tint: Color, _ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            TintedIcon(systemName: icon, tint: tint, size: 36, corner: 11)
            VStack(alignment: .leading, spacing: 0) {
                Text(value)
                    .font(.system(size: 22, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                Text(label)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }
        }
        .padding(Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    // ── Требуют внимания ─────────────────────────────────────────────────────

    private var attention: some View {
        OwnerSection("Требуют внимания") {
            Text("\(store.attention.count)")
                .font(.system(size: 15, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(Theme.warning)
        } content: {
            VStack(spacing: 0) {
                ForEach(Array(store.attention.prefix(8).enumerated()), id: \.element.id) { index, org in
                    if index > 0 {
                        Rectangle().fill(Theme.borderSoft).frame(height: 1).padding(.leading, 52)
                    }
                    attentionRow(org)
                }
            }
        }
    }

    @ViewBuilder
    private func attentionRow(_ org: AttentionOrg) -> some View {
        let row = HStack(spacing: Spacing.md) {
            LetterBadge(text: org.name, tint: Theme.warning)
            VStack(alignment: .leading, spacing: 3) {
                Text(org.name)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text(org.reasons.joined(separator: " · "))
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.warning)
                    .lineLimit(2)
            }
            Spacer(minLength: Spacing.sm)
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.textDim)
        }
        .padding(.vertical, Spacing.sm)
        .contentShape(Rectangle())

        // Строка ведёт в карточку организации — там и заморозка, и подписка.
        if let organization = store.organizations.first(where: { $0.id == org.id }) {
            NavigationLink(value: OrganizationRoute(organization: organization)) { row }
                .buttonStyle(.plain)
        } else {
            row
        }
    }

    // ── Биллинг ──────────────────────────────────────────────────────────────

    @ViewBuilder
    private var billing: some View {
        let overview = store.overview
        if overview.overdueInvoices > 0 || overview.trialsEndingSoon > 0 {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Spacing.md) {
                    if overview.overdueInvoices > 0 {
                        billingCard(
                            icon: "exclamationmark.circle.fill",
                            tint: Theme.negative,
                            title: "\(overview.overdueInvoices) \(pluralize(overview.overdueInvoices, "счёт просрочен", "счёта просрочено", "счетов просрочено"))",
                            subtitle: Money.format(overview.overdueInvoicesSum)
                        )
                    }
                    if overview.trialsEndingSoon > 0 {
                        billingCard(
                            icon: "hourglass",
                            tint: Theme.warning,
                            title: "\(overview.trialsEndingSoon) \(pluralize(overview.trialsEndingSoon, "триал истекает", "триала истекают", "триалов истекают"))",
                            subtitle: "в ближайшую неделю"
                        )
                    }
                }
            }
            .scrollClipDisabled()
        }
    }

    private func billingCard(icon: String, tint: Color, title: String, subtitle: String) -> some View {
        HStack(spacing: Spacing.md) {
            TintedIcon(systemName: icon, tint: tint, size: 42)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }
        }
        .padding(Spacing.md)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    // ── Подписки ─────────────────────────────────────────────────────────────

    private var subscriptions: some View {
        let overview = store.overview
        let total = max(store.subscriptionBreakdown.reduce(0) { $0 + $1.count }, 1)
        let rows: [(String, Int, Color)] = [
            ("Активные", overview.activeSubscriptions, Theme.positive),
            ("Триал", overview.trialingSubscriptions, Theme.info),
            ("Просрочены", overview.pastDueSubscriptions, Theme.negative),
        ]
        return OwnerSection("Подписки") {
            Text("всего \(total)")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textDim)
        } content: {
            VStack(spacing: Spacing.sm) {
                ForEach(rows, id: \.0) { label, count, tint in
                    AmountRow(
                        leading: { TintedIcon(systemName: "creditcard.fill", tint: tint, size: 38, corner: 11) },
                        title: label,
                        subtitle: "\(Int((Double(count) / Double(total) * 100).rounded())) % подписок",
                        amount: "\(count)",
                        share: Double(count) / Double(total),
                        tint: tint
                    )
                }
            }
        }
    }
}

// ── Строка организации в списке ────────────────────────────────────────────

/// Организация строкой — как точка на главной владельца: буква, название,
/// под ним масштаб, справа статус.
struct OrganizationRow: View {
    let organization: Organization

    var body: some View {
        HStack(spacing: Spacing.md) {
            LetterBadge(text: organization.name, tint: tint)
            VStack(alignment: .leading, spacing: 3) {
                Text(organization.name)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text(details)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }
            Spacer(minLength: Spacing.sm)
            VStack(alignment: .trailing, spacing: 4) {
                StatusPill(text: statusText, color: statusColor)
                if organization.overdueInvoiceCount > 0 {
                    Text("счёт просрочен")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Theme.negative)
                }
            }
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.textDim)
        }
        .padding(.vertical, Spacing.sm)
        .contentShape(Rectangle())
    }

    private var details: String {
        // Код пакета («shop_finance_pro») в строке не нужен: он обрезался
        // многоточием и ничего не говорил. Он есть в карточке организации.
        "\(organization.companyCount) \(pluralize(organization.companyCount, "точка", "точки", "точек")) · \(organization.memberCount) \(pluralize(organization.memberCount, "сотрудник", "сотрудника", "сотрудников"))"
    }

    /// Состояние одной подписью: заморозка важнее подписки, подписка —
    /// важнее «активна».
    private var statusText: String {
        if organization.isSuspended { return organization.statusLabel }
        if let subscription = organization.subscription { return subscription.statusLabel }
        return organization.statusLabel
    }

    private var statusColor: Color {
        if organization.isSuspended { return Theme.negative }
        switch organization.subscription?.status {
        case "active": return Theme.positive
        case "trialing": return Theme.info
        case "past_due": return Theme.negative
        case nil: return organization.isActive ? Theme.positive : Theme.textDim
        default: return Theme.textDim
        }
    }

    private var tint: Color {
        if organization.isSuspended || organization.overdueInvoiceCount > 0 { return Theme.negative }
        if organization.subscription?.status == "trialing" { return Theme.info }
        return Theme.brand
    }

    /// Нужен ли организации взгляд суперадмина.
    static func needsAttention(_ organization: Organization) -> Bool {
        organization.isSuspended
            || organization.overdueInvoiceCount > 0
            || organization.subscription?.status == "past_due"
    }
}

/// Статус маленькой цветной капсулой.
struct StatusPill: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(color)
            .lineLimit(1)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color.opacity(0.12), in: Capsule())
    }
}

// ── Карточка организации ─────────────────────────────────────────────────────

/// Управление одной организацией: параметры, подписка, точки, рубильник прав.
struct OrganizationDetailScreen: View {
    let organization: Organization

    @Environment(PlatformStore.self) private var store
    @Environment(AuthStore.self) private var auth

    @State private var error: String?
    @State private var confirmingSuspend = false

    /// Актуальная версия из хранилища — после переключателей данные
    /// перезагружаются, и показывать надо свежее.
    private var current: Organization {
        store.organizations.first { $0.id == organization.id } ?? organization
    }

    /// Работать в этой организации как владелец — то, ради чего суперадмин
    /// чаще всего её и открывает.
    ///
    /// Раньше здесь открывался портал во встроенном браузере. Теперь
    /// переключаем активную организацию, и все нативные экраны начинают
    /// показывать её данные.
    private var switchOrganizationButton: some View {
        Button {
            Task { await auth.setOrganization(current.id) }
        } label: {
            actionRow(
                icon: isCurrentOrganization ? "checkmark.circle.fill" : "arrow.left.arrow.right",
                tint: isCurrentOrganization ? Theme.positive : .white,
                title: isCurrentOrganization ? "Вы работаете в этой организации" : "Работать как владелец",
                subtitle: isCurrentOrganization
                    ? "разделы показывают её данные"
                    : "переключить приложение на \(current.name)",
                prominent: !isCurrentOrganization
            )
        }
        .buttonStyle(.pressable)
        .disabled(isCurrentOrganization)
    }

    private var capabilitiesButton: some View {
        NavigationLink(value: OrgCapabilitiesRoute(organization: current)) {
            actionRow(
                icon: "lock.shield.fill",
                tint: Theme.brand,
                title: "Рубильник прав",
                subtitle: disabledCount > 0
                    ? "\(disabledCount) \(pluralize(disabledCount, "действие выключено", "действия выключено", "действий выключено"))"
                    : "выключить действия для всей организации",
                prominent: false
            )
        }
        .buttonStyle(.pressable)
    }

    private var disabledCount: Int {
        store.disabledCapabilities[current.id]?.count ?? 0
    }

    /// Кнопка-строка: главное действие — на кобальте, остальные — белые.
    private func actionRow(icon: String, tint: Color, title: String, subtitle: String, prominent: Bool) -> some View {
        HStack(spacing: Spacing.md) {
            Image(systemName: icon)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(prominent ? .white : tint)
                .frame(width: 42, height: 42)
                .background(prominent ? Color.white.opacity(0.18) : tint.opacity(0.14), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(prominent ? .white : Theme.text)
                Text(subtitle)
                    .font(.system(size: 13))
                    .foregroundStyle(prominent ? .white.opacity(0.8) : Theme.textDim)
                    .lineLimit(1)
            }
            Spacer(minLength: Spacing.sm)
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(prominent ? .white.opacity(0.8) : Theme.textDim)
        }
        .padding(Spacing.lg)
        .background {
            if prominent {
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .fill(LinearGradient(colors: Theme.heroAccent, startPoint: .topLeading, endPoint: .bottomTrailing))
            } else {
                RoundedRectangle(cornerRadius: 24, style: .continuous).fill(Theme.surface)
            }
        }
    }

    /// Работает ли приложение сейчас в контексте этой организации.
    private var isCurrentOrganization: Bool {
        auth.organizationID == current.id
    }

    var body: some View {
        ScrollView {
            // На широком экране две колонки: слева состояние клиента, справа
            // действия над ним. Одна колонка в 720 точек посреди
            // двухтысячепиксельного окна оставляла бы пустыми обе трети.
            SplitDashboard(mainRatio: 0.55) {
                headerCard
                switchOrganizationButton
                subscriptionCard
                companiesCard
            } side: {
                capabilitiesButton
                controlsCard
                dangerCard
            }

            if let error {
                Text(error)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.negative)
                    .padding(.horizontal, Spacing.lg)
            }
        }
        .contentMargins(Spacing.lg, for: .scrollContent)
        .background(Theme.background)
        .navigationTitle(current.name)
        .navigationDestination(for: OrgCapabilitiesRoute.self) { route in
            OrgCapabilitiesScreen(organization: route.organization)
        }
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task { await store.loadCapabilities(organizationID: current.id) }
    }

    private var headerCard: some View {
        HeroSummary(
            title: current.slug,
            value: "\(current.companyCount) \(pluralize(current.companyCount, "точка", "точки", "точек"))",
            caption: "из \(current.companyLimit) по тарифу",
            footer: [
                ("Сотрудников", "\(current.memberCount)"),
                ("Тариф", current.subscription?.planName ?? "—"),
                ("Статус", current.statusLabel),
            ],
            colors: current.isSuspended ? Theme.heroNegative : Theme.heroGradient
        )
        .overlay(alignment: .topTrailing) {
            OrdaControlMark(ringColor: .white.opacity(0.10))
                .frame(width: 100, height: 100)
                .offset(x: 26, y: -20)
                .allowsHitTesting(false)
        }
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
    }

    @ViewBuilder
    private var subscriptionCard: some View {
        if let subscription = current.subscription {
            OwnerSection("Подписка") {
                VStack(spacing: Spacing.md) {

                    StatRow("Тариф", value: subscription.planName ?? "—")
                    StatRow("Статус", value: subscription.statusLabel)
                    StatRow("Период", value: subscription.billingPeriod == "yearly" ? "год" : "месяц")
                    if let ends = subscription.endsAt {
                        StatRow("Действует до", value: endsLabel(ends))
                    }
                    if let package = current.packageCode {
                        RowDivider()
                        StatRow("Пакет", value: package, icon: "shippingbox")
                    }
                    if !current.addonCodes.isEmpty {
                        StatRow("Аддонов", value: "\(current.addonCodes.count)", icon: "plus.square.on.square")
                    }
                    if let url = current.appURL, let link = URL(string: url) {
                        RowDivider()
                        Link(destination: link) {
                            Label(url.replacingOccurrences(of: "https://", with: ""), systemImage: "arrow.up.right.square")
                                .font(.system(size: 14, weight: .medium))
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
            }
        }
    }

    /// Дата окончания приходит строкой ISO — показывать её как есть нельзя.
    private func endsLabel(_ raw: String) -> String {
        guard let date = DateParsing.parseDateOnly(String(raw.prefix(10))) else { return raw }
        return date.formatted(.dateTime.day().month(.wide).year())
    }

    private var controlsCard: some View {
        OwnerSection("Настройки") {
            VStack(spacing: Spacing.md) {

                Toggle(isOn: Binding(
                    get: { current.featuresEnforced },
                    set: { value in
                        Task { error = await store.setFeaturesEnforced(current, enforced: value) }
                    }
                )) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Жёсткая блокировка страниц")
                            .font(Typography.callout)
                            .foregroundStyle(Theme.text)
                        Text("страницы вне пакета закрыты даже владельцу")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                    }
                }
                .tint(Theme.brand)

                RowDivider()

                Toggle(isOn: Binding(
                    get: { current.billingExempt },
                    set: { value in
                        Task { error = await store.setBillingExempt(current, exempt: value) }
                    }
                )) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Без биллинга")
                            .font(Typography.callout)
                            .foregroundStyle(Theme.text)
                        Text("счета не выставляются")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                    }
                }
                .tint(Theme.brand)
            }
        }
    }

    @ViewBuilder
    private var companiesCard: some View {
        if !current.companies.isEmpty {
            OwnerSection("Точки") {
                Text("\(current.companies.count)")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
            } content: {
                VStack(spacing: 0) {
                    ForEach(Array(current.companies.enumerated()), id: \.element.id) { index, company in
                        if index > 0 {
                            Rectangle().fill(Theme.borderSoft).frame(height: 1).padding(.leading, 52)
                        }
                        HStack(spacing: Spacing.md) {
                            LetterBadge(text: company.name, tint: OwnerTint.point(index))
                            Text(company.name)
                                .font(.system(size: 16, weight: .medium))
                                .foregroundStyle(Theme.text)
                                .lineLimit(1)
                            Spacer(minLength: Spacing.sm)
                            if let code = company.code {
                                Text(code)
                                    .font(.system(size: 13, design: .monospaced))
                                    .foregroundStyle(Theme.textDim)
                            }
                        }
                        .padding(.vertical, Spacing.sm)
                    }
                }
            }
        }
    }

    /// Заморозка отключает вход всем сотрудникам организации — необратимое по
    /// последствиям действие, поэтому отдельным блоком и с подтверждением.
    private var dangerCard: some View {
        OwnerSection("Опасная зона") {
            VStack(alignment: .leading, spacing: Spacing.md) {

                Text(current.isSuspended
                     ? "Организация заморожена: сотрудники не могут войти."
                     : "Заморозка мгновенно отключит вход всем сотрудникам организации.")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textMuted)

                Button(current.isSuspended ? "Разморозить" : "Заморозить организацию") {
                    if current.isSuspended {
                        Task { error = await store.setSuspended(current, suspended: false) }
                    } else {
                        confirmingSuspend = true
                    }
                }
                .buttonStyle(current.isSuspended ? AnyButtonStyle(SecondaryButtonStyle()) : AnyButtonStyle(DestructiveButtonStyle()))
            }
        }
        .confirmationDialog(
            "Заморозить «\(current.name)»?",
            isPresented: $confirmingSuspend,
            titleVisibility: .visible
        ) {
            Button("Заморозить", role: .destructive) {
                Task { error = await store.setSuspended(current, suspended: true) }
            }
            Button("Отмена", role: .cancel) {}
        } message: {
            Text("\(current.memberCount) \(pluralize(current.memberCount, "сотрудник потеряет", "сотрудника потеряют", "сотрудников потеряют")) доступ немедленно.")
        }
    }
}

/// Стирание типа стиля кнопки — чтобы выбирать стиль по условию.
struct AnyButtonStyle: ButtonStyle {
    private let makeBodyClosure: (Configuration) -> AnyView

    init<S: ButtonStyle>(_ style: S) {
        makeBodyClosure = { configuration in
            AnyView(style.makeBody(configuration: configuration))
        }
    }

    func makeBody(configuration: Configuration) -> some View {
        makeBodyClosure(configuration)
    }
}

/// Адрес экрана прав организации.
struct OrgCapabilitiesRoute: Hashable {
    let organization: Organization
}
