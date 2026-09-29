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

## Limitations

- **The window briefly appears at the default size.** The plugin can only adjust it once it exists; the creation-time default is hard-coded in the official `app.asar`.
- **Fullscreen is not tracked**, only normal and maximized.
- **After a force-kill, crash or power loss**, the last adjustment may be lost (the periodic record is what survives).
- No snapping or split-screen logic; Windows snap behaviour is unchanged.
- If the official desktop app ever implements window-state persistence itself, this plugin should be removed.

## Development

```sh
npm test              # all five suites
npm run test:unit     # geometry (any platform)
npm run test:windows  # Windows integration
npm run test:e2e      # end-to-end load
npm run test:dispose  # record-on-exit
```

The two cross-platform suites (`test:manifest`, `test:unit`) run anywhere. The three window suites need Windows and **spawn their own temporary Notepad window** as the subject, closing it afterwards, so they never touch the window you are using.

## License

MIT
