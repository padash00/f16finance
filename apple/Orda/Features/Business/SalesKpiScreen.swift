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
    /// Список магазинов пришёл. До этого экран не пустой, а грузится: раньше
    /// между открытием и ответом под названием месяца было пусто, а если
    /// магазинов не оказалось вовсе — пусто навсегда.
    @State private var storesLoaded = false
    @State private var expanded: Set<String> = []
    /// Разбор по продавцам — вторая половина раздела. На сайте это отдельная
    /// вкладка, и данные приходят тем же запросом, что и список магазинов:
    /// показывать одну доплату значило показывать сумму без объяснения.
    @State private var report: SalesKpiReport?
    /// Цели на ближайшие смены. Отдельным запросом: они считаются на две недели
    /// вперёд, а не за прошедший месяц, — и грузить их вместе с отчётом значило
    /// бы задерживать то, ради чего экран открывают чаще.
    @State private var planList: SalesKpiPlans?
    @State private var isLoadingPlans = false
    @State private var section: Section = .payout
    @Environment(\.access) private var access
    @State private var exported: ExportedFile?
    @State private var exporting: Bool = false
    @State private var exportError: String?

    private enum Section: String, CaseIterable, Identifiable {
        case payout, review, plans, people
        var id: String { rawValue }
        var label: String {
            switch self {
            case .payout: "Кому доплатить"
            case .review: "Почему касса"
            case .plans: "Цели"
            case .people: "По продавцам"
            }
        }
    }

    var body: some View {
        ScreenScroll {
            header

            if let loadError {
                ErrorStateView(error: loadError) { Task { await reload() } }
            } else if noStore || (storesLoaded && selectedStore == nil) {
                WideEmptyState(
                    icon: "storefront",
                    title: "Магазина нет",
                    message: "Модуль считает работу за прилавком. Отметьте точку как магазин в настройках — и оценка появится."
                )
            } else if payout == nil {
                LoadingRows(count: 4)
            } else if let payout {
                PillSegment(options: Section.allCases.map { ($0, $0.label) }, selection: $section)

                if section == .people {
                    people
                } else if section == .review {
                    review
                } else if section == .plans {
                    plans
                } else {
                    totalsCard(payout)
                    if payout.rows.isEmpty {
                        WideEmptyState(
                            icon: "person.2",
                            title: "Продаж в этом месяце нет",
                            message: "Оценка появится, когда за прилавком начнут пробивать чеки."
                        )
                    } else {
                        sellersSection(payout)
                        footnote(payout)
                    }
                }
            }
        }
        .background(Theme.background)
        .navigationTitle("Эффективность продавцов")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            if access?.can("sales-kpi.export") == true, selectedStore != nil {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button { Task { await export(excel: false) } } label: {
                            Label("PDF — для чтения", systemImage: "doc.richtext")
                        }
                        Button { Task { await export(excel: true) } } label: {
                            Label("Excel — для расчётов", systemImage: "tablecells")
                        }
                    } label: {
                        if exporting {
                            ProgressView().controlSize(.small)
                        } else {
                            Image(systemName: "square.and.arrow.up")
                        }
                    }
                    .disabled(exporting)
                    .accessibilityLabel("Выгрузить отчёт")
                }
            }
        }
        .shareSheet($exported)
        .alert("Не удалось собрать отчёт", isPresented: Binding(get: { exportError != nil }, set: { if !$0 { exportError = nil } })) {
            Button("Понятно", role: .cancel) {}
        } message: {
            Text(exportError ?? "")
        }
        .task {
            await loadStores()
            #if DEBUG
            // Проверка выгрузки: `-ordaAutoExport pdf|xlsx`.
            if let format = UserDefaults.standard.string(forKey: "ordaAutoExport") {
                try? await Task.sleep(for: .seconds(2))
                await export(excel: format == "xlsx")
            }
            #endif
        }
        .task(id: reloadKey) {
            planList = nil
            await loadPayout()
        }
        .task(id: "\(section.rawValue)|\(reloadKey)") {
            if section == .plans { await loadPlans() }
        }
        .refreshable { await reload() }
    }

    private var reloadKey: String { "\(selectedStore?.id ?? "")|\(month)" }

    // ── Шапка ────────────────────────────────────────────────────────────────

    private var header: some View {
        VStack(spacing: Spacing.md) {
            // Месяц листается круглыми кнопками по краям — как неделя в
            // зарплате и месяц в выписке.
            HStack(spacing: Spacing.md) {
                monthButton("chevron.left", enabled: true) {
                    month = SalesKpiScreen.shift(month, by: -1)
                }

                Spacer()

                Text(SalesKpiScreen.title(for: month))
                    .font(.system(size: 17, weight: .bold, design: .rounded))
                    .foregroundStyle(Theme.text)

                Spacer()

                monthButton("chevron.right", enabled: month < SalesKpiScreen.currentMonth) {
                    month = SalesKpiScreen.shift(month, by: 1)
                }
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
                                    .font(.system(size: 14, weight: .semibold))
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 8)
                                    .background(
                                        selectedStore?.id == store.id ? Theme.brand : Theme.surface,
                                        in: Capsule()
                                    )
                                    .foregroundStyle(
                                        selectedStore?.id == store.id ? Color.white : Theme.textMuted
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

    private func monthButton(_ icon: String, enabled: Bool, action: @escaping () -> Void) -> some View {
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

    // ── Итоги ────────────────────────────────────────────────────────────────

    /// Сколько доплатить — главной цифрой; уже выплаченное и число продавцов —
    /// под ней. Оранжевая карточка — есть кому доплатить.
    private func totalsCard(_ payout: SalesKpiPayout) -> some View {
        HeroSummary(
            title: "К доплате",
            value: Money.format(payout.totals.toPay),
            caption: payout.totals.toPayPeople > 0
                ? "\(payout.totals.toPayPeople) \(pluralPeople(payout.totals.toPayPeople)) ждут начисления"
                : "Никто не ждёт начисления",
            footer: [
                ("Уже выплачено", Money.format(payout.totals.alreadyPaid)),
                ("Продавцов", "\(payout.totals.people)"),
            ],
            colors: payout.totals.toPay > 0
                ? Theme.heroGradient
                : Theme.heroGradient
        )
    }

    // ── Продавец ─────────────────────────────────────────────────────────────

    /// Продавцы одним белым блоком строками — раньше каждый был отдельной
    /// карточкой, и на экран помещалось двое.
    private func sellersSection(_ payout: SalesKpiPayout) -> some View {
        OwnerSection("Продавцы") {
            Text("нажмите, чтобы раскрыть")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textDim)
        } content: {
            VStack(spacing: Spacing.md) {
                ForEach(payout.rows) { row in
                    sellerRow(row, settings: payout.settings)
                }
            }
        }
        .animation(Motion.value, value: expanded)
    }

    private func sellerRow(_ row: SalesKpiPayout.Row, settings: SalesKpiPayout.Settings) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Button {
                if expanded.contains(row.id) { expanded.remove(row.id) } else { expanded.insert(row.id) }
            } label: {
                HStack(spacing: Spacing.md) {
                    PersonInitial(name: row.name)

                    VStack(alignment: .leading, spacing: 4) {
                        HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                            Text(row.name)
                                .font(.system(size: 16, weight: .medium))
                                .foregroundStyle(Theme.text)
                                .lineLimit(1)
                            Spacer(minLength: Spacing.sm)
                            Text(Money.format(row.amount))
                                .font(.system(size: 16, weight: .semibold, design: .rounded))
                                .monospacedDigit()
                                .foregroundStyle(row.amount > 0 ? Theme.positive : Theme.textDim)
                        }

                        HStack(spacing: Spacing.xs) {
                            Text(row.statusLabel)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(color(for: row.status))
                            Text("· \(row.shifts) \(pluralShifts(row.shifts)), \(row.receipts) \(pluralReceipts(row.receipts))")
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.textDim)
                                .lineLimit(1)
                            Spacer(minLength: Spacing.sm)
                            if row.amount > 0 {
                                Text(row.paid ? "выплачено" : "к выплате")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(row.paid ? Theme.positive : Theme.warning)
                            }
                        }
                    }

                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.textDim)
                        .rotationEffect(.degrees(expanded.contains(row.id) ? 90 : 0))
                }
                .padding(.vertical, Spacing.xs)
                .contentShape(Rectangle())
            }
            .buttonStyle(.pressable)

            if expanded.contains(row.id) {
                details(row)
                    .padding(Spacing.md)
                    .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
        }
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
        OwnerFootnote(
            text: "Доплата начисляется от статуса «Сильный» — \(Money.format(payout.settings.strong)), "
                + "за «Топ» — \(Money.format(payout.settings.top)). "
                + "Считается от \(payout.settings.minQualifyingShifts) смен за месяц. "
                + "Начисление в зарплату делается на сайте."
        )
    }

    // ── Данные ───────────────────────────────────────────────────────────────

    /// Цели на ближайшие смены.
    ///
    /// Продавцу нужно знать цель до смены, а не после. На сайте эта лестница
    /// есть, в приложении её не было — и человек за прилавком узнавал свой
    /// порог только со слов старшего.
    ///
    /// Правка и фиксация целей остаются на сайте: это решение руководителя, и
    /// принимать его на бегу с телефона незачем — зафиксированный план уже
    /// обещан продавцу.
    @ViewBuilder
    private var plans: some View {
        if isLoadingPlans && planList == nil {
            LoadingRows(count: 3)
        } else if let planList, !planList.plans.isEmpty {
            OwnerSection("Ближайшие смены") {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    if let monthly = planList.monthlyText {
                        Text(monthly)
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textDim)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    ForEach(planList.plans) { plan in
                        planRow(plan)
                    }
                }
            }
        } else {
            WideEmptyState(
                icon: "target",
                title: "Целей пока нет",
                message: "Пороги считаются по истории смен. Как только её наберётся достаточно, цели появятся здесь."
            )
        }
    }

    private func planRow(_ plan: SalesKpiPlans.Plan) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(alignment: .firstTextBaseline) {
                Text("\(DateFormatting.dayMonth(plan.date)) · \(plan.shiftLabel)")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Theme.text)
                Spacer()
                if plan.locked {
                    // Обещание, данное продавцу: пересчёту больше не подлежит.
                    Text("Зафиксирован")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.positive)
                } else {
                    Text("Предварительный")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                }
            }

            if plan.hasTargets {
                HStack(spacing: Spacing.md) {
                    targetPill("Порог", plan.control, tint: Theme.textDim)
                    targetPill("Бонус", plan.b1, tint: Theme.text)
                    targetPill("Выше", plan.b2, tint: Theme.brand)
                    targetPill("Рекорд", plan.b3, tint: Theme.positive)
                }
            } else {
                Text("Мало истории — пороги не посчитаны")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
            }

            HStack(spacing: Spacing.sm) {
                if let expected = plan.expectedRevenue {
                    Text("прогноз \(Money.format(expected))")
                }
                if let receipts = plan.expectedReceipts {
                    Text("· \(receipts) чек.")
                }
                if let weather = plan.weatherLabel {
                    Text("· \(weather)")
                }
            }
            .font(Typography.caption)
            .foregroundStyle(Theme.textDim)
        }
        .padding(.vertical, Spacing.xs)
    }

    private func targetPill(_ label: String, _ value: Double?, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label)
                .font(Typography.label)
                .foregroundStyle(Theme.textDim)
            Text(value == nil ? "—" : Money.format(value))
                .font(Typography.caption.weight(.semibold))
                .foregroundStyle(tint)
        }
    }

    /// Почему касса получилась такой.
    ///
    /// Главный вопрос владельца к слабой смене — «это продавец плохо работал
    /// или людей не было?». Это два разных ответа, и путать их нельзя: за
    /// пустой вечер человек не отвечает. Сервер уже разбирает каждую смену и
    /// присылает вывод тем же ответом — на сайте это отдельная вкладка, а в
    /// приложении показывали только сумму к доплате, без объяснения, за что.
    @ViewBuilder
    private var review: some View {
        if let report, !report.shifts.isEmpty {
            OwnerSection("Разбор смен") {
                Text("\(report.shifts.count) \(pluralShifts(report.shifts.count))")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
            } content: {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    ForEach(reviewOrder) { shift in
                        shiftRow(shift)
                    }
                }
            }
        } else if report != nil {
            WideEmptyState(
                icon: "calendar",
                title: "Смен за месяц нет",
                message: "Разбор появится, когда за прилавком отработают хотя бы одну смену."
            )
        } else {
            LoadingRows(count: 3)
        }
    }

    /// Сначала то, что требует внимания: вопрос к продавцу, потом сильные
    /// смены, потом остальное. Внутри — по дате, свежие сверху.
    private var reviewOrder: [SalesKpiReport.Shift] {
        (report?.shifts ?? []).sorted { left, right in
            let leftWeight = reviewWeight(left.verdict)
            let rightWeight = reviewWeight(right.verdict)
            if leftWeight != rightWeight { return leftWeight < rightWeight }
            return left.date > right.date
        }
    }

    private func reviewWeight(_ verdict: String) -> Int {
        switch verdict {
        case "POSSIBLE_CASHIER_ISSUE": 0
        case "STRONG_CASHIER": 1
        case "LOW_DEMAND", "HIGH_DEMAND": 2
        default: 3
        }
    }

    /// Ярлык вывода. Слова те же, что на сайте: расхождение здесь означало бы
    /// два разных языка об одном и том же.
    private func verdictLabel(_ verdict: String) -> (text: String, tint: Color) {
        switch verdict {
        case "LOW_DEMAND": ("Мало покупателей", Theme.info)
        case "POSSIBLE_CASHIER_ISSUE": ("Вопрос к продавцу", Theme.warning)
        case "HIGH_DEMAND": ("Вытянул поток", Theme.info)
        case "STRONG_CASHIER": ("Сильная смена", Theme.positive)
        case "INSUFFICIENT_DATA": ("Мало данных", Theme.textDim)
        default: ("Норма", Theme.textDim)
        }
    }

    private func shiftRow(_ shift: SalesKpiReport.Shift) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(alignment: .firstTextBaseline) {
                Text("\(DateFormatting.dayMonth(shift.date)) · \(shift.shiftLabel)")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Theme.text)
                Spacer()
                Text(verdictLabel(shift.verdict).text)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(verdictLabel(shift.verdict).tint)
            }

            HStack(spacing: Spacing.md) {
                Text(Money.format(shift.revenue))
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(Theme.text)
                if let deviation = shift.deviation {
                    // deviation — доля (0,12), а Percent ждёт проценты.
                    Text(Percent.format(deviation * 100, signed: true))
                        .font(Typography.caption)
                        .foregroundStyle(deviation >= 0 ? Theme.positive : Theme.warning)
                }
                Text("\(shift.receipts) чек. · средний \(Money.format(shift.averageReceipt))")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
            }

            if let cashier = shift.cashierName, !cashier.isEmpty {
                Text(cashier)
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
            }

            // Доводы сервера — то, из-за чего он так решил. Без них ярлык
            // остаётся приговором без объяснения.
            ForEach(shift.evidence.prefix(3), id: \.self) { line in
                Text("· \(line)")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
            }
        }
        .padding(.vertical, Spacing.xs)
    }

    /// Как работают за прилавком — не про деньги к доплате, а про работу.
    ///
    /// Выручка здесь справка, а не заслуга: она зависит от того, сколько людей
    /// зашло. Поэтому первым идёт балл относительно нормы и средний чек, а
    /// выручка — мелким шрифтом.
    @ViewBuilder
    private var people: some View {
        if let report, !report.cashiers.isEmpty {
            // Итог месяца — цветной карточкой: средний чек главной цифрой,
            // чеки и смены — под ней.
            HeroSummary(
                title: "Средний чек за месяц",
                value: Money.format(report.totals.averageReceipt),
                footer: [
                    ("Чеков", "\(report.totals.receipts)"),
                    ("Смен", "\(report.totals.shifts)"),
                ],
                colors: Theme.heroGradient
            )

            OwnerSection("Продавцы") {
                Text("\(report.cashiers.count)")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textDim)
            } content: {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    ForEach(report.cashiers) { cashier in
                        cashierRow(cashier)
                    }
                }
            }

            OwnerFootnote(text: "Статус ставится от \(report.minQualifyingShifts) смен: по паре смен человека не оценивают. Выручка зависит от потока, а не только от продавца, — поэтому она здесь справка.")
        } else {
            WideEmptyState(
                icon: "person.2",
                title: "Разбора пока нет",
                message: "Он появится, когда за прилавком наберутся смены с чеками."
            )
        }
    }

    private func cashierRow(_ cashier: SalesKpiReport.Cashier) -> some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            PersonInitial(name: cashier.name)

            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                    Text(cashier.name)
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                    Spacer(minLength: Spacing.sm)
                    // Статус подписью, а не плашкой — плашка съедала полстроки.
                    Text(cashier.statusLabel)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(statusColor(cashier.status))
                }

                Text(cashier.scoreText)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(scoreColor(cashier.score))

                Text("средний чек \(Money.format(cashier.averageReceipt)) · \(cashier.shifts) \(pluralShifts(cashier.shifts)) · \(cashier.receipts) \(pluralReceipts(cashier.receipts))")
                    .font(.system(size: 13))
                    .monospacedDigit()
                    .foregroundStyle(Theme.textDim)
                    .fixedSize(horizontal: false, vertical: true)

                // Сильные и слабые стороны — то, ради чего этот раздел
                // вообще открывают: с ними идут к человеку разговаривать.
                if !cashier.strengths.isEmpty {
                    Text("Лучше нормы: " + cashier.strengths.map(SalesKpiMetric.label).joined(separator: ", "))
                        .font(Typography.caption)
                        .foregroundStyle(Theme.positive)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if !cashier.weaknesses.isEmpty {
                    Text("Ниже нормы: " + cashier.weaknesses.map(SalesKpiMetric.label).joined(separator: ", "))
                        .font(Typography.caption)
                        .foregroundStyle(Theme.warning)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if cashier.trainingFlag, let reason = cashier.trainingReason {
                    Text(reason)
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private func scoreColor(_ score: Double?) -> Color {
        guard let score else { return Theme.textDim }
        if score >= 1.05 { return Theme.positive }
        if score <= 0.95 { return Theme.warning }
        return Theme.textMuted
    }

    private func statusColor(_ status: String) -> Color {
        switch status {
        case "TOP", "STRONG": Theme.positive
        case "WEAK": Theme.warning
        case "LOW_SAMPLE", "FEW_SHIFTS": Theme.textDim
        default: Theme.info
        }
    }

    private func loadStores() async {
        guard stores.isEmpty else { return }
        do {
            let response = try await SalesKpiService(api: api).stores(month: month)
            stores = response.stores
            noStore = response.noStore
            if selectedStore == nil { selectedStore = response.stores.first }
            storesLoaded = true
        } catch let error as APIError {
            loadError = error
        } catch {
            loadError = .transport(message: error.localizedDescription)
        }
    }

    private func loadPayout() async {
        guard let store = selectedStore else { return }
        let service = SalesKpiService(api: api)
        // Прошлая доплата — сразу, свежая на ходу.
        if payout == nil { payout = await service.cachedPayout(companyID: store.id, month: month) }
        isLoading = payout == nil
        loadError = nil
        do {
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

    /// Цели грузим при первом заходе на вкладку: большинство открывает экран
    /// ради доплаты, и лишний запрос всем незачем.
    private func loadPlans() async {
        guard let store = selectedStore, planList == nil, !isLoadingPlans else { return }
        isLoadingPlans = true
        defer { isLoadingPlans = false }
        let today = Date()
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        let from = formatter.string(from: today)
        let to = formatter.string(from: today.addingTimeInterval(13 * 86_400))

        let service = SalesKpiService(api: api)
        do {
            planList = try await service.plans(companyID: store.id, from: from, to: to)
        } catch let error as APIError {
            loadError = error
        } catch {
            loadError = .transport(message: error.localizedDescription)
        }
    }

    /// PDF собирается на сервере несколько секунд — крутим индикатор в кнопке.
    private func export(excel: Bool) async {
        guard let store = selectedStore else { return }
        exporting = true
        defer { exporting = false }
        do {
            let data = try await SalesKpiService(api: api).export(companyID: store.id, month: month, excel: excel)
            let bounds = SalesKpiService.monthBounds(month)
            exported = try ExportedFile.write(
                data,
                name: SpreadsheetExport.fileName("Разбор смен \(store.name) \(bounds.from) — \(bounds.to)", ext: excel ? "xlsx" : "pdf")
            )
            Haptics.success()
        } catch let error as APIError {
            exportError = error.userMessage
        } catch {
            exportError = error.localizedDescription
        }
    }

    private func reload() async {
        stores = []
        storesLoaded = false
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
