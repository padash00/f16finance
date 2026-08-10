#if os(iOS)
import SwiftUI
import UIKit

/// Съёмка документа камерой.
///
/// Ради этого расход и заводят с телефона: чек фотографируют там же, где
/// платят, а не переносят домой в кармане, чтобы потом не найти.
///
/// Системная камера, а не своя на AVFoundation: собственный видоискатель здесь
/// не даёт ничего, кроме нового кода, который придётся чинить.
struct CameraCapture: UIViewControllerRepresentable {
    let onCapture: (Data) -> Void

    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        // На симуляторе камеры нет — там открывается галерея, иначе экран
        // остался бы чёрным и выглядел бы поломкой.
        picker.sourceType = UIImagePickerController.isSourceTypeAvailable(.camera) ? .camera : .photoLibrary
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(onCapture: onCapture, onFinish: { dismiss() })
    }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        private let onCapture: (Data) -> Void
        private let onFinish: () -> Void

        init(onCapture: @escaping (Data) -> Void, onFinish: @escaping () -> Void) {
            self.onCapture = onCapture
            self.onFinish = onFinish
        }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            // Сжимаем: снимок с камеры весит несколько мегабайт, а предел
            // сервера — десять. Качества 0.8 хватает, чтобы прочитать сумму на
            // чеке, и это единственное, ради чего его снимают.
            if let image = info[.originalImage] as? UIImage,
               let data = image.jpegData(compressionQuality: 0.8) {
                onCapture(data)
            }
            onFinish()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            onFinish()
        }
    }
}
#endif
