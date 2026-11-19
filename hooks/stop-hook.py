#!/usr/bin/env python3
# Claude Code Stop hook: when Claude finishes a response, the desktop pet shows a speech bubble.
# Reads the hook's JSON on stdin; never fails the hook (the pet may simply not be running).
import json, os, sys, urllib.request

try:
    hook = json.load(sys.stdin)
except Exception:
    hook = {}

project = os.path.basename(hook.get("cwd") or os.getcwd()) or "Claude Code"
reply = (hook.get("last_assistant_message") or "").strip()
first = next((l.strip(" #*>-") for l in reply.splitlines() if l.strip(" #*>-")), "")
message = first[:200] if first else "응답을 마쳤어요"

try:
    token = open(os.path.expanduser("~/.pet/token")).read().strip()
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {
        "name": "notify",
        "arguments": {"title": f"{project} · 응답 완료", "message": message, "level": "info", "source": "Claude Code"},
    }}).encode()
    req = urllib.request.Request("http://127.0.0.1:7878/mcp", data=body, method="POST", headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    })
    urllib.request.urlopen(req, timeout=3).read()
except Exception:
    pass
