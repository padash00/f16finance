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
                value: Money.compact(totals.expectedCash),
                icon: "banknote",
                accent: Theme.positive
            )
            MetricTile(
                label: "Kaspi",
                value: Money.compact(totals.expectedKaspi),
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
    @State private var kaspiText = ""
    @State private var notes = ""
    @State private var error: String?
    @State private var isSubmitting = false

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

                    amountField("Наличные в кассе", text: $cashText)
                    amountField("Kaspi за смену", text: $kaspiText)

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

    private var cashDifference: Double? {
        guard !cashText.isEmpty else { return nil }
        return parse(cashText) - store.totals.expectedCash
    }

    private func submit() {
        isSubmitting = true
        error = nil

        Task {
            let failure = await store.closeShift(
                cash: parse(cashText),
                kaspi: parse(kaspiText),
                notes: notes.isEmpty ? nil : notes
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
