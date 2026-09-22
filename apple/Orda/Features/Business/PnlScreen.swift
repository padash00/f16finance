import OrdaKit
import OrdaUI
import SwiftUI

/// Загрузка ОПиУ за месяц вместе с прошлым месяцем.
@MainActor
@Observable
final class PnlStore {
    private(set) var report: PnlReport?
    private(set) var error: APIError?
    private(set) var isLoading = false

    /// Месяц отчёта `YYYY-MM`. По умолчанию прошлый — полный: в идущем
    /// месяце прибыль всегда «хуже», чем будет.
    var month: String = PnlStore.shift(PnlPeriod.monthString(Date()), by: -1) {
        didSet { if oldValue != month { reload() } }
    }

    private let service: BusinessService
    private var generation = 0

    init(api: APIClient) { service = BusinessService(api: api) }

    func reload() { Task { await load() } }

    func load() async {
        generation += 1
        let mine = generation
        isLoading = true
        defer { if mine == generation { isLoading = false } }
        do {
            let result = try await service.pnl(
                from: month,
                to: month,
                includeExtra: ExtraCashPreference.shared.includeExtra,
                withPrevious: true
            )
            guard mine == generation else { return }
            report = result
            error = nil
        } catch let apiError as APIError {
            if mine == generation { error = apiError }
        } catch {
            if mine == generation { self.error = .transport(message: error.localizedDescription) }
        }
    }

    static func shift(_ month: String, by offset: Int) -> String {
        let parts = month.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 2 else { return month }
        let total = parts[0] * 12 + (parts[1] - 1) + offset
        return String(format: "%04d-%02d", total / 12, total % 12 + 1)
    }

    static func title(_ month: String) -> String {
        let names = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"]
        let parts = month.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 2, (1...12).contains(parts[1]) else { return month }
        return "\(names[parts[1] - 1]) \(parts[0])"
    }
}

