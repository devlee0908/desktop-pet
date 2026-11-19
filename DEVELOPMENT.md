# DEVELOPMENT.md — desktop-pet 개발 가이드

이 문서는 이 저장소를 받아서 이어서 개발하려는 사람과 그 사람이 쓰는 AI 코딩 에이전트를 위한 문서예요.
처음 받았다면 이 문서를 처음부터 끝까지 읽은 뒤 작업을 시작하세요. 사람도 에이전트도 마찬가지예요.

- 그냥 설치해서 쓰려면 [INSTALL.md](INSTALL.md)를 보세요.
- 기능 소개, MCP 툴 명세, curl/PowerShell 예시는 [README.md](README.md)에 있어요.

---

## 1. 한눈에 보기

**초승달 흑묘**는 Tauri 2 + TypeScript(Vanilla, 프레임워크 없음)로 만든 데스크톱 펫이에요. macOS와 Windows를 지원해요.

- 투명하고 테두리 없는 항상 위 창에 SVG 고양이가 살아요. 고양이 말고 빈 부분은 클릭이 아래 창으로 통과해요.
- 고양이는 상태 머신으로 움직이고, 물리(중력·착지 찌그러짐)가 적용돼요. 상태 예: 숨쉬기, 걷기, 앉기, 세수, 하품, 식빵 자세, 수면, 드래그.
- **MCP 서버**가 내장돼 있어서, Claude Code 같은 MCP 클라이언트가 `notify`를 호출하면 고양이가 반응하고 말풍선을 띄워요.
- 알림은 디스크에 저장되고, 알림함 창(더블클릭/트레이)에서 볼 수 있어요.

```
 MCP 클라이언트 (Claude Code 등)
        │  HTTP POST /mcp  (Bearer 토큰, 127.0.0.1:7878)
        ▼
 ┌──────────────────────────┐   stdout: JSON 한 줄씩 (notify/clear/state/ready/error)
 │ sidecar/server.ts        │ ─────────────────────────────────────────────┐
 │ (Node SEA 단일 실행 파일) │ ◀──── stdin: {op: read|delete|clear} ───┐     │
 │ ~/.pet/notifications.json│                                          │     │
 └──────────────────────────┘                                          │     ▼
                                                          ┌─────────────────────────────┐
                                                          │ src-tauri/src/lib.rs (Rust) │
                                                          │ 사이드카 실행·트레이·명령     │
                                                          └─────────────────────────────┘
                                         "pet-mcp" 이벤트 │      ▲ invoke: inbox_state / inbox_do / open_inbox
                         ┌────────────────────────────────┴──────┴─────────────────┐
                         ▼                                                         ▼
          index.html + src/main.ts (펫 창)                           inbox.html + src/inbox.ts (알림함)
          brain.ts → rig.ts → SVG, bubble.ts, unread.ts
```

---

## 2. 개발 환경 준비

| 필요한 것 | 비고 |
|---|---|
| **Node 22+** | 필수. 사이드카를 Node SEA로 묶어서 22 미만이면 빌드가 멈춰요. nvm이 있으면 `nvm use` (`.nvmrc` = 22) |
| Rust (rustup, stable) | Windows는 MSVC 툴체인 |
| macOS: Xcode Command Line Tools | `xcode-select --install` |
| Windows: Visual Studio Build Tools | "C++를 사용한 데스크톱 개발" 워크로드, WebView2(10/11 기본 포함) |
| (선택) Python 3 + `opencv-python`, `numpy` | 캐릭터 SVG를 다시 생성할 때만 필요해요(§6) |

```bash
git clone https://github.com/devlee0908/desktop-pet.git
cd desktop-pet
nvm use            # Node 22
npm install
npm run tauri dev  # 사이드카 빌드 → Vite(1420) → 앱 실행
```

