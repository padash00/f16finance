import OrdaKit
import OrdaUI
import SwiftUI

/// Редактор модели точки: тарифы и зоны.
///
/// Экран симуляции до этого сообщал: «зоны и тарифы задают на сайте». Вопрос,
/// ради которого симуляцию открывают, — «а если поднять цену часа» или «а если
/// поставить ещё десять машин» — требовал ноутбука.
///
/// Пересчёт после сохранения делает сервер. Повторить формулу на Swift было бы
/// быстрее на глаз, но тогда потенциал считался бы дважды разными руками — а
/// на нём стоит весь разговор с инвестором.
struct SimulationEditorSheet: View {
    let companyID: String
    let companyName: String
    let initialZones: [SimulationZoneConfig]
    let initialTariffs: [SimulationTariffConfig]
    /// Вызывается после успешного сохранения — экран перечитывает расчёт.
    let onSaved: () -> Void

    @Environment(\.api) private var api
    @Environment(\.dismiss) private var dismiss

    @State private var zones: [SimulationZoneConfig] = []
    @State private var tariffs: [SimulationTariffConfig] = []
    @State private var isSaving = false
    @State private var saveError: String?
    @State private var didPrepare = false

    var body: some View {
        NavigationStack {
            ScreenScroll {
                VStack(spacing: Spacing.lg) {
                    tariffsCard
                    zonesCard
                    footer
                }
            }
            .background(Theme.background)
            .navigationTitle("Модель точки")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
            }
            .task {
                guard !didPrepare else { return }
                didPrepare = true
                zones = initialZones
                tariffs = initialTariffs
            }
        }
    }

    // ── Тарифы ───────────────────────────────────────────────────────────────

    private var tariffsCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Тарифы", subtitle: companyName)
                Text("Пакет часов и его цена. Бонусные часы входят в знаменатель — «3+2 за 3600 ₸» дешевле в час, чем «3 за 3600 ₸».")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)

                if tariffs.isEmpty {
                    InlineEmpty(
                        icon: "tag",
                        text: "Тарифов нет. Без них зоны считать не из чего.",
                        tint: Theme.warning
                    )
                }

                ForEach($tariffs) { $tariff in
                    TariffEditor(tariff: $tariff) { remove(tariffID: tariff.id) }
                    RowDivider()
                }

                Button {
                    tariffs.append(SimulationTariffConfig(sortOrder: tariffs.count))
                    Haptics.tap()
                } label: {
                    Label("Добавить тариф", systemImage: "plus")
                }
                .buttonStyle(SecondaryButtonStyle())
            }
        }
    }

    /// Удаление тарифа снимает и его доли во всех зонах: иначе доля осталась бы
    /// висеть на несуществующем тарифе, и сервер молча выбросил бы её при
    /// сохранении — вместе с процентами, которые владелец считал учтёнными.
    private func remove(tariffID: String) {
        tariffs.removeAll { $0.id == tariffID }
        for index in zones.indices {
            zones[index].tariffMix.removeAll { $0.tariffID == tariffID }
        }
    }

    // ── Зоны ─────────────────────────────────────────────────────────────────

    private var zonesCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Зоны")
                Text("Сколько устройств и сколько часов в сутки они заняты. Доли тарифов показывают, по каким пакетам играют, и должны давать 100 %.")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)

                if zones.isEmpty {
                    InlineEmpty(
                        icon: "square.grid.2x2",
                        text: "Зон нет. Потенциал будет нулевым.",
                        tint: Theme.warning
                    )
                }

                ForEach($zones) { $zone in
                    ZoneEditor(
                        zone: $zone,
                        tariffs: tariffs,
                        onDelete: { zones.removeAll { $0.id == zone.id } }
                    )
                    RowDivider()
                }

                Button {
                    zones.append(SimulationZoneConfig(sortOrder: zones.count))
                    Haptics.tap()
                } label: {
                    Label("Добавить зону", systemImage: "plus")
                }
                .buttonStyle(SecondaryButtonStyle())
            }
        }
    }

    // ── Сохранение ───────────────────────────────────────────────────────────

    @ViewBuilder
    private var footer: some View {
        let blocker = SimulationConfigCheck.blocker(zones: zones, tariffs: tariffs)
        let warnings = SimulationConfigCheck.warnings(zones: zones, tariffs: tariffs)

        if !warnings.isEmpty {
            Card(accent: Theme.warning) {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    // Предупреждения не мешают сохранить: небрежный конфиг —
                    // это осознанная прикидка не реже, чем ошибка.
                    ForEach(warnings, id: \.self) { warning in
                        Text(warning)
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textMuted)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }

        if let blocker {
            Text(blocker)
                .font(Typography.callout)
                .foregroundStyle(Theme.warning)
                .frame(maxWidth: .infinity, alignment: .leading)
        }

        if let saveError {
            Text(saveError)
                .font(Typography.callout)
                .foregroundStyle(Theme.negative)
                .frame(maxWidth: .infinity, alignment: .leading)
        }

        Button(isSaving ? "Сохраняем…" : "Сохранить модель") {
            Task { await save() }
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(isSaving || blocker != nil)

        Text("Потенциал пересчитает сервер — той же формулой, что и на сайте.")
            .font(Typography.caption)
            .foregroundStyle(Theme.textDim)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func save() async {
        guard !isSaving else { return }
        isSaving = true
        defer { isSaving = false }
        saveError = nil

        // Порядок в списке — это и есть порядок на сервере: без пересчёта
        // sort_order строки после сохранения переставились бы.
        let orderedTariffs = tariffs.enumerated().map { index, tariff -> SimulationTariffConfig in
            var copy = tariff
            copy.sortOrder = index
            if copy.name.trimmingCharacters(in: .whitespaces).isEmpty { copy.name = "Тариф" }
            return copy
        }
        let orderedZones = zones.enumerated().map { index, zone -> SimulationZoneConfig in
            var copy = zone
            copy.sortOrder = index
            if copy.name.trimmingCharacters(in: .whitespaces).isEmpty { copy.name = "Зона" }
            return copy
        }

        do {
            try await SimulationService(api: api).save(
                companyID: companyID,
                zones: orderedZones,
                tariffs: orderedTariffs
            )
            Haptics.success()
            onSaved()
            dismiss()
        } catch let error as APIError {
            saveError = error.userMessage
        } catch {
            saveError = error.localizedDescription
        }
    }
}

// ── Строка тарифа ────────────────────────────────────────────────────────────

private struct TariffEditor: View {
    @Binding var tariff: SimulationTariffConfig
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack {
                TextField("Название, например 3+2", text: $tariff.name)
                    .textFieldStyle(.plain)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)

                Button(role: .destructive, action: onDelete) {
                    Image(systemName: "trash")
                }
                .buttonStyle(.pressable)
                .foregroundStyle(Theme.negative)
            }

            NumberField(title: "Оплачено часов", value: $tariff.paidHours)
            NumberField(title: "Бонусных часов", value: $tariff.bonusHours)
            NumberField(title: "Цена пакета, ₸", value: $tariff.price)

            HStack {
                Text("Час по этому тарифу")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
                Spacer()
                Text(Money.format(tariff.ratePerHour))
                    .font(Typography.caption.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(Theme.textMuted)
            }
        }
    }
}

