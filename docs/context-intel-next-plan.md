# Context Intelligence & Recommendation — 다음 단계 계획 (김도현)

`docs/mvp-completion-plan.md`(오늘 완료로 삭제)는 "CLI 데모가 실제 LLM으로 처음부터
끝까지 도는가"가 기준이었고 달성됐다. 그 이후 두 가지가 바뀌었다.

1. `docs/llm-architecture.md`를 오늘(2026-07-21) 다시 썼다 — "LLM은 비동기 분석
   작업자, 상태·병합확정·알림정책은 코드"라는 원칙은 유지하되, §5에 이벤트 기반
   Job Queue 확장 구조가 새로 들어왔고, §10 권장 구현 순서가 "Job Queue → LLM 활용
   확대 → 능동적 백그라운드 비서" 3단계로 재정렬됐다.
2. `docs/frontend-plan.md`(데스크톱 UI)가 진행되며 능동 조언(우선순위 역전, 일정
   충돌, 마감 리마인더, Vision 세션)과 Task 삭제 같은 요구가 나왔는데, 이 중
   상당수의 실제 로직은 `packages/context-engine`·`packages/shared`(내 소유 또는
   공동 소유 영역)에 들어간다. frontend-plan.md 3절은 이를 "박도현 담당, 공동 소유
   영역 걸침 — 팀 조율 필요"로 표시해 뒀다.

이 문서는 그 두 변화를 반영해 내 소유 영역(`packages/context-engine/`,
`packages/privacy/`, `packages/profile/`, `packages/evaluation/`,
`apps/inference-gateway/`, `deploy/inference-gateway/`)의 다음 작업을 다시 정리한다.

## 지금 확보된 것 (baseline)

- `OllamaProvider`/`RemoteJobLLMProvider`, `LLMFactExtractor`(+`RetryAwareFactExtractor`),
  추천 문장 생성, 화면 조언 정책, 관련도·병합·충돌·우선순위 코드, Privacy Gateway
  마스킹·Chunk — 모두 실 CLI 경로에 연결됨.
- LLM 오류 분류(`llm/errors.ts`)와 추출 결과 구분(`extractWithStatus`)이 끝나 있어,
  Job Queue가 붙으면 재시도 대상과 Dead Letter 대상을 바로 구분할 수 있다.
- `apps/inference-gateway/`: 인증(설치 코드→기기 Token), Job Queue, 동시 실행·일일
  사용량 제한, TTL 삭제, 운영자 발급 명령까지 구현 완료.
- `ContextRepository`에 삭제(delete) 메서드가 없다 — frontend-plan 2.2가 지적한
  그대로, 아직 손대지 않은 상태.

## P0 — 클라이언트 측 Job Queue의 Worker 경계 (llm-architecture §10-1)

Job Queue 자체(큐 테이블·`watch` 루프 배선)는 공동 작업이지만, Worker가 실제로
호출할 함수들은 지금 내 영역에 이미 있다. 큐가 들어오기 전에 이 경계를 먼저
정리해 둔다.

1. `Job.type`별로 어떤 기존 함수를 호출하는지 매핑 문서화: `extract_facts` →
   `LLMFactExtractor.extractWithStatus`, `resolve_context` → 기존 Resolver,
   `recalculate_relevance/priority` → `computePriority`, `generate_advice` →
   화면 조언 정책, `generate_daily_plan` → 신규(§8 마지막 항목).
2. 위 함수들이 Job Worker에서 호출될 때 필요한 입력(inputRef로 무엇을 가리킬지)과
   실패 시 반환 형태가 `llm/errors.ts`의 `category`/`retryable`과 이미 맞는지 확인.
   안 맞는 함수만 좁게 조정 — 계약을 먼저 넓히지 않는다.
3. Source별 오류 격리가 Job 단위에서도 유지되는지 확인(한 Job 실패가 다른 Job의
   재시도 판정에 영향 주지 않음).

## P1 — LLM 활용 확대 (llm-architecture §8, 단독)

우선순위는 §4의 남은 병목과 겹치는 것부터.

1. `RuleBasedRecommendationEngine.recommend`가 항목마다 LLM 문장 생성을 순차
   호출하는 문제(§4-2) 해소 — 상위 N개만 LLM 호출, 나머지는 템플릿 폴백 또는
   병렬화. `today`/`inbox`/`watch` 체감 지연의 직접 원인이므로 §8의 다른 확장보다
   먼저.
2. 애매한 병합 LLM 검토 — 40~69점 Candidate에 `same`/`different`/`uncertain` 제안
   추가. `different`는 병합 금지 근거, `uncertain`은 사용자 확인. 과제 번호 등
   Hard Guard는 계속 코드가 최종 결정.
