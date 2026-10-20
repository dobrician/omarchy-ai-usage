.pragma library

var WEEK_SECS = 604800
var ELAPSED_FLOOR = 0.1
var WARNING_AT = 85
var DANGER_AT = 100
var RANK = { normal: 0, warning: 1, danger: 2 }

var DISPLAY = {
  anthropic: { name: "Claude", icon: "claude" },
  openai: { name: "Codex", icon: "codex" },
  supergrok: { name: "Grok", icon: "grok" },
  grokbot: { name: "Grok Bot", icon: "grokbot" },
  antigravity: { name: "Antigravity", icon: "antigravity" }
}

function isPrivateUseGlyph(text) {
  var s = String(text || "")
  var cp = s.codePointAt(0)
  if (cp === undefined || String.fromCodePoint(cp) !== s) return false
  return (cp >= 0xE000 && cp <= 0xF8FF) || (cp >= 0xF0000 && cp <= 0xFFFFD)
}

// A window without a known length (a monthly cycle, a balance) still has a
// percentage; it keeps windowSecs null and is judged without pace.
// Grouped rows are breakdowns of another metric and are skipped.
function normalizeMetric(m) {
  if (!m || typeof m.percent !== "number" || !isFinite(m.percent) || m.group) return null
  // ai-usagebar reports an empty allowance ("0 of 0 used") as 100%.
  if (/^\s*0 of 0\b/.test(String(m.detail || ""))) return null
  var secs = Number(m.window_secs)
  var resetAt = m.reset_at ? Date.parse(m.reset_at) : NaN
  return {
    label: String(m.label || ""),
    percent: Math.max(0, Math.min(100, m.percent)),
    resetAt: isFinite(resetAt) ? resetAt : null,
    windowSecs: isFinite(secs) && secs > 0 ? secs : null,
    pool: m.model_pool === true
  }
}

function vendorOf(id) {
  return String(id).split("@")[0]
}

function normalizeEntry(e) {
  if (!e || typeof e.id !== "string") return null
  var c = { long: [], short: [], longPools: [], shortPools: [], paceless: [] }
  var metrics = Array.isArray(e.metrics) ? e.metrics : []
  var count = 0
  for (var i = 0; i < metrics.length; i++) {
    var w = normalizeMetric(metrics[i])
    if (!w) continue
    count++
    if (w.windowSecs === null || w.resetAt === null) c.paceless.push(w)
    else if (w.windowSecs >= WEEK_SECS) (w.pool ? c.longPools : c.long).push(w)
    else (w.pool ? c.shortPools : c.short).push(w)
  }
  if (count === 0 && !e.error) return null
  var vendor = vendorOf(e.id)
  var known = DISPLAY[vendor]
  return {
    id: e.id,
    vendor: vendor,
    name: known && vendor === e.id ? known.name : String(e.display_name || (known ? known.name : e.id)),
    icon: known ? known.icon : "",
    glyph: isPrivateUseGlyph(e.icon) ? e.icon : "",
    plan: String(e.plan || ""),
    stale: e.stale === true,
    error: e.error ? String(e.error) : null,
    candidates: c
  }
}

function parseUsage(text) {
  var data
  try {
    data = JSON.parse(String(text || ""))
  } catch (err) {
    return { ok: false, error: "invalid JSON from ai-usagebar", entries: [] }
  }
  if (!data || data.schema_version !== 1 || !Array.isArray(data.entries))
    return { ok: false, error: "unsupported ai-usagebar output", entries: [] }
  var entries = []
  for (var i = 0; i < data.entries.length; i++) {
    var entry = normalizeEntry(data.entries[i])
    if (entry) entries.push(entry)
  }
  return { ok: true, error: "", entries: entries }
}

function windowState(w, nowMs) {
  var remaining = w.resetAt === null ? null : w.resetAt - nowMs
  if (remaining !== null && !(remaining > 0))
    return { state: "normal", elapsed: 0, projected: 0, percent: 0, remainingMs: null }
  var elapsed = null
  var projected = w.percent
  if (w.windowSecs !== null && remaining !== null) {
    elapsed = Math.max(0, Math.min(1, 1 - remaining / (w.windowSecs * 1000)))
    projected = w.percent / Math.max(elapsed, ELAPSED_FLOOR)
  }
  var state = "normal"
  if (w.percent >= 100 || projected >= DANGER_AT) state = "danger"
  else if (projected >= WARNING_AT) state = "warning"
  return { state: state, elapsed: elapsed, projected: projected, percent: w.percent, remainingMs: remaining }
}

function pickWindow(windows, nowMs) {
  var best = null
  var bestState = null
  for (var i = 0; i < windows.length; i++) {
    var s = windowState(windows[i], nowMs)
    if (!best || RANK[s.state] > RANK[bestState.state]
        || (RANK[s.state] === RANK[bestState.state] && s.projected > bestState.projected)) {
      best = windows[i]
      bestState = s
    }
  }
  return best
}

// Shared windows first; a model pool or a paceless metric stands in only
// when the provider reports nothing better (ai-usagebar ranks pools lower).
function pickTiered(tiers, nowMs) {
  for (var i = 0; i < tiers.length; i++) {
    var w = pickWindow(tiers[i], nowMs)
    if (w) return w
  }
  return null
}