/// ОПиУ — как на сайте (`app/(main)/profitability`): месяц против прошлого,
/// строки отчёта раскрываются до статей, под отчётом — сверка с «Доходами» и
/// «Расходами» и разбивка по точкам.
///
/// Считает сервер (`lib/domain/profitability-report`) — только из журналов
/// доходов и расходов, те же цифры, что на сайте и в PDF.
struct PnlScreen: View {
    @Environment(\.api) private var api
    @State private var store: PnlStore?
    /// Точка отчёта; пусто — все точки.
    @State private var companyID: String?
    @State private var expanded: Set<PnlLine> = []

    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.lg) {
                if let store {
                    monthBar(store)
                    filters(store)
                    if let report = store.report {
                        content(report, store: store)
                    } else if let error = store.error {
                        ErrorStateView(error: error) { store.reload() }
                    } else {
                        loading
                    }
                } else {
                    loading
                }
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.bottom, Spacing.xxl)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.background)
        .navigationTitle("ОПиУ")
        .toolbar { LogoutToolbarItem() }
        .task {
            if store == nil {
                let created = PnlStore(api: api)
                store = created
                await created.load()
            }
        }
        .refreshable { await store?.load() }
        .onChange(of: ExtraCashPreference.shared.includeExtra) { _, _ in store?.reload() }
    }

    private var loading: some View {
        VStack(spacing: Spacing.lg) {
            Skeleton(height: 190, cornerRadius: 28)
            Skeleton(height: 420, cornerRadius: 22)
        }
    }

    // ── Месяц и фильтры ──────────────────────────────────────────────────────

    private func monthBar(_ store: PnlStore) -> some View {
        let current = PnlPeriod.monthString(Date())
        return HStack(spacing: Spacing.md) {
            stepButton("chevron.left", enabled: true) { store.month = PnlStore.shift(store.month, by: -1) }
            Spacer()
            Menu {
                ForEach(0..<36, id: \.self) { offset in
                    let month = PnlStore.shift(current, by: -offset)
                    Button(PnlStore.title(month)) { store.month = month }
                }
            } label: {
                VStack(spacing: 1) {
                    HStack(spacing: 4) {
                        Text(PnlStore.title(store.month))
                            .font(.system(size: 17, weight: .bold, design: .rounded))
                        Image(systemName: "chevron.down").font(.system(size: 10, weight: .bold))
                    }
                    .foregroundStyle(Theme.text)
                    if store.month == current {
                        Text("месяц идёт")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.warning)
                    }
                }
            }
            Spacer()
            stepButton("chevron.right", enabled: store.month < current) { store.month = PnlStore.shift(store.month, by: 1) }
        }
    }

    private func stepButton(_ icon: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(enabled ? Theme.text : Theme.textDim.opacity(0.5))
                .frame(width: 44, height: 44)
                .background(Theme.surface, in: Circle())
        }
        .buttonStyle(.pressable)
        .disabled(!enabled)
    }

    @ViewBuilder
    private func filters(_ store: PnlStore) -> some View {
        let companies = store.report?.companies ?? []
        VStack(alignment: .leading, spacing: Spacing.sm) {
            if companies.count > 1 {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Spacing.sm) {
                        chip("Все точки", isOn: companyID == nil) { companyID = nil }
                        ForEach(companies) { company in
                            chip(company.name, isOn: companyID == company.id) {
                                companyID = companyID == company.id ? nil : company.id
                            }
                        }
                    }
                }
                .scrollClipDisabled()
            }
            // Экстра-касса имеет смысл только для итога по всем точкам.
            if companyID == nil { ExtraCashToggle() }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func chip(_ title: String, isOn: Bool, action: @escaping () -> Void) -> some View {
        Button {
            withAnimation(Motion.tap) { action() }
        } label: {
            Text(title)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(isOn ? .white : Theme.text)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(isOn ? AnyShapeStyle(Theme.brand) : AnyShapeStyle(Theme.surface), in: Capsule())
        }
        .buttonStyle(.pressable)
    }

    // ── Содержимое ───────────────────────────────────────────────────────────

    @ViewBuilder
    private func content(_ report: PnlReport, store: PnlStore) -> some View {
        let company = companyID.flatMap { id in report.companies.first { $0.id == id } }
        let current = company?.months.first ?? (companyID == nil ? report.months.first : nil)
        let previous = companyID == nil ? report.previous : company?.previous
        let incomplete = report.incompleteMonths.filter { companyID == nil || $0.companyID == companyID }

        if !incomplete.isEmpty {
            HStack(alignment: .top, spacing: Spacing.md) {
                TintedIcon(systemName: "exclamationmark.triangle.fill", tint: Theme.warning, size: 36)
                Text("Месяц внесён не полностью: " + incomplete.map { "\($0.company) — \($0.days) дн. из \($0.expectedDays)" }.joined(separator: ", ") + ". Выручка и прибыль вырастут, когда внесут отчёты смен.")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.text)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(Spacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.warning.opacity(0.12), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        }

        if let current {
            hero(current, previous: previous)
            statement(current, previous: previous)
            reconciliation(current, companyName: company?.name, extraNames: report.extraNames)
            if companyID == nil && report.companies.count > 1 {
                companiesCard(report)
            }
        } else {
            EmptyStateView(
                icon: "chart.pie",
                title: "Данных нет",
                message: company.map { "У точки \($0.name) за этот месяц нет ни доходов, ни расходов." } ?? "За этот месяц нет ни доходов, ни расходов."
            )
        }
    }

    // ── Главная цифра ────────────────────────────────────────────────────────

    private func hero(_ current: MonthlyPnl, previous: MonthlyPnl?) -> some View {
        let change = previous.flatMap { Percent.change(current: current.netProfit, previous: $0.netProfit) }
        return HeroSummary(
            title: "Чистая прибыль",
            value: Money.format(current.netProfit),
            caption: [
                "маржа \(Percent.format(current.netMargin))",
                change.map { "\(Percent.format($0, signed: true)) к \(PnlStore.title(previous!.month).lowercased())" },
            ].compactMap { $0 }.joined(separator: " · "),
            footer: [
                ("Выручка", Money.format(current.revenue)),
                ("EBITDA · \(Percent.format(current.ebitdaMargin))", Money.format(current.ebitda)),
                ("Валовая", Money.format(current.grossProfit)),
            ],
            colors: current.netProfit >= 0
                ? Theme.heroGradient
                : Theme.heroNegative
        )
    }

    // ── Отчёт ────────────────────────────────────────────────────────────────

    /// Цепочка как на сайте. Пустые статьи не показываем, итоги — всегда.
    private func statement(_ current: MonthlyPnl, previous: MonthlyPnl?) -> some View {
        let lines = PnlLine.chain.filter { line in
            line.isTotal || line == .revenue
                || current.value(line).rounded() != 0
                || (previous?.value(line).rounded() ?? 0) != 0
        }
        let offLines = PnlLine.offChain.filter { current.value($0).rounded() != 0 || (previous?.value($0).rounded() ?? 0) != 0 }
        return OwnerSection("Отчёт") {
            if let previous {
                Text("к \(PnlStore.title(previous.month).lowercased())")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
            }
        } content: {
            VStack(spacing: 0) {
                ForEach(lines, id: \.self) { line in
                    lineRow(line, current: current, previous: previous)
                }
                if !offLines.isEmpty {
                    Text("После чистой прибыли — в ОПиУ не входят")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Theme.warning)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, Spacing.md)
                        .padding(.bottom, Spacing.xs)
                    ForEach(offLines, id: \.self) { line in
                        lineRow(line, current: current, previous: previous)
                    }
                    totalRow(
                        "Остаётся после покупок и выплат",
                        value: current.leftover,
                        previous: previous?.leftover,
                        revenue: current.revenue,
                        isFinal: false
                    )
                }
                Text("Нажмите на строку, чтобы увидеть статьи")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textDim)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, Spacing.md)
            }
        }
    }

    @ViewBuilder
    private func lineRow(_ line: PnlLine, current: MonthlyPnl, previous: MonthlyPnl?) -> some View {
        if line.isTotal {
            totalRow(line.title, value: current.value(line), previous: previous?.value(line), revenue: current.revenue, isFinal: line == .netProfit)
        } else {
            let parts = mergedParts(line, current: current, previous: previous)
            let isOpen = expanded.contains(line)
            let value = current.value(line)
            let prev = previous?.value(line)
            VStack(spacing: 0) {
                Button {
                    guard !parts.isEmpty else { return }
                    withAnimation(Motion.transition) {
                        if isOpen { expanded.remove(line) } else { expanded.insert(line) }
                    }
                } label: {
                    HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                        Image(systemName: "chevron.right")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(Theme.textDim)
                            .rotationEffect(.degrees(isOpen ? 90 : 0))
                            .opacity(parts.isEmpty ? 0 : 1)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(line.title)
                                .font(.system(size: 15, weight: line == .revenue ? .semibold : .regular))
                                .foregroundStyle(Theme.text)
                            Text(share(value, of: current.revenue))
                                .font(.system(size: 12))
                                .foregroundStyle(Theme.textDim)
                        }
                        Spacer(minLength: Spacing.sm)
                        VStack(alignment: .trailing, spacing: 2) {
                            Text((line.isExpense && value.rounded() != 0 ? "−" : "") + Money.format(value))
                                .font(.system(size: 15, weight: line == .revenue ? .semibold : .medium, design: .rounded))
                                .monospacedDigit()
                                .foregroundStyle(line.isExpense ? Theme.textMuted : Theme.text)
                            if let prev {
                                deltaText(value - prev, expense: line.isExpense)
                            }
                        }
                    }
                    .padding(.vertical, 10)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                if isOpen {
                    VStack(spacing: 6) {
                        ForEach(parts, id: \.name) { part in
                            HStack(alignment: .firstTextBaseline) {
                                Text(part.name)
                                    .font(.system(size: 13))
                                    .foregroundStyle(Theme.textMuted)
                                    .lineLimit(1)
                                Spacer(minLength: Spacing.sm)
                                Text(Money.format(part.cur))
                                    .font(.system(size: 13, weight: .medium))
                                    .monospacedDigit()
                                    .foregroundStyle(Theme.text)
                                if previous != nil {
                                    deltaText(part.cur - part.prev, expense: line.isExpense)
                                        .frame(minWidth: 80, alignment: .trailing)
                                }
                            }
                        }
                    }
                    .padding(Spacing.md)
                    .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .padding(.leading, 18)
                    .padding(.bottom, Spacing.sm)
                    .transition(.opacity.combined(with: .move(edge: .top)))
                }
                Rectangle().fill(Theme.borderSoft).frame(height: 1)
            }
        }
    }

    private func totalRow(_ title: String, value: Double, previous: Double?, revenue: Double, isFinal: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: isFinal ? 17 : 15, weight: .bold))
                    .foregroundStyle(Theme.text)
                Text(share(value, of: revenue))
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textDim)
            }
            Spacer(minLength: Spacing.sm)
            VStack(alignment: .trailing, spacing: 2) {
                Text(Money.format(value))
                    .font(.system(size: isFinal ? 18 : 15, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(isFinal ? (value < 0 ? Theme.negative : Theme.positive) : Theme.text)
                if let previous {
                    deltaText(value - previous, expense: false)
                }
            }
        }
        .padding(.horizontal, Spacing.md)
        .padding(.vertical, 12)
        .background(
            (isFinal ? Theme.positive.opacity(0.10) : Theme.surfaceRaised),
            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
        )
        .padding(.vertical, 6)
    }

    /// Разница к прошлому месяцу суммой: рост расхода — красный, рост
    /// выручки и прибыли — зелёный. Как колонка «Изменение» на сайте.
    private func deltaText(_ delta: Double, expense: Bool) -> some View {
        let rounded = delta.rounded()
        let good = rounded == 0 ? nil : ((rounded > 0) != expense)
        return Text(Money.signed(rounded))
            .font(.system(size: 12, weight: .semibold))
            .monospacedDigit()
            .foregroundStyle(good.map { $0 ? Theme.positive : Theme.negative } ?? Theme.textDim)
    }

    private func share(_ value: Double, of revenue: Double) -> String {
        revenue > 0 ? Percent.format(value / revenue * 100) + " выручки" : "—"
    }

    /// Статьи обоих месяцев одним списком, по сумме этого месяца.
    private func mergedParts(_ line: PnlLine, current: MonthlyPnl, previous: MonthlyPnl?) -> [(name: String, cur: Double, prev: Double)] {
        let cur = Dictionary(current.parts(line).map { ($0.name, $0.amount) }, uniquingKeysWith: +)
        let prev = Dictionary((previous?.parts(line) ?? []).map { ($0.name, $0.amount) }, uniquingKeysWith: +)
        return Set(cur.keys).union(prev.keys)
            .map { (name: $0, cur: cur[$0] ?? 0, prev: prev[$0] ?? 0) }
            .filter { $0.cur.rounded() != 0 || $0.prev.rounded() != 0 }
            .sorted { $0.cur == $1.cur ? $0.prev > $1.prev : $0.cur > $1.cur }
    }

    // ── Сверка ───────────────────────────────────────────────────────────────

    /// Откуда взялись цифры: суммы страниц «Доходы» и «Расходы» за тот же
    /// месяц. Если не сходится — видно, на чём.
    private func reconciliation(_ current: MonthlyPnl, companyName: String?, extraNames: [String]) -> some View {
        let pnlExpenses = current.revenue - current.netProfit
        let filter: String = if let companyName {
            "фильтр точки — \(companyName)"
        } else if !extraNames.isEmpty {
            "все точки, \(extraNames.joined(separator: ", ")) \(ExtraCashPreference.shared.includeExtra ? "включён" : "не включён") в итоги"
        } else {
            "все точки"
        }
        return OwnerSection("Сверка") {
            Text("с «Доходами» и «Расходами»")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textDim)
        } content: {
            VStack(spacing: 0) {
                reconRow("Итого в «Доходах»", Money.format(current.revenue))
                reconRow("= Выручка в отчёте", Money.format(current.revenue), bold: true)
                Rectangle().fill(Theme.border).frame(height: 1).padding(.vertical, Spacing.sm)
                reconRow("Итого в «Расходах» (все статусы)", Money.format(current.check.expensesAll))
                if current.check.declined.rounded() != 0 {
                    reconRow("− отклонённые (\(current.check.declinedCount) шт.)", "−" + Money.format(current.check.declined), dim: true)
                }
                if current.capex.rounded() != 0 {
                    reconRow("− покупка оборудования", "−" + Money.format(current.capex), dim: true)
                }
                if current.profitDistribution.rounded() != 0 {
                    reconRow("− выплаты партнёрам", "−" + Money.format(current.profitDistribution), dim: true)
                }
                reconRow("= Расходы в отчёте (с налогом)", Money.format(pnlExpenses), bold: true)
                Text("На тех страницах выберите весь месяц и тот же фильтр: \(filter). Выручка \(Money.format(current.revenue)) − расходы \(Money.format(pnlExpenses)) = чистая прибыль \(Money.format(current.netProfit)).")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textDim)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, Spacing.md)
            }
        }
    }

    private func reconRow(_ label: String, _ value: String, bold: Bool = false, dim: Bool = false) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .font(.system(size: 14, weight: bold ? .semibold : .regular))
                .foregroundStyle(dim ? Theme.textDim : Theme.text)
            Spacer(minLength: Spacing.sm)
            Text(value)
                .font(.system(size: 14, weight: bold ? .bold : .medium, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(dim ? Theme.textDim : Theme.text)
        }
        .padding(.vertical, 6)
    }

    // ── По точкам ────────────────────────────────────────────────────────────

    private func companiesCard(_ report: PnlReport) -> some View {
        let rows = report.companies.compactMap { company -> (PnlCompany, MonthlyPnl)? in
            guard let month = company.months.first, month.revenue.rounded() != 0 || month.netProfit.rounded() != 0 else { return nil }
            return (company, month)
        }
        .sorted { $0.1.revenue > $1.1.revenue }
        let top = max(rows.map(\.1.revenue).max() ?? 1, 1)
        return OwnerSection("По точкам") {
            Text("нажмите — отчёт точки")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textDim)
        } content: {
            VStack(spacing: Spacing.md) {
                ForEach(Array(rows.enumerated()), id: \.element.0.id) { index, item in
                    let (company, month) = item
                    Button {
                        withAnimation(Motion.tap) { companyID = company.id }
                    } label: {
                        AmountRow(
                            leading: { LetterBadge(text: company.name, tint: OwnerTint.point(index)) },
                            title: company.name + (company.isExtra ? " · вне итогов" : ""),
                            subtitle: "прибыль \(Money.format(month.netProfit)) · маржа \(Percent.format(month.netMargin))",
                            amount: Money.format(month.revenue),
                            change: company.previous.flatMap { Percent.change(current: month.revenue, previous: $0.revenue) },
                            share: month.revenue / top,
                            tint: OwnerTint.point(index),
                            showsChevron: true
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}
