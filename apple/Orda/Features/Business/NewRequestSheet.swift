import OrdaKit
import OrdaUI
import SwiftUI

/// Заявка со склада на витрину.
///
/// То же действие, что и по строке витрины, но с другого конца: там человек
/// стоит у пустой полки и знает товар, здесь — открывает журнал заявок и
/// заводит недостающее списком.
///
/// Товар выбирается из остатков склада: просить то, чего на складе нет,
/// бессмысленно — заявка всё равно повиснет.
struct NewRequestSheet: View {
    var onDone: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.api) private var api
    @Environment(BusinessStore.self) private var store

    @State private var companyID = ""
    @State private var search = ""
    @State private var selectedItem: StockBalance?
    @State private var amountText = ""
    @State private var comment = ""
    @State private var isSaving = false
    @State private var error: String?

    private var amount: Double { NewRequestSheet.parse(amountText) }

    /// Что есть на складе — из него и просят.
    private var candidates: [StockBalance] {
        let all = (store.store?.balances ?? []).filter { $0.quantity > 0 }
        let needle = search.trimmingCharacters(in: .whitespaces)
        guard !needle.isEmpty else { return Array(all.prefix(30)) }
        return all.filter { $0.name.localizedCaseInsensitiveContains(needle) }
    }

    var body: some View {
        NavigationStack {
            ScreenScroll {
                if store.companies.count > 1 {
                    Card {
                        VStack(alignment: .leading, spacing: Spacing.sm) {
                            FieldLabel("Точка")
                            Picker("Точка", selection: $companyID) {
                                Text("Выберите точку").tag("")
                                ForEach(store.companies) { company in
                                    Text(company.name).tag(company.id)
                                }
                            }
                            .pickerStyle(.menu)
                            .tint(Theme.brand)
                        }
                    }
                }

                if let item = selectedItem {
                    Card {
                        VStack(alignment: .leading, spacing: Spacing.md) {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(item.name)
                                        .font(Typography.headline)
                                        .foregroundStyle(Theme.text)
                                    Text("на складе \(Quantity.format(item.quantity)) \(item.unit)")
                                        .font(Typography.caption)
                                        .foregroundStyle(Theme.textMuted)
                                }
                                Spacer()
                                Button("Сменить") { selectedItem = nil }
                                    .buttonStyle(.pressable)
                                    .font(Typography.caption)
                            }

                            RowDivider()

                            HStack {
                                Text("Сколько")
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.textDim)
                                Spacer()
                                TextField("0", text: $amountText)
                                    .multilineTextAlignment(.trailing)
                                    .font(Typography.callout.monospacedDigit())
                                    #if os(iOS)
                                    .keyboardType(.decimalPad)
                                    #endif
                                    .frame(maxWidth: 110)
                                Text(item.unit)
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.textMuted)
                            }

                            if amount > item.quantity {
                                Text("На складе столько нет: \(Quantity.format(item.quantity)).")
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.negative)
                            }
                        }
                    }

                    Card {
                        VStack(alignment: .leading, spacing: Spacing.sm) {
                            FieldLabel("Комментарий")
                            TextField("Необязательно", text: $comment, axis: .vertical)
                                .textFieldStyle(.plain)
                                .lineLimit(1...3)
                                .padding(Spacing.md)
                                .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
                        }
                    }
                } else {
                    Card {
                        VStack(alignment: .leading, spacing: Spacing.sm) {
                            SectionHeader("Что вынести", subtitle: "Из того, что есть на складе")

                            if candidates.isEmpty {
                                InlineEmpty(
                                    icon: "shippingbox",
                                    text: search.isEmpty ? "Склад пуст" : "Ничего не нашлось",
                                    tint: Theme.textDim
                                )
                            } else {
                                ForEach(Array(candidates.enumerated()), id: \.element.id) { index, item in
                                    if index > 0 { RowDivider() }
                                    Button {
                                        selectedItem = item
                                    } label: {
                                        HStack {
                                            Text(item.name)
                                                .font(Typography.callout)
                                                .foregroundStyle(Theme.text)
                                            Spacer()
                                            Text("\(Quantity.format(item.quantity)) \(item.unit)")
                                                .font(Typography.caption.monospacedDigit())
                                                .foregroundStyle(Theme.textMuted)
                                        }
                                        .contentShape(Rectangle())
                                    }
                                    .buttonStyle(.pressable)
                                }
                            }
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

                if selectedItem != nil {
                    Button {
                        Task { await submit() }
                    } label: {
                        if isSaving {
                            ProgressView().controlSize(.small)
                        } else {
                            Text("Создать заявку")
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(
                        isSaving
                            || companyID.isEmpty
                            || amount <= 0
                            || amount > (selectedItem?.quantity ?? 0)
                    )

                    Text("Заявку одобряет тот, у кого есть право решать. До одобрения остаток со склада не уйдёт.")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .background(Theme.background)
            .searchable(text: $search, prompt: "Название товара")
            .navigationTitle("Новая заявка")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
            }
            .task {
                if companyID.isEmpty, store.companies.count == 1 {
                    companyID = store.companies[0].id
                }
            }
        }
    }

    private func submit() async {
        guard let item = selectedItem else { return }
        isSaving = true
        error = nil
        defer { isSaving = false }

        do {
            try await BusinessService(api: api).requestToShowcase(
                companyID: companyID,
                itemID: item.itemID,
                quantity: amount,
                comment: comment.trimmingCharacters(in: .whitespaces)
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
