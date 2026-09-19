#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const os = require("os");
const { spawnSync } = require("child_process");

const src = fs.readFileSync(path.join(__dirname, "..", "ScanLogic.js"), "utf8")
  .replace(/^\.pragma library\s*/, "");
const Scan = { Math, Date, Number, String, Array, Object, JSON, isFinite, console };
vm.createContext(Scan);
vm.runInContext(src, Scan);

const now = "2026-09-19T21:00:00.000Z";

assert.strictEqual(Scan.normalizeMode("DEMO"), "demo");
assert.strictEqual(Scan.normalizeMode("preview"), "demo");
assert.strictEqual(Scan.normalizeMode("arm"), "armed");
assert.strictEqual(Scan.normalizeMode("live"), "live");
assert.strictEqual(Scan.normalizeMode("disarm"), "disarm");
assert.strictEqual(Scan.normalizeMode("maybe"), "");

const empty = Scan.parsePayload("{}");
assert.strictEqual(empty.forceDemo, false);
assert.strictEqual(empty.wantArmed, false);
assert.strictEqual(empty.wantLive, false);
assert.strictEqual(empty.empty, true);

const demoPayload = Scan.parsePayload('{"mode":"demo"}');
assert.strictEqual(demoPayload.forceDemo, true);
assert.strictEqual(demoPayload.wantLive, false);

const forced = Scan.parsePayload('{"mode":"live","demo":true}');
assert.strictEqual(forced.forceDemo, true);
assert.strictEqual(forced.wantLive, false, "demo flag wins over mode:live");

const armedPayload = Scan.parsePayload('{"mode":"armed"}');
assert.strictEqual(armedPayload.wantArmed, true);
assert.strictEqual(armedPayload.forceDemo, false);

const disarmPayload = Scan.parsePayload('{"arm":false}');
assert.strictEqual(disarmPayload.explicitDisarm, true);

const garbage = Scan.parsePayload("not-json");
assert.strictEqual(garbage.ok, false);
assert.strictEqual(garbage.forceDemo, false);

const lockedStatus = Scan.parseLockStatus(JSON.stringify({
  locked: true,
  requested: true,
  pending: false,
  sessionLocked: true,
  secure: true,
  authenticating: false,
  lastEvent: "secure=true"
}));
assert.strictEqual(lockedStatus.ok, true);
assert.strictEqual(lockedStatus.locked, true);
assert.strictEqual(lockedStatus.sessionLocked, true);
assert.strictEqual(lockedStatus.secure, true);
assert.strictEqual(lockedStatus.source, "lock-ipc");

const unlockedStatus = Scan.parseLockStatus(JSON.stringify({
  locked: false,
  requested: false,
  pending: false,
  sessionLocked: false,
  secure: false
}));
assert.strictEqual(unlockedStatus.ok, true);
assert.strictEqual(unlockedStatus.locked, false);

const emptyStatus = Scan.parseLockStatus("{}");
assert.strictEqual(emptyStatus.ok, false, "empty object is not a lock probe");

const badStatus = Scan.parseLockStatus("nope");
assert.strictEqual(badStatus.ok, false);

assert.strictEqual(Scan.parseIsLocked("true").ok, true);
assert.strictEqual(Scan.parseIsLocked("true").locked, true);
assert.strictEqual(Scan.parseIsLocked("false").locked, false);
assert.strictEqual(Scan.parseIsLocked("maybe").ok, false);

assert.strictEqual(Scan.parseHyprlandLockExit(0).ok, true);
assert.strictEqual(Scan.parseHyprlandLockExit(0).locked, true);
assert.strictEqual(Scan.parseHyprlandLockExit(1).ok, true);
assert.strictEqual(Scan.parseHyprlandLockExit(1).locked, false);
assert.strictEqual(Scan.parseHyprlandLockExit(2).ok, false, "exit 2 is unknown");

const merged = Scan.mergeProbes(Scan.emptyProbe(), lockedStatus);
assert.strictEqual(merged.ok, true);
assert.strictEqual(merged.locked, true);

