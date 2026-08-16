import OrdaKit
import OrdaUI
import SwiftUI

/// Завести поставщика.
///
/// Новый поставщик появляется в момент приёмки: машина у дверей, накладная в
/// руках, а в списке его нет. Пока это жило только на сайте, приёмку
/// оформляли «на кого попало» или откладывали до вечера — и остатки весь день
/// были неправдой.
///
/// Полей минимум. ИИН/БИН нужен для долгов и сверок, но требовать его у
/// водителя посреди разгрузки бессмысленно — можно дозаполнить потом.
struct AddSupplierSheet: View {
    var onDone: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.api) private var api
    @Environment(BusinessStore.self) private var store

    @State private var name = ""
    @State private var contactName = ""
    @State private var phone = ""
    @State private var binIIN = ""
    @State private var companyID = ""
    @State private var isSaving = false
    @State private var error: String?

    /// ИИН и БИН в Казахстане — двенадцать цифр. Сервер отвергает другое, и
    /// узнать об этом лучше до отправки.
    private var binIsValid: Bool {
        let digits = binIIN.filter(\.isNumber)
        return digits.isEmpty || digits.count == 12
    }

    var body: some View {
        NavigationStack {
            ScreenScroll {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        field("Название", text: $name, placeholder: "Панда КО")
                        RowDivider()
                        field("Контактное лицо", text: $contactName, placeholder: "Необязательно")
                        RowDivider()
                        field("Телефон", text: $phone, placeholder: "+7 777 123 45 67", isPhone: true)
                    }
                }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        FieldLabel("ИИН или БИН")
                        TextField("12 цифр, необязательно", text: $binIIN)
                            .textFieldStyle(.plain)
                            #if os(iOS)
                            .keyboardType(.numberPad)
                            #endif
                            .padding(Spacing.md)
                            .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))

                        Text(binIsValid
                            ? "Нужен для долгов и сверок. Требовать его у водителя посреди разгрузки незачем — дозаполните потом."
                            : "Должно быть ровно двенадцать цифр.")
                            .font(Typography.caption)
                            .foregroundStyle(binIsValid ? Theme.textMuted : Theme.negative)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

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

                        Text("Поставщик привязывается к точке-магазину: у разных точек свои поставки и свои долги.")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textMuted)
                            .fixedSize(horizontal: false, vertical: true)
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
                        Text("Завести поставщика")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(
                    isSaving
                        || name.trimmingCharacters(in: .whitespaces).isEmpty
                        || companyID.isEmpty
                        || !binIsValid
                )
            }
            .background(Theme.background)
            .navigationTitle("Новый поставщик")
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

    private func field(
        _ title: String,
        text: Binding<String>,
        placeholder: String,
        isPhone: Bool = false
    ) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            FieldLabel(title)
            TextField(placeholder, text: text)
                .textFieldStyle(.plain)
                #if os(iOS)
                .keyboardType(isPhone ? .phonePad : .default)
                .textInputAutocapitalization(isPhone ? .never : .words)
                #endif
                .padding(Spacing.md)
                .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
        }
    }

    private func submit() async {
        isSaving = true
        error = nil
        defer { isSaving = false }

        do {
            try await BusinessService(api: api).createSupplier(
                name: name.trimmingCharacters(in: .whitespaces),
                companyID: companyID,
                contactName: contactName.trimmingCharacters(in: .whitespaces),
                phone: phone.trimmingCharacters(in: .whitespaces),
                binIIN: binIIN.filter(\.isNumber)
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
}
