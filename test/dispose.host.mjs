/**
 * 验证「退出前记录」这条路径真的有效。
 *
 * 做法：加载插件 → 等它建立基线 → 手动改变窗口几何（模拟用户调整）
 *      → 调用 dispose（等价于宿主 shutdown）→ 检查状态文件是否更新为最终值。
 *
 * 这验证了两件事：
 *   1. dispose 回调里能读到窗口（Electron 在 finishQuit 里只 hide 不 destroy）
 *   2. 退出前写入的是"最终值"，而不是上一轮轮询的旧值
 */
import { readFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import { bindUser32, readPlacement, enumTopLevel, windowText, writePlacement, SW_NORMAL } from "../lib/win32.js";
import { rectToGeometry, geometryToRect } from "../lib/geometry.js";

const home = join(tmpdir(), "dsh-ws-dispose-" + randomUUID().slice(0, 8));
mkdirSync(home, { recursive: true });
process.env.DSH_HOME = home;
const stateFile = join(home, "window-state.json");

let passed = 0, failed = 0;
const check = (label, cond, detail = "") => {
  if (cond) { passed++; console.log(`  PASS  ${label}${detail ? "  — " + detail : ""}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? "  — " + detail : ""}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const logs = [];
const ctx = {
  logger: { info: (m) => { logs.push(m); console.log("    [info]", m); }, warn: (m) => { logs.push(m); console.log("    [warn]", m); } },
  effect(fn) { this._dispose = fn(); return this._dispose; },
};

const mod = await import(new URL("../lib/index.js", import.meta.url).href);

// 清掉可能存在的旧状态，确保从零开始
if (existsSync(stateFile)) rmSync(stateFile);

console.log("─".repeat(66));
console.log("1. 启动插件，建立基线");
console.log("─".repeat(66));
mod.apply(ctx);
await sleep(2500);
check("首轮已写入状态文件", existsSync(stateFile));
const baseline = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : null;
console.log("    基线:", baseline ? `${baseline.width}x${baseline.height} @ (${baseline.x},${baseline.y})` : "(无)");

console.log("\n" + "─".repeat(66));
console.log("2. 改变窗口几何（模拟用户拖动），但不等到下一轮轮询");
console.log("─".repeat(66));
const koffi = createRequire(import.meta.url)("koffi");
const b = bindUser32(koffi);

// 找插件正在跟踪的窗口（标题含 DeepSeek 的最大窗口）
function findTarget() {
  let best = null, bestArea = 0;
  enumTopLevel(b, (h) => {
    if (!b.IsWindowVisible(h)) return true;
    if (b.GetAncestor(h, b.GA_ROOT) !== h) return true;
    if (!/DeepSeek/i.test(windowText(b, h))) return true;
    const p = readPlacement(b, h);
    if (!p) return true;
    const g = rectToGeometry(p.rcNormalPosition);
    const area = g.width * g.height;
    if (area > bestArea) { bestArea = area; best = { h, g }; }
    return true;
  });
  return best;
}

const t = findTarget();
check("找到被跟踪的窗口", t !== null, t ? `${t.g.width}x${t.g.height}` : "未找到");

if (t !== null) {
  // 改成一个明显不同的尺寸
  const moved = { ...t.g, width: t.g.width - 120, height: t.g.height - 80, x: t.g.x + 40, y: t.g.y + 30 };
  writePlacement(b, t.h, geometryToRect(moved), SW_NORMAL);
  await sleep(150);
  console.log(`    已改为 ${moved.width}x${moved.height} @ (${moved.x},${moved.y})`);

  const beforeDispose = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : null;
  const changed = beforeDispose !== null &&
    (beforeDispose.width !== moved.width || beforeDispose.height !== moved.height);
  console.log(`    此刻状态文件仍是旧值: ${changed ? "是（符合预期，尚未轮到轮询）" : "否"}`);

  console.log("\n" + "─".repeat(66));
  console.log("3. 调用 dispose（等价于宿主 shutdown）");
  console.log("─".repeat(66));
  try {
    ctx._dispose?.();
    check("dispose 未抛异常", true);
  } catch (e) {
    check("dispose 未抛异常", false, e.message);
  }

  await sleep(200);
  const after = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : null;
  check("dispose 后状态文件存在", after !== null);
  if (after !== null) {
    console.log("    最终记录:", `${after.width}x${after.height} @ (${after.x},${after.y}) maximized=${after.maximized}`);
    check(
      "退出前写入的是最终几何（而非旧值）",
      after.width === moved.width && after.height === moved.height &&
      after.x === moved.x && after.y === moved.y,
      `期望 ${moved.width}x${moved.height} @ (${moved.x},${moved.y})`,
    );
    check("记录了退出前日志", logs.some((m) => m.includes("退出前记录")));
  }

  // 还原窗口，别影响用户
  writePlacement(b, t.h, geometryToRect(t.g), SW_NORMAL);
  console.log("    已还原测试窗口");
}

rmSync(home, { recursive: true, force: true });
console.log(`\n${"═".repeat(66)}`);
console.log(`结果: ${passed} 通过 / ${failed} 失败`);
console.log("═".repeat(66));
process.exit(failed === 0 ? 0 : 1);
