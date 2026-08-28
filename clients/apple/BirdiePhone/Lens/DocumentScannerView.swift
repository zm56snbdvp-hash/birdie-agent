import SwiftUI
import UIKit
import VisionKit

struct DocumentScannerView: UIViewControllerRepresentable {
    let onComplete: ([UIImage]) -> Void
    let onCancel: () -> Void
    let onFailure: (Error) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
        let controller = VNDocumentCameraViewController()
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ uiViewController: VNDocumentCameraViewController, context: Context) {}

    final class Coordinator: NSObject, VNDocumentCameraViewControllerDelegate {
        let parent: DocumentScannerView

        init(parent: DocumentScannerView) {
            self.parent = parent
        }

        func documentCameraViewController(
            _ controller: VNDocumentCameraViewController,
            didFinishWith scan: VNDocumentCameraScan
        ) {
            let images = (0..<scan.pageCount).map { scan.imageOfPage(at: $0) }
            controller.dismiss(animated: true) {
                self.parent.onComplete(images)
            }
        }

        func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
            controller.dismiss(animated: true, completion: parent.onCancel)
        }

        func documentCameraViewController(
            _ controller: VNDocumentCameraViewController,
            didFailWithError error: Error
        ) {
            controller.dismiss(animated: true) {
                self.parent.onFailure(error)
            }
        }
    }
}
