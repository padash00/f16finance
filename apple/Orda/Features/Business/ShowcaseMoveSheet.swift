import OrdaKit
import OrdaUI
import SwiftUI

/// Движение товара между складом и витриной.
///
/// Оба направления нужны стоя у полки, а не за столом: товар кончился — надо
/// вынести, товар не пошёл — надо убрать. Пока это жило только на сайте,
/// заявку писали «потом», и витрина стояла пустой при полном складе.
///
/// Наверх со склада идёт **заявка**, а не перенос: остаток уходит только после
/// одобрения. Вниз, с витрины на склад, — сразу: это возврат своего же товара,
/// согласовывать нечего.
struct ShowcaseMoveSheet: View {
    enum Direction {
        case toShowcase
        case toWarehouse

        var title: String {
            switch self {
            case .toShowcase: "На витрину"
            case .toWarehouse: "На склад"
            }
        }

        var action: String {
            switch self {
            case .toShowcase: "Создать заявку"
            case .toWarehouse: "Вернуть на склад"
            }
        }

        var note: String {
            switch self {
            case .toShowcase: "Заявку одобряет управляющий — до этого остаток со склада не уйдёт."
            case .toWarehouse: "Товар вернётся на склад сразу: это ваш же остаток, согласовывать нечего."
            }
        }
    }

    let row: ShowcaseRow
    let companyID: String
    var onDone: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.api) private var api
    @Environment(\.access) private var access

    @State private var direction: Direction = .toShowcase
    @State private var amountText = ""
    @State private var comment = ""
    @State private var isSaving = false
    @State private var error: String?

    private var canMove: Bool { access?.can("store-showcase.move") ?? false }
    private var canReturn: Bool { access?.can("store-showcase.return_to_warehouse") ?? false }

    private var directions: [Direction] {
        var result: [Direction] = []
        if canMove { result.append(.toShowcase) }
        if canReturn { result.append(.toWarehouse) }
        return result
    }

    private var amount: Double { ShowcaseMoveSheet.parse(amountText) }

    /// Сколько есть в источнике. Больше этого просить бессмысленно.
    private var available: Double {
        direction == .toShowcase ? row.warehouseQuantity : row.showcaseQuantity
    }

    var body: some View {
        NavigationStack {
            ScreenScroll {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        Text(row.name)
                            .font(Typography.title)
                            .foregroundStyle(Theme.text)

                        HStack(spacing: Spacing.lg) {
                            stock("На складе", row.warehouseQuantity)
                            stock("На витрине", row.showcaseQuantity)
                        }
                    }
                }

                if directions.count > 1 {
                    Card {
                        Picker("Куда", selection: $direction) {
                            ForEach(directions, id: \.title) { option in
                                Text(option.title).tag(option)
                            }
                        }
                        .pickerStyle(.segmented)
                    }
                }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
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
                                .frame(maxWidth: 120)
                            Text(row.unit ?? "шт")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.textMuted)
                        }

                        // Кнопка «всё»: чаще всего выносят остаток целиком.
                        if available > 0 {
                            Button("Всё — \(Quantity.format(available))") {
                                amountText = Quantity.format(available)
                                    .replacingOccurrences(of: " ", with: "")
                                    .replacingOccurrences(of: "\u{00A0}", with: "")
                            }
                            .buttonStyle(SecondaryButtonStyle())
                        }

                        if amount > available {
                            Text("Столько нет: доступно \(Quantity.format(available)).")
                                .font(Typography.caption)
                                .foregroundStyle(Theme.negative)
                        }
                    }
                }

                if direction == .toShowcase {
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
                        Text(direction.action)
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(isSaving || amount <= 0 || amount > available)

                Text(direction.note)
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .background(Theme.background)
            .navigationTitle("Движение товара")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
            }
            .task {
                if let first = directions.first, !directions.contains(where: { $0.title == direction.title }) {
                    direction = first
                }
            }
        }
    }

    private func stock(_ title: String, _ value: Double) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title.uppercased())
                .font(Typography.caption)
                .foregroundStyle(Theme.textMuted)
            Text(Quantity.format(value))
                .font(Typography.title)
                .foregroundStyle(value > 0 ? Theme.text : Theme.textMuted)
        }
    }

    private func submit() async {
        isSaving = true
        error = nil
        defer { isSaving = false }

        do {
            let service = BusinessService(api: api)
            switch direction {
            case .toShowcase:
                try await service.requestToShowcase(
                    companyID: companyID,
                    itemID: row.itemID,
                    quantity: amount,
                    comment: comment.trimmingCharacters(in: .whitespaces)
                )
            case .toWarehouse:
                try await service.returnFromShowcase(
                    companyID: companyID,
                    itemID: row.itemID,
                    quantity: amount
                )
            }
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

    /// Количество вводят как придётся: с запятой, с пробелами.
    private static func parse(_ raw: String) -> Double {
        Double(
            raw.replacingOccurrences(of: " ", with: "")
                .replacingOccurrences(of: "\u{00A0}", with: "")
                .replacingOccurrences(of: ",", with: ".")
        ) ?? 0
    }
}

extension ShowcaseMoveSheet.Direction: Hashable {}
