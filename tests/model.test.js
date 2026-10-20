const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadQmlJs } = require('./load-qml-js')

const Model = loadQmlJs('Model.js')
const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures/usage.json'), 'utf8')
const NOW = Date.parse('2026-10-20T08:40:00Z')
const WEEK = 604800

function byId(entries, id) {
  return entries.find((e) => e.id === id)
}

function win(percent, elapsed, secs = WEEK) {
  return { label: 'w', percent, windowSecs: secs, resetAt: NOW + (1 - elapsed) * secs * 1000 }
}

function usageWith(metrics, extra = {}) {
  return JSON.stringify({ schema_version: 1, entries: [Object.assign({ id: 'anthropic', display_name: 'Claude', plan: 'Claude Max 20x', metrics }, extra)] })
}

test('parseUsage reads the four fixture providers with display names', () => {
  const r = Model.parseUsage(FIXTURE)
  assert.equal(r.ok, true)
  assert.deepEqual(r.entries.map((e) => e.id), ['anthropic', 'openai', 'supergrok', 'antigravity'])
  assert.deepEqual(r.entries.map((e) => e.name), ['Claude', 'Codex', 'Grok', 'Antigravity'])
})

test('resolveEntry picks weekly and session for Claude', () => {
  const claude = byId(Model.parseUsage(FIXTURE).entries, 'anthropic')
  const r = Model.resolveEntry(claude, NOW)
  assert.equal(r.weekly.label, 'Weekly (7d)')
  assert.equal(r.weekly.percent, 49)
  assert.equal(r.short.label, 'Session (5h)')
  assert.equal(r.short.percent, 11)
  assert.equal(r.short.windowSecs, 18000)
})

test('Codex and Grok have no short window and Grok breakdown is not picked', () => {
  const entries = Model.parseUsage(FIXTURE).entries
  assert.equal(Model.resolveEntry(byId(entries, 'openai'), NOW).short, null)
  const grok = Model.resolveEntry(byId(entries, 'supergrok'), NOW)
  assert.equal(grok.short, null)
  assert.equal(grok.weekly.label, 'Weekly usage')
})

test('Antigravity weekly is a shared window, not the exhausted Argon pool', () => {
  const agy = Model.resolveEntry(byId(Model.parseUsage(FIXTURE).entries, 'antigravity'), NOW)
  assert.notEqual(agy.weekly.label, 'Gemini 4 Argon')
  assert.equal(Model.windowState(agy.weekly, NOW).state, 'normal')
})

test('windowState thresholds', () => {
  assert.equal(Model.windowState(win(0, 0.5), NOW).state, 'normal')
  const half = Model.windowState(win(50, 0.5), NOW)
  assert.equal(half.projected, 100)
  assert.equal(half.state, 'danger')
  assert.equal(Model.windowState(win(43, 0.5), NOW).state, 'warning')
  assert.equal(Model.windowState(win(42, 0.5), NOW).state, 'normal')
  assert.equal(Model.windowState(win(42.5, 0.5), NOW).state, 'warning')
  assert.equal(Model.windowState(win(42.45, 0.5), NOW).state, 'normal')
  assert.equal(Model.windowState(win(49.95, 0.5), NOW).state, 'warning')
})

test('windowState floors elapsed at 10%', () => {
  const s = Model.windowState(win(5, 0.01), NOW)
  assert.equal(s.projected, 50)
  assert.equal(s.state, 'normal')
})

test('windowState at 100% is danger regardless of time', () => {
  assert.equal(Model.windowState(win(100, 0.99), NOW).state, 'danger')
})

test('windowState after reset is zero and normal with unknown time', () => {
  const s = Model.windowState({ label: 'w', percent: 80, windowSecs: WEEK, resetAt: NOW - 1000 }, NOW)
  assert.equal(s.percent, 0)
  assert.equal(s.state, 'normal')
  assert.equal(s.remainingMs, null)
})

test('parseUsage rejects bad input', () => {
  for (const text of ['', '{', '{"schema_version":2}']) {
    const r = Model.parseUsage(text)
    assert.equal(r.ok, false, text)
    assert.ok(r.error.length > 0, text)
    assert.deepEqual(r.entries, [])
  }
})

