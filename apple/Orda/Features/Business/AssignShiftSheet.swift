import OrdaKit
import OrdaUI
import SwiftUI

/// Поставить человека в смену.
///
/// График правят по дороге: кто-то заболел утром, кого-то переставили местами
/// вечером. Пока это жило только на сайте, замену обещали словами, а в графике
/// оставался прежний — и человек приходил на смену, которую уже отдали другому.
///
/// Имя оператора здесь — текст, а не ссылка: так устроено расписание на
/// сервере. Поэтому выбираем из списка команды, а не даём набирать руками:
/// «Алима» и «Алима К.» станут двумя разными людьми в отчётах.
struct AssignShiftSheet: View {
    let companyID: String
    let companyName: String
    let date: Date

    var onDone: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.api) private var api
    @Environment(BusinessStore.self) private var store

    @State private var shiftType = "day"
    @State private var operatorName = ""
    @State private var isSaving = false
    @State private var error: String?

    private var people: [TeamOperator] {
        store.operators.filter(\.isActive)
    }

    var body: some View {
        NavigationStack {
            ScreenScroll {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        FieldLabel("Смена")
                        Text(date.formatted(.dateTime.weekday(.wide).day().month(.wide)))
                            .font(Typography.title)
                            .foregroundStyle(Theme.text)
                        Text(companyName)
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textMuted)
                    }
                }

                Card {
                    Picker("Смена", selection: $shiftType) {
                        Text("Дневная").tag("day")
                        Text("Ночная").tag("night")
                    }
                    .pickerStyle(.segmented)
                }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        SectionHeader("Кто выходит")

                        // Пустое имя — способ убрать человека со смены: так же
                        // это делает сайт.
                        Button {
                            operatorName = ""
                        } label: {
                            HStack {
                                Image(systemName: operatorName.isEmpty ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(operatorName.isEmpty ? Theme.brand : Theme.textMuted)
                                Text("Никто — освободить смену")
                                    .font(Typography.callout)
                                    .foregroundStyle(Theme.textDim)
                                Spacer()
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.pressable)

                        if people.isEmpty {
                            InlineEmpty(icon: "person.2", text: "Операторов нет", tint: Theme.textDim)
                        } else {
                            ForEach(people) { person in
                                RowDivider()
                                Button {
                                    operatorName = person.displayName
                                } label: {
                                    HStack {
                                        Image(systemName: operatorName == person.displayName ? "checkmark.circle.fill" : "circle")
                                            .foregroundStyle(operatorName == person.displayName ? Theme.brand : Theme.textMuted)
                                        Text(person.displayName)
                                            .font(Typography.callout)
                                            .foregroundStyle(Theme.text)
                                        Spacer()
                                    }
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.pressable)
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

                Button {
                    Task { await submit() }
                } label: {
                    if isSaving {
                        ProgressView().controlSize(.small)
                    } else {
                        Text(operatorName.isEmpty ? "Освободить смену" : "Поставить в смену")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(isSaving)

                Text("График виден оператору после публикации недели — её делают на сайте.")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .background(Theme.background)
            .navigationTitle("Смена")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
            }
            .task {
                if store.operators.isEmpty { await store.loadTeam() }
            }
        }
    }

    private func submit() async {
        isSaving = true
        error = nil
        defer { isSaving = false }

        do {
            try await BusinessService(api: api).saveShift(
                companyID: companyID,
                date: DateParsing.dateOnlyString(from: date),
                shiftType: shiftType,
                operatorName: operatorName
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
