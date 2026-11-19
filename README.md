# desktop-pet — 초승달 흑묘

Tauri 2 + TypeScript(Vanilla)로 만든 macOS 데스크톱 펫. 시크하고 귀찮음 많은 검은 고양이가 화면 위를 느릿느릿 돌아다니고,
MCP 서버가 내장되어 있어 Claude Code 같은 도구가 `notify`를 호출하면 말풍선으로 알려줍니다.

> **그냥 쓰고 싶다면** → [INSTALL.md](INSTALL.md) (설치 파일 받기, Claude Code 연결, 답할 때마다 말풍선 띄우기)
>
> **이어서 개발하려면** → [DEVELOPMENT.md](DEVELOPMENT.md) (구조, 명령어, 함정, AI 에이전트 규칙)

## 실행

```bash
npm install
npm run tauri dev
```

필요한 것: Node 22+ (nvm이면 `nvm use` — `.nvmrc` 참고), Rust(rustup), Xcode Command Line Tools.
`tauri dev`/`tauri build`가 먼저 MCP 사이드카 바이너리를 빌드합니다(`npm run build:sidecar`).

### 설치해서 계속 쓰기

```bash
npm run tauri build
```

`src-tauri/target/release/bundle/dmg/desktop-pet_0.1.0_aarch64.dmg`를 열어 `desktop-pet.app`을 응용 프로그램 폴더로 옮기면 됩니다.

- 설치한 앱은 처음 실행할 때 **로그인 시 자동 실행**이 켜집니다. 메뉴 막대 아이콘 → `로그인 시 자동 실행`으로 끄고 켤 수 있습니다(개발 모드에서는 자동으로 등록하지 않음).
- 서명은 이 Mac용 임시(ad-hoc) 서명입니다. 다른 Mac에 배포하려면 Apple Developer ID로 서명하고 공증(notarize)해야 Gatekeeper 경고가 뜨지 않습니다.
- MCP 서버가 멈추면(예: 7878 포트를 다른 프로그램이 사용 중) 메뉴 막대 아이콘 옆에 `!`가 뜨고, 툴팁에 이유가 나옵니다. 그 프로그램을 끄고 앱을 다시 켜면 됩니다(`lsof -iTCP:7878 -sTCP:LISTEN`으로 확인).

## 조작

| 동작 | 결과 |
|---|---|
| 고양이 드래그 | 들어서 옮기기. 놓은 높이가 새 바닥이 됨 |
| 한 번 클릭 | 귀를 젖히고 0.5초 째려봄 |
| 간격을 두고 3번 클릭 (2.5초 안) | 삐쳐서 등 돌리고 앉음 |
| **더블클릭** | **알림함 열기** |
| 말풍선 클릭 | 말풍선 닫기 |
| 메뉴바 고양이 아이콘 | 알림함 열기 / 종료 (아이콘 옆 숫자 = 안 읽은 알림 수) |

펫은 평소 Dock에 보이지 않고, 알림함이 열려 있는 동안에만 Dock과 Cmd+Tab에 나타납니다. 알림함 창을 닫으면 숨겨질 뿐 앱은 계속 돌아갑니다.

> 메뉴바 아이콘이 안 보이면: 메뉴바 아이템이 많은 노치 MacBook에서는 새 아이콘이 노치 뒤로 밀려 가려집니다.
> ⌘를 누른 채 다른 아이콘을 메뉴바 밖으로 끌어 빼거나, 메뉴바 정리 앱을 쓰세요. 그동안은 고양이 더블클릭으로 알림함을 열 수 있습니다.

## 알림함

솔루션(`source`)별로 받은 알림을 모아 보는 창입니다.

- 왼쪽: 솔루션 목록과 안 읽은 개수. `source` 없이 온 알림은 "기타"로 묶임
- 위쪽: 레벨 필터(정보·성공·경고·오류), **모두 읽음**, **지우기**(한 번 더 눌러 확인). 둘 다 지금 화면에 보이는 알림에만 적용
- 알림 클릭: 읽음 처리 + 전체 내용 펼치기. 마우스를 올리면 나오는 `×`로 하나씩 삭제
- 안 읽은 알림이 새로 오면 고양이 머리 옆에 점이 붙음(가장 심각한 레벨 색). 알림함을 열면 사라짐
- 라이트/다크 모드는 시스템 설정을 따름

알림은 `~/.pet/notifications.json`에 최근 500개까지 저장되어 앱을 다시 켜도 남습니다(파일 권한 600).

## MCP 서버

| 항목 | 값 |
|---|---|
| 전송 방식 | Streamable HTTP (stateless, JSON 응답) |
| 주소 | `http://127.0.0.1:7878/mcp` (127.0.0.1에만 바인딩) |
| 인증 | `Authorization: Bearer <토큰>` 필수. 없거나 틀리면 `401` |
| 토큰 | 처음 실행할 때 생성해 `~/.pet/token`에 저장하고 계속 사용 (디렉터리 700, 파일 600). 바꾸려면 파일을 지우고 앱을 다시 켜기 |
| 추가 보호 | `Host` 헤더가 `127.0.0.1:7878` / `localhost:7878`이 아니면 `403` (DNS rebinding 방지) |

