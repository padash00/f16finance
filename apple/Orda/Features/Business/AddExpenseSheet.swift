import OrdaKit
import OrdaUI
import PhotosUI
import SwiftUI

/// Форма расхода.
///
/// Расход нельзя записать одним запросом: сервер требует мастер, потому что
/// каждый расход обязан быть подтверждён. Здесь мастер сведён в одну форму —
/// на телефоне листать три экрана незачем, — но порядок обращений к серверу
/// остался тем, которого он ждёт: сессия, документ, поля, отправка.
///
/// Ради этой формы телефон и нужен: чек фотографируют там же, где платят.
struct AddExpenseSheet: View {
    @Environment(BusinessStore.self) private var store
    @Environment(\.api) private var api
    @Environment(\.access) private var access
    @Environment(\.dismiss) private var dismiss

    @State private var model: ExpenseFormModel?
    @State private var date = Date()
    @State private var companyID = ""
    @State private var categoryID = ""
    @State private var cash = ""
    @State private var kaspi = ""
    @State private var itemName = ""
    @State private var comment = ""
    @State private var documentKind: ExpenseDocumentKind = .receipt
    @State private var vendorID = ""
    @State private var payee = ""
    @State private var reason = ""
    @State private var backdatedConfirmed = false

    @State private var photoItem: PhotosPickerItem?
    @State private var isCameraOpen = false
    @State private var didPrepare = false

