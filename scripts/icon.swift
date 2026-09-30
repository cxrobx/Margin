import Foundation

// The approved raster master is the source of every exported icon size.
let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let source = CommandLine.arguments.count > 2
    ? URL(fileURLWithPath: CommandLine.arguments[2])
    : root.appendingPathComponent("assets/icon.png")
let destination = CommandLine.arguments.count > 1
    ? URL(fileURLWithPath: CommandLine.arguments[1])
    : root.appendingPathComponent("assets/icon.icns")
let exportingIconset = destination.pathExtension == "iconset"
let iconset = exportingIconset
    ? destination
    : FileManager.default.temporaryDirectory.appendingPathComponent("margin-" + UUID().uuidString + ".iconset")

func run(_ executable: String, _ arguments: [String]) throws {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    try process.run()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else {
        throw NSError(domain: "MarginIconExport", code: Int(process.terminationStatus),
                      userInfo: [NSLocalizedDescriptionKey: "Icon export failed: " + executable])
    }
}

do {
    guard FileManager.default.fileExists(atPath: source.path) else {
        throw NSError(domain: "MarginIconExport", code: 1,
                      userInfo: [NSLocalizedDescriptionKey: "Missing icon master: " + source.path])
    }
    try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
    defer { if !exportingIconset { try? FileManager.default.removeItem(at: iconset) } }
    let names: [Int: [String]] = [
        16: ["icon_16x16"], 32: ["icon_16x16@2x", "icon_32x32"],
        64: ["icon_32x32@2x"], 128: ["icon_128x128"],
        256: ["icon_128x128@2x", "icon_256x256"],
        512: ["icon_256x256@2x", "icon_512x512"], 1024: ["icon_512x512@2x"]
    ]
    for size in names.keys.sorted() {
        for name in names[size]! {
            try run("/usr/bin/sips", ["-z", String(size), String(size), source.path,
                                     "--out", iconset.appendingPathComponent(name + ".png").path])
        }
    }
    if !exportingIconset {
        try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
        try run("/usr/bin/iconutil", ["-c", "icns", iconset.path, "-o", destination.path])
    }
    print("Exported Margin icon: " + destination.path)
} catch {
    FileHandle.standardError.write(Data((error.localizedDescription + "\n").utf8))
    exit(1)
}
