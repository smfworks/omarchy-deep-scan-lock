.pragma library

// Deep Scan Lock helpers. LIVE requires a real omarchy.lock / Hyprland
// session-lock probe. DEMO never invents a locked or secure machine.
// This plugin does not accept passwords or replace PAM.

var PLUGIN_ID = "smf.deep-scan-lock"
var SHARE_DIR = "smf-deep-scan-lock"
var STATE_FILE = "state.json"
var MODES = ["demo", "armed", "live", "err", "stale"]
var SCAN_PERIOD_MS = 4800

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value))
}

function number(value) {
  var n = Number(value)
  return isFinite(n) ? n : 0
}

function trimStr(value) {
  return String(value === undefined || value === null ? "" : value).replace(/^\s+|\s+$/g, "")
}

function boolish(value) {
  if (value === true || value === 1) return true
  var s = trimStr(value).toLowerCase()
  return s === "true" || s === "1" || s === "yes"
}

function isoNow(now) {
  if (typeof now === "string" && now) return now
  var ts = now instanceof Date ? now : new Date()
  try {
    return ts.toISOString()
  } catch (e) {
    return String(now || "")
  }
}

function pad2(n) {
  var s = String(Math.floor(Math.abs(number(n))))
  return s.length >= 2 ? s : "0" + s
}

function clockParts(date) {
  var d = date instanceof Date ? date : new Date(date)
  if (isNaN(d.getTime())) d = new Date(0)
  return {
    hours: pad2(d.getHours()),
    minutes: pad2(d.getMinutes()),
    seconds: pad2(d.getSeconds()),
    time: pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds()),
    date: d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate())
  }
}

function sanitizeHost(value) {
  var s = trimStr(value).replace(/[\r\n\t]/g, "")
  if (!s) return ""
  return s.slice(0, 64)
}

function normalizeMode(value) {
  var s = trimStr(value).toLowerCase()
  if (s === "demo" || s === "preview" || s === "cinematic") return "demo"
  if (s === "armed" || s === "arm") return "armed"
  if (s === "live") return "live"
  if (s === "err" || s === "error") return "err"
  if (s === "stale") return "stale"
  if (s === "disarm") return "disarm"
  return ""
}

function parseJsonObject(raw) {
  if (raw === undefined || raw === null) return { ok: true, value: {} }
  var text = trimStr(raw)
  if (text === "") return { ok: true, value: {} }
  try {
    var value = JSON.parse(text)
    if (!value || typeof value !== "object" || value instanceof Array)
      return { ok: false, value: {} }
    return { ok: true, value: value }
  } catch (e) {
    return { ok: false, value: {} }
  }
}

function parsePayload(raw) {
  var parsed = parseJsonObject(raw)
  var payload = parsed.value || {}
  var mode = normalizeMode(payload.mode)
  var source = trimStr(payload.source).toLowerCase()
  var forceDemo = payload.demo === true || payload.forceDemo === true || source === "demo" || mode === "demo"
  var explicitDisarm = payload.arm === false || payload.armed === false || mode === "disarm"
  var wantArmed = !forceDemo && !explicitDisarm && (payload.arm === true || payload.armed === true || mode === "armed")
  var wantLive = !forceDemo && mode === "live"
  return {
    ok: parsed.ok,
    mode: mode,
    source: source,
    forceDemo: forceDemo,
    explicitDisarm: explicitDisarm,
    wantArmed: wantArmed,
    wantLive: wantLive,
    empty: parsed.ok && !mode && !forceDemo && !wantArmed && !explicitDisarm && !wantLive
  }
}

function emptyProbe() {
  return {
    ok: false,
    locked: false,
    requested: false,
    pending: false,
    sessionLocked: false,
    secure: false,
    authenticating: false,
    source: "",
    lastEvent: "",
    stale: false
  }
}

function cloneProbe(probe) {
  var p = probe || emptyProbe()
  return {
    ok: p.ok === true,
    locked: p.locked === true,
    requested: p.requested === true,
    pending: p.pending === true,
    sessionLocked: p.sessionLocked === true,
    secure: p.secure === true,
    authenticating: p.authenticating === true,
    source: trimStr(p.source),
    lastEvent: trimStr(p.lastEvent),
    stale: p.stale === true
  }
}

