# LLM 활용 아키텍처 방향

이 문서는 dododo에서 LLM을 어떤 역할로, 어디까지 확장하며, 무엇을 코드가 통제할지에 대한 **팀 공통 방향**이다. 앞으로의 모든 LLM 관련 작업(사람과 코딩 에이전트 모두)은 이 방향을 따른다. 세부 구현은 각 담당 영역에서 하되, 여기 정의된 경계를 넘지 않는다.

## 1. 한 문장 원칙

> **LLM은 비동기 분석 작업자로 적극 활용하고, 상태·권한·병합 확정·알림 정책은 코드와 DB가 통제한다.**

"자율 에이전트가 백그라운드에서 모든 것을 판단"하는 구조로 가지 않는다. LLM은 이해·추출·요약·후보 검색·비교·계획 제안·설명을 하고, 코드는 검증·저장·권한·상태 전이·최종 병합·확정·알림 정책·외부 행동을 담당한다.

## 2. LLM이 하는 일 / 코드가 하는 일

| LLM이 하는 일 | 코드가 하는 일 |
|---|---|
| 비정형 텍스트 → 구조화 Fact 추출 | Schema·허용값 검증, 저장 |
| 추천/조언 문장 생성(phrasing) | 우선순위·관련도·병합 점수 계산 |
| 애매한 병합 후보 비교(제안) | 병합 확정, Hard Guard(과제 번호 등) |
| 화면 이미지 → 구조화 Activity | Evidence 권위 비교, 충돌 해결 |
| 질문 답변 문장 구성(RAG) | 관련 Context 검색·선택, 상태 전이 |
| 자연어 일정 → Event 초안 | 날짜·충돌·필수 필드 검증, 저장 확정 |
| 일일 계획 문장 구성 | 후보·순서 계산, 알림 정책 |

**LLM에 절대 맡기지 않는 최종 판단**: 이메일 읽기 허용 범위, DB 삭제·수정 권한, 사용자 확인 없는 일정 저장, 이메일 전송·답장·삭제, Task 완료 처리, Snooze·Quiet Hours, 과제 번호가 다른 항목의 병합, Evidence 없는 날짜 확정, 알림 빈도, 반복 추천 억제, 개인정보 외부 전송 범위, 실패 작업 재시도 한도.

## 3. 현재 상태 (2026-07-20)

"구현된 LLM 기능"과 "실제 CLI에서 사용 중인 기능"이 다르다.

| 기능 | 구현 | 실제 CLI 사용 | 담당 |
|---|---|---|---|
| Ollama Provider (`OllamaProvider`) | O | X (미연결) | Intelligence |
| 구조화 Fact 추출 (`LLMFactExtractor`) | O | X (임시 규칙 Extractor 사용) | Intelligence |
| 추천 문장 생성 (`generateActionAndReason`) | O | X (규칙 템플릿) | Intelligence |
| 화면 조언 (`generateScreenAdvice`) | O | X (`advise` 미구현) | Intelligence / CLI |
| 관련도·병합·충돌·우선순위 (코드) | O | O(엔진 레벨) | Intelligence |
| Privacy Gateway 마스킹·Chunk | O | X (미연결) | Intelligence / CLI |
| `ask`·`add`·`watch`·`advise`·`evidence` | 엔진 O / CLI X | X (스켈레톤) | Intelligence / CLI |
| 실제 이미지 Vision 분석 | Provider만 | X | Intelligence / CLI |
| Embedding / RAG | X | X | Intelligence |
| 백그라운드 Job Queue | X | X | 공동 |

### 원격 Gateway 구현 상태 (2026-07-21)

- `apps/inference-gateway/`: Bearer Token·일회용 설치 코드, 요청 검증, SQLite Job Queue,
  동시 실행 제한, 일일 사용량 제한, TTL 삭제, Ollama 호출을 구현했다.
- `RemoteJobLLMProvider`: 기존 `LLMProvider.completeJSON()`을 유지하면서 Job 생성 → polling →
  결과 Schema 재검증을 수행한다.
- CLI는 `DODODO_LLM_PROVIDER=remote-job`일 때 원격 Provider를 선택하고 `doctor`는 공개
  `/health`를 확인한다.
- `setup`은 일회용 설치 코드를 `/v1/auth/activate`로 교환하고 기기별 Token을 `.env`에
  권한 `0600`으로 저장한다. `doctor --llm-test`는 실제 인증 Job을 한 번 생성해 Token과
  추론 경로를 함께 검증한다. 일반 `doctor`는 GPU 사용량을 소비하지 않는다.
- Ollama의 실제 모델명은 Gateway 환경변수로만 정하며 클라이언트는 `text` 또는 `vision`만
  요청한다.

현재 Prompt와 Schema는 Context Engine이 소유하므로 인증된 클라이언트가 Gateway로 전달한다.
이는 기존 Provider 계약을 유지하기 위한 MVP 결정이다. 공개 토큰이 유출되면 제한 범위 안에서
임의 Prompt가 가능하므로, Gateway는 긴 설치 코드·기기별 Token·일일 한도·본문 크기 제한을
반드시 적용한다. 장기 서비스에서는 Prompt를 서버 operation으로 옮기는 별도 계약 변경이 필요하다.

