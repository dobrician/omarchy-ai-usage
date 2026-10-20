import QtQuick
import Quickshell
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "Model.js" as Model

// The stock bar tooltip is plain text; this one carries the colored glyph
// rows. Placement mirrors Bar.qml's tooltipWindow.
PopupWindow {
  id: root

  property Item target: null
  property QtObject bar: null
  property var entry: null
  property var issue: null
  property double nowMs: Date.now()
  property var theme: null
  property bool shown: false

  readonly property var resolved: entry ? Model.resolveEntry(entry, nowMs) : ({ weekly: null, short: null })
  readonly property var rows: {
    var out = []
    if (resolved.weekly) out.push({ glyph: "\u{F00ED}", state: Model.windowState(resolved.weekly, nowMs) })
    if (resolved.short) out.push({ glyph: "\u{F051F}", state: Model.windowState(resolved.short, nowMs) })
    return out
  }
  readonly property var targetWindow: target ? target.QsWindow.window : null
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  visible: shown && !!target && !!targetWindow && (rows.length > 0 || !!issue)
  color: "transparent"
  implicitWidth: Math.ceil(bubble.implicitWidth)
  implicitHeight: Math.ceil(bubble.implicitHeight)

  anchor {
    id: popupAnchor
    window: root.targetWindow
    adjustment: PopupAdjustment.Slide
    edges: Edges.Top | Edges.Left
    gravity: Edges.Bottom | Edges.Right
    rect.width: 1
    rect.height: 1

    onAnchoring: {
      var target = root.target
      if (!target || !root.targetWindow) return
      var position = root.bar ? root.bar.position : "top"
      var localX = target.width / 2 - root.implicitWidth / 2
      var localY = target.height + 6
      if (position === "bottom") {
        localY = -root.implicitHeight - 6
      } else if (position === "left") {
        localX = target.width + 6
        localY = target.height / 2 - root.implicitHeight / 2
      } else if (position === "right") {
        localX = -root.implicitWidth - 6
        localY = target.height / 2 - root.implicitHeight / 2
      }
      var point = root.targetWindow.contentItem.mapFromItem(target, localX, localY)
      popupAnchor.rect.x = Math.round(point.x)
      popupAnchor.rect.y = Math.round(point.y)
    }
  }

  BorderSurface {
    id: bubble
    implicitWidth: column.implicitWidth + 20
    implicitHeight: column.implicitHeight + 14
    color: Commons.Color.tooltip.background
    borderSpec: Border.surfaceSpec("tooltip", "border", Commons.Color.tooltip.border, 1)
    radius: Style.cornerRadius

    Column {
      id: column
      anchors.centerIn: parent
      spacing: Style.space(2)

      Row {
        visible: !!root.issue
        spacing: Style.space(7)
        readonly property color tone: root.issue && root.theme ? root.theme.colorFor(root.issue.state) : Commons.Color.tooltip.text

        Text {
          text: root.issue ? root.issue.glyph : ""
          color: parent.tone
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
        }
        Text {
          text: root.issue ? root.issue.text : ""
          color: parent.tone
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
        }
      }

      Repeater {
        model: root.rows

        Row {
          required property var modelData
          readonly property color tone: root.theme && modelData.state.state !== "normal"
            ? root.theme.colorFor(modelData.state.state) : Commons.Color.tooltip.text
          spacing: Style.space(7)

          Text {
            text: modelData.glyph
            color: Qt.darker(Commons.Color.tooltip.text, 1.55)
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
          }
          Text {
            text: Math.round(modelData.state.percent) + "%"
            color: parent.tone
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
          }
          Text {
            text: "\u{F0954}"
            color: parent.tone
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
          }
          Text {
            text: Model.formatLong(modelData.state.remainingMs)
            color: parent.tone
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
          }
        }
      }
    }
  }
}