test('entry with error and no metrics is kept so its problem shows, stale entry is kept', () => {
  const text = JSON.stringify({ schema_version: 1, entries: [
    { id: 'openai', display_name: 'Codex', error: 'boom', metrics: [] },
    { id: 'anthropic', display_name: 'Claude', stale: true, metrics: [{ label: 'Weekly', percent: 10, reset_at: '2026-10-22T09:00:00Z', window_secs: WEEK }] },
    { id: 'copilot', display_name: 'GitHub Copilot', metrics: [] }
  ] })
  const r = Model.parseUsage(text)
  assert.deepEqual(r.entries.map((e) => e.id), ['openai', 'anthropic'])
  assert.equal(r.entries[0].error, 'boom')
  assert.deepEqual(Model.resolveEntry(r.entries[0], NOW), { weekly: null, short: null })
  assert.equal(r.entries[1].stale, true)
})

test('entry with error but metrics keeps the error', () => {
  const r = Model.parseUsage(usageWith([{ label: 'Weekly', percent: 10, reset_at: '2026-10-22T09:00:00Z', window_secs: WEEK }], { error: 'stale token' }))
  assert.equal(r.entries[0].error, 'stale token')
})

test('unknown provider uses its display_name and a private-use glyph', () => {
  const text = JSON.stringify({ schema_version: 1, entries: [
    { id: 'copilot', display_name: 'GitHub Copilot', icon: '\u{F02A4}', metrics: [{ label: 'Premium', percent: 5, reset_at: '2026-11-01T00:00:00Z', window_secs: 2592000 }] },
    { id: 'kiro', display_name: 'Kiro', icon: 'kiro', metrics: [{ label: 'Month', percent: 5, reset_at: '2026-11-01T00:00:00Z', window_secs: 2592000 }] }
  ] })
  const r = Model.parseUsage(text)
  assert.equal(r.entries[0].name, 'GitHub Copilot')
  assert.equal(r.entries[0].glyph, '\u{F02A4}')
  assert.equal(r.entries[1].glyph, '')
})

test('tie in state is broken by higher projection', () => {
  const metrics = [
    { label: 'A', percent: 20, reset_at: new Date(NOW + WEEK * 500).toISOString(), window_secs: WEEK },
    { label: 'B', percent: 30, reset_at: new Date(NOW + WEEK * 500).toISOString(), window_secs: WEEK }
  ]
  const entry = Model.parseUsage(usageWith(metrics)).entries[0]
  assert.equal(Model.resolveEntry(entry, NOW).weekly.label, 'B')
})

test('expired dominant metric yields to a still-limited one on re-resolve', () => {
  const later = NOW + 3600e3
  const metrics = [
    { label: 'Expiring', percent: 100, reset_at: new Date(NOW + 1800e3).toISOString(), window_secs: WEEK },
    { label: 'Other', percent: 40, reset_at: new Date(NOW + WEEK * 500).toISOString(), window_secs: WEEK }
  ]
  const entry = Model.parseUsage(usageWith(metrics)).entries[0]
  assert.equal(Model.resolveEntry(entry, NOW).weekly.label, 'Expiring')
  assert.equal(Model.resolveEntry(entry, later).weekly.label, 'Other')
})

test('invalid percents are excluded and valid ones clamped', () => {
  const reset = '2026-10-22T09:00:00Z'
  const metrics = [
    { label: 'null', percent: null, reset_at: reset, window_secs: WEEK },
    { label: 'string', percent: '50', reset_at: reset, window_secs: WEEK },
    { label: 'huge', percent: 1e400, reset_at: reset, window_secs: WEEK },
    { label: 'over', percent: 140, reset_at: reset, window_secs: 18000 },
    { label: 'neg', percent: -5, reset_at: reset, window_secs: WEEK }
  ]
  const entry = Model.parseUsage(usageWith(metrics)).entries[0]
  assert.deepEqual(entry.candidates.long.map((w) => w.label), ['neg'])
  assert.equal(entry.candidates.long[0].percent, 0)
  assert.equal(entry.candidates.short[0].percent, 100)
})

