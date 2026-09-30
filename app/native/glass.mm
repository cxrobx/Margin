// WindowServer blur for this app's own window, matching CXTasks. Dynamic
// lookup keeps unavailable symbols a cosmetic fallback instead of a crash.
// Also app activation: the panel is non-activating, so without it the Edit
// menu shortcuts (⌘V, ⌘C, ⌘Z) go to whichever app was active before.
#import <AppKit/AppKit.h>
#include <node_api.h>
#include <dlfcn.h>
#include <cstring>
#include <algorithm>

using Connection = size_t;
using SetBlur = int (*)(Connection, int, int);
using GetConnection = Connection (*)();
static SetBlur blur() {
  static auto fn = reinterpret_cast<SetBlur>(dlsym(RTLD_DEFAULT, "CGSSetWindowBackgroundBlurRadius"));
  return fn;
}
static GetConnection connection() {
  static auto fn = [] {
    auto p = dlsym(RTLD_DEFAULT, "CGSDefaultConnectionForThread");
    return reinterpret_cast<GetConnection>(p ? p : dlsym(RTLD_DEFAULT, "CGSMainConnectionID"));
  }();
  return fn;
}
static napi_value Available(napi_env env, napi_callback_info info) {
  napi_value value; napi_get_boolean(env, blur() && connection(), &value); return value;
}
static napi_value Configure(napi_env env, napi_callback_info info) {
  size_t argc = 2; napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  bool buffer = false;
  if (argc != 2 || napi_is_buffer(env, args[0], &buffer) != napi_ok || !buffer || ![NSThread isMainThread]) {
    napi_throw_type_error(env, nullptr, "Expected this window's native handle and radius on the main thread"); return nullptr;
  }
  void* data = nullptr; size_t size = 0; int32_t radius = 0;
  if (napi_get_buffer_info(env, args[0], &data, &size) != napi_ok || size != sizeof(void*) || napi_get_value_int32(env, args[1], &radius) != napi_ok) {
    napi_throw_type_error(env, nullptr, "Invalid native window handle or radius"); return nullptr;
  }
  void* pointer = nullptr; std::memcpy(&pointer, data, sizeof(pointer));
  NSView* view = (__bridge NSView*)pointer;
  NSWindow* window = view ? [view window] : nil;
  int result = -1;
  // Window numbers are assigned when ordered in. Never pass zero to CGS.
  if (window && [window windowNumber] > 0 && blur() && connection()) {
    auto id = connection()();
    if (id) result = blur()(id, static_cast<int>([window windowNumber]), std::clamp(radius, 0, 64));
    if (result == 0 && radius > 0) [window invalidateShadow];
  }
  napi_value value; napi_create_int32(env, result, &value); return value;
}
static napi_value Pid(napi_env env, int32_t pid) {
  napi_value value; napi_create_int32(env, pid, &value); return value;
}
// The app to hand focus back to, or 0 when this app is already frontmost.
static napi_value Frontmost(napi_env env, napi_callback_info info) {
  NSRunningApplication* front = [[NSWorkspace sharedWorkspace] frontmostApplication];
  pid_t self = [[NSProcessInfo processInfo] processIdentifier];
  return Pid(env, front && [front processIdentifier] != self ? [front processIdentifier] : 0);
}
static napi_value Activate(napi_env env, napi_callback_info info) {
  [NSApp activateIgnoringOtherApps:YES];
  napi_value value; napi_get_boolean(env, true, &value); return value;
}
// Only while this app is still active: an app the user clicked into keeps focus.
static napi_value Restore(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value args[1]; int32_t pid = 0;
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  bool restored = false;
  if (argc == 1 && napi_get_value_int32(env, args[0], &pid) == napi_ok && pid > 0 && [NSApp isActive]) {
    NSRunningApplication* previous = [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
    if (previous && ![previous isTerminated]) restored = [previous activateWithOptions:0];
  }
  napi_value value; napi_get_boolean(env, restored, &value); return value;
}
static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    { "available", nullptr, Available, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "configure", nullptr, Configure, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "frontmost", nullptr, Frontmost, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "activate", nullptr, Activate, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "restore", nullptr, Restore, nullptr, nullptr, nullptr, napi_default, nullptr }
  };
  napi_define_properties(env, exports, 5, properties); return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
