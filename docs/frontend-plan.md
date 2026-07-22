# 프론트엔드(Desktop UI) 기획

CLI로 동작하는 현재 구조 위에 Windows/macOS 설치형 데스크톱 UI를 추가한다. 캐릭터가
화면에 상시 존재하면서 클릭으로 명령을 실행하고, 별도 설정 창에서 프로필·일정·Source를
관리하는 형태다.

이 문서는 기획·역할 분담·디렉토리 구조를 정의한다. 디렉토리 구조는 `apps/desktop/`
아래 `.gitkeep`뿐인 스켈레톤으로 이미 반영되어 있고, 실제 코드 구현은 이후 단계에서
진행한다.

## 0. 소유권 표기 안내

팀 구조가 백엔드 1인(김도현) + 프론트엔드 2인(박도현·김도연)으로 바뀌면서, `apps/desktop/`
전체가 두 사람의 정식 소유 영역이 됐다 — 더 이상 "프론트엔드 작업에 한정된" 임시 배정이
아니다. `AGENTS.md`의 "팀 역할과 소유권"이 최종 기준이며, 이 문서는 그 안에서 박도현·
김도연의 세부 역할 분담과 우선순위를 정의한다.

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

트리거 판정(3분 고정 폴링 대신 이벤트 기반) 중 Idle→Active 부분은
`apps/desktop/src/main/study/captureTrigger.ts`/`captureScheduler.ts`로 구현·테스트
완료됐고 `study:start`/`study:end`에 배선도 끝났다 — 지금은 `onTrigger`가 로그만
남긴다. 앱 전환 감지는 새 의존성(예: active-win)이 필요해 이번엔 범위에서 뺐다.
실제 캡처·Vision 호출·`adviceCount` 증가는 위 문단의 백엔드 Vision 파이프라인이
머지된 뒤 `onTrigger` 본문을 채우는 것으로 이어진다.

## 3. 역할 분담

기준: Electron Main 프로세스 = 박도현. Renderer(캐릭터·패널·설정 UI) = 김도연.
`packages/context-engine`·`packages/shared` 등 실제 backend 로직은 이제 이 문서의
소유 영역이 아니라 `AGENTS.md`의 백엔드(김도현) 담당이다 — 아래 2.1~2.5의 실제 계산·
저장 로직은 김도현이 구현하고, 박도현은 그 결과를 IPC로 노출하는 배선만 맡는다.

### 박도현

- Electron Main 프로세스 구조, `createCliContainer` 재사용한 IPC용 컨테이너 배선
- Renderer용 IPC API 설계 — 기존 CLI의 `render*` 문자열 함수를 그대로 쓰지 않고,
  구조화된 데이터(JSON)를 반환하는 얇은 API 레이어를 새로 둔다
- `watch`/`watchTick`을 Main에서 상시 실행, 알림 종류별 라우팅(조언/수집완료/충돌경고 등)
- Electron `Notification` 기반 Notifier 구현체 추가(기존 Notifier 인터페이스 구현)
- Windows/macOS 패키징(electron-builder 등)
- 2.1~2.5의 신규 backend 기능(Task/Event 수정·삭제 API, Source 등록 API, 리마인더
  오프셋, 일정 충돌·우선순위 역전 로직, Vision 파이프라인)이 준비되는 대로 IPC
  핸들러로 연결 — 함수 시그니처와 IPC 계약은 착수 전 김도현과 조율

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

3번 "공동" 항목의 "IPC 계약을 먼저 고정한다"를 구체화한 초안이다. 같은 Main/Preload
영역을 서로 다른 계약으로 구현한 PR이 동시에 있었다(#60 `feat/desktop-main-container-ipc`의
`window.desktopApi` + `{ items: RankedItem[] }` 계열과, #63 `feat/desktop-main-readonly-ipc`의
`window.dododo` + `{ entries: RecommendedEntry[] }` 계열). **#60을 기준 구현으로
선택했고, 이 문서는 그 위에서 박도현·김도연이 합의한 최종 목표 계약이다.** #63에만
있던 `profile:*`/`ui-state:*`는 폐기하지 않고 #60 계약 형태로 다시 맞춰
#68(`feat/desktop-profile-uistate-port`, base: #60)로 이식했다.