test('grouped breakdown metrics are ignored', () => {
  const metrics = [{ label: 'Grok Bot', percent: 27, reset_at: null, group: 'Breakdown' }]
  assert.equal(Model.parseUsage(usageWith(metrics)).entries.length, 0)
})

test('a metric with a reset but no window length is kept without pace', () => {
  const reset = new Date(NOW + 10 * 86400e3).toISOString()
  const entry = Model.parseUsage(usageWith([{ label: 'Premium requests', percent: 90, reset_at: reset }])).entries[0]
  const w = Model.resolveEntry(entry, NOW).weekly
  assert.equal(w.label, 'Premium requests')
  assert.equal(w.windowSecs, null)
  const s = Model.windowState(w, NOW)
  assert.equal(s.state, 'warning')
  assert.equal(s.elapsed, null)
  assert.equal(s.remainingMs, 10 * 86400e3)
})

test('a paceless metric is judged on the percentage alone', () => {
  const w = (percent) => ({ label: 'p', percent, windowSecs: null, resetAt: null })
  assert.equal(Model.windowState(w(84), NOW).state, 'normal')
  assert.equal(Model.windowState(w(85), NOW).state, 'warning')
  assert.equal(Model.windowState(w(100), NOW).state, 'danger')
  assert.equal(Model.windowState(w(50), NOW).remainingMs, null)
})

test('a zero quota is not a limit (Copilot Free premium requests)', () => {
  const entry = Model.parseUsage(usageWith([
    { label: 'Premium requests', percent: 100, detail: '0 of 0 used', reset_at: '2026-11-01T00:00:00Z' },
    { label: 'Chat', percent: 3, detail: '6 of 200 used', reset_at: '2026-11-01T00:00:00Z' }
  ])).entries[0]
  assert.equal(Model.resolveEntry(entry, NOW).weekly.label, 'Chat')
})

test('windowed metrics win over paceless ones', () => {
  const reset = new Date(NOW + WEEK * 500).toISOString()
  const entry = Model.parseUsage(usageWith([
    { label: 'Balance', percent: 99 },
    { label: 'Weekly', percent: 10, reset_at: reset, window_secs: WEEK }
  ])).entries[0]
  assert.equal(Model.resolveEntry(entry, NOW).weekly.label, 'Weekly')
})

test('model pools count only when no shared window exists', () => {
  const reset = new Date(NOW + WEEK * 500).toISOString()
  const shared = { label: 'Gemini', percent: 0, reset_at: reset, window_secs: WEEK }
  const pool = { label: 'Gemini 4 Argon', percent: 100, reset_at: reset, window_secs: WEEK, model_pool: true }
  assert.equal(Model.resolveEntry(Model.parseUsage(usageWith([shared, pool])).entries[0], NOW).weekly.label, 'Gemini')
  assert.equal(Model.resolveEntry(Model.parseUsage(usageWith([pool])).entries[0], NOW).weekly.label, 'Gemini 4 Argon')
})

test('named accounts keep the vendor look and order', () => {
  const text = JSON.stringify({ schema_version: 1, entries: [
    { id: 'openai', display_name: 'Codex', plan: 'ChatGPT Pro', metrics: [{ label: 'W', percent: 1, reset_at: '2026-10-27T00:00:00Z', window_secs: WEEK }] },
    { id: 'anthropic@work', display_name: 'Claude (work)', plan: 'Claude Max 5x', metrics: [{ label: 'W', percent: 1, reset_at: '2026-10-27T00:00:00Z', window_secs: WEEK }] }
  ] })
  const entries = Model.parseUsage(text).entries
  const work = byId(entries, 'anthropic@work')
  assert.equal(work.vendor, 'anthropic')
  assert.equal(work.icon, 'claude')
  assert.equal(work.name, 'Claude (work)')
  assert.deepEqual(Model.sortEntries(entries, ['anthropic', 'openai']).map((e) => e.id), ['anthropic@work', 'openai'])
})