## 4. 가장 큰 병목 (성능보다 먼저)

1. **LLM이 런타임에 연결 안 됨** — `apps/cli/src/runtime/container.ts`가 `OllamaProvider`를 만들어 `LLMFactExtractor`/`RecommendationEngine`/화면 조언에 주입해야 한다. (CLI 담당)
2. **프로세스 간 Context 미유지** — CLI가 `InMemoryContextRepository`를 써서 `sync` 후 `inbox`를 별도 실행하면 사라진다. SQLite RawItem 저장소는 있으나 Fact·ContextItem·Evidence·변경 이력·Recommendation·LLM 작업 상태·사용자 확인 대기 항목의 영속화가 필요하다. (Storage + Intelligence 공유 계약)
3. **LLM 실패와 "결과 없음"이 구분돼야 함** — 재시도 정책의 전제. (아래 §6에서 이번에 착수)
4. **`watch`가 단순 반복문이 아니라 지속 가능한 작업 실행기여야 함** — Job Queue 도입 전제. (CLI + 공동)

## 5. 확장 구조: 이벤트 기반 비동기 작업 파이프라인

"LLM 에이전트 하나"가 아니라 이벤트 → 지속성 Job Queue → Worker → Resolver → Policy Gate 구조로 간다.

```text
Collectors → RawItem Store → Job Queue
  → Fast Worker(화면 요약·간단 분류)
  → Deep Worker(Fact 추출·문맥 분석)
  → Embedding Worker(유사 항목 검색)
→ Context Resolver → SQLite Context Store
→ Rule-based Policy Gate → LLM Planning·Phrasing → CLI·알림 → 사용자 피드백
```

핵심 규칙:
- LLM은 DB를 직접 수정하지 않는다.
- 모든 LLM 출력은 Schema를 통과한다.
- LLM 결과는 "분석 제안"으로 저장하고, Resolver와 Policy Gate가 최종 반영을 결정한다.
- 외부 행동은 사용자 확인을 거친다.
- 실패한 작업은 다른 Source와 분리해 재시도한다.

### Job 테이블(예정, 공유 계약)

`Job { id, type, inputRef, status, priority, attempts, nextRunAt, leaseUntil, modelKind, promptVersion, lastError, ... }`. 작업 종류: `extract_facts`, `generate_embedding`, `resolve_context`, `review_ambiguous_merge`, `recalculate_relevance/priority`, `generate_daily_plan`, `analyze_screen`, `generate_advice`, `reprocess_failed`. 안정성: 결정적 작업 ID로 중복 방지, 재시도 한도 + 지수 Backoff, Dead Letter, `leaseUntil` 기반 죽은 Worker 복구, Source별 오류 격리, 모델·Prompt 변경 시 `analysisVersion`으로 선택적 재처리, 사용자 요청 작업 우선.

## 6. 이번 PR에서 착수한 기반 (Intelligence 소유 영역)

위 로드맵 전체가 아니라, 백그라운드 작업자화의 **전제**가 되고 지금 내 소유 영역(`packages/context-engine/src/llm/`, `extraction/`)에서 계약 변경 없이 가능한 것만 착수했다.

- **LLM 오류 분류** (`llm/errors.ts`): `LLMExtractionError.category`(`connection`/`timeout`/`server_error`/`rate_limited`/`client_error`/`invalid_output`/`no_content`)와 `retryable` 게터. Job Queue가 재시도할지 Dead Letter로 보낼지 판정하는 근거.
- **Provider 제어** (`llm/provider.ts`, `ollamaProvider.ts`): 요청별 `timeoutMs`(초과 시 `timeout` 오류), `temperature`(구조화 추출은 0 권장), 오류의 category 분류, 408·429·5xx는 폴백하지 않고 재시도 가능 오류로 전달. `/api/generate` 폴백은 Schema·endpoint 미지원 가능성이 있는 400·404·422로 제한한다.
- **추출 결과 구분** (`extraction/index.ts`): `LLMFactExtractor.extractWithStatus()`가 `success`/`no_facts`/`retryable_failure`/`invalid_output`를 구분해 반환. LLM이 명시적으로 `facts: []`를 반환한 경우만 `no_facts`이고, 응답 Fact가 Evidence 검증에서 전부 탈락하면 `invalid_output`이다. 일부만 탈락하면 유효한 Fact를 보존한다. 기존 `extract(): Promise<Fact[]>`는 하위호환 유지(내부적으로 `extractWithStatus`를 호출).

이 세 가지로 "LLM 서버가 잠시 죽었을 때 재시도" vs "정보가 없거나 응답이 무효라 재시도 무의미"를 구분할 수 있게 됐다. Job Queue가 도입되면 이 status/category를 그대로 소비한다.

## 7. Provider에서 더 보강할 부분 (후속)

