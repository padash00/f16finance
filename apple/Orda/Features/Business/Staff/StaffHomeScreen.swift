import OrdaKit
import OrdaUI
import SwiftUI

/// Главная сотрудника — своя у каждой должности.
///
/// Раньше всем, кому не открыты отчёты, доставалась одна и та же сводка и
/// список «Разделы» на восемьдесят строк: бухгалтер и маркетолог видели одно и
/// то же и искали свою работу по каталогу. Теперь сверху карточка должности,
/// под ней — кнопки того, что эта должность делает каждый день, потом что
/// ждёт решения, свои задачи и зарплата, и сервисы в порядке важности для неё.
///
/// Порядок и подача — из `StaffRolePlaybook`, а что показать — только из
/// выданного на `/access`.
struct StaffHomeScreen: View {
    let resolver: AccessResolver
    var navigate: (OwnerDestination) -> Void = { _ in }

    @Environment(BusinessStore.self) private var business
    @Environment(AuthStore.self) private var auth

    @State private var sheet: OwnerHomeScreen.QuickSheet?

    private var playbook: StaffRolePlaybook { resolver.playbook }

    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.lg) {
                header
                hero
                quickActions
                attention
                MyTasksCard()
                MySalaryCard()
                services
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.bottom, Spacing.xxl)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.background)
        .refreshable { await business.bootstrap() }
        #if os(iOS)
        .toolbar(.hidden, for: .navigationBar)
        #endif
        .sheet(item: $sheet) { kind in
            switch kind {
            case .expense: AddExpenseSheet()
            case .income: AddIncomeSheet()
            case .task: AddTaskSheet()
            }
        }
        // Сводка обновляется сама, пока открыта: продажи идут на точке.
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                if Task.isCancelled { break }
                await business.loadDashboard()
            }
        }
    }

    // ── Шапка ────────────────────────────────────────────────────────────────

    private var header: some View {
        HStack(spacing: Spacing.md) {
            Text(initials)
                .font(.system(size: 16, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .frame(width: 44, height: 44)
                .background(
                    LinearGradient(colors: Theme.heroAccent, startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: Circle()
                )
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 1) {
                Text(greeting)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
                Text(firstName ?? playbook.title)
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
            }
            .accessibilityElement(children: .combine)

            Spacer(minLength: Spacing.sm)

            Text(roleTitle)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.brand)
                .lineLimit(1)
                .padding(.horizontal, 12)
                .frame(height: 32)
                .background(Theme.brand.opacity(0.12), in: Capsule())
        }
        .padding(.top, Spacing.md)
    }

    /// Название должности: с сервера, если он его прислал, иначе из набора.
    private var roleTitle: String {
        let label = auth.role?.roleLabel ?? ""
        return label.isEmpty ? playbook.title : label
    }

    private var fullName: String? {
        resolver.session.displayName ?? auth.role?.displayName
    }

    private var firstName: String? {
        fullName?
            .split(separator: " ").first.map(String.init)
            .flatMap { $0.contains("@") ? nil : $0 }
    }

    private var initials: String {
        let words = (fullName ?? "")
            .split(separator: " ")
            .filter { !$0.contains("@") }
            .prefix(2)
        let letters = words.compactMap(\.first).map(String.init).joined()
        return letters.isEmpty ? String(playbook.title.prefix(1)).uppercased() : letters.uppercased()
    }

    private var greeting: String {
        switch Calendar.current.component(.hour, from: Date()) {
        case 5..<12: "Доброе утро"
        case 12..<18: "Добрый день"
        case 18..<23: "Добрый вечер"
        default: "Доброй ночи"
        }
    }

    // ── Карточка должности ───────────────────────────────────────────────────

    /// Денежные показатели — по праву на доходы, как в прежней сводке:
    /// главная не должна быть обходным путём мимо `/access`.
    private var canSeeRevenue: Bool {
        resolver.can("income.view") || resolver.can("reports.view")
    }

    private var hero: some View {
        let dashboard = canSeeRevenue ? business.dashboard : nil
        return VStack(alignment: .leading, spacing: 0) {
            Text(playbook.focus)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(.white.opacity(0.85))

            if let dashboard {
                Text("Выручка сегодня")
                    .font(.system(size: 13))
                    .foregroundStyle(.white.opacity(0.65))
                    .padding(.top, Spacing.md)
                Text(Money.format(dashboard.today.total))
                    .font(.system(size: 38, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(.white)
                    .contentTransition(.numericText())
                    .animation(Motion.value, value: dashboard.today.total)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
            } else {
                Text(greetingLine)
                    .font(.system(size: 26, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)
                    .padding(.top, Spacing.sm)
            }

            HStack(spacing: Spacing.xl) {
                ForEach(heroStats, id: \.0) { label, value in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(label)
                            .font(.system(size: 13))
                            .foregroundStyle(.white.opacity(0.65))
                        Text(value)
                            .font(.system(size: 17, weight: .semibold, design: .rounded))
                            .monospacedDigit()
                            .foregroundStyle(.white)
                    }
                }
            }
            .padding(.top, Spacing.lg)
        }
        .padding(Spacing.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(colors: Theme.heroGradient, startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: Radius.xl, style: .continuous)
        )
        .overlay(alignment: .topTrailing) {
            // Знак бренда водяным знаком — как на карте в банковском приложении.
            OrdaControlMark(ringColor: .white.opacity(0.10))
                .frame(width: 120, height: 120)
                .offset(x: 30, y: -24)
                .allowsHitTesting(false)
        }
        .clipShape(RoundedRectangle(cornerRadius: Radius.xl, style: .continuous))
    }

    private var greetingLine: String {
        firstName.map { "\(greeting), \($0)" } ?? greeting
    }

    /// Две-три цифры внизу карточки — только из того, что выдано.
    private var heroStats: [(String, String)] {
        var stats: [(String, String)] = []
        if canSeeRevenue, let dashboard = business.dashboard {
            stats.append(("Чеков", "\(dashboard.today.count)"))
            stats.append(("За месяц", Money.format(dashboard.monthTotal)))
        }
        if resolver.can("expenses-pending.view") {
            stats.append(("На решении", "\(business.pending.count)"))
        }
        if stats.count < 2 {
            stats.insert(("Сегодня", Date().formatted(.dateTime.weekday(.wide).day().month(.wide))), at: 0)
        }
        return Array(stats.prefix(3))
    }

    // ── Быстрые кнопки ───────────────────────────────────────────────────────

    private struct QuickItem: Identifiable {
        let id: String
        let icon: String
        let title: String
        let run: () -> Void
    }

    private var quickItems: [QuickItem] {
        let reachable = resolver.reachablePageIDs
        var items: [QuickItem] = []
        for action in playbook.actions {
            switch action {
            case .addExpense where resolver.can("expenses.create"):
                items.append(QuickItem(id: "expense", icon: "minus", title: "Расход") { sheet = .expense })
            case .addIncome where resolver.can("income.create"):
                items.append(QuickItem(id: "income", icon: "plus", title: "Доход") { sheet = .income })
            case .addTask where resolver.can("tasks.create"):
                items.append(QuickItem(id: "task", icon: "checklist", title: "Задача") { sheet = .task })
            case let .page(id) where reachable.contains(id):
                items.append(QuickItem(
                    id: id,
                    icon: BusinessRootView.icon(forPage: id),
                    title: Self.shortTitle(id)
                ) { navigate(.page(id)) })
            default:
                break
            }
        }
        // Всегда последней — все сервисы: у кнопок выше порядок должности,
        // а здесь всё остальное, что выдано.
        items = Array(items.prefix(4))
        items.append(QuickItem(id: "services", icon: "square.grid.2x2.fill", title: "Сервисы") { navigate(.services) })
        return items
    }

    private var quickActions: some View {
        HStack(alignment: .top, spacing: Spacing.sm) {
            ForEach(quickItems) { item in
                RoundAction(icon: item.icon, title: item.title, tint: Theme.brand, action: item.run)
            }
        }
    }

    /// Подпись под круглой кнопкой — одним словом.
    static func shortTitle(_ pageID: String) -> String {
        switch pageID {
        case "expenses-pending": "Решения"
        case "shifts": "Смены"
        case "shifts-reports": "Отчёты"
        case "store-requests": "Заявки"
        case "store-revisions": "Ревизия"
        case "store-advertising": "Реклама"
        case "customers": "Клиенты"
        case "news": "Новости"
        case "incidents": "Инциденты"
        case "salary": "Зарплата"
        case "pos-receipts": "Чеки"
        case "pos-returns": "Возвраты"
        case "point-debts": "Долги"
        case "knowledge-admin": "База"
        default: OwnerServices.shortTitle(CapabilityCatalog.page(id: pageID)?.label ?? pageID)
        }
    }

    // ── Требует внимания ─────────────────────────────────────────────────────

    @ViewBuilder
    private var attention: some View {
        let pending = resolver.can("expenses-pending.view") ? business.pending : []
        let canStock = resolver.can("store.view") || resolver.can("store-warehouse.view")
        let lowStock = canStock ? (business.dashboard?.lowStock ?? []) : []
        if !pending.isEmpty || !lowStock.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Spacing.md) {
                    if !pending.isEmpty {
                        AttentionCard(
                            icon: "clock.badge.exclamationmark.fill",
                            tint: Theme.warning,
                            title: "\(pending.count) \(OwnerHomeScreen.expensesWord(pending.count)) ждут решения",
                            subtitle: Money.format(pending.reduce(0) { $0 + $1.total })
                        ) { navigate(.page("expenses-pending")) }
                    }
                    if !lowStock.isEmpty {
                        AttentionCard(
                            icon: "shippingbox.fill",
                            tint: Theme.negative,
                            title: "Заканчивается \(lowStock.count) \(OwnerHomeScreen.itemsWord(lowStock.count))",
                            subtitle: lowStock.prefix(2).map(\.name).joined(separator: ", ")
                        ) { navigate(.page("store-warehouse")) }
                    }
                }
            }
            .scrollClipDisabled()
        }
    }

    // ── Сервисы ──────────────────────────────────────────────────────────────

    private var services: some View {
        let favorites = StaffServices.favorites(resolver: resolver)
        return Group {
            if !favorites.isEmpty {
                OwnerSection("Мои сервисы") {
                    Button("Все") { navigate(.services) }
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.brand)
                } content: {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: Spacing.sm), count: 4), spacing: Spacing.lg) {
                        ForEach(favorites) { item in
                            Button {
                                navigate(.page(item.pageID))
                            } label: {
                                ServiceTile(
                                    icon: item.icon,
                                    title: item.title,
                                    tint: item.tint,
                                    badge: item.pageID == "expenses-pending" ? business.pending.count : 0
                                )
                            }
                            .buttonStyle(.pressable)
                        }
                    }
                }
            }
        }
    }
}

/// Сервисы должности в её порядке, добранные остальными выданными.
enum StaffServices {
    static func favorites(resolver: AccessResolver, count: Int = 8) -> [OwnerServiceItem] {
        let every = OwnerServices.all(resolver: resolver).flatMap(\.items)
        let byID = Dictionary(every.map { ($0.pageID, $0) }, uniquingKeysWith: { a, _ in a })
        var result = resolver.playbook.favoritePageIDs.compactMap { byID[$0] }
        if result.count < count {
            result += every.filter { !result.contains($0) }.prefix(count - result.count)
        }
        return Array(result.prefix(count))
    }
}
