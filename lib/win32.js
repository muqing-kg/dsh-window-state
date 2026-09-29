/**
 * user32.dll 的最小封装。
 *
 * 三个必须守住的约定：
 *
 * 1. **绑定结果挂在 koffi 对象上，不放模块级变量。**
 *    koffi 的类型名与回调原型是进程级注册，同名重复注册会抛 `Duplicate type name`；
 *    cordis 的 HMR 会重新加载本模块，模块级缓存随之归零，下一次 apply 就会二次注册。
 *    koffi 模块本身在 require 缓存里是同一个对象，绑定挂在它上面才能跨重载复用。
 *
 * 2. **自定义类型名一律加插件前缀。**
 *    宿主进程自己也用 koffi，通用名（如 `RECT`）可能已被占用，重名注册即抛错。
 *
 * 3. **读尺寸用 WINDOWPLACEMENT，不用 GetWindowRect。**
 *    窗口最小化时 GetWindowRect 返回 `(-32000,-32000)` 处的极小矩形，最大化时返回
 *    最大化矩形——两者都不再是用户设定的尺寸。`WINDOWPLACEMENT.rcNormalPosition`
 *    在三种状态下都保持用户设定值，`showCmd` 另可判断是否最大化。
 */

/** 挂在 koffi 上的缓存键（Symbol.for 保证跨模块实例取到同一个）。 */
const BINDING_KEY = Symbol.for("dsh-window-state.user32");

/** 私有类型名，避免与宿主或其他插件已在 koffi 注册的类型冲突。 */
const T = {
  point: "DshWindowStatePoint",
  rect: "DshWindowStateRect",
  monitorInfo: "DshWindowStateMonitorInfo",
  placement: "DshWindowStatePlacement",
  enumProc: "DshWindowStateEnumProc",
};

/** WINDOWPLACEMENT 的 length 字段（32/64 位下均为 44 字节）。 */
const WINDOWPLACEMENT_LENGTH = 44;

/** showCmd 取值。 */
export const SW_NORMAL = 1;
export const SW_MAXIMIZE = 3;

/**
 * 绑定 user32，结果缓存在 koffi 对象上。
 * @returns 绑定对象；失败返回 null（不抛错——插件不应因缺少 API 而拖垮宿主）。
 */
export function bindUser32(koffi) {
  if (koffi[BINDING_KEY]) return koffi[BINDING_KEY];
  if (typeof koffi?.load !== "function") return null;

  try {
    const user32 = koffi.load("user32.dll");
    const kernel32 = koffi.load("kernel32.dll");

    koffi.struct(T.point, { x: "long", y: "long" });
    koffi.struct(T.rect, { left: "long", top: "long", right: "long", bottom: "long" });
    koffi.struct(T.monitorInfo, {
      cbSize: "uint32",
      rcMonitor: T.rect,
      rcWork: T.rect,
      dwFlags: "uint32",
    });
    koffi.struct(T.placement, {
      length: "uint32",
      flags: "uint32",
      showCmd: "uint32",
      ptMinPosition: T.point,
      ptMaxPosition: T.point,
      rcNormalPosition: T.rect,
    });

    const binding = {
      koffi,
      WINDOWPLACEMENT_LENGTH,

      GetWindowPlacement: user32.func(`bool GetWindowPlacement(void* h, _Inout_ ${T.placement}* p)`),
      SetWindowPlacement: user32.func(`bool SetWindowPlacement(void* h, _Inout_ ${T.placement}* p)`),
      IsWindow: user32.func("bool IsWindow(void* h)"),
      IsWindowVisible: user32.func("bool IsWindowVisible(void* h)"),
      IsZoomed: user32.func("bool IsZoomed(void* h)"),
      GetWindowTextW: user32.func("int GetWindowTextW(void* h, _Out_ uint16* b, int n)"),
      GetWindowThreadProcessId: user32.func("uint32 GetWindowThreadProcessId(void* h, _Out_ uint32* p)"),
      GetAncestor: user32.func("void* GetAncestor(void* h, uint32 f)"),
      EnumWindows: user32.func("bool EnumWindows(void* cb, intptr lp)"),
      MonitorFromRect: user32.func(`void* MonitorFromRect(_In_ ${T.rect}* r, uint32 f)`),
      MonitorFromWindow: user32.func("void* MonitorFromWindow(void* h, uint32 f)"),
      GetMonitorInfoW: user32.func(`bool GetMonitorInfoW(void* mon, _Inout_ ${T.monitorInfo}* mi)`),
      enumProto: koffi.proto(`bool __stdcall ${T.enumProc}(void* h, intptr l)`),

      // 用于按可执行文件路径确认窗口归属——写窗口前的硬门禁。
      OpenProcess: kernel32.func("void* OpenProcess(uint32 access, bool inherit, uint32 pid)"),
      QueryFullProcessImageNameW: kernel32.func(
        "bool QueryFullProcessImageNameW(void* proc, uint32 flags, _Out_ uint16* buf, _Inout_ uint32* size)",
      ),
      CloseHandle: kernel32.func("bool CloseHandle(void* handle)"),

      MONITOR_DEFAULTTONEAREST: 2,
      GA_ROOT: 2,
    };

    Object.defineProperty(koffi, BINDING_KEY, {
      value: binding,
      enumerable: false,
      configurable: true,
      writable: false,
    });
    return binding;
  } catch {
    return null;
  }
}

