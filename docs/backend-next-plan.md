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

## P0 — 이미 구현된 desktop 능동 조언 PR 스택 검토·병합

`#60`(main에 병합됨) 위에 `#61 → #64 → #65 → #66 → #67`이 순서대로 쌓여 있고, 각각
Notifier/watch 배선, Task/Event 수정·삭제 IPC, 일정 충돌 감지, 마감 리마인더
오프셋, Source 등록 API(school-site만)를 구현한다. 이 스택은 `apps/desktop/src/main/*`
(프론트엔드 소유)뿐 아니라 `apps/cli/src/runtime/*`(`scheduleConflict.ts`,
`reminderCheck.ts`, `sourceRegistration.ts`, `watchTick.ts`, `container.ts`,
`mutex.ts` 등, 이제 내 소유)까지 함께 바꾼다.

1. `#61`부터 순서대로 main에 rebase·병합 — `apps/cli/src/runtime/*` 변경분을
   Job Queue·LLM 정책(§P1)과 충돌하지 않는지 검토하면서 병합한다.
2. `#64`~`#67`은 `#61`이 main에 들어간 뒤 순서대로 rebase — 각 PR이 건드리는
   backend 파일(runtime/scheduleConflict.ts 등)을 리뷰하고, frontend-plan.md
   §6.1(IPC 계약)과 실제 구현이 맞는지 확인한다.
3. 병합 후 `docs/frontend-plan.md`의 "아직 병합되지 않음" 표시를 정정한다.

이 스택이 다 들어오면 frontend-plan.md 2.2/2.3/2.4와 2.1의 일정 충돌 부분이 완료
상태가 된다. **우선순위 역전 감지(2.1의 나머지 절반)**는 이 스택에 포함되어 있지
않아 보이므로 병합 후 별도 확인이 필요하다 — 없다면 아래 P1에 남긴다.

## P1 — Job Queue Worker 경계 정리 (llm-architecture §10-1)

**완료(핵심 1개 타입).** 백엔드 담당자 부재로 예외적으로 진행(사용자 승인) —
"경계 정리"에 그치지 않고 실제로 동작하는 슬라이스까지 만들었다.

- `packages/shared/src/domain.ts`/`contracts.ts`: `Job`/`JobType`/`JobStatus`/
  `JobQueueRepository` 계약 추가. `JobType`은 §5가 나열한 9종을 전부 미리 정의해
  뒀지만(`extract_facts`, `generate_embedding`, `resolve_context`,
  `review_ambiguous_merge`, `recalculate_relevance`, `recalculate_priority`,
  `generate_daily_plan`, `analyze_screen`, `generate_advice`, `reprocess_failed`),
  실제로 Handler가 붙어 처리되는 건 `extract_facts`뿐이다.
- `packages/storage/`: `SQLiteJobQueueRepository`(`jobs` 테이블, node:sqlite)와
  `InMemoryJobQueueRepository`. `enqueue`는 같은 id가 pending/leased면 멱등,
  `claimNext`는 priority desc·nextRunAt asc로 하나 뽑아 lease, `recoverExpiredLeases`로
  죽은 Worker가 잡아 둔 leased 작업을 되돌린다.
- `apps/cli/src/runtime/jobQueue/`: `backoff.ts`(30초 시작, 2배씩, 1시간 상한),
  `worker.ts`(`runDueJobs` — claim·재시도 판정·Dead Letter 오케스트레이션,
  Handler가 없는 `JobType`은 건드리지 않는다), `extractFactsJob.ts`(큐에서 꺼낸
  RawItem id로 `pipeline.sync()`를 1건짜리 Collector로 다시 태운다).
- `incrementalSync.ts`: 새 옵션 인자(`{ jobQueue?, now? }`, 기본값 없이 호출하면
  기존 동작 100% 동일 — 회귀 없음)로, 배치 실패 시 무한 재시도 대신 RawItem을
  저장해 두고(관찰 자체는 잃지 않는다) `extract_facts` Job을 enqueue한다.
- `watchTick.ts`: 매 tick 큐를 drain하고, dead-letter된 작업을
  `WatchTickResult.deadLetteredJobs`로 노출한다.
- 데스크톱(`apps/desktop`, 프론트엔드 몫도 이번에 같이 반영): 새
  `NotificationKind: "job-failed"`와 `jobFailureSummary.ts` — dead-letter는
  Quiet Hours로 보류하지 않는다(그 tick에서만 한 번 보고되는 상태 전이라, 보류하면
  영영 전달되지 않는다).

**남은 것(§5의 나머지 8개 Job.type)**: `generate_embedding`/`resolve_context`/
`review_ambiguous_merge`/`recalculate_relevance`/`recalculate_priority`/
`generate_daily_plan`/`analyze_screen`/`generate_advice`/`reprocess_failed`는
타입만 정의돼 있고 Handler가 없다 — `runDueJobs(queue, handlers, ...)`의
`handlers` 객체에 타입별 함수를 추가하기만 하면 같은 큐·재시도·Dead Letter
인프라를 그대로 탄다. `extract_facts`의 재시도 분류(`isRetryableError`)는
`pipeline.sync()`가 오류를 문자열로만 반환해(원래 `RetryAwareFactExtractor`도
`LLMExtractionError`를 일반 `Error`로 바꿔 던짐) 항상 "재시도 가능"으로 기본
처리한다 — 더 정밀한 분류가 필요하면 `pipeline.ts`가 원본 오류(cause)를 보존하도록
바꾸는 후속 작업이 필요하다(공동 소유 파일이라 별도 조율).

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

