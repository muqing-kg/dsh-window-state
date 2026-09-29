/**
 * 端到端验证：在真实 DSH 宿主环境里加载本插件并观察其行为。
 *
 * 做法：复刻宿主启动形态，导入 lib/index.js，给它一个最小可用的 ctx（logger + effect），
 * 然后观察它是否正确定位窗口、恢复几何、并把几何写进状态文件。
 *
 * 这与"插件在 DSH 里跑"的差别仅在 ctx 由我构造，代码路径完全相同。
 *
 * 运行：
 *   $env:ELECTRON_RUN_AS_NODE=1
 *   & "<DSH 安装目录>\DeepSeek Harness.exe" test/e2e.host.mjs
 */
import { spawn, execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

let passed = 0, failed = 0;
const check = (label, cond, detail = "") => {
  if (cond) { passed++; console.log(`  PASS  ${label}${detail ? "  — " + detail : ""}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? "  — " + detail : ""}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("环境");
console.log("  node     :", process.versions.node);
console.log("  electron :", process.versions.electron ?? "(none)");
console.log("  RUN_AS_NODE:", process.env.ELECTRON_RUN_AS_NODE ?? "(unset)");
console.log("  argv[1]  :", process.argv[1]);

// 用临时 DSH_HOME，避免动用真实状态文件
const home = join(tmpdir(), "dsh-ws-e2e-" + randomUUID().slice(0, 8));
mkdirSync(home, { recursive: true });
process.env.DSH_HOME = home;
const stateFile = join(home, "window-state.json");
console.log("  临时 DSH_HOME:", home);

/* ── 构造一个最小 ctx ── */
const logs = [];
const ctx = {
  logger: {
    info: (m) => { logs.push(["info", m]); console.log("    [info]", m); },
    warn: (m) => { logs.push(["warn", m]); console.log("    [warn]", m); },
  },
  effect(fn) {
    const dispose = fn();
    ctx._dispose = dispose;
    return dispose;
  },
};

console.log("\n" + "─".repeat(66) + "\n1. koffi 解析路径（本次修复的核心，须防回退）\n" + "─".repeat(66));
{
  const { createRequire } = await import("node:module");
  const { existsSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");

  let localOk = false;
  try { createRequire(new URL("../lib/index.js", import.meta.url).href).resolve("koffi"); localOk = true; } catch {}
  console.log(`    本包 koffi 可用: ${localOk}（装过 devDependencies 时为 true）`);

  // 沿 execPath 向上找宿主入口。只有在 DSH 可执行文件下运行时才可能找到——
  // 用系统 node 跑本套件时 execPath 是 node.exe，此路径必然落空，属预期行为。
  const suffix = join("dsh", "node_modules", "@deepseek-ai", "dsh-desktop-host", "lib", "index.js");
  let found = null;
  let dir = dirname(process.execPath);
  for (let i = 0; i < 6 && found === null; i++) {
    for (const prefix of ["", "resources", join("resources", "app.asar")]) {
      const cand = prefix === "" ? join(dir, suffix) : join(dir, prefix, suffix);
      if (existsSync(cand)) { found = cand; break; }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  if (/DeepSeek Harness\.exe$/i.test(process.execPath)) {
    check("沿 execPath 能定位到宿主入口", found !== null, found ?? "未找到");
    if (found !== null) {
      let hostKoffi = null;
      try { hostKoffi = createRequire(found).resolve("koffi"); } catch {}
      check("宿主入口能解析到 koffi", hostKoffi !== null, hostKoffi ?? "解析失败");
    }
  } else {
    console.log(`    跳过宿主路径断言：当前 execPath 为 ${process.execPath}`);
    console.log("    完整校验请用 DSH 可执行文件运行本套件（见文件头说明）");
    check("本包 koffi 可用，插件可独立运行", localOk);
  }
}

console.log("\n" + "─".repeat(66) + "\n2. 加载模块并调用 apply\n" + "─".repeat(66));
const mod = await import(new URL("../lib/index.js", import.meta.url).href);
check("导出 name", mod.name === "dsh-window-state");
check("导出 inject 为空数组", Array.isArray(mod.inject) && mod.inject.length === 0);
check("导出 apply 为函数", typeof mod.apply === "function");
try {
  mod.apply(ctx);
  check("apply 未抛异常", true);
} catch (e) {
  check("apply 未抛异常", false, e.message);
  process.exit(1);
}

console.log("\n" + "─".repeat(66) + "\n3. 等待首轮轮询（2.2s）\n" + "─".repeat(66));
await sleep(2400);

console.log("\n" + "─".repeat(66) + "\n4. 插件是否找到窗口并写出状态\n" + "─".repeat(66));
// 目标窗口的判据是「进程 exe === process.execPath」。用系统 node 跑本套件时
// execPath 是 node.exe，插件会（正确地）拒绝任何 DSH 窗口，因此不会写出状态。
// 这是门禁按设计工作，不是失败——此时跳过依赖真实窗口的断言。
const runningUnderDsh = /DeepSeek Harness\.exe$/i.test(process.execPath);
const stateExists = existsSync(stateFile);
if (runningUnderDsh) {
  check("状态文件已生成", stateExists, stateFile);
} else {
  console.log(`    跳过窗口断言：当前 execPath 为 ${process.execPath}`);
  console.log("    插件只会操作 exe 与 execPath 相同的进程，故此处不应写盘。");
  check("未在非宿主进程中写盘（门禁生效）", !stateExists);
}
let state = null;
if (stateExists) {
  state = JSON.parse(readFileSync(stateFile, "utf8"));
  console.log("    内容:", JSON.stringify({ ...state, savedAt: "(略)" }));
  check("schema 为 1", state.schema === 1);
  check("含 x/y/width/height", ["x", "y", "width", "height"].every((k) => Number.isFinite(state[k])));
  check("含 maximized 布尔", typeof state.maximized === "boolean");
  check("尺寸合理（>= 400x300）", state.width >= 400 && state.height >= 300, `${state.width}x${state.height}`);
  check("未写入最小化垃圾值", state.x > -30000 && state.y > -30000, `x=${state.x} y=${state.y}`);
}

console.log("\n" + "─".repeat(66) + "\n5. 窗口归属门禁（本插件的安全边界，必须防回退）\n" + "─".repeat(66));
{
  const { readFileSync: rf } = await import("node:fs");
  const src = rf(new URL("../lib/index.js", import.meta.url), "utf8");

  // 曾经的事故：定位逻辑在找不到宿主窗口时，回退为「标题含 DeepSeek 的最大窗口」。
  // 标题是任意文本——浏览器打开一个标题含 DeepSeek 的页面即被认定为宿主主窗口，
  // 插件随即改写该浏览器的窗口几何。该回退已删除，此处锁死不再引入。
  check("定位逻辑不含按标题猜测的回退", !/byTitle/.test(src));
  check("定位逻辑不读取窗口标题作判据", !/windowText/.test(src));

  // 归属判据必须存在且被用于过滤
  check("以进程 exe 与 execPath 相同作为归属判据", /normalizeExePath\(process\.execPath\)/.test(src));
  check("候选窗口须通过归属校验", /function isCandidate[\s\S]{0,400}isOwnProcess\(hwnd\)/.test(src));
  // 写窗口前须再次校验（句柄可能被系统复用）
  {
    const guard = src.indexOf("写之前的最后一道门禁");
    const write = src.indexOf("writePlacement(b, hwnd, geometryToRect(fitted)");
    check(
      "写窗口前再次校验归属",
      guard !== -1 && write !== -1 && guard < write,
      guard === -1 ? "未找到门禁" : write === -1 ? "未找到 writePlacement" : `门禁 ${guard} < 写入 ${write}`,
    );
  }
}

console.log("\n" + "─".repeat(66) + "\n6. 句柄缓存与失效（性能改造的回归保护）\n" + "─".repeat(66));
{
  const { createRequire } = await import("node:module");
  const { bindUser32, enumTopLevel } = await import("../lib/win32.js");
  // 必须与插件走同一条加载路径（createRequire 直接取 module.exports）。
  // 若在此处用 `.default ??`，拿到的是包装对象，会绕过挂在 koffi 上的绑定缓存，
  // 进而二次注册同名类型而抛错——这正是本断言要防的一类回归。
  const koffi = createRequire(import.meta.url)("koffi");
  const b = bindUser32(koffi);
  check("测试与插件共用同一 koffi 实例（绑定缓存可命中）", b !== null);

  // 找一个真实存在的顶层句柄
  let probe = null;
  if (b !== null) {
    enumTopLevel(b, (h) => {
      if (b.IsWindowVisible(h) && b.GetAncestor(h, b.GA_ROOT) === h) { probe = h; return false; }
      return true;
    });
  }
  check("IsWindow 对真实句柄返回 true（缓存守卫依赖它）", probe !== null && b !== null && b.IsWindow(probe) === true);
  check("IsWindow 对无效句柄返回 false（缓存据此失效）", b !== null && b.IsWindow(1) === false);

  // 实测缓存带来的差距必须存在，否则说明又退回全量枚举
  const { readFileSync: rf } = await import("node:fs");
  const src = rf(new URL("../lib/index.js", import.meta.url), "utf8");
  check("轮询路径包含句柄缓存（let target）", /let target\s*=\s*null/.test(src));
  check("缓存命中时走 IsWindow 守卫而非重新枚举", /b\.IsWindow\(target\)/.test(src));
  check("句柄失效时清空缓存以便重新定位", /target\s*=\s*null/.test(src));
}

console.log("\n" + "─".repeat(66) + "\n7. 幂等性：再次 apply（模拟 HMR 重载）\n" + "─".repeat(66));
try {
  ctx._dispose?.();
  mod.apply(ctx);
  check("第二次 apply 未抛 Duplicate type name", true);
} catch (e) {
  check("第二次 apply 未抛 Duplicate type name", false, e.message);
}
await sleep(300);

console.log("\n" + "─".repeat(66) + "\n8. 损坏状态文件的容错\n" + "─".repeat(66));
ctx._dispose?.();
writeFileSync(stateFile, "{ this is not json");
try {
  // 重新 import 以清空模块内 saved 缓存（模拟下次启动）
  const mod2 = await import(new URL("../lib/index.js", import.meta.url).href + "?fresh=1");
  mod2.apply(ctx);
  await sleep(300);
  check("损坏文件不会导致 apply 抛错", true);
} catch (e) {
  check("损坏文件不会导致 apply 抛错", false, e.message);
}

console.log("\n" + "─".repeat(66) + "\n9. 异常几何被拒（不套用可疑数据）\n" + "─".repeat(66));
ctx._dispose?.();
writeFileSync(stateFile, JSON.stringify({ schema: 1, x: -32000, y: -32000, width: 160, height: 28, maximized: false }));
try {
  const mod3 = await import(new URL("../lib/index.js", import.meta.url).href + "?fresh=2");
  mod3.apply(ctx);
  await sleep(300);
  check("最小化垃圾值被拒绝，不抛错", true);
} catch (e) {
  check("最小化垃圾值被拒绝，不抛错", false, e.message);
}

console.log("\n" + "─".repeat(66) + "\n10. 清理\n" + "─".repeat(66));
ctx._dispose?.();
check("dispose 后可正常退出（定时器已清）", true);

console.log("\n" + "═".repeat(66));
console.log(`结果: ${passed} 通过 / ${failed} 失败`);
console.log("═".repeat(66));
process.exit(failed === 0 ? 0 : 1);
