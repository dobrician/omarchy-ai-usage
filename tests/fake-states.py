# Usage payload with every pace state, times relative to now.
import json, sys, datetime as dt
now = dt.datetime.now(dt.timezone.utc)
def m(label, percent, elapsed, secs):
    reset = now + dt.timedelta(seconds=(1 - elapsed) * secs)
    return {"label": label, "percent": percent, "reset_at": reset.isoformat().replace("+00:00", "Z"), "window_secs": secs}
W, S = 604800, 18000
if sys.argv[1:] == ["preview"]:
    print(json.dumps({"schema_version": 1, "entries": [
        {"id": "anthropic", "display_name": "Claude", "plan": "Claude Max 20x", "metrics": [m("Session (5h)", 78, 0.45, S), m("Weekly (7d)", 52, 0.69, W)]},
        {"id": "openai", "display_name": "Codex", "plan": "ChatGPT Pro", "metrics": [m("Codex weekly", 31, 0.34, W)]},
        {"id": "supergrok", "display_name": "SuperGrok", "plan": "SuperGrok Plus", "metrics": [m("Weekly usage", 37, 0.84, W)]},
        {"id": "grokbot", "display_name": "Grok Bot", "plan": "Grok Bot Plan", "metrics": [m("Weekly", 22, 0.84, W)]},
        {"id": "antigravity", "display_name": "Antigravity", "plan": "Antigravity", "metrics": [m("Gemini", 55, 0.6, S), m("Gemini", 18, 0.47, W)]}
    ]}))
    sys.exit(0)
print(json.dumps({"schema_version": 1, "entries": [
    {"id": "anthropic", "display_name": "Claude", "plan": "Claude Max 20x", "metrics": [m("Session (5h)", 80, 0.45, S), m("Weekly (7d)", 47, 0.69, W)]},
    {"id": "openai", "display_name": "Codex", "plan": "ChatGPT Pro", "metrics": [m("Codex weekly", 33, 0.36, W)]},
    {"id": "supergrok", "display_name": "SuperGrok", "plan": "SuperGrok Plus", "metrics": [m("Weekly usage", 36, 0.84, W)]},
    {"id": "antigravity", "display_name": "Antigravity", "plan": "Antigravity", "metrics": [m("Gemini", 57, 0.6, S), m("Gemini", 40, 0.47, W)]},
    {"id": "copilot", "display_name": "GitHub Copilot", "plan": "Copilot Pro", "icon": "\U000f02a4", "error": "token expired", "metrics": [m("Premium", 10, 0.5, 2592000)]},
    {"id": "kimi", "display_name": "Kimi", "plan": "", "icon": "\U000f0e1b", "stale": True, "metrics": [m("Weekly", 20, 0.5, W)]},
    {"id": "opencode-go", "display_name": "OpenCode Go", "plan": "OpenCode Go", "error": "error sending request: dns error", "metrics": []}
]}))
