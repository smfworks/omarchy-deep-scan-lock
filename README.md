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
that path, accept a password, or unlock the machine.

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
  this HUD hides and does not steal keyboard focus.

Use it as **screenshot bait**, a DEMO cinematic, or an ARMED companion you
bring up **before** `omarchy.lock` takes the session.

## Honesty

The status chip is labeled so a screenshot is self-describing:

| Chip | Meaning |
|------|---------|
| **DEMO** | Cinematic preview. Looping scan progress. Never a security claim. |
| **ARMED** | You armed the companion. Lock IPC is reachable and does **not** report locked. Waiting. |
| **LIVE** | `omarchy-shell lock status` (or `omarchy-hyprland-session-locked`) reports a real lock. |
| **ERR** | Armed / live probe failed and there is no last-good snapshot. |
| **STALE** | Armed / live probe failed; showing the last good lock snapshot. |

Rules:

- The HUD never claims the machine is locked or unlocked unless a real lock /
  session probe said so.
- **SECURE** is LIVE-only. DEMO never wears a security stamp.
- **SCANNING** in DEMO is a labeled loop, not a real scan.
- **UNLOCKED** appears only after lock IPC transitions from locked → not locked.
- `{"mode":"live"}` without a confirming probe does **not** become LIVE.

## Keys

- `Escape` closes DEMO / ARMED / ERR / STALE (and a pending LIVE companion)
- On a real compositor lock, this plugin does not fight `omarchy.lock`
- Click the dimmed backdrop to dismiss the same way Escape does

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
