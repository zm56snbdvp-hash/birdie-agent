@preconcurrency import AVFoundation
import CoreGraphics
import CoreImage
import CoreMedia
import CoreVideo
import Foundation
import UIKit

struct BirdieHUDDescriptor: Hashable, Sendable {
    let isEnabled: Bool
    let title: String
    let game: String
    let mission: String
    let handle: String
}

/// Renders the Meta glasses feed and Birdie HUD into a portrait Full HD frame.
/// Rendering is serialized off the caller's actor, while the Core Image
/// context, pixel-buffer pool and once-per-second text overlay are reused.
final class BirdieHUDCompositor: @unchecked Sendable {
    static let outputWidth = 1_080
    static let outputHeight = 1_920

    private static let outputSize = CGSize(
        width: CGFloat(outputWidth),
        height: CGFloat(outputHeight)
    )
    private static let outputBounds = CGRect(origin: .zero, size: outputSize)
    private static let renderColorSpace = CGColorSpace(name: CGColorSpace.sRGB)
        ?? CGColorSpaceCreateDeviceRGB()

    private struct OverlayCacheKey: Hashable {
        let descriptor: BirdieHUDDescriptor
        let elapsedSecond: Int
    }

    private struct SampleBufferBox: @unchecked Sendable {
        let value: CMSampleBuffer?
    }

    private let renderQueue = DispatchQueue(
        label: "de.birdieandbreakfast.pov.hud-compositor",
        qos: .userInitiated
    )
    private let context = CIContext(options: [
        .cacheIntermediates: false,
        .useSoftwareRenderer: false
    ])
    private let outputPool: CVPixelBufferPool?

    // Access is confined to renderQueue.
    private var cachedOverlay: (key: OverlayCacheKey, image: CIImage)?

    init() {
        outputPool = Self.makeOutputPool()
    }

    func composite(
        _ sampleBuffer: CMSampleBuffer,
        descriptor: BirdieHUDDescriptor,
        elapsed: TimeInterval
    ) async -> CMSampleBuffer? {
        let input = SampleBufferBox(value: sampleBuffer)
        let result: SampleBufferBox = await withCheckedContinuation { continuation in
            renderQueue.async { [self, input, descriptor, elapsed] in
                let rendered = autoreleasepool {
                    guard let sampleBuffer = input.value else { return nil }
                    return render(
                        sampleBuffer,
                        descriptor: descriptor,
                        elapsed: elapsed
                    )
                }
                continuation.resume(returning: SampleBufferBox(value: rendered))
            }
        }
        return result.value
    }

    private func render(
        _ sampleBuffer: CMSampleBuffer,
        descriptor: BirdieHUDDescriptor,
        elapsed: TimeInterval
    ) -> CMSampleBuffer? {
        guard
            CMSampleBufferDataIsReady(sampleBuffer),
            let sourcePixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer),
            let outputPool
        else {
            return nil
        }

        var outputPixelBuffer: CVPixelBuffer?
        guard
            CVPixelBufferPoolCreatePixelBuffer(
                kCFAllocatorDefault,
                outputPool,
                &outputPixelBuffer
            ) == kCVReturnSuccess,
            let outputPixelBuffer
        else {
            return nil
        }

        let sourceImage = CIImage(cvPixelBuffer: sourcePixelBuffer)
        guard sourceImage.extent.width > 0, sourceImage.extent.height > 0 else {
            return nil
        }

        var outputImage = aspectFill(sourceImage, into: Self.outputBounds)
        if descriptor.isEnabled {
            guard let overlay = overlayImage(
                descriptor: descriptor,
                elapsedSecond: Self.elapsedSecond(from: elapsed)
            ) else {
                return nil
            }
            outputImage = overlay.composited(over: outputImage)
        }

        context.render(
            outputImage.cropped(to: Self.outputBounds),
            to: outputPixelBuffer,
            bounds: Self.outputBounds,
            colorSpace: Self.renderColorSpace
        )
        CVBufferPropagateAttachments(sourcePixelBuffer, outputPixelBuffer)