- `tauri dev`와 `tauri build`는 먼저 `npm run build:sidecar`로 MCP 서버 실행 파일을 만들어요. 결과는 `src-tauri/binaries/pet-mcp-<타깃 트리플>[.exe]`예요.
- 사이드카는 **dev를 시작할 때만** 다시 빌드돼요. `sidecar/server.ts`를 고쳤다면 `tauri dev`를 다시 시작하세요.
- Rust 파일을 고치면 `tauri dev`가 알아서 다시 빌드하고 앱을 재시작해요. TS 파일은 Vite HMR로 반영돼요.

---

## 3. 명령어

| 명령 | 하는 일 |
|---|---|
| `npm run tauri dev` | 개발 실행 |
| `npm run tauri build` | 릴리스 빌드 (macOS: `.app` + `.dmg`, Windows: `.msi` + `setup.exe`) |
| `npm run build:sidecar` | MCP 사이드카만 빌드 |
| `npx tsc --noEmit -p .` | 타입 검사 |
| `node --experimental-strip-types tools/check_unread.ts` | 안 읽음 점 / 알림 대기열 규칙 검사 |
| `node --experimental-strip-types tools/check_schedule.ts` | 행동 스케줄러 가중치·"3연속 금지" 검사 |
| `node --experimental-strip-types tools/check_screens.ts` | 멀티 모니터 좌표 계산 검사 |
| `node tools/check-mcp.mjs` | **실행 중인 앱**에 MCP로 붙어서 notify/list와 토큰 없는 요청 거부를 확인 |
| `http://localhost:1420/gallery.html` | dev 실행 중에 모든 행동을 카드로 반복 재생해요. `?at=2.5`를 붙이면 그 시점으로 빨리 감기 |
| `python tools/trace_reference.py . [front\|side\|back]` | 기준 그림으로 `src/assets/cat-*.svg`를 다시 생성 |

---

## 4. 디렉터리 구조

```
index.html            펫 창 (CSS 변수, 말풍선, 초승달 배지, 안 읽음 점)
inbox.html            알림함 창
gallery.html          개발용 행동 갤러리
src/
  main.ts             펫 창 진입점: 창 위치/모니터, 클릭 통과, 드래그, 알림 대기열, 메인 루프
  brain.ts            상태 머신 + 물리. tick(dt) → Output {frame, view, flip, stage, win, zs, bubble, bubbleSide}
  rig.ts              Frame(관절 값)을 SVG <g>의 CSS transform으로 적용
  config.ts           조정 가능한 숫자 전부 (시간=초, 각도=도, 거리=px)
  schedule.ts         idle 다음 행동 고르기 (가중치, 같은 행동 3연속 금지)
  screens.ts          좌표가 어느 모니터 작업 영역에 있는지 (rectFor)
  bubble.ts           말풍선 (2줄 말줄임, 클릭 펼침, 8초 자동 닫힘, error는 남음)
  unread.ts           안 읽음 점 / 대기열 규칙 (순수 함수)
  inbox.ts            알림함 UI (출처별 묶음, 레벨 필터, 읽음/삭제)
  gallery.ts          갤러리 시나리오
  assets/cat-*.svg    생성된 캐릭터 (직접 고치지 말 것, §6)
sidecar/server.ts     MCP 서버 (Streamable HTTP, stateless) + 알림 저장소 + stdio 프로토콜
src-tauri/
  src/lib.rs          사이드카 실행/종료, 트레이 메뉴·상태, 명령(open_inbox/inbox_state/inbox_do), 자동 실행
  tauri.conf.json     창 2개(main, inbox), 트레이, externalBin
  capabilities/       창 권한
hooks/                Claude Code Stop 훅 (stop-hook.py: macOS, stop-hook.ps1: Windows)
tools/                빌드 스크립트, 검사 스크립트, SVG 트레이서
assets/reference/     캐릭터 기준 그림 (front/side/back.png)
.github/workflows/    Windows 설치 파일 빌드 + Windows에서 사이드카·훅 검사
```

