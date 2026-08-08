import OrdaKit
import OrdaUI
import SwiftUI

// ── Обзор платформы ──────────────────────────────────────────────────────────

/// Дашборд суперадмина.
///
/// Другая оптика, чем у владельца: здесь показатель не «выручка точки», а
/// здоровье платформы — сколько организаций платят, сколько на триале,
/// сколько просрочили. И сразу под этим — кто требует вмешательства.
struct PlatformOverviewScreen: View {
    @Environment(PlatformStore.self) private var store

    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.lg) {
                if let error = store.error {
                    ErrorStateView(error: error) { Task { await store.load() } }
                } else if store.isLoading && store.data == nil {
                    Skeleton(height: 170, cornerRadius: Radius.lg)
                    Skeleton(height: 200, cornerRadius: Radius.lg)
                } else {
                    mrrCard
                    subscriptionChart
                    scaleTiles
                    if !store.attention.isEmpty { attentionCard }
                    billingCard
                }
            }
            .padding(Spacing.lg)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.background)
        .navigationTitle("Платформа")
        .toolbar { LogoutToolbarItem() }
        .task { if store.data == nil { await store.load() } }
        .refreshable { await store.load() }
    }

    private var mrrCard: some View {
        Card(accent: Theme.accent(for: .platform)) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                Text("Регулярная выручка")
                    .font(Typography.label)
                    .foregroundStyle(Theme.textDim)
                    .textCase(.uppercase)

                Text(Money.format(store.overview.liveMrr))
                    .font(Typography.monospacedDigits(Typography.hero))
                    .foregroundStyle(Theme.text)
                    .contentTransition(.numericText())
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)

                // Триальная выручка отдельной строкой: это ещё не деньги, и
                // складывать её с живой было бы самообманом.
                if store.overview.trialMrr > 0 {
                    Text("на триале ещё \(Money.compact(store.overview.trialMrr))")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                }

                RowDivider()
                StatRow("Оплачено в этом месяце", value: Money.format(store.overview.paidThisMonth), valueColor: Theme.positive, icon: "checkmark.circle")
            }
        }
    }

    private var subscriptionChart: some View {
        let total = max(store.subscriptionBreakdown.reduce(0) { $0 + $1.count }, 1)
        return Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                Text("Подписки")
                    .font(Typography.label)
                    .foregroundStyle(Theme.textDim)
                    .textCase(.uppercase)

                SplitBar(segments: [
                    .init(label: "Активные", value: Double(store.overview.activeSubscriptions), color: ChartPalette.series1),
                    .init(label: "Триал", value: Double(store.overview.trialingSubscriptions), color: ChartPalette.series2),
                    .init(label: "Просрочены", value: Double(store.overview.pastDueSubscriptions), color: ChartPalette.series3),
                ])

                Text("всего \(total) \(pluralize(total, "подписка", "подписки", "подписок"))")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
            }
        }
    }

    private var scaleTiles: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: Spacing.md) {
            MetricTile(
                label: "Организаций",
                value: "\(store.overview.organizationCount)",
                icon: "building.2",
                accent: Theme.accent(for: .platform)
            )
            MetricTile(
                label: "Активных",
                value: "\(store.overview.activeOrganizationCount)",
                icon: "checkmark.seal",
                accent: Theme.positive
            )
            MetricTile(
                label: "Точек",
                value: "\(store.overview.totalCompanies)",
                icon: "storefront",
                accent: ChartPalette.series2
            )
            MetricTile(
                label: "Сотрудников",
                value: "\(store.overview.totalMembers)",
                icon: "person.2",
                accent: ChartPalette.series3
            )
        }
    }

    private var attentionCard: some View {
        Card(accent: Theme.warning) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                HStack {
                    Text("Требуют внимания")
                        .font(Typography.label)
                        .foregroundStyle(Theme.warning)
                        .textCase(.uppercase)
                    Spacer()
                    Text("\(store.attention.count)")
                        .font(Typography.caption.weight(.bold))
                        .monospacedDigit()
                        .foregroundStyle(Theme.warning)
                }

                ForEach(store.attention.prefix(8)) { org in
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        Text(org.name)
                            .font(Typography.callout.weight(.medium))
                            .foregroundStyle(Theme.text)
                        HStack(spacing: Spacing.xs) {
                            ForEach(org.reasons, id: \.self) { reason in
                                StatusChip(reason, kind: .warning)
                            }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var billingCard: some View {
        if store.overview.overdueInvoices > 0 || store.overview.trialsEndingSoon > 0 {
            Card {
                VStack(spacing: Spacing.md) {
                    Text("Биллинг")
                        .font(Typography.label)
                        .foregroundStyle(Theme.textDim)
                        .textCase(.uppercase)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    if store.overview.overdueInvoices > 0 {
                        StatRow(
                            "Просроченных счетов",
                            value: "\(store.overview.overdueInvoices) · \(Money.compact(store.overview.overdueInvoicesSum))",
                            valueColor: Theme.negative,
                            icon: "exclamationmark.circle"
                        )
                    }
                    if store.overview.trialsEndingSoon > 0 {
                        StatRow(
                            "Триалов истекает за неделю",
                            value: "\(store.overview.trialsEndingSoon)",
                            valueColor: Theme.warning,
                            icon: "hourglass"
                        )
                    }
                }
            }
        }
    }
}

// ── Карточка организации в списке ──────────────────────────────────────────

struct OrganizationCard: View {
    let organization: Organization

    var body: some View {
        Card(accent: accent) {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(organization.name)
                            .font(Typography.body.weight(.medium))
                            .foregroundStyle(Theme.text)
                        Text(organization.slug)
                            .font(Typography.caption)
                            .monospaced()
                            .foregroundStyle(Theme.textDim)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.textDim)
                }

                HStack(spacing: Spacing.sm) {
                    StatusChip(organization.statusLabel, kind: statusKind)

                    if let subscription = organization.subscription {
                        StatusChip(subscription.statusLabel, kind: subscriptionKind(subscription.status))
                    }

                    if organization.overdueInvoiceCount > 0 {
                        StatusChip("счёт просрочен", kind: .danger)
                    }

                    Spacer(minLength: 0)
                }

                HStack(spacing: Spacing.lg) {
                    Label("\(organization.companyCount)", systemImage: "storefront")
                    Label("\(organization.memberCount)", systemImage: "person.2")
                    if let package = organization.packageCode {
                        Label(package, systemImage: "shippingbox")
                    }
                }
                .font(Typography.caption)
                .foregroundStyle(Theme.textDim)
            }
        }
    }

    private var accent: Color? {
        if organization.isSuspended || organization.overdueInvoiceCount > 0 { return Theme.negative }
        if organization.subscription?.status == "trialing" { return ChartPalette.series2 }
        return nil
    }

    private var statusKind: StatusChip.Kind {
        if organization.isActive { return .good }
        if organization.isSuspended { return .danger }
        return .neutral
    }

    private func subscriptionKind(_ status: String) -> StatusChip.Kind {
        switch status {
        case "active": .good
        case "trialing": .info
        case "past_due": .danger
        default: .neutral
        }
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

    /// Работает ли приложение сейчас в контексте этой организации.
    private var isCurrentOrganization: Bool {
        auth.organizationID == current.id
    }

    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.lg) {
                headerCard
                subscriptionCard
                controlsCard
                companiesCard

                // Работать в этой организации как владелец — то, ради чего
                // суперадмин чаще всего её и открывает.
                //
                // Раньше здесь открывался портал во встроенном браузере.
                // Теперь переключаем активную организацию, и все нативные
                // экраны начинают показывать её данные.
                Button {
                    Task { await auth.setOrganization(current.id) }
                } label: {
                    Card(accent: Theme.accent(for: .platform)) {
                        NavigationRow(
                            icon: "arrow.left.arrow.right.square",
                            iconColor: Theme.accent(for: .platform),
                            title: isCurrentOrganization ? "Вы работаете в этой организации" : "Работать как владелец",
                            subtitle: isCurrentOrganization
                                ? "разделы ниже показывают её данные"
                                : "переключить приложение на \(current.name)"
                        )
                    }
                }
                .buttonStyle(.plain)
                .disabled(isCurrentOrganization)

                NavigationLink { OrgCapabilitiesScreen(organization: current) } label: {
                    Card {
                        NavigationRow(
                            icon: "lock.shield",
                            iconColor: Theme.accent(for: .platform),
                            title: "Рубильник прав",
                            subtitle: "выключить действия для всей организации",
                            badge: store.disabledCapabilities[current.id]?.count,
                            badgeColor: Theme.warning
                        )
                    }
                }
                .buttonStyle(.plain)

                dangerCard

                if let error {
                    Text(error).font(Typography.callout).foregroundStyle(Theme.negative)
                }
            }
            .padding(Spacing.lg)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.background)
        .navigationTitle(current.name)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task { await store.loadCapabilities(organizationID: current.id) }
    }

    private var headerCard: some View {
        Card(accent: Theme.accent(for: .platform)) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                HStack {
                    StatusChip(current.statusLabel, kind: current.isActive ? .good : .danger)
                    Spacer()
                    Text(current.slug)
                        .font(Typography.caption)
                        .monospaced()
                        .foregroundStyle(Theme.textDim)
                }

                HStack(spacing: Spacing.xl) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(current.companyCount)")
                            .font(Typography.monospacedDigits(Typography.metric))
                            .foregroundStyle(Theme.text)
                        Text("точек из \(current.companyLimit)")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(current.memberCount)")
                            .font(Typography.monospacedDigits(Typography.metric))
                            .foregroundStyle(Theme.text)
                        Text("сотрудников")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                    }
                    Spacer()
                }

                if let url = current.appURL, let link = URL(string: url) {
                    Link(destination: link) {
                        Label(url.replacingOccurrences(of: "https://", with: ""), systemImage: "arrow.up.right.square")
                            .font(Typography.caption)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var subscriptionCard: some View {
        if let subscription = current.subscription {
            Card {
                VStack(spacing: Spacing.md) {
                    Text("Подписка")
                        .font(Typography.label)
                        .foregroundStyle(Theme.textDim)
                        .textCase(.uppercase)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    StatRow("Тариф", value: subscription.planName ?? "—")
                    StatRow("Статус", value: subscription.statusLabel)
                    StatRow("Период", value: subscription.billingPeriod == "yearly" ? "год" : "месяц")
                    if let ends = subscription.endsAt {
                        StatRow("Действует до", value: String(ends.prefix(10)))
                    }
                    if let package = current.packageCode {
                        RowDivider()
                        StatRow("Пакет", value: package, icon: "shippingbox")
                    }
                    if !current.addonCodes.isEmpty {
                        StatRow("Аддонов", value: "\(current.addonCodes.count)", icon: "plus.square.on.square")
                    }
                }
            }
        }
    }

    private var controlsCard: some View {
        Card {
            VStack(spacing: Spacing.md) {
                Text("Настройки")
                    .font(Typography.label)
                    .foregroundStyle(Theme.textDim)
                    .textCase(.uppercase)
                    .frame(maxWidth: .infinity, alignment: .leading)

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
                .tint(Theme.accent(for: .platform))

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
                .tint(Theme.accent(for: .platform))
            }
        }
    }

    @ViewBuilder
    private var companiesCard: some View {
        if !current.companies.isEmpty {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    Text("Точки")
                        .font(Typography.label)
                        .foregroundStyle(Theme.textDim)
                        .textCase(.uppercase)

                    ForEach(current.companies) { company in
                        StatRow(company.name, value: company.code ?? "—", icon: "storefront")
                    }
                }
            }
        }
    }

    /// Заморозка отключает вход всем сотрудникам организации — необратимое по
    /// последствиям действие, поэтому отдельным блоком и с подтверждением.
    private var dangerCard: some View {
        Card(accent: Theme.negative) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                Text("Опасная зона")
                    .font(Typography.label)
                    .foregroundStyle(Theme.negative)
                    .textCase(.uppercase)

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
