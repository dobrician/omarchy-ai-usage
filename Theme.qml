import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import "Model.js" as Model

// Color.qml exposes only foreground/background/accent/urgent/muted, so the
// warning hue (`orange`, then `yellow`) is read from the active theme here.
Item {
  id: root
  visible: false

  property string themeWarning: ""
  readonly property color normal: Color.bar.text
  readonly property color danger: Color.urgent
  readonly property color warning: themeWarning !== "" ? themeWarning : Color.accent

  readonly property string path: Color.currentThemePath + "/colors.toml"

  function colorFor(state) {
    if (state === "danger") return danger
    if (state === "warning") return warning
    return normal
  }

  function reload() {
    file.reload()
  }

  function parse(raw) {
    var found = {}
    var lines = String(raw || "").split("\n")
    for (var i = 0; i < lines.length; i++) {
      var match = lines[i].match(/^\s*([A-Za-z0-9_-]+)\s*=\s*["']?(#[0-9A-Fa-f]{6})/)
      if (match) found[match[1]] = match[2]
    }
    themeWarning = Model.warningColor(found, String(Color.foreground), "")
  }

  FileView {
    id: file
    path: root.path
    watchChanges: false
    printErrors: false
    onLoaded: root.parse(text())
    onLoadFailed: root.parse("")
  }

  // Theme switches replace the theme directory and push colors over IPC, so
  // any change of the stock palette is the cue to re-read the file.
  Connections {
    target: Color
    function onForegroundChanged() { root.reload() }
    function onBackgroundChanged() { root.reload() }
    function onAccentChanged() { root.reload() }
    function onUrgentChanged() { root.reload() }
    function onMutedChanged() { root.reload() }
  }
}