assert.strictEqual(Scan.modeLabel("demo"), "DEMO");
assert.strictEqual(Scan.modeLabel("armed"), "ARMED");
assert.strictEqual(Scan.modeLabel("live"), "LIVE");
assert.strictEqual(Scan.modeLabel("err"), "ERR");
assert.strictEqual(Scan.modeLabel("stale"), "STALE");

assert.strictEqual(Scan.statusLine("demo", "", Scan.emptyProbe()), "SCANNING");
assert.strictEqual(Scan.statusLine("armed", "", unlockedStatus), "ARMED");
assert.strictEqual(Scan.statusLine("live", "", lockedStatus), "SECURE");
assert.strictEqual(Scan.statusLine("err", "", Scan.emptyProbe()), "ERR");
assert.strictEqual(Scan.statusLine("stale", "", Scan.emptyProbe()), "STALE");
assert.strictEqual(
  Scan.statusLine("demo", "unlocked", unlockedStatus),
  "UNLOCKED",
  "UNLOCKED only after a detected lock→unlock transition"
);
assert.strictEqual(
  Scan.statusLine("live", "", Scan.parseIsLocked("true")),
  "LIVE",
  "isLocked true without sessionLocked/secure must not stamp SECURE"
);

assert.ok(Scan.honestyLine("demo").indexOf("DEMO") !== -1);
assert.ok(Scan.honestyLine("demo").indexOf("not a security claim") !== -1);
assert.ok(Scan.neverClaimsSecure(Scan.honestyLine("demo")));
assert.ok(Scan.neverClaimsSecure(Scan.honestyLine("armed", unlockedStatus)));
assert.ok(Scan.neverClaimsSecure(Scan.honestyLine("err")));
assert.ok(Scan.honestyLine("live", lockedStatus).indexOf("LIVE") !== -1);
assert.ok(Scan.honestyLine("live", lockedStatus).indexOf("not PAM") !== -1);
assert.ok(Scan.honestyLine("live", lockedStatus).indexOf("sessionLocked") !== -1);

assert.ok(Scan.unlockHint("demo").indexOf("omarchy.lock") !== -1);
assert.ok(Scan.unlockHint("live", "", lockedStatus).indexOf("does not accept a password") !== -1);
assert.ok(Scan.neverAcceptsPassword(Scan.unlockHint("live", "", lockedStatus)));

assert.strictEqual(Scan.scanProgressAt("demo", 2400, 4800), 0.5);
assert.strictEqual(Scan.scanProgressAt("live", 2400, 4800), 0, "LIVE has no fake scan progress");
assert.strictEqual(Scan.scanProgressAt("armed", 2400, 4800), 0);
assert.strictEqual(Scan.scanProgressAt("err", 2400, 4800), 0);

assert.strictEqual(Scan.shouldShowOverlay("demo", Scan.emptyProbe()), true);
assert.strictEqual(Scan.shouldShowOverlay("armed", unlockedStatus), true);
assert.strictEqual(Scan.shouldShowOverlay("live", unlockedStatus), true);
assert.strictEqual(
  Scan.shouldShowOverlay("live", lockedStatus),
  false,
  "do not fight the compositor lock surface"
);
assert.strictEqual(
  Scan.shouldShowOverlay("stale", Scan.emptyProbe(), lockedStatus),
  false,
  "do not climb over a last-good compositor lock"
);
assert.strictEqual(Scan.escapeCloses("demo", Scan.emptyProbe()), true);
assert.strictEqual(Scan.escapeCloses("armed", unlockedStatus), true);
assert.strictEqual(Scan.escapeCloses("live", lockedStatus), false);
assert.strictEqual(Scan.escapeCloses("stale", Scan.emptyProbe(), lockedStatus), false);
assert.strictEqual(Scan.compositorOwnsLock(lockedStatus), true);
assert.strictEqual(Scan.compositorOwnsLock(unlockedStatus), false);
assert.strictEqual(Scan.sessionActuallyLocked(lockedStatus), true);
assert.strictEqual(Scan.sessionActuallyLocked(unlockedStatus), false);
assert.strictEqual(Scan.shouldYieldKeyboard(lockedStatus), true);
assert.strictEqual(Scan.shouldYieldKeyboard(unlockedStatus), false);

