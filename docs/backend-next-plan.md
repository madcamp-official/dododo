# 백엔드(김도현) 다음 단계 계획

팀 구조가 3인 백엔드 분업(Runtime & CLI / Data Ingestion & Storage / Context
Intelligence)에서 **백엔드 1인 + 프론트엔드 2인**으로 바뀌었다. `apps/desktop/`
전체가 프론트엔드이고, 그 외 저장소 전체(`apps/cli/`, `packages/*`,
`apps/inference-gateway/`, `deploy/inference-gateway/`, `fixtures/`)가 이제 내
소유 영역이다. 자세한 소유권은 `AGENTS.md`의 "팀 역할과 소유권"을 따른다.

이 문서는 세 가지를 반영해 다시 짠 계획이다.

1. `docs/llm-architecture.md`가 오늘 다시 쓰였다 — Job Queue 확장 구조(§5)와
   재정렬된 권장 구현 순서(§10).
2. `docs/frontend-plan.md`가 요구하는 능동 조언(우선순위 역전, 일정 충돌,
   리마인더, Vision)과 Task 관리 API 중 상당수는 **이미 옛 Runtime & CLI 담당자
   (dotori235)가 PR 스택으로 구현해 뒀다**(아래 P0 참고) — 새로 만들 필요가 없고,
   이제 그 코드의 일부(`apps/cli/src/runtime/*`)가 내 소유가 됐으므로 검토·병합과
   후속 유지보수가 필요하다.
3. 옛 Data Ingestion & Storage 영역(`packages/collectors/`, `packages/storage/`)도
   합쳐졌으므로, 그쪽에 남아 있던 문서·주석 부채도 이번에 정리한다.

## P0 — desktop 능동 조언 PR 스택 검토·병합 (완료)

`#61 → #64 → #65 → #66 → #67`을 순서대로 리뷰·병합했다(전부 main에 들어감).
리뷰 중 `#65`(일정 충돌 감지)에서 실제 버그를 발견했다 — Task는 마감을
`deadline`에 저장하는데 필터가 `startAt`만 읽어 Task가 관련된 충돌이 전혀
감지되지 않았다. `scheduledStart()` 헬퍼(`calendar.ts`의 `scheduledValue`와
같은 규칙)로 수정 완료.

frontend-plan.md 2.2/2.3/2.4와 2.1의 일정 충돌 부분은 완료 상태다.
**우선순위 역전 감지(2.1의 나머지 절반)**는 이 스택에 없었다 — 아래 P1에 남는다.

## P1 — Job Queue Worker 경계 정리 (llm-architecture §10-1)

Job Queue 자체(큐 테이블·`watch` 루프 배선)는 이제 전부 내 영역이 됐다
(`apps/cli/src/runtime/watchTick.ts` 포함). 큐가 들어오기 전에 Worker가 호출할
함수 경계를 정리한다.

1. `Job.type`별 호출 대상 매핑: `extract_facts` → `LLMFactExtractor.extractWithStatus`,
   `resolve_context` → Resolver, `recalculate_relevance/priority` → `computePriority`,
   `generate_advice` → 화면 조언 정책, `generate_daily_plan` → 신규.
2. 위 함수들의 실패 반환이 `llm/errors.ts`의 `category`/`retryable`과 이미 맞는지
   확인 — 안 맞는 함수만 좁게 조정한다.
3. `watchTick.ts`가 지금 단순 반복문이라 재시도·Backoff·Dead Letter가 없다(§4-1
   병목) — Job Queue가 붙기 전 이 부분의 실패 처리 경계를 명확히 해 둔다.

## P1 — LLM 활용 확대 (llm-architecture §8)

1. ~~`RuleBasedRecommendationEngine.recommend`가 항목마다 LLM 문장 생성을 순차
   호출하는 문제(§4-2) 해소~~ — **완료.** 우선순위 상위 `llmPhrasingLimit`(기본 5)개만
   `Promise.all`로 병렬 LLM 호출, 나머지는 `deterministicPhrasing` 템플릿을 즉시
   사용하도록 바꿨다. `generateActionAndReason`이 실패 시 이미 내부에서 템플릿으로
   폴백하므로 병렬 호출 중 하나가 실패해도 나머지를 막지 않는다.
2. 애매한 병합 LLM 검토 — 40~69점 Candidate에 `same`/`different`/`uncertain` 제안
   추가. Hard Guard(과제 번호 등)는 계속 코드가 최종 결정.
