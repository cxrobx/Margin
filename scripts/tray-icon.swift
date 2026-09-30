import AppKit
import Foundation

let destination = URL(fileURLWithPath: CommandLine.arguments[1])
for scale in [1, 2] {
    let size = 22 * scale
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    let context = NSGraphicsContext(bitmapImageRep: bitmap)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    context.cgContext.scaleBy(x: CGFloat(scale), y: CGFloat(scale))
    NSColor.black.setStroke()
    let notebook = NSBezierPath(roundedRect: NSRect(x: 4, y: 3, width: 14, height: 16), xRadius: 3, yRadius: 3)
    notebook.lineWidth = 1.6; notebook.stroke()
    let lines = NSBezierPath()
    lines.lineWidth = 1.6; lines.lineCapStyle = .round
    lines.move(to: NSPoint(x: 8, y: 3)); lines.line(to: NSPoint(x: 8, y: 19))
    for (y, width) in [(14.0, 4.0), (11.0, 4.0), (8.0, 2.0)] {
        lines.move(to: NSPoint(x: 11, y: y)); lines.line(to: NSPoint(x: 11 + width, y: y))
    }
    lines.stroke()
    NSGraphicsContext.restoreGraphicsState()
    let name = scale == 1 ? "trayTemplate.png" : "trayTemplate@2x.png"
    try bitmap.representation(using: .png, properties: [:])!.write(to: destination.appendingPathComponent(name))
}