let state = Scan.emptyState();
state = Scan.resolveOpen("{}", state, Scan.emptyProbe());
assert.strictEqual(state.mode, "demo");
assert.strictEqual(state.armed, false);
assert.strictEqual(state.forceDemo, true);
assert.strictEqual(state.overlayVisible, true);
state = Scan.ingestProbe(state, lockedStatus);
assert.strictEqual(state.mode, "demo", "empty DEMO preview must not flip to LIVE on a later probe");
assert.ok(Scan.demoCopyIsHonest(state.mode, Scan.statusLine(state.mode)));
assert.ok(Scan.demoCopyIsHonest(state.mode, Scan.honestyLine(state.mode)));

state = Scan.resolveOpen('{"mode":"demo"}', state, lockedStatus);
assert.strictEqual(state.mode, "demo", "forced DEMO never becomes LIVE even if the machine is locked");
assert.strictEqual(Scan.statusLine(state.mode), "SCANNING");
assert.notStrictEqual(Scan.statusLine(state.mode), "SECURE");
assert.ok(Scan.neverClaimsSecure(Scan.honestyLine(state.mode)));

state = Scan.emptyState();
state = Scan.resolveOpen('{"mode":"live"}', state, unlockedStatus);
assert.strictEqual(state.mode, "armed", "mode:live without compositor lock arms and waits");
assert.notStrictEqual(Scan.statusLine(state.mode, "", unlockedStatus), "SECURE");
assert.ok(Scan.demoCopyIsHonest(state.mode, Scan.statusLine(state.mode, "", unlockedStatus), unlockedStatus));

state = Scan.resolveOpen('{"mode":"live"}', Scan.emptyState(), lockedStatus);
assert.strictEqual(state.mode, "live");
assert.strictEqual(Scan.statusLine(state.mode, "", lockedStatus), "SECURE");
assert.strictEqual(state.overlayVisible, false, "hide when session lock is secure");

state = Scan.resolveOpen('{"mode":"armed"}', Scan.emptyState(), unlockedStatus);
assert.strictEqual(state.armed, true);
assert.strictEqual(state.mode, "armed");
assert.strictEqual(Scan.statusLine(state.mode, "", unlockedStatus), "ARMED");
assert.strictEqual(state.overlayVisible, true);

const pendingLive = Scan.parseLockStatus(JSON.stringify({
  locked: true,
  requested: true,
  pending: true,
  sessionLocked: false,
  secure: false
}));
state = Scan.ingestProbe(state, pendingLive);
assert.strictEqual(state.mode, "armed", "Omarchy locked+pending is not LIVE");
assert.strictEqual(state.lastTransition, "", "pending lock is not a compositor lock transition");
assert.strictEqual(state.overlayVisible, true, "pending companion may still decorate");
assert.strictEqual(Scan.statusLine(state.mode, "", pendingLive), "ARMED");
assert.notStrictEqual(Scan.statusLine(state.mode, "", pendingLive), "SECURE");
assert.ok(Scan.honestyLine(state.mode, pendingLive).indexOf("not a SECURE claim") !== -1);
assert.ok(Scan.shouldYieldKeyboard(pendingLive), "yield keys while lock is requested/pending");
assert.strictEqual(Scan.escapeCloses(state.mode, pendingLive), true);
assert.ok(Scan.demoCopyIsHonest(state.mode, Scan.statusLine(state.mode, "", pendingLive), pendingLive));
assert.ok(Scan.demoCopyIsHonest(state.mode, Scan.honestyLine(state.mode, pendingLive), pendingLive));

state = Scan.ingestProbe(state, lockedStatus);
assert.strictEqual(state.mode, "live");
assert.strictEqual(state.lastTransition, "locked");
assert.strictEqual(state.overlayVisible, false);
assert.strictEqual(Scan.statusLine(state.mode, "", lockedStatus), "SECURE");
assert.strictEqual(Scan.escapeCloses(state.mode, lockedStatus), false);
assert.ok(Scan.shouldYieldKeyboard(lockedStatus));