    var body: some View {
        NavigationStack {
            ScreenScroll {
                VStack(spacing: Spacing.lg) {
                    if let model, let error = model.loadError {
                        ErrorStateView(error: error) { Task { await model.loadReferences() } }
                    } else {
                        whatCard
                        amountsCard
                        documentCard
                        footer
                    }
                }
            }
            .background(Theme.background)
            .navigationTitle("Новый расход")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
            }
            .task {
                guard !didPrepare else { return }
                didPrepare = true
                let created = ExpenseFormModel(api: api)
                model = created
                if store.companies.isEmpty { await store.loadCompanies() }
                if companyID.isEmpty, store.companies.count == 1 {
                    companyID = store.companies[0].id
                }
                await created.loadReferences()
            }
            .photosPicker(isPresented: pickerBinding, selection: $photoItem, matching: .images)
            .onChange(of: photoItem) { _, item in
                guard let item else { return }
                Task { await attach(item) }
            }
            #if os(iOS)
            .fullScreenCover(isPresented: $isCameraOpen) {
                CameraCapture { data in
                    Task { await model?.attach(data: data, fileName: "receipt.jpg", mimeType: "image/jpeg") }
                }
                .ignoresSafeArea()
            }
            #endif
        }
    }

    // ── Части формы ──────────────────────────────────────────────────────────

    private var whatCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Что и когда")

                DatePicker("Дата", selection: $date, in: ...Date(), displayedComponents: .date)
                    .font(Typography.callout)

                FieldLabel("Точка")
                Picker("Точка", selection: $companyID) {
                    Text("Не выбрана").tag("")
                    ForEach(store.companies) { company in
                        Text(company.name).tag(company.id)
                    }
                }
                .pickerStyle(.menu)

                FieldLabel("Категория")
                Picker("Категория", selection: $categoryID) {
                    Text("Не выбрана").tag("")
                    ForEach(selectableCategories) { category in
                        Text(category.name).tag(category.id)
                    }
                }
                .pickerStyle(.menu)

                if let model, !model.categories.isEmpty, selectableCategories.count < model.categories.count {
                    // Себестоимость заводится приёмкой, где есть накладная.
                    // Показывать такие статьи в списке значит обещать то, что
                    // сервер отвергнет.
                    Text("Статьи себестоимости здесь не заводятся — для них есть приёмка товара.")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textDim)
                }

                if picksCogs {
                    // Владельцу выбор оставлен, но молча — значит однажды
                    // товар придёт и накладной, и расходом, а себестоимость
                    // удвоится.
                    Text("Себестоимость обычно приходит из приёмки. Заводите её здесь, только если накладной нет — иначе товар посчитается дважды.")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.warning)
                }

                FieldLabel("Что купили")
                TextField("Например: картриджи для принтера", text: $itemName)
                    .textFieldStyle(.plain)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .padding(Spacing.md)
                    .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
            }
        }
    }

    private var amountsCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Сколько")
                MoneyField(title: "Наличные", text: $cash)
                MoneyField(title: "Безналичный", text: $kaspi)

                RowDivider()
                StatRow("Итого", value: Money.format(draft.total), emphasized: true)

                FieldLabel("Комментарий")
                Text("Не меньше 20 символов: через полгода по нему будут вспоминать, за что заплатили.")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
                TextField("Зачем и кому", text: $comment, axis: .vertical)
                    .lineLimit(2...5)
                    .textFieldStyle(.plain)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.text)
                    .padding(Spacing.md)
                    .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
            }
        }
    }

    private var documentCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader("Чем подтверждён")

                Picker("Документ", selection: $documentKind) {
                    ForEach(ExpenseDocumentKind.allCases) { kind in
                        Text(kind.title).tag(kind)
                    }
                }
                .pickerStyle(.menu)

                switch documentKind {
                case .receipt, .invoice, .bill:
                    fileSection
                case .whitelist:
                    vendorSection
                case .oneOff:
                    oneOffSection
                }
            }
        }
    }

    @ViewBuilder
    private var fileSection: some View {
        let attached = model?.documentURLs ?? []

        VStack(alignment: .leading, spacing: Spacing.sm) {
            if attached.isEmpty {
                Text("Сфотографируйте документ или выберите файл из галереи.")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
            } else {
                StatRow("Приложено", value: "\(attached.count)", valueColor: Theme.positive, icon: "paperclip")
            }

            HStack(spacing: Spacing.sm) {
                #if os(iOS)
                Button {
                    isCameraOpen = true
                } label: {
                    Label("Сфотографировать", systemImage: "camera")
                }
                .buttonStyle(SecondaryButtonStyle())
                #endif

                Button {
                    isPickerOpen = true
                } label: {
                    Label("Из галереи", systemImage: "photo")
                }
                .buttonStyle(SecondaryButtonStyle())
            }

            if model?.isUploading == true {
                Text("Загружаем документ…")
                    .font(Typography.caption)
                    .foregroundStyle(Theme.textDim)
            }
            if let message = model?.uploadError {
                Text(message)
                    .font(Typography.caption)
                    .foregroundStyle(Theme.negative)
            }
        }
    }

    @ViewBuilder
    private var vendorSection: some View {
        let vendors = model?.vendors ?? []

        if vendors.isEmpty {
            Text("Доверенных поставщиков нет. Их заводят в разделе «Доверенные поставщики» — платёж такому поставщику не требует чека.")
                .font(Typography.caption)
                .foregroundStyle(Theme.textDim)
        } else {
            FieldLabel("Поставщик")
            Picker("Поставщик", selection: $vendorID) {
                Text("Не выбран").tag("")
                ForEach(vendors) { vendor in
                    Text(vendor.name).tag(vendor.id)
                }
            }
            .pickerStyle(.menu)
        }
    }

    private var oneOffSection: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            FieldLabel("Получатель")
            TextField("Кому заплатили", text: $payee)
                .textFieldStyle(.plain)
                .font(Typography.callout)
                .foregroundStyle(Theme.text)
                .padding(Spacing.md)
                .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))

            FieldLabel("Почему нет документа")
            Text("Не меньше 30 символов. Это единственный расход без подтверждения — объяснение читают при разборе.")
                .font(Typography.caption)
                .foregroundStyle(Theme.textDim)
            TextField("Причина", text: $reason, axis: .vertical)
                .lineLimit(2...5)
                .textFieldStyle(.plain)
                .font(Typography.callout)
                .foregroundStyle(Theme.text)
                .padding(Spacing.md)
                .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
        }
    }

    @ViewBuilder
    private var footer: some View {
        if ExpenseDraft.isBackdated(date) {
            Card(accent: Theme.warning) {
                Toggle(isOn: $backdatedConfirmed) {
                    Text("Это расход задним числом — подтверждаю")
                        .font(Typography.callout)
                        .foregroundStyle(Theme.text)
                }
            }
        }

        if let blocker = draft.validationMessage {
            Text(blocker)
                .font(Typography.callout)
                .foregroundStyle(Theme.warning)
                .frame(maxWidth: .infinity, alignment: .leading)
        }

        if let message = model?.submitError {
            Text(message)
                .font(Typography.callout)
                .foregroundStyle(Theme.negative)
                .frame(maxWidth: .infinity, alignment: .leading)
        }

        Button(model?.isSubmitting == true ? "Сохраняем…" : "Сохранить расход") {
            Task {
                guard let model else { return }
                if await model.submit(draft) {
                    Haptics.success()
                    await store.loadExpenses()
                    dismiss()
                }
            }
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(model?.isSubmitting == true || model?.isUploading == true || !draft.isValid)
    }

    // ── Состояние ────────────────────────────────────────────────────────────

    @State private var isPickerOpen = false

    private var pickerBinding: Binding<Bool> {
        Binding(get: { isPickerOpen }, set: { isPickerOpen = $0 })
    }

    /// Кому сервер разрешит завести себестоимость руками.
    ///
    /// Обычно её заводит приёмка, где есть накладная, и для остальных статья
    /// закрыта. Но владельцу сервер её принимает — и на сайте она у него в
    /// списке есть. В приложении список фильтровался у всех подряд, поэтому
    /// владелец видел подпись «здесь не заводятся» на своё же право.
    private var canPickCogs: Bool {
        guard let session = access?.session else { return false }
        return session.isSuperAdmin || session.staffRole == "owner"
    }

    private var selectableCategories: [ExpenseCategory] {
        let all = model?.categories ?? []
        return canPickCogs ? all : all.filter { !$0.isCogs }
    }

    /// Выбрана себестоимость — напоминаем, где ей место.
    private var picksCogs: Bool {
        selectableCategories.first { $0.id == categoryID }?.isCogs == true
    }

    private var draft: ExpenseDraft {
        var value = ExpenseDraft(date: Self.isoDay.string(from: date), companyID: companyID)
        value.categoryID = categoryID
        value.categoryName = selectableCategories.first { $0.id == categoryID }?.name ?? ""
        value.amountCash = AmountParsing.value(cash)
        value.amountKaspi = AmountParsing.value(kaspi)
        value.itemName = itemName
        value.comment = comment
        value.documentKind = documentKind
        value.documentURLs = model?.documentURLs ?? []
        value.whitelistVendorID = vendorID.isEmpty ? nil : vendorID
        value.oneOffPayee = payee
        value.oneOffReason = reason
        value.backdatedConfirmed = backdatedConfirmed
        return value
    }

    private func attach(_ item: PhotosPickerItem) async {
        guard let model else { return }
        guard let data = try? await item.loadTransferable(type: Data.self) else {
            model.reportUploadFailure("Не удалось прочитать файл")
            return
        }
        await model.attach(data: data, fileName: "document.jpg", mimeType: mime(of: data))
        photoItem = nil
    }

    /// Тип определяем по сигнатуре файла: сервер проверяет её же и отвергает
    /// несовпадение с заявленным. Галерея отдаёт и HEIC, и PNG.
    private func mime(of data: Data) -> String {
        let bytes = [UInt8](data.prefix(12))
        guard bytes.count >= 12 else { return "image/jpeg" }
        if bytes[0] == 0x89, bytes[1] == 0x50 { return "image/png" }
        if bytes[0] == 0x25, bytes[1] == 0x50 { return "application/pdf" }
        if bytes[0] == 0x52, bytes[1] == 0x49, bytes[8] == 0x57 { return "image/webp" }
        if bytes[4] == 0x66, bytes[5] == 0x74, bytes[6] == 0x79, bytes[7] == 0x70 { return "image/heic" }
        return "image/jpeg"
    }

    private static let isoDay: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()
}