### 툴

| 이름 | 입력 | 반환 |
|---|---|---|
| `notify` | `title`(필수), `message`(필수), `level`: `info`·`success`·`warning`·`error`(기본 `info`), `source`(선택) | `{ id, receivedAt }` |
| `list_notifications` | 없음 | `{ notifications }` — 최근 20개, 최신순 (`read` 포함) |
| `clear_notifications` | 없음 | `{ cleared }` — 저장된 알림 전부 삭제, 말풍선도 닫힘 |

#### 고양이 반응 (level별)

시크한 성격은 그대로, level이 높을수록 티가 조금 더 납니다.

| level | 반응 |
|---|---|
| `info` | 귀만 쫑긋 → 고개만 말풍선 쪽으로. 몸은 꼼짝 안 함 |
| `success` | 눈을 살짝 크게 뜨고 꼬리를 위로 쭉 세움. 가슴 초승달이 0.6초 반짝 |
| `warning` | 반쯤 감긴 눈이 동그랗게 다 뜨이고, 꼬리 털이 부풀어 굵어짐 |
| `error` | 털이 곤두서고(외곽선 들쭉날쭉) 화면 중앙으로 빠르게(120px/s) 걸어와서 알림. 초승달이 빨갛게 점멸 |

| 그때 고양이가… | 반응 |
|---|---|
| 자는 중 | 화들짝 점프(눈 동그래짐) → 잠깐 멍 → 위 반응 |
| 등 돌리고 앉은(loaf) 중 | 귀찮다는 듯 고개만 돌려 뒤돌아봄. 말풍선이 닫히면 다시 삐침 |
| 들려 있는(drag) 중 | 큐에 넣었다가 착지 후 표시 |

#### 말풍선

