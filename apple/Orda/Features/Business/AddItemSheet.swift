import OrdaKit
import OrdaUI
import SwiftUI

/// Завести товар или расходник в каталоге.
///
/// Товар заводят у коробки: приехало новое, а в каталоге его нет — и приёмку
/// не оформить, потому что позицию не с чем сопоставить. До сих пор это
/// означало «отложить приёмку до вечера».
///
/// Расходник отличается только видом: он не продаётся, а списывается —
/// перчатки, пакеты, чековая лента. Цену продажи у него не спрашиваем.
struct AddItemSheet: View {
    /// Что заводим. Расходник — отдельный экран каталога, поэтому вид задаёт
    /// вызывающий, а не переключатель внутри.
    let isConsumable: Bool
    var onDone: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.api) private var api

    @State private var name = ""
    @State private var barcode = ""
    @State private var unit = "шт"
    @State private var salePriceText = ""
    @State private var purchasePriceText = ""
    @State private var requiresExpiry = true
    @State private var isSaving = false
    @State private var error: String?
    @State private var scanning = false

    private let units = ["шт", "кг", "л", "уп", "м"]

    private var canSubmit: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty
            && !barcode.trimmingCharacters(in: .whitespaces).isEmpty
            && !isSaving
    }

    var body: some View {
        NavigationStack {
            ScreenScroll {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        FieldLabel("Название")
                        TextField(isConsumable ? "Пакеты 30×40" : "Coca-Cola 0.5", text: $name)
                            .textFieldStyle(.plain)
                            .padding(Spacing.md)
                            .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
                    }
                }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        FieldLabel("Штрихкод")
                        HStack(spacing: Spacing.sm) {
                            TextField("Отсканируйте или введите", text: $barcode)
                                .textFieldStyle(.plain)
                                #if os(iOS)
                                .keyboardType(.numbersAndPunctuation)
                                #endif
                                .padding(Spacing.md)
                                .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))

                            #if os(iOS)
                            if BarcodeScanner.isSupported {
                                Button {
                                    scanning = true
                                } label: {
                                    Image(systemName: "barcode.viewfinder")
                                        .font(.title3)
                                        .frame(width: 44, height: 44)
                                }
                                .buttonStyle(SecondaryButtonStyle())
                            }
                            #endif
                        }

                        Text("Обязателен: по нему товар находят на кассе и сопоставляют в накладной.")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        FieldLabel("Единица")
                        Picker("Единица", selection: $unit) {
                            ForEach(units, id: \.self) { Text($0).tag($0) }
                        }
                        .pickerStyle(.segmented)

                        RowDivider()

                        priceField("Закупочная цена", text: $purchasePriceText)

                        if !isConsumable {
                            RowDivider()
                            priceField("Цена продажи", text: $salePriceText)
                        }
                    }
                }

                if !isConsumable {
                    Card {
                        VStack(alignment: .leading, spacing: Spacing.sm) {
                            Toggle("Есть срок годности", isOn: $requiresExpiry)
                                .tint(Theme.brand)
                            Text("Для еды и напитков оставьте включённым: без срока склад не предупредит, что товар портится.")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textMuted)
                                .fixedSize(horizontal: false, vertical: true)
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
                    Task { await submit() }
                } label: {
                    if isSaving {
                        ProgressView().controlSize(.small)
                    } else {
                        Text(isConsumable ? "Завести расходник" : "Завести товар")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!canSubmit)
            }
            .background(Theme.background)
            .navigationTitle(isConsumable ? "Новый расходник" : "Новый товар")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
            }
            #if os(iOS)
            .sheet(isPresented: $scanning) {
                NavigationStack {
                    BarcodeScanner { code in
                        barcode = code
                        scanning = false
                    }
                    .ignoresSafeArea()
                    .navigationTitle("Штрихкод")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Отмена") { scanning = false }
                        }
                    }
                }
            }
            #endif
        }
    }

    private func priceField(_ title: String, text: Binding<String>) -> some View {
        HStack {
            Text(title)
                .font(Typography.callout)
                .foregroundStyle(Theme.textDim)
            Spacer()
            TextField("0", text: text)
                .multilineTextAlignment(.trailing)
                .font(Typography.callout.monospacedDigit())
                #if os(iOS)
                .keyboardType(.decimalPad)
                #endif
                .frame(maxWidth: 130)
        }
    }

    private func submit() async {
        isSaving = true
        error = nil
        defer { isSaving = false }

        do {
            try await BusinessService(api: api).createInventoryItem(
                name: name.trimmingCharacters(in: .whitespaces),
                barcode: barcode.trimmingCharacters(in: .whitespaces),
                unit: unit,
                salePrice: AddItemSheet.parse(salePriceText),
                purchasePrice: AddItemSheet.parse(purchasePriceText),
                isConsumable: isConsumable,
                requiresExpiry: isConsumable ? false : requiresExpiry
            )
            Haptics.success()
            await onDone()
            dismiss()
        } catch let apiError as APIError {
            Haptics.error()
            error = apiError.userMessage
        } catch {
            Haptics.error()
            self.error = error.localizedDescription
        }
    }

    private static func parse(_ raw: String) -> Double {
        Double(
            raw.replacingOccurrences(of: " ", with: "")
                .replacingOccurrences(of: "\u{00A0}", with: "")
                .replacingOccurrences(of: ",", with: ".")
        ) ?? 0
    }
}
