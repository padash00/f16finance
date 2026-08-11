import OrdaKit
import OrdaUI
import SwiftUI

/// Главный экран оператора: состояние смены.
///
/// Всё остальное вторично — если смена не открыта, продавать нельзя, и экран
/// должен говорить именно об этом, а не показывать пустую витрину.
struct ShiftScreen: View {
    @Environment(OperatorStore.self) private var store

    @State private var showOpenSheet = false
    @State private var showCloseSheet = false

    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.lg) {
                if store.queuedSalesCount > 0 {
                    offlineBanner
                }

                if let error = store.shiftError {
                    Card(accent: Theme.negative) {
                        VStack(alignment: .leading, spacing: Spacing.md) {
                            Label(error, systemImage: "exclamationmark.triangle")
                                .font(Typography.callout)
                                .foregroundStyle(Theme.textMuted)
                            Button("Повторить") {
                                Task { await store.loadShift() }
                            }
                            .buttonStyle(SecondaryButtonStyle())
                        }
                    }
                } else if store.isLoadingShift && store.shiftState == nil {
                    VStack(spacing: Spacing.md) {
                        Skeleton(height: 140, cornerRadius: Radius.lg)
                        Skeleton(height: 90, cornerRadius: Radius.lg)
                    }
                } else if store.isSomeoneElsesShift {
                    othersShiftContent
                } else if store.hasOpenShift {
                    openShiftContent
                } else {
                    closedShiftContent
                }
            }
            .padding(Spacing.lg)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.background)
        .navigationTitle("Моя смена")
        .refreshable { await store.loadShift() }
        .sheet(isPresented: $showOpenSheet) { OpenShiftSheet() }
        .sheet(isPresented: $showCloseSheet) { CloseShiftSheet() }
    }

    // ── Смена чужая ──────────────────────────────────────────────────────────

    /// На точке стоит сменщик.
    ///
    /// Раньше здесь показывалась его выручка, разбивка по наличным и Kaspi и
    /// кнопка «Закрыть смену»: с телефона, из дома, любой оператор точки видел
    /// чужие деньги. Сервер закрыть чужую смену не даёт, но и показывать это
    /// нечего.
    private var othersShiftContent: some View {
        VStack(spacing: Spacing.lg) {
            Card(accent: Theme.info) {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    Label("На смене другой", systemImage: "person.fill.checkmark")
                        .font(Typography.label)
                        .foregroundStyle(Theme.info)
                        .textCase(.uppercase)

                    Text(store.shift?.operatorName ?? "Сменщик")
                        .font(Typography.metric)
                        .foregroundStyle(Theme.text)

                    if let opened = store.shift?.openedAt {
                        Text("смена идёт \(elapsed(since: opened))")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                    }

                    Text("Выручка и закрытие смены — у того, кто её открыл. Своя смена появится здесь, когда сменщик закроет эту.")
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textMuted)
                }
            }
        }
    }

    // ── Смена закрыта ────────────────────────────────────────────────────────

    private var closedShiftContent: some View {
        VStack(spacing: Spacing.lg) {
            Card(accent: Theme.accent(for: .operator)) {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    Text("Смена не открыта")
                        .font(Typography.metric)
                        .foregroundStyle(Theme.text)

                    Text("Пока смена закрыта, продавать нельзя. Открытие проверит, стоите ли вы сегодня в графике.")
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textMuted)

                    Button("Открыть смену") { showOpenSheet = true }
                        .buttonStyle(PrimaryButtonStyle(tint: Theme.accent(for: .operator)))
                        .padding(.top, Spacing.sm)
                }
            }
        }
    }

    // ── Смена открыта ────────────────────────────────────────────────────────

    @ViewBuilder
    private var openShiftContent: some View {
        let shift = store.shift
        let totals = store.totals

        Card(accent: Theme.positive) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                HStack {
                    Label("Смена открыта", systemImage: "circle.fill")
                        .font(Typography.label)
                        .foregroundStyle(Theme.positive)
                        .textCase(.uppercase)
                    Spacer()
                    if let opened = shift?.openedAt {
                        Text(elapsed(since: opened))
                            .font(Typography.caption.weight(.semibold))
                            .monospacedDigit()
                            .foregroundStyle(Theme.textDim)
                    }
                }

                Text(Money.format(totals.netTotal))
                    .font(Typography.monospacedDigits(Typography.hero))
                    .foregroundStyle(Theme.text)
                    .contentTransition(.numericText())
                    .animation(Motion.value, value: totals.netTotal)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)

                Text("выручка за смену · \(totals.salesCount) чек\(pluralSuffix(totals.salesCount))")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)

                if let name = shift?.operatorName {
                    Text("Открыл: \(name)")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                }
            }
        }

        HStack(spacing: Spacing.md) {
            MetricTile(
                label: "Наличные",
                value: Money.format(totals.expectedCash),
                icon: "banknote",
                accent: Theme.positive
            )
            MetricTile(
                label: "Kaspi",
                value: Money.format(totals.expectedKaspi),
                icon: "creditcard",
                accent: Theme.info
            )
        }

        if totals.returnsCount > 0 {
            Card(accent: Theme.warning) {
                HStack {
                    Label("Возвраты", systemImage: "arrow.uturn.backward")
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textMuted)
                    Spacer()
                    Text("\(totals.returnsCount) · \(Money.format(totals.returnsTotal))")
                        .font(Typography.callout.weight(.semibold))
                        .foregroundStyle(Theme.warning)
                }
            }
        }

        // Обязательные чек-листы показываем заранее — иначе кассир узнает о
        // них только в момент отказа при закрытии.
        if !store.blockingChecklists.isEmpty {
            Card(accent: Theme.warning) {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    Label("Нужно завершить до закрытия", systemImage: "checklist.unchecked")
                        .font(Typography.label)
                        .foregroundStyle(Theme.warning)
                        .textCase(.uppercase)

                    ForEach(store.blockingChecklists) { template in
                        Text("• \(template.title)")
                            .font(Typography.callout)
                            .foregroundStyle(Theme.textMuted)
                    }
                }
            }
        }

        Button("Закрыть смену") { showCloseSheet = true }
            .buttonStyle(SecondaryButtonStyle())
    }

    private var offlineBanner: some View {
        Card(accent: Theme.warning) {
            HStack(spacing: Spacing.md) {
                Image(systemName: "arrow.triangle.2.circlepath")
                    .foregroundStyle(Theme.warning)
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(store.queuedSalesCount) чек\(pluralSuffix(store.queuedSalesCount)) ждёт отправки")
                        .font(Typography.callout.weight(.semibold))
                        .foregroundStyle(Theme.text)
                    Text("Продажи сохранены на устройстве и уйдут при связи.")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                }
                Spacer()
                Button("Отправить") {
                    Task { await store.flushQueue() }
                }
                .buttonStyle(.plain)
                .font(Typography.caption.weight(.bold))
                .foregroundStyle(Theme.warning)
            }
        }
    }

    // ── Вспомогательное ──────────────────────────────────────────────────────

    private func elapsed(since date: Date) -> String {
        let seconds = Int(Date().timeIntervalSince(date))
        let hours = seconds / 3600
        let minutes = (seconds % 3600) / 60
        return hours > 0 ? "\(hours) ч \(minutes) мин" : "\(minutes) мин"
    }

    /// Русское окончание для «чек / чека / чеков».
    private func pluralSuffix(_ count: Int) -> String {
        let mod100 = count % 100
        if (11...14).contains(mod100) { return "ов" }
        switch count % 10 {
        case 1: return ""
        case 2, 3, 4: return "а"
        default: return "ов"
        }
    }
}

