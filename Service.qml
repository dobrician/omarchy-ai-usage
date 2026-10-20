import QtQuick
import Quickshell
import Quickshell.Io
import "Model.js" as Model

// One instance per shell: every bar widget reads this through
// bar.shell.serviceFor("dc.ai-usage"). All ai-usagebar calls go through a
// single queue so detect, usage, vendors and apply never overlap.
Item {
  id: root
  visible: false

  property var settings: ({})
  property bool configured: false
  property bool available: true
  property bool loading: false
  property bool snapshotStale: false
  property string lastError: ""
  property var rawEntries: []
  readonly property var entries: Model.sortEntries(Model.mergeSharedPools(rawEntries), settings.providerOrder)
  property string vendorsJson: ""
  property bool vendorsLoaded: false
  // Derived, so a plan or glyph that arrives with a later usage read shows up.
  readonly property var vendorRows: vendorsLoaded ? Model.vendorRows(vendorsJson, rawEntries) : []
  property var diag: ({})
  property string busyId: ""
  property bool scanning: false
  property alias theme: theme

  signal settingsRequested()
  signal modeToggleRequested()

  readonly property string binary: String(settings.binary || "ai-usagebar")
  readonly property int refreshIntervalSec: {
    var n = Number(settings.refreshIntervalSec)
    return isFinite(n) ? Math.max(300, Math.min(3600, Math.round(n))) : 300
  }

  // Why a vendor is stale: ai-usagebar keeps the last HTTP code and message
  // in <cache>/<vendor>/.last_error and the backoff deadline in .retry_after.
  readonly property string diagScript: 'c="${XDG_CACHE_HOME:-$HOME/.cache}/ai-usagebar"; for id in "$@"; do d="$c/$id"; code=""; msg=""; if [ -f "$d/.last_error" ]; then code=$(sed -n 1p "$d/.last_error"); msg=$(sed -n 2p "$d/.last_error" | tr "\t" " "); fi; ra=$(cat "$d/.retry_after" 2>/dev/null); printf "%s\t%s\t%s\t%s\n" "$id" "$code" "$msg" "$ra"; done'

  property var queue: []
  property var current: null
  property bool detected: false
  // Bumped when the binary changes: results of jobs from before are dropped.
  property int generation: 0

  Theme { id: theme }

  function configure(next) {
    var copy = {}
    for (var k in next || {}) copy[k] = next[k]
    if (configured && JSON.stringify(copy) === JSON.stringify(settings)) return
    var binaryChanged = String(copy.binary || "ai-usagebar") !== binary
    settings = copy
    if (!configured || binaryChanged) {
      if (configured) {
        generation++
        queue = []
        rawEntries = []
        vendorsJson = ""
        vendorsLoaded = false
        diag = ({})
        busyId = ""
        scanning = false
      }
      configured = true
      detected = false
      available = true
      enqueue({ kind: "probe" })
    }
  }

  function refresh() {
    if (!configured) return
    if (!available) {
      enqueue({ kind: "probe" })
      return
    }
    enqueue({ kind: "usage" })
  }

  function loadVendors() {
    if (configured && available) enqueue({ kind: "vendors" })
  }

  // Picks up providers signed in after the shell started: detect, then
  // usage and vendors, so the configurator lists them right away.
  function scan() {
    if (!configured || scanning || busyId !== "") return
    scanning = true
    enqueue({ kind: available ? "detect" : "probe", scan: true })
  }

  function setMonitored(id, on) {
    if (!configured || !available || busyId !== "" || scanning) return
    busyId = id
    enqueue({ kind: "apply", id: id, stdin: Model.ignorePatch(id, on) })
    enqueue({ kind: "usage" })
    enqueue({ kind: "vendors", clearsBusy: true })
  }

  function enqueue(job) {
    job.generation = generation
    queue = Model.enqueueJob(queue, job)
    pump()
  }

  function limitFor(job) {
    return job.kind === "usage" ? 40 : 12
  }

  // coreutils timeout signals the whole process group, so CLIs that
  // ai-usagebar spawns (agy, gh, codex) do not outlive a hung refresh.
  function commandFor(job) {
    if (job.kind === "probe") return ["sh", "-c", "command -v \"$1\"", "sh", binary]
    if (job.kind === "diag") return ["sh", "-c", root.diagScript, "sh"].concat(job.ids)
    var limited = ["timeout", "-k", "3", String(limitFor(job)), binary]
    // A scan re-checks every vendor; ai-usagebar still keeps the ones turned off.
    if (job.kind === "detect") return limited.concat(job.scan ? ["detect", "--all", "--json"] : ["detect", "--json"])
    if (job.kind === "usage") return limited.concat(["usage", "--json"])
    if (job.kind === "vendors") return limited.concat(["vendors", "--json"])
    return limited.concat(["settings", "apply"])
  }

  function pump() {
    if (current || queue.length === 0) return
    current = queue[0]
    queue = queue.slice(1)
    loading = current.kind === "usage"
    proc.timedOut = false
    proc.exitSeen = false
    proc.command = commandFor(current)
    proc.stdinEnabled = current.kind === "apply"
    timeout.interval = (limitFor(current) + 5) * 1000
    timeout.restart()
    proc.running = true
  }

  // `forJob` guards against a late signal finishing the job that came after.
  function finish(exitCode, forJob) {
    if (!current || (forJob !== undefined && forJob !== current)) return
    timeout.stop()
    var job = current
    if (exitCode === 124 || exitCode === 137) proc.timedOut = true
    var ok = exitCode === 0 && !proc.timedOut
    var out = stdout.text
    var err = String(stderr.text || "").trim()
    current = null
    loading = false
    if (job.generation !== generation) {
      pump()
      return
    }

    if (job.kind === "probe") {
      available = ok
      if (ok && (!detected || job.scan)) enqueue({ kind: "detect", scan: job.scan })
      if (ok) enqueue({ kind: "usage" })
      else if (job.scan) scanning = false
    } else if (job.kind === "detect") {
      detected = true
      if (!ok) warn("detect failed: " + (err || ("exit " + exitCode)))
      if (job.scan) {
        enqueue({ kind: "usage" })
        enqueue({ kind: "vendors", endsScan: true })
      }
    } else if (job.kind === "usage") {
      var parsed = ok ? Model.parseUsage(out) : null
      if (parsed && parsed.ok) {
        rawEntries = parsed.entries
        snapshotStale = false
        lastError = ""
        theme.reload()
        // Named accounts keep their cache elsewhere; only plain vendor ids are diagnosed.
        var troubled = parsed.entries.filter(function(e) { return (e.stale || e.error) && e.id === e.vendor }).map(function(e) { return e.id })
        if (troubled.length > 0) enqueue({ kind: "diag", ids: troubled })
        else diag = ({})
      } else if (Model.isNoVendors(err)) {
        // Every provider is switched off: an empty bar, not an error.
        rawEntries = []
        snapshotStale = false
        lastError = ""
        diag = ({})
      } else {
        snapshotStale = rawEntries.length > 0
        lastError = proc.timedOut ? "ai-usagebar usage timed out"
          : !ok ? ("ai-usagebar usage exit " + exitCode + (err ? ": " + err : ""))
          : parsed.error
        warn(lastError)
        // -1: the process never started (binary gone); 127: shell could not find it.
        if (exitCode === -1 || exitCode === 127) enqueue({ kind: "probe" })
      }
    } else if (job.kind === "diag") {
      diag = ok ? Model.parseDiag(out) : ({})
    } else if (job.kind === "vendors") {
      if (ok) {
        vendorsJson = out
        vendorsLoaded = true
      }
      else warn("vendors failed: " + (err || ("exit " + exitCode)))
      if (job.clearsBusy) busyId = ""
      if (job.endsScan) scanning = false
    } else if (job.kind === "apply") {
      if (!ok) warn("settings apply failed for " + job.id + ": " + (err || ("exit " + exitCode)))
    }
    pump()
  }

  function warn(message) {
    var text = String(message || "")
    console.warn("dc.ai-usage", text.length > 180 ? text.slice(0, 177) + "..." : text)
  }

  Process {
    id: proc
    property bool timedOut: false
    property bool exitSeen: false
    running: false
    stdout: StdioCollector { id: stdout; waitForEnd: true }
    stderr: StdioCollector { id: stderr; waitForEnd: true }
    onStarted: {
      if (root.current && root.current.kind === "apply") write(root.current.stdin + "\n")
    }
    onExited: function(exitCode) {
      exitSeen = true
      var job = root.current
      Qt.callLater(function() { root.finish(exitCode, job) })
    }
    // A process that fails to start resets `running` without emitting exited.
    onRunningChanged: {
      if (running || !root.current) return
      var job = root.current
      Qt.callLater(function() { if (!proc.exitSeen && !proc.running) root.finish(-1, job) })
    }
  }

  Timer {
    id: timeout
    repeat: false
    onTriggered: {
      proc.timedOut = true
      if (proc.running) proc.running = false
      else root.finish(-1, root.current)
    }
  }

  Timer {
    interval: root.refreshIntervalSec * 1000
    running: root.configured
    repeat: true
    onTriggered: root.refresh()
  }

  IpcHandler {
    target: "dc.ai-usage"
    function openSettings(): void { root.settingsRequested() }
    function refresh(): void { root.refresh() }
    function scan(): void { root.scan() }
    function toggleMode(): void { root.modeToggleRequested() }
    function status(): string {
      return JSON.stringify({ current: root.current ? root.current.kind : "", queued: root.queue.length, binary: root.binary, available: root.available, scanning: root.scanning, loading: root.loading, stale: root.snapshotStale,
        error: root.lastError, providers: root.entries.map(function(e) { return e.id }) })
    }
  }
}
