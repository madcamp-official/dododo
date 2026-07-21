# 프론트엔드(Desktop UI) 기획

CLI로 동작하는 현재 구조 위에 Windows/macOS 설치형 데스크톱 UI를 추가한다. 캐릭터가
화면에 상시 존재하면서 클릭으로 명령을 실행하고, 별도 설정 창에서 프로필·일정·Source를
관리하는 형태다.

이 문서는 기획·역할 분담·디렉토리 구조를 정의한다. 디렉토리 구조는 `apps/desktop/`
아래 `.gitkeep`뿐인 스켈레톤으로 이미 반영되어 있고, 실제 코드 구현은 이후 단계에서
진행한다.

## 0. 소유권 표기 안내

이 문서의 김도연 배정은 이 프론트엔드 작업에 한정된다. `AGENTS.md`의 기존 배정(김도연 =
Data Ingestion & Storage)과 다르므로 `AGENTS.md`와 `docs/architecture.md`에 이 프론트엔드
한정 배정을 반영해 두었다 — 두 문서의 소유권 표기는 이제 어긋나지 않는다.

## 1. UI 구성

### 1.1 캐릭터 오버레이(상시 실행)

| 요소 | 내용 |
|---|---|
| 표시 | 화면 위 항상 떠 있는 캐릭터. 투명 배경, 항상 위(always-on-top), 프레임 없음 |
| 이동 | 기본은 정지 상태에서 미세한 대기 애니메이션(숨쉬기·깜빡임)만. 자유 로밍은 하지 않는다 — 작업 중 시야에 계속 걸리는 걸 방지 |
| 드래그 | 마우스로 잡으면 원하는 위치로 이동, 놓으면 그 자리에 고정 |
| 인사 | 하루 첫 실행 시 1회만 인사. 이때 오늘 할 일 요약(1.4 참고)을 함께 발화한다 |
| 알림 표현 | 말풍선으로 조언·알림 표시(OS 알림과 별도 채널) |

### 1.2 클릭 팝업 메뉴

캐릭터 클릭 → 명령 버튼 목록 팝업 → 선택 시 필요한 경우에만 입력창.

| 버튼 | 입력 필요? | 백엔드 상태 |
|---|---|---|
| 오늘 할일(`today`) | 아니오, 바로 패널 | 있음(1.4 참고 — 요약 발화와 데이터 통합) |
| 이번주 할일(`calendar`) | 아니오, 바로 패널 | 있음 |
| 추천(`inbox`) | 아니오, 바로 패널 | 있음 |
| 물어보기(`ask`) | 예, 질문 텍스트 | 있음 |
| 추가(`add`) | 예, 날짜·시간·내용(장소는 자유 입력, `metadata.location`으로 저장) | 부분 있음 — 자연어 파싱 대신 폼 입력으로 구조화된 값을 그대로 저장하도록 CLI 로직 재사용(파싱 불필요, 더 단순함). 알림설정 입력은 리마인더 오프셋 기능(2.4) 선행 필요 |
| 가져오기(URL/email/LMS 등록) | 예, URL 또는 폴더 경로만(CSS selector 등 기술적 필드는 요구하지 않는다) | 신규 필요 — Source 등록 API. selector는 기본값으로 우선 시도하고, 실패하면 "관리자 문의" 안내로 대체한다(2.3) |
| 동기화(새로고침, `sync`) | 아니오 | 있음 |
| 같이 공부하기 | 아니오(세션 시작/종료 토글) | 신규 필요 — Vision 파이프라인(2.5). 세션 진행 중에만 화면을 관찰한다 |

### 1.3 백그라운드 설정 창

| 탭 | 내용 | 백엔드 상태 |
|---|---|---|
| 프로필 | 학교·전공·관심분야·방해금지시간·원격 LLM(`setup` 대응) | 있음. 다만 현재 `setup`은 "전체 재입력" 구조라 부분 수정 UI는 `profileRepository.get()`/`save()`를 직접 호출하는 새 화면으로 구현 |
| 일정 조회·수정 | Task/Event 목록, 클릭 시 상세+수정 | 조회는 있음, 수정·삭제 API 신규 필요(2.2) |
| 캘린더 조회·수정 | `calendar` 데이터 기반 뷰 | 조회는 있음, 수정은 위와 동일 |
| Source 관리 | 등록된 URL/email/LMS 목록, 추가·제거만(selector 편집 UI 없음) | 신규 필요(2.3) |

### 1.4 오늘 할일 — 요약과 패널 통합