- 고양이 머리 옆에 표시(화면 오른쪽 절반에 있으면 왼쪽에). 캐릭터와 같은 굵은 검은 외곽선 + level 색 안쪽 테두리
  (`info` #6FA8DC · `success` #8BC34A · `warning` #F2C14E · `error` #E06666)
- 제목은 굵게, 내용은 2줄까지. 잘린 내용은 클릭하면 펼쳐지고, 한 번 더 클릭하거나 `×`를 누르면 닫힘
- 8초 후 자동으로 닫힘. **`error`는 직접 닫을 때까지 남아 있음**
- 여러 개가 한꺼번에 오면 하나씩 차례로 반응하고, 남은 개수는 귀 옆의 초승달 배지에 표시

### Claude Code에 연결

토큰은 앱을 다시 켜도 그대로입니다. 고정 헤더로 한 번만 등록하면 됩니다.

```bash
claude mcp add -s user --transport http pet http://127.0.0.1:7878/mcp --header "Authorization: Bearer $(cat ~/.pet/token)"
```

토큰을 바꿀 수도 있다면(파일 삭제 후 재시작) `headersHelper`로 연결할 때마다 파일을 읽게 해 두면 다시 등록할 필요가 없습니다.

```bash
claude mcp add-json -s user pet '{"type":"http","url":"http://127.0.0.1:7878/mcp","headersHelper":"echo \"{\\\"Authorization\\\": \\\"Bearer $(cat ~/.pet/token)\\\"}\""}'
```

> 헤더 없이 `claude mcp add -s user --transport http pet http://127.0.0.1:7878/mcp`만 실행하면 서버가 `401`로 거부합니다.

연결 후 Claude Code에서 "작업 끝나면 pet으로 알려줘"처럼 요청하면 `notify`가 호출됩니다.

### curl로 테스트

```bash
TOKEN=$(cat ~/.pet/token)
```

알림 보내기:

```bash
curl -s http://127.0.0.1:7878/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"notify","arguments":{"title":"빌드 완료","message":"테스트 12개 통과","level":"success","source":"curl"}}}'
```

최근 알림 조회:

```bash
curl -s http://127.0.0.1:7878/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_notifications","arguments":{}}}'
```

모두 지우기:

```bash
curl -s http://127.0.0.1:7878/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"clear_notifications","arguments":{}}}'
```

토큰 없이 보내면 `401`이 나오는지 확인:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:7878/mcp -d '{}'
```

공식 SDK 클라이언트(Claude Code와 같은 전송 방식)로 한 번에 점검하려면, 펫을 켠 상태에서:

```bash
node tools/check-mcp.mjs
```

## Windows

같은 코드로 Windows 10/11에서도 돌아갑니다. 플랫폼마다 다른 부분은 이렇습니다.

| | macOS | Windows |
|---|---|---|
| 앱 아이콘 | Dock에 안 보임 (알림함 열 때만 표시) | 작업표시줄에 안 보임 (알림함 창은 보임) |
| 트레이 | 메뉴바 검은 실루엣 + 옆에 안 읽은 개수 | 흰 고양이 머리 아이콘, 안 읽은 개수는 툴팁 |
| 좌표 | 포인트(논리) 단위 | 물리 픽셀 기준 — 모니터마다 배율이 달라도(150% + 100%) 순간이동 없음 |
| 토큰 파일 | 권한 600 | 사용자 폴더 기본 권한(본인만 접근)을 따름 |
| MCP 서버 중지 표시 | 메뉴바 아이콘 옆 `!` | 트레이 아이콘에 빨간 점 (이유는 툴팁) |
| 로그인 시 자동 실행 | LaunchAgent | 레지스트리 `Run` 키 (현재 사용자) |

### Windows에서 실행

필요한 것: Node 22+, Rust(rustup, MSVC 툴체인), Visual Studio Build Tools("C++를 사용한 데스크톱 개발"), WebView2(Windows 10/11에는 기본 설치).

```powershell
npm install
npm run tauri dev
```

설치 파일(MSI, setup.exe)은 `npm run tauri build`로 만들거나, GitHub에 올린 뒤 Actions의 **windows build**를 실행하면 아티팩트로 받을 수 있습니다(`.github/workflows/windows.yml`).
설치 파일은 서명되지 않아서 처음 실행할 때 SmartScreen이 "Windows의 PC 보호"를 띄웁니다. **추가 정보 → 실행**을 누르면 됩니다. 여러 PC에 배포하려면 코드 서명 인증서로 `signtool` 서명을 하세요(사이드카 exe도 node.exe를 바탕으로 만들어서 원래 서명이 깨지므로 같이 서명).

### PowerShell 예시

토큰 읽기:

```powershell
$token = (Get-Content $HOME\.pet\token).Trim()
```

알림 보내기 (한글이 깨지지 않게 UTF-8로 보냄):

```powershell
$body = @{ jsonrpc = "2.0"; id = 1; method = "tools/call"; params = @{ name = "notify"; arguments = @{ title = "빌드 완료"; message = "테스트 통과"; level = "success"; source = "PowerShell" } } } | ConvertTo-Json -Depth 5
Invoke-RestMethod http://127.0.0.1:7878/mcp -Method Post -Headers @{ Authorization = "Bearer $token"; Accept = "application/json, text/event-stream" } -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($body))
```

Claude Code 연결 (한 번만 등록하면 됨, `-s user`라 어느 폴더에서든 사용):

```powershell
claude mcp add -s user --transport http pet http://127.0.0.1:7878/mcp --header "Authorization: Bearer $((Get-Content $HOME\.pet\token).Trim())"
```

## 구조

```
sidecar/server.ts        MCP 서버 (공식 TypeScript SDK) + 알림 저장소(유일한 쓰기 주체).
                         stdout → 앱: notify/clear/state, stdin ← 앱: read/delete/clear
tools/build-sidecar.mjs  server.ts → 단일 실행 파일(Node SEA) → src-tauri/binaries/pet-mcp-<target>[.exe] (macOS·Windows·Linux)
src-tauri/src/lib.rs     사이드카 실행·중계, 알림함 창 열기/숨기기(Dock 표시 전환), 메뉴바 아이콘
src/main.ts              펫 창: 드래그·클릭/더블클릭·클릭 통과·게임 루프, 알림 → 반응 + 말풍선 + 안 읽음 점
inbox.html, src/inbox.ts 알림함 창
src/brain.ts             행동 상태 머신 (idle, walk, sit, groom, yawn, loaf, sleep, notice, drag/fall/land …)
src/rig.ts               포즈를 파츠별 SVG에 적용
src/bubble.ts            알림 말풍선 (큐, 자동 닫힘, 클릭 닫기)
src/config.ts            모든 수치 (속도·각도·확률·시간·창 크기)
src/assets/cat-*.svg     파츠 분리된 정면/측면/뒷모습 (tools/trace_reference.py로 생성)
gallery.html, src/gallery.ts  행동 갤러리: 모든 행동을 실제 코드로 반복 재생 (dev 서버 실행 중 http://localhost:1420/gallery.html, ?at=초 로 특정 순간 고정)
assets/reference/        캐릭터 참조 이미지
tools/check_schedule.ts  행동 스케줄러 자체 점검: node --experimental-strip-types tools/check_schedule.ts
tools/check_screens.ts   모니터 판별 자체 점검:   node --experimental-strip-types tools/check_screens.ts
src/screens.ts           고양이가 있는 모니터 고르기
```

사이드카는 앱이 stdin을 열어 두는 동안만 살아 있습니다. 앱이 비정상 종료돼도 stdin이 닫히면 같이 종료되므로, 7878 포트를 붙잡은 고아 프로세스가 남지 않습니다.
