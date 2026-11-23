// Lists on-screen windows owned by a process and the sharing state the window server
// reports for them. kCGWindowSharingState 0 = none (excluded), 1 = read-only (normal).
//
//   swift scripts/inspect-windows-mac.swift "Nexus AI"
import CoreGraphics
import Foundation

let owner = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "Nexus AI"
let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
guard let list = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
  print("could not read window list"); exit(1)
}
var found = 0
for w in list {
  let name = w[kCGWindowOwnerName as String] as? String ?? ""
  guard name.localizedCaseInsensitiveContains(owner) || name == "Electron" else { continue }
  let id = w[kCGWindowNumber as String] as? Int ?? -1
  let sharing = w[kCGWindowSharingState as String] as? Int ?? -1
  let layer = w[kCGWindowLayer as String] as? Int ?? 0
  let b = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
  let label = sharing == 0 ? "NONE (excluded)" : sharing == 1 ? "READ_ONLY (capturable)" : "\(sharing)"
  print("window \(id) owner=\(name) layer=\(layer) bounds=\(b["X"] ?? 0),\(b["Y"] ?? 0) \(b["Width"] ?? 0)x\(b["Height"] ?? 0) sharingState=\(label)")
  found += 1
}
if found == 0 { print("no on-screen windows for \(owner)") }
