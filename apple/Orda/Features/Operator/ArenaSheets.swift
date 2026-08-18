import OrdaKit
import OrdaUI
import SwiftUI

/// Посадить гостя за станцию.
///
/// Тариф и способ оплаты — всё, что нужно спросить у стойки. Сумму по
/// наличным и Kaspi считает сервер по цене тарифа: свои подсчёты у стойки —
/// то, из-за чего потом не сходится смена. Руками делят только смешанную
/// оплату, где часть налом, а остаток переводом.
struct ArenaStartSheet: View {
    let station: ArenaStation

    @Environment(\.dismiss) private var dismiss
    @Environment(ArenaStore.self) private var arena

    @State private var tariffID: String?
    @State private var payment: ArenaPayment = .cash
    @State private var cash = ""
    @State private var kaspi = ""
    @State private var discount: Double = 0
    @State private var isSaving = false
    @State private var error: String?

    private var tariffs: [ArenaTariff] {
        arena.hall?.tariffs(for: station) ?? []
    }

    private var tariff: ArenaTariff? {
        tariffs.first { $0.id == tariffID }
    }

    /// Сколько гость платит с учётом скидки — та же формула, что на сервере.
    private var price: Double {
        guard let tariff else { return 0 }
        return (tariff.price * (1 - discount / 100)).rounded()
    }

    private var splitSum: Double {
        (Double(cash) ?? 0) + (Double(kaspi) ?? 0)
    }

    private var canStart: Bool {
        guard tariff != nil, !isSaving else { return false }
        if payment == .mixed { return splitSum > 0 }
        return true
    }

    var body: some View {
        NavigationStack {
            ScreenScroll {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.xxs) {
                        FieldLabel("Станция")
                        Text(station.name)
                            .font(Typography.title)
                            .foregroundStyle(Theme.text)
                    }
                }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        FieldLabel("Тариф")

                        if tariffs.isEmpty {
                            Text("Сейчас нет доступных тарифов. Ночные и дневные пакеты предлагаются только в своё время.")
                                .font(Typography.callout)
                                .foregroundStyle(Theme.textMuted)
                                .fixedSize(horizontal: false, vertical: true)
                        } else {
                            ForEach(Array(tariffs.enumerated()), id: \.element.id) { index, item in
                                if index > 0 { RowDivider() }
                                tariffRow(item)
                            }
                        }
                    }
                }

                if tariff != nil {
                    ArenaPaymentCard(
                        payment: $payment,
                        cash: $cash,
                        kaspi: $kaspi,
                        total: price
                    )

                    Card {
                        VStack(alignment: .leading, spacing: Spacing.sm) {
                            FieldLabel("Скидка")
                            Picker("", selection: $discount) {
                                Text("нет").tag(Double(0))
                                Text("10%").tag(Double(10))
                                Text("20%").tag(Double(20))
                                Text("30%").tag(Double(30))
                            }
                            .pickerStyle(.segmented)
                            .labelsHidden()
                        }
                    }
                }

                if let error {
                    Text(error)
                        .font(Typography.callout)
                        .foregroundStyle(Theme.negative)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Button {
                    Task { await start() }
                } label: {
                    if isSaving {
                        ProgressView().controlSize(.small)
                    } else {
                        Text(price > 0 ? "Запустить · \(Money.format(price))" : "Запустить")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!canStart)
            }
            .background(Theme.background)
            .navigationTitle("Посадить гостя")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
            }
            .onAppear {
                if tariffID == nil { tariffID = tariffs.first?.id }
            }
        }
    }

    private func tariffRow(_ item: ArenaTariff) -> some View {
        Button {
            tariffID = item.id
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.name)
                        .font(Typography.body)
                        .foregroundStyle(Theme.text)
                    Text(item.windowLabel ?? item.durationLabel)
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textMuted)
                }
                Spacer()
                Text(Money.format(item.price))
                    .font(Typography.body.weight(.medium))
                    .foregroundStyle(Theme.textDim)
                Image(systemName: tariffID == item.id ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(tariffID == item.id ? Theme.brand : Theme.textMuted)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.pressable)
    }

    private func start() async {
        guard let tariff else { return }
        isSaving = true
        error = nil
        defer { isSaving = false }

        let failure = await arena.start(
            stationID: station.id,
            tariffID: tariff.id,
            payment: payment,
            cash: Double(cash) ?? 0,
            kaspi: Double(kaspi) ?? 0,
            discountPercent: discount
        )

        if let failure {
            error = failure
            Haptics.error()
        } else {
            Haptics.success()
            dismiss()
        }
    }
}