function parseLockStatus(raw) {
  var parsed = parseJsonObject(raw)
  var v = parsed.value || {}
  var hasLockField = Object.prototype.hasOwnProperty.call(v, "locked")
    || Object.prototype.hasOwnProperty.call(v, "sessionLocked")
    || Object.prototype.hasOwnProperty.call(v, "secure")
  if (!parsed.ok || !hasLockField) {
    var miss = emptyProbe()
    miss.source = "lock-ipc"
    return miss
  }
  var locked = boolish(v.locked) || boolish(v.sessionLocked) || boolish(v.secure)
  return {
    ok: true,
    locked: locked,
    requested: boolish(v.requested),
    pending: boolish(v.pending),
    sessionLocked: boolish(v.sessionLocked),
    secure: boolish(v.secure),
    authenticating: boolish(v.authenticating),
    source: "lock-ipc",
    lastEvent: trimStr(v.lastEvent),
    stale: false
  }
}

function parseIsLocked(raw) {
  var s = trimStr(raw).toLowerCase()
  if (s === "true" || s === "1" || s === "yes") {
    return {
      ok: true,
      locked: true,
      requested: false,
      pending: false,
      sessionLocked: false,
      secure: false,
      authenticating: false,
      source: "lock-ipc",
      lastEvent: "",
      stale: false
    }
  }
  if (s === "false" || s === "0" || s === "no") {
    return {
      ok: true,
      locked: false,
      requested: false,
      pending: false,
      sessionLocked: false,
      secure: false,
      authenticating: false,
      source: "lock-ipc",
      lastEvent: "",
      stale: false
    }
  }
  var miss = emptyProbe()
  miss.source = "lock-ipc"
  return miss
}

function parseHyprlandLockExit(code) {
  var n = Math.round(number(code))
  if (n === 0) {
    return {
      ok: true,
      locked: true,
      requested: false,
      pending: false,
      sessionLocked: true,
      secure: false,
      authenticating: false,
      source: "hyprland",
      lastEvent: "",
      stale: false
    }
  }
  if (n === 1) {
    return {
      ok: true,
      locked: false,
      requested: false,
      pending: false,
      sessionLocked: false,
      secure: false,
      authenticating: false,
      source: "hyprland",
      lastEvent: "",
      stale: false
    }
  }
  var miss = emptyProbe()
  miss.source = "hyprland"
  return miss
}

function mergeProbes(primary, fallback) {
  if (primary && primary.ok) return cloneProbe(primary)
  if (fallback && fallback.ok) return cloneProbe(fallback)
  if (primary && trimStr(primary.source)) return cloneProbe(primary)
  return cloneProbe(fallback || emptyProbe())
}

function emptyState() {
  return {
    armed: false,
    forceDemo: false,
    mode: "demo",
    probe: emptyProbe(),
    lastGood: null,
    lastLocked: false,
    lastTransition: "",
    overlayVisible: false,
    scanProgress: 0
  }
}

function cloneState(state) {
  var s = state || emptyState()
  return {
    armed: s.armed === true,
    forceDemo: s.forceDemo === true,
    mode: normalizeMode(s.mode) || "demo",
    probe: cloneProbe(s.probe),
    lastGood: s.lastGood ? cloneProbe(s.lastGood) : null,
    lastLocked: s.lastLocked === true,
    lastTransition: trimStr(s.lastTransition),
    overlayVisible: s.overlayVisible === true,
    scanProgress: clamp(number(s.scanProgress), 0, 1)
  }
}

function resolveMode(opts) {
  opts = opts || {}
  var payload = opts.payload || parsePayload("{}")
  var probe = opts.probe || emptyProbe()
  var lastGood = opts.lastGood || null
  var armed = opts.armed === true
  if (payload.forceDemo || opts.forceDemo === true) return "demo"
  if (probe.ok && probe.locked) return "live"
  var needsProbe = armed || payload.wantLive === true
  if (needsProbe && !probe.ok && lastGood && lastGood.ok) return "stale"
  if (needsProbe && !probe.ok) return "err"
  if (armed && probe.ok && !probe.locked) return "armed"
  return "demo"
}

function compositorOwnsLock(probe) {
  if (!probe) return false
  return probe.sessionLocked === true || probe.secure === true
}

function shouldShowOverlay(mode, probe) {
  var m = normalizeMode(mode) || "demo"
  if (m === "live" && compositorOwnsLock(probe)) return false
  return m === "demo" || m === "armed" || m === "err" || m === "stale" || m === "live"
}

function escapeCloses(mode, probe) {
  var m = normalizeMode(mode) || "demo"
  if (m === "live" && compositorOwnsLock(probe)) return false
  return m === "demo" || m === "armed" || m === "err" || m === "stale" || m === "live"
}