/** 新建一个空的 WINDOWPLACEMENT（length 必须预填，否则调用失败）。 */
function emptyPlacement() {
  return {
    length: WINDOWPLACEMENT_LENGTH,
    flags: 0,
    showCmd: 0,
    ptMinPosition: { x: 0, y: 0 },
    ptMaxPosition: { x: 0, y: 0 },
    rcNormalPosition: { left: 0, top: 0, right: 0, bottom: 0 },
  };
}

/**
 * 读取窗口标题。
 *
 * 仅供测试脚本识别自己拉起的窗口使用。**插件本身不得用标题判断窗口归属**——
 * 标题是任意文本，浏览器打开一个标题含关键词的页面就会被误认（详见 README 的安全边界）。
 */
export function windowText(b, hwnd) {
  const buf = new Uint16Array(512);
  b.GetWindowTextW(hwnd, buf, 512);
  return Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength).toString("utf16le").replace(/\0.*$/, "");
}

/** 进程 id（0 表示失败）。 */
export function windowPid(b, hwnd) {
  const pid = [0];
  b.GetWindowThreadProcessId(hwnd, pid);
  return pid[0];
}

/**
 * 取进程的可执行文件完整路径；取不到时返回 null。
 *
 * 用 `PROCESS_QUERY_LIMITED_INFORMATION` 而非 `PROCESS_QUERY_INFORMATION`：
 * 前者对普通用户权限的进程即可读取路径，无需提权。
 */
export function processImagePath(b, pid) {
  const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
  const handle = b.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
  if (handle === null) return null;
  try {
    const buf = new Uint16Array(32768);
    const size = [32768];
    if (!b.QueryFullProcessImageNameW(handle, 0, buf, size)) return null;
    return Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength).toString("utf16le").replace(/\0.*$/, "");
  } catch {
    return null;
  } finally {
    b.CloseHandle(handle);
  }
}

/**
 * 规范化可执行文件路径以便比较：统一分隔符与大小写，
 * 并去掉 Windows 的长路径前缀 `\\?\`。
 */
export function normalizeExePath(path) {
  if (typeof path !== "string" || path.length === 0) return null;
  return path.replace(/\//g, "\\").replace(/^\\\\\?\\/, "").toLowerCase();
}

/**
 * 枚举全部顶层窗口（只回调 hwnd，不做过滤，过滤交给调用方）。
 * @param visitor 返回 false 可提前结束枚举
 */
export function enumTopLevel(b, visitor) {
  const cb = b.koffi.register((hwnd) => (visitor(hwnd) === false ? false : true), b.koffi.pointer(b.enumProto));
  try {
    b.EnumWindows(cb, 0);
  } finally {
    b.koffi.unregister(cb);
  }
}

/** 读取窗口的放置信息；失败返回 null。 */
export function readPlacement(b, hwnd) {
  const p = emptyPlacement();
  if (!b.GetWindowPlacement(hwnd, p)) return null;
  return p;
}

/**
 * 写出窗口的放置信息。
 * @param rect rcNormalPosition（正常态的尺寸位置）
 * @param showCmd SW_NORMAL 或 SW_MAXIMIZE
 */
export function writePlacement(b, hwnd, rect, showCmd) {
  const p = emptyPlacement();
  p.showCmd = showCmd;
  // 与窗口创建时一致的值，避免还原出异常的最小化位置。
  p.ptMinPosition = { x: -32000, y: -32000 };
  p.ptMaxPosition = { x: -1, y: -1 };
  p.rcNormalPosition = rect;
  return b.SetWindowPlacement(hwnd, p);
}

/** 该矩形是否仍与某块显示器相交（判断是否已被移到屏幕外）。 */
export function isOnScreen(b, rect) {
  return b.MonitorFromRect(rect, 0) !== null;
}

/** 取得窗口所在显示器的工作区（已排除任务栏）；失败返回 null。 */
export function workAreaOf(b, hwnd) {
  const mon = b.MonitorFromWindow(hwnd, b.MONITOR_DEFAULTTONEAREST);
  if (mon === null) return null;
  const mi = {
    cbSize: 40,
    rcMonitor: { left: 0, top: 0, right: 0, bottom: 0 },
    rcWork: { left: 0, top: 0, right: 0, bottom: 0 },
    dwFlags: 0,
  };
  if (!b.GetMonitorInfoW(mon, mi)) return null;
  return mi.rcWork;
}