/// Открытая сессия: сколько осталось, что можно сделать.
struct ArenaSessionSheet: View {
    let station: ArenaStation

    @Environment(\.dismiss) private var dismiss
    @Environment(ArenaStore.self) private var arena
    @Environment(OperatorStore.self) private var shiftStore

    @State private var extending = false
    @State private var confirmingEnd = false
    @State private var confirmingRefund = false
    @State private var isSaving = false
    @State private var error: String?

    private var session: ArenaSession? {
        arena.hall?.session(stationID: station.id)
    }

    var body: some View {
        NavigationStack {
            ScreenScroll {
                if let session {
                    Card(accent: session.isExpired(now: arena.now) ? Theme.negative : nil) {
                        VStack(alignment: .leading, spacing: Spacing.sm) {
                            Text(station.name)
                                .font(Typography.title)
                                .foregroundStyle(Theme.text)

                            Text(ArenaScreen.countdownText(session.remaining(now: arena.now)))
                                .font(Typography.metric.monospacedDigit())
                                .foregroundStyle(
                                    session.isExpired(now: arena.now) ? Theme.negative : Theme.text
                                )

                            Text(session.isExpired(now: arena.now) ? "время вышло" : "осталось")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textMuted)
                        }
                    }

                    Card {
                        VStack(spacing: Spacing.sm) {
                            if let started = session.startedAt {
                                StatRow("Начало", value: timeText(started), icon: "play.circle")
                                RowDivider()
                            }
                            if let ends = session.endsAt {
                                StatRow("Конец", value: timeText(ends), icon: "stop.circle")
                                RowDivider()
                            }
                            StatRow("Оплачено", value: Money.format(session.amount), icon: "banknote")
                            if session.cashAmount > 0, session.kaspiAmount > 0 {
                                RowDivider()
                                StatRow(
                                    "Чем",
                                    value: "нал \(Money.format(session.cashAmount)) · Kaspi \(Money.format(session.kaspiAmount))",
                                    icon: "creditcard"
                                )
                            }
                        }
                    }

                    if let error {
                        Text(error)
                            .font(Typography.callout)
                            .foregroundStyle(Theme.negative)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    // Продление, завершение и возврат двигают деньги смены —
                    // значит требуют своей открытой смены. Сессию при этом
                    // видно всегда: посмотреть остаток может любой.
                    if !canSell {
                        Card(accent: Theme.warning) {
                            Text(shiftStore.isSomeoneElsesShift
                                ? "Смену на точке ведёт другой оператор — продлевает и закрывает он."
                                : "Смена не открыта: продлить и завершить нельзя, деньги некуда записать.")
                                .font(Typography.callout)
                                .foregroundStyle(Theme.textMuted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }

                    Button { extending = true } label: {
                        Label("Продлить", systemImage: "plus.circle")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(isSaving || !canSell)

                    Button { confirmingEnd = true } label: {
                        Label("Завершить", systemImage: "stop.circle")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(isSaving || !canSell)

                    // Возврат отдельной кнопкой и с подтверждением: он списывает
                    // деньги из кассы, и промахнуться по нему вместо «завершить»
                    // никто не должен.
                    if !session.isExpired(now: arena.now) {
                        Button { confirmingRefund = true } label: {
                            Label("Завершить с возвратом", systemImage: "arrow.uturn.backward")
                        }
                        .buttonStyle(SecondaryButtonStyle())
                        .disabled(isSaving || !canSell)
                    }
                } else {
                    Card {
                        Text("Сессия уже закрыта.")
                            .font(Typography.callout)
                            .foregroundStyle(Theme.textMuted)
                    }
                }
            }
            .background(Theme.background)
            .navigationTitle("Сессия")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Готово") { dismiss() }
                }
            }
            .sheet(isPresented: $extending) {
                if let session {
                    ArenaExtendSheet(station: station, session: session)
                }
            }
            .alert("Завершить сессию?", isPresented: $confirmingEnd) {
                Button("Завершить", role: .destructive) { Task { await end(refund: false) } }
                Button("Отмена", role: .cancel) {}
            } message: {
                Text("Станция освободится. Деньги за оплаченное время останутся в кассе.")
            }
            .alert("Вернуть за неиспользованное?", isPresented: $confirmingRefund) {
                Button("Вернуть", role: .destructive) { Task { await end(refund: true) } }
                Button("Отмена", role: .cancel) {}
            } message: {
                Text("Сервер посчитает долю неотсиженного времени и вычтет её из кассы.")
            }
        }
    }

    private var canSell: Bool { shiftStore.isMyShift }

    private func timeText(_ date: Date) -> String {
        date.formatted(date: .omitted, time: .shortened)
    }

    private func end(refund: Bool) async {
        guard let session else { return }
        isSaving = true
        error = nil
        defer { isSaving = false }

        let failure = refund
            ? await arena.refund(sessionID: session.id)
            : await arena.end(sessionID: session.id)

        if let failure {
            error = failure
            Haptics.error()
        } else {
            Haptics.success()
            dismiss()
        }
    }
}

/// Продление: пакетом тарифа или на сумму.
///
/// «Добавь на тысячу» — самая частая просьба в зале, и считать минуты в уме
/// оператор не должен: сумму делит на минуты сервер по цене часа.
struct ArenaExtendSheet: View {
    let station: ArenaStation
    let session: ArenaSession

    @Environment(\.dismiss) private var dismiss
    @Environment(ArenaStore.self) private var arena

    @State private var mode = "tariff"
    @State private var tariffID: String?
    @State private var payment: ArenaPayment = .cash
    @State private var cash = ""
    @State private var kaspi = ""
    @State private var amount = ""
    @State private var isSaving = false
    @State private var error: String?

    private var tariffs: [ArenaTariff] {
        arena.hall?.tariffs(for: station) ?? []
    }

    private var tariff: ArenaTariff? { tariffs.first { $0.id == tariffID } }

    private var total: Double {
        mode == "tariff" ? (tariff?.price ?? 0) : (Double(amount) ?? 0)
    }

    private var canSubmit: Bool {
        if isSaving { return false }
        if mode == "tariff" { return tariff != nil }
        return (Double(amount) ?? 0) > 0
    }

    var body: some View {
        NavigationStack {
            ScreenScroll {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        FieldLabel("Как продлеваем")
                        Picker("", selection: $mode) {
                            Text("Пакетом").tag("tariff")
                            Text("На сумму").tag("amount")
                        }
                        .pickerStyle(.segmented)
                        .labelsHidden()

                        Text(
                            mode == "tariff"
                                ? "Добавит время пакета к текущему окончанию."
                                : "Минуты сервер посчитает сам по цене часа этой зоны."
                        )
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                    }
                }

                if mode == "tariff" {
                    Card {
                        VStack(alignment: .leading, spacing: Spacing.sm) {
                            FieldLabel("Пакет")
                            ForEach(Array(tariffs.enumerated()), id: \.element.id) { index, item in
                                if index > 0 { RowDivider() }
                                Button { tariffID = item.id } label: {
                                    HStack {
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(item.name)
                                                .font(Typography.body)
                                                .foregroundStyle(Theme.text)
                                            Text(item.durationLabel)
                                                .font(Typography.caption)
                                                .foregroundStyle(Theme.textMuted)
                                        }
                                        Spacer()
                                        Text(Money.format(item.price))
                                            .font(Typography.body.weight(.medium))
                                            .foregroundStyle(Theme.textDim)
                                        Image(systemName: tariffID == item.id ? "checkmark.circle.fill" : "circle")
                                            .foregroundStyle(tariffID == item.id ? Theme.brand : Theme.textMuted)
                                    }
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.pressable)
                            }
                        }
                    }
                } else {
                    Card {
                        VStack(alignment: .leading, spacing: Spacing.sm) {
                            FieldLabel("Сумма")
                            TextField("0", text: $amount)
                                #if os(iOS)
                                .keyboardType(.numberPad)
                                #endif
                                .font(Typography.metric)
                                .foregroundStyle(Theme.text)
                        }
                    }
                }

                ArenaPaymentCard(payment: $payment, cash: $cash, kaspi: $kaspi, total: total)

                if let error {
                    Text(error)
                        .font(Typography.callout)
                        .foregroundStyle(Theme.negative)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Button {
                    Task { await submit() }
                } label: {
                    if isSaving {
                        ProgressView().controlSize(.small)
                    } else {
                        Text(total > 0 ? "Продлить · \(Money.format(total))" : "Продлить")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!canSubmit)
            }
            .background(Theme.background)
            .navigationTitle("Продление")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
            }
            .onAppear { if tariffID == nil { tariffID = tariffs.first?.id } }
        }
    }