state = Scan.ingestProbe(state, unlockedStatus);
assert.strictEqual(state.lastTransition, "unlocked");
assert.strictEqual(Scan.statusLine(state.mode, state.lastTransition, unlockedStatus), "UNLOCKED");
assert.ok(Scan.unlockHint(state.mode, state.lastTransition, unlockedStatus).indexOf("UNLOCKED") !== -1);

state = Scan.resolveOpen('{"arm":false}', state, unlockedStatus);
assert.strictEqual(state.armed, false);
assert.strictEqual(state.mode, "demo");

const failed = Scan.emptyProbe();
failed.source = "lock-ipc";
let armedWaiting = Scan.resolveOpen('{"mode":"armed"}', Scan.emptyState(), unlockedStatus);
armedWaiting = Scan.ingestProbe(armedWaiting, failed);
assert.strictEqual(armedWaiting.mode, "stale", "last-good snapshot after IPC fail");
assert.strictEqual(Scan.modeLabel(armedWaiting.mode), "STALE");

let armedErr = Scan.resolveOpen('{"mode":"armed"}', Scan.emptyState(), failed);
assert.strictEqual(armedErr.mode, "err");
assert.strictEqual(Scan.statusLine(armedErr.mode), "ERR");
assert.ok(Scan.honestyLine(armedErr.mode).indexOf("not claiming locked or unlocked") !== -1);

const chipDemo = Scan.barChip({ mode: "demo" });
assert.strictEqual(chipDemo.text, "DEMO");
assert.ok(chipDemo.tooltip.indexOf("not a security claim") !== -1);
assert.strictEqual(Scan.barChip({ mode: "armed" }).text, "ARM");
assert.strictEqual(Scan.barChip({ mode: "live" }).text, "LIVE");
assert.strictEqual(Scan.barChip({ mode: "err" }).text, "ERR");
assert.strictEqual(Scan.barChip({ mode: "stale" }).text, "STALE");

const persisted = Scan.persistState(state, now);
assert.strictEqual(persisted.updatedAt, now);
assert.strictEqual(typeof persisted.armed, "boolean");
assert.strictEqual(Scan.parseStateFile(JSON.stringify(persisted)).mode, persisted.mode);
assert.strictEqual(Scan.parseStateFile("nope").armed, false);

assert.ok(Scan.statePath("/home/ada").indexOf("/.local/share/smf-deep-scan-lock/state.json") !== -1);
const spec = Scan.writeSpec("/home/ada", "{\"armed\":false}");
assert.strictEqual(String(spec.argv[0]), "bash");
assert.ok(String(spec.argv[2]).indexOf("$2") !== -1, "JSON body is not interpolated into the shell script");
assert.strictEqual(Scan.lockStatusArgv().join(" "), "omarchy-shell lock status");
assert.strictEqual(Scan.isLockedArgv().join(" "), "omarchy-shell lock isLocked");
assert.strictEqual(Scan.hyprlandLockArgv().join(" "), "omarchy-hyprland-session-locked");

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "deep-scan-lock-"));
const write = Scan.writeSpec(tmpHome, Scan.receiptLine({ armed: true, mode: "armed" }));
const ran = spawnSync(write.argv[0], write.argv.slice(1), { encoding: "utf8" });
assert.strictEqual(ran.status, 0, ran.stderr || "state write failed");
assert.ok(fs.existsSync(write.file));
assert.ok(fs.readFileSync(write.file, "utf8").indexOf("\"armed\":true") !== -1);

const clock = Scan.clockParts(new Date("2026-09-19T21:04:05"));
assert.strictEqual(clock.time.length, 8);
assert.ok(clock.date.indexOf("2026-09-19") !== -1);
assert.strictEqual(Scan.sanitizeHost("host\nname"), "hostname");
assert.strictEqual(Scan.sanitizeHost(""), "");

const hex = Scan.hexPoints(0, 0, 10, 0);
assert.strictEqual(hex.length, 6);
assert.ok(hex.every(function(pt) {
  return typeof pt.x === "number" && typeof pt.y === "number";
}));

