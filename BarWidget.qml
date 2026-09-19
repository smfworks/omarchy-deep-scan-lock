import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "ScanLogic.js" as Scan

BarWidget {
  id: root
  moduleName: "smf.deep-scan-lock"

  property string mode: "demo"
  property bool armed: false
  property string chipText: "SCAN"

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  readonly property color chipColor: Scan.modeColor(root.mode)

  function summonPreview() {
    if (!root.bar) return
    root.bar.run("omarchy-shell shell toggle smf.deep-scan-lock '{}'")
  }

  function summonArmToggle() {
    if (!root.bar) return
    if (root.armed)
      root.bar.run("omarchy-shell shell summon smf.deep-scan-lock '{\"arm\":false}'")
    else
      root.bar.run("omarchy-shell shell summon smf.deep-scan-lock '{\"mode\":\"armed\"}'")
  }

  function ingestState(raw) {
    var parsed = Scan.parseStateFile(raw)
    root.armed = parsed.armed === true
    root.mode = parsed.mode || "demo"
    var chip = Scan.barChip({ mode: root.mode, armed: root.armed })
    root.chipText = chip.text
    button.tooltipText = chip.tooltip
  }

  FileView {
    id: stateView
    path: Quickshell.env("HOME") + "/.local/share/smf-deep-scan-lock/state.json"
    printErrors: false
    onLoaded: root.ingestState(stateView.text())
    onLoadFailed: {
      root.armed = false
      root.mode = "demo"
      root.chipText = "SCAN"
      button.tooltipText = "Deep Scan Lock — preview the cinematic HUD"
    }
  }

  Timer {
    interval: 1500
    running: true
    repeat: true
    onTriggered: {
      try { stateView.reload() } catch (e) {}
    }
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.chipText
    labelVisible: false
    keepSpace: true
    tooltipText: "Deep Scan Lock — preview the cinematic HUD"
    fixedWidth: vertical ? barSize : Style.space(44)
    fixedHeight: vertical ? Style.space(44) : barSize
    onPressed: function(buttonCode) {
      if (buttonCode === Qt.LeftButton) root.summonPreview()
      else if (buttonCode === Qt.RightButton) root.summonArmToggle()
    }

    Item {
      anchors.fill: parent
      anchors.margins: Style.spaceReal(5)

      Rectangle {
        anchors.centerIn: parent
        width: parent.width * 0.78
        height: parent.width * 0.78
        radius: width / 2
        color: "transparent"
        border.width: 1
        border.color: Util.alpha(root.chipColor, 0.72)
      }

      Rectangle {
        anchors.centerIn: parent
        width: parent.width * 0.42
        height: parent.width * 0.42
        rotation: 45
        color: "transparent"
        border.width: 1
        border.color: Util.alpha(root.chipColor, root.mode === "live" ? 0.95 : 0.5)
      }

      Text {
        anchors.centerIn: parent
        text: root.chipText
        color: root.chipColor
        font.family: Style.font.family
        font.pixelSize: Style.font.caption
        font.bold: true
      }

      Rectangle {
        visible: root.armed || root.mode === "live"
        width: Style.space(7)
        height: Style.space(7)
        radius: width / 2
        anchors.top: parent.top
        anchors.right: parent.right
        color: root.chipColor
      }
    }
  }
}
