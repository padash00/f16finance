import OrdaKit
import OrdaUI
import SwiftUI

/// «Эффективность продавцов» — владельческая половина модуля.
///
/// На телефоне из большого раздела оставлено то, ради чего в него заходят не за
/// столом: кому в этом месяце доплатить, сколько и за что. Настройка модели,
/// веса метрик, календарь и выгрузки в PDF и Excel остаются на сайте — это
/// работа, которую не делают стоя.
///
/// Магазины не смешиваются в один список: у точек разный ассортимент и поток,
/// и общий рейтинг сравнивал бы несравнимое. Поэтому точка выбирается явно.
struct SalesKpiScreen: View {
    @Environment(\.api) private var api

    @State private var month = SalesKpiScreen.currentMonth
    @State private var stores: [Company] = []
    @State private var selectedStore: Company?
    @State private var payout: SalesKpiPayout?
    @State private var loadError: APIError?
    @State private var isLoading = false
    @State private var noStore = false
    @State private var expanded: Set<String> = []
    /// Разбор по продавцам — вторая половина раздела. На сайте это отдельная
    /// вкладка, и данные приходят тем же запросом, что и список магазинов:
    /// показывать одну доплату значило показывать сумму без объяснения.
    @State private var report: SalesKpiReport?
    @State private var section: Section = .payout

    private enum Section: String, CaseIterable, Identifiable {
        case payout, people
        var id: String { rawValue }
        var label: String {
            switch self {
            case .payout: "Кому доплатить"
            case .people: "По продавцам"
            }
        }
    }