assert.strictEqual(Scan.demoCopyIsHonest("demo", "YOUR SYSTEM IS SECURE"), false);
assert.strictEqual(Scan.demoCopyIsHonest("demo", "SECURE"), false);
assert.strictEqual(Scan.demoCopyIsHonest("demo", "SCANNING"), true);
assert.strictEqual(Scan.demoCopyIsHonest("live", "SECURE", lockedStatus), true);
assert.strictEqual(Scan.demoCopyIsHonest("live", "SECURE", Scan.parseIsLocked("true")), false);
assert.strictEqual(Scan.demoCopyIsHonest("armed", "SECURE", pendingLive), false);
assert.strictEqual(Scan.neverClaimsSecure("YOUR SYSTEM IS SECURE"), false);
assert.strictEqual(Scan.neverAcceptsPassword("Enter Password"), false);

const secureOnly = Scan.parseLockStatus(JSON.stringify({
  locked: false,
  sessionLocked: false,
  secure: true
}));
assert.strictEqual(secureOnly.locked, false, "do not OR secure into locked");
assert.strictEqual(Scan.sessionActuallyLocked(secureOnly), true);
assert.strictEqual(Scan.resolveMode({
  payload: Scan.parsePayload('{"mode":"armed"}'),
  armed: true,
  probe: secureOnly
}), "live");

const requestedOnly = Scan.parseLockStatus(JSON.stringify({
  locked: true,
  requested: true,
  pending: false,
  sessionLocked: false,
  secure: false
}));
assert.strictEqual(Scan.sessionActuallyLocked(requestedOnly), false);
assert.strictEqual(Scan.lockInFlight(requestedOnly), true);
assert.strictEqual(Scan.resolveMode({
  payload: Scan.parsePayload('{"mode":"armed"}'),
  armed: true,
  probe: requestedOnly
}), "armed");
assert.strictEqual(Scan.statusLine("live", "", requestedOnly), "LIVE");
assert.ok(Scan.shouldYieldKeyboard(requestedOnly));

const isLockedTrue = Scan.parseIsLocked("true");
assert.strictEqual(isLockedTrue.locked, true);
assert.strictEqual(isLockedTrue.sessionLocked, false);
assert.strictEqual(Scan.sessionActuallyLocked(isLockedTrue), false);
assert.strictEqual(Scan.resolveMode({
  payload: Scan.parsePayload('{"mode":"armed"}'),
  armed: true,
  probe: isLockedTrue
}), "armed", "isLocked true is not compositor LIVE");
assert.notStrictEqual(Scan.statusLine("armed", "", isLockedTrue), "SECURE");

const authenticating = Scan.parseLockStatus(JSON.stringify({
  locked: true,
  sessionLocked: false,
  secure: false,
  authenticating: true
}));
assert.strictEqual(Scan.shouldShowOverlay("armed", authenticating), false);
assert.strictEqual(Scan.escapeCloses("armed", authenticating), false);
assert.ok(Scan.shouldYieldKeyboard(authenticating));

const overlay = fs.readFileSync(path.join(__dirname, "..", "Overlay.qml"), "utf8");
assert.ok(overlay.includes("function open(payloadJson)"));
assert.ok(overlay.includes("function close()"));
assert.ok(overlay.includes("WlrLayershell.namespace: \"smf-deep-scan-lock\""));
assert.ok(overlay.includes("Qt.Key_Escape"));
assert.ok(overlay.includes("WlrKeyboardFocus.None"));
assert.ok(overlay.includes("shouldYieldKeyboard"));
assert.ok(overlay.includes("event.accepted = closes"));
assert.ok(overlay.includes("Scan.isLockedArgv()"));
assert.ok(overlay.includes("DEMO LOOP"));
assert.ok(!overlay.includes("omarchy.deep-scan"));
assert.ok(!overlay.includes("applyLockRaw"));
assert.ok(Scan.neverAcceptsPassword(overlay));
assert.ok(Scan.neverClaimsSecure(overlay));
assert.ok(!/YOUR SYSTEM IS SECURE/i.test(overlay));
assert.ok(!/TextInput\.Password/.test(overlay));
assert.ok(!/PamContext/.test(overlay));
assert.ok(!/submitPassword/.test(overlay));