`today` 데이터를 단일 소스로 쓰고 표현만 두 가지로 나눈다.

- 하루 첫 인사에 캐릭터가 말풍선으로 요약 발화("오늘 확인할 일은 2개, 운체 과제·팀회의")
- 클릭하면 같은 데이터를 패널로 펼쳐 상세 목록 표시

별도의 "오늘 할 일 알려주기" 알림 트리거는 두지 않는다 — 첫 인사 발화가 그 역할을 겸한다.

### 1.5 상세보기 패널

Task/Event 클릭 → 상세 내용 + Evidence(근거) + **바로 처리 액션**.

| 구성 | 내용 | 백엔드 상태 |
|---|---|---|
| 표시 | 제목·마감·요구사항·상태·Evidence | 있음(`evidence` 데이터를 상세 패널에 합쳐 표시) |
| 완료 처리 버튼 | 상세 패널에서 바로 완료 처리 | 있음(`task done` 재사용, UI 배선만 필요) |
| Snooze 버튼 | 상세 패널에서 바로 미룸 | 있음(`task snooze` 재사용, UI 배선만 필요) |
| 알림 시간 수정 | 이 Task의 리마인더 오프셋 변경 | 신규 필요(2.4) — 이 패널이 그 기능의 진입점 |

목록까지 다시 나가지 않고 상세 패널 안에서 처리가 끝나도록 한다.

## 2. 능동 조언·알림

| 문구 예시 | 트리거 | 상태 |
|---|---|---|
| "OOO 이거 먼저 처리하셔야 해요" | 우선순위 역전 감지 | 신규(2.1) |
| "7월 30일 해커톤, 관심사랑 맞아요" | Opportunity 능동 푸시 | `watch`가 opportunity를 이미 알림 후보에 포함함 — 재사용 위주 |
| "영민이와 스파링 / 춘봉이와 저녁 겹쳐요" | 일정 충돌 경고 | 신규(2.1) — 순수 시각 비교, LLM 불필요 |
| "가장 가까운 마감은 운체 과제, 내일 6시" | 마감 리마인더(기본 24시간 전, Task별 수정 가능) | 신규(2.4) |
| "슬슬 시험 공부를 시작하셔야 해요" / "오래 같은 화면인데 자고 계신 거 아니죠?" | 같이 공부하기 세션 중 화면 조언·이탈 감지 | 신규(2.5), 세션 진행 중에만 발생 |
| "OO를 새로 수집했어요" | 자동 수집 알림 | `watch` 결과(수집 건수)를 조언과 다른 알림 종류로 라우팅만 하면 됨 — 재사용 위주 |

### 2.1 신규 순수 로직(LLM/Vision 불필요)

- **우선순위 역전 감지**: 현재 세션/화면에서 다루는 Task보다 전체 순위(`priority.ts`)상 더 급한 Task가 있으면 알림.
- **일정 충돌 감지**: `add`로 저장하는 시점, 그리고 주기 점검 시 Task/Event의 시간대 겹침을 검사.

### 2.2 Task/Event 수정·삭제 API

`ContextRepository.saveContextItems`가 upsert라 수정 자체는 저장소 레벨에서 가능하다.
지금 없는 건 이를 노출하는 CLI/IPC 함수와, 항목 자체를 없애는 삭제(현재 저장소 계약에
delete 메서드가 없음)다. `packages/shared`의 계약 확장이 필요할 수 있어 공동 소유 절차를
따른다.

### 2.3 Source 등록 API

지금은 `DODODO_SOURCE_CONFIG`가 가리키는 JSON 파일을 사람이 미리 작성해야 한다. URL/폴더
경로를 사용자 입력으로 받아 그 설정 파일을 쓰는 API가 필요하다. selector는 기본값으로
시도한다(1.2 변경 사항 참고).

### 2.4 알림 리마인더 오프셋

`UserProfile` 또는 `ContextItem.metadata`에 오프셋 필드 추가, "이미 이 마감으로
알림 보냄" 상태 관리, `watch` tick에서 그 오프셋 도달 여부를 판정하는 순수 함수가
필요하다. 정확도는 `watch --interval`에 종속된다.

### 2.5 Vision 파이프라인("같이 공부하기" 세션)

화면 캡처(있음) → Vision LLM 호출(`LLMProvider.completeJSON({ modelKind: "vision", images: [...] })`,
인터페이스는 이미 있음, 호출 코드가 없음) → 구조화된 활동 요약+확신도 → 기존
`linkActivityToContext`/`generateScreenAdvice`(있음, 그대로 재사용) 순.