---

## 5. 핵심 흐름

### 5.1 메인 루프 (src/main.ts)

`requestAnimationFrame`마다 아래 순서로 돌아요.

1. `brain.tick(dt)`를 호출해요. dt는 초 단위이고 최대 0.05로 잘라요.
2. 결과 `frame`을 세 뷰(front/side/back)의 rig에 모두 적용해요.
3. `out.view`에 해당하는 뷰만 보이게 해요. 바뀔 때는 0.15초 크로스페이드예요.
4. 걷기 방향에 따라 `rigs.side.flip(out.flip)`으로 측면을 좌우 반전해요.
5. `out.win`으로 창 위치를 옮겨요.
6. `out.stage`로 점프·찌그러짐을 적용해요.
7. 알림 대기열을 진행시켜요(`pumpNotifications`).

**클릭 통과**: 50ms마다 커서 위치에서 `elementFromPoint`로 고양이 위인지 판정하고, 아니면 `setIgnoreCursorEvents(true)`로 클릭을 통과시켜요.

**클릭 처리**:
- 단일 클릭은 280ms 기다려요. 더블클릭의 앞부분일 수 있어서예요. 그 사이에 한 번 더 누르면 더블클릭으로 보고 알림함을 열어요.
- 2.5초 안에 3번 클릭하면 삐쳐서 식빵 자세로 등을 돌려요.

### 5.2 상태 머신 (src/brain.ts)

- **상태**: `idle`, `look_around`, `walk`, `edge_look`, `sit`, `groom`, `yawn`, `loaf`, `sleep`, `wake`, `drag`, `fall`, `land`, `react`, `lookback`
- **다음 행동 고르기**: idle이 끝나면 `schedule.ts`가 가중치(`config.SCHEDULE`)로 다음 행동을 골라요. 같은 행동이 3번 연속 나오지 않아요.
- **수면**: 입력 없이 5분이 지나면 하품 → 수면으로 넘어가요.
- **물리**: 드래그를 놓으면 중력 1800px/s²로 떨어지고, 착지할 때 찌그러져요. 놓은 높이에 그대로 머무를 수도 있어요(perch).
- **알림 반응**: `react(level)`로 시작해요. 상태별 예외가 있어요.
  - 수면 중: 화들짝 깨고 → 멍 → 반응
  - 식빵 자세 중: 고개만 돌려 뒤돌아봄(`lookback`)
  - 드래그 중: 반응하지 않고 대기열에서 기다림
- **포즈 부드럽게 만들기**: 목표 포즈를 지수 평활(시간 상수 `SMOOTH`, 키별로 다름)해서 따라가요.

### 5.3 알림 파이프라인

**알림이 들어올 때**
1. 클라이언트가 `notify`를 호출해요.
2. 사이드카가 알림을 저장하고 stdout으로 `{"type":"notify"}`와 `{"type":"state"}`를 내보내요.
3. Rust가 이를 받아 `"pet-mcp"` 이벤트로 모든 창에 전달해요. 트레이의 안 읽은 개수도 갱신해요.
4. `main.ts`가 알림을 대기열에 넣어요.

**고양이 쪽 처리**
- 고양이가 반응할 수 있는 상태가 되면 하나를 꺼내 `brain.react(level)`을 시작해요.
- brain이 `out.bubble = true`를 내면 말풍선을 띄워요.
- 말풍선이 닫히면 0.6초 쉬고 다음 알림으로 넘어가요.
- 기다리는 알림 개수는 귀 옆 초승달 배지에 표시해요.

**알림함·말풍선의 동작**
- 알림함과 말풍선의 동작은 모두 `invoke("inbox_do")`로 Rust에 가고, Rust가 사이드카 stdin에 `{"op":"read"|"delete"|"clear", ids?, source?, all?}`를 써요.
- **알림 데이터를 쓰는 건 사이드카 하나뿐이에요.** UI는 직접 저장하지 않고, 사이드카가 보내는 `state`를 받아서 다시 그려요.

