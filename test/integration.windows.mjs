/**
 * Windows 集成验证：用一次性记事本窗口跑通 lib/win32.js 与 lib/geometry.js。
 *
 * 它证明的是"换一台 Windows 机器也成立"的那部分行为，而不是本机特例：
 *   - 绑定可重复调用（HMR 安全）
 *   - 自定义类型名不与通用名冲突
 *   - 最小化/最大化时仍能读到用户设定的几何（本插件的核心修复）
 *   - 还原能同时恢复尺寸、位置与最大化状态
 *   - 换小屏后能收缩回工作区，拔屏后能移回屏幕内
 *
 * 运行方式（koffi 由宿主提供，与插件运行时一致）：
 *   PowerShell:
 *     $env:ELECTRON_RUN_AS_NODE=1
 *     & "<DSH 安装目录>\DeepSeek Harness.exe" test/integration.windows.mjs
 *   cmd:
 *     set ELECTRON_RUN_AS_NODE=1 && "<DSH 安装目录>\DeepSeek Harness.exe" test/integration.windows.mjs
 *
 * 若本机已安装 koffi（npm install），也可直接用 node 运行。
 */
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import {
  bindUser32, readPlacement, writePlacement, isOnScreen, workAreaOf,
  windowText, windowPid, enumTopLevel, SW_NORMAL, SW_MAXIMIZE,
} from "../lib/win32.js";
import { fitIntoWorkArea, rectToGeometry, geometryToRect, isValidGeometry } from "../lib/geometry.js";

