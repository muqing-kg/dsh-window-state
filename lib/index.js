/**
 * dsh-window-state —— 让 DeepSeek Harness Desktop 记住主窗口的尺寸、位置与最大化状态。
 *
 * 插件运行在 `dsh-desktop-host` 子进程里，该进程以 ELECTRON_RUN_AS_NODE 模式启动，
 * 是纯 Node 进程，取不到 Electron 的 BrowserWindow。因此用 koffi 直接调用 user32.dll，
 * 细节见 ./win32.js。
 *
 * 窗口优先按 process.ppid（持有主窗口的 Electron 主进程）定位，失败时回退到标题匹配。
 *
 * 窗口一出现就恢复上次的几何；此后轮询记录变化，并在退出前再记录一次最终值。
 * 任何失败只记日志，绝不抛出——插件不应拖垮宿主。
 *
 * 平台：仅 Windows 生效，其他平台直接跳过。
 */

import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { isValidGeometry, fitIntoWorkArea, rectToGeometry, geometryToRect, MIN_W, MIN_H } from "./geometry.js";
import {
  bindUser32, readPlacement, writePlacement, isOnScreen, workAreaOf,
  windowPid, processImagePath, normalizeExePath, enumTopLevel, SW_NORMAL, SW_MAXIMIZE,
} from "./win32.js";

export const name = "dsh-window-state";
export const inject = [];

/** 轮询间隔：够快以捕捉用户调整，够慢以免空转。 */
const POLL_MS = 2000;
/** 等窗口出现的上限。 */
const WAIT_MS = 90_000;
/** 状态文件的 schema 版本，便于日后迁移。 */
const SCHEMA = 1;

function statePath() {
  const home = process.env.DSH_HOME || join(homedir(), ".dsh");
  return join(home, "window-state.json");
}

/**
 * 读状态。任何异常都视为"无记录"。
 * 只接受通过校验的几何，损坏的文件不会导致窗口被搬到荒谬的位置。
 */
function loadState() {
  try {
    const s = JSON.parse(readFileSync(statePath(), "utf8"));
    if (!isValidGeometry(s)) return null;
    return {
      geometry: { x: s.x, y: s.y, width: s.width, height: s.height },
      maximized: s.maximized === true,
      // schema 更高说明是更新版本写的，本版本读不懂，宁可不还原。
      unknown: Number.isFinite(s.schema) && s.schema > SCHEMA,
    };
  } catch {
    return null;
  }
}

/**
 * 写入状态文件。
 * @param state {x,y,width,height,maximized} —— 整对象传入，避免多个位置参数错位
 */
function saveState(state, logger) {
  try {
    const p = statePath();
    mkdirSync(dirname(p), { recursive: true });
    const body = JSON.stringify(
      {
        schema: SCHEMA,
        x: state.x,
        y: state.y,
        width: state.width,
        height: state.height,
        maximized: state.maximized === true,
        savedAt: new Date().toISOString(),
      },
      null,
      2,
    );
    writeFileSync(p, body + "\n");
  } catch (error) {
    logger?.warn?.(`window-state: 记录窗口状态失败: ${String(error)}`);
  }
}

/**
 * 定位宿主入口脚本，用于从宿主借 koffi。
 *
 * koffi 刻意不声明为运行时依赖：它带原生构建脚本，pnpm 默认拒绝执行，
 * 会让整个安装以失败告终。改从宿主借——`dsh-desktop-host` 自带 koffi。
 *
 * 两条独立路径，任一条命中即可：宿主入口脚本本身，或沿可执行文件所在目录向上查找。
 */