**안 읽음 점** (`unread.ts`, 검사: `tools/check_unread.ts`)
- 안 읽은 알림 중, 고양이가 곧 보여 줄 대기열·현재 알림을 뺀 것이 있으면 점을 표시해요. 색은 그중 가장 심각한 레벨이에요.
- 사용자가 말풍선을 직접 닫으면(× 또는 클릭) 읽음 처리돼요. 자동으로 닫힌 건 못 봤을 수 있으니 안 읽음으로 남아요.
- 알림함을 열기만 해서는 점이 꺼지지 않아요. 읽기(클릭, 모두 읽음)나 삭제를 해야 꺼져요.
- 대기 중인 알림을 알림함에서 읽거나 지우면 대기열에서 빠져요. 지금 떠 있는 말풍선의 알림을 지우면 말풍선이 닫혀요.

### 5.4 사이드카 (sidecar/server.ts)

- **주소**: `127.0.0.1:7878/mcp`, 고정이에요. 공식 MCP TypeScript SDK의 `McpServer`와 stateless `StreamableHTTPServerTransport`를 써요. 요청마다 서버를 새로 만들어요.
- **인증**: `~/.pet/token`(64자리 hex)이에요.
  - 처음 실행할 때 만들고 계속 재사용해요. 지우고 재시작하면 새 토큰이 생겨요.
  - 비교는 `timingSafeEqual`로 해요.
  - Host 헤더가 `127.0.0.1:7878`이나 `localhost:7878`이 아니면 거부해요(DNS rebinding 방지).
- **저장**: `~/.pet/notifications.json`이에요. 최신이 앞에 오고 최대 500개를 유지해요. 임시 파일에 쓴 뒤 rename해서, 쓰다가 죽어도 파일이 깨지지 않아요.
- **종료**: stdin이 닫히면 스스로 종료해요. 앱이 죽었을 때 고아 프로세스가 남지 않게 하려는 거예요.
- **포트 충돌**: 포트를 못 열면 `{"type":"error","message":...}`를 보내고 종료해요. 그러면 트레이에 `!`(macOS) 또는 빨간 점(Windows)이 떠요.

---

## 6. 캐릭터 SVG 파이프라인

`src/assets/cat-{front,side,back}.svg`는 **`tools/trace_reference.py`가 생성하는 파일이에요. 직접 고치지 마세요.**

- 이 스크립트는 `assets/reference/*.png`를 OpenCV로 트레이싱해서 부위별 `<g>`로 나눠요.
- 모양을 바꾸려면 스크립트를 고친 뒤 다시 생성하세요.

```bash
python3 -m venv .venv && .venv/bin/pip install opencv-python numpy
.venv/bin/python -I tools/trace_reference.py "$PWD" side   # 인자가 없으면 세 뷰 모두
```

### rig와의 계약

`rig.ts`가 아래 id와 class를 찾아요. 이름을 바꾸면 rig가 조용히 동작을 멈춰요.

- **id**: `#body`, `#head`, `#eyelid`, `#pupil`, `#brows`, `#ear-l`, `#ear-r`, `#mouth`, `#mouth-open`, `#whisker-l`, `#whisker-r`, `#leg-l`, `#leg-r`, `#paw`
- **class**: `.tail-1`, `.tail-2`, `.tail-3`(꼬리 3마디, 각각 외곽선·채움 레이어), `.arm-l`, `.arm-r`, `.paw`, `.lid-line`, `.fur`, `.moon`
- 각 `<g>`는 inline `transform-origin`(회전 중심)을 가지고 있어요.

### 고정 규칙

- **색**:
  - 몸 `#2B2A26`
  - 그림자 `#1F1E1B`
  - 외곽선 `#000`
  - 눈 `#F2C14E`
  - 가슴 초승달 `#FFF`
