// Nexus AI – macOS capture exclusion.
//
// Uses the public AppKit API -[NSWindow setSharingType:] with NSWindowSharingNone.
// No private APIs and no window-server hacks. The NSWindow is taken from the
// NSView* that Electron gives us through BrowserWindow.getNativeWindowHandle().
//
// All functions must be called on the main thread, which is where the Electron
// main-process JavaScript runs on macOS.

#import <AppKit/AppKit.h>
#include <napi.h>

namespace {

NSWindow* WindowFromHandle(const Napi::Value& value) {
  if (!value.IsBuffer()) return nil;
  auto buf = value.As<Napi::Buffer<uint8_t>>();
  if (buf.Length() < sizeof(void*)) return nil;
  void* raw = *reinterpret_cast<void**>(buf.Data());
  if (raw == nullptr) return nil;
  id object = (__bridge id)raw;
  if ([object isKindOfClass:[NSWindow class]]) return (NSWindow*)object;
  if ([object isKindOfClass:[NSView class]]) return [(NSView*)object window];
  return nil;
}

std::string OSVersion() {
  NSOperatingSystemVersion v = [[NSProcessInfo processInfo] operatingSystemVersion];
  return std::to_string(v.majorVersion) + "." + std::to_string(v.minorVersion) + "." +
         std::to_string(v.patchVersion);
}

Napi::Object Result(Napi::Env env, bool ok, NSWindow* window, const std::string& detail) {
  Napi::Object out = Napi::Object::New(env);
  out.Set("ok", ok);
  out.Set("mechanism", "NSWindowSharingNone");
  out.Set("osVersion", OSVersion());
  if (window != nil) {
    NSWindowSharingType type = [window sharingType];
    out.Set("rawValue", static_cast<double>(type));
    out.Set("excluded", type == NSWindowSharingNone);
  } else {
    out.Set("rawValue", env.Null());
    out.Set("excluded", false);
  }
  out.Set("detail", detail);
  return out;
}

// setCaptureExcluded(handle: Buffer, excluded: boolean)
Napi::Value SetCaptureExcluded(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (![NSThread isMainThread]) return Result(env, false, nil, "not called on the main thread");
  if (info.Length() < 2 || !info[1].IsBoolean()) return Result(env, false, nil, "expected (handle, boolean)");

  NSWindow* window = WindowFromHandle(info[0]);
  if (window == nil) return Result(env, false, nil, "could not resolve NSWindow from native handle");

  bool excluded = info[1].As<Napi::Boolean>().Value();
  [window setSharingType:excluded ? NSWindowSharingNone : NSWindowSharingReadOnly];

  // Verify by reading the value back from AppKit.
  bool applied = ([window sharingType] == NSWindowSharingNone) == excluded;
  return Result(env, applied, window, applied ? "sharingType applied and verified" : "sharingType did not stick");
}

// getCaptureState(handle: Buffer)
Napi::Value GetCaptureState(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (![NSThread isMainThread]) return Result(env, false, nil, "not called on the main thread");
  if (info.Length() < 1) return Result(env, false, nil, "expected (handle)");
  NSWindow* window = WindowFromHandle(info[0]);
  if (window == nil) return Result(env, false, nil, "could not resolve NSWindow from native handle");
  return Result(env, true, window, "read back from AppKit");
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("platform", "darwin");
  exports.Set("setCaptureExcluded", Napi::Function::New(env, SetCaptureExcluded));
  exports.Set("getCaptureState", Napi::Function::New(env, GetCaptureState));
  return exports;
}

}  // namespace

NODE_API_MODULE(nexus_native, Init)
