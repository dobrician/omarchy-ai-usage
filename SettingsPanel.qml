import QtQuick
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Right-click configurator: provider order and which providers ai-usagebar
// monitors at all. Keyboard: up/down select, left/right move, space toggles.
KeyboardPanel {
  id: root

  property var rows: []
  property bool available: true
  property bool loaded: true
  readonly property real rowHeight: Style.spacing.popupRowHeight
  readonly property real rowGap: Style.space(2)
  property string busyId: ""
  property bool scanning: false
  property int cursor: 0

  signal moveRequested(string id, int delta)
  signal toggleRequested(string id, bool on)
  signal scanRequested()

  readonly property string issuesUrl: "https://github.com/dobrician/omarchy-ai-usage/issues/new?template=bug_report.yml"

  readonly property color foreground: Color.popups.text
  readonly property color dim: Qt.darker(foreground, 1.55)

  focusTarget: keys
  contentWidth: fittedContentWidth(Style.space(320))
  contentHeight: fittedContentHeight(content.implicitHeight, Style.space(640))

  onOpenChanged: if (open) cursor = 0

  function clampCursor() {
    cursor = Math.max(0, Math.min(rows.length - 1, cursor))
  }

  // Keep the keyboard row on screen when the list scrolls.
  onCursorChanged: {
    var top = cursor * (rowHeight + rowGap)
    if (top < list.contentY) list.contentY = top
    else if (top + rowHeight > list.contentY + list.height) list.contentY = top + rowHeight - list.height
  }

  PanelKeyCatcher {
    id: keys
    anchors.fill: parent
    onCloseRequested: root.close()
    onMoveRequested: function(dx, dy) {
      if (root.rows.length === 0) return
      var row = root.rows[root.cursor]
      if (dy !== 0) {
        root.cursor += dy
        root.clampCursor()
      } else if (row && Model.canMove(root.rows.map(function(r) { return r.id }), row.id, dx)) {
        root.moveRequested(row.id, dx)
        root.cursor += dx
        root.clampCursor()
      }
    }
    onActivateRequested: {
      var row = root.rows[root.cursor]
      if (row && root.busyId === "" && !root.scanning) root.toggleRequested(row.id, !row.enabled)
    }

    Column {
      id: content
      width: parent.width
      spacing: Style.space(10)

      PanelSectionHeader {
        text: "AI USAGE"
        foreground: root.foreground
      }

      Text {
        textFormat: Text.PlainText
        visible: root.rows.length === 0
        width: parent.width
        wrapMode: Text.WordWrap
        text: !root.available
          ? "ai-usagebar is not installed. Install it with: omarchy pkg aur add ai-usagebar-bin"
          : !root.loaded ? "Loading providers..."
          : "No provider found. Sign in to an AI CLI (claude, codex, grok, agy...), then scan again."
        color: root.dim
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
      }

      Flickable {
        id: list
        width: parent.width
        height: Math.min(rowsColumn.implicitHeight, Style.space(420))
        contentHeight: rowsColumn.implicitHeight
        interactive: contentHeight > height
        clip: true
        boundsBehavior: Flickable.StopAtBounds

        Column {
          id: rowsColumn
          width: parent.width
          spacing: root.rowGap

          Repeater {
            model: root.rows

            Item {
              id: rowItem
              required property var modelData
              required property int index
              readonly property bool current: index === root.cursor
              width: parent.width
              height: root.rowHeight

              Rectangle {
                anchors.fill: parent
                radius: Style.cornerRadius
                color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, rowItem.current ? 0.08 : 0)
              }

              MouseArea {
                anchors.fill: parent
                hoverEnabled: true
                onEntered: root.cursor = rowItem.index
              }

              Row {
                id: labelRow
                anchors.left: parent.left
                anchors.leftMargin: Style.space(8)
                anchors.right: controls.left
                anchors.rightMargin: Style.space(8)
                anchors.verticalCenter: parent.verticalCenter
                spacing: Style.space(8)
                clip: true
                opacity: rowItem.modelData.enabled ? 1 : 0.45

                ProviderIcon {
                  anchors.verticalCenter: parent.verticalCenter
                  icon: rowItem.modelData.icon
                  glyph: rowItem.modelData.glyph
                  color: root.foreground
                }
                Text {
                  id: nameText
                  textFormat: Text.PlainText
                  anchors.verticalCenter: parent.verticalCenter
                  text: rowItem.modelData.name
                  color: root.foreground
                  font.family: Style.font.family
                  font.pixelSize: Style.font.body
                }
                Text {
                  textFormat: Text.PlainText
                  anchors.verticalCenter: parent.verticalCenter
                  width: Math.max(0, labelRow.width - nameText.width - Style.space(12) - labelRow.spacing * 2)
                  elide: Text.ElideRight
                  text: rowItem.modelData.plan
                  color: root.dim
                  font.family: Style.font.family
                  font.pixelSize: Style.font.caption
                }
              }

              Row {
                id: controls
                anchors.right: parent.right
                anchors.rightMargin: Style.space(4)
                anchors.verticalCenter: parent.verticalCenter
                spacing: Style.space(2)

                PanelActionButton {
                  anchors.verticalCenter: parent.verticalCenter
                  iconText: "\u{F005D}"
                  foreground: root.foreground
                  opacity: rowItem.index > 0 ? 1 : 0.3
                  onClicked: if (rowItem.index > 0) root.moveRequested(rowItem.modelData.id, -1)
                }
                PanelActionButton {
                  anchors.verticalCenter: parent.verticalCenter
                  iconText: "\u{F0045}"
                  foreground: root.foreground
                  opacity: rowItem.index < root.rows.length - 1 ? 1 : 0.3
                  onClicked: if (rowItem.index < root.rows.length - 1) root.moveRequested(rowItem.modelData.id, 1)
                }
                ToggleSwitch {
                  anchors.verticalCenter: parent.verticalCenter
                  checked: rowItem.modelData.enabled
                  busy: root.busyId !== "" || root.scanning
                  foreground: root.foreground
                  hasCursor: rowItem.current
                  onToggled: root.toggleRequested(rowItem.modelData.id, !rowItem.modelData.enabled)
                }
              }
            }
          }
        }
      }

      PanelSeparator {
        width: parent.width
        foreground: root.foreground
      }

      // Report an issue on the left; rescan for providers signed in since
      // the shell started on the right.
      Item {
        width: parent.width
        height: scanButton.implicitHeight

        PanelActionButton {
          anchors.left: parent.left
          iconText: "\u{F00E4}"
          foreground: root.foreground
          onClicked: {
            Qt.openUrlExternally(root.issuesUrl)
            root.close()
          }
        }

        PanelActionButton {
          id: scanButton
          anchors.right: parent.right
          iconText: "\u{F0450}"
          foreground: root.foreground
          enabled: !root.scanning && root.busyId === ""
          onClicked: root.scanRequested()

          RotationAnimation on rotation {
            running: root.scanning
            from: 0
            to: 360
            duration: 900
            loops: Animation.Infinite
            // A scan often takes a few milliseconds; finish the turn anyway.
            alwaysRunToEnd: true
          }
        }
      }
    }
  }
}
