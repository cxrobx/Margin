// WindowServer blur for this app's own window, matching CXTasks. Dynamic
// lookup keeps unavailable symbols a cosmetic fallback instead of a crash.
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
static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    { "available", nullptr, Available, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "configure", nullptr, Configure, nullptr, nullptr, nullptr, napi_default, nullptr }
  };
  napi_define_properties(env, exports, 2, properties); return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
