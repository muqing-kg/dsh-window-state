# dsh-window-state

English | [中文](./README.md)

Remembers the **DeepSeek Harness Desktop** main window's size, position and maximized state: drag the window to whatever shape you like, and it comes back that way on the next launch.

## Platform

**Windows only.** The plugin uses Win32's `user32.dll` to read and write window state; macOS and Linux would need entirely different implementations (`CGWindow` / X11).

On other platforms it logs one info line and returns, without errors or impact on the host.

## Install

> Not published to npm yet. Use the GitHub form below.

From GitHub:

```sh
dsh plugin --profile desktop add github:muqing-kg/dsh-window-state
```

Or install it from the Plugins page in DSH settings. **Restart DSH afterwards.**

From source (if you want to modify it):

```sh
git clone https://github.com/muqing-kg/dsh-window-state.git
cd dsh-window-state
npm install
dsh plugin --profile desktop add .
```

## Usage

Nothing to configure.

- **First run**: keeps the current window and starts recording.
- **After that**: size, position and maximized state are recorded whenever they change (checked every 2 seconds).
- **Next launch**: the last geometry is restored.

The final geometry is also written when DSH exits, so "adjust and quit" is captured accurately.

To reset, delete the state file:

```powershell
Remove-Item "$env:USERPROFILE\.dsh\window-state.json"
```

## State file

`$DSH_HOME/window-state.json` (defaults to `~/.dsh/window-state.json`):

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

A corrupt file, missing required fields, or a file written by a newer schema version is treated as "no record": the plugin keeps the current window rather than applying questionable data.

## Tuning

At the top of `lib/index.js`:

| Constant | Default | Meaning |
|---|---|---|
| `POLL_MS` | `2000` | Check interval in milliseconds |
| `WAIT_MS` | `90000` | How long to wait for the main window |

`MIN_W` / `MIN_H` in `lib/geometry.js` set how large a window must be to count as the main window.

## Safety boundary

The plugin **only touches the host's own windows**: the target window's owning process must have the same executable as the plugin process's `process.execPath`, otherwise it is skipped outright. The check runs again immediately before writing (a handle can be recycled).

This guard is a requirement, not a nicety: an earlier version fell back to "the largest window whose title contains DeepSeek" when it could not find the host window, which meant any browser showing a page with "DeepSeek" in its title was mistaken for the main window and had its geometry rewritten. Title-based guessing has been removed entirely.

## Limitations

- **The window briefly appears at the default size.** The plugin can only adjust it once it exists; the creation-time default is hard-coded in the official `app.asar`.
- **Fullscreen is not tracked**, only normal and maximized.
- **After a force-kill, crash or power loss**, the last adjustment may be lost (the periodic record is what survives).
- No snapping or split-screen logic; Windows snap behaviour is unchanged.
- If the official desktop app ever implements window-state persistence itself, this plugin should be removed.

## Development

```sh
npm test              # all six suites
npm run test:unit     # geometry (any platform)
npm run test:windows  # FFI and window behaviour
npm run test:e2e      # end-to-end load
npm run test:dispose  # record-on-exit
npm run test:safety   # never touches other applications
```

`test:manifest` and `test:unit` run anywhere. The other four need real Windows and DSH — the plugin only touches processes whose executable matches `execPath`, so under plain node it correctly refuses every DSH window and those suites skip the assertions that need a real window:

```powershell
$env:ELECTRON_RUN_AS_NODE=1
& "<DSH install dir>\DeepSeek Harness.exe" test/safety.host.mjs
```

## Community

Thanks to [LINUX DO](https://linux.do) for providing an open and friendly platform for technical exchange

## License

MIT
