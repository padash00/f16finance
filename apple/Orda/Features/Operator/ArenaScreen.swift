import OrdaKit
import OrdaUI
import SwiftUI

/// Зал клуба: кто где сидит и сколько кому осталось.
///
/// Оператор клуба не стоит за прилавком — он ходит по залу. Раньше зал жил
/// только в программе за стойкой: отошёл к гостю — перестал видеть, у кого
/// заканчивается время. Здесь тот же зал в кармане, с теми же действиями.
///
/// Первое, что должно бросаться в глаза, — не выручка, а станции, где время
/// на исходе: именно к ним нужно подойти и спросить, продлевают ли.
struct ArenaScreen: View {
    @Environment(ArenaStore.self) private var arena
    @Environment(OperatorStore.self) private var shiftStore
    @Environment(\.surface) private var surface

    @State private var starting: ArenaStation?
    @State private var opened: ArenaStation?
    @State private var techLogging = false

    /// Обратный отсчёт идёт каждую секунду, а к серверу ходим раз в полминуты:
    /// станции меняются не так часто, а трафик у людей свой.
    private let clock = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    private var hall: ArenaHall? { arena.hall }

    var body: some View {
        ScreenScroll {
            if !arena.isAvailable {
                Card {
                    Text("У этой точки нет зала. Раздел нужен клубам — там, где гости садятся за станции.")
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } else if let hall, hall.stations.isEmpty {
                // Проект точки есть, а станций в нём нет: зал заводят в
                // веб-разделе «Зал», и пустая сетка без объяснения выглядела
                // бы поломкой.
                Card {
                    Text("Зал пока пустой: станции и тарифы заводит владелец в разделе «Зал».")
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } else if let hall {
                shiftWarning
                summaryCard(hall)

                let soon = endingSoon(hall)
                if !soon.isEmpty { attentionCard(soon, hall: hall) }

                ForEach(zoneGroups(hall)) { group in
                    SectionHeader(group.title)
                    stationGrid(group.stations, hall: hall)
                }

                techButton
            } else if arena.isLoading {
                LoadingRows(count: 4)
            } else if let error = arena.error {
                Card(accent: Theme.negative) {
                    Text(error)
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .background(Theme.background)
        .navigationTitle("Зал")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.large)
        #endif
        .toolbar { LogoutToolbarItem() }
        .refreshable { await arena.load() }
        .task { await arena.load() }
        .onReceive(clock) { _ in arena.tick() }
        .sheet(item: $starting) { station in
            ArenaStartSheet(station: station)
        }
        .sheet(item: $opened) { station in
            ArenaSessionSheet(station: station)
        }
        .sheet(isPresented: $techLogging) {
            ArenaTechSheet(stations: hall?.stations ?? [])
        }
    }

    // ── Сводка ───────────────────────────────────────────────────────────────

    private func summaryCard(_ hall: ArenaHall) -> some View {
        Card {
            HStack(spacing: Spacing.lg) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(hall.busyCount) из \(hall.stations.count)")
                        .font(Typography.metric)
                        .foregroundStyle(Theme.text)
                    Text("станций занято")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textMuted)
                }

                Spacer()

                VStack(alignment: .trailing, spacing: 2) {
                    Text(Money.format(hall.todayTotal))
                        .font(Typography.title)
                        .foregroundStyle(Theme.text)
                    Text("нал \(Money.format(hall.todayCash)) · Kaspi \(Money.format(hall.todayKaspi))")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textMuted)
                }
            }
        }
    }