    var body: some View {
        ScreenScroll {
            header

            if let loadError {
                ErrorStateView(error: loadError) { Task { await reload() } }
            } else if noStore {
                WideEmptyState(
                    icon: "storefront",
                    title: "Магазина нет",
                    message: "Модуль считает работу за прилавком. Отметьте точку как магазин в настройках — и оценка появится."
                )
            } else if isLoading && payout == nil {
                LoadingRows(count: 4)
            } else if let payout {
                Picker("Раздел", selection: $section) {
                    ForEach(Section.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)

                if section == .people {
                    people
                } else {
                totalsCard(payout)
                if payout.rows.isEmpty {
                    WideEmptyState(
                        icon: "person.2",
                        title: "Продаж в этом месяце нет",
                        message: "Оценка появится, когда за прилавком начнут пробивать чеки."
                    )
                } else {
                    ForEach(payout.rows) { row in
                        sellerCard(row, settings: payout.settings)
                    }
                    footnote(payout)
                }
                }
            }
        }
        .navigationTitle("Эффективность продавцов")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task { await loadStores() }
        .task(id: reloadKey) { await loadPayout() }
        .refreshable { await reload() }
    }

    private var reloadKey: String { "\(selectedStore?.id ?? "")|\(month)" }

    // ── Шапка ────────────────────────────────────────────────────────────────

    private var header: some View {
        VStack(spacing: Spacing.sm) {
            HStack(spacing: Spacing.sm) {
                Button { month = SalesKpiScreen.shift(month, by: -1) } label: {
                    Image(systemName: "chevron.left")
                }
                .buttonStyle(.pressable)

                Spacer()

                Text(SalesKpiScreen.title(for: month))
                    .font(Typography.callout.weight(.semibold))
                    .foregroundStyle(Theme.text)

                Spacer()

                Button { month = SalesKpiScreen.shift(month, by: 1) } label: {
                    Image(systemName: "chevron.right")
                }
                .buttonStyle(.pressable)
                .disabled(month >= SalesKpiScreen.currentMonth)
                .opacity(month >= SalesKpiScreen.currentMonth ? 0.35 : 1)
            }

            // Переключатель точек показываем только когда их несколько:
            // одинокая кнопка «Магазин» ничего не переключает и только занимает
            // высоту первого экрана.
            if stores.count > 1 {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Spacing.xs) {
                        ForEach(stores) { store in
                            Button {
                                selectedStore = store
                            } label: {
                                Text(store.name)
                                    .font(Typography.caption.weight(.medium))
                                    .padding(.horizontal, Spacing.md)
                                    .padding(.vertical, Spacing.xs)
                                    .background(
                                        selectedStore?.id == store.id
                                            ? Theme.brand.opacity(0.16)
                                            : Theme.surfaceRaised,
                                        in: Capsule()
                                    )
                                    .foregroundStyle(
                                        selectedStore?.id == store.id ? Theme.brand : Theme.textDim
                                    )
                            }
                            .buttonStyle(.pressable)
                        }
                    }
                    .padding(.horizontal, 2)
                }
            }
        }
        .padding(.horizontal, Spacing.xs)
    }

    // ── Итоги ────────────────────────────────────────────────────────────────

    private func totalsCard(_ payout: SalesKpiPayout) -> some View {
        Card(accent: payout.totals.toPay > 0 ? Theme.warning : nil) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader(
                    "К доплате",
                    subtitle: payout.totals.toPayPeople > 0
                        ? "\(payout.totals.toPayPeople) \(pluralPeople(payout.totals.toPayPeople)) ждут начисления"
                        : "Никто не ждёт начисления"
                )

                Text(Money.format(payout.totals.toPay))
                    .font(Typography.hero)
                    .foregroundStyle(payout.totals.toPay > 0 ? Theme.warning : Theme.textDim)

                RowDivider()

                HStack(spacing: Spacing.xl) {
                    VStack(alignment: .leading, spacing: Spacing.xxs) {
                        Text("УЖЕ ВЫПЛАЧЕНО")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textMuted)
                        Text(Money.format(payout.totals.alreadyPaid))
                            .font(Typography.title)
                            .foregroundStyle(Theme.positive)
                    }
                    VStack(alignment: .leading, spacing: Spacing.xxs) {
                        Text("ПРОДАВЦОВ")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textMuted)
                        Text("\(payout.totals.people)")
                            .font(Typography.title)
                            .foregroundStyle(Theme.text)
                    }
                }
            }
        }
    }

    // ── Продавец ─────────────────────────────────────────────────────────────

    private func sellerCard(_ row: SalesKpiPayout.Row, settings: SalesKpiPayout.Settings) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Button {
                    if expanded.contains(row.id) { expanded.remove(row.id) } else { expanded.insert(row.id) }
                } label: {
                    HStack(alignment: .top, spacing: Spacing.md) {
                        VStack(alignment: .leading, spacing: Spacing.xxs) {
                            Text(row.name)
                                .font(Typography.headline)
                                .foregroundStyle(Theme.text)

                            HStack(spacing: Spacing.xs) {
                                Text(row.statusLabel)
                                    .font(Typography.caption.weight(.medium))
                                    .foregroundStyle(color(for: row.status))
                                Text("·")
                                    .foregroundStyle(Theme.textMuted)
                                Text("\(row.shifts) \(pluralShifts(row.shifts)), \(row.receipts) \(pluralReceipts(row.receipts))")
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.textMuted)
                            }
                        }

                        Spacer(minLength: Spacing.sm)

                        VStack(alignment: .trailing, spacing: Spacing.xxs) {
                            Text(Money.format(row.amount))
                                .font(Typography.title)
                                .foregroundStyle(row.amount > 0 ? Theme.positive : Theme.textDim)
                            if row.amount > 0 {
                                Text(row.paid ? "выплачено" : "к выплате")
                                    .font(Typography.caption)
                                    .foregroundStyle(row.paid ? Theme.positive : Theme.warning)
                            }
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.pressable)

                if expanded.contains(row.id) {
                    RowDivider()
                    details(row)
                }
            }
        }
        .animation(Motion.value, value: expanded)
    }

    @ViewBuilder
    private func details(_ row: SalesKpiPayout.Row) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack {
                Text("Выручка за месяц")
                    .font(Typography.callout)
                    .foregroundStyle(Theme.textDim)
                Spacer()
                Text(Money.format(row.revenue))
                    .font(Typography.callout.weight(.medium))
                    .foregroundStyle(Theme.text)
            }

            if let reason = row.zeroReason {
                Text(reason)
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if !row.strengths.isEmpty {
                metricLine("Получается", keys: row.strengths, color: Theme.positive, icon: "arrow.up.right")
            }
            if !row.weaknesses.isEmpty {
                metricLine("Проседает", keys: row.weaknesses, color: Theme.warning, icon: "arrow.down.right")
            }
        }
    }

    private func metricLine(_ title: String, keys: [String], color: Color, icon: String) -> some View {
        HStack(alignment: .top, spacing: Spacing.sm) {
            Image(systemName: icon)
                .font(.caption.weight(.bold))
                .foregroundStyle(color)
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text(title.uppercased())
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textMuted)
                Text(keys.map(SalesKpiMetric.label).joined(separator: ", "))
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func footnote(_ payout: SalesKpiPayout) -> some View {
        Text(
            "Доплата начисляется от статуса «Сильный» — \(Money.format(payout.settings.strong)), "
                + "за «Топ» — \(Money.format(payout.settings.top)). "
                + "Считается от \(payout.settings.minQualifyingShifts) смен за месяц. "
                + "Начисление в зарплату делается на сайте."
        )
        .font(Typography.caption)
        .foregroundStyle(Theme.textMuted)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, Spacing.xs)
    }

    // ── Данные ───────────────────────────────────────────────────────────────

    /// Как работают за прилавком — не про деньги к доплате, а про работу.
    ///
    /// Выручка здесь справка, а не заслуга: она зависит от того, сколько людей
    /// зашло. Поэтому первым идёт балл относительно нормы и средний чек, а
    /// выручка — мелким шрифтом.
    @ViewBuilder
    private var people: some View {
        if let report, !report.cashiers.isEmpty {
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    SectionHeader(
                        "Итого за месяц",
                        subtitle: "\(report.totals.shifts) \(pluralShifts(report.totals.shifts))"
                    )
                    DashboardGrid {
                        MetricTile(
                            label: "Средний чек",
                            value: Money.format(report.totals.averageReceipt),
                            icon: "cart",
                            accent: Theme.brand
                        )
                        MetricTile(
                            label: "Чеков",
                            value: "\(report.totals.receipts)",
                            icon: "doc.text",
                            accent: Theme.info
                        )
                    }
                }
            }

            ForEach(report.cashiers) { cashier in
                Card {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        HStack(spacing: Spacing.md) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(cashier.name)
                                    .font(Typography.callout.weight(.medium))
                                    .foregroundStyle(Theme.text)
                                Text(cashier.scoreText)
                                    .font(Typography.caption)
                                    .foregroundStyle(scoreColor(cashier.score))
                            }
                            Spacer(minLength: Spacing.sm)
                            StatusChip(cashier.statusLabel, kind: chip(for: cashier.status))
                        }

                        StatRow("Средний чек", value: Money.format(cashier.averageReceipt), icon: "cart")
                        StatRow(
                            "Смены и чеки",
                            value: "\(cashier.shifts) · \(cashier.receipts)",
                            icon: "calendar"
                        )

                        // Сильные и слабые стороны — то, ради чего этот раздел
                        // вообще открывают: с ними идут к человеку разговаривать.
                        if !cashier.strengths.isEmpty {
                            Text("Лучше нормы: " + cashier.strengths.map(SalesKpiMetric.label).joined(separator: ", "))
                                .font(Typography.caption)
                                .foregroundStyle(Theme.positive)
                        }
                        if !cashier.weaknesses.isEmpty {
                            Text("Ниже нормы: " + cashier.weaknesses.map(SalesKpiMetric.label).joined(separator: ", "))
                                .font(Typography.caption)
                                .foregroundStyle(Theme.warning)
                        }
                        if cashier.trainingFlag, let reason = cashier.trainingReason {
                            Text(reason)
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textMuted)
                        }
                    }
                }
            }

            Text("Статус ставится от \(report.minQualifyingShifts) смен: по паре смен человека не оценивают. Выручка зависит от потока, а не только от продавца, — поэтому она здесь справка.")
                .font(Typography.caption)
                .foregroundStyle(Theme.textDim)
                .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            WideEmptyState(
                icon: "person.2",
                title: "Разбора пока нет",
                message: "Он появится, когда за прилавком наберутся смены с чеками."
            )
        }
    }

    private func scoreColor(_ score: Double?) -> Color {
        guard let score else { return Theme.textDim }
        if score >= 1.05 { return Theme.positive }
        if score <= 0.95 { return Theme.warning }
        return Theme.textMuted
    }

    private func chip(for status: String) -> StatusChip.Kind {
        switch status {
        case "TOP", "STRONG": .good
        case "WEAK": .warning
        case "LOW_SAMPLE", "FEW_SHIFTS": .neutral
        default: .info
        }
    }

    private func loadStores() async {
        guard stores.isEmpty else { return }
        do {
            let response = try await SalesKpiService(api: api).stores(month: month)
            stores = response.stores
            noStore = response.noStore
            if selectedStore == nil { selectedStore = response.stores.first }
        } catch let error as APIError {
            loadError = error
        } catch {
            loadError = .transport(message: error.localizedDescription)
        }
    }

    private func loadPayout() async {
        guard let store = selectedStore else { return }
        isLoading = payout == nil
        loadError = nil
        do {
            let service = SalesKpiService(api: api)
            payout = try await service.payout(companyID: store.id, month: month)
            // Отчёт по продавцам — тем же месяцем: раздел один, и переключение
            // между «кому доплатить» и «по продавцам» не должно ничего ждать.
            report = try? await service.report(month: month)
        } catch let error as APIError {
            loadError = error
        } catch {
            loadError = .transport(message: error.localizedDescription)
        }
        isLoading = false
    }

    private func reload() async {
        stores = []
        await loadStores()
        await loadPayout()
    }

    private func color(for status: String) -> Color {
        switch status {
        case "TOP": return Theme.positive
        case "STRONG": return Theme.brand
        case "NEEDS_TRAINING": return Theme.warning
        default: return Theme.info
        }
    }

    private func pluralPeople(_ n: Int) -> String {
        pluralize(n, "человек", "человека", "человек")
    }

    private func pluralShifts(_ n: Int) -> String {
        pluralize(n, "смена", "смены", "смен")
    }

    private func pluralReceipts(_ n: Int) -> String {
        pluralize(n, "чек", "чека", "чеков")
    }

    // ── Месяц ────────────────────────────────────────────────────────────────

    private static var currentMonth: String {
        let now = Calendar.current.dateComponents([.year, .month], from: Date())
        return String(format: "%04d-%02d", now.year ?? 1970, now.month ?? 1)
    }

    private static func shift(_ month: String, by delta: Int) -> String {
        let parts = month.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 2 else { return month }
        var components = DateComponents()
        components.year = parts[0]
        components.month = parts[1]
        guard let date = Calendar.current.date(from: components),
              let moved = Calendar.current.date(byAdding: .month, value: delta, to: date)
        else { return month }
        let next = Calendar.current.dateComponents([.year, .month], from: moved)
        return String(format: "%04d-%02d", next.year ?? 1970, next.month ?? 1)
    }

    private static func title(for month: String) -> String {
        let parts = month.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 2 else { return month }
        var components = DateComponents()
        components.year = parts[0]
        components.month = parts[1]
        guard let date = Calendar.current.date(from: components) else { return month }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ru_RU")
        formatter.dateFormat = "LLLL yyyy"
        return formatter.string(from: date).capitalized
    }
}