        return makeSampleBuffer(
            from: sampleBuffer,
            imageBuffer: outputPixelBuffer
        )
    }

    private func aspectFill(_ image: CIImage, into bounds: CGRect) -> CIImage {
        let extent = image.extent
        let normalized = image.transformed(
            by: CGAffineTransform(
                translationX: -extent.minX,
                y: -extent.minY
            )
        )
        let scale = max(
            bounds.width / extent.width,
            bounds.height / extent.height
        )
        let scaled = normalized.transformed(
            by: CGAffineTransform(scaleX: scale, y: scale)
        )
        return scaled
            .transformed(
                by: CGAffineTransform(
                    translationX: bounds.minX + ((bounds.width - scaled.extent.width) / 2),
                    y: bounds.minY + ((bounds.height - scaled.extent.height) / 2)
                )
            )
            .cropped(to: bounds)
    }

    private func overlayImage(
        descriptor: BirdieHUDDescriptor,
        elapsedSecond: Int
    ) -> CIImage? {
        let key = OverlayCacheKey(
            descriptor: descriptor,
            elapsedSecond: elapsedSecond
        )
        if cachedOverlay?.key == key {
            return cachedOverlay?.image
        }

        guard let cgImage = Self.drawOverlay(
            descriptor: descriptor,
            elapsedSecond: elapsedSecond
        ) else {
            return nil
        }
        let image = CIImage(cgImage: cgImage).cropped(to: Self.outputBounds)
        cachedOverlay = (key, image)
        return image
    }

    private static func drawOverlay(
        descriptor: BirdieHUDDescriptor,
        elapsedSecond: Int
    ) -> CGImage? {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = false
        format.preferredRange = .standard

        let renderer = UIGraphicsImageRenderer(size: outputSize, format: format)
        let image = renderer.image { rendererContext in
            let context = rendererContext.cgContext
            let deepGreen = UIColor(red: 0.01, green: 0.13, blue: 0.09, alpha: 0.88)
            let brightGreen = UIColor(red: 0.16, green: 0.75, blue: 0.45, alpha: 0.98)
            let gold = UIColor(red: 0.87, green: 0.71, blue: 0.28, alpha: 0.98)
            let white = UIColor.white.withAlphaComponent(0.97)
            let secondary = UIColor.white.withAlphaComponent(0.70)

            context.saveGState()
            context.setShadow(
                offset: CGSize(width: 0, height: 12),
                blur: 28,
                color: UIColor.black.withAlphaComponent(0.42).cgColor
            )
            drawCard(
                CGRect(x: 42, y: 42, width: 996, height: 126),
                radius: 30,
                fill: deepGreen,
                stroke: gold
            )
            drawCard(
                CGRect(x: 42, y: 1_642, width: 996, height: 236),
                radius: 34,
                fill: deepGreen,
                stroke: gold
            )
            context.restoreGState()

            let frame = UIBezierPath(
                roundedRect: CGRect(x: 22, y: 22, width: 1_036, height: 1_876),
                cornerRadius: 42
            )
            gold.withAlphaComponent(0.72).setStroke()
            frame.lineWidth = 3
            frame.stroke()

            let accent = UIBezierPath(
                roundedRect: CGRect(x: 42, y: 42, width: 10, height: 126),
                cornerRadius: 5
            )
            gold.setFill()
            accent.fill()

            drawText(
                "BIRDIE POV",
                in: CGRect(x: 78, y: 66, width: 240, height: 28),
                font: .systemFont(ofSize: 20, weight: .black),
                color: gold,
                letterSpacing: 2.2
            )
            drawText(
                clipped(descriptor.title, limit: 48, fallback: "BIRDIE & BREAKFAST"),
                in: CGRect(x: 78, y: 98, width: 610, height: 46),
                font: .systemFont(ofSize: 34, weight: .semibold),
                color: white
            )
            drawText(
                clipped(descriptor.handle, limit: 36, fallback: ""),
                in: CGRect(x: 690, y: 88, width: 310, height: 34),
                font: .systemFont(ofSize: 21, weight: .medium),
                color: secondary,
                alignment: .right
            )

            drawCard(
                CGRect(x: 76, y: 1_676, width: 138, height: 46),
                radius: 23,
                fill: UIColor.black.withAlphaComponent(0.34),
                stroke: gold
            )
            brightGreen.setFill()
            UIBezierPath(ovalIn: CGRect(x: 94, y: 1_692, width: 14, height: 14)).fill()
            drawText(
                "LIVE",
                in: CGRect(x: 119, y: 1_683, width: 72, height: 30),
                font: .systemFont(ofSize: 20, weight: .bold),
                color: white,
                letterSpacing: 1.3
            )
            drawText(
                formatElapsed(elapsedSecond),
                in: CGRect(x: 760, y: 1_681, width: 240, height: 35),
                font: .monospacedDigitSystemFont(ofSize: 26, weight: .semibold),
                color: gold,
                alignment: .right
            )
            drawText(
                clipped(descriptor.game, limit: 36, fallback: "LIVE POV").uppercased(),
                in: CGRect(x: 76, y: 1_744, width: 904, height: 28),
                font: .systemFont(ofSize: 20, weight: .bold),
                color: gold,
                letterSpacing: 1.8
            )
            drawText(
                clipped(
                    descriptor.mission,
                    limit: 72,
                    fallback: "BIRDIE & BREAKFAST — FOUNDER LIVE"
                ).uppercased(),
                in: CGRect(x: 76, y: 1_782, width: 904, height: 56),
                font: .systemFont(ofSize: 30, weight: .semibold),
                color: white
            )

            context.setStrokeColor(gold.cgColor)
            context.setLineWidth(5)
            context.setLineCap(.round)
            for corner in cornerSegments {
                context.beginPath()
                context.move(to: corner.0)
                context.addLine(to: corner.1)
                context.move(to: corner.0)
                context.addLine(to: corner.2)
                context.strokePath()
            }
        }
        return image.cgImage
    }

    private static let cornerSegments: [(CGPoint, CGPoint, CGPoint)] = [
        (CGPoint(x: 38, y: 220), CGPoint(x: 38, y: 286), CGPoint(x: 104, y: 220)),
        (CGPoint(x: 1_042, y: 220), CGPoint(x: 1_042, y: 286), CGPoint(x: 976, y: 220)),
        (CGPoint(x: 38, y: 1_566), CGPoint(x: 38, y: 1_500), CGPoint(x: 104, y: 1_566)),
        (CGPoint(x: 1_042, y: 1_566), CGPoint(x: 1_042, y: 1_500), CGPoint(x: 976, y: 1_566))
    ]

    private static func drawCard(
        _ rect: CGRect,
        radius: CGFloat,
        fill: UIColor,
        stroke: UIColor
    ) {
        let path = UIBezierPath(roundedRect: rect, cornerRadius: radius)
        fill.setFill()
        path.fill()
        stroke.withAlphaComponent(0.55).setStroke()
        path.lineWidth = 2
        path.stroke()
    }

    private static func drawText(
        _ text: String,
        in rect: CGRect,
        font: UIFont,
        color: UIColor,
        alignment: NSTextAlignment = .left,
        letterSpacing: CGFloat = 0
    ) {
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = alignment
        paragraph.lineBreakMode = .byTruncatingTail

        (text as NSString).draw(
            with: rect,
            options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine],
            attributes: [
                .font: font,
                .foregroundColor: color,
                .paragraphStyle: paragraph,
                .kern: letterSpacing
            ],
            context: nil
        )
    }

    private static func clipped(
        _ value: String,
        limit: Int,
        fallback: String
    ) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? fallback : String(trimmed.prefix(limit))
    }

    private static func elapsedSecond(from elapsed: TimeInterval) -> Int {
        guard elapsed.isFinite, elapsed > 0 else { return 0 }
        return min(Int(elapsed.rounded(.down)), 359_999)
    }

    private static func formatElapsed(_ elapsedSecond: Int) -> String {
        let hours = elapsedSecond / 3_600
        let minutes = (elapsedSecond % 3_600) / 60
        let seconds = elapsedSecond % 60
        return String(format: "%02d:%02d:%02d", hours, minutes, seconds)
    }

    private static func makeOutputPool() -> CVPixelBufferPool? {
        let poolAttributes: [CFString: Any] = [
            kCVPixelBufferPoolMinimumBufferCountKey: 4
        ]
        let pixelAttributes: [CFString: Any] = [
            kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey: outputWidth,
            kCVPixelBufferHeightKey: outputHeight,
            kCVPixelBufferBytesPerRowAlignmentKey: 64,
            kCVPixelBufferCGImageCompatibilityKey: true,
            kCVPixelBufferCGBitmapContextCompatibilityKey: true,
            kCVPixelBufferMetalCompatibilityKey: true,
            kCVPixelBufferIOSurfacePropertiesKey: [:] as [String: Any]
        ]

        var pool: CVPixelBufferPool?
        guard CVPixelBufferPoolCreate(
            kCFAllocatorDefault,
            poolAttributes as CFDictionary,
            pixelAttributes as CFDictionary,
            &pool
        ) == kCVReturnSuccess else {
            return nil
        }
        return pool
    }

    private func makeSampleBuffer(
        from source: CMSampleBuffer,
        imageBuffer: CVPixelBuffer
    ) -> CMSampleBuffer? {
        var formatDescription: CMVideoFormatDescription?
        guard CMVideoFormatDescriptionCreateForImageBuffer(
            allocator: kCFAllocatorDefault,
            imageBuffer: imageBuffer,
            formatDescriptionOut: &formatDescription
        ) == noErr, let formatDescription else {
            return nil
        }

        var timing = CMSampleTimingInfo(
            duration: CMSampleBufferGetDuration(source),
            presentationTimeStamp: CMSampleBufferGetPresentationTimeStamp(source),
            decodeTimeStamp: CMSampleBufferGetDecodeTimeStamp(source)
        )
        var sourceTiming = timing
        if CMSampleBufferGetSampleTimingInfo(
            source,
            at: 0,
            timingInfoOut: &sourceTiming
        ) == noErr {
            timing = sourceTiming
        }

        var output: CMSampleBuffer?
        guard CMSampleBufferCreateReadyWithImageBuffer(
            allocator: kCFAllocatorDefault,
            imageBuffer: imageBuffer,
            formatDescription: formatDescription,
            sampleTiming: &timing,
            sampleBufferOut: &output
        ) == noErr, let output else {
            return nil
        }

        CMPropagateAttachments(source, destination: output)
        return output
    }
}