// ── Модель формы ─────────────────────────────────────────────────────────────

@MainActor
@Observable
final class ExpenseFormModel {
    private(set) var categories: [ExpenseCategory] = []
    private(set) var vendors: [ExpenseVendor] = []
    private(set) var documentURLs: [String] = []
    private(set) var loadError: APIError?
    private(set) var uploadError: String?
    private(set) var submitError: String?
    private(set) var isUploading = false
    private(set) var isSubmitting = false

    private let service: ExpenseWizardService
    /// Сессия мастера. Открывается лениво — при первом документе или при
    /// отправке: заводить её на каждое открытие формы значит плодить мусор в
    /// таблице сессий у того, кто просто заглянул.
    private var sessionID: String?

    init(api: APIClient) {
        service = ExpenseWizardService(api: api)
    }

    func loadReferences() async {
        do {
            async let categoryList = service.categories()
            async let vendorList = service.vendors()
            categories = try await categoryList
            // Список доверенных поставщиков не обязателен: без права на него
            // форма всё равно работает, просто этот способ подтверждения
            // окажется пустым.
            vendors = (try? await vendorList) ?? []
            loadError = nil
        } catch let error as APIError {
            loadError = error
        } catch {
            loadError = .transport(message: error.localizedDescription)
        }
    }

    func attach(data: Data, fileName: String, mimeType: String) async {
        guard !isUploading else { return }
        isUploading = true
        defer { isUploading = false }
        uploadError = nil

        do {
            let session = try await ensureSession()
            documentURLs = try await service.upload(
                sessionID: session,
                fileData: data,
                fileName: fileName,
                mimeType: mimeType
            )
        } catch let error as APIError {
            uploadError = error.userMessage
        } catch {
            uploadError = error.localizedDescription
        }
    }

    func reportUploadFailure(_ message: String) {
        uploadError = message
    }

    func submit(_ draft: ExpenseDraft) async -> Bool {
        guard !isSubmitting else { return false }
        isSubmitting = true
        defer { isSubmitting = false }
        submitError = nil

        do {
            let session = try await ensureSession()
            try await service.submit(sessionID: session, draft: draft)
            // Сессия одноразовая: следующий расход начнётся с новой.
            sessionID = nil
            documentURLs = []
            return true
        } catch let error as APIError {
            submitError = error.userMessage
            // Истёкшую или использованную сессию сервер отдаёт как 410. Новая
            // попытка с тем же идентификатором обречена — сбрасываем.
            if case .conflict = error { sessionID = nil }
            return false
        } catch {
            submitError = error.localizedDescription
            return false
        }
    }

    private func ensureSession() async throws -> String {
        if let sessionID { return sessionID }
        let created = try await service.startSession()
        sessionID = created
        return created
    }
}
