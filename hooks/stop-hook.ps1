# Claude Code Stop hook (Windows): when Claude finishes a response, the desktop pet shows a speech bubble.
# Same behaviour as stop-hook.py. Works with Windows PowerShell 5.1 (built in) and PowerShell 7.
# Reads the hook's JSON on stdin; never fails the hook (the pet may simply not be running).
$ErrorActionPreference = "SilentlyContinue"
[Console]::InputEncoding = [Text.Encoding]::UTF8  # Claude Code sends UTF-8; the default code page would garble Korean

$hook = $null
try { $hook = [Console]::In.ReadToEnd() | ConvertFrom-Json } catch { }

$cwd = if ($hook -and $hook.cwd) { $hook.cwd } else { (Get-Location).Path }
$project = Split-Path -Leaf $cwd
if (-not $project) { $project = "Claude Code" }

$message = "응답을 마쳤어요"
if ($hook -and $hook.last_assistant_message) {
  foreach ($line in ($hook.last_assistant_message -split "`r?`n")) {
    $t = $line.Trim(" #*>-".ToCharArray())
    if ($t) { $message = if ($t.Length -gt 200) { $t.Substring(0, 200) } else { $t }; break }
  }
}

try {
  $token = (Get-Content -Raw -Encoding UTF8 (Join-Path $HOME ".pet\token")).Trim()
  $body = @{
    jsonrpc = "2.0"; id = 1; method = "tools/call"
    params = @{ name = "notify"; arguments = @{ title = "$project · 응답 완료"; message = $message; level = "info"; source = "Claude Code" } }
  } | ConvertTo-Json -Depth 5 -Compress
  Invoke-RestMethod -Uri "http://127.0.0.1:7878/mcp" -Method Post -TimeoutSec 3 `
    -Headers @{ Authorization = "Bearer $token"; Accept = "application/json, text/event-stream" } `
    -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($body)) | Out-Null
} catch { }
exit 0