function findHostEntry() {
  const fromArgv = process.argv[1];
  if (typeof fromArgv === "string" && /dsh-desktop-host/.test(fromArgv)) return fromArgv;

  const suffix = join("dsh", "node_modules", "@deepseek-ai", "dsh-desktop-host", "lib", "index.js");
  let dir = dirname(process.execPath);
  for (let i = 0; i < 6; i++) {
    for (const prefix of ["", "resources", join("resources", "app.asar")]) {
      const candidate = prefix === "" ? join(dir, suffix) : join(dir, prefix, suffix);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  if (typeof fromArgv === "string" && /\.(js|cjs|mjs)$/.test(fromArgv) && existsSync(fromArgv)) return fromArgv;
  return null;
}

/**
 * 载入 koffi：先用本包依赖（便于在仓库内直接运行），否则向宿主借。
 * 都失败时返回 null，插件停用并记一条 warn，不影响宿主启动。
 */
function loadKoffi() {
  try {
    return createRequire(import.meta.url)("koffi");
  } catch {}

  const hostEntry = findHostEntry();
  if (hostEntry !== null) {
    try {
      return createRequire(hostEntry)("koffi");
    } catch {}
  }
  return null;
}

export function apply(ctx) {
  const logger = ctx?.logger;
  if (process.platform !== "win32") {
    logger?.info?.("window-state: 仅支持 Windows，跳过");
    return;
  }

  const koffi = loadKoffi();
  if (!koffi) {
    logger?.warn?.("window-state: 未能载入 koffi，插件停用");
    return;
  }

  const b = bindUser32(koffi);
  if (!b) {
    logger?.warn?.("window-state: user32 绑定失败，插件停用");
    return;
  }

  /**
   * 认定本插件可以操作的目标进程。
   *
   * 只认宿主自己的可执行文件：窗口所属进程的 exe 必须与 `process.execPath` 相同。
   * 这是**写窗口前的唯一判据**，不用窗口标题——标题是任意文本，浏览器打开一个
   * 标题含 "DeepSeek" 的页面就会满足标题匹配，导致插件去改写浏览器的窗口。
   */
  const ownExe = normalizeExePath(process.execPath);

  /** 该窗口是否属于宿主进程本身。 */
  function isOwnProcess(hwnd) {
    if (ownExe === null) return false;
    return normalizeExePath(processImagePath(b, windowPid(b, hwnd))) === ownExe;
  }

  /** 该窗口是否可能是主窗口（属于宿主、可见、顶层、尺寸达标）。 */
  function isCandidate(hwnd) {
    if (!b.IsWindowVisible(hwnd)) return false;
    if (b.GetAncestor(hwnd, b.GA_ROOT) !== hwnd) return false;
    if (!isOwnProcess(hwnd)) return false;
    const p = readPlacement(b, hwnd);
    if (!p) return false;
    const r = p.rcNormalPosition;
    return r.right - r.left >= MIN_W && r.bottom - r.top >= MIN_H;
  }

  /**
   * 定位主窗口：宿主进程中面积最大的合格窗口。
   * 取最大者，避免把欢迎页、更新弹窗等较小的窗口当成主窗口。
   *
   * 找不到时返回 null（继续等），**绝不退回到按标题猜测**。
   */
  function findMainWindow() {
    const found = [];
    enumTopLevel(b, (hwnd) => {
      if (!isCandidate(hwnd)) return true;
      const p = readPlacement(b, hwnd);
      const r = p.rcNormalPosition;
      found.push({ hwnd, area: (r.right - r.left) * (r.bottom - r.top) });
      return true;
    });
    if (found.length === 0) return null;
    found.sort((a, z) => z.area - a.area);
    return found[0].hwnd;
  }

  const saved = loadState();
  if (saved?.unknown) {
    logger?.warn?.(`window-state: 状态文件版本高于本插件（schema > ${SCHEMA}），本次不还原`);
  }

  ctx.effect(() => {
    let stopped = false;
    let restored = false;
    let last = null;
    /** 已定位的主窗口。定位一次后复用，避免每轮重扫全部顶层窗口。 */
    let target = null;
    const deadline = Date.now() + WAIT_MS;

    /**
     * 取得主窗口，优先用缓存。
     *
     * 枚举全部顶层窗口比读一个已知句柄贵得多，而句柄在宿主存活期内稳定，
     * 故只在缓存失效（尚无句柄或句柄已销毁）时才重扫。
     */
    function acquire() {
      if (target !== null && b.IsWindow(target)) return target;
      target = findMainWindow();
      return target;
    }

    /**
     * 读取窗口当前的几何与最大化状态。
     *
     * 用 `WINDOWPLACEMENT.rcNormalPosition` 而不是 `GetWindowRect`：后者在最小化与
     * 最大化时会丢掉用户设定的尺寸，而 `rcNormalPosition` 在两种状态下都保持它。
     *
     * @returns {x,y,width,height,maximized}；句柄失效时返回 null
     */
    function readCurrent(hwnd) {
      const p = readPlacement(b, hwnd);
      if (!p) return null;
      return {
        ...rectToGeometry(p.rcNormalPosition),
        maximized: p.showCmd === SW_MAXIMIZE || Boolean(b.IsZoomed(hwnd)),
      };
    }

    /** 两组几何是否完全相同。 */
    function sameAs(a, z) {
      return a !== null && z !== null &&
        a.x === z.x && a.y === z.y &&
        a.width === z.width && a.height === z.height &&
        a.maximized === z.maximized;
    }

    const tick = () => {
      if (stopped) return;
      try {
        const hwnd = acquire();
        if (hwnd === null) {
          if (Date.now() > deadline) {
            clearInterval(timer);
            logger?.warn?.("window-state: 等待主窗口超时，停止监听");
          }
          return;
        }

        // 一次性还原：窗口一出现就套用记录，此后不再主动干预。
        if (!restored) {
          restored = true;
          if (saved && !saved.unknown) {
            // 写之前的最后一道门禁：句柄可能在这段时间内被复用，
            // 再确认一次它仍属于宿主进程，绝不改写其他程序的窗口。
            if (!isOwnProcess(hwnd)) {
              target = null;
              logger?.warn?.("window-state: 目标窗口已不属于宿主进程，放弃还原");
              return;
            }
            const work = workAreaOf(b, hwnd);
            const fallbackWork = {
              left: 0, top: 0,
              right: saved.geometry.x + saved.geometry.width,
              bottom: saved.geometry.y + saved.geometry.height,
            };
            const fitted = fitIntoWorkArea(
              saved.geometry,
              work ?? fallbackWork,
              isOnScreen(b, geometryToRect(saved.geometry)),
            );
            writePlacement(b, hwnd, geometryToRect(fitted), saved.maximized ? SW_MAXIMIZE : SW_NORMAL);
            last = { ...fitted, maximized: saved.maximized };
            logger?.info?.(
              `window-state: 已恢复 ${fitted.width}x${fitted.height} @ (${fitted.x},${fitted.y})` +
              (saved.maximized ? "（最大化）" : ""),
            );
            return;
          }
          logger?.info?.("window-state: 暂无记录，沿用当前窗口");
        }

        // 尺寸、位置或最大化状态有变才写盘；窗口静止时零文件写入。
        const now = readCurrent(hwnd);
        if (now !== null && !sameAs(last, now)) {
          last = now;
          saveState(now, logger);
        }
      } catch (error) {
        logger?.warn?.(`window-state: 轮询异常: ${String(error)}`);
      }
    };

    const timer = setInterval(tick, POLL_MS);

    /**
     * 退出前记录最终几何。
     *
     * 宿主 shutdown 时会 dispose 根 fiber 并调用本清理函数，此时主窗口只是被隐藏、
     * 尚未销毁，仍可读到真实值。用户调完窗口通常不再动它，关闭这一刻最准；
     * 运行中的轮询则覆盖异常退出（强杀、崩溃）的情况。
     */
    return () => {
      stopped = true;
      clearInterval(timer);
      try {
        const hwnd = target !== null && b.IsWindow(target) ? target : findMainWindow();
        const now = hwnd === null ? null : readCurrent(hwnd);
        if (now !== null && !sameAs(last, now)) {
          saveState(now, logger);
          logger?.info?.(`window-state: 退出前记录 ${now.width}x${now.height} @ (${now.x},${now.y})`);
        }
      } catch (error) {
        logger?.warn?.(`window-state: 退出前记录失败: ${String(error)}`);
      }
    };
  }, "dsh-window-state: 窗口状态记忆");
}