- **박스**: 고양이는 140×160 박스 안에 그려요.

### 부위별 메모

- **귀**: 머리 path를 clip해서 만들어요. 회전 중심은 귀 밑변 가운데이고, 머리 쪽에 2px 띠를 남겨서 회전할 때 틈이 보이지 않게 해요.
- **측면 다리**: 앞/뒤로 나누고 블록 폭의 25%만큼 겹쳐요.
- **꼬리**: 외곽선 레이어와 채움 레이어를 겹친 굵은 선이에요. 마디 사이에 이음매가 보이지 않아요.
- **세수 앞발**(`#paw`): 어깨에서 입까지 한 덩어리로 된 굵기가 변하는 다리예요. 세수할 때만 보이고, 평소에는 몸에 그려진 팔 선이 보여요.

---

## 7. 설정값 (src/config.ts)

조정할 숫자는 **전부 `config.ts`에** 있어요. 코드에 숫자를 직접 박지 말고 여기에 이름을 붙여 추가하세요.

| 이름 | 내용 |
|---|---|
| `WINDOW` | 창 600×300(`tauri.conf.json`과 같이 맞춰야 함), 고양이 박스 위치 `catLeft 230`, `catTop 120` |
| `SCHEDULE` | 행동 가중치 (idle 40, look_around 15, walk 20, sit 10, groom 7, yawn 5, loaf 3) |
| `WALK`, `SIT`, `GROOM`, `YAWN`, `LOAF`, `SLEEP` | 행동별 시간·각도 |
| `PHYS` | 중력 1800, 착지 찌그러짐, 스프링 |
| `REACT` | 레벨별 알림 반응 (error는 120px/s로 화면 중앙까지 돌진) |
| `BUBBLE.autoClose` | 말풍선 자동 닫힘 8초 |
| `CLICK` | 더블클릭 판정 280ms, 3번 클릭 판정 2.5초 |

성격이 **"시크하고 귀찮음 많은"** 고양이예요. 동작은 느리고, 작고, 조금 마지못해 하는 느낌을 유지하세요.

---

## 8. 플랫폼 차이

| | macOS | Windows |
|---|---|---|
| 창 좌표 | 논리 포인트 | 물리 픽셀 (`main.ts`의 `deskScale`/`winScale` 어댑터가 처리) |
| Dock/작업 표시줄 | `ActivationPolicy::Accessory`로 숨김. 알림함이 열려 있는 동안만 Regular | `skipTaskbar` |
| 트레이 | 템플릿 아이콘 + 제목에 안 읽은 개수, 서버가 멈추면 `!` | 컬러 아이콘. 제목 표시가 없어서 서버가 멈추면 아이콘에 빨간 점(코드로 그림) |
| 로그인 시 자동 실행 | LaunchAgent | 레지스트리 `Run` 키 |
| 모든 데스크탑에 보이기 | `visibleOnAllWorkspaces` | 같은 설정 (가상 데스크탑) |
| 설치 파일 | `.dmg` (Apple Silicon 전용, ad-hoc 서명) | `.msi`, `setup.exe` (서명 없음) — **Windows에서만 빌드 가능** |

- **모니터 판정**은 `availableMonitors()`와 `screens.ts`의 `rectFor`로 해요. `monitorFromPoint`는 쓰지 마세요. 좌표 단위가 섞여서, 보조 모니터에 있던 고양이가 메인 모니터로 순간이동하는 버그가 있었어요.
- **로그인 시 자동 실행**은 릴리스 빌드를 처음 실행할 때 켜져요. 두 번 켜지지 않게 앱 설정 폴더에 `autostart-initialized` 표시 파일을 남겨요. 개발 빌드는 자기 자신을 등록하지 않아요.

---

## 9. 검증 방법

변경한 뒤에는 최소한 아래를 돌리세요.