function applyProbe(state, probe) {
  var next = cloneState(state)
  var incoming = cloneProbe(probe)
  next.probe = incoming
  if (incoming.ok) {
    if (next.lastLocked === true && incoming.locked === false)
      next.lastTransition = "unlocked"
    else if (next.lastLocked === false && incoming.locked === true)
      next.lastTransition = "locked"
    next.lastLocked = incoming.locked
    next.lastGood = cloneProbe(incoming)
  }
  return next
}

function resolveOpen(payloadJson, state, probe) {
  var parsed = parsePayload(payloadJson)
  var next = cloneState(state)
  if (parsed.explicitDisarm) next.armed = false
  if (parsed.wantArmed) next.armed = true
  if (parsed.forceDemo) next.forceDemo = true
  else if (parsed.wantArmed || parsed.wantLive || parsed.explicitDisarm) next.forceDemo = false
  else if (parsed.empty && !next.armed) next.forceDemo = true
  if (probe) next = applyProbe(next, probe)
  next.mode = resolveMode({
    payload: parsed,
    armed: next.armed,
    probe: next.probe,
    lastGood: next.lastGood,
    forceDemo: next.forceDemo
  })
  next.overlayVisible = shouldShowOverlay(next.mode, next.probe)
  if (next.mode !== "demo") next.scanProgress = 0
  return next
}

function ingestProbe(state, probe) {
  var next = applyProbe(state, probe)
  next.mode = resolveMode({
    payload: parsePayload("{}"),
    armed: next.armed,
    probe: next.probe,
    lastGood: next.lastGood,
    forceDemo: next.forceDemo
  })
  next.overlayVisible = shouldShowOverlay(next.mode, next.probe)
  if (next.mode !== "demo") next.scanProgress = 0
  return next
}

function scanProgressAt(mode, nowMs, periodMs) {
  var m = normalizeMode(mode) || "demo"
  if (m !== "demo") return 0
  var period = number(periodMs) || SCAN_PERIOD_MS
  if (period <= 0) period = SCAN_PERIOD_MS
  var t = number(nowMs)
  if (t < 0) t = 0
  return (t % period) / period
}

function modeLabel(mode) {
  var m = normalizeMode(mode) || "demo"
  if (m === "live") return "LIVE"
  if (m === "armed") return "ARMED"
  if (m === "err") return "ERR"
  if (m === "stale") return "STALE"
  return "DEMO"
}

function modeColor(mode) {
  var m = normalizeMode(mode) || "demo"
  if (m === "live") return "#3DDC97"
  if (m === "armed") return "#F5A524"
  if (m === "err") return "#FF4D6D"
  if (m === "stale") return "#C9A227"
  return "#7DD3FC"
}

function statusLine(mode, lastTransition, probe) {
  var m = normalizeMode(mode) || "demo"
  if (m === "live") return "SECURE"
  if (lastTransition === "unlocked" && probe && probe.ok && probe.locked === false)
    return "UNLOCKED"
  if (m === "err") return "ERR"
  if (m === "stale") return "STALE"
  if (m === "armed") return "ARMED"
  return "SCANNING"
}

function honestyLine(mode, probe) {
  var m = normalizeMode(mode) || "demo"
  if (m === "live")
    return "LIVE · omarchy.lock reports locked · HUD is not PAM"
  if (m === "armed")
    return "ARMED · waiting for omarchy.lock · visual companion only"
  if (m === "stale")
    return "STALE · last lock IPC snapshot · not a live claim"
  if (m === "err")
    return "ERR · lock IPC failed · not claiming locked or unlocked"
  return "DEMO · cinematic preview · not a security claim"
}

function unlockHint(mode, lastTransition, probe) {
  var m = normalizeMode(mode) || "demo"
  if (m === "live")
    return "Unlock on the Omarchy lock screen · this HUD does not accept a password"
  if (lastTransition === "unlocked" && probe && probe.ok && !probe.locked)
    return "UNLOCKED · lock IPC reports not locked · not a security claim"
  if (m === "armed")
    return "ESC closes this companion · lock the session with omarchy.lock"
  if (m === "err")
    return "ESC closes · lock IPC unreachable · HUD cannot see session state"
  if (m === "stale")
    return "ESC closes · showing last snapshot · probe again before trusting it"
  return "ESC closes preview · unlock still goes through omarchy.lock / PAM"
}

function recommendedLine(mode, probe) {
  var m = normalizeMode(mode) || "demo"
  if (m === "live") {
    var src = probe && trimStr(probe.source) ? probe.source : "lock-ipc"
    return "payload from " + src
  }
  if (m === "armed") return "companion armed · no lock reported"
  if (m === "err") return "no lock signal"
  if (m === "stale") return "last-good lock snapshot"
  return "cinematic DEMO loop"
}