let passed = 0;
let failed = 0;
function check(label, condition, detail = "") {
  if (condition) { passed++; console.log(`  PASS  ${label}${detail ? "  — " + detail : ""}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? "  — " + detail : ""}`); }
}
const section = (t) => console.log(`\n${"─".repeat(68)}\n${t}\n${"─".repeat(68)}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── koffi：与插件相同的解析顺序 ── */
function loadKoffi() {
  try { return createRequire(import.meta.url)("koffi"); } catch {}
  const hostEntry = process.argv[1];
  if (typeof hostEntry === "string" && /\.(js|cjs|mjs)$/.test(hostEntry)) {
    try { return createRequire(hostEntry)("koffi"); } catch {}
  }
  return null;
}

const koffi = loadKoffi();
if (!koffi) {
  console.error("无法载入 koffi。请用 ELECTRON_RUN_AS_NODE=1 通过 DSH 可执行文件运行，或先 npm i koffi。");
  process.exit(2);
}

console.log("环境");
console.log("  node          :", process.versions.node);
console.log("  electron      :", process.versions.electron ?? "(none)");
console.log("  ELECTRON_RUN_AS_NODE:", process.env.ELECTRON_RUN_AS_NODE ?? "(unset)");
console.log("  koffi         :", koffi.version);
console.log("  platform      :", process.platform);
console.log("  DSH_HOME      :", process.env.DSH_HOME ?? "(unset)");

if (process.platform !== "win32") {
  console.log("\n非 Windows，跳过集成验证（插件在该平台上本就不生效）。");
  process.exit(0);
}

section("1. 绑定与 HMR 安全");
const b1 = bindUser32(koffi);
check("bindUser32 成功", b1 !== null);
const b2 = bindUser32(koffi);
check("重复调用返回同一绑定（HMR 安全）", b1 === b2);

// 证明私有类型名确实已注册：用同名再做一次完整注册，koffi 会拒绝。
let duplicateRejected = false;
try {
  koffi.struct("DshWindowStateRect", { left: "long", top: "long", right: "long", bottom: "long" });
} catch (e) {
  duplicateRejected = /Duplicate type name/.test(String(e.message));
}
check("私有类型名已注册且受保护（重名再注册被拒）", duplicateRejected);

// 通用名 RECT 未被我方占用，宿主或其他插件可自由使用。
let genericFree = true;
try {
  koffi.struct("RECT", { left: "long", top: "long", right: "long", bottom: "long" });
} catch { genericFree = false; }
check("未占用通用类型名 RECT（不打扰宿主与其他插件）", genericFree);

section("2. 显示器工作区");
const probe = enumTopLevel;
let anyHwnd = null;
enumTopLevel(b1, (h) => { if (b1.IsWindowVisible(h) && b1.GetAncestor(h, b1.GA_ROOT) === h) { anyHwnd = h; return false; } return true; });
const work = anyHwnd === null ? null : workAreaOf(b1, anyHwnd);
check("能取到某窗口的工作区", work !== null, work ? `${work.right - work.left}x${work.bottom - work.top} @ (${work.left},${work.top})` : "null");

section("3. 隔离测试窗口");
const tag = "dsh-ws-it-" + randomUUID().slice(0, 8);
const tmp = join(process.env.TEMP ?? ".", tag + ".txt");
writeFileSync(tmp, "integration probe\n");

let child = spawn("notepad.exe", [tmp], { detached: true, stdio: "ignore" });
let hwnd = null;
for (let i = 0; i < 50 && hwnd === null; i++) {
  await sleep(200);
  enumTopLevel(b1, (h) => {
    if (!b1.IsWindowVisible(h)) return true;
    if (windowText(b1, h).includes(tag)) { hwnd = h; return false; }
    return true;
  });
}
check("找到测试窗口", hwnd !== null, hwnd === null ? "" : `hwnd=${hwnd} pid=${windowPid(b1, hwnd)}`);
if (hwnd === null) { try { execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch {} process.exit(1); }

// GetAncestor 比较必须可靠，否则 findMainWindow 会永远返回 null
check("GetAncestor 比较可靠（该窗口自身就是顶层）", b1.GetAncestor(hwnd, b1.GA_ROOT) === hwnd);

// 记事本会记住上次退出时的最大化状态，基线断言不能依赖它恰好是正常态。
// 先归位到正常态，让后续断言有确定的起点。
const koffiRaw = koffi.load("user32.dll");
const ShowWindow = koffiRaw.func("bool ShowWindow(void* h, int cmd)");
const GetWindowRect = koffiRaw.func("bool GetWindowRect(void* h, _Out_ DshWindowStateRect* r)");
ShowWindow(hwnd, 9); // SW_RESTORE
await sleep(400);

try {
  section("4. 正常态基线");
  const p0 = readPlacement(b1, hwnd);
  const g0 = rectToGeometry(p0.rcNormalPosition);
  check("readPlacement 成功", p0 !== null);
  check("归位后 showCmd=1", p0.showCmd === SW_NORMAL, `showCmd=${p0.showCmd}`);
  check("几何通过校验", isValidGeometry(g0), `${g0.width}x${g0.height} @ (${g0.x},${g0.y})`);

  section("5. 最小化：仍能读到用户设定的几何（核心修复）");
  // 用 ShowWindow 最小化（SetWindowPlacement 之外的路径），同时取 GetWindowRect 作反例对照
  ShowWindow(hwnd, 6);
  await sleep(800);
  const rectWhileMin = { left: 0, top: 0, right: 0, bottom: 0 };
  GetWindowRect(hwnd, rectWhileMin);
  const pMin = readPlacement(b1, hwnd);
  const gMin = rectToGeometry(pMin.rcNormalPosition);
  const rectGarbage = rectWhileMin.left <= -30000 || rectWhileMin.right - rectWhileMin.left <= 0;
  check("最小化时 GetWindowRect 返回垃圾值（说明不能用它）", rectGarbage,
    `GetWindowRect=${rectWhileMin.right - rectWhileMin.left}x${rectWhileMin.bottom - rectWhileMin.top} @ (${rectWhileMin.left},${rectWhileMin.top})`);
  check("最小化时 rcNormalPosition 仍是用户设定的几何",
    gMin.x === g0.x && gMin.y === g0.y && gMin.width === g0.width && gMin.height === g0.height,
    `${gMin.width}x${gMin.height} @ (${gMin.x},${gMin.y})`);
  check("最小化状态因此不会污染状态文件", isValidGeometry(gMin));

  section("6. 最大化：区分状态并保留用户尺寸");
  ShowWindow(hwnd, 9); await sleep(300);
  ShowWindow(hwnd, 3); await sleep(900);
  const pMax = readPlacement(b1, hwnd);
  const gMax = rectToGeometry(pMax.rcNormalPosition);
  check("showCmd 表达最大化", pMax.showCmd === SW_MAXIMIZE || b1.IsZoomed(hwnd), `showCmd=${pMax.showCmd}`);
  check("最大化时 rcNormalPosition 保留用户尺寸",
    gMax.x === g0.x && gMax.y === g0.y && gMax.width === g0.width && gMax.height === g0.height,
    `${gMax.width}x${gMax.height} @ (${gMax.x},${gMax.y})`);

  section("7. 还原：尺寸 / 位置 / 最大化状态");
  writePlacement(b1, hwnd, geometryToRect(g0), SW_NORMAL);
  await sleep(800);
  const afterNormal = rectToGeometry(readPlacement(b1, hwnd).rcNormalPosition);
  check("还原正常态可复现几何",
    afterNormal.x === g0.x && afterNormal.y === g0.y && afterNormal.width === g0.width && afterNormal.height === g0.height,
    `${afterNormal.width}x${afterNormal.height} @ (${afterNormal.x},${afterNormal.y})`);

  writePlacement(b1, hwnd, geometryToRect(g0), SW_MAXIMIZE);
  await sleep(800);
  check("还原最大化状态", b1.IsZoomed(hwnd) === true || readPlacement(b1, hwnd).showCmd === SW_MAXIMIZE);
  const stillNormal = rectToGeometry(readPlacement(b1, hwnd).rcNormalPosition);
  check("最大化下仍保留正常态几何",
    stillNormal.width === g0.width && stillNormal.height === g0.height);

  writePlacement(b1, hwnd, geometryToRect(g0), SW_NORMAL);
  await sleep(600);

  section("8. 换小屏 / 拔屏 的自适应");
  const small = { left: 0, top: 0, right: 1366, bottom: 728 };
  const shrunk = fitIntoWorkArea({ x: 100, y: 100, width: 2560, height: 1440 }, small, true);
  check("尺寸收缩到工作区", shrunk.width === 1366 && shrunk.height === 728, `${shrunk.width}x${shrunk.height}`);
  const moved = fitIntoWorkArea({ x: -9000, y: 500, width: 1280, height: 800 }, small, false);
  check("离屏窗口移回工作区", moved.x === 0 && moved.y === 0, `(${moved.x},${moved.y})`);
  check("真实工作区判定在屏", work === null || isOnScreen(b1, geometryToRect(g0)) === true);
  check("虚构离屏矩形判定为离屏", isOnScreen(b1, { left: -99999, top: -99999, right: -98000, bottom: -97800 }) === false);

  section("9. 存活性");
  check("活动窗口 IsWindow=true", b1.IsWindow(hwnd) === true);
  check("伪句柄 IsWindow=false", b1.IsWindow(1) === false);
} catch (error) {
  failed++;
  console.log("\n异常:", error?.message);
  console.log(error?.stack?.split("\n").slice(0, 4).join("\n"));
} finally {
  try { execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
  await sleep(400);
  try { if (existsSync(tmp)) unlinkSync(tmp); } catch {}
}

console.log(`\n${"═".repeat(68)}`);
console.log(`结果: ${passed} 通过 / ${failed} 失败`);
console.log("═".repeat(68));
process.exit(failed === 0 ? 0 : 1);
