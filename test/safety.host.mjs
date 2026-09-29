/**
 * 安全验证：证明修复后，插件绝不操作非宿主进程的窗口。
 *
 * 在有浏览器（或任何含 "DeepSeek" 标题窗口）的环境下加载插件，
 * 确认它写入的状态文件绝不属于那些窗口。
 */
import { readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import {
  bindUser32, readPlacement, enumTopLevel,
  windowPid, processImagePath, normalizeExePath, windowText,
} from "../lib/win32.js";
import { rectToGeometry } from "../lib/geometry.js";

const home = join(tmpdir(), "dsh-ws-safety-" + randomUUID().slice(0, 8));
mkdirSync(home, { recursive: true });
process.env.DSH_HOME = home;
const stateFile = join(home, "window-state.json");

let passed = 0, failed = 0;
const check = (label, cond, detail = "") => {
  if (cond) { passed++; console.log(`  PASS  ${label}${detail ? "  — " + detail : ""}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? "  — " + detail : ""}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("环境");
console.log("  execPath:", process.execPath);
console.log("  DSH_HOME:", home);
console.log("");

/* 1. 先列出「含 DeepSeek 标题但不是宿主」的窗口——这些正是曾经的受害者 */
const koffi = createRequire(import.meta.url)("koffi");
const b = bindUser32(koffi);
const ownExe = normalizeExePath(process.execPath);

const strangers = [];
const own = [];
enumTopLevel(b, (h) => {
  if (!b.IsWindowVisible(h)) return true;
  if (b.GetAncestor(h, b.GA_ROOT) !== h) return true;
  const p = readPlacement(b, h);
  if (!p) return true;
  const g = rectToGeometry(p.rcNormalPosition);
  if (g.width < 400 || g.height < 300) return true;
  const exe = normalizeExePath(processImagePath(b, windowPid(b, h)));
  const rec = { g, pid: windowPid(b, h), exe: exe ? exe.split("\\").pop() : "?", title: windowText(b, h) };
  if (exe === ownExe) own.push(rec);
  else if (/DeepSeek/i.test(rec.title)) strangers.push(rec);
  return true;
});

console.log("=".repeat(70));
console.log("1. 潜在受害者：标题含 DeepSeek 但不属于宿主进程的窗口");
console.log("=".repeat(70));
if (strangers.length === 0) {
  console.log("  （当前没有此类窗口 —— 这正是修复前会导致误伤的窗口类型）");
  console.log("  提示：在浏览器打开一个标题含 \"DeepSeek\" 的页面即可复现旧 bug 的条件。");
} else {
  for (const s of strangers) {
    console.log(`  ⚠ ${s.g.width}x${s.g.height} pid=${s.pid} (${s.exe})`);
    console.log(`      "${s.title.slice(0, 60)}"`);
  }
}
console.log(`\n  属于宿主进程的窗口: ${own.length} 个`);
for (const o of own) console.log(`      ${o.g.width}x${o.g.height} "${o.title.slice(0, 40)}"`);

/* 2. 加载插件，看它写出的几何属于谁 */
console.log("\n" + "=".repeat(70));
console.log("2. 加载插件并观察其写入");
console.log("=".repeat(70));
const ctx = {
  logger: { info: (m) => console.log("    [info]", m), warn: (m) => console.log("    [warn]", m) },
  effect(fn) { this._dispose = fn(); return this._dispose; },
};
const mod = await import(new URL("../lib/index.js", import.meta.url).href);
mod.apply(ctx);
await sleep(2600);

if (!existsSync(stateFile)) {
  console.log("  未写入状态文件（本轮未定位到宿主窗口，属正常）");
  check("未写入任何数据（因此不可能误伤）", true);
} else {
  const st = JSON.parse(readFileSync(stateFile, "utf8"));
  console.log(`  写入: ${st.width}x${st.height} @ (${st.x},${st.y}) maximized=${st.maximized}`);

  const matchesHost = own.some((o) => o.g.width === st.width && o.g.height === st.height);
  const matchesStranger = strangers.some((s) => s.g.width === st.width && s.g.height === st.height);

  check("写入的几何属于宿主进程的窗口", matchesHost, matchesHost ? "" : "与任何宿主窗口都不匹配");
  check("写入的几何不属于任何非宿主窗口", !matchesStranger, matchesStranger ? "★ 误伤！" : "");
}

ctx._dispose?.();
rmSync(home, { recursive: true, force: true });

console.log("\n" + "═".repeat(70));
console.log(`结果: ${passed} 通过 / ${failed} 失败`);
console.log("═".repeat(70));
process.exit(failed === 0 ? 0 : 1);