세션 진행 중에만 캡처가 발생하도록 범위를 좁혔으므로(상시 감시 아님), Privacy Gateway가
이미지를 다루지 않는 문제(현재 텍스트 전용)도 세션 시작 시 한 번 사용자 동의를 받는
흐름으로 최소한의 대응이 가능하다. 원격 LLM(`DODODO_LLM_PROVIDER=remote-job`) 사용
중이면 스크린샷이 로컬이 아니라 팀 서버로 나간다는 점을 세션 시작 전에 고지한다.

## 3. 역할 분담

기준: Electron Main 프로세스·기존 backend 확장 = 박도현(Runtime/CLI 담당 연장선).
Renderer(캐릭터·패널·설정 UI) = 김도연(이 프론트엔드 작업 한정 배정, 0번 참고).

### 박도현

- Electron Main 프로세스 구조, `createCliContainer` 재사용한 IPC용 컨테이너 배선
- Renderer용 IPC API 설계 — 기존 CLI의 `render*` 문자열 함수를 그대로 쓰지 않고,
  구조화된 데이터(JSON)를 반환하는 얇은 API 레이어를 새로 둔다
- `watch`/`watchTick`을 Main에서 상시 실행, 알림 종류별 라우팅(조언/수집완료/충돌경고 등)
- Electron `Notification` 기반 Notifier 구현체 추가(기존 Notifier 인터페이스 구현)
- Windows/macOS 패키징(electron-builder 등)
- **신규 백엔드 기능**(packages/shared·context-engine 등 공동 소유 영역 걸침, 팀 조율 필요):
  Task/Event 수정·삭제 API(2.2), Source 등록 API(2.3), 리마인더 오프셋(2.4),
  일정 충돌·우선순위 역전 로직(2.1), Vision 파이프라인(2.5)

### 김도연

- 캐릭터 창: transparent/frameless/alwaysOnTop, 대기 애니메이션, 드래그 이동
- 팝업 메뉴 UI, 각 명령별 입력 폼(질문·add 필드·가져오기 URL/경로·알림 오프셋 설정)
- 결과 패널(오늘 할일/캘린더/추천/상세보기) 레이아웃과 상세보기의 바로 처리 액션 UI
- 설정 창(프로필/일정/캘린더/Source 관리 탭)
- 말풍선 알림 UI와 큐잉(여러 알림 겹칠 때 처리)
- 하루 첫 인사·요약 발화 트리거(로컬에 "마지막 인사 날짜" 저장, 자정 기준 비교)
- 같이 공부하기 세션 UI(시작/종료 토글, 세션 요약 표시)

### 공동

- IPC 계약(Main↔Renderer 데이터 shape) — 병렬 작업 전에 먼저 고정
- 알림 문구 톤·캐릭터 말투
- Vision 세션 동의 문구, 원격 LLM 고지 문구

## 4. 추천 디렉토리 구조와 폴더 소유

실제 생성은 이후 단계에서 진행한다. 아래는 착수 시 기준으로 삼을 구조다.

```text
apps/desktop/                      # 신규 Electron 앱(기존 apps/cli/와 별도)
├── src/
│   ├── main/                      # 박도현 소유
│   │   ├── container.ts            # createCliContainer 재사용, 앱 전용 컨테이너 배선
│   │   ├── ipc/                    # IPC 핸들러(오늘/캘린더/추천/Task CRUD/Source 등록 등)
│   │   ├── watch/                  # 상시 watch 루프, 알림 종류별 라우팅
│   │   ├── notifier/               # Electron Notification 기반 Notifier 구현
│   │   └── windows/                # BrowserWindow 생성·관리(캐릭터 창, 설정 창)
│   ├── preload/                    # 박도현 소유
│   │   └── api.ts                   # contextBridge로 Renderer에 노출하는 IPC API 타입
│   └── renderer/                   # 김도연 소유
│       ├── character/               # 캐릭터 UI(애니메이션·드래그·팝업 메뉴)
│       ├── panels/                  # 오늘/캘린더/추천/상세보기/물어보기 패널
│       ├── settings/                # 설정 창(프로필/일정/캘린더/Source 관리)
│       └── shared/                  # 공통 UI 컴포넌트·스타일
├── resources/                      # 김도연 소유 — 캐릭터 이미지·애니메이션 에셋
├── electron-builder.yml            # 박도현 소유 — 패키징 설정
└── package.json
```