**#60이 이 목표 계약대로 main에 머지됐다**(`today:get`~`sync:run`, 6.1의 "조회/질문/
Task/동기화" 그룹). 애초 문서와 어긋났던 세 가지 — `ask:ask`의 `evidence: Evidence[]`,
`sync:run` 성공 응답에서 `sourcesConfigError` 제거, `ipcMain.handle` payload 경계
검증 — 모두 반영됐고, doyeonid 2차 리뷰로 payload 검증 로직을 `apps/desktop/src/main/
ipc/handlers.ts`(electron 미의존, `node --test`로 직접 검증 가능)로 분리하는 것과
`reminderOffsetMinutes`를 `Number.isSafeInteger`로 강화하는 것까지 함께 반영됐다.

`profile:*`/`ui-state:*`는 #68이 #60 위에서 구현했다(payload 경계 검증까지 포함, #60의
다른 채널과 동일한 `validate.ts` 패턴). `task:update`/`task:delete`/
`task:setReminderOffset`/`source:list`/`source:register`(school-site만)/`source:remove`는
#61·#64·#65·#66·#67 PR 스택에서 이미 이 계약대로 구현·테스트됐지만 아직 main에
머지되지 않았다. `study:*`는 착수 전 초안 상태를 유지한다 — 남은 부분은 박도현·
김도연이 계속 합의·조정한다.

