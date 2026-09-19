# Deep Scan Lock

Sci-fi **lock / idle HUD** for [Omarchy](https://omarchy.org) Quattro. When you
summon it — or arm it before a real session lock — it paints a cinematic
“deep scan” overlay: lidar sweep, hex grid, fingerprint and retina motifs,
status lines, a local clock, and an unlock hint.

Plugin id: `smf.deep-scan-lock`. Overlay plus a tiny bar-widget **arm /
preview** chip. From [SMF Works](https://github.com/smfworks); destined for
mikesai6 Omarchy installs when that bundle is used.

This is a **visual companion** to first-party [`omarchy.lock`](https://github.com/basecamp/omarchy).
Quattro has no third-party lock-chrome `kind` and no documented lock-screen
hook. `omarchy.lock` owns the compositor `WlSessionLock` surface and PAM
(`omarchy-lock-password` / fingerprint). Deep Scan Lock **does not** replace
that path, accept a password, or unlock the machine. Do not treat the HUD as
a security control — see [docs/OPPOSITION.md](docs/OPPOSITION.md).

Sibling plugins:
[Neural Pulse](https://github.com/smfworks/omarchy-neural-pulse),
[Orbit Dock](https://github.com/smfworks/omarchy-orbit-dock),
[Ghost Trace](https://github.com/smfworks/omarchy-ghost-trace),
[Spectra](https://github.com/smfworks/omarchy-spectra),
[Aegis Gate](https://github.com/smfworks/omarchy-aegis-gate).

## Install

```sh
omarchy plugin add https://github.com/smfworks/omarchy-deep-scan-lock.git --enable
```

Plugins run **unsandboxed** inside the long-lived `omarchy-shell` process, with
your user permissions. Review this repo before enabling.

Optional bar chip (right section by default):

```sh
omarchy bar move smf.deep-scan-lock --section right
```

## Summon

Fullscreen `overlay`, same contract as first-party pickers and
`smf.orbit-dock` / `smf.aegis-gate`:

```sh
omarchy-shell shell summon smf.deep-scan-lock '{"mode":"demo"}'
omarchy-shell shell hide smf.deep-scan-lock
omarchy-shell shell toggle smf.deep-scan-lock '{}'
```

```
bind = SUPER, L, exec, omarchy-shell shell toggle smf.deep-scan-lock '{"mode":"demo"}'
```

Arm the companion (keeps loaded, polls lock IPC, waits):

```sh
omarchy-shell shell summon smf.deep-scan-lock '{"mode":"armed"}'
```

Left-click the bar chip to preview / toggle. Right-click to arm or disarm.

## What this is not

- **Not a lock screen.** Unlock still goes through Omarchy / Hyprland / PAM.
- **Not an authenticator.** There is no password field and no fingerprint PAM
  of our own. Touching the HUD cannot unlock the session.
- **Not a lock-chrome hook.** First-party `omarchy.lock` is a `service` using
  Quickshell `WlSessionLock`. Third-party overlays cannot sit on that secure
  surface. When the compositor owns the lock (`sessionLocked` / `secure`),
  this HUD hides, yields the keyboard, and does not steal keyboard focus.

Use it as **screenshot bait**, a DEMO cinematic, or an ARMED companion you
bring up **before** `omarchy.lock` takes the session.

## Honesty

The status chip is labeled so a screenshot is self-describing. The bar chip
uses the same words (DEMO / ARM / LIVE / ERR / STALE) — DEMO is never
**SCAN**.

| Chip | Meaning |
|------|---------|
| **DEMO** | Cinematic preview. Looping scan progress. Never a security claim. |
| **ARMED** | Companion armed. Lock IPC is reachable. Compositor has **not** taken `sessionLocked` / `secure`. Includes Omarchy `locked` while still requested/pending. |
| **LIVE** | Lock IPC `sessionLocked` or `secure` is true (Hyprland helper exit 0 counts). |
| **ERR** | Armed / live probe failed and there is no last-good snapshot. |
| **STALE** | Armed / live probe failed; last-good snapshot only. Not a live claim. Overlay stays hidden if that snapshot was compositor-held. |

Rules:

- **SECURE** only when mode is LIVE **and** lock IPC says the compositor
  holds the session (`sessionLocked` or `secure`). Omarchy’s `locked` bit
  alone is `lockRequested \|\| sessionLocked \|\| secure` and is **not**
  enough.
- DEMO never wears a security stamp. **SCANNING** is a labeled loop.
- The HUD never accepts a password. No field, no PAM. Keys yield while
  lock is in flight or the compositor owns the session.
- **UNLOCKED** appears only after compositor lock IPC goes held → not held.
- `{"mode":"live"}` without `sessionLocked`/`secure` does **not** become
  LIVE (it arms and waits).
- **ERR** and **STALE** are visible on the overlay and the bar.

Adversarial review: [docs/OPPOSITION.md](docs/OPPOSITION.md).

## Keys

- `Escape` closes DEMO / ARMED / ERR / STALE when the compositor does **not**
  own the session lock
- `Escape` does **not** dismiss a real compositor lock and is not swallowed
  when the HUD must yield
- Click the dimmed backdrop to dismiss the same way Escape does
- While `omarchy.lock` is requested, pending, authenticating, or
  `sessionLocked`/`secure`, the overlay yields Exclusive keyboard focus

## Probe

While the overlay is open or the companion is armed (`keepLoaded`), Deep Scan
Lock polls documented first-party lock IPC:

```sh
omarchy-shell lock status
omarchy-shell lock isLocked
omarchy-hyprland-session-locked
```

There is no idle-event subscription for third-party plugins. Idle timeouts
(`idle.lock` in `shell.json`) still belong to the first-party idle + lock
services. This HUD does not start `omarchy-shell lock lock`.

Arm state is written to:

```
~/.local/share/smf-deep-scan-lock/state.json
```

## Contract

- `schemaVersion: 1`, id `smf.deep-scan-lock` (not `omarchy.*`)
- `kinds: ["overlay", "bar-widget"]`
- `entryPoints.overlay: "Overlay.qml"`, `entryPoints.barWidget: "BarWidget.qml"`
- `open(payloadJson)` / `close()` for `shell summon` / `shell hide`
- `keepLoaded: true` so arm state and the layer-shell window survive between
  summons
- Bar click runs `omarchy-shell shell toggle smf.deep-scan-lock '{}'`
- Imports `qs.Ui` / `qs.Commons`; no symlinks

```sh
omarchy plugin validate .
```

## Tests

```sh
node tests/test_scan_logic.js
```

Optional HTML preview (no Omarchy required):

```sh
xdg-open preview/index.html
```

## Remove

```sh
omarchy plugin remove smf.deep-scan-lock
```

## License

MIT. Copyright (c) 2026 SMF Works.
