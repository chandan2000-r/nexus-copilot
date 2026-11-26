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

// setToolWindow(handle: Buffer, on: boolean): boolean
// WS_EX_TOOLWINDOW keeps the window out of Alt+Tab, Task View and the taskbar (it stays visible and
// usable on screen). WS_EX_APPWINDOW would force it back in, so it is cleared. Returns whether the
// style is set afterwards, read back from the window.
Napi::Value SetToolWindow(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[1].IsBoolean()) return Napi::Boolean::New(env, false);
  HWND hwnd = WindowFromHandle(info[0]);
  if (!hwnd) return Napi::Boolean::New(env, false);
  const bool on = info[1].As<Napi::Boolean>().Value();
  const LONG_PTR ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
  const LONG_PTR next = on ? ((ex | WS_EX_TOOLWINDOW) & ~static_cast<LONG_PTR>(WS_EX_APPWINDOW))
                           : (ex & ~static_cast<LONG_PTR>(WS_EX_TOOLWINDOW));
  if (next != ex) {
    SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next);
    // Style changes take effect after the frame is recalculated.
    SetWindowPos(hwnd, nullptr, 0, 0, 0, 0,
                 SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
  }
  return Napi::Boolean::New(env, (GetWindowLongPtrW(hwnd, GWL_EXSTYLE) & WS_EX_TOOLWINDOW) != 0);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("platform", "win32");
  exports.Set("setToolWindow", Napi::Function::New(env, SetToolWindow));
  exports.Set("setCaptureExcluded", Napi::Function::New(env, SetCaptureExcluded));
  exports.Set("getCaptureState", Napi::Function::New(env, GetCaptureState));
  return exports;
}

}  // namespace

NODE_API_MODULE(nexus_native, Init)