function barChip(state) {
  var mode = state && state.mode ? normalizeMode(state.mode) || "demo" : "demo"
  if (mode === "live") {
    return {
      text: "LIVE",
      tooltip: "Deep Scan Lock — omarchy.lock reports locked"
    }
  }
  if (mode === "armed") {
    return {
      text: "ARM",
      tooltip: "Deep Scan Lock — armed, waiting for omarchy.lock"
    }
  }
  if (mode === "err") {
    return {
      text: "ERR",
      tooltip: "Deep Scan Lock — lock IPC failed"
    }
  }
  if (mode === "stale") {
    return {
      text: "STALE",
      tooltip: "Deep Scan Lock — last lock snapshot (IPC failed)"
    }
  }
  return {
    text: "SCAN",
    tooltip: "Deep Scan Lock — preview the cinematic HUD"
  }
}

function persistState(state, now) {
  var s = state || emptyState()
  var probe = s.probe || emptyProbe()
  return {
    armed: s.armed === true,
    mode: s.mode || "demo",
    locked: probe.ok ? probe.locked === true : null,
    lockKnown: probe.ok === true,
    lastTransition: trimStr(s.lastTransition),
    updatedAt: isoNow(now)
  }
}

function parseStateFile(raw) {
  var parsed = parseJsonObject(raw)
  var v = parsed.value || {}
  return {
    armed: v.armed === true,
    mode: normalizeMode(v.mode) || "demo",
    locked: v.locked === true ? true : (v.locked === false ? false : null),
    lockKnown: v.lockKnown === true,
    lastTransition: trimStr(v.lastTransition),
    updatedAt: trimStr(v.updatedAt)
  }
}

function shareDir(home) {
  var h = trimStr(home)
  if (!h) return ""
  return h.replace(/\/+$/, "") + "/.local/share/" + SHARE_DIR
}

function statePath(home) {
  var dir = shareDir(home)
  return dir ? dir + "/" + STATE_FILE : ""
}

function receiptLine(obj) {
  return JSON.stringify(obj)
}

function writeSpec(home, body) {
  var dir = shareDir(home)
  var file = statePath(home)
  return {
    dir: dir,
    file: file,
    body: String(body || ""),
    argv: [
      "bash",
      "-c",
      "umask 077; mkdir -p \"$1\" && printf '%s\\n' \"$2\" > \"$3\"",
      "smf-deep-scan-lock",
      dir,
      String(body || ""),
      file
    ]
  }
}

function lockStatusArgv() {
  return ["omarchy-shell", "lock", "status"]
}

function isLockedArgv() {
  return ["omarchy-shell", "lock", "isLocked"]
}

function hyprlandLockArgv() {
  return ["omarchy-hyprland-session-locked"]
}

function hexPoints(cx, cy, radius, rotation) {
  var out = []
  var rot = number(rotation)
  for (var i = 0; i < 6; i++) {
    var a = rot + Math.PI / 6 + i * Math.PI / 3
    out.push({
      x: cx + radius * Math.cos(a),
      y: cy + radius * Math.sin(a)
    })
  }
  return out
}

function neverClaimsSecure(text) {
  var s = String(text || "").toLowerCase()
  if (s.indexOf("your system is secure") !== -1) return false
  if (s.indexOf("your machine is locked") !== -1) return false
  if (s.indexOf("session is locked") !== -1) return false
  if (s.indexOf("authentication successful") !== -1) return false
  if (s.indexOf("password accepted") !== -1) return false
  return true
}

function neverAcceptsPassword(text) {
  var s = String(text || "").toLowerCase()
  if (s.indexOf("enter password") !== -1) return false
  if (s.indexOf("type your password") !== -1) return false
  if (s.indexOf("password:") !== -1) return false
  if (s.indexOf("echoMode: TextInput.Password") !== -1) return false
  if (s.indexOf("pamcontext") !== -1) return false
  if (s.indexOf("submitpassword") !== -1) return false
  return true
}

function demoCopyIsHonest(mode, copy) {
  var m = normalizeMode(mode) || "demo"
  var s = String(copy || "")
  if (m === "live") return s.indexOf("SECURE") !== -1
  if (s.indexOf("YOUR SYSTEM IS SECURE") !== -1) return false
  if (m !== "live" && s === "SECURE") return false
  if (m !== "live" && s.indexOf("SECURE") !== -1 && s.indexOf("not") === -1)
    return false
  return neverClaimsSecure(s)
}