function resolveEntry(entry, nowMs) {
  var c = entry.candidates
  return {
    weekly: pickTiered([c.long, c.longPools, c.paceless], nowMs),
    short: pickTiered([c.short, c.shortPools], nowMs)
  }
}

var PRICES = [
  [/SuperGrok Heavy/i, 300],
  [/AI Ultra/i, 250],
  [/Max 20x|ChatGPT Pro|Cursor Ultra|Kiro Power/i, 200],
  [/Max 5x/i, 100],
  [/Cursor Pro\+/i, 60],
  [/Pro\+/i, 40],
  [/SuperGrok/i, 30],
  [/Claude Pro|ChatGPT Plus|AI Pro|Cursor Pro|Kiro Pro/i, 20],
  [/Copilot Pro|OpenCode Go/i, 10]
]
var KNOWN_ORDER = ["anthropic", "openai", "supergrok", "grokbot", "antigravity"]

function planPrice(plan) {
  var text = String(plan || "")
  for (var i = 0; i < PRICES.length; i++) {
    if (PRICES[i][0].test(text)) return PRICES[i][1]
  }
  return 0
}

function defaultCompare(a, b) {
  var price = planPrice(b.plan) - planPrice(a.plan)
  if (price !== 0) return price
  var ka = KNOWN_ORDER.indexOf(a.vendor || a.id)
  var kb = KNOWN_ORDER.indexOf(b.vendor || b.id)
  if (ka !== kb) return (ka < 0 ? KNOWN_ORDER.length : ka) - (kb < 0 ? KNOWN_ORDER.length : kb)
  return String(a.name).localeCompare(String(b.name))
}

// Settings read back from shell.json arrive as a QML sequence, which is
// array-like but not an Array; anything else is no order at all.
function orderList(value) {
  if (!value || typeof value !== "object" || typeof value.length !== "number") return null
  var out = []
  for (var i = 0; i < value.length; i++) out.push(String(value[i]))
  return out
}

function sortEntries(entries, order) {
  var rest = entries.slice().sort(defaultCompare)
  var providerOrder = orderList(order)
  if (!providerOrder) return rest
  var ordered = []
  for (var i = 0; i < providerOrder.length; i++) {
    for (var j = 0; j < rest.length; j++) {
      if (rest[j].id === providerOrder[i] || rest[j].vendor === providerOrder[i]) {
        ordered.push(rest.splice(j, 1)[0])
        break
      }
    }
  }
  return ordered.concat(rest)
}

function pad2(n) {
  return n < 10 ? "0" + n : String(n)
}

function splitDuration(ms) {
  var minutes = Math.floor(Math.max(0, ms) / 60000)
  return { d: Math.floor(minutes / 1440), h: Math.floor(minutes / 60) % 24, m: minutes % 60 }
}

function formatShort(ms) {
  if (ms === null || ms === undefined) return "--"
  var t = splitDuration(ms)
  return t.d > 0 ? t.d + "d" + pad2(t.h) + "h" : t.h + "h" + pad2(t.m) + "m"
}

function formatLong(ms) {
  if (ms === null || ms === undefined) return "--"
  var t = splitDuration(ms)
  return t.d > 0 ? t.d + "d " + t.h + "h" : t.h + "h " + t.m + "m"
}

function formatRetry(ms) {
  if (ms < 3600e3) return Math.max(1, Math.ceil(ms / 60e3)) + "m"
  return formatLong(ms)
}

function labelText(entry, mode, nowMs) {
  if (mode !== "values") return entry.name
  var weekly = resolveEntry(entry, nowMs).weekly
  if (!weekly) return entry.name
  var s = windowState(weekly, nowMs)
  return Math.round(s.percent) + "%:" + formatShort(s.remainingMs)
}

function vendorRows(vendorsJson, entries) {
  var data
  try {
    data = JSON.parse(String(vendorsJson || ""))
  } catch (err) {
    return []
  }
  var vendors = data && Array.isArray(data.vendors) ? data.vendors : []
  var live = {}
  for (var i = 0; i < (entries || []).length; i++) live[entries[i].id] = entries[i]
  var rows = []
  for (var j = 0; j < vendors.length; j++) {
    var v = vendors[j]
    if (!v || typeof v.id !== "string" || !(v.configured || v.enabled)) continue
    var known = DISPLAY[v.id]
    rows.push({
      id: v.id,
      name: known ? known.name : String(v.name || v.id),
      icon: known ? known.icon : "",
      glyph: live[v.id] && live[v.id].glyph ? live[v.id].glyph : "",
      plan: live[v.id] ? live[v.id].plan : "",
      enabled: v.enabled === true
    })
  }
  return rows
}

function ignorePatch(id, enabled) {
  var vendors = {}
  vendors[id] = enabled === true
  return JSON.stringify({ schema_version: 1, vendors: vendors })
}