// ── Открытие смены ───────────────────────────────────────────────────────────

struct OpenShiftSheet: View {
    @Environment(OperatorStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var cashText = ""
    @State private var kind: ShiftKind = .day
    @State private var error: String?
    @State private var isSubmitting = false
    @FocusState private var cashFocused: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    Text("Сколько денег в кассе на старте?")
                        .font(Typography.title)
                        .foregroundStyle(Theme.text)

                    Text("Эта сумма — точка отсчёта. По ней при закрытии сойдётся касса.")
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textMuted)

                    HStack(spacing: Spacing.md) {
                        TextField("0", text: $cashText)
                            .font(Typography.monospacedDigits(Typography.metric))
                            .textFieldStyle(.plain)
                            .focused($cashFocused)
                            #if os(iOS)
                            .keyboardType(.numberPad)
                            #endif
                        Text(Money.currencySymbol)
                            .font(Typography.metric)
                            .foregroundStyle(Theme.textDim)
                    }
                    .padding(Spacing.lg)
                    .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))

                    Picker("Тип смены", selection: $kind) {
                        Text("Дневная").tag(ShiftKind.day)
                        Text("Ночная").tag(ShiftKind.night)
                    }
                    .pickerStyle(.segmented)

                    if let error {
                        Text(error)
                            .font(Typography.callout)
                            .foregroundStyle(Theme.negative)
                    }

                    Button {
                        submit()
                    } label: {
                        if isSubmitting {
                            ProgressView().controlSize(.small)
                        } else {
                            Text("Открыть смену")
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle(tint: Theme.accent(for: .operator)))
                    .disabled(isSubmitting || parsedCash == nil)
                }
                .padding(Spacing.lg)
            }
            .background(Theme.background)
            .navigationTitle("Открытие смены")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
            }
        }
        .onAppear { cashFocused = true }
    }

    /// Пустое поле и «0» — разные вещи: ноль в кассе бывает, а «не указал» —
    /// повод не пускать дальше.
    private var parsedCash: Double? {
        let normalized = cashText.replacingOccurrences(of: ",", with: ".").trimmingCharacters(in: .whitespaces)
        guard !normalized.isEmpty, let value = Double(normalized), value >= 0 else { return nil }
        return value
    }

    private func submit() {
        guard let cash = parsedCash else { return }
        isSubmitting = true
        error = nil

        Task {
            let failure = await store.openShift(openingCash: cash, kind: kind)
            isSubmitting = false
            if let failure {
                error = failure
            } else {
                dismiss()
            }
        }
    }
}

