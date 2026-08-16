import OrdaKit
import OrdaUI
import SwiftUI

/// Завести клиента.
///
/// Карту оформляют при человеке, у кассы: он стоит и ждёт. Пока это было
/// только на сайте, телефон записывали на бумажке и «заводили потом» — то есть
/// никогда, и клиент второй раз приходил уже без карты.
///
/// Полей ровно три. Всё остальное — почту, заметки, историю — дозаполняют за
/// столом; держать человека у кассы ради них незачем.
struct AddCustomerSheet: View {
    var onDone: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.api) private var api
    @Environment(BusinessStore.self) private var store

    @State private var name = ""
    @State private var phone = ""
    @State private var cardNumber = ""
    @State private var companyID = ""
    @State private var isSaving = false
    @State private var error: String?
    @State private var scanning = false

    var body: some View {
        NavigationStack {
            ScreenScroll {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        field("Имя", text: $name, placeholder: "Иван Иванов")
                        RowDivider()
                        field("Телефон", text: $phone, placeholder: "+7 777 123 45 67", keyboard: .phone)
                    }
                }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        FieldLabel("Карта")
                        HStack(spacing: Spacing.sm) {
                            TextField("Штрихкод карты", text: $cardNumber)
                                .textFieldStyle(.plain)
                                .padding(Spacing.md)
                                .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))

                            #if os(iOS)
                            // Номер карты набирать руками — верный способ
                            // ошибиться: он длинный и без смысла.
                            // Сканер есть не на всяком устройстве: на старых
                            // и на симуляторе кнопка была бы обманом.
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

                        Text("Необязательно: карту можно привязать позже, клиента найдут по телефону.")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                if store.companies.count > 1 {
                    Card {
                        VStack(alignment: .leading, spacing: Spacing.sm) {
                            FieldLabel("Точка")
                            Picker("Точка", selection: $companyID) {
                                Text("Без привязки").tag("")
                                ForEach(store.companies) { company in
                                    Text(company.name).tag(company.id)
                                }
                            }
                            .pickerStyle(.menu)
                            .tint(Theme.brand)
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
                        Text("Завести клиента")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(isSaving || name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .background(Theme.background)
            .navigationTitle("Новый клиент")
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
                        cardNumber = code
                        scanning = false
                    }
                    .ignoresSafeArea()
                    .navigationTitle("Карта клиента")
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

    private func field(
        _ title: String,
        text: Binding<String>,
        placeholder: String,
        keyboard: KeyboardKind = .default
    ) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            FieldLabel(title)
            TextField(placeholder, text: text)
                .textFieldStyle(.plain)
                #if os(iOS)
                .keyboardType(keyboard == .phone ? .phonePad : .default)
                .textInputAutocapitalization(keyboard == .phone ? .never : .words)
                #endif
                .padding(Spacing.md)
                .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
        }
    }

    enum KeyboardKind { case `default`, phone }

    private func submit() async {
        isSaving = true
        error = nil
        defer { isSaving = false }

        do {
            try await BusinessService(api: api).createCustomer(
                name: name.trimmingCharacters(in: .whitespaces),
                phone: phone.trimmingCharacters(in: .whitespaces),
                cardNumber: cardNumber.trimmingCharacters(in: .whitespaces),
                companyID: companyID
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