// ── Строка зоны ──────────────────────────────────────────────────────────────

private struct ZoneEditor: View {
    @Binding var zone: SimulationZoneConfig
    let tariffs: [SimulationTariffConfig]
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack {
                TextField("Название зоны", text: $zone.name)
                    .textFieldStyle(.plain)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)

                Button(role: .destructive, action: onDelete) {
                    Image(systemName: "trash")
                }
                .buttonStyle(.pressable)
                .foregroundStyle(Theme.negative)
            }

            FieldLabel("Тип устройств")
            Picker("Тип", selection: $zone.deviceType) {
                Text("ПК").tag("pc")
                Text("PlayStation").tag("ps")
                Text("Sim Racing").tag("sim_racing")
                Text("VR").tag("vr")
            }
            .pickerStyle(.menu)

            IntField(title: "Устройств", value: $zone.deviceCount)
            NumberField(title: "Загрузка, часов в сутки", value: $zone.assumedOccupancyHours)

            if tariffs.isEmpty {
                Text("Сначала заведите тарифы — их доли задаются здесь.")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
            } else {
                FieldLabel("Доли тарифов, %")
                ForEach(tariffs) { tariff in
                    NumberField(
                        title: tariff.name.isEmpty ? "Без названия" : tariff.name,
                        value: share(for: tariff.id)
                    )
                }

                HStack {
                    Text("Сумма долей")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                    Spacer()
                    Text("\(Int(zone.shareSum.rounded())) %")
                        .font(Typography.caption.weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(abs(zone.shareSum - 100) > 1 ? Theme.warning : Theme.positive)
                }
            }
        }
    }

    /// Доля тарифа в зоне. Ноль означает «не играют по этому пакету», поэтому
    /// запись из микса при обнулении убираем — пустая доля и её отсутствие
    /// должны выглядеть одинаково.
    private func share(for tariffID: String) -> Binding<Double> {
        Binding(
            get: { zone.tariffMix.first { $0.tariffID == tariffID }?.sharePct ?? 0 },
            set: { newValue in
                if let index = zone.tariffMix.firstIndex(where: { $0.tariffID == tariffID }) {
                    if newValue <= 0 {
                        zone.tariffMix.remove(at: index)
                    } else {
                        zone.tariffMix[index].sharePct = newValue
                    }
                } else if newValue > 0 {
                    zone.tariffMix.append(SimulationMixEntry(tariffID: tariffID, sharePct: newValue))
                }
            }
        )
    }
}

// ── Числовые поля ────────────────────────────────────────────────────────────

/// Поле дробного числа поверх строки. Держать текст, а не `Double`, обязательно:
/// иначе на каждом нажатии клавиши значение форматируется обратно, и набрать
/// «1,5» невозможно — запятая исчезает раньше, чем появится цифра после неё.
struct NumberField: View {
    let title: String
    @Binding var value: Double

    @State private var text = ""
    @State private var didLoad = false

    var body: some View {
        MoneyField(title: title, text: Binding(
            get: { text },
            set: {
                text = $0
                value = AmountParsing.value($0)
            }
        ))
        .onAppear {
            guard !didLoad else { return }
            didLoad = true
            text = value == 0 ? "" : Quantity.format(value)
        }
    }
}

struct IntField: View {
    let title: String
    @Binding var value: Int

    @State private var text = ""
    @State private var didLoad = false

    var body: some View {
        MoneyField(title: title, text: Binding(
            get: { text },
            set: {
                text = $0
                value = Int(AmountParsing.value($0).rounded())
            }
        ))
        .onAppear {
            guard !didLoad else { return }
            didLoad = true
            text = value == 0 ? "" : String(value)
        }
    }
}