기존 백엔드 확장분(2.1~2.5)은 `apps/desktop/` 밖, 기존 `packages/context-engine/`,
`packages/shared/`, `packages/collectors/` 등에 들어간다. 이 영역은 `AGENTS.md`의
기존 소유권과 공동 소유 절차를 그대로 따른다 — `apps/desktop/`의 소유권 표기와는
별개다.

## 5. 우선순위

1. 캐릭터 뼈대(정지+대기 애니메이션) + 팝업 메뉴 + 기존 조회 기능(today/inbox/calendar/ask/sync) 연결. 신규 백엔드 없이 바로 시연 가능
2. Task/Event 생성·수정·삭제 API + 상세보기 바로 처리 액션(1.5)
3. 일정 충돌 경고, 마감 리마인더(2.1, 2.4) — 순수 코드, LLM/Vision 불필요, 임팩트 큼
4. Source 등록 API(2.3)
5. 같이 공부하기 세션(2.5, Vision) — 별도 스코프로 분리, 나머지 완료 후 진행

## 6. 공동 계약 제안 (병렬 작업 전 고정)

3번 "공동" 항목의 "IPC 계약을 먼저 고정한다"를 구체화한 초안이다. 박도현(Main)과
김도연(Renderer)이 이 초안을 기준으로 합의·조정한 뒤 착수한다 — 확정본이 아니라
논의 시작점이다.

### 6.1 IPC 함수(Renderer → Main, `invoke`/`handle`)

이름 규칙은 `영역:동작`. 모든 함수는 아래 `Result<T>`로 성공·실패를 통일해서 반환한다
(6.5 참고). 응답에 쓰는 `ContextItemView`/`EvidenceView`/`RecommendationView`는
`packages/shared`의 `ContextItem`/`Evidence`/`Recommendation`을 그대로 노출한다 —
Renderer용으로 새 타입을 따로 만들지 않고 기존 계약을 재사용한다.

```ts
type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

// 조회
"today:get"    → () => Promise<Result<{ items: ContextItemView[] }>>
"calendar:get" → () => Promise<Result<{ items: ContextItemView[] }>>   // 이번 주 고정, range 파라미터는 후속
"inbox:get"    → () => Promise<Result<{ recommendations: RecommendationView[] }>>

// 질문
"ask:ask" → (input: { question: string }) =>
  Promise<Result<{ answer: string; evidenceIds: string[] }>>

// 일정 추가(폼 입력, 자연어 파싱 아님 — 1.2 참고)
"add:submit" → (input: {
  title: string;
  date: string;          // YYYY-MM-DD
  time: string;          // HH:mm
  endTime?: string;       // HH:mm
  location?: string;      // metadata.location으로 저장(6.6)
  reminderOffsetMinutes?: number;
}) => Promise<Result<{ id: string }>>

// Task 상세·액션
"task:detail"             → (input: { id: string }) => Promise<Result<{ item: ContextItemView; evidence: EvidenceView[] }>>
"task:complete"           → (input: { id: string }) => Promise<Result<void>>
"task:snooze"             → (input: { id: string; until: string }) => Promise<Result<void>>
"task:setReminderOffset"  → (input: { id: string; offsetMinutes: number }) => Promise<Result<void>>

// Source 등록(2.3)
"source:list"     → () => Promise<Result<{ sources: SourceView[] }>>
"source:register" → (input: { type: "school-site" | "school-email" | "lms"; value: string }) => Promise<Result<{ id: string }>>
"source:remove"   → (input: { id: string }) => Promise<Result<void>>

// 동기화
"sync:run" → () => Promise<Result<{ collected: number; created: number }>>

// 같이 공부하기 세션(2.5)
"study:start" → () => Promise<Result<{ sessionId: string }>>
"study:end"   → (input: { sessionId: string }) => Promise<Result<{ summaryText: string; durationMinutes: number; adviceCount: number }>>

// 프로필(설정 창)
"profile:get"  → () => Promise<Result<UserProfile | undefined>>
"profile:save" → (input: UserProfile) => Promise<Result<void>>

// UI 로컬 상태(6.4)
"ui-state:get" → (input: { key: string }) => Promise<Result<unknown>>
"ui-state:set" → (input: { key: string; value: unknown }) => Promise<Result<void>>
```

### 6.2 이벤트(Main → Renderer push)

