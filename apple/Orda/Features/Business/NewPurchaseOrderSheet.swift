import OrdaKit
import OrdaUI
import SwiftUI

/// Заявка поставщику с телефона.
///
/// Товар кончается не за столом: это видно у полки, вечером, когда витрина
/// пустая. Раньше оставалось записать в блокнот и завести заявку утром — а
/// утром вспоминалось не всё.
///
/// Позиции берём из плана закупа, а не набираем руками. План уже посчитал
/// спрос за месяц, целевой запас и округление до упаковок; заявка, набранная
/// на глаз, разойдётся с этим расчётом — и через неделю на витрине снова не
/// хватит того же товара.
struct NewPurchaseOrderSheet: View {
    var onDone: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.api) private var api

    @State private var companies: [Company] = []
    @State private var companyID: String?
    @State private var plan: PurchasePlan?
    @State private var suppliers: [Supplier] = []
    @State private var supplierName: String?
    /// Что реально уйдёт в заявку: позиция → количество.
    @State private var picked: [String: Double] = [:]
    @State private var comment = ""
    @State private var isLoading = false
    @State private var isSaving = false
    @State private var error: String?

    private var group: PurchasePlanSupplier? {
        plan?.bySupplier.first { $0.supplier == supplierName }
    }

    /// Поставщик из справочника, совпавший по имени с планом.
    ///
    /// Сервер принимает заявку по идентификатору, а план знает поставщика
    /// только по названию — оно приходит из карточек товара. Если совпадения
    /// нет, отправлять некуда, и это надо сказать словами.
    private var supplier: Supplier? {
        guard let supplierName else { return nil }
        return suppliers.first { $0.name.caseInsensitiveCompare(supplierName) == .orderedSame }
    }

    private var total: Double {
        (group?.items ?? []).reduce(into: 0.0) { sum, line in
            sum += (picked[line.itemID] ?? 0) * line.unitCost
        }
    }

    private var canSend: Bool {
        supplier != nil && picked.values.contains { $0 > 0 } && !isSaving
    }

    var body: some View {
        NavigationStack {
            ScreenScroll {
                pointCard

                if isLoading {
                    LoadingRows(count: 3)
                } else if let plan, plan.isEmpty {
                    Card {
                        Text("По этой точке закупать нечего: остатков хватает на ближайшую неделю.")
                            .font(Typography.callout)
                            .foregroundStyle(Theme.textMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                } else if plan != nil {
                    supplierCard
                    if supplierName != nil { itemsCard }
                }

                if let error {
                    Text(error)
                        .font(Typography.callout)
                        .foregroundStyle(Theme.negative)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if supplierName != nil {
                    Card {
                        VStack(alignment: .leading, spacing: Spacing.sm) {
                            FieldLabel("Комментарий поставщику")
                            TextField("Необязательно", text: $comment, axis: .vertical)
                                .textFieldStyle(.plain)
                                .lineLimit(1...3)
                                .padding(Spacing.md)
                                .background(
                                    Theme.surfaceRaised,
                                    in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
                                )
                        }
                    }

                    Button {
                        Task { await send() }
                    } label: {
                        if isSaving {
                            ProgressView().controlSize(.small)
                        } else {
                            Text(total > 0 ? "Отправить заявку · \(Money.format(total))" : "Отправить заявку")
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(!canSend)

                    if supplier == nil {
                        Text("Этого поставщика нет в справочнике — заявку отправить некуда. Заведите его на сайте, в разделе «Поставщики».")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .background(Theme.background)
            .navigationTitle("Заявка поставщику")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
            }
            .task { await load() }
        }
    }

    // ── Точка ────────────────────────────────────────────────────────────────

    private var pointCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                FieldLabel("Точка")
                // План считается для одной точки: спрос и остатки у каждой свои.
                Picker("Точка", selection: $companyID) {
                    ForEach(companies) { company in
                        Text(company.name).tag(String?.some(company.id))
                    }
                }
                .pickerStyle(.menu)
                .tint(Theme.brand)
                .onChange(of: companyID) { _, _ in
                    Task { await loadPlan() }
                }
            }
        }
    }

    private var supplierCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                FieldLabel("Поставщик")

                ForEach(Array((plan?.bySupplier ?? []).enumerated()), id: \.element.id) { index, item in
                    if index > 0 { RowDivider() }
                    Button {
                        supplierName = item.supplier
                        // Предлагаем то, что посчитал план: правки — руками.
                        picked = Dictionary(uniqueKeysWithValues: item.items.map { ($0.itemID, $0.order) })
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.displayName)
                                    .font(Typography.body)
                                    .foregroundStyle(Theme.text)
                                Text("\(item.items.count) \(pluralize(item.items.count, "позиция", "позиции", "позиций")) · \(Money.format(item.total))")
                                    .font(Typography.caption)
                                    .foregroundStyle(Theme.textMuted)
                            }
                            Spacer()
                            Image(systemName: supplierName == item.supplier ? "checkmark.circle.fill" : "circle")
                                .foregroundStyle(supplierName == item.supplier ? Theme.brand : Theme.textMuted)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.pressable)
                    .disabled(item.isUnknownSupplier)
                }
            }
        }
    }

    private var itemsCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                FieldLabel("Что заказываем")

                ForEach(Array((group?.items ?? []).enumerated()), id: \.element.id) { index, line in
                    if index > 0 { RowDivider() }
                    VStack(alignment: .leading, spacing: Spacing.xxs) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(line.name)
                                .font(Typography.body)
                                .foregroundStyle(Theme.text)
                                .fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: Spacing.sm)
                            // Количество правится: план знает спрос, но не
                            // знает, что поставщик возит коробками по шесть.
                            Stepper(
                                value: Binding(
                                    get: { picked[line.itemID] ?? 0 },
                                    set: { picked[line.itemID] = max(0, $0) }
                                ),
                                in: 0...9999,
                                step: 1
                            ) {
                                Text(Quantity.format(picked[line.itemID] ?? 0))
                                    .font(Typography.body.weight(.medium))
                                    .monospacedDigit()
                                    .foregroundStyle(Theme.text)
                            }
                            .labelsHidden()
                            .fixedSize()
                        }

                        Text("остаток \(Quantity.format(line.stock)) · расход \(Quantity.format(line.weeklyDemand)) в неделю")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textDim)
                    }
                }
            }
        }
    }

    // ── Загрузка и отправка ──────────────────────────────────────────────────

    private func load() async {
        isLoading = true
        defer { isLoading = false }

        let service = PurchasePlanService(api: api)
        companies = (try? await service.companies()) ?? []
        suppliers = (try? await BusinessService(api: api).suppliers().suppliers) ?? []
        if companyID == nil { companyID = companies.first?.id }
        await loadPlan()
    }

    private func loadPlan() async {
        guard let companyID else { return }
        isLoading = true
        error = nil
        defer { isLoading = false }

        supplierName = nil
        picked = [:]

        do {
            plan = try await PurchasePlanService(api: api).plan(companyID: companyID)
        } catch let apiError as APIError {
            error = apiError.userMessage
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func send() async {
        guard let supplier, let group else { return }
        isSaving = true
        error = nil
        defer { isSaving = false }

        let lines = group.items.compactMap { line -> (itemID: String, quantity: Double, stock: Double)? in
            let quantity = picked[line.itemID] ?? 0
            guard quantity > 0 else { return nil }
            return (itemID: line.itemID, quantity: quantity, stock: line.stock)
        }

        do {
            try await PurchaseOrdersService(api: api).createOrder(
                supplierID: supplier.id,
                comment: comment.trimmingCharacters(in: .whitespaces),
                lines: lines
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