// ── Закрытие смены ───────────────────────────────────────────────────────────

struct CloseShiftSheet: View {
    @Environment(OperatorStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var cashText = ""
    @State private var coinsText = ""
    @State private var kaspiText = ""
    /// Ночная смена: часть Kaspi проходит до полуночи, часть после.
    @State private var kaspiBeforeText = ""
    @State private var notes = ""
    @State private var error: String?
    @State private var isSubmitting = false

    /// Ночная ли смена — от этого зависит, спрашивать ли разделение Kaspi.
    private var isNight: Bool { store.shift?.shiftType == "night" }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    // Ожидаемые суммы показываем рядом с полями: расхождение
                    // должно быть видно до отправки, а не в отчёте наутро.
                    Card {
                        VStack(alignment: .leading, spacing: Spacing.sm) {
                            Text("Ожидается по системе")
                                .font(Typography.label)
                                .foregroundStyle(Theme.textDim)
                                .textCase(.uppercase)
                            row("Наличные", Money.format(store.totals.expectedCash))
                            row("Kaspi", Money.format(store.totals.expectedKaspi))
                        }
                    }

                    // Купюры и мелочь врозь — как в программе на точке.
                    // Слитая сумма мешает: мелочь остаётся в кассе на размен,
                    // а в отчёт по-хорошему идут купюры.
                    amountField("Купюры в кассе", text: $cashText)
                    amountField("Мелочь", text: $coinsText)

                    amountField(isNight ? "Kaspi всего за смену" : "Kaspi за смену", text: $kaspiText)

                    if isNight {
                        amountField("Из них до 00:00", text: $kaspiBeforeText)
                        // Ночная выручка делится между двумя календарными
                        // днями: без разделения весь Kaspi ложится на дату
                        // закрытия, и день по отчёту не сходится с кассой.
                        Text("Остальное — после полуночи: \(Money.format(kaspiAfter)). Так же считает программа на точке и дневной отчёт Kaspi.")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                    }

                    if parse(coinsText) > 0 {
                        row("Всего наличными", Money.format(parse(cashText) + parse(coinsText)))
                    }

                    if let difference = cashDifference, abs(difference) >= 1 {
                        Label(
                            difference > 0
                                ? "Излишек \(Money.format(difference))"
                                : "Недостача \(Money.format(abs(difference)))",
                            systemImage: difference > 0 ? "arrow.up.circle" : "arrow.down.circle"
                        )
                        .font(Typography.callout.weight(.semibold))
                        .foregroundStyle(difference > 0 ? Theme.warning : Theme.negative)
                    }

                    TextField("Комментарий (необязательно)", text: $notes, axis: .vertical)
                        .textFieldStyle(.plain)
                        .lineLimit(2...4)
                        .padding(Spacing.md)
                        .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))

                    if !store.blockingChecklists.isEmpty {
                        Card(accent: Theme.warning) {
                            VStack(alignment: .leading, spacing: Spacing.sm) {
                                Text("Сначала завершите чек-листы")
                                    .font(Typography.callout.weight(.semibold))
                                    .foregroundStyle(Theme.warning)
                                ForEach(store.blockingChecklists) { template in
                                    Text("• \(template.title)")
                                        .font(Typography.caption)
                                        .foregroundStyle(Theme.textMuted)
                                }
                            }
                        }
                    }

                    if let error {
                        Text(error)
                            .font(Typography.callout)
                            .foregroundStyle(Theme.negative)
                    }

                    Button {
                        submit()
                    } label: {
                        if isSubmitting {
                            ProgressView().controlSize(.small)
                        } else {
                            Text("Закрыть смену")
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle(tint: Theme.accent(for: .operator)))
                    .disabled(isSubmitting || !store.blockingChecklists.isEmpty)
                }
                .padding(Spacing.lg)
            }
            .background(Theme.background)
            .navigationTitle("Закрытие смены")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
            }
        }
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
                .font(Typography.callout)
                .foregroundStyle(Theme.textMuted)
            Spacer()
            Text(value)
                .font(Typography.callout.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(Theme.text)
        }
    }

    private func amountField(_ title: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(title)
                .font(Typography.label)
                .foregroundStyle(Theme.textDim)
            HStack {
                TextField("0", text: text)
                    .textFieldStyle(.plain)
                    .monospacedDigit()
                    #if os(iOS)
                    .keyboardType(.numberPad)
                    #endif
                Text(Money.currencySymbol)
                    .foregroundStyle(Theme.textDim)
            }
            .padding(Spacing.md)
            .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
        }
    }

    private func parse(_ text: String) -> Double {
        Double(text.replacingOccurrences(of: ",", with: ".").trimmingCharacters(in: .whitespaces)) ?? 0
    }

    /// Расхождение считаем по всем наличным — купюры плюс мелочь: в кассе
    /// лежит и то и другое.
    private var cashDifference: Double? {
        guard !cashText.isEmpty || !coinsText.isEmpty else { return nil }
        return parse(cashText) + parse(coinsText) - store.totals.expectedCash
    }

    private var kaspiAfter: Double {
        max(0, parse(kaspiText) - parse(kaspiBeforeText))
    }

    private func submit() {
        isSubmitting = true
        error = nil

        Task {
            // Мелочь уходит в комментарий: сервер хранит одну сумму наличных,
            // а разбивка нужна тому, кто утром разбирает расхождение.
            var comment = notes.trimmingCharacters(in: .whitespacesAndNewlines)
            if parse(coinsText) > 0 {
                let coins = "Мелочь: \(Money.format(parse(coinsText)))"
                comment = comment.isEmpty ? coins : "\(comment)\n\(coins)"
            }

            let failure = await store.closeShift(
                cash: parse(cashText) + parse(coinsText),
                kaspi: parse(kaspiText),
                kaspiBeforeMidnight: isNight ? parse(kaspiBeforeText) : 0,
                kaspiAfterMidnight: isNight ? kaspiAfter : 0,
                notes: comment.isEmpty ? nil : comment
            )
            isSubmitting = false
            if let failure {
                error = failure
            } else {
                dismiss()
            }
        }
    }
}
