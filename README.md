# RETRO

A quiet, browser-based game room for Nintendo DS, Game Boy Advance, and experimental Nintendo 3DS emulation. Deployed in the existing `retro_emul` Vercel project.

## Features

- Local ROM library with content-based deduplication, search, sorting, and console filters.
- DS: `.nds`, `.srl`; GBA: `.gba`, `.agb`; 3DS: decrypted `.cci`, `.cxi`, `.3dsx`, and `.3ds` (passed to Azahar as `.cci`). Recognized ROM headers can identify `.bin` files.
- ZIP import can add multiple supported ROMs. RAR/7Z must be extracted first. One ROM / ZIP expansion is limited to 512 MiB.
- Keyboard, USB/Bluetooth gamepads via the browser Gamepad API, and pointer-based screen buttons. Per-device remapping, analog-axis capture, adjustable deadzone, and Nintendo position defaults.
- Game saves are stored every 15 seconds and when pausing or switching games. Three quick-save slots per ROM/core; portable export/import with ROM/core identity validation.
- Native melonDS includes FreeBIOS direct boot and a per-ROM virtual homebrew SD card. The SD image is saved along with the ROM's browser backup, and included in quick-save exports.
- DS screen layout selection, volume, pause, speed control, screenshot export, focus mode, and fullscreen.
- Responsive Korean interface; local font subset without a third-party font network request.

## Development

```sh
npm ci
npm test
npm run build
npm run dev
```

The development server serves `dist/` with COOP/COEP headers and caches upstream emulator resources. It requires `curl`. The production app is static; `vercel.json` routes engine assets through Vercel rewrites. Node.js 22 or newer is required for build/test, with Node.js 24 selected on Vercel.

## Runtime and compatibility

Default DS engine: pinned **Pilas-melonDS**, with **DeSmuME**, **DeSmuME 2015**, and legacy **melonDS/libretro** available as alternatives. The libretro melonDS core needs user-provided DS BIOS and firmware. GBA uses **mGBA**. Experimental 3DS uses threaded **Azahar** via the EmulatorJS nightly frontend.

3DS requires HTTPS, cross-origin isolation / SharedArrayBuffer, and WebGL2. Its compatibility and performance vary substantially by browser, hardware, and game. Encrypted games and CIA installation are unsupported. Camera, microphone, and multiplayer/network services are outside this version's scope.

All ROMs, supplied BIOS files, profiles, and saved data stay in the user's browser. They are not uploaded. Browser data deletion also deletes local games/saves. Export important save states or cartridge saves for backup. Save states from different cores are not interchangeable; native cartridge save imports remain subject to each emulator's save-format support.

## Validation

- Five unit tests cover extension aliases, header detection, hash-based deduplication, Nintendo gamepad defaults, nonstandard profiles, axes, and deadzones.
- Browser tests use custom GBA/3DS homebrew and the previously created Summerlight DS homebrew; no commercial ROMs are committed.
- Native DS: visible game title, touch input, quick-save restore after page reload, and mobile layout checked.
- GBA: visible frame rendering, keyboard input, simulated standard-controller input/remapping, SRAM persistence, and quick-save restore checked.
- 3DS: threaded Azahar startup and visible custom 3DSX homebrew screen checked. This does not establish commercial-game compatibility.
- Physical controllers are not available in this environment; controller tests use a simulated Gamepad API device.

See [NOTICE.md](NOTICE.md) for engine and font sources/licenses.
