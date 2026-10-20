import QtQuick
import QtQuick.Effects
import qs.Commons

// Provider mark tinted to `color`: an SVG from assets/ for known providers,
// otherwise the Nerd Font glyph ai-usagebar reports, or the stock agents one.
Item {
  id: root

  property string icon: ""
  property string glyph: ""
  property color color: Color.bar.text
  property real size: Style.space(12)
  property string fontFamily: Style.font.family

  readonly property bool hasAsset: icon !== ""

  width: size
  height: size

  Image {
    id: mask
    anchors.fill: parent
    source: root.hasAsset ? Qt.resolvedUrl("assets/" + root.icon + ".svg") : ""
    visible: false
    sourceSize.width: root.size * 2
    sourceSize.height: root.size * 2
    fillMode: Image.PreserveAspectFit
  }

  MultiEffect {
    anchors.fill: parent
    source: mask
    visible: root.hasAsset
    colorization: 1.0
    colorizationColor: root.color
  }

  Text {
    anchors.centerIn: parent
    visible: !root.hasAsset
    text: root.glyph !== "" ? root.glyph : "\u{F16A3}"
    color: root.color
    font.family: root.fontFamily
    font.pixelSize: root.size
    renderType: Text.NativeRendering
  }
}
