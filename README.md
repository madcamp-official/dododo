# DoToRi (`dododo`)

> KAIST 몰입캠프 공통과제 III — Option 1. Build the Core (3인 1팀)

**한 줄 소개:** 학교 사이트·학교 이메일·LMS·파일·캘린더·화면 활동을 로컬 Context로 통합하고, 근거와 함께 다음 행동을 추천하는 대학생용 AI 비서.

> Node.js CLI Core와 Electron 데스크톱 UI를 함께 제공한다. Windows 제품명과 실행
> 파일명은 **DoToRi**이며, 저장소·CLI의 `dododo` 이름은 기존 호환성을 위해 유지한다.

**슬로건:** 흩어진 정보를, 하나의 최신 Task Context로.

---

## 팀원

| 이름 | GitHub | 역할 |
|---|---|---|
| 김도연(팀장) | [doyeonid](https://github.com/doyeonid) | 프론트엔드(Desktop UI) — Renderer |
| 김도현 | [KimDoDohyeon](https://github.com/KimDoDohyeon) | 백엔드 전체(Runtime & CLI, Data Ingestion & Storage, Context Intelligence & Recommendation) |
| 박도현 | [dotori235](https://github.com/dotori235) | 프론트엔드(Desktop UI) — Electron Main |

역할별 담당 경로와 책임 상세는 [`AGENTS.md`의 팀 역할과 소유권](AGENTS.md#팀-역할과-소유권)이
유일한 기준이다. [MVP 범위의 3인 분업 상세](docs/mvp-scope.md#9-3인-분업-상세)는 팀 구조가
바뀌기 전 7일 계획 시점의 역사적 기록이다.

---

## 문서

이 README는 진입점이다. 기획·범위·시나리오·구조에 대한 내용은 각 문서가 하나씩만
소유하며, 아래 목록 밖에서는 같은 내용을 다시 설명하지 않는다. 문서와 구현이 어긋나면
조용히 한쪽을 가정하지 말고 어느 쪽을 갱신할지 먼저 정한다.

| 문서 | 소유 내용 |
|---|---|
| [프로젝트 기획안](docs/product-plan.md) | 문제 정의, 목표 사용자, 핵심 가치·가설, 제품 원칙, MVP 결과물 정의 |
| [MVP 범위](docs/mvp-scope.md) | 필수·선택·제외 범위, 7일 구현 계획, 3인 분업 상세, 완료 조건 |
| [대표 사용 시나리오](docs/user-scenarios.md) | 공모전 발견·이메일 병합·LMS 정리·오늘 할 일·화면 조언·자연어 일정·질문 응답 시나리오 |
| [시스템 구조](docs/architecture.md) | 상위 구조, 처리 파이프라인, 저장소 구조, 모듈 계약, 팀 경계 |
| [LLM 활용 아키텍처](docs/llm-architecture.md) | LLM에 맡기는 일과 코드가 통제하는 일, 원격 Gateway 구현 상태, 확장 로드맵 |
| [프론트엔드(Desktop UI) 기획](docs/frontend-plan.md) | Electron 캐릭터 오버레이·패널·설정 창 UI 구성과 역할 분담 |
| [KCloud VM 사양](docs/KCLOUD_VM_사양.md) | 원격 Inference Gateway VM의 하드웨어·운영 사양 |
| [`AGENTS.md`](AGENTS.md) | 코딩 에이전트 공통 작업 규칙, 소유권 경계, 실행·검증 절차 |

---

## Getting Started

### 요구 환경

- Node.js: `22.18 이상`
- npm: Node.js에 포함된 버전
- Windows 또는 macOS
- 소스에서 CLI를 직접 실행해 팀 Gateway를 쓸 경우에만 운영진이 발급한 일회용 설치 코드
- 로컬 Ollama를 직접 사용할 경우에만 별도 Ollama와 모델 설치

### Desktop 설치 파일: 코드 입력 없이 자동 연결

v0.1.2부터 [설치 파일](#설치-파일) 절의 macOS DMG는 폐쇄된 팀 커뮤니티 배포용으로,
팀 Gateway 기기 Token을 빌드 시점에 이미 넣어서 패키징했다. 설치 후 별도 설정 없이
바로 원격 LLM에 연결된다 — 아래 "소스에서 CLI 또는 Desktop 실행" 순서의
3~4번(설치 코드 입력)이 필요 없다. 이 Token은 배포본 전체가 공유하므로 Gateway의
일일 사용량 한도(`GATEWAY_DAILY_JOB_LIMIT`)도 배포본 사용자 전체가 함께 소진한다.
Windows v0.1.1 실행 파일은 이 기능이 추가되기 전 빌드라 Token이 없고, 지금은 아래
"소스에서 CLI 또는 Desktop 실행"으로 직접 설치 코드를 활성화해야 원격 LLM이 연결된다.

이 방식은 `apps/desktop/resources/bundled-llm-default.json`(Git에서 제외, 형식은
`bundled-llm-default.example.json` 참고)이 있으면 desktop 앱이 `.env` 없이도 그 값으로
`DODODO_LLM_*`을 채우는 방식으로 동작한다. 이미 설정된 실제 환경변수가 있으면 그 값이
항상 우선한다. 이 파일이 없는 빌드(직접 소스 clone 후 패키징 등)는 기존처럼 로컬
규칙 기반 폴백으로 동작한다.

### 소스에서 CLI 또는 Desktop 실행

```bash
# 1. 저장소 복제
git clone https://github.com/madcamp-official/dododo.git
cd dododo

# 2. 의존성 설치
npm ci

# 3. 프로필 설정과 설치 코드 활성화
# 운영진에게 받은 일회용 설치 코드를 질문에 입력한다.
npm start -- setup

# 4. 공개 Gateway와 실제 인증 추론 확인
npm start -- doctor --llm-test

# 5. CLI Fixture 기반 첫 사용
npm start -- sync
npm start -- inbox
npm start -- today
npm start -- ask "운영체제"
```

`setup`은 기본적으로 `https://llm.madcamp-kaist.org`에서 설치 코드를 기기별 Token으로
교환하고, Token을 Git에서 제외되는 `.env`에 권한 `0600`으로 저장한다. Token 원문은
콘솔이나 Git에 남기지 않는다.

> 원격 Gateway를 사용할 사람은 먼저 `cp .env.example .env`를 실행할 필요가 없다.
> `.env.example`의 기본값은 로컬 Ollama를 직접 운영하는 개발자를 위한 예시다.

CLI는 `dododo.sources.json`이 없으면 개발·평가용 Fixture로 동작한다. v0.1.1 Desktop
배포본은 예시 데이터가 사용자 DB에 들어가지 않도록 Fixture를 포함하지 않고 폴백도
비활성화한다. 실제 Source를 쓰려면 학교 사이트 URL과 Selector, 이메일 `.eml` 디렉터리,
LMS HTML 경로를 `dododo.sources.json`에 설정한다. 계정 자동 로그인이나 OAuth 연동은
현재 MVP 범위에 포함되지 않는다.

### 운영자: 사용자별 설치 코드 발급

Gateway VM의 `/opt/dododo`에서 사용자마다 코드를 하나씩 발급한다. 코드는 기본 7일 후
만료되며 한 번 활성화하면 다시 사용할 수 없다. 발급 명령은 코드 Hash만 Gateway SQLite에
저장하고 원문은 명령 실행 직후 한 번만 출력한다. 서비스 재시작은 필요하지 않다.

```bash
cd /opt/dododo

# 사용자별 코드 발급·등록
sudo -u dododo env GATEWAY_DB_PATH=/var/lib/dododo/gateway.db \
  npm run gateway:activation-code -- issue \
  --label "홍길동 MacBook" \
  --expires-days 7

# 발급 상태 확인(원문은 표시하지 않음)
sudo -u dododo env GATEWAY_DB_PATH=/var/lib/dododo/gateway.db \
  npm run gateway:activation-code -- list

# 아직 사용하지 않은 코드 취소
sudo -u dododo env GATEWAY_DB_PATH=/var/lib/dododo/gateway.db \
  npm run gateway:activation-code -- revoke --id ac_발급된_ID
```

기존 `GATEWAY_ACTIVATION_CODES` 환경변수 방식도 호환을 위해 유지하지만, 신규 사용자는
위 DB 기반 명령으로 발급한다. 설치 코드와 기기 Token을 README, 이슈, PR 또는 Git에
커밋하지 않는다.

### 설치 파일

| 운영체제 | 파일 | 상태 |
|---|---|---|
| Windows | [DoToRi Setup 0.1.2.exe](https://github.com/madcamp-official/dododo/releases/download/v0.1.2/DoToRi.Setup.0.1.2.exe) | 배포 완료 |
| Windows Portable | [DoToRi 0.1.2.exe](https://github.com/madcamp-official/dododo/releases/download/v0.1.2/DoToRi.0.1.2.exe) | 배포 완료 |
| macOS (Apple Silicon) | [DoToRi-0.1.2-arm64.dmg](https://github.com/madcamp-official/dododo/releases/download/v0.1.2/DoToRi-0.1.2-arm64.dmg) | 배포 완료(원격 LLM 자동 연결) |

> 현재 Windows 실행 파일에는 상용 코드 서명이 없어 SmartScreen 경고가 표시될 수 있다.
> Windows v0.1.2는 개발 실행과 설치 앱의 Source 설정·SQLite 경로를
> `AppData/Roaming/DoToRi`로 통일한다.
> macOS DMG도 Apple 공증(Notarization) 없이 빌드되어 Gatekeeper가 "확인되지 않은
> 개발자" 또는 "손상됨" 경고를 표시할 수 있다. 이 경우 앱을 `Applications`에 옮긴 뒤
> 터미널에서 `xattr -cr /Applications/DoToRi.app`을 실행하거나, Finder에서 앱 아이콘을
> 우클릭한 뒤 "열기"를 선택해 최초 1회 실행한다. 현재 DMG는 Apple Silicon(arm64)
> 전용이며 Intel Mac은 지원하지 않는다.

---

## 기술 스택

| 영역 | 기술 |
|---|---|
| Runtime | Node.js 22.18 이상, TypeScript(ESM, `.ts` 직접 실행) |
| 저장소 | `node:sqlite`(Node 내장, 외부 DB 드라이버 의존 없음) |
| 수집 | cheerio(학교 사이트 HTML), mailparser(`.eml` 학교 이메일) |
| LLM | Ollama(로컬) 또는 `RemoteJobLLMProvider`(Cloudflare Tunnel + 팀 Inference Gateway) |
| 테스트 | Node Test Runner(`node --test`), 외부 테스트 프레임워크 의존 없음 |
| Desktop UI | Electron 43, Main/Preload/Renderer, electron-builder(NSIS·Portable) |

---

## 팀원별 참여 내용

현재 담당 경로는 [`AGENTS.md`의 팀 역할과 소유권](AGENTS.md#팀-역할과-소유권)이 유일한
기준이다. 받는 입력·내보내는 결과·완료 기준은 팀 구조가 바뀌기 전 역사적 기록인
[MVP 범위의 3인 분업 상세](docs/mvp-scope.md#9-3인-분업-상세)에 남아 있다. 아래는
회고용 기록만 남긴다.

### 김도연 — Desktop Renderer와 에셋

- **주요 구현:** 캐릭터 오버레이, 위치별 패널·말풍선, 오늘/캘린더/추천/물어보기 UI,
  독립 설정 Renderer, 같이 공부하기 상태와 캐릭터 포즈·이펙트, Source 수집 결과 화면
- **실험 및 문제 해결:** 투명 창 클릭 통과, 캐릭터와 패널 분리 배치, 연속 답변 말풍선,
  전체 화면 산책과 스피드라인 위치, 배포본 브랜딩·Fixture 제외 QA

### 김도현 — Backend 전체

- **주요 구현:** CLI, 학교 사이트·이메일·LMS·화면 Collector, SQLite와 Migration,
  Context 추출·병합·Evidence·추천, Quiet Hours·리마인더·Watch, Privacy Gateway,
  평가 도구와 원격 Inference Gateway·Job Queue
- **실험 및 문제 해결:** Source별 오류 격리, 증분 동기화와 중복 방지, LLM 실패 폴백,
  화면 Privacy 경계, Dead Letter 처리와 근거 추적 가능한 추천 정책

### 박도현 — Electron Main·Preload·패키징

- **주요 구현:** 안전한 IPC 브리지, 캐릭터·결과 패널·설정 BrowserWindow 관리,
  드래그·다중 모니터 위치 계산, Desktop Watch·알림 배선, Windows/macOS 패키징 기반
- **실험 및 문제 해결:** 투명 always-on-top 창의 mouse passthrough, 창 재사용·재열기,
  캐릭터 주변 빈 공간 패널 배치, 화면 캡처 트리거와 세션 수명주기 연결

매일 최소 두 번 통합하는 순서는 [MVP 범위 11. 통합 순서](docs/mvp-scope.md#11-통합-순서)를 따른다.

---

## 평가 계획 및 결과

### 비교 기준

- **Baseline:** 각 문서를 독립적으로 요약(출처 간 병합 없음)
- **Proposed:** 다중 출처 Context 통합 및 상태 갱신
- **실험 조건:** Windows/macOS, 학교 공지 사이트 1곳 이상, 학교 이메일 또는 Fixture 1종, LMS Fixture 1종 기준

### 데이터셋

| 종류 | 개수 | 설명 |
|---|---:|---|
| 학교 공지 | JSON 1개·HTML 1개 | 공모전 공지와 실제 HTML Parser 입력 |
| 학교 이메일 | JSON 1개·EML 3개 | 공모전·과제·면담 안내와 Message-ID 중복 처리 |
| LMS 공지 | JSON 3개·HTML 2개 | 과제·시험 일정과 수정 공지 |
| 화면 Fixture | JSON 1개 | 운영체제 학습 활동과 Task 연결 |
| Ground Truth | JSON 2개·TSV 1개 | 추출 F1, 다중 출처 병합과 평가 입력 |

### 핵심 지표

| 지표 | 초기값 | 목표 | 최종 결과 |
|---|---:|---:|---:|
| 할 일·마감 추출 F1 | 평가기 없음 | 대표 Ground Truth 1.0 | 대표 파이프라인 F1 1.0 |
| 다중 출처 Context 병합 정확도 | 평가기 없음 | 대표 병합 1.0 | 사이트+이메일 병합 1.0 |
| 변경 감지 후 반영 시간 | 전체 재분석 | 변경분만 처리 | Content Hash 기반 증분 처리 구현 |
| 잘못된 추천 비율 | 미측정 | 완료·취소·Snooze 제외 | 정책 회귀 테스트 통과, 실사용 비율 미측정 |
| 중복 알림 비율 | 미측정 | 동일 항목 반복 억제 | Recommendation 이력·리마인더 마감 키로 억제 |
| 화면 조언 생성 시간 | 고정 폴링 | 이벤트 기반 | Idle→Active 트리거와 최소 3분 간격 구현 |
| 외부 LLM 전송 데이터 크기 | 원문 전달 위험 | 최소 범위 | Privacy Gateway 마스킹·Chunk 적용, 크기 미측정 |

### 실패한 시도와 발견

- 투명 Electron 창 전체가 클릭 영역이 되거나 반대로 클릭이 뒤 창으로 통과해 메뉴를
  열 수 없는 문제가 있었다. 알파 마스크 hit-test와 Renderer 소유 mouse passthrough로
  캐릭터·메뉴만 상호작용하도록 수정했다.
- 캐릭터 내부 CSS transform만으로 산책시키면 실제 화면 이동 범위가 작고 패널과 따로
  움직였다. Main의 화면 좌표 드래그 IPC와 workArea 계산을 재사용해 모니터 끝까지 이동시켰다.
- 배포본이 Source 미등록 시 Fixture를 불러 예시 Context를 사용자 DB에 저장했다.
  Desktop 전용 `useFixtureFallback: false`와 패키징 제외 규칙을 추가하고 v0.1.1에서
  사용자 DB·제품명을 DoToRi로 분리했다.
- Electron OS 토스트와 Renderer 알림이 이원화되어 모든 Desktop 알림을 캐릭터
  말풍선 이벤트 하나로 통합했다.

---

## 배포 결과물

- **GitHub:** [madcamp-official/dododo](https://github.com/madcamp-official/dododo)
- **Windows 설치 파일:** [DoToRi v0.1.2](https://github.com/madcamp-official/dododo/releases/tag/v0.1.2)
- **Windows Portable:** [DoToRi 0.1.2.exe](https://github.com/madcamp-official/dododo/releases/download/v0.1.2/DoToRi.0.1.2.exe)
- **macOS 설치 파일:** [DoToRi-0.1.2-arm64.dmg](https://github.com/madcamp-official/dododo/releases/download/v0.1.2/DoToRi-0.1.2-arm64.dmg)(Apple Silicon 전용, 미서명, 원격 LLM 자동 연결)
- **데모 영상:** 별도 공개 URL 없음
- **실행 방법:** [Getting Started](#getting-started) 참고

---

## 회고

### Keep

- Source → RawItem → Fact → ContextItem → Evidence → Recommendation 수직 흐름과 모듈 계약
- 네트워크 없이 재현 가능한 Fixture·Ground Truth와 변경 영역 회귀 테스트
- 사용자 데이터 로컬 저장, 읽기 전용 수집과 Privacy Gateway 경계
- 작은 목표 단위 PR, 리뷰 반영 후 테스트·CI를 확인하는 통합 방식

### Problem

- CLI 중심 초기 문서와 빠르게 확장된 Desktop 구현 상태가 자주 어긋났다.
- 투명 창·다중 모니터·DPI·클릭 통과처럼 일반 웹 UI에 없는 Electron QA 비용이 컸다.
- 실제 Source 설정이 없는 개발 Fixture와 공개 배포 데이터의 경계가 초기에 분리되지 않았다.
- 코드 서명 인증서가 없어 Windows SmartScreen 경고를 제거하지 못했다.

### Try

- 릴리스 체크리스트에 빈 사용자 데이터 디렉터리 설치·업그레이드 QA를 추가한다.
- Windows 코드 서명 인증서 또는 Trusted Signing을 CI 패키징에 연결한다.
- 학교 이메일·LMS 계정의 읽기 전용 실제 연동과 Source별 설정 UI를 확장한다.
- Ground Truth 규모를 늘리고 추천 오류율·중복 알림률·응답 시간을 자동 리포트한다.
