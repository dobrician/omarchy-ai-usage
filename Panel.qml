import QtQuick
import Quickshell
import Quickshell.Hyprland
import qs.Commons
import qs.Ui
import "Model.js" as Model

BarWidget {
  id: root

  readonly property var service: bar && bar.shell && typeof bar.shell.serviceFor === "function"
    ? bar.shell.serviceFor("dc.ai-usage") : null
  readonly property var entries: service ? service.entries : []
  readonly property bool showProviders: !!service && service.available && entries.length > 0 && !vertical
  readonly property string mode: setting("displayMode", "name") === "values" ? "values" : "name"
  property double nowMs: Date.now()
  property string hoveredId: ""
  property Item hoveredItem: null
  // A refresh that drops providers destroys their delegates; a destroyed
  // hover target must not leave the others dimmed.
  onHoveredItemChanged: if (!hoveredItem) {
    tooltipDelay.stop()
    tooltipShown = false
    hoveredId = ""
  }
  readonly property var hoveredEntry: {
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].id === hoveredId) return entries[i]
    }
    return null
  }
  property bool tooltipShown: false
  property bool settingsOpen: false
  readonly property var orderedRows: service ? Model.sortEntries(service.vendorRows, settings.providerOrder) : []

  onServiceChanged: if (service) service.configure(settings)
  onSettingsChanged: if (service) service.configure(settings)

  implicitWidth: showProviders ? row.implicitWidth : placeholder.implicitWidth
  implicitHeight: barSize

  function persistEntry(values) {
    var entry = { id: root.moduleName }
    for (var k in values) {
      if (k !== "id") entry[k] = values[k]
    }
    root.settings = entry
    if (root.bar && root.bar.shell && typeof root.bar.shell.updateEntryInline === "function")
      root.bar.shell.updateEntryInline(root.moduleName, entry)
  }

  function persistSettings(values) {
    var merged = {}
    for (var k in root.settings) merged[k] = root.settings[k]
    for (var key in values) merged[key] = values[key]
    persistEntry(merged)
  }

  function handlePress(button) {
    if (button === Qt.LeftButton) persistSettings({ displayMode: mode === "name" ? "values" : "name" })
    else if (button === Qt.MiddleButton && service) service.refresh()
    else if (button === Qt.RightButton) openSettings()
  }

  function openSettings() {
    if (!service) return
    tooltipShown = false
    service.loadVendors()
    settingsOpen = true
  }

  // KeyboardPanel calls owner.close() for Esc, outside clicks and popout switches.
  function close() {
    settingsOpen = false
  }

  function moveProvider(id, delta) {
    var ids = orderedRows.map(function(r) { return r.id })
    persistSettings({ providerOrder: Model.moveInOrder(settings.providerOrder, ids, id, delta) })
  }

  // IPC requests reach every widget instance; only the one on the focused
  // monitor acts (the first one if none is), so nothing toggles or opens twice.
  function screenOf(item) {
    var win = item && item.QsWindow ? item.QsWindow.window : null
    return win && win.screen ? win.screen.name : ""
  }

  function isLeadInstance() {
    var items = bar && typeof bar.moduleWidgets === "function" ? bar.moduleWidgets(moduleName) : [root]
    if (!items || items.length === 0) return true
    var focused = Hyprland.focusedMonitor ? Hyprland.focusedMonitor.name : ""
    for (var i = 0; i < items.length; i++) {
      if (focused !== "" && screenOf(items[i]) === focused) return items[i] === root
    }
    return items[0] === root
  }

  Connections {
    target: root.service
    function onModeToggleRequested() { if (root.isLeadInstance()) root.handlePress(Qt.LeftButton) }
    function onSettingsRequested() { if (root.isLeadInstance()) root.openSettings() }
  }

  function issueFor(entry) {
    if (!service) return null
    return Model.issueFor(entry, service.diag[entry.id], nowMs, service.snapshotStale ? service.lastError : "")
  }

  function setHovered(item, entry, on) {
    if (on) {
      hoveredItem = item
      hoveredId = entry.id
      tooltipShown = false
      tooltipDelay.restart()
    } else if (hoveredItem === item) {
      tooltipDelay.stop()
      tooltipShown = false
      hoveredId = ""
      hoveredItem = null
    }
  }

  Timer {
    id: tooltipDelay
    interval: 400
    onTriggered: root.tooltipShown = root.hoveredItem !== null
  }

  SettingsPanel {
    anchorItem: root.showProviders ? row : placeholder
    owner: root
    bar: root.bar
    open: root.settingsOpen
    rows: root.orderedRows
    available: !!root.service && root.service.available
    loaded: !!root.service && root.service.vendorsLoaded
    busyId: root.service ? root.service.busyId : ""
    scanning: !!root.service && root.service.scanning
    onMoveRequested: function(id, delta) { root.moveProvider(id, delta) }
    onToggleRequested: function(id, on) { if (root.service) root.service.setMonitored(id, on) }
    onScanRequested: if (root.service) root.service.scan()
  }

  UsageTooltip {
    target: root.hoveredItem
    bar: root.bar
    entry: root.hoveredEntry
    issue: root.hoveredEntry ? root.issueFor(root.hoveredEntry) : null
    nowMs: root.nowMs
    theme: root.service ? root.service.theme : null
    shown: root.tooltipShown && !root.settingsOpen
  }

  Timer {
    interval: 30000
    running: true
    repeat: true
    onTriggered: root.nowMs = Date.now()
  }

  Row {
    id: row
    visible: root.showProviders
    spacing: 0

    // An integer model keeps the delegates alive across refreshes; each one
    // reads its entry by index, so a refresh only rebinds values.
    Repeater {
      model: root.showProviders ? root.entries.length : 0

      ProviderButton {
        id: button
        required property int index
        readonly property var entryData: root.entries[index] || null
        bar: root.bar
        entry: entryData
        mode: root.mode
        nowMs: root.nowMs
        theme: root.service ? root.service.theme : null
        issue: entryData ? root.issueFor(entryData) : null
        stale: !!issue
        hoverDim: root.hoveredId !== "" && !!entryData && root.hoveredId !== entryData.id
        onPressed: function(mouseButton) { root.handlePress(mouseButton) }
        onTooltipHoveredChanged: if (entryData) root.setHovered(button, entryData, tooltipHovered)
        // A reorder under a still pointer hands this delegate another provider.
        onEntryDataChanged: if (root.hoveredItem === button) {
          if (entryData) root.hoveredId = entryData.id
          else root.setHovered(button, null, false)
        }
      }
    }
  }

  WidgetButton {
    id: placeholder
    visible: !root.showProviders
    bar: root.bar
    text: "\u{F16A3}"
    dimmed: true
    tooltipText: root.vertical ? "AI Usage needs a top or bottom bar"
      : !root.service ? "AI Usage needs the stock Omarchy bar"
      : !root.service.available ? "ai-usagebar not installed: omarchy pkg aur add ai-usagebar-bin"
      : root.service.lastError !== "" ? root.service.lastError
      : "No provider to show. Right-click to configure"
    onPressed: function(mouseButton) { root.handlePress(mouseButton) }
  }
}