3. `ask` Local RAG — 전체 DB를 LLM에 주지 않고 코드가 SQLite 조건 검색으로 상위
   Context 5~10개를 고른 뒤 LLM에 전달. `searchContext`/`listToday`/`getEvidence`
   읽기 전용 Tool만 노출.
4. 2단계 문서 분석, Embedding 후보 검색 — 위 세 개보다 뒤. Embedding은 자동 병합을
   확정하지 않고 후보 검색까지만.

## P1 — 데스크톱 능동 조언의 백엔드 로직 (frontend-plan 2.1/2.4/2.5 교집합)

frontend-plan.md가 "공동 소유 영역 걸침, 팀 조율 필요"로 남겨 둔 항목 중 실제
계산 로직이 내 영역에 들어가는 부분. IPC 배선과 알림 라우팅은 박도현 담당이므로,
아래는 그가 호출할 순수 함수/Provider 호출 경계를 먼저 고정하는 작업이다.

1. **우선순위 역전 감지**(frontend-plan 2.1): `priority.ts`가 이미 계산하는 전체
   순위와, 현재 세션/화면이 다루는 Task를 비교하는 순수 함수 추가. LLM 불필요.
2. **일정 충돌 감지**(frontend-plan 2.1): Task/Event 시간대 겹침 검사. `add`
   저장 시점과 주기 점검(watch tick) 양쪽에서 호출 가능하도록 순수 함수로.
3. **리마인더 오프셋 판정**(frontend-plan 2.4): `ContextItem.metadata`의
   `reminderOffsetMinutes`(신규 키, frontend-plan 6.6)와 `reminderSentAt` 기준으로
   watch tick마다 "지금 알림 보낼 대상"을 골라내는 순수 함수.
4. **Vision 파이프라인 실제 호출**(frontend-plan 2.5): `LLMProvider.completeJSON({
   modelKind: "vision", images: [...] })` 호출 코드는 아직 없다(인터페이스만 존재).
   구조화 Activity 추출 후 기존 `linkActivityToContext`/`generateScreenAdvice`로
   연결하고, 원본 이미지는 호출 직후 즉시 삭제되는지 보장.
5. **Privacy Gateway의 이미지 미대응**(frontend-plan 2.5): 현재 텍스트 전용이라
   이미지가 Privacy Gateway를 거치지 않는다. 세션 시작 시 1회 사용자 동의로 최소
   대응한다는 frontend-plan의 방향을 그대로 따르되, 원격 Provider 사용 시
   스크린샷이 팀 서버로 나간다는 고지 문구는 박도현과 공동 확정.

1~3은 함수 시그니처만 먼저 박도현과 맞추면 구현 자체는 이번 P1에서 끝낼 수 있는
크기다. 4~5는 Vision 세션이라는 별도 스코프이므로 frontend-plan 우선순위 5번과
맞춰 뒤로 미뤄도 된다.

## P2 — Provider 보강 (llm-architecture §7)

호출 취소, 작업별 최대 입력 길이, 문서 Chunk 처리, `keep_alive`, 모델명·Prompt
버전 기록, 호출 시간·토큰·처리량 기록. 인터페이스는 `StructuredGenerationProvider`
/ `EmbeddingProvider` / `ToolCallingProvider`로 분리하는 방향 — 지금 당장 급한
기능은 아니므로 P1이 끝난 뒤 착수.

## P2 — 평가와 안정화

1. Ground Truth/Benchmark에 우선순위 역전·일정 충돌·Vision 조언 시나리오 추가 —
   위 P1 항목들이 구현되는 대로 같이 넣는다(먼저 만들어 두고 구현을 기다리지
   않는다 — AGENTS.md의 "정상 사례뿐 아니라 실패 사례 테스트" 원칙).
2. Job Queue 도입 후 재시도/Dead Letter 실패 사례 벤치마크.

## 공동 조율이 먼저 필요한 것

- `packages/shared` 계약 확장: Job 테이블(§5, 공동 소유 절차 필요), `ContextRepository`
  delete 메서드(frontend-plan 2.2, Task/Event 삭제 API의 전제).
- 우선순위 역전·일정 충돌·리마인더 판정 함수의 정확한 입출력 타입은 구현 전에
  박도현과 먼저 고정한다(IPC 응답 모양과 맞물림).

## 권장 순서

1. P0 Worker 경계 정리 — Job Queue가 실제로 들어왔을 때 재작업 없이 붙게.
2. P1 문장 생성 지연 해소 — 지금 이미 느낀 병목이라 가장 먼저.
3. P1 능동 조언 백엔드 로직 1~3(우선순위·충돌·리마인더) — 순수 코드라 빠르고,
   frontend-plan 우선순위 3번과 맞물려 데스크톱 쪽 임팩트가 크다.
4. P1 LLM 활용 확대 나머지(병합 검토, RAG) — 여유 생기는 대로.
5. P2 Vision 파이프라인·Provider 보강·평가 확장.
