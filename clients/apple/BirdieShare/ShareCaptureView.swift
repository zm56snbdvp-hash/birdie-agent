import CaptureCore
import Foundation
import SwiftUI
import UIKit

struct ShareCaptureView: View {
    @ObservedObject var model: ShareCaptureModel

    var body: some View {
        NavigationStack {
            Group {
                switch model.phase {
                case .loading:
                    ProgressView("Inhalt wird lokal übernommen …")
                case .preview:
                    preview
                case .saving:
                    ProgressView("Wird vorgemerkt …")
                case .saved:
                    saved
                case .failed(let message):
                    failure(message)
                }
            }
            .padding()
            .navigationTitle("Birdie Drop")
            .toolbar {
                if model.showsCancellationAction {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Abbrechen", role: .cancel, action: model.cancel)
                    }
                }
            }
        }
        .privacySensitive()
        .overlay {
            if model.isObscured {
                PrivacyCover()
            }
        }
    }

    private var preview: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Label("Nur lokal vorgemerkt", systemImage: "lock.shield")
                    .font(.headline)
                Text("Keine Veröffentlichung und kein Upload. Prüfe die Vorschau und wähle genau ein Ziel.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                VStack(spacing: 10) {
                    ForEach(model.payloads) { payload in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(spacing: 12) {
                                if let thumbnail = model.thumbnails[payload.id] {
                                    Image(uiImage: thumbnail)
                                        .resizable()
                                        .scaledToFill()
                                        .frame(width: 58, height: 58)
                                        .clipShape(RoundedRectangle(cornerRadius: 8))
                                } else {
                                    Image(systemName: icon(for: payload.kind))
                                        .frame(width: 28)
                                }
                                VStack(alignment: .leading) {
                                    Text(payload.displayName).lineLimit(1)
                                    if let byteCount = payload.byteCount {
                                        Text(ByteCountFormatter.string(fromByteCount: byteCount, countStyle: .file))
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                Spacer()
                            }
                            if let preview = inlinePreview(for: payload) {
                                Text(preview)
                                    .font(.footnote)
                                    .lineLimit(5)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                        .padding(10)
                        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
                    }
                }

                Text("Ziel")
                    .font(.headline)
                ForEach(CaptureIntent.allCases, id: \.self) { intent in
                    Button {
                        model.selectedIntent = intent
                    } label: {
                        HStack {
                            Text(intent.title)
                            Spacer()
                            if model.selectedIntent == intent {
                                Image(systemName: "checkmark.circle.fill")
                            }
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.bordered)
                }

                Button("Lokal als „\(model.selectedIntent.title)“ übernehmen", action: model.commit)
                    .buttonStyle(.borderedProminent)
                    .frame(maxWidth: .infinity)
            }
        }
    }

    private var saved: some View {
        VStack(spacing: 18) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 52))
                .foregroundStyle(.green)
            Text("Sicher lokal vorgemerkt")
                .font(.title3.weight(.semibold))
            Text("Birdie bereitet „\(model.selectedIntent.title)“ nur zur Prüfung vor.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            Text("Öffne Birdie anschließend manuell. Der vorgemerkte Eintrag wird dort automatisch ausgewählt.")
                .font(.footnote)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            Button("Fertig", action: model.finish)
                .buttonStyle(.borderedProminent)
        }
    }

    private func failure(_ message: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 42))
                .foregroundStyle(.orange)
            Text(message)
                .multilineTextAlignment(.center)
            Button("Schließen", role: .cancel, action: model.cancel)
        }
    }

    private func icon(for kind: CapturePayloadKind) -> String {
        switch kind {
        case .url: "link"
        case .text, .recognizedText: "text.alignleft"
        case .image: "photo"
        case .pdf: "doc.richtext"
        case .file: "doc"
        }
    }

    private func inlinePreview(for payload: CapturePayload) -> String? {
        guard let text = payload.inlineText else { return nil }
        let preview: String
        if payload.kind == .url, var components = URLComponents(string: text) {
            let hidParameters = components.query != nil || components.fragment != nil
            components.user = nil
            components.password = nil
            components.query = nil
            components.fragment = nil
            preview = (components.string ?? text) + (hidParameters ? " · Parameter ausgeblendet" : "")
        } else {
            preview = LensAnalyzer.analyze(text: text, profile: .document).redactedText
        }
        return String(preview.prefix(600))
    }
}

private struct PrivacyCover: View {
    var body: some View {
        ZStack {
            Color(uiColor: .systemBackground).ignoresSafeArea()
            VStack(spacing: 12) {
                Image(systemName: "lock.shield.fill").font(.largeTitle)
                Text("Vorschau geschützt").font(.headline)
            }
        }
    }
}
