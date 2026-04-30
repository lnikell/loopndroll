import AppKit
import Foundation

let fileManager = FileManager.default
let projectRoot = URL(fileURLWithPath: fileManager.currentDirectoryPath)
let defaultSource = "/Applications/Loopndroll.app/Contents/Resources/AppIcon.icns"
let sourcePath = CommandLine.arguments.dropFirst().first ?? defaultSource
let sourceURL = URL(fileURLWithPath: sourcePath)
let assetsURL = projectRoot.appendingPathComponent("src/assets", isDirectory: true)
let icnsURL = assetsURL.appendingPathComponent("AppIcon.icns")
let pngURL = assetsURL.appendingPathComponent("app-icon.png")

guard let sourceImage = NSImage(contentsOf: sourceURL) else {
  FileHandle.standardError.write(
    "Could not read installed app icon at \(sourcePath)\n".data(using: .utf8)!,
  )
  exit(1)
}

try fileManager.createDirectory(at: assetsURL, withIntermediateDirectories: true)
if fileManager.fileExists(atPath: icnsURL.path) {
  try fileManager.removeItem(at: icnsURL)
}
try fileManager.copyItem(at: sourceURL, to: icnsURL)

func pngData(from image: NSImage, pixels: Int) -> Data {
  guard
    let bitmap = NSBitmapImageRep(
      bitmapDataPlanes: nil,
      pixelsWide: pixels,
      pixelsHigh: pixels,
      bitsPerSample: 8,
      samplesPerPixel: 4,
      hasAlpha: true,
      isPlanar: false,
      colorSpaceName: .deviceRGB,
      bytesPerRow: 0,
      bitsPerPixel: 0,
    )
  else {
    fatalError("Could not create bitmap for \(pixels)x\(pixels)")
  }

  bitmap.size = NSSize(width: pixels, height: pixels)
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
  image.draw(
    in: NSRect(x: 0, y: 0, width: pixels, height: pixels),
    from: .zero,
    operation: .copy,
    fraction: 1.0,
  )
  NSGraphicsContext.restoreGraphicsState()

  guard let data = bitmap.representation(using: .png, properties: [:]) else {
    fatalError("Could not encode PNG for \(pixels)x\(pixels)")
  }
  return data
}

try pngData(from: sourceImage, pixels: 1024).write(to: pngURL)

print("Extracted installed app icon from \(sourcePath)")