호출 취소, 작업별 최대 입력 길이, 문서 Chunk 처리, 모델 `keep_alive`, 모델명·Prompt 버전 기록, 호출 시간·토큰·처리량 기록. 인터페이스는 하나에 다 넣지 말고 `StructuredGenerationProvider` / `EmbeddingProvider` / `ToolCallingProvider`로 분리하는 방향. 기존 `LLMProvider`는 Fact 추출·문장 생성에 계속 사용.

## 8. LLM을 더 적극적으로 쓸 영역 (후속, 안전장치 필수)

- **2단계 문서 분석**: 짧은 문서는 1단계(성격 파악)로 끝내고, 복잡·낮은 확신도 문서만 12B로 정밀 재분석.
- **Embedding 후보 검색**: trigram이 놓치는 의미 유사("AI 해커톤" ↔ "AI 융합 경진대회")를 Ollama `/api/embed`로 보완. 단 **자동 병합을 확정하지 않고** 후보 검색까지만 — Hard Guard(과제 번호·과목·날짜·주최자)는 코드가 확인.
- **애매한 병합 LLM 검토**: 40~69점 Candidate에 `same`/`different`/`uncertain` 판정을 제안으로 추가. `different`는 병합 금지 근거로, `uncertain`은 사용자 확인으로. LLM 결과만으로 과제 번호가 다른 항목을 병합하지 않음.
- **실제 화면 Vision**: `gemma3:4b`로 스크린샷 → 구조화 Activity(application/activityType/course/section/taskCandidate/sensitiveContentDetected/confidence) 추출 후 **원본 즉시 삭제**. 3분 고정 주기 대신 Trigger(명령 실행·앱 전환·같은 문서 장기 체류·마감 임박 관련 앱·Idle→Active) 기반.
- **`ask` Local RAG**: 전체 DB를 LLM에 주지 않고, 코드가 SQLite 조건 검색 + Embedding으로 상위 Context 5~10개를 골라 LLM에 전달, 답변에 Evidence ID 연결. `searchContext`/`listToday`/`getEvidence` 같은 읽기 전용 Tool만 제공 가능.
- **자연어 `add`**: LLM이 일정 제안 → 코드가 날짜·충돌·필수 필드 검증 → CLI 확인 → 코드 저장. LLM이 캘린더/DB에 직접 쓰지 않음.
- **일일 계획**: 코드가 오늘 일정·마감·미완료·가용 시간을 계산 → LLM이 실행 가능한 계획으로 구성. 입력된 Task/Event만 사용(마감·일정 지어내기 금지).

## 9. RTX 3090 운영 (KCloud VM, `docs/KCLOUD_VM_사양.md`)

`gemma3:12b`(문서 추출·RAG·일일 계획) + `gemma3:4b`(화면 Vision·짧은 분류). VRAM 24GiB에 KV Cache·Context가 추가되므로 보수적으로 시작: Heavy Worker 1 + Fast/Vision Worker 1 + Embedding은 저우선 배치(사용자 질문 시 승격). `OLLAMA_NUM_PARALLEL=1`로 측정 후 상향. 애플리케이션 자체 Queue를 두고 Ollama에 무제한 동시 요청을 보내지 않는다. 우선순위: 사용자 `ask`/`add`/`advise` > 새 과제·마감 추출 > 수정 공지 > 추천 재계산 > Embedding 배치 > 오래된 Context 재분석.

## 10. 권장 구현 순서

1. **이미 만든 LLM을 CLI에 연결** (CLI): `OllamaProvider` 생성 → `LLMFactExtractor`/Recommendation/화면 조언 주입, `doctor`에 실제 Ollama·모델 상태와 실패 표시.
2. **Context 영속화** (Storage + Intelligence 공유 계약): ContextItem·Evidence·History·Recommendation SQLite 저장, `InterimContextStore` 제거, 분석 상태·Prompt 버전 저장.
3. **지속성 Job Queue** (공동): `watch`에서 Job 조회·실행, 재시도·Backoff·Lease·Dead Letter, Heavy/Fast 분리, Source별 격리.
4. **LLM 활용 확대** (Intelligence): 2단계 추출, 실제 Vision, Embedding 후보 검색, 애매한 병합 검토, `ask` RAG, 자연어 `add`.
5. **능동적 백그라운드 비서**: 아침 일일 계획, 마감 변경 알림, 준비 지연 Opportunity 감지, 활동-Task 연결, 집중 모드·피드백 기반 침묵, 야간 저우선 재분석.

가장 현실적인 다음 목표는 "더 자율적인 에이전트"가 아니라 아래 흐름의 완성이다.

```text
새 RawItem → 백그라운드 Queue → 로컬 LLM Fact 추출 → Context 병합·갱신
→ 우선순위 재계산 → 필요 시에만 LLM 설명 → 정책 통과 후 알림
```

이 구조가 완성되면 Embedding·RAG·Tool Calling·일일 계획을 추가해도 기존 안전성과 설명 가능성을 유지할 수 있다.