요청-응답이 아니라 Main이 먼저 보내는 알림·세션 이벤트. 채널 `"notification"` 하나에
`kind`로 종류를 구분한다 — 종류를 늘릴 땐 이 enum에 추가하고 문서를 같이 갱신한다.

```ts
type NotificationKind =
  | "priority"      // 우선순위 역전 감지(2.1)
  | "conflict"      // 일정 충돌 경고(2.1)
  | "reminder"      // 마감 리마인더(2.4)
  | "opportunity"   // Opportunity 능동 푸시
  | "sync-complete" // 자동 수집 알림
  | "advice"        // 같이 공부하기 세션 중 화면 조언(2.5)
  | "distraction";  // 같이 공부하기 세션 중 이탈 감지(2.5)

interface NotificationEvent {
  kind: NotificationKind;
  message: string;
  contextItemId?: string;
  createdAt: string; // ISO
}

// channel: "notification", payload: NotificationEvent
// channel: "error", payload: { code: string; message: string }  — LLM 연결 끊김 등
//   배경 오류를 캐릭터가 "?" 표시로 알리는 용도(4번 turn에서 논의된 오류 상태 UX)
```

`priority`/`conflict`/`reminder`/`advice`/`distraction`은 "즉시 알림", `opportunity`/`sync-complete`는
"조용한 알림"(캐릭터 뱃지만, 클릭해야 내용 표시)로 표현한다 — 지난 논의에서 제안했던
2단계 구분을 이 enum에 매핑한 것이다.

### 6.3 창 구조

세 개로 나눈다.

1. **캐릭터 창** — 상시 1개. `transparent`/`frameless`/`alwaysOnTop`. 팝업 메뉴와
   말풍선은 이 창 안 DOM 오버레이로 그린다(별도 창 아님).
2. **패널 창** — 오늘 할일/캘린더/추천/상세보기/물어보기 공용. 필요할 때 뜨고
   닫히는 재사용 창 1개(내용만 라우팅으로 전환). 캐릭터 근처에 위치.
3. **설정 창** — 독립 실행되는 일반 창(alwaysOnTop 아님). 프로필/일정/캘린더/Source
   관리 탭을 담는다.

### 6.4 로컬 UI 상태 저장

Renderer의 `localStorage`가 아니라 Main이 `app.getPath("userData")`에 작은 JSON
파일로 관리한다("마지막 인사 날짜" 등). 이유: 창이 3개라 각 Renderer의 저장소
컨텍스트를 신경 쓰는 것보다 Main 하나가 소유하는 편이 안전하다. `ui-state:get`/
`ui-state:set`(6.1)으로 읽고 쓴다.

### 6.5 에러 처리 규약

모든 IPC 함수는 `Result<T>`(6.1)로 통일한다. `error.code`는 소문자-kebab 문자열:
`"llm-unavailable"`, `"network"`, `"not-found"`, `"validation"`, `"unknown"` 등.
Renderer는 `code`로 분기하고 `message`는 그대로 사용자에게 보여줄 수 있는 문장으로
만든다(Main이 이미 사람이 읽을 문장으로 가공해서 넘긴다 — 기존 CLI 오류 메시지
관례와 동일).

### 6.6 `ContextItem.metadata` 키 레지스트리

`metadata`는 자유 형식(`Record<string, unknown>`)이라 키 이름이 여러 곳에서 각자
정해지면 어긋난다. 지금까지 코드에 있는 키와 이 문서에서 새로 쓰기로 한 키를 한
곳에 모은다 — 새 키를 추가할 때 이 표도 같이 갱신한다.

| 키 | 용도 | 출처 |
|---|---|---|
| `addedViaNaturalLanguage` | `add`로 직접 추가한 항목 표시 | 기존(`add.ts`) |
| `evidenceQuote` | 자연어 원문 보존 | 기존(`add.ts`) |
| `parentOpportunityId` | 파생 Task/Event의 원본 Opportunity | 기존(`inbox prepare`) |
| `preparedFromOpportunity` | prepare로 생성됨 표시 | 기존(`inbox prepare`) |
| `preparationRequirementKey` | 파생 Task의 요구사항 안정 ID | 기존(`inbox prepare`) |
| `location` | 사용자가 폼에 입력한 장소(전용 필드 없음) | 신규(6.1 `add:submit`) |
| `reminderOffsetMinutes` | 이 항목 전용 리마인더 오프셋(없으면 프로필 기본값) | 신규(2.4) |
| `reminderSentAt` | 이미 보낸 리마인더 시각(중복 알림 방지) | 신규(2.4) |
