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

## 已知限制

- **窗口会以默认尺寸短暂闪现一次。** 插件只能在窗口出现后调整它；创建时的默认尺寸硬编码在官方 `app.asar` 里。
- **不跟踪全屏**，只记录正常态与最大化。
- **强杀、崩溃或断电时**，最后一次调整可能丢失（此时以轮询记录为准）。
- 不含窗口吸附或分屏逻辑，不改变 Windows 的贴靠行为。
- 若官方桌面版未来自己实现了窗口状态持久化，本插件应卸载。

## 开发

```sh
npm test              # 全部五套
npm run test:unit     # 几何计算（任意平台）
npm run test:windows  # Windows 集成
npm run test:e2e      # 端到端加载
npm run test:dispose  # 退出前记录
```

跨平台的两套（`test:manifest`、`test:unit`）可直接运行；涉及窗口的三套需要 Windows，且会**自行拉起临时记事本窗口**作为测试对象并在结束时关闭，不触碰你正在使用的窗口。

## 许可

MIT
