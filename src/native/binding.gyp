{
  "targets": [
    {
      "target_name": "nexus_native",
      "include_dirs": ["<!(node -p \"require('node-addon-api').include_dir\")"],
      "defines": ["NAPI_VERSION=8", "NAPI_DISABLE_CPP_EXCEPTIONS"],
      "conditions": [
        ["OS=='mac'", {
          "sources": ["macos/capture_guard.mm"],
          "xcode_settings": {
            "MACOSX_DEPLOYMENT_TARGET": "12.0",
            "CLANG_CXX_LANGUAGE_STANDARD": "c++20",
            "CLANG_ENABLE_OBJC_ARC": "YES",
            "OTHER_LDFLAGS": ["-framework AppKit"]
          }
        }],
        ["OS=='win'", {
          "sources": ["windows/capture_guard.cc"],
          "libraries": ["user32.lib"],
          "defines": ["WIN32_LEAN_AND_MEAN", "NOMINMAX", "UNICODE", "_UNICODE"],
          "msvs_settings": { "VCCLCompilerTool": { "AdditionalOptions": ["/std:c++20"] } }
        }],
        ["OS!='mac' and OS!='win'", {
          "sources": ["unsupported.cc"]
        }]
      ]
    }
  ]
}
