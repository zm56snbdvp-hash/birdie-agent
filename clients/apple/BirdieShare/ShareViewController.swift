import CaptureCore
import SwiftUI
import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    private var model: ShareCaptureModel?

    override func viewDidLoad() {
        super.viewDidLoad()

        guard let context = extensionContext,
              let groupIdentifier = Bundle.main.object(
                forInfoDictionaryKey: "BirdieAppGroupIdentifier"
              ) as? String else {
            showConfigurationError()
            return
        }

        do {
            let locations = try CaptureStoreLocations.appGroup(groupIdentifier)
            let store = try CaptureQueueStore(locations: locations)
            let model = ShareCaptureModel(
                extensionContext: context,
                store: store,
                stager: CaptureFileStager(locations: locations)
            )
            self.model = model

            let host = UIHostingController(rootView: ShareCaptureView(model: model))
            addChild(host)
            host.view.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(host.view)
            NSLayoutConstraint.activate([
                host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                host.view.topAnchor.constraint(equalTo: view.topAnchor),
                host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor)
            ])
            host.didMove(toParent: self)
            model.load(inputItems: context.inputItems)
        } catch {
            showConfigurationError(message: error.localizedDescription)
        }
    }

    private func showConfigurationError(message: String = "Birdie Drop ist nicht korrekt konfiguriert.") {
        let label = UILabel()
        label.text = message
        label.numberOfLines = 0
        label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            label.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])
    }
}