1. ~~**우선순위 역전 감지**(frontend-plan 2.1)~~ — **완료.**
   `apps/cli/src/runtime/priorityInversion.ts`의 `findPriorityInversion`이 순수 비교를,
   `checkPriorityInversion`이 실제 task+event 순위 계산을 담당한다. 현재 Task를
   결정하는 세션/Activity 연결과 IPC 채널은 프론트엔드 연결 범위로 남아 있다.
2. ~~**Vision 파이프라인 실제 호출**(frontend-plan 2.5)~~ — **완료.**
   `packages/context-engine/src/activity/visionExtraction.ts`의
   `extractScreenActivity(imageBase64, observedAt, provider)`가 `LLMProvider.completeJSON({
   modelKind: "vision", images: [...] })`을 호출해 구조화 Activity를 추출하고,
   기존 `linkActivityToContext`/`generateScreenAdvice`/`screenAdvicePolicy`가
   그대로 소비할 수 있는 `RawItem`으로 변환한다(fixture 경로와 같은 metadata
   키). `sensitiveContentDetected`면 RawItem 자체를 만들지 않는다. 원본
   `imageBase64`는 이 함수 호출에만 쓰이고 반환값에 담기지 않아 호출부
   (`apps/cli/src/commands/advise.ts`의 `advise --screen --live`)가 곧바로
   버린다. 남은 건 3분 폴링이 아닌 Trigger 기반 자동 캡처와 데스크톱 "같이
   공부하기" 세션 UI(프론트엔드 몫).
3. **Privacy Gateway의 이미지 미대응** — `sensitiveContentDetected`는 모델이
   이미지를 받은 뒤의 자기 보고라 전송 전 방어선이 아니며, 민감한 결과의
   RawItem 생성만 막는다. 따라서 이미지 Privacy Gateway가 준비될 때까지
   `advise --screen --live`는 로컬 Ollama에서만 동작하고 remote-job 설정에서는
   캡처·전송 전에 거절한다. 세션 시작 시 1회 동의(frontend-plan 방향)는 여전히
   프론트엔드와 조율이 필요하다.

   **완료(부분).** 원격 차단 판단을 `packages/context-engine/src/llm/imagePrivacyPolicy.ts`의
   `isImageTransmissionAllowed()` 하나로 모았다 — 예전엔 `extractScreenActivity`,
   `advise.ts`(`apps/cli`), 데스크톱 `captureVisionPipeline.ts`(`apps/desktop`, 이번에
   같이 반영)가 각자 `llmConfig.provider === "remote-job"` 또는 `imageDataBoundary`를
   따로 확인해서, 새 호출부가 하나라도 그 확인을 빠뜨리면 원본이 새어 나갈 수 있었다.
   `VisionScreenActivity` 추출 프롬프트도 민감 판단 기준(전화번호·주민등록번호·학번·
   이메일·결제정보·로그인 화면·개인 메신저)을 구체적으로 나열하고 "애매하면 민감으로
   본다"는 과다탐지 우선 원칙을 명시하도록 강화했다.

   **아직 안 된 것.** 이건 원격 전송 차단과 프롬프트 강화일 뿐, 실제 픽셀 마스킹(예:
   OCR로 화면 속 텍스트를 읽어 전화번호·주민등록번호 영역을 흐리게 처리)은 여전히
   없다 — OCR/이미지 처리 라이브러리가 코드베이스에 전혀 없어 새 의존성 추가 결정이
   먼저 필요하다(팀 논의 필요, AGENTS.md 의존성 정책). 로컬 Ollama 경로는 여전히
   "화면 원본을 그대로 모델에 보내고 모델의 자기 보고만 믿는" 상태다.

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
- 우선순위 역전은 함수가 준비됐고(위 참고), Vision도 `extractScreenActivity`가
  준비됐다 — 둘 다 데스크톱에서 실제로 언제/어떻게 호출할지(트리거, IPC 채널,
  "같이 공부하기" 세션 UI)는 프론트엔드와 조율 필요.

## 권장 순서

1. P0 — 이미 구현된 PR 스택(`#61`~`#67`) 순서대로 rebase·리뷰·병합. 새로 만들
   필요 없는 기능을 또 계획하지 않기 위한 선행 작업.
2. ~~P1 — `today`/`inbox`/`watch` 문장 생성 지연 해소~~ — 완료.
3. ~~P1 — 우선순위 역전·Vision 파이프라인~~ — 완료. 남은 건 프론트엔드 연결.
4. P1 — Job Queue Worker 경계 정리.
5. P2 — Data Ingestion 문서 정리, Provider 보강, 평가 확장.