```bash
npx tsc --noEmit -p .
node --experimental-strip-types tools/check_unread.ts
node --experimental-strip-types tools/check_schedule.ts
node --experimental-strip-types tools/check_screens.ts
cd src-tauri && cargo check && cd ..
```

**변경한 부분별 추가 확인**
- **캐릭터·동작**: `npm run tauri dev`를 켜고 `gallery.html`에서 해당 행동 카드를 확인하세요. 실제 앱과 같은 brain, rig, SVG를 써요.
- **MCP**: 앱을 켠 상태에서 `node tools/check-mcp.mjs`를 실행하세요.
- **Windows 전용 코드**: macOS에서는 `#[cfg(not(target_os = "macos"))]` 코드가 컴파일되지 않아요.
  - 조건을 잠시 지우고 `cargo check`로 확인한 뒤 되돌리세요.
  - 또는 GitHub Actions **windows build**를 돌리세요. 실제 Windows에서 사이드카와 Stop 훅을 실행하고, 한글이 깨지지 않는지 검사해요.
- **UI 동작 (브라우저에서 확인할 때)**: `@tauri-apps/api/mocks`의 `mockIPC`/`mockWindows`와 `shouldMockEvents: true`로 Tauri를 흉내 내고 `main.ts`를 불러오면, 브라우저에서 알림 시나리오를 돌릴 수 있어요. 창이 숨겨진 상태면 `requestAnimationFrame`이 돌지 않으니, `setTimeout`으로 대체하세요.

---

## 10. 빌드와 배포

**macOS**
- `npm run tauri build`를 실행하면 `src-tauri/target/release/bundle/{macos,dmg}/`가 나와요.
- dmg 단계에서 `hdiutil: couldn't unmount ... 리소스 사용 중`이 가끔 나요.
  - 걸려 있는 이미지를 `hdiutil detach -force`로 떼고, `bundle/macos/rw.*.dmg`를 지운 뒤 `npm run tauri build -- --bundles dmg`로 dmg만 다시 만드세요.

**Windows**
- GitHub **Actions → windows build → Run workflow**를 누르세요. `v*` 태그를 푸시해도 돌아요.
- 아티팩트 `desktop-pet-windows`에 `.msi`와 `setup.exe`가 담겨요.

