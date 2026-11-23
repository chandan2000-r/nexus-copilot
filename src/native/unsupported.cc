// Placeholder so the addon builds on platforms without a capture-exclusion API (e.g. Linux).
#include <napi.h>

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("platform", "unsupported");
  return exports;
}

NODE_API_MODULE(nexus_native, Init)
