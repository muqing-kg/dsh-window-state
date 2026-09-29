/**
 * 纯几何计算，不依赖任何平台 API，便于单独测试。
 */

/** 窗口可接受的最小尺寸，与主模块保持一致。 */
export const MIN_W = 400;
export const MIN_H = 300;

/** 判定一串数字是否是可用且合理的窗口几何。 */
export function isValidGeometry(value) {
  if (value === null || typeof value !== "object") return false;
  const { x, y, width, height } = value;
  if (![x, y, width, height].every((n) => Number.isFinite(n))) return false;
  if (width < MIN_W || height < MIN_H) return false;
  // 位置允许为负（多显示器左侧/上方），但不应离谱；上限防损坏的配置文件。
  if (Math.abs(x) > 100_000 || Math.abs(y) > 100_000) return false;
  if (width > 100_000 || height > 100_000) return false;
  return true;
}

/**
 * 让几何适应某块显示器的工作区。
 *
 * 只在两种情况下改动，其余原样返回：
 *   - 尺寸大于工作区：缩到工作区大小（换小屏或改分辨率后常见）；
 *   - `onScreen` 为 false：窗口整体已不在任何显示器上（拔掉外接屏后常见），
 *     移到该工作区左上角。
 *
 * @param geometry 目标几何
 * @param work 目标显示器工作区（rcWork，已排除任务栏）
 * @param onScreen 该几何是否仍与某块显示器相交
 */
export function fitIntoWorkArea(geometry, work, onScreen) {
  const availableW = Math.max(1, work.right - work.left);
  const availableH = Math.max(1, work.bottom - work.top);

  const width = Math.min(geometry.width, availableW);
  const height = Math.min(geometry.height, availableH);

  if (!onScreen) {
    return { ...geometry, x: work.left, y: work.top, width, height };
  }
  return { ...geometry, width, height };
}

/** 把 Win32 的 RECT 转成 {x,y,width,height}。 */
export function rectToGeometry(rect) {
  return {
    x: rect.left,
    y: rect.top,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
  };
}

/** 把 {x,y,width,height} 转成 Win32 的 RECT。 */
export function geometryToRect(geometry) {
  return {
    left: geometry.x,
    top: geometry.y,
    right: geometry.x + geometry.width,
    bottom: geometry.y + geometry.height,
  };
}