**사용자에게 배포**
- [Releases](https://github.com/devlee0908/desktop-pet/releases)에 파일을 올리고, 사용자에게는 [INSTALL.md](INSTALL.md)를 안내하세요.

**서명 (현재 안 함)**
- macOS: Developer ID 서명 + notarization
- Windows: `signtool`로 서명 (사이드카 exe도 같이 서명해야 해요)

---

## 11. 함정과 교훈

실제로 겪고 고친 것들이에요. 같은 실수를 반복하지 마세요.

1. **`act()`/`go()` 뒤에 `d.*`를 읽지 말 것.** 상태를 바꾸면 상태 데이터 `d`가 새 객체로 바뀌어서, 예전 값을 읽으면 `NaN`이 돼요.
   - 오른쪽으로 걸을 때 다리가 멈추던 버그가 이거였어요.
   - 필요한 값은 바꾸기 전에 지역 변수로 받아 두세요. 평활 단계에 `Number.isFinite` 가드도 있어요.
2. **SVG를 CSS `zoom`으로 키우지 말 것.** WebKit에서 박스 밖 SVG 부분(꼬리 등)이 엉뚱한 곳에 그려져요. `transform: scale()`을 쓰세요.
3. **숨겨진 창이나 웹뷰에서는 `requestAnimationFrame`이 돌지 않아요.** 창을 `show()`한 뒤에 루프를 시작하세요.
4. **사이드카를 단독으로 실행하면 바로 종료돼요.** stdin이 닫히면 종료하도록 만들어서예요. 테스트할 때는 `(sleep 600) | src-tauri/binaries/pet-mcp-*`처럼 stdin을 열어 두세요.
5. **Node 22 미만이면 SEA 빌드가 실패해요.** `nvm use`를 쓰세요.
6. **Windows PowerShell 5.1은 BOM 없는 `.ps1`을 시스템 코드 페이지로 읽어요.** 한글이 들어간 스크립트는 UTF-8 **BOM**으로 저장하세요(`hooks/stop-hook.ps1`). stdin도 `[Console]::InputEncoding = UTF8`로 맞추세요.
7. **알림 텍스트는 외부에서 온 값이에요.** `textContent`로만 넣고 `innerHTML`은 쓰지 마세요.
8. **안 읽음 점의 등장 애니메이션은 `transform`을 써요.** 점프를 따라가는 오프셋은 개별 `translate` 속성으로 줘서 서로 덮어쓰지 않게 했어요.
9. **Windows 설치 파일은 macOS에서 빌드할 수 없어요.** Windows 리소스 컴파일러(`llvm-rc`)가 없어서예요. CI를 쓰세요.
10. **macOS 트레이 제목은 Windows에 없어요.** 상태 표시를 제목에만 의존하지 마세요.
11. **모양을 고칠 때는 2배로 렌더해서 기준 그림 옆에 놓고 비교하세요.** 실제 크기에서는 문제가 잘 안 보여요. 이 고양이는 귀와 세수 팔을 여러 번 다시 그렸어요.

---

## 12. AI 코딩 에이전트에게

이 저장소에서 작업하는 에이전트는 다음을 지켜 주세요.

- **먼저 이 문서와 해당 파일을 끝까지 읽고 시작하세요.** 특히 §5(흐름), §6(SVG 계약), §11(함정)을 확인하세요.
- **최소 변경**: 요청받은 것만 고치세요. 새 의존성, 추상화, 설정 파일은 꼭 필요할 때만 추가하세요.
- **숫자는 `config.ts`**에 이름을 붙여서 추가하세요.
- **SVG는 직접 고치지 말고** `tools/trace_reference.py`를 고친 뒤 다시 생성하세요.
- **알림 데이터를 쓰는 건 사이드카뿐이에요.** UI에서 `notifications.json`을 직접 건드리지 마세요.
- **보안 경계를 지키세요.**
  - 서버는 `127.0.0.1`에만 바인딩해요.
  - Bearer 토큰과 Host 검사를 유지하세요.
  - 토큰을 로그나 커밋에 남기지 마세요.
- **로직을 바꾸면 검사 스크립트도 같이 고치세요.** 순수 함수로 뺄 수 있는 규칙은 빼고 `tools/check_*.ts`에 시나리오를 추가하세요.
- **macOS와 Windows를 둘 다 생각하세요.** 플랫폼별 코드는 `#[cfg(...)]` 또는 `IS_MAC` 분기로 나누고, §8의 차이를 참고하세요.
- **확인하지 않은 건 확인했다고 하지 마세요.** 직접 돌려 본 것과 돌려 보지 못한 것을 구분해서 보고하세요. 특히 Windows 실기 동작은 CI나 실제 PC에서만 확인할 수 있어요.
- **사용자와 대화하는 언어**: 사용자 대상 문구(말풍선, 알림함, 트레이)는 한국어예요. 코드 주석은 영어예요.

---

## 13. 남은 과제

- [ ] 실제 Windows PC에서 확인: 투명 창, 클릭 통과, 트레이, 자동 실행, MCP
- [ ] Intel Mac 지원 (universal 빌드: `--target universal-apple-darwin`, 사이드카도 두 아키텍처로)
- [ ] 전체 화면 앱 위에서도 보이게 (macOS `fullScreenAuxiliary`)
- [ ] 꼬리 모양 다듬기
- [ ] 응답 알림 훅 빈도 조절 (예: 오래 걸린 응답만)
- [ ] 코드 서명 / 공증, 자동 업데이트
