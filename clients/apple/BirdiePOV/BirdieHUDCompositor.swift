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

/// Renders the portrait Meta glasses feed into a Twitch-native landscape frame.
/// The POV stays uncropped in the center while a softened, brand-graded copy
/// fills the 16:9 canvas behind the native Birdie HUD.
/// Rendering is serialized off the caller's actor, while the Core Image
/// context, pixel-buffer pool and once-per-second text overlay are reused.
final class BirdieHUDCompositor: @unchecked Sendable {
    static let outputWidth = 1_920
    static let outputHeight = 1_080

    private static let outputSize = CGSize(
        width: CGFloat(outputWidth),
        height: CGFloat(outputHeight)
    )
    private static let outputBounds = CGRect(origin: .zero, size: outputSize)
    private static let backgroundRenderBounds = CGRect(
        x: 0,
        y: 0,
        width: outputWidth / 2,
        height: outputHeight / 2
    )
    private static let portraitBounds = CGRect(x: 656, y: 0, width: 608, height: 1_080)
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
                let rendered: CMSampleBuffer? = autoreleasepool { () -> CMSampleBuffer? in
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

        var outputImage = landscapeComposition(sourceImage)
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

    private func landscapeComposition(_ image: CIImage) -> CIImage {
        let background = aspectFill(image, into: Self.backgroundRenderBounds)
            .clampedToExtent()
            .applyingFilter(
                "CIGaussianBlur",
                parameters: [kCIInputRadiusKey: 22]
            )
            .applyingFilter(
                "CIColorControls",
                parameters: [
                    kCIInputSaturationKey: 0.72,
                    kCIInputBrightnessKey: -0.19,
                    kCIInputContrastKey: 0.96
                ]
            )
            .cropped(to: Self.backgroundRenderBounds)
            .transformed(by: CGAffineTransform(scaleX: 2, y: 2))
            .cropped(to: Self.outputBounds)

        let greenGrade = CIImage(
            color: CIColor(red: 0.008, green: 0.105, blue: 0.070, alpha: 0.42)
        ).cropped(to: Self.outputBounds)
        let gradedBackground = greenGrade.composited(over: background)
        let portraitPOV = aspectFill(image, into: Self.portraitBounds)
        return portraitPOV.composited(over: gradedBackground)
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
                CGRect(x: 54, y: 54, width: 540, height: 972),
                radius: 34,
                fill: deepGreen,
                stroke: gold
            )
            drawCard(
                CGRect(x: 1_326, y: 54, width: 540, height: 972),
                radius: 34,
                fill: deepGreen,
                stroke: gold
            )
            context.restoreGState()

            let outerFrame = UIBezierPath(
                roundedRect: CGRect(x: 22, y: 22, width: 1_876, height: 1_036),
                cornerRadius: 42
            )
            gold.withAlphaComponent(0.70).setStroke()
            outerFrame.lineWidth = 3
            outerFrame.stroke()

            let povFrame = UIBezierPath(
                roundedRect: CGRect(x: 640, y: 18, width: 640, height: 1_044),
                cornerRadius: 26
            )
            gold.withAlphaComponent(0.86).setStroke()
            povFrame.lineWidth = 4
            povFrame.stroke()

            gold.setFill()
            UIBezierPath(
                roundedRect: CGRect(x: 86, y: 90, width: 10, height: 118),
                cornerRadius: 5
            ).fill()

            drawText(
                "BIRDIE & BREAKFAST",
                in: CGRect(x: 126, y: 96, width: 420, height: 38),
                font: .systemFont(ofSize: 29, weight: .black),
                color: white,
                letterSpacing: 1.5
            )
            drawText(
                "FOUNDER POV",
                in: CGRect(x: 126, y: 146, width: 360, height: 28),
                font: .systemFont(ofSize: 19, weight: .bold),
                color: gold,
                letterSpacing: 3.0
            )
            drawText(
                clipped(descriptor.game, limit: 32, fallback: "LIVE POV").uppercased(),
                in: CGRect(x: 88, y: 510, width: 458, height: 30),
                font: .systemFont(ofSize: 20, weight: .bold),
                color: gold,
                letterSpacing: 1.7
            )
            drawText(
                clipped(descriptor.mission, limit: 58, fallback: "BIRDIE & BREAKFAST").uppercased(),
                in: CGRect(x: 88, y: 558, width: 458, height: 110),
                font: .systemFont(ofSize: 34, weight: .semibold),
                color: white
            )
            drawText(
                clipped(descriptor.handle, limit: 36, fallback: ""),
                in: CGRect(x: 88, y: 938, width: 458, height: 30),
                font: .systemFont(ofSize: 20, weight: .medium),
                color: secondary
            )

            drawCard(
                CGRect(x: 1_374, y: 96, width: 180, height: 54),
                radius: 27,
                fill: UIColor.black.withAlphaComponent(0.34),
                stroke: gold
            )
            brightGreen.setFill()
            UIBezierPath(ovalIn: CGRect(x: 1_398, y: 114, width: 16, height: 16)).fill()
            drawText(
                "LIVE",
                in: CGRect(x: 1_432, y: 107, width: 92, height: 34),
                font: .systemFont(ofSize: 23, weight: .bold),
                color: white,
                letterSpacing: 1.6
            )
            drawText(
                formatElapsed(elapsedSecond),
                in: CGRect(x: 1_374, y: 188, width: 444, height: 58),
                font: .monospacedDigitSystemFont(ofSize: 46, weight: .semibold),
                color: gold
            )
            drawText(
                "META GLASSES",
                in: CGRect(x: 1_374, y: 486, width: 444, height: 32),
                font: .systemFont(ofSize: 21, weight: .bold),
                color: secondary,
                letterSpacing: 2.1
            )
            drawText(
                "VERTICAL POV",
                in: CGRect(x: 1_374, y: 534, width: 444, height: 50),
                font: .systemFont(ofSize: 34, weight: .black),
                color: white
            )
            drawText(
                "1080P  ·  6 MBPS",
                in: CGRect(x: 1_374, y: 614, width: 444, height: 38),
                font: .monospacedSystemFont(ofSize: 24, weight: .bold),
                color: gold
            )
            drawText(
                "UNCROPPED POV\nTWITCH 16:9 CANVAS",
                in: CGRect(x: 1_374, y: 884, width: 444, height: 70),
                font: .systemFont(ofSize: 21, weight: .semibold),
                color: secondary
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
        (CGPoint(x: 626, y: 46), CGPoint(x: 626, y: 112), CGPoint(x: 692, y: 46)),
        (CGPoint(x: 1_294, y: 46), CGPoint(x: 1_294, y: 112), CGPoint(x: 1_228, y: 46)),
        (CGPoint(x: 626, y: 1_034), CGPoint(x: 626, y: 968), CGPoint(x: 692, y: 1_034)),
        (CGPoint(x: 1_294, y: 1_034), CGPoint(x: 1_294, y: 968), CGPoint(x: 1_228, y: 1_034))
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
