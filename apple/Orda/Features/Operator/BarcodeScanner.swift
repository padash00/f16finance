import OrdaUI
import SwiftUI

#if os(iOS)
import VisionKit

/// Непрерывный сканер штрихкодов.
///
/// Ключевое слово — непрерывный. Схема «навёл → снял → распознал → закрыл»
/// превращает ревизию на 800 позиций в многочасовую пытку. Здесь камера
/// остаётся открытой, а товары падают в список один за другим: сканируешь
/// поток, не отрывая рук.
///
/// `DataScannerViewController` работает не на всех устройствах (нужен
/// нейронный движок), поэтому вызывающий обязан иметь ручной ввод как запасной
/// путь — см. `isScanningSupported`.
struct BarcodeScanner: UIViewControllerRepresentable {
    /// Вызывается на каждый распознанный код. Дедупликацию делает вызывающий.
    let onScan: (String) -> Void

    /// Поддерживает ли устройство сканирование прямо сейчас.
    static var isSupported: Bool {
        DataScannerViewController.isSupported && DataScannerViewController.isAvailable
    }

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let controller = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [
                .ean13, .ean8, .upce, .code128, .code39, .code93, .itf14, .qr,
            ])],
            qualityLevel: .balanced,
            recognizesMultipleItems: false,
            isHighFrameRateTrackingEnabled: true,
            isHighlightingEnabled: true
        )
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: DataScannerViewController, context: Context) {
        context.coordinator.onScan = onScan
        if !controller.isScanning {
            try? controller.startScanning()
        }
    }

    static func dismantleUIViewController(_ controller: DataScannerViewController, coordinator: Coordinator) {
        controller.stopScanning()
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onScan: onScan)
    }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        var onScan: (String) -> Void
        /// Последний код и время — камера видит один и тот же штрихкод десятки
        /// раз в секунду, и без этого одна бутылка попала бы в чек сорок раз.
        private var lastCode: String?
        private var lastAt = Date.distantPast

        init(onScan: @escaping (String) -> Void) {
            self.onScan = onScan
        }

        func dataScanner(_ scanner: DataScannerViewController, didAdd items: [RecognizedItem], allItems: [RecognizedItem]) {
            handle(items)
        }

        func dataScanner(_ scanner: DataScannerViewController, didTapOn item: RecognizedItem) {
            handle([item])
        }

        private func handle(_ items: [RecognizedItem]) {
            for item in items {
                guard case let .barcode(barcode) = item,
                      let value = barcode.payloadStringValue?.trimmingCharacters(in: .whitespacesAndNewlines),
                      !value.isEmpty
                else { continue }

                // Тот же код принимаем повторно не чаще раза в полторы секунды.
                // Этого хватает, чтобы намеренно отсканировать две одинаковые
                // бутылки, и достаточно, чтобы отсечь дребезг камеры.
                let now = Date()
                if value == lastCode, now.timeIntervalSince(lastAt) < 1.5 { continue }
                lastCode = value
                lastAt = now

                onScan(value)
            }
        }
    }
}
#endif

/// Обёртка сканера с запасным ручным вводом.
///
/// На Mac и на старых устройствах камеры для непрерывного сканирования нет —
/// там сразу показываем поле ввода. Оно же нужно, когда штрихкод затёрт.
struct ScannerPane: View {
    let onCode: (String) -> Void

    @State private var manualCode = ""
    @FocusState private var manualFocused: Bool

    var body: some View {
        VStack(spacing: Spacing.md) {
            #if os(iOS)
            if BarcodeScanner.isSupported {
                BarcodeScanner(onScan: onCode)
                    .frame(height: 240)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: Radius.lg, style: .continuous)
                            .strokeBorder(Theme.brand.opacity(0.4), lineWidth: 1)
                    }
            } else {
                unsupportedNotice
            }
            #else
            unsupportedNotice
            #endif

            HStack(spacing: Spacing.sm) {
                TextField("Штрихкод вручную", text: $manualCode)
                    .textFieldStyle(.plain)
                    .focused($manualFocused)
                    .monospaced()
                    #if os(iOS)
                    .keyboardType(.numbersAndPunctuation)
                    .textInputAutocapitalization(.never)
                    #endif
                    .autocorrectionDisabled()
                    .onSubmit(submitManual)

                Button("Найти", action: submitManual)
                    .buttonStyle(.plain)
                    .font(Typography.callout.weight(.semibold))
                    .foregroundStyle(manualCode.isEmpty ? Theme.textDim : Theme.brand)
                    .disabled(manualCode.isEmpty)
            }
            .padding(Spacing.md)
            .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
        }
    }

    private var unsupportedNotice: some View {
        HStack(spacing: Spacing.md) {
            Image(systemName: "keyboard")
                .foregroundStyle(Theme.textDim)
            Text("Сканер камеры недоступен — введите штрихкод или найдите товар в списке.")
                .font(Typography.caption)
                .foregroundStyle(Theme.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Spacing.md)
        .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
    }

    private func submitManual() {
        let code = manualCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !code.isEmpty else { return }
        onCode(code)
        manualCode = ""
        manualFocused = true
    }
}