**병합 순서**: #60은 이미 머지됐다. #68은 #60 위에 쌓여 있고, #61·#64·#65·#66·#67도
#60 위에서 순서대로 쌓인 스택이다 — 각각 최신 main에 rebase한 뒤 스택 순서대로
머지한다. 이 문서(#62)는 그 rebase·머지 흐름과 독립적으로 지금 머지해도 된다(코드
변경이 아니라 이미 머지된 #60과 진행 중인 PR들의 상태를 설명하는 문서이므로).

### 6.1 IPC 함수(Renderer → Main, `invoke`/`handle`)

이름 규칙은 `영역:동작`. 모든 함수는 아래 `Result<T>`로 성공·실패를 통일해서 반환한다
(6.5 참고). 조회·Task 응답의 `item`/`evidence` 필드는 `packages/shared`의
`ContextItem`/`Evidence`를 그대로 노출한다 — Renderer용으로 새 타입을 따로 만들지
않고 기존 계약을 재사용한다.

```ts
type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

// 조회 — today/inbox는 순위 계산 결과(RankedItem), calendar는 이번 주 일정
// (ScheduledItem)을 돌려준다. 셋 다 evidence 본문은 포함하지 않는다 — 상세 보기는
// task:detail로 별도 조회한다. 빈 배열은 오류가 아니라 { ok: true, data: { items: [] } }.
"today:get" → () => Promise<Result<{
  items: Array<{ item: ContextItem; score: number; reason: string }>
}>>
"inbox:get" → () => Promise<Result<{
  items: Array<{ item: ContextItem; score: number; reason: string }>
}>>
"calendar:get" → () => Promise<Result<{
  items: Array<{ item: ContextItem; at: string /* ISO */ }>
}>>   // 이번 주 고정(Asia/Seoul), range 파라미터는 후속

// 질문 — evidenceIds뿐 아니라 Evidence 본문도 함께 돌려준다(task:detail과 동일하게
// 근거 원문을 바로 표시할 수 있게 한다). evidenceIds는 하위 호환을 위해 유지한다.
"ask:ask" → (input: { question: string }) =>
  Promise<Result<{ answer: string; evidenceIds: string[]; evidence: Evidence[] }>>

// 일정 추가(폼 입력, 자연어 파싱 아님 — 1.2 참고)
"add:submit" → (input: {
  title: string;
  date: string;          // YYYY-MM-DD
  time: string;          // HH:mm
  endTime?: string;       // HH:mm
  location?: string;      // metadata.location으로 저장(6.6)
  reminderOffsetMinutes?: number;
}) => Promise<Result<{ id: string }>>

// Task 상세·액션 — complete/snooze 후 갱신 방식은 재조회로 확정한다: Main은 별도
// push 이벤트를 보내지 않고, Renderer가 성공 응답을 받으면 today:get/inbox:get/
// calendar:get을 다시 호출해 목록을 갱신한다.
"task:detail" → (input: { id: string }) => Promise<Result<{
  item: ContextItem;
  evidence: Evidence[];
  snoozedUntil: string | undefined; // ISO
  isSnoozed: boolean;
}>>
"task:complete" → (input: { id: string }) => Promise<Result<void>>
  // kind !== "task"면 { ok: false, error: { code: "validation", ... } }
"task:snooze" → (input: { id: string; until: string /* ISO */ }) => Promise<Result<void>>
  // until 파싱 실패 시 code: "validation"

// 일정 조회·수정 탭(1.3)의 수정·삭제 — add:submit과 같은 이유로 자연어 파싱 없이
// 폼이 채운 구조화된 값을 통째로 교체한다(부분 PATCH 아님). Renderer는 task:detail로
// 값을 채운 폼을 다시 submit한다. update/delete도 complete/snooze와 같이 별도 push
// 없이 성공 응답 후 재조회로 갱신한다.
"task:update" → (input: {
  id: string;
  title: string;
  date: string;          // YYYY-MM-DD
  time: string;           // HH:mm — Task는 마감(deadline), Event는 시작(startAt)
  endTime?: string;       // HH:mm — Event 전용. Task에 주면 code: "validation"
  location?: string;      // metadata.location으로 저장(6.6)
}) => Promise<Result<void>>
  // kind가 task/event가 아니면 code: "validation"
"task:delete" → (input: { id: string }) => Promise<Result<void>>
  // ContextRepository에 delete 메서드가 없어(2.2) status를 "cancelled"로 바꾸는
  // 소프트 삭제다 — 실제로 항목이 없어지지 않고 today/inbox/calendar에서만 제외된다
  // (isExcludedContextStatus). Evidence는 그대로 보존된다.

"task:setReminderOffset"  → (input: { id: string; offsetMinutes: number }) => Promise<Result<void>>
  // 아직 미구현(초안)

// Source 등록(2.3) — #61~#67 PR 스택에 school-site만 구현·테스트됨(아직 main
// 머지 전). school-email/lms는 register가 지원하지 않는다(2.3 각주 참고) — 안전한
// 기본값이 없는 필수 필드가 있어서다. 실제 반환 shape은 초안 단계에서 상정했던
// { id }/void가 아니라 restartRequired다: 등록·제거는 설정 파일만 쓰고 실행 중인
// container의 collectors/privacyGateway는 앱 재시작 후에만 반영되기 때문이다
// (팀 논의로 확정 — 즉시 반영은 container 재구성·watch 루프·notifier 재배선까지
// 필요해 범위 밖으로 미뤘다).
"source:list" → () => Promise<Result<{
  sources: Array<{ id: "school-site" | "school-email" | "lms"; value: string }>
}>>
"source:register" → (input: { type: "school-site" | "school-email" | "lms"; value: string }) =>
  Promise<Result<{ restartRequired: true }>>
  // type이 "school-site"가 아니면 code: "not-supported"
"source:remove" → (input: { id: "school-site" | "school-email" | "lms" }) =>
  Promise<Result<{ restartRequired: true }>>
  // 등록되지 않은 id면 code: "not-found"

// 동기화 — Source 설정 오류(sourcesConfigError)는 throw 대신
// { ok: false, error: { code: "sources-config-error", message } }로 명시적으로 알린다
// (PR #40 리뷰 반영: 조용히 성공한 것처럼 보이지 않게 한다).
"sync:run" → () => Promise<Result<{ collected: number; created: number }>>

// 같이 공부하기 세션(2.5) — 아직 미구현(초안)
"study:start" → (input: { screenCaptureConsent: boolean }) => Promise<Result<{ sessionId: string; startedAt: string }>>
"study:end"   → (input: { sessionId: string }) => Promise<Result<{ summaryText: string; durationMinutes: number; adviceCount: number }>>
"study:get"   → () => Promise<Result<{ sessionId: string; startedAt: string } | undefined>>
  // #81 후속 스택에서 세션 수명주기와 Renderer 동의 UI 구현. Vision 주기 분석은
  // backend Vision PR 병합 뒤 같은 세션 계약 내부에 연결한다.

// 프로필(설정 창) — #68이 #63의 profile:*를 이 계약 형태로 이식 완료
"profile:get"  → () => Promise<Result<UserProfile | undefined>>
"profile:save" → (input: UserProfile) => Promise<Result<void>>
  // profile 형식이 필수 필드를 갖추지 않으면 code: "validation"

// UI 로컬 상태(6.4) — #68이 #63의 ui-state:*를 이 계약 형태로 이식 완료
"ui-state:get" → (input: { key: string }) => Promise<Result<unknown>>
"ui-state:set" → (input: { key: string; value: unknown }) => Promise<Result<void>>
```

### 6.1.1 Preload Renderer API(`window.desktopApi`, #60+#68 기준)

IPC 채널 이름은 6.1에서 고정했지만, Renderer가 실제로 호출하는 전역 API 이름은
`apps/desktop/src/preload/index.cjs`가 정한다. #60(+ profile/ui-state를 더한 #68)
구현을 기준으로 아래 이름을 확정 계약으로 고정한다 — Renderer는 `ipcRenderer.invoke`나
채널 문자열을 직접 쓰지 않고 이 함수만 호출한다.

```js
window.desktopApi.getToday()
window.desktopApi.getCalendar()
window.desktopApi.getInbox()
window.desktopApi.ask(question)
window.desktopApi.addSubmit(input)
window.desktopApi.getTaskDetail(id)
window.desktopApi.completeTask(id)
window.desktopApi.snoozeTask(id, until)
window.desktopApi.updateTask(id, input)   // #64, input: task:update의 title/date/time/endTime?/location?
window.desktopApi.deleteTask(id)          // #64, 소프트 삭제(status: "cancelled")
window.desktopApi.sync()
window.desktopApi.getProfile()
window.desktopApi.saveProfile(profile)
window.desktopApi.getUiState(key)
window.desktopApi.setUiState(key, value)
```

각 함수는 대응하는 채널의 `Promise<Result<T>>`를 그대로 반환한다. 새 채널을
추가할 때는 `apps/desktop/src/main/ipc/index.ts`의 `IPC_CHANNELS`와 이 목록,
preload의 `CHANNELS`/`desktopApi` 세 곳을 함께 갱신한다(preload는 sandbox
CommonJS라 Main의 `.ts` 상수를 import할 수 없어 문자열을 중복 정의한다).

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

모든 NotificationEvent는 도착 시 캐릭터 말풍선으로 순서대로 표시한다.
`opportunity`/`sync-complete`는 말풍선 표시 후에도 사용자가 다시 확인할 수 있도록
캐릭터 배지와 알림 목록에 함께 보존하고 스크린리더에는 `polite`로 알린다. 나머지
종류는 즉시 말풍선만 표시하며 `assertive`로 알린다. Desktop watch가 만드는
`sync-complete`/`conflict`도 추천·리마인더와 동일하게 Quiet Hours 중에는 Renderer로
전달하지 않는다. Quiet Hours 중 감지된 충돌은 알림 완료로 기록하지 않고 종료 후
다음 tick에서 다시 전달한다.

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
`"llm-unavailable"`, `"network"`, `"not-found"`, `"validation"`, `"sources-config-error"`,
`"unknown"` 등. Renderer는 `code`로 분기하고 `message`는 그대로 사용자에게 보여줄 수
있는 문장으로 만든다(Main이 이미 사람이 읽을 문장으로 가공해서 넘긴다 — 기존 CLI
오류 메시지 관례와 동일). `toResult()`로 감싼 예외는 전부 `"unknown"`이 된다 — 코드로
구분해야 하는 실패(`"validation"`/`"not-found"` 등)는 핸들러가 `toResult()` 밖에서
먼저 걸러 `fail()`을 직접 반환한다.

`ipcMain.handle` 등록 함수는 `input.question`/`input.id`/`input.until`처럼 Renderer가
보낸 payload 필드를 바로 읽는다 — 이 지점은 `toResult()` 경계 밖이라 payload가
`object`가 아니거나 필수 문자열 필드가 없으면 예외가 `Result<T>` 계약을 벗어나
Renderer까지 그대로 전파될 수 있다. 각 핸들러는 `ipcMain.handle` 콜백 시작에서
payload 형태와 필수 필드를 확인하고, 어긋나면 `fail("validation", ...)`을 바로
반환해 모든 경로가 `Result<T>` 하나로만 나가게 한다.

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

### 6.7 독립 설정 창 구현 계약과 인계

현재 프로필·일정·캘린더·Source 관리 UI는 기능적으로 구현돼 있지만 캐릭터 Renderer의
`mascot.js`와 같은 DOM 패널 안에서 열린다. 6.3의 목표 구조에 맞추려면 설정을 일반
`BrowserWindow`와 전용 Renderer로 분리해야 한다. 이 작업은 새로운 도메인 계산이나
저장소 API를 만드는 백엔드 작업이 아니다. 설정 화면에 필요한
`profile:*`·`calendar:get`·`task:*`·`source:*` IPC는 이미 존재하므로 그대로 재사용한다.

#### 박도현 — Main/Preload 설정 창 기반

1. 설정 창을 생성·관리하는 Main 모듈을 추가한다.
   - 권장 경로: `apps/desktop/src/main/windows/settingsWindow.mjs`
   - 일반 프레임, `alwaysOnTop: false`, 크기 조절 가능
   - `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
   - 기존 `apps/desktop/src/preload/index.cjs`를 재사용
   - `apps/desktop/src/renderer/settings/index.html`을 로드
2. 설정 창은 앱 전체에서 하나만 유지한다.
   - 이미 열려 있으면 새 창을 만들지 않고 `show()`와 `focus()` 실행
   - 닫힌 뒤에는 참조를 정리해 다시 열 수 있게 함
   - 설정 창만 닫혀도 캐릭터 창과 앱은 계속 실행
3. 캐릭터 Renderer가 설정 창을 열 수 있는 최소 브리지를 Preload에 제공한다.

```js
window.desktopWindow.openSettings();
// 내부 send 채널: "desktop:open-settings"
```

`desktop:open-settings`는 창 제어용 단방향 채널이며 `Result<T>` 데이터 IPC에 추가하지
않는다. Main은 발신자가 DoDoDo가 만든 BrowserWindow인지 확인하고 외부 payload는 받지
않는다. Renderer는 `ipcRenderer`나 Electron 객체를 직접 노출받지 않는다.

4. 다음 Main 회귀 테스트를 추가한다.
   - 여러 번 열어도 설정 창이 하나뿐임
   - 기존 창이 있으면 focus됨
   - 닫은 뒤 다시 열 수 있음
   - `alwaysOnTop`이 아니며 안전한 `webPreferences`를 사용함
   - 설정 Renderer와 Preload의 실제 경로를 로드함

#### 김도연 — 전용 설정 Renderer와 기존 UI 이동

1. 다음 전용 Renderer 구조를 만든다.

```text
apps/desktop/src/renderer/settings/
├── index.html
├── settings.js
├── style.css
├── profile-view.mjs
├── schedule-view.mjs
├── calendar-view.mjs
└── source-view.mjs
```

2. `profile | schedule | calendar | source` 네 탭과 로딩·빈 상태·오류·저장 완료 상태를
   제공한다. 일정 관리는 추가·수정·삭제·리마인더를 담당하고, 캘린더는 주간 조회를
   담당한다.
3. 캐릭터 패널에 있는 `renderSettings`·`renderProfileSettings`·
   `renderScheduleManagement`·`renderSourceSettings` 계열 코드를 설정 Renderer로 옮긴다.
   `desktop-api.mjs`·`profile-form.mjs`·`schedule-form.mjs`·
   `schedule-management.mjs` 순수 모듈은 복사하지 않고 재사용한다.
4. 캐릭터 메뉴의 설정 버튼은 패널을 렌더링하는 대신
   `window.desktopWindow.openSettings()`를 호출한다. 설정 창 연결이 끝난 뒤 캐릭터
   패널 안의 중복 설정 화면을 제거한다.
5. 탭 전환, 프로필/Quiet Hours 저장, 일정 CRUD·리마인더, Source 등록·변경·삭제,
   재시작 안내, IPC 실패, 중복 제출 방지를 Renderer 테스트로 검증한다.

#### 작업 순서와 완료 조건

1. 박도현이 Main/Preload 창 기반 PR을 `main` 대상으로 먼저 연다.
2. 김도연은 그 브랜치를 base로 설정 Renderer stacked PR을 연다.
3. Main PR 병합 후 Renderer PR의 base를 `main`으로 변경하고 최신 main에서 다시 검증한다.
4. 실제 Electron에서 설정 버튼 연타, 창 닫기·재열기, 네 탭 저장 흐름을 공동 확인한다.

완료 시 다음 흐름이 성립해야 한다.

```text
캐릭터 메뉴의 설정 클릭
  → 독립 일반 설정 창 하나를 열거나 기존 창에 focus
  → 기존 desktopApi로 프로필·일정·캘린더·Source 조회/변경
  → 설정 창을 닫아도 캐릭터·watch는 계속 실행
```

별도 백엔드 작업은 현재 범위에 포함하지 않는다. 이후 school-email/LMS 등록 필드처럼
기존 IPC가 지원하지 않는 기능을 추가할 때만 김도현과 새 계약을 별도로 조율한다.

### 6.8 박도현 Main/Preload 잔여 작업 백로그

6.7의 독립 설정 창 외에도 Main/Preload 영역에는 실제 공부 캡처 배선과 독립 결과 패널
기반이 남아 있다. 우선순위는 아래와 같다.

| 우선순위 | 작업 | 현재 상태 | 김도연 후속 |
|---|---|---|---|
| 1 | 독립 설정 창 Main/Preload 기반 | 미구현(6.7 계약 확정) | 설정 Renderer 이동 |
| 2 | 공부 트리거에서 실제 캡처·Vision·알림 연결 | Idle→Active 스케줄러만 구현 | 말풍선·요약 통합 QA |
| 3 | 독립 결과 패널 BrowserWindow 기반 | 미구현(계약 합의 필요) | 패널 Renderer 이동 |

#### 6.8.1 공부 캡처·Vision 실제 호출 연결

PR #79로 Vision 추출 함수가, PR #92로 Idle→Active 트리거 판정과 스케줄러가 main에
병합됐다. 그러나 #92의 `onTrigger`는 현재 로그만 남기므로 아래 수직 흐름은 아직
완성되지 않았다.

```text
Idle→Active 감지
  → 활성 공부 세션과 화면 캡처 동의 확인
  → 현재 화면 일시 캡처
  → extractScreenActivity 호출
  → Activity와 관련 Context 연결 및 조언 생성
  → advice 또는 distraction notification 전송
  → 세션 adviceCount 증가
```

박도현은 기존 Main의 캡처 Runtime·Vision 함수·notification broadcaster·세션 저장을
연결한다. 새 계산 로직을 중복 구현하지 않고 각 기존 계약을 조합한다.

- 활성 공부 세션이며 캡처 동의가 있을 때만 실행한다.
- 세션 종료 시 스케줄러를 즉시 중지하고 진행 중 결과가 종료된 세션에 반영되지 않게 한다.
- 복원된 활성 세션은 앱 시작 후 스케줄러를 다시 시작한다.
- 원격 LLM 사용 고지와 Privacy Gateway 경계를 유지한다.
- 캡처 원본은 영구 저장하지 않고 분석 후 폐기한다.
- 캡처·Vision·조언 실패는 해당 trigger에 격리해 다음 trigger와 watch를 중단하지 않는다.
- 최소 캡처 간격과 동일 알림 반복 방지 정책을 유지한다.
- 실제 발행한 조언만 `adviceCount`에 반영한다.

필수 테스트:

- 비활성 세션 또는 동의 없는 세션에서는 캡처·Vision을 호출하지 않음
- Idle→Active 한 번당 호출 한 번, 최소 간격 내 중복 호출 없음
- 세션 종료 후 호출·알림·횟수 증가 없음
- Vision 실패 후 다음 trigger는 정상 처리
- 조언/이탈 결과가 각각 `advice`/`distraction` notification으로 전달됨
- 세션 종료 응답의 `adviceCount`가 실제 발행 횟수와 일치함

#### 6.8.2 독립 결과 패널 창 기반

6.3은 결과 패널을 캐릭터 창과 분리된 재사용 창으로 정의하지만, 현재 today/calendar/
inbox/ask/detail은 캐릭터 창 안 DOM 패널에서 렌더링된다. 박도현은 Main에서 결과 패널
BrowserWindow를 하나만 생성·재사용하고, 김도연과 먼저 다음 창 제어 계약을 확정한다.

```js
window.desktopWindow.openPanel({
  view: "today" | "calendar" | "inbox" | "ask" | "detail",
  itemId?: string,
});
```

- 이미 열려 있으면 새 창 대신 route와 itemId만 갱신하고 focus한다.
- 캐릭터 위치와 모니터 workArea를 기준으로 빈 공간 쪽에 배치한다.
- 패널을 닫아도 캐릭터·watch·설정 창은 계속 실행한다.
- 외부 URL이나 임의 파일 경로를 payload로 받지 않고 view 허용 값과 itemId를 검증한다.
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`를 유지한다.
- 창 중복·route 전환·닫기·재열기·위치 계산·payload 거절을 테스트한다.

김도연은 기반 PR 위에서 현재 캐릭터 DOM 패널의 결과 Renderer를 전용 패널 Renderer로
옮기고, 캐릭터 메뉴와 notification 상세 버튼을 `openPanel()` 계약에 연결한다.

#### 6.8.3 박도현 권장 진행 순서

1. 6.7 독립 설정 창 Main/Preload PR
2. 김도연 설정 Renderer stacked PR 통합 지원
3. PR #92 trigger의 실제 캡처·Vision·알림·adviceCount 배선 PR
4. 김도연과 실제 Electron 공부 세션 통합 검증
5. 독립 결과 패널 계약 합의 및 Main 창 기반 PR
6. 김도연 패널 Renderer stacked PR 통합 지원

위 작업은 Electron 창 관리와 기존 기능 배선이 중심이다. 새로운 Source·Context 계산이나
저장소 계약이 필요해지는 경우에만 백엔드 담당 김도현과 별도 변경 절차를 시작한다.