const VENDORS = fs.readFileSync(path.join(__dirname, 'fixtures/vendors.json'), 'utf8')
const ENTRIES = Model.parseUsage(FIXTURE).entries
const DAY = 86400e3
const HOUR = 3600e3

test('planPrice follows the subscription table', () => {
  assert.equal(Model.planPrice('Claude Max 20x'), 200)
  assert.equal(Model.planPrice('ChatGPT Pro'), 200)
  assert.equal(Model.planPrice('SuperGrok Plus'), 30)
  assert.equal(Model.planPrice('SuperGrok Heavy'), 300)
  assert.equal(Model.planPrice('Claude Max 5x'), 100)
  assert.equal(Model.planPrice('Copilot Pro+'), 40)
  assert.equal(Model.planPrice('Copilot Pro'), 10)
  assert.equal(Model.planPrice('Google AI Ultra'), 250)
  assert.equal(Model.planPrice('Antigravity'), 0)
  assert.equal(Model.planPrice(''), 0)
})

test('sortEntries defaults to price then known order', () => {
  assert.deepEqual(Model.sortEntries(ENTRIES).map((e) => e.id), ['anthropic', 'openai', 'supergrok', 'antigravity'])
})

test('sortEntries honours providerOrder and appends the rest', () => {
  assert.deepEqual(Model.sortEntries(ENTRIES, ['antigravity', 'gone', 'openai']).map((e) => e.id),
    ['antigravity', 'openai', 'anthropic', 'supergrok'])
})

test('sortEntries puts unknown cheap providers last alphabetically', () => {
  const extra = [{ id: 'zeta', name: 'Zeta', plan: '' }, { id: 'alpha', name: 'Alpha', plan: '' }]
  assert.deepEqual(Model.sortEntries(ENTRIES.concat(extra)).map((e) => e.id).slice(3),
    ['antigravity', 'alpha', 'zeta'])
})

test('formatShort and formatLong', () => {
  assert.equal(Model.formatShort(2 * DAY + 2 * HOUR), '2d02h')
  assert.equal(Model.formatShort(4 * HOUR + 37 * 60e3), '4h37m')
  assert.equal(Model.formatShort(59e3), '0h00m')
  assert.equal(Model.formatShort(null), '--')
  assert.equal(Model.formatLong(2 * DAY + 2 * HOUR), '2d 2h')
  assert.equal(Model.formatLong(4 * HOUR + 37 * 60e3), '4h 37m')
  assert.equal(Model.formatLong(null), '--')
})

test('labelText in both modes', () => {
  const claude = byId(ENTRIES, 'anthropic')
  assert.equal(Model.labelText(claude, 'name', NOW), 'Claude')
  assert.equal(Model.labelText(claude, 'values', NOW), '49%:2d00h')
  const onlyShort = Model.parseUsage(usageWith([{ label: 'S', percent: 3, reset_at: new Date(NOW + HOUR).toISOString(), window_secs: 18000 }])).entries[0]
  assert.equal(Model.labelText(onlyShort, 'values', NOW), 'Claude')
})

test('vendorRows lists configured or enabled vendors with names and plans', () => {
  const rows = Model.vendorRows(VENDORS, ENTRIES)
  assert.deepEqual(rows.map((r) => r.id), ['anthropic', 'openai', 'copilot', 'supergrok', 'grokbot', 'antigravity'])
  assert.equal(byId(rows, 'copilot').name, 'GitHub Copilot')
  assert.equal(byId(rows, 'copilot').enabled, false)
  assert.equal(byId(rows, 'grokbot').name, 'Grok Bot')
  assert.equal(byId(rows, 'anthropic').plan, 'Claude Max 20x')
  assert.deepEqual(Model.vendorRows('nope', ENTRIES), [])
})

test('ignorePatch builds the ai-usagebar settings patch', () => {
  assert.deepEqual(JSON.parse(Model.ignorePatch('copilot', false)), { schema_version: 1, vendors: { copilot: false } })
})