    private func submit() async {
        isSaving = true
        error = nil
        defer { isSaving = false }

        // Продление на сумму: сервер делит именно оплаченное, поэтому при
        // наличных и Kaspi отправляем сумму в нужное поле сами.
        let failure: String?
        if mode == "tariff", let tariff {
            failure = await arena.extend(
                sessionID: session.id,
                tariffID: tariff.id,
                payment: payment,
                cash: Double(cash) ?? 0,
                kaspi: Double(kaspi) ?? 0
            )
        } else {
            let value = Double(amount) ?? 0
            failure = await arena.extendByAmount(
                sessionID: session.id,
                payment: payment,
                cash: payment == .kaspi ? 0 : (payment == .cash ? value : Double(cash) ?? 0),
                kaspi: payment == .cash ? 0 : (payment == .kaspi ? value : Double(kaspi) ?? 0)
            )
        }

        if let failure {
            error = failure
            Haptics.error()
        } else {
            Haptics.success()
            dismiss()
        }
    }
}

/// Техническая заметка по станции.
///
/// Мышь, наушники, сгоревший монитор — это расход и повод не сажать сюда
/// гостя. Раньше о таком узнавали в чате, и до отчёта оно не доходило.
struct ArenaTechSheet: View {
    let stations: [ArenaStation]

