# 초승달 흑묘 설치 안내

화면 위를 돌아다니는 검은 고양이예요. Claude Code와 연결하면, 작업이 끝났을 때나 Claude가 알려줄 일이 있을 때 고양이가 말풍선으로 알려줘요.

설치는 세 단계예요. 3단계는 선택이에요.

1. 앱 설치
2. Claude Code에 연결
3. (선택) Claude가 답할 때마다 말풍선 띄우기

설치 파일은 [Releases](https://github.com/devlee0908/desktop-pet/releases) 페이지에서 받으세요.

---

## Windows (10 / 11)

### 1. 앱 설치

1. `desktop-pet_x.x.x_x64-setup.exe`를 받아서 실행해요.
2. **"Windows의 PC 보호"** 창이 뜨면 **추가 정보 → 실행**을 눌러요.
   - 개인이 만든 앱이라 서명이 없어서 뜨는 경고예요.
3. 설치가 끝나면 화면 아래쪽에 고양이가 나타나고, 작업 표시줄 오른쪽 트레이에 고양이 머리 아이콘이 생겨요.
   - 고양이는 다음 로그인부터 자동으로 켜져요. 트레이 아이콘 → **로그인 시 자동 실행**으로 끌 수 있어요.

### 2. Claude Code에 연결

PowerShell을 열고 아래 한 줄을 붙여 넣어요.

```powershell
claude mcp add -s user --transport http pet http://127.0.0.1:7878/mcp --header "Authorization: Bearer $((Get-Content $HOME\.pet\token).Trim())"
```

- 새 Claude Code 세션에서 `/mcp`를 입력했을 때 `pet`이 **connected**로 보이면 성공이에요.
- 그다음 "끝나면 고양이한테 알려줘"라고 부탁하면 돼요.

### 3. (선택) 답할 때마다 말풍선 띄우기

먼저 PowerShell에서 스크립트를 받아요.

```powershell
New-Item -ItemType Directory -Force $HOME\.pet | Out-Null
Invoke-WebRequest https://raw.githubusercontent.com/devlee0908/desktop-pet/main/hooks/stop-hook.ps1 -OutFile $HOME\.pet\stop-hook.ps1
```

그리고 `%USERPROFILE%\.claude\settings.json`에 아래 내용을 넣어요.

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [ { "type": "command", "command": "powershell -NoProfile -ExecutionPolicy Bypass -File \"$HOME/.pet/stop-hook.ps1\"", "timeout": 5, "async": true } ] }
    ]
  }
}
```

> 💡 settings.json이 이미 있으면 직접 고치기보다, Claude Code에 이 안내를 붙여 넣고 "3단계 설정해 줘"라고 하면 기존 설정과 합쳐 줘요.

---

## macOS (Apple Silicon: M1 이상)

### 1. 앱 설치

1. `desktop-pet_x.x.x_aarch64.dmg`를 열고 `desktop-pet`을 **응용 프로그램** 폴더로 끌어다 놓아요.
2. 처음 열면 "확인되지 않은 개발자" 경고가 떠요.
   - **시스템 설정 → 개인정보 보호 및 보안**으로 가서, 아래쪽의 **확인 없이 열기**를 눌러요.
3. 고양이가 나타나고, 메뉴 막대에 고양이 아이콘이 생겨요.
   - 고양이는 다음 로그인부터 자동으로 켜져요. 메뉴 막대 아이콘 → **로그인 시 자동 실행**으로 끌 수 있어요.

> Intel Mac은 아직 지원하지 않아요.

### 2. Claude Code에 연결

터미널에서 아래 한 줄을 실행해요.

```bash
claude mcp add -s user --transport http pet http://127.0.0.1:7878/mcp --header "Authorization: Bearer $(cat ~/.pet/token)"
```

새 Claude Code 세션에서 `/mcp`를 입력했을 때 `pet`이 **connected**로 보이면 성공이에요.

### 3. (선택) 답할 때마다 말풍선 띄우기

먼저 터미널에서 스크립트를 받아요.

```bash
mkdir -p ~/.pet && curl -fsSL https://raw.githubusercontent.com/devlee0908/desktop-pet/main/hooks/stop-hook.py -o ~/.pet/stop-hook.py
```

그리고 `~/.claude/settings.json`에 아래 내용을 넣어요. 이미 파일이 있으면 Windows 쪽 💡처럼 Claude Code에 맡기면 돼요.

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [ { "type": "command", "command": "/usr/bin/python3 \"$HOME/.pet/stop-hook.py\"", "timeout": 5, "async": true } ] }
    ]
  }
}
```

---

## 쓰는 법

| 하고 싶은 것 | 방법 |
|---|---|
| 고양이 옮기기 | 끌어서 놓기 |
| 지난 알림 보기 | 고양이 **더블클릭**, 또는 트레이/메뉴 막대 아이콘 → 알림함 열기 |
| 말풍선 닫기 | 말풍선 클릭 또는 × (긴 내용은 첫 클릭에 펼쳐져요) |
| 종료 | 트레이/메뉴 막대 아이콘 → 종료 |

- **고양이 옆 동그라미**: 아직 안 읽은 알림이 있다는 뜻이에요.
  - 말풍선을 직접 닫거나, 알림함에서 읽거나(**모두 읽음**), 지우면 사라져요.
  - 동그라미 색은 안 읽은 알림 중 가장 심각한 수준이에요(파랑 정보 · 초록 성공 · 노랑 경고 · 빨강 오류).
- **귀 옆 초승달 배지 숫자**: 아직 보여 주지 않고 기다리는 알림 개수예요.

## 문제가 생기면

| 증상 | 해결 |
|---|---|
| `/mcp`에서 `pet`이 연결 안 됨 | 고양이 앱이 켜져 있는지 확인하세요. 켜져 있으면 Claude Code를 다시 시작하세요. |
| 트레이 아이콘에 `!` 또는 빨간 점 | 알림 서버가 멈췄어요. 아이콘에 마우스를 올리면 이유가 보여요. 보통 7878 포트를 다른 프로그램이 쓰고 있어서예요. 그 프로그램을 끄고 고양이 앱을 다시 켜세요. |
| 연결이 갑자기 401로 실패 | `.pet\token` 파일을 지웠다면 토큰이 새로 만들어져요. 2단계 명령을 다시 실행하세요. |
| 고양이를 완전히 지우고 싶음 | 앱을 삭제(Windows: 설정 → 앱, macOS: 응용 프로그램에서 휴지통)하고, 홈 폴더의 `.pet` 폴더를 지우세요. Claude Code 연결은 `claude mcp remove -s user pet`으로 지워요. |