    /// Кому пора продлевать — и кто уже сидит сверх оплаченного.
    private func attentionCard(_ stations: [ArenaStation], hall: ArenaHall) -> some View {
        Card(accent: Theme.warning) {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Text("Подойти сейчас")
                    .font(Typography.body.weight(.medium))
                    .foregroundStyle(Theme.text)

                ForEach(stations) { station in
                    if let session = hall.session(stationID: station.id) {
                        Button { opened = station } label: {
                            HStack {
                                Text(station.name)
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.text)
                                Spacer()
                                Text(countdown(session))
                                    .font(Typography.callout.weight(.medium).monospacedDigit())
                                    .foregroundStyle(
                                        session.isExpired(now: arena.now) ? Theme.negative : Theme.warning
                                    )
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.pressable)
                    }
                }
            }
        }
    }

    // ── Станции ──────────────────────────────────────────────────────────────

    private func stationGrid(_ stations: [ArenaStation], hall: ArenaHall) -> some View {
        LazyVGrid(
            columns: Array(
                repeating: GridItem(.flexible(), spacing: Spacing.sm),
                count: surface == .handheld ? 2 : 4
            ),
            spacing: Spacing.sm
        ) {
            ForEach(stations) { station in
                let session = hall.session(stationID: station.id)
                Button {
                    // Открытая сессия — смотреть можно всегда: посмотреть, у
                    // кого сколько осталось, не значит тронуть деньги.
                    if session != nil { opened = station } else if canSell { starting = station }
                } label: {
                    stationTile(station, session: session)
                }
                .buttonStyle(.pressable)
            }
        }
    }

    private func stationTile(_ station: ArenaStation, session: ArenaSession?) -> some View {
        let expired = session?.isExpired(now: arena.now) ?? false
        let soon = session?.isEndingSoon(now: arena.now) ?? false
        let tint: Color = expired ? Theme.negative : (soon ? Theme.warning : (session != nil ? Theme.positive : Theme.textMuted))

        return VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack {
                Text(station.name)
                    .font(Typography.body.weight(.medium))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Spacer()
                Circle().fill(tint).frame(width: 8, height: 8)
            }

            if let session {
                Text(countdown(session))
                    .font(Typography.title.monospacedDigit())
                    .foregroundStyle(tint)
                Text(expired ? "время вышло" : "осталось")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textMuted)
            } else {
                Text("свободна")
                    .font(Typography.callout)
                    .foregroundStyle(Theme.textMuted)
                Text("нажмите, чтобы посадить")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textMuted)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Spacing.md)
        .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
                .stroke(session == nil ? Color.clear : tint.opacity(0.35), lineWidth: 1)
        )
    }

    /// Смена не открыта — сажать гостей нельзя.
    ///
    /// Сессия попадает в кассу дня и в отчёт смены. Гость, посаженный вне
    /// смены, — это выручка, которой не в чем сойтись: смену потом закрывают с
    /// недостачей. Сервер такое отклоняет, и предлагать это в приложении
    /// значит обещать то, чего не будет.
    @ViewBuilder
    private var shiftWarning: some View {
        if !canSell {
            Card(accent: Theme.warning) {
                VStack(alignment: .leading, spacing: Spacing.xxs) {
                    Text(shiftStore.isSomeoneElsesShift ? "На точке смена другого оператора" : "Смена не открыта")
                        .font(Typography.body.weight(.medium))
                        .foregroundStyle(Theme.text)
                    Text(
                        shiftStore.isSomeoneElsesShift
                            ? "Зал ведёт тот, кто открыл смену: выручка попадёт в его кассу."
                            : "Зал виден, но посадить гостя нельзя — выручка не попадёт в кассу. Откройте смену на экране «Смена»."
                    )
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    /// Можно ли трогать деньги зала: смена открыта и она своя.
    private var canSell: Bool { shiftStore.isMyShift }

    private var techButton: some View {
        Button {
            techLogging = true
        } label: {
            Label("Записать техпроблему", systemImage: "wrench.and.screwdriver")
        }
        .buttonStyle(SecondaryButtonStyle())
    }

    // ── Мелочи ───────────────────────────────────────────────────────────────

    /// Станции с истекающим и уже вышедшим временем — по возрастанию остатка.
    private func endingSoon(_ hall: ArenaHall) -> [ArenaStation] {
        hall.stations
            .compactMap { station -> (ArenaStation, TimeInterval)? in
                guard let session = hall.session(stationID: station.id) else { return nil }
                let left = session.remaining(now: arena.now)
                guard left <= 10 * 60 else { return nil }
                return (station, left)
            }
            .sorted { $0.1 < $1.1 }
            .map(\.0)
    }

    /// Зоны с их станциями; станции без зоны — отдельной группой в конце,
    /// потерять их нельзя.
    private func zoneGroups(_ hall: ArenaHall) -> [HallGroup] {
        var groups = hall.zones.map { zone in
            HallGroup(id: zone.id, title: zone.name, stations: hall.stations(zoneID: zone.id))
        }
        let unzoned = hall.stations(zoneID: nil)
        if !unzoned.isEmpty {
            groups.append(HallGroup(id: "unzoned", title: "Без зоны", stations: unzoned))
        }
        return groups.filter { !$0.stations.isEmpty }
    }

    private struct HallGroup: Identifiable {
        let id: String
        let title: String
        let stations: [ArenaStation]
    }

    /// «1:24» — часы и минуты, «-12 мин» — сверх оплаченного.
    private func countdown(_ session: ArenaSession) -> String {
        ArenaScreen.countdownText(session.remaining(now: arena.now))
    }

    static func countdownText(_ interval: TimeInterval) -> String {
        let overdue = interval < 0
        let total = Int(abs(interval))
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let seconds = total % 60

        let body: String
        if hours > 0 {
            body = String(format: "%d:%02d", hours, minutes)
        } else if total >= 60 {
            body = "\(minutes) мин"
        } else {
            body = "\(seconds) сек"
        }
        return overdue ? "−\(body)" : body
    }
}