    @Environment(\.dismiss) private var dismiss
    @Environment(ArenaStore.self) private var arena

    @State private var stationID: String?
    @State private var reason = ""
    @State private var amount = ""
    @State private var isSaving = false
    @State private var error: String?

    private let presets = ["Не работает мышь", "Не работает клавиатура", "Нет звука", "Не включается"]

    private var canSubmit: Bool {
        reason.trimmingCharacters(in: .whitespaces).count >= 3 && !isSaving
    }

    var body: some View {
        NavigationStack {
            ScreenScroll {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        FieldLabel("Станция")
                        Picker("Станция", selection: $stationID) {
                            Text("Не про станцию").tag(String?.none)
                            ForEach(stations) { station in
                                Text(station.name).tag(String?.some(station.id))
                            }
                        }
                        .pickerStyle(.menu)
                        .tint(Theme.brand)
                    }
                }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        FieldLabel("Что случилось")

                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: Spacing.xs) {
                                ForEach(presets, id: \.self) { preset in
                                    Button { reason = preset } label: {
                                        Text(preset)
                                            .font(Typography.caption.weight(.medium))
                                            .padding(.horizontal, Spacing.md)
                                            .padding(.vertical, Spacing.xs)
                                            .background(
                                                reason == preset ? Theme.brand.opacity(0.16) : Theme.surfaceRaised,
                                                in: Capsule()
                                            )
                                            .foregroundStyle(reason == preset ? Theme.brand : Theme.textDim)
                                    }
                                    .buttonStyle(.pressable)
                                }
                            }
                            .padding(.horizontal, 2)
                        }

                        TextField("Опишите", text: $reason, axis: .vertical)
                            .textFieldStyle(.plain)
                            .lineLimit(2...4)
                            .padding(Spacing.md)
                            .background(
                                Theme.surfaceRaised,
                                in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
                            )
                    }
                }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        FieldLabel("Расход, если был")
                        TextField("0", text: $amount)
                            #if os(iOS)
                            .keyboardType(.numberPad)
                            #endif
                            .font(Typography.title)
                            .foregroundStyle(Theme.text)
                    }
                }

                if let error {
                    Text(error)
                        .font(Typography.callout)
                        .foregroundStyle(Theme.negative)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Button {
                    Task { await submit() }
                } label: {
                    if isSaving {
                        ProgressView().controlSize(.small)
                    } else {
                        Text("Записать")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!canSubmit)
            }
            .background(Theme.background)
            .navigationTitle("Техпроблема")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
            }
        }
    }

    private func submit() async {
        isSaving = true
        error = nil
        defer { isSaving = false }

        let station = stations.first { $0.id == stationID }
        let failure = await arena.logTech(
            station: station,
            reason: reason.trimmingCharacters(in: .whitespaces),
            amount: Double(amount) ?? 0
        )

        if let failure {
            error = failure
            Haptics.error()
        } else {
            Haptics.success()
            dismiss()
        }
    }
}

