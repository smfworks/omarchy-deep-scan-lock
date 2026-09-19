import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons
import "ScanLogic.js" as Scan

Item {
  id: root

  property string omarchyPath: Quickshell.env("OMARCHY_PATH")
  property var shell: null
  property var manifest: null
  property var pluginRegistry: null

  property bool opened: false
  property bool armed: false
  property string mode: "demo"
  property string lastTransition: ""
  property real sweepPhase: 0
  property real scanProgress: 0
  property string hostName: Scan.sanitizeHost(Quickshell.env("HOSTNAME") || Quickshell.env("HOST") || "")
  property var scanState: Scan.emptyState()
  property var probe: Scan.emptyProbe()

  property color background: Color.menu.background
  property color foreground: Color.menu.text
  property color accent: Color.accent
  property color scrim: Color.menu.scrim
  property color border: Color.menu.border
  property string fontFamily: Style.font.menuFamily || Style.font.family

  readonly property string pluginId: (root.manifest && root.manifest.id) || "smf.deep-scan-lock"
  readonly property string homeDir: Quickshell.env("HOME")
  readonly property string modeChip: Scan.modeLabel(root.mode)
  readonly property color modeTone: Scan.modeColor(root.mode)
  readonly property string honestyText: Scan.honestyLine(root.mode, root.probe)
  readonly property string statusText: Scan.statusLine(root.mode, root.lastTransition, root.probe)
  readonly property string hintText: Scan.unlockHint(root.mode, root.lastTransition, root.probe)
  readonly property string recText: Scan.recommendedLine(root.mode, root.probe)
  readonly property bool live: root.mode === "live"
  readonly property bool demoLoop: root.mode === "demo"
  readonly property bool compositorLock: Scan.compositorOwnsLock(root.probe)

  function open(payloadJson) {
    root.scanState = Scan.resolveOpen(payloadJson, root.scanState, root.probe)
    root.applyState()
    root.persistState()
    if (root.scanState.overlayVisible) {
      root.opened = true
      field.requestPaint()
      Qt.callLater(function() { keyCatcher.forceActiveFocus() })
    } else {
      root.opened = false
    }
    root.kickProbe()
  }

  function close() {
    root.opened = false
  }

  function dismiss() {
    if (!Scan.escapeCloses(root.mode, root.probe)) return
    root.close()
    if (root.shell && typeof root.shell.hide === "function")
      root.shell.hide(root.pluginId)
  }

  function toggle() {
    if (root.opened) root.dismiss()
    else root.open("{}")
  }

  function applyState() {
    root.armed = root.scanState.armed === true
    root.mode = root.scanState.mode || "demo"
    root.probe = root.scanState.probe || Scan.emptyProbe()
    root.lastTransition = root.scanState.lastTransition || ""
    root.scanProgress = root.demoLoop ? root.scanState.scanProgress : 0
    if (root.scanState.overlayVisible !== true && root.opened)
      root.opened = false
  }

  function persistState() {
    var body = Scan.receiptLine(Scan.persistState(root.scanState, new Date()))
    root.runWriter(stateWriter, Scan.writeSpec(root.homeDir, body))
  }

  function runWriter(proc, spec) {
    if (!proc || !spec || !spec.argv || !spec.argv.length) return
    proc.command = spec.argv
    proc.running = false
    proc.running = true
  }

  function kickProbe() {
    if (!lockStatusProc.running) lockStatusProc.running = true
  }

  function applyLockRaw(raw) {
    var nextProbe = Scan.parseLockStatus(raw)
    if (!nextProbe.ok) nextProbe = Scan.parseIsLocked(raw)
    root.ingestProbe(nextProbe)
  }

  function ingestProbe(nextProbe) {
    root.scanState = Scan.ingestProbe(root.scanState, nextProbe)
    root.applyState()
    root.persistState()
    if (root.opened && !root.scanState.overlayVisible)
      root.opened = false
    if (root.opened) field.requestPaint()
  }

  function cssColor(c, a) {
    if (typeof c === "string") {
      var hex = c.replace("#", "")
      if (hex.length === 6) {
        return "rgba("
          + parseInt(hex.slice(0, 2), 16) + ","
          + parseInt(hex.slice(2, 4), 16) + ","
          + parseInt(hex.slice(4, 6), 16) + ","
          + a + ")"
      }
    }
    return "rgba("
      + Math.round(c.r * 255) + ","
      + Math.round(c.g * 255) + ","
      + Math.round(c.b * 255) + ","
      + a + ")"
  }

  function paintField(canvas) {
    var ctx = canvas.getContext("2d")
    if (!ctx) return
    var w = canvas.width
    var h = canvas.height
    ctx.reset()
    ctx.clearRect(0, 0, w, h)
    if (w < 8 || h < 8) return

    var cx = w * 0.5
    var cy = h * 0.48
    var maxR = Math.min(w, h) * 0.42
    var phase = root.sweepPhase
    var tone = root.modeTone
    var i

    ctx.strokeStyle = cssColor(root.accent, root.demoLoop ? 0.07 : 0.04)
    ctx.lineWidth = 1
    var drift = root.demoLoop ? (phase * 18) % 28 : 0
    for (i = 0; i < 22; i++) {
      ctx.beginPath()
      ctx.moveTo(0, i * 28 + drift)
      ctx.lineTo(w, i * 28 - 18 + drift)
      ctx.stroke()
    }

    ctx.strokeStyle = cssColor(root.accent, 0.05)
    var hexR = Math.max(18, Math.min(w, h) * 0.045)
    var row
    var col
    for (row = -2; row < 16; row++) {
      for (col = -2; col < 22; col++) {
        var hx = col * hexR * 1.72 + (row % 2 ? hexR * 0.86 : 0)
        var hy = row * hexR * 1.5
        var pts = Scan.hexPoints(hx, hy, hexR * 0.92, 0)
        ctx.beginPath()
        ctx.moveTo(pts[0].x, pts[0].y)
        for (i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
        ctx.closePath()
        ctx.stroke()
      }
    }

    var sweep = phase
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.fillStyle = cssColor(tone, root.demoLoop ? 0.1 : 0.04)
    ctx.arc(cx, cy, maxR * 1.05, sweep - 0.28, sweep + 0.02)
    ctx.closePath()
    ctx.fill()

    ctx.beginPath()
    ctx.strokeStyle = cssColor(tone, root.demoLoop ? 0.85 : 0.35)
    ctx.lineWidth = root.demoLoop ? 2.2 : 1.2
    ctx.moveTo(cx, cy)
    ctx.lineTo(cx + Math.cos(sweep) * maxR * 1.05, cy + Math.sin(sweep) * maxR * 1.05)
    ctx.stroke()

    function ring(r, alpha, width) {
      ctx.beginPath()
      ctx.lineWidth = width
      ctx.strokeStyle = cssColor(tone, alpha)
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.stroke()
    }
    ring(maxR * 0.34, 0.18, 1)
    ring(maxR * 0.58, 0.28, 1.4)
    ring(maxR * 0.86, root.live ? 0.55 : 0.22, root.live ? 2.4 : 1.4)

    var printCx = w * 0.18
    var printCy = h * 0.62
    for (i = 0; i < 6; i++) {
      ctx.beginPath()
      ctx.strokeStyle = cssColor(root.accent, 0.12 + i * 0.04)
      ctx.lineWidth = 1.2
      ctx.ellipse(printCx, printCy, 18 + i * 11, 26 + i * 14, 0, Math.PI * 0.15, Math.PI * 1.85)
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.strokeStyle = cssColor(tone, 0.45)
    ctx.lineWidth = 1.6
    ctx.moveTo(printCx, printCy - 62)
    ctx.lineTo(printCx, printCy + 62)
    ctx.stroke()

    var eyeCx = w * 0.82
    var eyeCy = h * 0.62
    for (i = 0; i < 4; i++) {
      ctx.beginPath()
      ctx.strokeStyle = cssColor(root.accent, 0.16 + i * 0.06)
      ctx.lineWidth = 1.2
      ctx.ellipse(eyeCx, eyeCy, 52 - i * 9, 22 - i * 3, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.strokeStyle = cssColor(tone, 0.7)
    ctx.lineWidth = 1.6
    ctx.arc(eyeCx, eyeCy, 8, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.strokeStyle = cssColor(root.foreground, 0.2)
    ctx.moveTo(eyeCx - 64, eyeCy)
    ctx.lineTo(eyeCx + 64, eyeCy)
    ctx.moveTo(eyeCx, eyeCy - 28)
    ctx.lineTo(eyeCx, eyeCy + 28)
    ctx.stroke()

    if (root.demoLoop) {
      var y = h * (0.12 + root.scanProgress * 0.76)
      ctx.fillStyle = cssColor(tone, 0.12)
      ctx.fillRect(0, y - 8, w, 16)
      ctx.fillStyle = cssColor(tone, 0.55)
      ctx.fillRect(0, y - 1, w, 2)
    }
  }

  Process {
    id: stateWriter
    running: false
  }

  Process {
    id: lockStatusProc
    command: Scan.lockStatusArgv()
    running: false
    stdout: StdioCollector {
      id: lockStdout
      waitForEnd: true
      onStreamFinished: root.applyLockRaw(String(text || ""))
    }
    onExited: {
      if (lockStatusProc.exitCode !== 0) {
        if (!hyprLockProc.running) hyprLockProc.running = true
      }
    }
  }

  Process {
    id: hyprLockProc
    command: Scan.hyprlandLockArgv()
    running: false
    onExited: {
      if (lockStatusProc.exitCode === 0) return
      root.ingestProbe(Scan.parseHyprlandLockExit(hyprLockProc.exitCode))
    }
  }

  Process {
    id: hostProc
    command: ["hostname"]
    running: false
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var next = Scan.sanitizeHost(String(text || ""))
        if (next) root.hostName = next
      }
    }
  }

  FileView {
    id: bootState
    path: Quickshell.env("HOME") + "/.local/share/smf-deep-scan-lock/state.json"
    printErrors: false
    onLoaded: {
      var parsed = Scan.parseStateFile(bootState.text())
      if (parsed.armed) {
        root.scanState.armed = true
        root.armed = true
      }
    }
  }

  SystemClock {
    id: clock
    precision: SystemClock.Seconds
  }

  NumberAnimation on sweepPhase {
    running: root.opened
    from: 0
    to: Math.PI * 2
    duration: root.demoLoop ? 6400 : 22000
    loops: Animation.Infinite
  }

  Timer {
    interval: 40
    running: root.opened
    repeat: true
    onTriggered: {
      if (root.demoLoop)
        root.scanProgress = Scan.scanProgressAt("demo", Date.now(), Scan.SCAN_PERIOD_MS)
      field.requestPaint()
    }
  }

  Timer {
    interval: 1000
    running: root.opened || root.armed
    repeat: true
    triggeredOnStart: true
    onTriggered: root.kickProbe()
  }

  PanelWindow {
    id: panel
    visible: root.opened
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: "smf-deep-scan-lock"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: root.compositorLock ? WlrKeyboardFocus.None : WlrKeyboardFocus.Exclusive
    exclusionMode: ExclusionMode.Ignore

    Rectangle {
      anchors.fill: parent
      color: root.scrim
    }

    Rectangle {
      anchors.fill: parent
      gradient: Gradient {
        GradientStop { position: 0.0; color: Qt.rgba(0, 0, 0, 0.55) }
        GradientStop { position: 0.45; color: Qt.rgba(0, 0, 0, 0.18) }
        GradientStop { position: 1.0; color: Qt.rgba(0, 0, 0, 0.62) }
      }
    }

    Canvas {
      id: field
      anchors.fill: parent
      renderStrategy: Canvas.Cooperative
      onPaint: root.paintField(field)
    }

    MouseArea {
      anchors.fill: parent
      enabled: Scan.escapeCloses(root.mode, root.probe)
      onClicked: root.dismiss()
    }

    Item {
      id: keyCatcher
      anchors.fill: parent
      focus: true

      Keys.priority: Keys.BeforeItem
      Keys.onPressed: function(event) {
        if (event.key === Qt.Key_Escape) {
          root.dismiss()
          event.accepted = true
        }
      }
    }

    Rectangle {
      id: honesty
      anchors.top: parent.top
      anchors.horizontalCenter: parent.horizontalCenter
      anchors.topMargin: Style.space(22)
      width: honestyRow.implicitWidth + Style.space(28)
      height: Style.space(38)
      radius: height / 2
      color: Util.alpha(root.background, 0.8)
      border.width: 1
      border.color: Util.alpha(root.modeTone, 0.62)
      z: 30

      Row {
        id: honestyRow
        anchors.centerIn: parent
        spacing: Style.space(10)

        Rectangle {
          width: chipLabel.implicitWidth + Style.space(16)
          height: Style.space(22)
          radius: height / 2
          color: Util.alpha(root.modeTone, root.live ? 0.28 : 0.16)
          border.width: 1
          border.color: Util.alpha(root.modeTone, 0.75)

          Text {
            id: chipLabel
            anchors.centerIn: parent
            text: root.modeChip
            color: root.modeTone
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            font.bold: true
            font.letterSpacing: 1.6
          }
        }

        Text {
          text: root.honestyText
          color: root.foreground
          opacity: 0.68
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          anchors.verticalCenter: parent.verticalCenter
        }
      }
    }

    Column {
      id: clockStack
      anchors.horizontalCenter: parent.horizontalCenter
      anchors.verticalCenter: parent.verticalCenter
      anchors.verticalCenterOffset: -panel.height * 0.04
      spacing: Style.space(10)
      width: Math.min(Style.space(720), panel.width * 0.72)
      z: 20

      Text {
        width: parent.width
        text: "DEEP SCAN LOCK"
        color: root.accent
        opacity: 0.78
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
        font.letterSpacing: 4.2
        font.bold: true
        horizontalAlignment: Text.AlignHCenter
      }

      Text {
        width: parent.width
        text: Qt.formatTime(clock.date, "HH:mm:ss")
        color: root.foreground
        font.family: root.fontFamily
        font.pixelSize: Style.font.displayLarge
        font.bold: true
        horizontalAlignment: Text.AlignHCenter
      }

      Text {
        width: parent.width
        text: Qt.formatDate(clock.date, "dddd  yyyy-MM-dd")
          + (root.hostName ? "  ·  " + root.hostName : "")
        color: root.foreground
        opacity: 0.55
        font.family: root.fontFamily
        font.pixelSize: Style.font.subtitle
        horizontalAlignment: Text.AlignHCenter
      }

      Rectangle {
        anchors.horizontalCenter: parent.horizontalCenter
        width: statusLabel.implicitWidth + Style.space(28)
        height: Style.space(36)
        radius: height / 2
        color: Util.alpha(root.background, 0.72)
        border.width: 1
        border.color: Util.alpha(root.modeTone, 0.7)

        Text {
          id: statusLabel
          anchors.centerIn: parent
          text: root.statusText
          color: root.modeTone
          font.family: root.fontFamily
          font.pixelSize: Style.font.title
          font.bold: true
          font.letterSpacing: 3.4
        }
      }

      Text {
        width: parent.width
        text: root.recText
        color: root.foreground
        opacity: 0.48
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
        font.letterSpacing: 1.1
        horizontalAlignment: Text.AlignHCenter
      }

      Rectangle {
        visible: root.demoLoop
        width: parent.width * 0.55
        height: Style.space(8)
        radius: height / 2
        anchors.horizontalCenter: parent.horizontalCenter
        color: Util.alpha(root.background, 0.55)
        border.width: 1
        border.color: Util.alpha(root.accent, 0.28)

        Rectangle {
          width: parent.width * root.scanProgress
          height: parent.height
          radius: parent.radius
          color: Util.alpha(root.accent, 0.7)
        }
      }

      Text {
        visible: root.demoLoop
        width: parent.width
        text: "DEMO LOOP · not a real scan"
        color: root.accent
        opacity: 0.55
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
        font.letterSpacing: 1.6
        horizontalAlignment: Text.AlignHCenter
      }
    }

    Text {
      anchors.bottom: parent.bottom
      anchors.horizontalCenter: parent.horizontalCenter
      anchors.bottomMargin: Style.space(28)
      z: 30
      width: panel.width * 0.8
      wrapMode: Text.WordWrap
      horizontalAlignment: Text.AlignHCenter
      text: root.hintText
      color: root.foreground
      opacity: 0.5
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
      font.letterSpacing: 1.1
    }
  }

  Component.onCompleted: {
    if (!hostProc.running) hostProc.running = true
  }
}