3. `ask` Local RAG — SQLite 조건 검색으로 상위 Context 5~10개를 고른 뒤 LLM에
   전달. 읽기 전용 Tool(`searchContext`/`listToday`/`getEvidence`)만 노출.
4. 2단계 문서 분석, Embedding 후보 검색 — 위 세 개보다 뒤.

## P1 — 남은 능동 조언 백엔드 로직

P0 스택에 없는 것만 남는다.

1. **우선순위 역전 감지**(frontend-plan 2.1): `priority.ts`가 이미 계산하는 전체
   순위와 현재 세션/화면이 다루는 Task를 비교하는 순수 함수. P0 스택 포함 여부
   확인 후 없으면 착수.
2. **Vision 파이프라인 실제 호출**(frontend-plan 2.5): `LLMProvider.completeJSON({
   modelKind: "vision", images: [...] })` 호출 코드가 아직 없다(인터페이스만
   존재). 구조화 Activity 추출 후 `linkActivityToContext`/`generateScreenAdvice`로
   연결, 원본은 호출 직후 즉시 삭제.
3. **Privacy Gateway의 이미지 미대응**: 현재 텍스트 전용이라 이미지가 Privacy
   Gateway를 거치지 않는다. 세션 시작 시 1회 동의로 최소 대응(frontend-plan
   방향)하되, 원격 Provider 고지 문구는 프론트엔드와 조율.

## P2 — Data Ingestion 영역 문서·코드 정리

옛 Data Ingestion & Storage 영역이 합쳐지며 발견한 정리 대상.

1. `apps/cli/src/runtime/container.ts:49`의 주석 "실제 Collector(school-site/
   school-email/lms)는 아직 미구현"은 stale하다 — `SchoolSiteCollector`(실제
   HTTP fetch), `SchoolEmailCollector`(`.eml` 디렉터리), `LmsCollector`(HTML
   파일)가 이미 `packages/collectors/`에 구현돼 있고 `createSourceCollectors`로
   연결 가능하다. 주석을 현재 상태로 정정한다. 실제로 아직 없는 건 학교 이메일
   IMAP/API 실시간 연동과 LMS 로그인 세션 연동뿐(`mvp-scope.md` §3의 선택 범위).
2. `packages/collectors/src/screen/`(화면 캡처 Runtime)은 옛 Runtime & CLI
   전용이었지만 이제 이 영역 전체가 내 소유이므로 별도 조율 없이 바로 작업 가능.

## P2 — Provider 보강 (llm-architecture §7)

호출 취소, 작업별 최대 입력 길이, 문서 Chunk 처리, `keep_alive`, 모델명·Prompt
버전 기록, 호출 시간·토큰·처리량 기록. `StructuredGenerationProvider` /
`EmbeddingProvider` / `ToolCallingProvider` 분리는 그 다음.

## P2 — 평가와 안정화

1. Ground Truth/Benchmark에 우선순위 역전·일정 충돌·Vision 조언 시나리오 추가 —
   구현되는 대로 같이 넣는다.
2. Job Queue 도입 후 재시도/Dead Letter 실패 사례 벤치마크.

## 공동 조율이 필요한 것

- `packages/shared` 계약 확장: Job 테이블(§5)만 남았다. Task/Event 삭제는 `#64`가
  `ContextRepository`에 delete 메서드를 추가하지 않고 기존 `saveContextItems`(upsert)로
  `status: "cancelled"` 소프트 삭제를 구현해 해소했다 — `isExcludedContextStatus`가
  이미 cancelled를 오늘/추천에서 제외하므로 계약 확장이 필요 없었다.
- P0 스택 병합 후 IPC 계약과 실제 구현이 어긋나는 부분은 프론트엔드(박도현·
  김도연)와 조율.
- 우선순위 역전·Vision 파이프라인의 입출력 타입은 구현 전 프론트엔드와 먼저
  고정한다(IPC 응답 모양과 맞물림).

## 권장 순서

1. ~~P0 — PR 스택(`#61`~`#67`) 리뷰·병합~~ — 완료.
2. ~~P1 — `today`/`inbox`/`watch` 문장 생성 지연 해소~~ — 완료.
3. P1 — Job Queue Worker 경계 정리, 우선순위 역전 감지, Vision 파이프라인.
4. P2 — Data Ingestion 문서 정리, Provider 보강, 평가 확장.
