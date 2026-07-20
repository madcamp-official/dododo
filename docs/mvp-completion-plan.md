# MVP 완성 작업 계획 (팀원별)

현재 열린 PR(#30 영속화 계약, #32 SQLite 구현, #33 CLI LLM 연결, #34 fixture 정합성)이 모두 머지된다고 가정할 때, **"완벽한 MVP"까지 남은 작업**을 팀원별로 정리한다. 근거는 Issue #27(시나리오 점검)과 각 PR 리뷰에서 발견된 항목들이다.

## MVP 완성 기준

`docs/mvp-scope.md §6`의 성공 데모(11단계)와 `user-scenarios.md`의 7개 시나리오가 **CLI에서 처음부터 끝까지, 실제 LLM으로** 재현되는 것. 발표 기준이므로 "실제 학교 사이트 연결"보다 **"준비된 입력 → 실제 gemma3 추출 → 병합·추천 → CLI 출력"**이 핵심이다.

## 지금 다 머지되면 확보되는 것 (baseline)

- Context 영속화(SQLite `ContextRepository`, #30/#32) — 프로세스 재시작해도 유지
- CLI가 LLM 엔진에 연결(#33) — `.env`로 on/off
- fixture 정합성(#34) — 병합·시험·수정공지 재현 입력
- Context Intelligence 엔진 8단계(추출·병합·충돌·우선순위·조언·질문·일정·평가)

## 남은 gap — 팀원별

### 박도현 — Runtime & CLI

| # | 작업 | 우선 | 근거·연결 |
|---|---|---|---|
| 1 | 실제 VM LLM 연결(Phase 1) | P0 | SSH 터널 + `.env`로 `gemma3:12b` 붙여 `sync`/`today`가 실제 LLM 출력 내는지 검증(`docs/llm-connection-phasing.md`). 안 되면 "실제 LLM MVP" 아님 |
| 2 | `evidence` 명령 구현 | P0 | 지금 skeleton. `listEvidenceByContextItemId`(#30/#32)로 ContextItem→원본 근거 출력. 시나리오 2·9의 "근거 확인"이 이 명령 없이 불가 |
| 3 | SQLite `ContextRepository`를 container에 주입 | P0 | 지금 container가 `InMemoryContextRepository` 사용 → `sync` 종료 시 사라짐. #32 구현체로 교체해야 프로세스 간 유지(모든 시나리오 전제) |
| 4 | `add` 비대화(non-TTY) hang 가드 | P1 | PR#33 리뷰 — `process.stdin.isTTY` false면 초안만 출력하고 종료 |
| 5 | `inbox` prepare 액션 | P1 | 시나리오 1의 7~8단계(Opportunity 선택→Task/Event 생성) 트리거. 생성 로직은 Intelligence 제공, CLI 흐름은 Runtime |
| 6 | `calendar` 명령 | P2 | 시나리오 3의 `calendar week`. 신규(mvp-scope에 없음) — 범위 정의 후 |
| 7 | `watch` 재분석 안정성 | P1 | 아래 재분석 버그가 해결돼야 watch가 오류 없이 반복 |

### 김도연 — Data Ingestion & Storage

| # | 작업 | 우선 | 근거·연결 |
|---|---|---|---|
| 1 | 재분석 Fact 생명주기 버그 수정 | P0 | PR#32 리뷰에서 발견 — 같은 입력 재분석 시 `비활성 Fact ID 재사용 불가` 오류. `saveRawItemAnalysis`가 "내용 무변경이면 no-op"으로 멱등 처리. watch/재sync가 이것 때문에 막힘 |
| 2 | 실제 수집기를 container에 연결 | P1 | 지금 container가 `JsonFixtureCollector`만 씀. #17~20의 HTTP loader/`.eml`/LMS 파서를 container가 쓰도록 + 실제 소스 설정. 실데이터의 핵심 |
| 3 | 변경 감지 → 파이프라인 연동 | P1 | `RawItemSyncService`의 `skipped`(contentHash 동일)를 파이프라인이 받아 재분석 스킵(Intelligence와 협업, 근본 해결) |
| 4 | 실제 학교 소스 1곳 확정 | P2 | 데모 대상 사이트 URL·CSS selector, 이메일 경로 |

### 김도현 — Context Intelligence & Recommendation

| # | 작업 | 우선 | 근거·연결 |
|---|---|---|---|
| 1 | `resolveWithEvidence` 시각 주입 | P0 | PR#30/#32 리뷰에서 지적 — resolver가 `new Date()`를 직접 써서 재분석 시 History `changedAt` 불일치 → append-only 검증 오류. `now`(=`analyzedAt`)를 인자로 받도록 수정. 재분석 버그의 Intelligence 쪽 절반 |
| 2 | 파이프라인 변경 감지 연동 | P1 | 김도연 3번과 짝 — 같은 contentHash 재분석 스킵 |
| 3 | 관련도 이중화 해소 | P1 | Issue #27 지적 — `relevanceScore`(Stage 6)가 어디서도 호출 안 되는 고아 코드. `computePriority`의 importance에 통합 |
| 4 | `inbox` prepare 변환 로직 | P1 | Opportunity → `{신청마감 Event, 준비 Task[]}` 변환 함수(Runtime CLI와). 시나리오 1의 8단계 |
| 5 | `canonicalTitle` 우선 사용 | P2 | PR#34 리뷰 — FactExtractor가 `metadata.canonicalTitle`을 subject로 우선 → 실데이터에서 제목 달라도 병합 안정 |
| 6 | `dueAt` 구조화 마감 우선 | P2 | PR#20 리뷰 — LMS의 `metadata.dueAt`을 LLM 추출보다 우선 → 마감 정확도↑ |

### 공동

| # | 작업 | 우선 | 비고 |
|---|---|---|---|
| 1 | 재분석 버그 통합 수정 | P0 | 김도연1 + 김도현1 + 김도현2를 함께 검증(파이프라인-저장소-resolver 경계) |
| 2 | `inbox` prepare / `calendar` 범위·계약 정의 | P1 | 신규 기능이라 `contracts.ts` 영향 가능 → AGENTS.md 공동 소유 절차 |
| 3 | Phase 1 통합 데모 리허설 | P0 | VM Ollama + SSH 터널 + 7개 시나리오를 빈 DB에서 처음~끝(mvp-scope §6) |

## 권장 순서

### P0 — 데모가 실제로 도는 최소선 (먼저)

1. 재분석 버그 3자 통합 수정(김도연 멱등 + 김도현 시각주입 + 파이프라인 연동)
2. SQLite `ContextRepository`를 container에 주입(박도현) — 프로세스 간 유지
3. 실제 VM LLM 연결(박도현, SSH 터널)
4. `evidence` 명령(박도현)

→ 여기까지면 **빈 DB에서 fixture 넣고 실제 LLM으로 시나리오 1~5, 7이 CLI에서 도는** 데모 완성.

### P1 — 7개 시나리오 완전 커버

5. `inbox` prepare(김도현 로직 + 박도현 CLI) → 시나리오 1 완결
6. 관련도 이중화 해소(김도현) → 시나리오 1 관련도 정확
7. 실제 수집기 연결(김도연) → 실데이터 진입
8. `calendar` 명령(박도현) → 시나리오 3 완결
9. `add` TTY 가드(박도현)

### P2 — 품질·실데이터 강건성

10. canonicalTitle·dueAt 우선(김도현), 실제 학교 소스 확정(김도연)

## 요약

지금 열린 PR이 다 머지되면 "엔진·영속화·CLI 배선"은 완성되지만 다음이 남는다.

- **재분석 버그**(공동): 같은 입력 재분석 시 Fact 생명주기 오류 — watch를 막는다.
- **container가 아직 InMemory·Fixture**(박도현·김도연): 프로세스 간 유지·실데이터가 안 됨.
- **`evidence`/`prepare`/`calendar` 명령 미구현**(박도현 + 김도현): 시나리오 1·2·3·9 미완결.

**P0 4개(재분석 버그·SQLite 주입·VM LLM 연결·evidence 명령)를 먼저 끝내면 실제 LLM 데모가 돌고, P1으로 7개 시나리오를 완전히 커버한다.**