const bar = fs.readFileSync(path.join(__dirname, "..", "BarWidget.qml"), "utf8");
assert.ok(bar.includes("moduleName: \"smf.deep-scan-lock\""));
assert.ok(bar.includes("omarchy-shell shell toggle smf.deep-scan-lock '{}'"));
assert.ok(bar.includes("mode") && bar.includes("armed"));

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
assert.strictEqual(manifest.id, "smf.deep-scan-lock");
assert.ok(!String(manifest.id).startsWith("omarchy."));
assert.deepStrictEqual(manifest.kinds, ["overlay", "bar-widget"]);
assert.strictEqual(manifest.entryPoints.overlay, "Overlay.qml");
assert.strictEqual(manifest.entryPoints.barWidget, "BarWidget.qml");
assert.strictEqual(manifest.keepLoaded, true);
assert.strictEqual(manifest.author, "SMF Works");
assert.strictEqual(manifest.license, "MIT");
assert.ok(!fs.lstatSync(path.join(__dirname, "..", "Overlay.qml")).isSymbolicLink());
assert.ok(!fs.lstatSync(path.join(__dirname, "..", "BarWidget.qml")).isSymbolicLink());
assert.ok(!fs.lstatSync(path.join(__dirname, "..", "ScanLogic.js")).isSymbolicLink());
assert.ok(!fs.lstatSync(path.join(__dirname, "..", "manifest.json")).isSymbolicLink());

const readme = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");
assert.ok(readme.includes("omarchy plugin add https://github.com/smfworks/omarchy-deep-scan-lock.git --enable"));
assert.ok(readme.includes("omarchy-shell shell summon smf.deep-scan-lock '{\"mode\":\"demo\"}'"));
assert.ok(readme.includes("unsandboxed"));
assert.ok(readme.includes("DEMO"));
assert.ok(readme.includes("ARMED"));
assert.ok(readme.includes("LIVE"));
assert.ok(readme.includes("omarchy.lock"));
assert.ok(readme.includes("does not") && readme.toLowerCase().includes("password"));
assert.ok(readme.includes("omarchy-neural-pulse"));
assert.ok(readme.includes("omarchy-orbit-dock"));
assert.ok(readme.includes("omarchy-ghost-trace"));
assert.ok(readme.includes("omarchy-spectra"));
assert.ok(readme.includes("omarchy-aegis-gate"));
assert.ok(readme.includes("Escape") || readme.includes("`Escape`"));
assert.ok(readme.includes("visual companion"));
assert.ok(readme.includes("docs/OPPOSITION.md"));
assert.ok(readme.includes("sessionLocked"));
assert.ok(readme.includes("SECURE") && readme.includes("LIVE"));
assert.ok(readme.includes("yield"));
assert.ok(Scan.neverClaimsSecure(readme.replace(/LIVE[\s\S]*PAM/g, "").replace(/SECURE[\s\S]*enough\./g, "")));

const preview = fs.readFileSync(path.join(__dirname, "..", "preview/index.html"), "utf8");
assert.ok(preview.includes("DEMO"));
assert.ok(preview.includes("ARMED"));
assert.ok(preview.includes("LIVE"));
assert.ok(preview.includes('chip: "DEMO"'));
assert.ok(!preview.includes('chip: "SCAN"'));
assert.ok(!/YOUR SYSTEM IS SECURE/i.test(preview));

const opposition = fs.readFileSync(path.join(__dirname, "..", "docs/OPPOSITION.md"), "utf8");
assert.ok(opposition.includes("SECURE"));
assert.ok(opposition.includes("ARMED"));
assert.ok(opposition.includes("LIVE"));
assert.ok(/compositor/i.test(opposition));
assert.ok(/password/i.test(opposition));
assert.ok(/false positive/i.test(opposition));
assert.ok(/Escape/i.test(opposition));
assert.ok(/DEMO/i.test(opposition));
assert.ok(!fs.lstatSync(path.join(__dirname, "..", "docs/OPPOSITION.md")).isSymbolicLink());
assert.ok(!fs.lstatSync(path.join(__dirname, "..", "preview/index.html")).isSymbolicLink());

console.log("ok - ScanLogic helpers");
