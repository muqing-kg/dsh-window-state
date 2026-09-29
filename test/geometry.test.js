/**
 * geometry.js 自检。无框架，直接 `node test/geometry.test.js`。
 * 只覆盖会被真实边界触发的分支：校验、缩小、离屏归位、坐标换算。
 */
import assert from "node:assert/strict";
import { isValidGeometry, fitIntoWorkArea, rectToGeometry, geometryToRect } from "../lib/geometry.js";

let n = 0;
const ok = (fn) => { fn(); n++; };

// ── isValidGeometry ──────────────────────────────────────────────
ok(() => assert.equal(isValidGeometry({ x: 0, y: 0, width: 1280, height: 820 }), true));
ok(() => assert.equal(isValidGeometry({ x: -1920, y: 0, width: 1280, height: 820 }), true, "副屏在左侧时为负"));
ok(() => assert.equal(isValidGeometry(null), false));
ok(() => assert.equal(isValidGeometry({}), false));
ok(() => assert.equal(isValidGeometry({ x: 0, y: 0, width: 100, height: 820 }), false, "过窄"));
ok(() => assert.equal(isValidGeometry({ x: 0, y: 0, width: 1280, height: 100 }), false, "过矮"));
ok(() => assert.equal(isValidGeometry({ x: NaN, y: 0, width: 1280, height: 820 }), false, "NaN"));
ok(() => assert.equal(isValidGeometry({ x: 0, y: 0, width: "1280", height: 820 }), false, "字符串不算数"));
// 最小化时的垃圾值必须被拒（正是 GetWindowRect 会吐出的东西）
ok(() => assert.equal(isValidGeometry({ x: -32000, y: -32000, width: 160, height: 28 }), false, "最小化垃圾值"));
ok(() => assert.equal(isValidGeometry({ x: 0, y: 0, width: 1280, height: 820e6 }), false, "离谱高度"));

// ── fitIntoWorkArea ──────────────────────────────────────────────
const work = { left: 0, top: 0, right: 1920, bottom: 1040 };
ok(() => assert.deepEqual(
  fitIntoWorkArea({ x: 100, y: 50, width: 1280, height: 820 }, work, true),
  { x: 100, y: 50, width: 1280, height: 820 },
  "放得下就原样返回",
));
ok(() => assert.deepEqual(
  fitIntoWorkArea({ x: 100, y: 50, width: 2560, height: 1440 }, work, true),
  { x: 100, y: 50, width: 1920, height: 1040 },
  "换小屏后缩小到工作区",
));
ok(() => assert.deepEqual(
  fitIntoWorkArea({ x: -5000, y: 300, width: 1280, height: 820 }, work, false),
  { x: 0, y: 0, width: 1280, height: 820 },
  "离屏则移回工作区左上角",
));
ok(() => assert.deepEqual(
  fitIntoWorkArea({ x: -5000, y: 300, width: 3000, height: 2000 }, work, false),
  { x: 0, y: 0, width: 1920, height: 1040 },
  "离屏且过大：同时归位与缩小",
));
// 工作区为负坐标（副屏在主屏左侧）
const leftWork = { left: -1920, top: 0, right: 0, bottom: 1040 };
ok(() => assert.deepEqual(
  fitIntoWorkArea({ x: -3000, y: 0, width: 1280, height: 820 }, leftWork, false),
  { x: -1920, y: 0, width: 1280, height: 820 },
  "负坐标工作区归位正确",
));

// ── 坐标换算 ─────────────────────────────────────────────────────
ok(() => assert.deepEqual(
  rectToGeometry({ left: 10, top: 20, right: 110, bottom: 220 }),
  { x: 10, y: 20, width: 100, height: 200 },
));
ok(() => assert.deepEqual(
  geometryToRect({ x: 10, y: 20, width: 100, height: 200 }),
  { left: 10, top: 20, right: 110, bottom: 220 },
));
ok(() => {
  const g = { x: -300, y: 40, width: 800, height: 600 };
  assert.deepEqual(rectToGeometry(geometryToRect(g)), g, "往返一致");
});

console.log(`geometry.test.js: ${n} 项通过`);
