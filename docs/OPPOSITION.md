# Opposition: do not trust Deep Scan Lock as security yet

Adversarial review of `smfworks/omarchy-deep-scan-lock` at `04d2037`
(`smf.deep-scan-lock` v0.1.0, plugin #1). Evidence is from `ScanLogic.js`,
`Overlay.qml`, `BarWidget.qml`, `manifest.json`, `README.md`,
`preview/index.html`, and `tests/test_scan_logic.js`. First-party lock
semantics are from `basecamp/omarchy` `shell/plugins/lock/Service.qml`
(`IpcHandler` `status` / `isLocked`).

This HUD already *labels* DEMO / ARMED / LIVE / ERR / STALE and says it is a
visual companion. The leftover lies are on the **face and the focus**: a
screenshot of mint **SECURE**, an overlay that takes **Exclusive** keys while
`omarchy.lock` is arming, and Escape that either dismisses a “lock” or
swallows the key the real lock needed.

## Addressed in this PR

The honesty follow-up in the same PR (`Honest scan — OPPOSITION + trust
fixes`) changes the trust contract this review asked for:

- **SECURE** is LIVE-only, and LIVE requires lock IPC `sessionLocked` or
  `secure` (compositor-held lock). Omarchy’s `locked` bit alone is not enough.
- **DEMO** never wears a security stamp. The bar chip says **DEMO**, not SCAN.
- The HUD **never accepts a password** and **yields** keyboard / hides when
  the session lock is held or last-known-held (`sessionLocked` / `secure`) or
  PAM is authenticating.
- **ERR** / **STALE** stay visible on overlay and bar.
- Escape does **not** dismiss a real compositor lock and does **not** swallow
  the key when the HUD must yield.
- Tests cover the gates above. Remaining P1/P2 items (idle hook, 40 ms paint,
  decorative biometrics) stay open.

The analysis below is the **pre-fix evidence** at `04d2037`.

Method: assume a user screenshots the overlay (and maybe the bar chip) and
treats **SECURE**, a fingerprint motif, or a dismissed HUD as “the session is
locked / I just unlocked.” Argue against that.

---

## 1. Executive opposition

I would not walk away from a Spark and trust this HUD. Quattro’s real lock is
`omarchy.lock`: `WlSessionLock` plus PAM (`omarchy-lock-password` /
fingerprint). This plugin is a `overlay` + `bar-widget` with no lock-chrome
`kind`. At `04d2037` it still stamps **SECURE** as soon as
`omarchy-shell lock status` reports `locked: true` — and first-party
`locked` is `lockRequested || sessionLock.locked || sessionLock.secure`. A
**pending** lock (screens stabilizing, no real outputs yet) is therefore
LIVE + mint **SECURE** on an Exclusive layer-shell window that sits on
`WlrLayer.Overlay` and can eat the password the real lock is about to ask
for. DEMO is labeled, but the bar chip says **SCAN**, the title says
**DEEP SCAN LOCK**, and the canvas draws a fingerprint and a retina. Escape
closes LIVE unless `sessionLocked`/`secure` is already true — so a requested
lock dismisses with Esc, and if the compositor *does* own the lock while the
overlay is still up, Escape is `accepted` even when `dismiss()` no-ops.
Do not screenshot **SECURE** and leave the room.

---

## 2. P0 — trust breakers (must-fix)

### P0.1 DEMO (and “almost-live”) still read as security

README and `honestyLine("demo")` say DEMO is not a security claim.
`statusLine("demo")` is **SCANNING** (or **UNLOCKED** after a transition).
`demoCopyIsHonest` rejects a DEMO string of `SECURE`. That is the easy half.

The **face** still sells a lock:

| Surface | At `04d2037` | What a crop believes |
|---------|--------------|----------------------|
| Center title | `DEEP SCAN LOCK` (`Overlay.qml`) | This *is* the lock screen. |
| Status chip | LIVE → **SECURE** (mint `#3DDC97`) | Session is protected. |
| Canvas | Fingerprint + retina motifs, lidar sweep | Biometric auth happened. |
| Bar chip | DEMO mode text **`SCAN`** | A real scan is running. |
| Preview LIVE scene | `status: "SECURE"` | Same stamp, no Omarchy. |

`neverClaimsSecure(overlay)` only greps the QML **source** for phrases like
`your system is secure`. Runtime `statusText` is `Scan.statusLine(...)`, so
the LIVE stamp is invisible to that lint. DEMO copy is honest; DEMO *chrome*
is a lock poster. A screenshot that misses the 13 px honesty pill is a
security claim.

`{"mode":"demo"}` correctly refuses to flip to LIVE when a later probe is
locked (`resolveOpen` / `forceDemo`). The failure is not “DEMO becomes
LIVE.” The failure is that **LIVE SECURE is one summon away from a pending
bit**, and DEMO already looks like the same HUD without the word SECURE.

### P0.2 ARMED vs LIVE is the Omarchy `locked` lie

First-party `status()`:

```javascript
locked: root.locked,          // lockRequested || sessionLock.locked || sessionLock.secure
requested: root.lockRequested,
pending: root.pendingSessionLock,
sessionLocked: sessionLock.locked,
secure: sessionLock.secure,
authenticating: root.authenticating,
```

`isLocked()` returns that same `root.locked` as `"true"` / `"false"`.

Deep Scan Lock then:

```javascript
// ScanLogic.js parseLockStatus
var locked = boolish(v.locked) || boolish(v.sessionLocked) || boolish(v.secure)

// resolveMode
if (probe.ok && probe.locked) return "live"

// statusLine
if (m === "live") return "SECURE"
```

**Reproduced** (payloads `status()` actually emits):

| IPC JSON | `resolveMode` (armed) | Face |
|----------|------------------------|------|
| `locked:false`, `sessionLocked:false`, `secure:false` | `armed` | **ARMED** — waiting. Honest. |
| `locked:true`, `requested:true`, `pending:true`, `sessionLocked:false`, `secure:false` | **`live`** | **SECURE**, mint, overlay **visible**, Exclusive keyboard. Tests at `04d2037` *require* this (`pending LIVE may still decorate`). |
| `locked:true`, `sessionLocked:true`, `secure:true` | `live` | **SECURE**, overlay hidden. Closest to truth — and still not PAM. |
| `omarchy-shell lock isLocked` → `true` | `live` if that text is parsed | **SECURE** with `sessionLocked:false`. Overlay never calls `isLocked` as its own argv; `applyLockRaw` will parse **status stdout** with `parseIsLocked` when JSON fails. |

ARMED means “companion waiting.” LIVE means “we saw `locked`.” Users hear
ARMED as **the session is armed** and LIVE/SECURE as **the compositor took
the lock**. Those are different instants in `omarchy.lock` (`lock-requested`
then `session-locked=` / `secure=true`, often 500 ms+ later, or stuck in
`lock-pending: no-real-screen`). The HUD collapses them.

`{"mode":"live"}` without a confirming probe stays DEMO (`wantLive` +
unlocked → `demo`). That test passes. The hole is the confirming probe:
**any `locked: true` confirms.**

### P0.3 Fighting the compositor lock (focus, layer, hide race)

`shouldShowOverlay` hides only when `compositorOwnsLock` —

```javascript
return probe.sessionLocked === true || probe.secure === true
```

So a **requested / pending** LIVE overlay stays up on `WlrLayer.Overlay`,
`exclusionMode: Ignore`, namespace `smf-deep-scan-lock`, **Exclusive**
keyboard unless `compositorLock` is already true.

`omarchy.lock` is about to set `sessionLock.locked = true` and put
`WlSessionLockSurface` + `LockView` (the PAM field) on the secure surface.
This plugin cannot sit on that surface (no third-party lock-chrome hook;
README admits it). What it *can* do is occupy Exclusive overlay focus
**in front of** the handoff.

Hide is also **one failed probe behind**:

```javascript
function ingestProbe(state, probe) {
  next.probe = incoming          // failed probe: sessionLocked false
  next.mode = "stale"            // if armed + lastGood
  next.overlayVisible = shouldShowOverlay("stale", failedProbe)  // true
}
```

`shouldShowOverlay` does not consult `lastGood`. If lock IPC flakes while
Hyprland still holds `ext-session-lock`, the HUD **reappears** on Overlay,
takes Exclusive focus (`compositorLock` is now false), and paints STALE
over the real lock. That is fighting the compositor.

`open()` always `forceActiveFocus()` on the key catcher when
`overlayVisible`. There is no yield on `requested` / `pending` /
`authenticating`.

### P0.4 Password / auth implications

There is no `TextInput`, no `PamContext`, no `submitPassword`.
`neverAcceptsPassword` greps source for `enter password`, `echoMode:
TextInput.Password`, `pamcontext`. Those greps pass. They do not measure
**key routing**.

At `04d2037`, Exclusive focus + `Keys.priority: Keys.BeforeItem` means
**every key** hits `keyCatcher` while the companion is the Exclusive client.
Only Escape is handled; other keys are dropped on the floor. That is
**accepting (eating) a password** without a field: the user types into a
cinematic HUD while `omarchy.lock` is pending or while a STALE overlay has
climbed back on top of a live `WlSessionLock`.

Fingerprint / retina strokes are decorative. They train the same muscle
memory as `omarchy.lock`’s fingerprint offer. Touching them does nothing;
they still look like an auth factor. The unlock hint on LIVE is honest
(“this HUD does not accept a password”) — **if the user reads the footer
after they have already typed.**

This plugin must never grow a password box. The P0 is: **do not be the
Exclusive client when PAM might be listening.**

### P0.5 Probe false positives (and a dead `isLocked` path)

| Probe | What `04d2037` treats as locked | False-positive |
|-------|----------------------------------|----------------|
| `parseLockStatus` | `locked \|\| sessionLocked \|\| secure` | `{"secure":true}` alone, or `locked:false` + `secure:true`, becomes `locked:true` then LIVE/SECURE. `passwordPam` / `fingerprint` are ignored (good). |
| `parseIsLocked` | exact `true`/`1`/`yes` | Omarchy `isLocked` is the **requested-OR-secure** bit. Parsed as `locked:true`, `sessionLocked:false`, `secure:false` → LIVE/SECURE + **visible** overlay. |
| `parseHyprlandLockExit(0)` | `locked:true`, `sessionLocked:true` | Honest *if* `omarchy-hyprland-session-locked` is the real helper. Exit `127` (missing binary) is unknown → ERR. Exit `0` from a stub that always succeeds would be LIVE. |
| `applyLockRaw` | status JSON, else `parseIsLocked(status stdout)` | Status help text or a logger line that trims to `true` becomes a lock. `isLockedArgv()` is **never used** as a Process command. |
| Status exit `0`, empty/garbage stdout | `emptyProbe` (`ok:false`) | No Hyprland fallback (`onExited` only starts hypr when `exitCode !== 0`). Armed companion → **ERR** on a locked machine, or **STALE** with a last-good **SECURE** face if we still showed lastGood (we do not; we show STALE). |
| `mergeProbes` | first `ok` wins | Defined, unused in `Overlay.qml`. |

Hyprland is only a fallback when `lock status` fails. A **successful**
unparseable status never asks the compositor helper. `isLocked` is documented
in README and exported as argv, then skipped.

`locked` from `lockRequested` is the systematic false positive (P0.2). The
table above is how that bit, and worse bits, get in.

### P0.6 Escape is wrong on a real lock

```javascript
function escapeCloses(mode, probe) {
  if (m === "live" && compositorOwnsLock(probe)) return false
  return m === "demo" || m === "armed" || m === "err" || m === "stale" || m === "live"
}
```

```qml
Keys.onPressed: function(event) {
  if (event.key === Qt.Key_Escape) {
    root.dismiss()
    event.accepted = true
  }
}
```

| State | Esc should | `04d2037` |
|-------|------------|-----------|
| DEMO / ARMED (unlocked) | Dismiss companion | Dismiss. Correct. |
| LIVE, `locked:true`, `sessionLocked:false` (pending) | Not a lock; dismissing the companion is OK **if** keys are not Exclusive. | Dismisses a HUD stamped **SECURE**. Looks like unlock. Session may still be unlocking into `omarchy.lock`. |
| LIVE, compositor owns lock, overlay hidden | Esc belongs to `LockView` / PAM | Overlay gone; OK. |
| LIVE or STALE, compositor owns lock, overlay **still visible** (hide race / failed probe) | Esc must reach the real lock | `dismiss()` no-ops, **`event.accepted = true` anyway**. Esc never arrives. |

Mouse click uses `enabled: Scan.escapeCloses(...)` (good). The key path
does not. This is the “Escape unlocks my lock screen” / “Escape does
nothing on the real lock” pair.

---

## 3. P1 — gaps / correctness

- **Bar face says SCAN for DEMO.** `barChip` DEMO → `{ text: "SCAN" }`.
  Neural Pulse / Cron Constellation honesty required the mode word on the
  bar. ERR / STALE / LIVE / ARM are visible; DEMO is not. High P1.
- **`{"mode":"live"}` does not arm.** `wantLive` does not set `armed`.
  After `ingestProbe`, payload is `{}` so a later unlocked probe falls
  back to DEMO. The companion does not *wait* unless the user also armed.
- **`lastLocked` tracks Omarchy `locked`, not compositor lock.** A
  requested→cancelled flicker can emit `UNLOCKED` without
  `sessionLocked` ever being true.
- **STALE is labeled but not last-good-for-hide.** Overlay can climb over
  a lock after IPC fail (P0.3). High P1, same family as P0.
- **No `isLocked` Process.** README lists three probes; QML runs two
  (`lock status`, `omarchy-hyprland-session-locked`). High P1 for the
  documented contract.
- **Status success + bad JSON skips Hyprland.** See P0.5.
- **40 ms Canvas timer** plus a 1 s probe while `opened || armed`, forever
  while armed (`keepLoaded: true`). Official lock is evented. This is a
  process factory next to PAM. Same class as Neural Pulse P1.
- **No idle hook.** README is honest (`idle.lock` stays first-party). The
  HUD cannot know *why* a lock started. Fine, but then LIVE must not mean
  “idle lock engaged.”
- **`FileView` boot** sets `armed` from `state.json` without going through
  `resolveOpen`. Mode stays `demo` until the 1 s timer probes. Brief DEMO
  chrome on an armed session.
- **Preview LIVE = SECURE** with no probe. Acceptable as a theater switch
  if the toolbar says LIVE; still a crop risk.
- **QML contract leftovers:** overlay `open` / `close` / `toggle` exist;
  no `closeForPopoutSwitch`. Bar has no `IpcHandler` (summon hits the
  overlay). No `preview.png`. README says `omarchy plugin validate .`,
  not `qmllint -I "$OMARCHY_PATH/shell" Overlay.qml BarWidget.qml`.
- **Theme:** mode colors are hardcoded hex (`#3DDC97` mint for LIVE), not
  `Color.accent`. Light theme + mint SECURE is a cyberpunk sticker for
  “safe.”
- **Tests the current file avoids.** `statusLine` on pending `locked:true`;
  `parseIsLocked("true")` must not be LIVE/SECURE; Escape `accepted` when
  `compositorOwnsLock`; `barChip` DEMO text; `shouldShowOverlay` with
  last-good session lock + failed probe; `isLockedArgv` actually referenced
  from `Overlay.qml`. The Node file asserts the *pending LIVE may decorate*
  behavior this review rejects.

---

## 4. P2 — improvements

- Do not grow PAM, `WlSessionLock`, or a password field. If Omarchy ever
  ships a third-party lock-chrome hook, this plugin still should not own
  auth.
- Replace fingerprint / retina motifs with non-auth glyphs, or caption
  them `DECORATIVE` in the canvas.
- Stop the 40 ms paint when the overlay is hidden; back off the 1 s probe
  when unlocked and the overlay is closed (arm can poll at 5–10 s).
- Subscribe to documented lock events if/when third-party plugins get
  them; stop guessing from `status` polls.
- Show `lastEvent` from lock IPC on ERR/STALE (`lock-pending: no-real-screen`
  vs `lock-denied: missing-pam`).
- Constrain hostname / `state.json` path; keep `umask 077` (already in
  `writeSpec`).
- `preview.png` + `qmllint` in README; pin a tag instead of git HEAD.
- Theme tokens instead of mint/amber/red hex.
- Deduplicate probe merge in QML (status ∪ hypr ∪ isLocked) via
  `mergeProbes` with compositor fields winning.

---

## 5. Quick wins (≤ 1 day)

1. **LIVE / SECURE only when `sessionLocked || secure`.** Omarchy `locked`
   / `isLocked===true` is ARMED (or LOCKING), never SECURE. Tests: the
   pending fixture in `test_scan_logic.js` must not yield `statusLine ===
   "SECURE"`.
2. **DEMO never prints SECURE.** Keep `forceDemo`. Bar chip **DEMO**, not
   SCAN. Preview DEMO scene stays SCANNING.
3. **Never accept passwords.** No field. `WlrKeyboardFocus.None` when
   `locked || requested || pending || sessionLocked || secure ||
   authenticating`, and when `lastGood` was compositor-held.
4. **Hide / yield when `sessionLocked` (or last-good `sessionLocked`).**
   Overlay down. Keys released. Do not `forceActiveFocus`.
5. **Escape:** `event.accepted = escapeCloses(...)`. Never accept-and-drop
   on a real lock. Esc still closes DEMO / ARMED / ERR / STALE when the
   compositor does not own the session.
6. **ERR / STALE stay on the face** (already). Do not paint last-good
   SECURE under a STALE chip. Do not show the overlay over a last-good
   compositor lock.
7. **README + tests** for (1)–(6). Link this file.

---

## 6. Suggested next ship (this PR)

**Title:** Honest scan — OPPOSITION + trust fixes.

**Scope (one PR, no visual restyle, no PAM, no lock-chrome hook):**

1. `docs/OPPOSITION.md` (this review).
2. `ScanLogic.js`: LIVE/SECURE gated on compositor lock IPC; DEMO/ARMED
   cannot wear SECURE; hide/yield helpers; Escape helper; bar chip DEMO;
   `locked` field no longer OR’d from `secure`.
3. `Overlay.qml`: yield keyboard; do not swallow Esc; hide on
   sessionLocked / last-good sessionLocked / authenticating; probe
   fallback status → hypr → isLocked without treating status stdout as
   `isLocked`.
4. README + preview + Node tests for the gates. No symlinks.

Do **not** expand into idle-event subscription, biometric restyle, or a
real lock screen in that PR. After it merges, the next opposition item is
P1 paint/probe heat and decorative-auth glyphs.

---

## 7. What already holds (do not redo)

- **No PAM / no password field** in source. `neverAcceptsPassword(overlay)`
  passes. Do not add one.
- **Mode enum and honesty strings exist.** DEMO / ARMED / LIVE / ERR /
  STALE are first-class. `forceDemo` wins over a locked probe.
  `{"mode":"live"}` + unlocked does not become LIVE.
- **ERR / STALE modes** are implemented and painted (overlay + bar).
- **Hide when `sessionLocked`/`secure` on the *current* probe** already
  exists (`compositorOwnsLock`). Extend it; do not replace the idea.
- **State write** uses argv list + `umask 077`, JSON body not interpolated
  into the script (`writeSpec`).
- **Id namespace** `smf.deep-scan-lock` (not `omarchy.*`),
  `kinds: ["overlay","bar-widget"]`, `keepLoaded`, no in-tree symlinks.
- **CI** runs `node tests/test_scan_logic.js`.
- **README** already says this is a visual companion and not a lock
  screen. The bug is the HUD’s mint **SECURE** and Exclusive focus, not
  the prose.

None of that makes a screenshot of the HUD safe to treat as a locked
session. It means the honesty PR can stay small: gate SECURE, yield the
keyboard, stop Escape from lying, label DEMO on the bar, test it.

---

## Appendix — first-party lock IPC (authoritative)

`omarchy-shell lock status` JSON fields used in this review:

| Field | Meaning in `omarchy.lock` |
|-------|---------------------------|
| `locked` | `lockRequested \|\| sessionLock.locked \|\| sessionLock.secure` |
| `requested` | `beginLock()` ran; PAM path is live |
| `pending` | Waiting to set `sessionLock.locked` (screens / stabilize) |
| `sessionLocked` | `WlSessionLock.locked` |
| `secure` | `WlSessionLock.secure` (`secure=true` event) |
| `authenticating` | Password or fingerprint PAM in flight |
| `lastEvent` | `lock-requested`, `secure=true`, `unlocked`, `lock-denied: missing-pam`, … |

`omarchy-shell lock isLocked` → `"true"` iff `locked`.
`omarchy-hyprland-session-locked` → exit 0 locked, 1 unlocked, 2 unknown
(same helper first-party uses for stranded-lock recovery).

Deep Scan Lock may **display** those bits. It must not **translate**
`locked` or `isLocked` into **SECURE**.
