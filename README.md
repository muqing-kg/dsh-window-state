# 窗口状态记忆 · dsh-window-state

[English](./README.en.md) | 中文

让 **DeepSeek Harness 桌面版**记住主窗口的尺寸、位置与最大化状态：你把窗口拖成什么样子，下次启动它自己就回去了。

## 平台

**仅 Windows。** 插件依赖 Win32 的 `user32.dll` 读写窗口状态；macOS 与 Linux 需要完全不同的实现（`CGWindow` / X11）。

其他平台上插件会记一条 info 日志后跳过，不报错、不影响宿主。

## 安装

> 尚未发布到 npm。请直接用下面的 GitHub 方式安装。

从 GitHub 安装：

```sh
dsh plugin --profile desktop add github:muqing-kg/dsh-window-state
```

或在 DSH 设置面板的插件页中安装。**安装后需重启 DSH。**

从源码安装（想改代码时）：

```sh
git clone https://github.com/muqing-kg/dsh-window-state.git
cd dsh-window-state
npm install
dsh plugin --profile desktop add .
```

## 使用

装上即可，没有配置项。

- **第一次运行**：沿用当前窗口，开始记录。
- **之后**：窗口尺寸、位置或最大化状态变化时自动记录（每 2 秒检查一次）。
- **下次启动**：恢复上次的尺寸、位置与最大化状态。

退出 DSH 时会再记录一次最终值，因此"调整完就关"也能被准确记住。

想重置，删掉状态文件：

```powershell
Remove-Item "$env:USERPROFILE\.dsh\window-state.json"
```

## 状态文件

`$DSH_HOME/window-state.json`（默认 `~/.dsh/window-state.json`）：

```json
{
  "schema": 1,
  "x": 234,
  "y": 234,
  "width": 1920,
  "height": 1023,
  "maximized": false,
  "savedAt": "2026-09-29T12:00:00.000Z"
}
```

文件损坏、缺少必需字段，或被更高版本的 schema 写入时，插件视为"无记录"，沿用当前窗口而不套用可疑数据。

## 可调参数

`lib/index.js` 顶部：

| 常量 | 默认 | 含义 |
|---|---|---|
| `POLL_MS` | `2000` | 检查间隔（毫秒） |
| `WAIT_MS` | `90000` | 等待主窗口出现的上限 |

`lib/geometry.js` 顶部的 `MIN_W` / `MIN_H` 决定多大的窗口才被视为主窗口。

## 安全边界

插件**只操作宿主自己的窗口**：目标窗口所属进程的可执行文件必须与插件进程的 `process.execPath` 相同，否则一律跳过；写窗口前会再校验一次（句柄可能被系统复用）。

这条门禁是必需的，不是锦上添花：早期版本在找不到宿主窗口时会退回到「标题含 DeepSeek 的最大窗口」，结果是浏览器只要打开一个标题含 "DeepSeek" 的页面，就会被误认成主窗口并被改写几何。按标题猜测的逻辑已彻底移除。

## 已知限制

- **窗口会以默认尺寸短暂闪现一次。** 插件只能在窗口出现后调整它；创建时的默认尺寸硬编码在官方 `app.asar` 里。
- **不跟踪全屏**，只记录正常态与最大化。
- **强杀、崩溃或断电时**，最后一次调整可能丢失（此时以轮询记录为准）。
- 不含窗口吸附或分屏逻辑，不改变 Windows 的贴靠行为。
- 若官方桌面版未来自己实现了窗口状态持久化，本插件应卸载。

## 开发

```sh
npm test              # 全部六套
npm run test:unit     # 几何计算（任意平台）
npm run test:windows  # FFI 与窗口行为
npm run test:e2e      # 端到端加载
npm run test:dispose  # 退出前记录
npm run test:safety   # 不误伤其他程序（安全边界）
```

`test:manifest` 与 `test:unit` 在任意平台可跑。其余四套需要真实 Windows 与 DSH 环境——插件只操作 `execPath` 相同的进程，用系统 node 运行时它会（正确地）拒绝任何 DSH 窗口，因此这些套件会跳过依赖真实窗口的断言：

```powershell
$env:ELECTRON_RUN_AS_NODE=1
& "<DSH 安装目录>\DeepSeek Harness.exe" test/safety.host.mjs
```

## 许可

MIT
