import AppKit

let args = CommandLine.arguments
guard args.count >= 3 else {
    FileHandle.standardError.write(
        "Usage: svg-to-png <input.svg> <size>:<output.png> [<size>:<output.png> ...]\n"
            .data(using: .utf8)!)
    exit(1)
}
let inputPath = args[1]
guard let image = NSImage(contentsOfFile: inputPath) else {
    FileHandle.standardError.write("Could not load image: \(inputPath)\n".data(using: .utf8)!)
    exit(1)
}

func render(size: Int, to outputPath: String) throws {
    guard
        let rep = NSBitmapImageRep(
            bitmapDataPlanes: nil,
            pixelsWide: size,
            pixelsHigh: size,
            bitsPerSample: 8,
            samplesPerPixel: 4,
            hasAlpha: true,
            isPlanar: false,
            colorSpaceName: .deviceRGB,
            bytesPerRow: 0,
            bitsPerPixel: 0)
    else {
        throw NSError(domain: "svg-to-png", code: 1)
    }
    let context = NSGraphicsContext(bitmapImageRep: rep)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    context.cgContext.clear(CGRect(x: 0, y: 0, width: size, height: size))
    image.draw(
        in: NSRect(x: 0, y: 0, width: size, height: size),
        from: .zero,
        operation: .sourceOver,
        fraction: 1.0)
    NSGraphicsContext.restoreGraphicsState()
    guard let pngData = rep.representation(using: .png, properties: [:]) else {
        throw NSError(domain: "svg-to-png", code: 2)
    }
    try pngData.write(to: URL(fileURLWithPath: outputPath))
}

for spec in args.dropFirst(2) {
    let parts = spec.split(separator: ":", maxSplits: 1)
    guard parts.count == 2, let size = Int(parts[0]) else {
        FileHandle.standardError.write("Bad spec: \(spec)\n".data(using: .utf8)!)
        exit(1)
    }
    do {
        try render(size: size, to: String(parts[1]))
    } catch {
        FileHandle.standardError.write("Render failed for \(spec): \(error)\n".data(using: .utf8)!)
        exit(1)
    }
}
