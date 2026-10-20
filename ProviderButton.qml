import QtQuick
import qs.Commons
import qs.Ui
import "Model.js" as Model

// One provider in the bar. The icon and label carry the short (5h) window,
// the 2px line under them carries the weekly window, both colored by pace.
WidgetButton {
  id: root

  property var entry: null
  property string mode: "name"
  property double nowMs: Date.now()
  property var theme: null
  property bool hoverDim: false
  property bool stale: false
  property var issue: null

  readonly property var resolved: entry ? Model.resolveEntry(entry, nowMs) : ({ weekly: null, short: null })
  readonly property var weeklyState: resolved.weekly ? Model.windowState(resolved.weekly, nowMs) : null
  readonly property var shortState: resolved.short ? Model.windowState(resolved.short, nowMs) : null
  readonly property bool shortAlert: !!shortState && shortState.state !== "normal"
  // bar.barForeground follows the wallpaper on a transparent bar.
  readonly property color normalColor: foreground
  readonly property color shortColor: shortAlert && theme ? theme.colorFor(shortState.state) : normalColor
  readonly property color weeklyColor: weeklyState && weeklyState.state !== "normal" && theme ? theme.colorFor(weeklyState.state) : normalColor
  readonly property var segments: weeklyState
    ? Model.lineSegments(weekly.width, weekly.width * weeklyState.percent / 100,
        weeklyState.elapsed !== null ? weekly.width * weeklyState.elapsed : null, 2)
    : ({ track: [], fill: [] })
  readonly property string labelText: entry ? Model.labelText(entry, mode, nowMs) : ""
  readonly property real margin: scaledHorizontalMargin

  labelVisible: false
  hasVisualContent: !!entry
  dimmed: hoverDim || (stale && !tooltipHovered)
  fixedWidth: content.implicitWidth + margin * 2
  tooltipText: ""

  function withAlpha(c, a) {
    return Qt.rgba(c.r, c.g, c.b, a)
  }

  Row {
    id: content
    anchors.centerIn: parent
    spacing: Style.space(5)

    ProviderIcon {
      anchors.verticalCenter: parent.verticalCenter
      icon: root.entry ? root.entry.icon : ""
      glyph: root.entry ? root.entry.glyph : ""
      color: root.shortColor
      fontFamily: root.fontFamily
    }

    Item {
      id: nameLabel
      width: base.implicitWidth
      height: base.implicitHeight
      anchors.verticalCenter: parent.verticalCenter

      Text {
        id: base
        text: root.labelText
        color: root.shortAlert ? root.withAlpha(root.shortColor, 0.38) : root.normalColor
        font.family: root.fontFamily
        font.pixelSize: Style.font.bodySmall
        renderType: Text.NativeRendering
      }

      Item {
        visible: root.shortAlert
        width: base.implicitWidth * (root.shortState ? root.shortState.percent : 0) / 100
        height: base.implicitHeight
        clip: true

        Text {
          text: root.labelText
          color: root.shortColor
          font: base.font
          renderType: Text.NativeRendering
        }
      }
    }
  }

  Item {
    id: weekly
    visible: !!root.weeklyState
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.bottom: parent.bottom
    anchors.leftMargin: root.margin
    anchors.rightMargin: root.margin
    anchors.bottomMargin: Style.space(3)
    height: 2

    Repeater {
      model: root.segments.track
      Rectangle {
        required property var modelData
        x: modelData[0]
        width: modelData[1] - modelData[0]
        height: parent.height
        radius: 1
        color: root.withAlpha(root.weeklyColor, 0.22)
      }
    }

    Repeater {
      model: root.segments.fill
      Rectangle {
        required property var modelData
        x: modelData[0]
        width: modelData[1] - modelData[0]
        height: parent.height
        radius: 1
        color: root.weeklyColor
      }
    }
  }
}