test('moveInOrder moves within bounds only', () => {
  assert.deepEqual(Model.moveInOrder(undefined, ['a', 'b', 'c'], 'c', -1), ['a', 'c', 'b'])
  assert.deepEqual(Model.moveInOrder(['c', 'a'], ['a', 'b', 'c'], 'a', 1), ['c', 'b', 'a'])
  assert.deepEqual(Model.moveInOrder(undefined, ['a', 'b'], 'a', -1), ['a', 'b'])
  assert.deepEqual(Model.moveInOrder(undefined, ['a', 'b'], 'b', 1), ['a', 'b'])
})

test('vendorRows carries the glyph of a live entry', () => {
  const live = [{ id: 'copilot', plan: 'Copilot Pro', glyph: '\u{F02A4}' }]
  const row = byId(Model.vendorRows(VENDORS, live), 'copilot')
  assert.equal(row.glyph, '\u{F02A4}')
  assert.equal(byId(Model.vendorRows(VENDORS, live), 'grokbot').glyph, '')
})

test('enqueueJob dedups only after the last apply', () => {
  const kinds = (q) => q.map((j) => j.kind)
  let q = Model.enqueueJob([], { kind: 'usage' })
  q = Model.enqueueJob(q, { kind: 'usage' })
  assert.deepEqual(kinds(q), ['usage'])
  q = Model.enqueueJob(q, { kind: 'vendors' })
  q = Model.enqueueJob(q, { kind: 'apply', id: 'x' })
  q = Model.enqueueJob(q, { kind: 'vendors' })
  q = Model.enqueueJob(q, { kind: 'usage' })
  assert.deepEqual(kinds(q), ['usage', 'vendors', 'apply', 'vendors', 'usage'])
  q = Model.enqueueJob(q, { kind: 'usage' })
  assert.equal(q.length, 5)
  q = Model.enqueueJob(q, { kind: 'apply', id: 'y' })
  assert.deepEqual(kinds(q).slice(-1), ['apply'])
})

test('a deduplicated job keeps the flags of the one it absorbed', () => {
  let q = Model.enqueueJob([], { kind: 'vendors' })
  q = Model.enqueueJob(q, { kind: 'vendors', endsScan: true })
  assert.equal(q.length, 1)
  assert.equal(q[0].endsScan, true)
  q = Model.enqueueJob(q, { kind: 'vendors' })
  assert.equal(q[0].endsScan, true)
})

test('canMove refuses moves past the edges', () => {
  assert.equal(Model.canMove(['a', 'b'], 'a', -1), false)
  assert.equal(Model.canMove(['a', 'b'], 'b', 1), false)
  assert.equal(Model.canMove(['a', 'b'], 'a', 1), true)
  assert.equal(Model.canMove(['a', 'b'], 'zz', 1), false)
})

test('lineSegments splits track and fill around the now gap', () => {
  assert.deepEqual(Model.lineSegments(100, 40, 60, 2), { track: [[0, 59], [61, 100]], fill: [[0, 40]] })
  assert.deepEqual(Model.lineSegments(100, 80, 60, 2), { track: [[0, 59], [61, 100]], fill: [[0, 59], [61, 80]] })
  assert.deepEqual(Model.lineSegments(100, 80, null, 2), { track: [[0, 100]], fill: [[0, 80]] })
  assert.deepEqual(Model.lineSegments(100, 0, 0.5, 2), { track: [[2, 100]], fill: [] })
})

test('Grok Bot has its own mark, distinct from Grok', () => {
  assert.equal(Model.DISPLAY.grokbot.icon, 'grokbot')
  assert.notEqual(Model.DISPLAY.grokbot.icon, Model.DISPLAY.supergrok.icon)
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'assets', Model.DISPLAY.grokbot.icon + '.svg')))
})

test('Antigravity is named and drawn as itself', () => {
  assert.deepEqual(Model.DISPLAY.antigravity, { name: 'Antigravity', icon: 'antigravity' })
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'assets', 'antigravity.svg')))
})

const ok = { id: 'x', name: 'X', stale: false, error: null }

