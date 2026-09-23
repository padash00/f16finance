import OrdaKit
import OrdaUI
import SwiftUI

/// Правка карточки оператора — те же поля, что на сайте в «Редактировать».
///
/// Сначала подгружаем карточку целиком: в списке команды нет почты, адреса,
/// экстренного контакта и Telegram, а сервер перезаписывает профиль тем, что
/// пришло. Правка по неполным данным стёрла бы остальное.
struct EditOperatorSheet: View {
    let operatorID: String
    var onSaved: () async -> Void

    @Environment(\.api) private var api
    @Environment(\.dismiss) private var dismiss

    @State private var edit: OperatorEdit?
    @State private var loadError: String?
    @State private var isSaving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Group {
                if let binding = Binding($edit) {
                    form(binding)
                } else if let loadError {
                    WideEmptyState(icon: "exclamationmark.triangle", title: "Не удалось открыть карточку", message: loadError)
                } else {
                    LoadingRows(count: 6)
                }
            }
            .background(Theme.background)
            .navigationTitle("Данные оператора")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } }
            }
            .task { await load() }
        }
    }

    private func form(_ edit: Binding<OperatorEdit>) -> some View {
        ScreenScroll {
            LedgerEditForm.section("Имя") {
                row("Имя", icon: "person.fill", text: edit.name, prompt: "как в программе точки")
                LedgerEditForm.divider
                row("Коротко", icon: "person.text.rectangle", text: edit.shortName, prompt: "Али")
                LedgerEditForm.divider
                row("ФИО", icon: "person.crop.rectangle", text: optional(edit.profile.fullName), prompt: "полностью")
                LedgerEditForm.divider
                row("Должность", icon: "briefcase.fill", text: optional(edit.profile.position), prompt: "Оператор")
            }

            LedgerEditForm.section("Связь") {
                row("Телефон", icon: "phone.fill", text: optional(edit.profile.phone), prompt: "+7 700 000 00 00", keyboard: .phone)
                LedgerEditForm.divider
                row("Почта", icon: "envelope.fill", text: optional(edit.profile.email), prompt: "name@mail.kz", keyboard: .email)
                LedgerEditForm.divider
                row("Telegram ID", icon: "paperplane.fill", text: edit.telegramChatID, prompt: "для уведомлений", keyboard: .number)
                LedgerEditForm.divider
                row("Адрес", icon: "house.fill", text: optional(edit.profile.address), prompt: "необязательно")
            }

            LedgerEditForm.section("Даты") {
                dateRow("Принят", icon: "calendar.badge.plus", value: edit.profile.hireDate)
                LedgerEditForm.divider
                dateRow("Дата рождения", icon: "gift.fill", value: edit.profile.birthDate)
            }

            LedgerEditForm.section("Экстренный контакт") {
                row("Кто", icon: "person.2.fill", text: optional(edit.profile.emergencyName), prompt: "мама, брат…")
                LedgerEditForm.divider
                row("Телефон", icon: "phone.badge.waveform.fill", text: optional(edit.profile.emergencyPhone), prompt: "+7…", keyboard: .phone)
            }

            LedgerEditForm.section("Карточка") {
                row("Фото", icon: "photo.fill", text: optional(edit.profile.photoURL), prompt: "ссылка https://…", keyboard: .url)
                LedgerEditForm.divider
                LedgerEditForm.commentRow(optional(edit.profile.notes))
            }

            LedgerEditForm.saveButton(isSaving: isSaving, problem: edit.wrappedValue.problem, error: error) {
                Task { await save() }
            }
        }
    }

    // ── Поля ─────────────────────────────────────────────────────────────────

    private enum Keyboard { case text, phone, email, number, url }

    private func optional(_ value: Binding<String?>) -> Binding<String> {
        Binding(get: { value.wrappedValue ?? "" }, set: { value.wrappedValue = $0.isEmpty ? nil : $0 })
    }

    private func row(_ title: String, icon: String, text: Binding<String>, prompt: String, keyboard: Keyboard = .text) -> some View {
        HStack {
            Label {
                Text(title)
                    .font(.system(size: 16))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                    .fixedSize()
            } icon: {
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.brand)
                    .frame(width: 28)
            }
            Spacer(minLength: Spacing.md)
            TextField(prompt, text: text)
                .multilineTextAlignment(.trailing)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(Theme.text)
                #if os(iOS)
                .keyboardType(keyboardType(keyboard))
                .textInputAutocapitalization(keyboard == .text ? .words : .never)
                #endif
                .autocorrectionDisabled(keyboard != .text)
        }
        .padding(.vertical, 13)
    }

    #if os(iOS)
    private func keyboardType(_ keyboard: Keyboard) -> UIKeyboardType {
        switch keyboard {
        case .text: .default
        case .phone: .phonePad
        case .email: .emailAddress
        case .number: .numbersAndPunctuation
        case .url: .URL
        }
    }
    #endif

    /// Дата — необязательная: у многих её нет. «Не указана» и кнопка, а не
    /// сегодняшнее число по умолчанию, которое сохранилось бы незаметно.
    private func dateRow(_ title: String, icon: String, value: Binding<String?>) -> some View {
        HStack {
            Label {
                Text(title)
                    .font(.system(size: 16))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                    .fixedSize()
            } icon: {
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.brand)
                    .frame(width: 28)
            }
            Spacer(minLength: Spacing.md)
            if let raw = value.wrappedValue, let date = DateParsing.parseDateOnly(raw) {
                DatePicker(
                    "",
                    selection: Binding(
                        get: { date },
                        set: { value.wrappedValue = DateParsing.dateOnlyString(from: $0) }
                    ),
                    displayedComponents: .date
                )
                .labelsHidden()
                Button {
                    value.wrappedValue = nil
                } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.textDim)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Убрать дату")
            } else {
                Button("Указать") { value.wrappedValue = DateParsing.dateOnlyString(from: Date()) }
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.brand)
            }
        }
        .padding(.vertical, 8)
    }

    // ── Загрузка и сохранение ────────────────────────────────────────────────

    private func load() async {
        guard edit == nil else { return }
        do {
            let card = try await BusinessService(api: api).operatorCard(id: operatorID)
            edit = OperatorEdit(card: card)
        } catch let apiError as APIError {
            loadError = apiError.userMessage
        } catch {
            loadError = error.localizedDescription
        }
    }

    private func save() async {
        guard let edit, edit.problem == nil else { return }
        isSaving = true
        defer { isSaving = false }
        error = nil
        do {
            try await BusinessService(api: api).saveOperator(edit)
            Haptics.success()
            await onSaved()
            dismiss()
        } catch let apiError as APIError {
            error = apiError.userMessage
            Haptics.error()
        } catch {
            self.error = error.localizedDescription
            Haptics.error()
        }
    }
}
