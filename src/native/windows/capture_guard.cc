// Nexus AI – Windows capture exclusion.
//
// Uses the documented user32 API SetWindowDisplayAffinity:
//   * WDA_EXCLUDEFROMCAPTURE (0x11) – Windows 10 version 2004 (build 19041) and later.
//     The window is removed from captures but stays visible and interactive on screen.
//   * WDA_MONITOR (0x01) – older builds. The window appears as a black rectangle
//     in captures. We report this as "partial" and never claim it hides the window.
// The result is checked with GetWindowDisplayAffinity.

#include <windows.h>
#include <napi.h>
#include <string>

#ifndef WDA_EXCLUDEFROMCAPTURE
#define WDA_EXCLUDEFROMCAPTURE 0x00000011
#endif

namespace {

HWND WindowFromHandle(const Napi::Value& value) {
  if (!value.IsBuffer()) return nullptr;
  auto buf = value.As<Napi::Buffer<uint8_t>>();
  if (buf.Length() < sizeof(HWND)) return nullptr;
  HWND hwnd = *reinterpret_cast<HWND*>(buf.Data());
  return IsWindow(hwnd) ? hwnd : nullptr;
}

std::string OSVersion() {
  // RtlGetVersion is documented and, unlike GetVersionEx, is not affected by manifest shims.
  using RtlGetVersionFn = LONG(WINAPI*)(PRTL_OSVERSIONINFOW);
  HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
  if (!ntdll) return "unknown";
  auto fn = reinterpret_cast<RtlGetVersionFn>(GetProcAddress(ntdll, "RtlGetVersion"));
  if (!fn) return "unknown";
  RTL_OSVERSIONINFOW v{};
  v.dwOSVersionInfoSize = sizeof(v);
  if (fn(&v) != 0) return "unknown";
  return std::to_string(v.dwMajorVersion) + "." + std::to_string(v.dwMinorVersion) + "." +
         std::to_string(v.dwBuildNumber);
}

std::string MechanismName(DWORD affinity) {
  switch (affinity) {
    case WDA_EXCLUDEFROMCAPTURE: return "WDA_EXCLUDEFROMCAPTURE";
    case WDA_MONITOR: return "WDA_MONITOR";
    default: return "none";
  }
}

Napi::Object Result(Napi::Env env, bool ok, HWND hwnd, const std::string& detail) {
  Napi::Object out = Napi::Object::New(env);
  out.Set("ok", ok);
  out.Set("osVersion", OSVersion());
  DWORD affinity = WDA_NONE;
  if (hwnd && GetWindowDisplayAffinity(hwnd, &affinity)) {
    out.Set("rawValue", static_cast<double>(affinity));
    out.Set("mechanism", MechanismName(affinity));
    out.Set("excluded", affinity == WDA_EXCLUDEFROMCAPTURE);
  } else {
    out.Set("rawValue", env.Null());
    out.Set("mechanism", "none");
    out.Set("excluded", false);
  }
  out.Set("detail", detail);
  return out;
}

// setCaptureExcluded(handle: Buffer, excluded: boolean)
Napi::Value SetCaptureExcluded(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[1].IsBoolean()) return Result(env, false, nullptr, "expected (handle, boolean)");
  HWND hwnd = WindowFromHandle(info[0]);
  if (!hwnd) return Result(env, false, nullptr, "invalid HWND");

  bool excluded = info[1].As<Napi::Boolean>().Value();
  if (!excluded) {
    BOOL ok = SetWindowDisplayAffinity(hwnd, WDA_NONE);
    return Result(env, ok != FALSE, hwnd, ok ? "display affinity cleared" : "SetWindowDisplayAffinity(WDA_NONE) failed");
  }

  if (SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)) {
    return Result(env, true, hwnd, "WDA_EXCLUDEFROMCAPTURE applied");
  }
  DWORD err = GetLastError();
  // Builds older than Windows 10 2004 reject WDA_EXCLUDEFROMCAPTURE. Fall back to WDA_MONITOR.
  if (SetWindowDisplayAffinity(hwnd, WDA_MONITOR)) {
    return Result(env, true, hwnd,
                  "WDA_EXCLUDEFROMCAPTURE unsupported (error " + std::to_string(err) +
                      "); fell back to WDA_MONITOR (window shows as a black box in captures)");
  }
  return Result(env, false, hwnd, "SetWindowDisplayAffinity failed, error " + std::to_string(GetLastError()));
}

Napi::Value GetCaptureState(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1) return Result(env, false, nullptr, "expected (handle)");
  HWND hwnd = WindowFromHandle(info[0]);
  if (!hwnd) return Result(env, false, nullptr, "invalid HWND");
  return Result(env, true, hwnd, "read back with GetWindowDisplayAffinity");
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("platform", "win32");
  exports.Set("setCaptureExcluded", Napi::Function::New(env, SetCaptureExcluded));
  exports.Set("getCaptureState", Napi::Function::New(env, GetCaptureState));
  return exports;
}

}  // namespace

NODE_API_MODULE(nexus_native, Init)