test('parseDiag reads ai-usagebar last_error and retry_after lines', () => {
  const text = 'anthropic\t429\tRate limited. Please try again later.\t1792497577\nopenai\t\t\t\n'
  const d = Model.parseDiag(text)
  assert.deepEqual(d.anthropic, { code: '429', message: 'Rate limited. Please try again later.', retryAt: 1792497577000 })
  assert.deepEqual(d.openai, { code: '', message: '', retryAt: null })
  assert.deepEqual(Model.parseDiag(''), {})
})

test('issueFor is null for a healthy entry', () => {
  assert.equal(Model.issueFor(ok, null, NOW), null)
})

test('issueFor classifies rate limits with retry time', () => {
  const i = Model.issueFor(Object.assign({}, ok, { stale: true }), { code: '429', message: 'Rate limited', retryAt: NOW + 4 * 60e3 }, NOW)
  assert.deepEqual(i, { kind: 'rate', glyph: '\u{F04C5}', state: 'warning', text: 'rate limited · retry in 4m' })
})

test('issueFor classifies auth problems from code or message', () => {
  const byCode = Model.issueFor(Object.assign({}, ok, { stale: true }), { code: '401', message: '', retryAt: null }, NOW)
  assert.equal(byCode.kind, 'auth')
  assert.equal(byCode.text, 'needs auth')
  assert.equal(byCode.state, 'danger')
  assert.equal(byCode.glyph, '\u{F033E}')
  const byMsg = Model.issueFor(Object.assign({}, ok, { error: "Antigravity's saved Google session expired; open Antigravity to sign in again" }), null, NOW)
  assert.equal(byMsg.kind, 'auth')
})

test('issueFor classifies network failures as offline', () => {
  const i = Model.issueFor(Object.assign({}, ok, { error: 'error sending request: dns error: failed to lookup address' }), null, NOW)
  assert.deepEqual(i, { kind: 'offline', glyph: '\u{F05AA}', state: 'warning', text: 'offline' })
})

test('issueFor falls back to error and to stale data', () => {
  const e = Model.issueFor(Object.assign({}, ok, { error: 'boom' }), { code: '500', message: 'boom', retryAt: null }, NOW)
  assert.deepEqual(e, { kind: 'error', glyph: '\u{F0026}', state: 'danger', text: 'error 500' })
  const s = Model.issueFor(Object.assign({}, ok, { stale: true }), null, NOW)
  assert.deepEqual(s, { kind: 'stale', glyph: '\u{F05CE}', state: 'warning', text: 'stale data' })
})

test('issueFor uses a global failure message when the snapshot is stale', () => {
  const i = Model.issueFor(ok, null, NOW, 'ai-usagebar usage timed out')
  assert.equal(i.kind, 'offline')
})

test('formatRetry is compact', () => {
  assert.equal(Model.formatRetry(4 * 60e3), '4m')
  assert.equal(Model.formatRetry(30e3), '1m')
  assert.equal(Model.formatRetry(2 * HOUR + 5 * 60e3), '2h 5m')
})

test('network failures read as offline even when the message mentions OAuth', () => {
  const i = Model.issueFor(Object.assign({}, ok, { error: 'OAuth refresh failed: network unreachable' }), null, NOW)
  assert.equal(i.kind, 'offline')
})

test('isNoVendors recognizes ai-usagebar with nothing enabled', () => {
  assert.equal(Model.isNoVendors('Error: no vendors enabled in /home/x/.config/ai-usagebar/config.toml'), true)
  assert.equal(Model.isNoVendors('boom'), false)
})

test('warningColor prefers orange, then a yellow that stands out, then accent', () => {
  assert.equal(Model.warningColor({ orange: '#a79a58', yellow: '#91c843' }, '#b5b9ae', '#8ec641'), '#a79a58')
  assert.equal(Model.warningColor({ yellow: '#d8a657' }, '#d4be98', '#7daea3'), '#d8a657')
  assert.equal(Model.warningColor({ yellow: '#d9dbdc' }, '#dadbdc', '#5e81ac'), '#5e81ac')
  assert.equal(Model.warningColor({}, '#ffffff', '#123456'), '#123456')
})
