/**
 * 交付前清单校验：确认项目自洽、可被他人使用。
 * 用法: node test/manifest.test.js
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

let n = 0;
const ok = (label, fn) => { fn(); n++; console.log(`  PASS  ${label}`); };
const exists = (p) => existsSync(join(ROOT, p));

console.log("包清单");
ok("name 合法且为小写连字符", () => assert.match(pkg.name, /^[a-z0-9][a-z0-9-]*$/));
ok("version 语义化", () => assert.match(pkg.version, /^\d+\.\d+\.\d+/));
ok("description 存在", () => assert.ok(pkg.description.length > 20));
ok("license 为 MIT", () => assert.equal(pkg.license, "MIT"));
ok("非 private（可发布）", () => assert.equal("private" in pkg, false));
ok("type 为 module", () => assert.equal(pkg.type, "module"));
// 刻意不声明 os 字段：npm 会据此在非 Windows 平台直接拒绝安装（EBADPLATFORM），
// 而 DSH 插件的惯例是运行时守卫——装上但静默不生效，这样跨平台共用同一份依赖图。
ok("未声明 os 字段（避免非 Windows 平台装不上）", () => assert.equal("os" in pkg, false));

console.log("\n发现与兼容字段");
ok("keywords 含 dsh-plugin（官方 CONTRIBUTING 要求）", () => assert.ok(pkg.keywords.includes("dsh-plugin")));
ok("keywords 含 dsh 与 deepseek-harness", () => {
  assert.ok(pkg.keywords.includes("dsh"));
  assert.ok(pkg.keywords.includes("deepseek-harness"));
});
ok("声明 engines.dsh", () => assert.equal(typeof pkg.engines.dsh, "string"));
ok("声明 engines.node", () => assert.equal(typeof pkg.engines.node, "string"));
ok("声明 repository / homepage / bugs", () => {
  assert.ok(pkg.repository.url.startsWith("git+https://"));
  assert.ok(pkg.homepage.startsWith("https://"));
  assert.ok(pkg.bugs.url.startsWith("https://"));
});

console.log("\n入口与 dsh 清单");
ok("main 指向存在的文件", () => { assert.ok(isValidMain(pkg.main)); });
function isValidMain(m) { assert.equal(typeof m, "string"); assert.ok(existsSync(join(ROOT, m))); return true; }
ok("exports 覆盖 . / cordis.patch.yml / package.json", () => {
  assert.deepEqual(Object.keys(pkg.exports).sort(), [".", "./cordis.patch.yml", "./package.json"].sort());
});
ok("dsh.bundle.patch 指向存在的文件", () => {
  assert.equal(pkg.dsh.bundle.patch, "./cordis.patch.yml");
  assert.ok(existsSync(join(ROOT, "cordis.patch.yml")));
});
ok("dsh.manifestVersion 为 1", () => assert.equal(pkg.dsh.manifestVersion, 1));
ok("dsh.displayName 为中文", () => assert.match(pkg.dsh.displayName, /[\u4e00-\u9fa5]/));

console.log("\n补丁内容");
ok("补丁插入行且引用本包名", () => {
  const patch = readFileSync(join(ROOT, "cordis.patch.yml"), "utf8");
  assert.ok(patch.includes("insert:"));
  assert.ok(patch.includes(pkg.name));
});

console.log("\n文件完整性");
for (const f of pkg.files) {
  if (f.includes("*")) continue;
  ok(`files 声明的 ${f} 存在`, () => assert.ok(existsSync(join(ROOT, f)), `${f} 缺失`));
}
ok("存在 .gitignore", () => assert.ok(existsSync(join(ROOT, ".gitignore"))));
// 测试不进发布包：使用者从 npm 装到 node_modules 后不会去跑测试，
// 那些断言是给贡献者（clone 仓库）用的。发布包只带运行所需文件。
ok("files 白名单不含 test（发布包只带运行所需）", () => {
  assert.equal(pkg.files.includes("test"), false);
});
ok("存在全部测试入口", () => {
  for (const f of [
    "test/manifest.test.js",
    "test/geometry.test.js",
    "test/integration.windows.mjs",
    "test/e2e.host.mjs",
    "test/dispose.host.mjs",
  ]) {
    assert.ok(existsSync(join(ROOT, f)), `${f} 缺失`);
  }
});
ok("scripts.test 覆盖全部五套测试", () => {
  for (const f of [
    "manifest.test.js",
    "geometry.test.js",
    "integration.windows.mjs",
    "e2e.host.mjs",
    "dispose.host.mjs",
  ]) {
    assert.ok(pkg.scripts.test.includes(f), `scripts.test 未覆盖 ${f}`);
  }
});

console.log("\n依赖策略");
// koffi 必须留在 devDependencies：放进 dependencies 会让 pnpm 因
// `ERR_PNPM_IGNORED_BUILDS` 以退出码 1 结束，而 DSH 把该错误归类为安装失败
// （见 dsh-plugin-manager 的 install-failure.js）。运行时改从宿主借——
// dsh-desktop-host 自带 koffi，其入口路径即 process.argv[1]。
ok("koffi 不在 dependencies 中（否则 pnpm 安装会报 build-blocked 失败）", () => {
  assert.equal("dependencies" in pkg ? pkg.dependencies.koffi : undefined, undefined);
});
ok("koffi 声明在 devDependencies 供本地测试", () => {
  assert.match(pkg.devDependencies.koffi, /^\^\d+\.\d+\.\d+$/);
});
ok("无任何运行时 dependencies（全靠宿主提供能力）", () => {
  assert.equal(pkg.dependencies, undefined);
});
ok("未声明 optionalDependencies 藏 koffi（实测同样触发 build-blocked）", () => {
  assert.equal(pkg.optionalDependencies, undefined);
});

console.log("\n文档一致性");
const zh = readFileSync(join(ROOT, "README.md"), "utf8");
const en = readFileSync(join(ROOT, "README.en.md"), "utf8");
ok("中英文 README 互链", () => {
  assert.ok(zh.includes("./README.en.md"));
  assert.ok(en.includes("./README.md"));
});
ok("README 未残留旧字段名（maximized 而非 isMaximized）", () => {
  assert.ok(!zh.includes("isMaximized"));
  assert.ok(!en.includes("isMaximized"));
});
ok("README 说明了平台限制", () => {
  assert.ok(/仅 Windows/.test(zh));
  assert.ok(/Windows only/i.test(en));
});

console.log("\n源码卫生");
const src = ["lib/index.js", "lib/win32.js", "lib/geometry.js"].map((f) => readFileSync(join(ROOT, f), "utf8")).join("\n");
ok("无遗留的调试输出", () => {
  assert.ok(!/console\.(log|debug)\(/.test(src), "源码里不应有 console.log");
});
ok("无误提交的绝对路径", () => {
  // 匹配任何盘符绝对路径（C:\... / D:\...），以及 POSIX 的 /Users/、/home/
  assert.ok(!/[A-Za-z]:\\\\/.test(src), "源码里不应含 Windows 绝对路径");
  assert.ok(!/(?:\/Users\/|\/home\/)/.test(src), "源码里不应含 POSIX 家目录路径");
});
ok("无用户名字样泄漏", () => {
  assert.ok(!new RegExp(process.env.USERNAME ?? "\u0000", "i").test(src), "源码里不应含本机用户名");
});
ok("无 TODO / FIXME 遗留", () => assert.ok(!/\b(TODO|FIXME|XXX)\b/.test(src)));
ok("导出契约完整", () => {
  assert.ok(/export const name/.test(src));
  assert.ok(/export const inject/.test(src));
  assert.ok(/export function apply/.test(src));
});

console.log(`\nmanifest.test.js: ${n} 项通过`);
