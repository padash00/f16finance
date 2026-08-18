import OrdaKit
import OrdaUI
import SwiftUI

/// Приём сотрудника.
///
/// Человека принимают на месте: пришёл, договорились, вышел завтра. Пока это
/// жило только на сайте, его заводили вечером или не заводили вовсе — а без
/// карточки нет ни ведомости, ни доступа, ни истории.
///
/// Спрашиваем минимум: имя, должность и оклад. Телефон и почта — по желанию,
/// но почта нужна для входа: без неё приглашение отправить некуда, и об этом
/// сказано прямо, а не выясняется потом.
struct AddStaffSheet: View {
    var onDone: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.api) private var api
    @Environment(\.access) private var access

    @State private var fullName = ""
    @State private var role = "other"
    @State private var salaryText = ""
    @State private var phone = ""
    @State private var email = ""
    @State private var isSaving = false
    @State private var error: String?

    /// Административные должности назначает только владелец — так же решает
    /// сервер. Показывать их всем значит обещать отказ.
    private var canAssignAdminRole: Bool { access?.session.staffRole == "owner" }

    private var roles: [(id: String, title: String)] {
        var result: [(String, String)] = [("other", "Сотрудник")]
        if canAssignAdminRole {
            result.append(contentsOf: [
                ("manager", "Управляющий"),
                ("accountant", "Бухгалтер"),
            ])
        }
        return result
    }

    private var salary: Double { Double(salaryText.replacingOccurrences(of: " ", with: "")) ?? 0 }

    private var canSave: Bool {
        !fullName.trimmingCharacters(in: .whitespaces).isEmpty && salary > 0 && !isSaving
    }

    var body: some View {
        NavigationStack {
            ScreenScroll {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        FieldLabel("Имя и фамилия")
                        TextField("Айгерим Сатыбалдиева", text: $fullName)
                            .textFieldStyle(.plain)
                            .font(Typography.title)
                            .foregroundStyle(Theme.text)
                    }
                }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        FieldLabel("Должность")
                        Picker("", selection: $role) {
                            ForEach(roles, id: \.id) { item in
                                Text(item.title).tag(item.id)
                            }
                        }
                        .pickerStyle(.segmented)
                        .labelsHidden()

                        if !canAssignAdminRole {
                            Text("Управляющего и бухгалтера назначает владелец.")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textMuted)
                        }
                    }
                }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        FieldLabel("Оклад за месяц")
                        TextField("0", text: $salaryText)
                            #if os(iOS)
                            .keyboardType(.numberPad)
                            #endif
                            .font(Typography.metric)
                            .foregroundStyle(Theme.text)
                        Text("Без оклада сотрудник не попадёт в ведомость — сервер такого не примет.")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        FieldLabel("Связь")
                        TextField("Телефон", text: $phone)
                            .textFieldStyle(.plain)
                            #if os(iOS)
                            .keyboardType(.phonePad)
                            #endif
                        RowDivider()
                        TextField("Почта", text: $email)
                            .textFieldStyle(.plain)
                            #if os(iOS)
                            .keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            #endif
                        Text("Почта нужна для входа в систему: приглашение отправляется на неё. Без почты карточка заведётся, но доступа у человека не будет.")
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
                    Task { await save() }
                } label: {
                    if isSaving {
                        ProgressView().controlSize(.small)
                    } else {
                        Text("Принять на работу")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!canSave)
            }
            .background(Theme.background)
            .navigationTitle("Новый сотрудник")
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

    private func save() async {
        isSaving = true
        error = nil
        defer { isSaving = false }

        do {
            try await BusinessService(api: api).createStaff(
                fullName: fullName.trimmingCharacters(in: .whitespaces),
                role: role,
                monthlySalary: salary,
                phone: phone.trimmingCharacters(in: .whitespaces),
                email: email.trimmingCharacters(in: .whitespaces)
            )
            await onDone()
            dismiss()
        } catch let apiError as APIError {
            error = apiError.userMessage
        } catch {
            self.error = error.localizedDescription
        }
    }
}