/// Способ оплаты и — только для смешанной — разбивка сумм.
///
/// При наличных и Kaspi суммы не спрашиваем вовсе: их считает сервер по цене
/// тарифа, и лишнее поле здесь означало бы возможность разойтись с прайсом.
struct ArenaPaymentCard: View {
    @Binding var payment: ArenaPayment
    @Binding var cash: String
    @Binding var kaspi: String
    let total: Double

    private var split: Double { (Double(cash) ?? 0) + (Double(kaspi) ?? 0) }

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                FieldLabel("Оплата")

                Picker("", selection: $payment) {
                    ForEach(ArenaPayment.allCases, id: \.self) { method in
                        Text(method.title).tag(method)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()

                if payment == .mixed {
                    HStack(spacing: Spacing.md) {
                        VStack(alignment: .leading, spacing: Spacing.xxs) {
                            Text("Наличные")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textMuted)
                            TextField("0", text: $cash)
                                #if os(iOS)
                                .keyboardType(.numberPad)
                                #endif
                                .font(Typography.title)
                                .foregroundStyle(Theme.text)
                        }
                        VStack(alignment: .leading, spacing: Spacing.xxs) {
                            Text("Kaspi")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textMuted)
                            TextField("0", text: $kaspi)
                                #if os(iOS)
                                .keyboardType(.numberPad)
                                #endif
                                .font(Typography.title)
                                .foregroundStyle(Theme.text)
                        }
                    }

                    if total > 0 {
                        Text(
                            split == total
                                ? "Сходится: \(Money.format(split))"
                                : "Введено \(Money.format(split)) из \(Money.format(total))"
                        )
                        .font(Typography.caption)
                        .foregroundStyle(split == total ? Theme.positive : Theme.warning)
                    }
                } else if total > 0 {
                    Text("К оплате \(Money.format(total)) — сумму запишет сервер по цене тарифа.")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
}

/// Что было в зале сегодня: оплаты и поломки.
///
/// Смена начинается не с чистого листа: до тебя кто-то сидел, кто-то платил,
/// какую-то станцию чинили. Раньше это знал только тот, кто стоял утром, —
/// сервер отдавал и то, и другое, а приложение не показывало.
struct ArenaHistorySheet: View {
    let hall: ArenaHall

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScreenScroll {
                Card {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Касса зала за сегодня")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textMuted)
                            Text(Money.format(hall.todayTotal))
                                .font(Typography.metric)
                                .foregroundStyle(Theme.text)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            Text("нал \(Money.format(hall.todayCash))")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textDim)
                            Text("Kaspi \(Money.format(hall.todayKaspi))")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textDim)
                        }
                    }
                }

                if hall.todayRows.isEmpty {
                    Card {
                        Text("Оплат сегодня ещё не было.")
                            .font(Typography.callout)
                            .foregroundStyle(Theme.textMuted)
                    }
                } else {
                    SectionHeader("Оплаты", subtitle: "\(hall.todayRows.count)")
                    Card {
                        VStack(spacing: Spacing.sm) {
                            // Свежие сверху: спрашивают почти всегда про
                            // последние — «кто только что сел за 705».
                            ForEach(Array(sortedRows.enumerated()), id: \.element.id) { index, row in
                                if index > 0 { RowDivider() }
                                HStack(alignment: .firstTextBaseline) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(row.comment)
                                            .font(Typography.callout)
                                            .foregroundStyle(Theme.text)
                                            .fixedSize(horizontal: false, vertical: true)
                                        if let at = row.at {
                                            Text(at.formatted(date: .omitted, time: .shortened))
                                                .font(Typography.caption)
                                                .foregroundStyle(Theme.textDim)
                                        }
                                    }
                                    Spacer(minLength: Spacing.sm)
                                    VStack(alignment: .trailing, spacing: 2) {
                                        Text(Money.format(row.total))
                                            .font(Typography.callout.weight(.medium))
                                            .monospacedDigit()
                                            .foregroundStyle(Theme.text)
                                        // Чем платили — видно только когда
                                        // делили: иначе строка шумит.
                                        if row.cash > 0, row.kaspi > 0 {
                                            Text("нал \(Money.format(row.cash)) · Kaspi \(Money.format(row.kaspi))")
                                                .font(Typography.caption)
                                                .foregroundStyle(Theme.textDim)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                if !hall.techLogs.isEmpty {
                    SectionHeader("Поломки", subtitle: "\(hall.techLogs.count)")
                    Card(accent: Theme.warning) {
                        VStack(spacing: Spacing.sm) {
                            ForEach(Array(hall.techLogs.enumerated()), id: \.element.id) { index, log in
                                if index > 0 { RowDivider() }
                                HStack(alignment: .firstTextBaseline) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(log.reason)
                                            .font(Typography.callout)
                                            .foregroundStyle(Theme.text)
                                            .fixedSize(horizontal: false, vertical: true)
                                        Text([log.stationName, log.at.map { $0.formatted(date: .omitted, time: .shortened) }]
                                            .compactMap { $0 }
                                            .joined(separator: " · "))
                                            .font(Typography.caption)
                                            .foregroundStyle(Theme.textDim)
                                    }
                                    Spacer(minLength: Spacing.sm)
                                    if log.amount > 0 {
                                        Text(Money.format(log.amount))
                                            .font(Typography.callout.weight(.medium))
                                            .monospacedDigit()
                                            .foregroundStyle(Theme.warning)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .background(Theme.background)
            .navigationTitle("Сегодня в зале")
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

    private var sortedRows: [ArenaIncomeRow] {
        hall.todayRows.sorted { ($0.at ?? .distantPast) > ($1.at ?? .distantPast) }
    }
}