function moveInOrder(order, ids, id, delta) {
  var effective = []
  var source = orderList(order) || []
  for (var i = 0; i < source.length; i++) {
    if (ids.indexOf(source[i]) >= 0 && effective.indexOf(source[i]) < 0) effective.push(source[i])
  }
  for (var j = 0; j < ids.length; j++) {
    if (effective.indexOf(ids[j]) < 0) effective.push(ids[j])
  }
  var from = effective.indexOf(id)
  var to = from + delta
  if (from < 0 || to < 0 || to >= effective.length) return effective
  effective.splice(to, 0, effective.splice(from, 1)[0])
  return effective
}

function canMove(ids, id, delta) {
  var from = ids.indexOf(id)
  var to = from + delta
  return from >= 0 && to >= 0 && to < ids.length
}

// An apply changes what vendors/usage would report, so a job queued before it
// cannot stand in for one requested after it.
function enqueueJob(queue, job) {
  if (job.kind !== "apply") {
    var start = 0
    for (var i = 0; i < queue.length; i++) {
      if (queue[i].kind === "apply") start = i + 1
    }
    // A queued job of the same kind absorbs the new one and its flags.
    for (var j = start; j < queue.length; j++) {
      if (queue[j].kind !== job.kind) continue
      var merged = {}
      for (var a in queue[j]) merged[a] = queue[j][a]
      for (var b in job) if (job[b]) merged[b] = job[b]
      var out = queue.slice()
      out[j] = merged
      return out
    }
  }
  return queue.concat([job])
}

// Track and fill of the weekly line as [from, to] pixel ranges, leaving a
// real hole for "now" so a transparent bar shows through it.
function lineSegments(width, fillPx, gapCenter, gapWidth) {
  function clipTo(ranges, limit) {
    var out = []
    for (var i = 0; i < ranges.length; i++) {
      var to = Math.min(ranges[i][1], limit)
      if (to > ranges[i][0]) out.push([ranges[i][0], to])
    }
    return out
  }
  var track = [[0, width]]
  if (gapCenter !== null && gapCenter !== undefined) {
    var x = Math.round(gapCenter)
    var half = gapWidth / 2
    track = []
    if (x - half > 0) track.push([0, x - half])
    if (x + half < width) track.push([x + half, width])
  }
  return { track: track, fill: clipTo(track, fillPx) }
}

// One line per vendor from the diag script: id, HTTP code, message,
// retry_after epoch seconds (tab separated, any field may be empty).
function parseDiag(text) {
  var out = {}
  var lines = String(text || "").split("\n")
  for (var i = 0; i < lines.length; i++) {
    var f = lines[i].split("\t")
    if (!f[0]) continue
    var retry = Number(f[3])
    out[f[0]] = { code: f[1] || "", message: f[2] || "", retryAt: f[3] && isFinite(retry) && retry > 0 ? retry * 1000 : null }
  }
  return out
}

var ISSUES = {
  auth: { glyph: "\u{F033E}", state: "danger", text: "needs auth" },
  rate: { glyph: "\u{F04C5}", state: "warning", text: "rate limited" },
  offline: { glyph: "\u{F05AA}", state: "warning", text: "offline" },
  error: { glyph: "\u{F0026}", state: "danger", text: "error" },
  stale: { glyph: "\u{F05CE}", state: "warning", text: "stale data" }
}

function issue(kind, text) {
  return { kind: kind, glyph: ISSUES[kind].glyph, state: ISSUES[kind].state, text: text || ISSUES[kind].text }
}

function issueFor(entry, diag, nowMs, globalError) {
  var d = diag || { code: "", message: "", retryAt: null }
  if (!entry.stale && !entry.error && !globalError) return null
  var message = [entry.error || "", d.message, globalError || ""].join(" ")
  var code = String(d.code || "")
  if (code === "429" || /rate.?limit|too many requests/i.test(message)) {
    var wait = d.retryAt !== null && d.retryAt > nowMs ? " · retry in " + formatRetry(d.retryAt - nowMs) : ""
    return issue("rate", ISSUES.rate.text + wait)
  }
  if (/network|dns|connect|timed? ?out|unreachable|offline|resolve/i.test(message)) return issue("offline")
  if (code === "401" || code === "403" || /unauthori[sz]ed|auth|sign.?in|log.?in|expired|credential/i.test(message))
    return issue("auth")
  if (entry.error || /^5\d\d$/.test(code)) return issue("error", code ? ISSUES.error.text + " " + code : "")
  return issue("stale")
}

function isNoVendors(stderr) {
  return /no vendors enabled/i.test(String(stderr || ""))
}

function hexDistance(a, b) {
  function rgb(h) { return [1, 3, 5].map(function(i) { return parseInt(h.substr(i, 2), 16) }) }
  var x = rgb(a), y = rgb(b)
  return Math.sqrt(Math.pow(x[0] - y[0], 2) + Math.pow(x[1] - y[1], 2) + Math.pow(x[2] - y[2], 2))
}

// Some themes have no orange and a yellow that is barely different from the
// text color; a warning that looks like normal text is worse than the accent.
function warningColor(found, foreground, accent) {
  if (found.orange) return found.orange
  if (found.yellow && hexDistance(found.yellow, foreground) >= 60) return found.yellow
  return accent
}
