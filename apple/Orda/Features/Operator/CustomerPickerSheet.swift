import OrdaKit
import OrdaUI
import SwiftUI

/// Выбор клиента для чека.
///
/// Ищут по карте, телефону или имени — тем, что человек называет у стойки.
/// Список без запроса показывает частых: у точки есть десяток постоянных, и
/// набирать их каждый раз незачем.
struct CustomerPickerSheet: View {
    let pick: (PointCustomer) -> Void

    @Environment(\.api) private var api
    @Environment(\.dismiss) private var dismiss

    @State private var customers: [PointCustomer] = []
    @State private var search = ""
    @State private var isLoading = true
    @State private var loadError: APIError?
    @State private var searchTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            Group {
                if let loadError, customers.isEmpty {
                    ErrorStateView(error: loadError) { Task { await load() } }
                } else if isLoading && customers.isEmpty {
                    LoadingRows(count: 6)
                } else if customers.isEmpty {
                    EmptyStateView(
                        icon: "person.crop.circle.badge.questionmark",
                        title: search.isEmpty ? "Клиентов нет" : "Никого не нашлось",
                        message: search.isEmpty
                            ? "Клиентов заводят на сайте — в разделе «Клиенты»."
                            : "Проверьте номер карты или телефон."
                    )
                } else {
                    List(customers) { customer in
                        Button {
                            pick(customer)
                            dismiss()
                        } label: {
                            HStack(spacing: Spacing.md) {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(customer.name)
                                        .font(Typography.callout)
                                        .foregroundStyle(Theme.text)
                                    if !customer.subtitle.isEmpty {
                                        Text(customer.subtitle)
                                            .font(Typography.caption)
                                            .foregroundStyle(Theme.textDim)
                                    }
                                }
                                Spacer(minLength: Spacing.sm)
                                // Бонусы — то, ради чего карту и достают.
                                VStack(alignment: .trailing, spacing: 1) {
                                    Text("\(Int(customer.loyaltyPoints))")
                                        .font(Typography.callout.weight(.semibold))
                                        .monospacedDigit()
                                        .foregroundStyle(customer.loyaltyPoints > 0 ? Theme.positive : Theme.textDim)
                                    Text("бонусов")
                                        .font(Typography.caption)
                                        .foregroundStyle(Theme.textDim)
                                }
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.pressable)
                        .listRowInsets(EdgeInsets(top: Spacing.xs, leading: Spacing.lg, bottom: Spacing.xs, trailing: Spacing.lg))
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                }
            }
            .background(Theme.background)
            .searchable(text: $search, prompt: "Карта, телефон или имя")
            .navigationTitle("Клиент")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
            }
            .task { await load() }
            .onChange(of: search) { _, _ in
                // Пауза перед запросом: иначе он уходит на каждую цифру карты.
                searchTask?.cancel()
                searchTask = Task {
                    try? await Task.sleep(for: .milliseconds(300))
                    guard !Task.isCancelled else { return }
                    await load()
                }
            }
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            customers = try await CustomerService(api: api).customers(search: search)
            loadError = nil
        } catch let error as APIError {
            loadError = error
        } catch {
            loadError = .transport(message: error.localizedDescription)
        }
    }
}
