# 작업 요청: CLI에 실제 LLM 연결 (박도현 → Runtime & CLI)

> 요청자: 김도현 (Context Intelligence) · 대상: 박도현 (Runtime & CLI)
> 관련 문서: `docs/llm-architecture.md` §4(병목), §10(구현 순서 1단계)

## 배경 — 왜 지금 LLM이 안 도는가

Context Intelligence 엔진(LLM Fact 추출, 추천 문장 생성, 화면 조언, 자연어 일정/질문, 마스킹)은 `packages/`에 전부 구현·테스트 완료되어 main에 있습니다. **그런데 실제 실행되는 CLI(`apps/cli/src/runtime/container.ts`)가 이 엔진들을 아직 안 씁니다.** 현재 CLI는:

- `TempHeuristicFactExtractor`(임시 규칙) 사용 → 실제 LLM 추출 안 함
- `RuleBasedRecommendationEngine({ history })` — `llmProvider` 미주입 → 규칙 템플릿 문장만
- `OllamaProvider`가 `apps/cli/` 어디에서도 생성되지 않음
- **`.env`(`DODODO_LLM_BASE_URL` 등)를 읽는 코드가 없음** → VM에 LLM을 띄워도 CLI가 그 주소를 모름

즉 "VM에 `gemma3:12b` 띄우고 로컬에서 `npm start -- sync`" 해도 LLM을 호출조차 하지 않습니다. 이 문서는 그 **마지막 배선**을 요청합니다. 엔진 쪽은 provider만 주입받으면 바로 동작하도록 이미 설계돼 있어(생성자에 `llmProvider` 자리 준비됨), 대부분 `container.ts` 몇 줄 교체입니다.

## 엔진 쪽이 이미 보장하는 것 (걱정 안 해도 되는 부분)

- **LLM 실패해도 안 죽음**: `LLMFactExtractor`는 실패 시 빈 배열, `RuleBasedRecommendationEngine`/`generateScreenAdvice`/`answerContextQuestion`은 LLM 실패 시 결정론적 템플릿으로 폴백. 한 Source 실패가 다른 Source를 막지 않음.
- **모델 이름·주소는 주입식**: `OllamaProvider`는 환경변수를 직접 읽지 않고 config를 생성자로 받음 → `.env` 읽기는 CLI(주입하는 쪽)의 책임.

## 작업 체크리스트

- [ ] 1. `.env` 읽어 `OllamaProvider` 생성
- [ ] 2. `TempHeuristicFactExtractor` → `LLMFactExtractor(provider)` 교체
- [ ] 3. `RuleBasedRecommendationEngine`에 `llmProvider` 주입
- [ ] 4. `AllowlistPrivacyGateway` → `ChunkingPrivacyGateway`(마스킹·Chunk 적용)
- [ ] 5. `advise` 명령이 `generateScreenAdvice`에 provider 전달
- [ ] 6. `ask`/`add` 명령을 `answerContextQuestion`/`parseScheduleIntent`에 연결
- [ ] 7. `doctor`에 실제 LLM·모델 연결 상태 표시
- [ ] 8. (권장) Context 영속화 — 프로세스 재시작해도 유지

## 1. `.env` → `OllamaProvider`

Node 22는 별도 라이브러리 없이 `--env-file`을 지원합니다. `package.json`:
```json
"start": "node --env-file=.env apps/cli/src/index.ts",
```
(`.env`가 없어도 에러 안 나게 하려면 `--env-file-if-exists=.env`)

`container.ts`에서 config를 만들어 provider 생성. **정확한 시그니처**(`packages/context-engine/src/llm/ollamaProvider.ts`):
```ts
export interface OllamaProviderConfig {
  baseUrl: string;
  textModel: string;
  visionModel: string;
  defaultTimeoutMs?: number; // 기본 30초
}
```
```ts
import { OllamaProvider } from "../../../../packages/context-engine/src/index.ts";

function createLlmProvider(): OllamaProvider | undefined {
  const baseUrl = process.env.DODODO_LLM_BASE_URL;
  if (baseUrl === undefined || baseUrl.trim() === "") return undefined; // 미설정이면 폴백 유지
  return new OllamaProvider({
    baseUrl,
    textModel: process.env.DODODO_TEXT_MODEL ?? "gemma3:12b",
    visionModel: process.env.DODODO_VISION_MODEL ?? "gemma3:4b",
  });
}
```
> provider가 `undefined`면 아래 엔진들이 자동으로 기존 규칙·템플릿 폴백으로 동작하므로, `.env` 없이도 CLI는 지금처럼 돕니다. **VM LLM을 쓰려면 `.env`에 `DODODO_LLM_BASE_URL=http://<VM_IP>:11434`만 넣으면 됩니다.**

## 2·3·4. `createCliContainer()` 교체

현재:
```ts
const pipeline = new ContextPipeline({
  repository,
  privacyGateway: new AllowlistPrivacyGateway([...collectors, screenCollector].map((c) => c.sourceType)),
  factExtractor: new TempHeuristicFactExtractor(),
  contextResolver: new DeterministicContextResolver(),
});
const recommendationEngine = new RuleBasedRecommendationEngine({ history: pipeline.evidenceStore });
```
교체:
```ts
const llmProvider = createLlmProvider();
const allowedSources = [...collectors, screenCollector].map((c) => c.sourceType);

const pipeline = new ContextPipeline({
  repository,
  // 마스킹·Chunk 적용. allowedEmailAddresses에는 학교 공식 발신 주소만(개인 주소 노출 방지 — 도메인 전체 허용 금지).
  privacyGateway: new ChunkingPrivacyGateway({
    allowedSources,
    allowedEmailAddresses: ["student-support@school.example"],
  }),
  // provider가 undefined면(=.env 미설정) LLMFactExtractor 대신 임시 추출기를 유지해도 되고,
  // provider 있을 때만 LLMFactExtractor로 바꾸는 분기를 둬도 됩니다.
  factExtractor: llmProvider !== undefined
    ? new LLMFactExtractor(llmProvider)
    : new TempHeuristicFactExtractor(),
  contextResolver: new DeterministicContextResolver(),
});

const recommendationEngine = new RuleBasedRecommendationEngine({
  history: pipeline.evidenceStore,
  llmProvider, // undefined면 템플릿 폴백 — 안전
});
```
**정확한 시그니처**:
- `new LLMFactExtractor(provider: LLMProvider)`
- `new RuleBasedRecommendationEngine({ llmProvider?: LLMProvider; history?: RecommendationHistoryProvider })`
- `new ChunkingPrivacyGateway({ allowedSources: SourceType[]; allowedEmailAddresses?: string[]; maxChars?: number })`

> 모두 `packages/context-engine/src/index.ts`, `packages/privacy/src/index.ts`에서 export됩니다.

## 5. `advise` → `generateScreenAdvice`

이미 `advise`/screen 흐름이 있으니, 화면 활동을 Task와 연결하고 조언 문장을 생성하는 부분만 엔진 함수로 연결하면 됩니다.
```ts
import {
  adaptScreenFixtureToRawItem, linkActivityToContext, generateScreenAdvice,
} from "../../../../packages/context-engine/src/index.ts";

const activityRawItem = adaptScreenFixtureToRawItem(screenFixture); // 또는 실제 캡처 요약
const items = await container.repository.listContextItems();
const link = linkActivityToContext(activityRawItem, items);
if (link === undefined) return "관련 Task를 찾지 못해 조언하지 않습니다."; // 확신도 낮거나 무관

const advice = await generateScreenAdvice({
  activityRawItem, link, now: new Date(),
  provider: llmProvider!, // provider 없으면 advise는 조언 없음 처리
  focusMode: /* 집중 모드 여부 */ false,
  lastAdvisedAt: /* 최근 조언 시각(30분 억제) */ undefined,
});
// advice?.advice, advice?.evidenceIds
```
게이트(집중 모드·완료/Snooze·30분 억제·낮은 확신도)는 엔진이 처리하므로, CLI는 focusMode/lastAdvisedAt만 넘기면 됩니다.

## 6. `ask`/`add` 연결

```ts
import { answerContextQuestion, parseScheduleIntent } from "../../../../packages/context-engine/src/index.ts";

// ask
const items = await container.repository.listContextItems();
const answer = await answerContextQuestion(question, items, new Date(), llmProvider); // provider 없으면 템플릿 답변
// answer.answer, answer.evidenceIds

// add — 날짜 계산은 코드가 결정론적으로 하므로 provider 불필요
const intent = parseScheduleIntent(utterance, new Date());
if (intent.kind === "event_draft") {
  // intent.clarifyingQuestion을 사용자에게 보여주고 y/N/edit 받기
  // 승인되면 intent.title / intent.startAt으로 Event 저장 (ambiguousField === "time"이면 시각 확인 권장)
}
```

## 7. `doctor`에 LLM 상태

현재 `doctor.ts`는 `"LLM: provider adapter pending"` 고정 문자열입니다. `.env` 설정 여부와, 가능하면 `${baseUrl}/api/tags`를 짧은 timeout으로 조회해 실제 연결·모델 존재를 표시하면 좋습니다(연결 실패해도 doctor 자체는 죽지 않게).
```
LLM: http://<VM_IP>:11434 · text=gemma3:12b vision=gemma3:4b · 연결 OK
LLM: 미설정(.env의 DODODO_LLM_BASE_URL 없음) — 임시 추출기 사용 중
```

## 8. (권장) Context 영속화

지금 `InMemoryContextRepository`라 `sync` 프로세스가 끝나면 결과가 사라져, 별도 `inbox`/`today` 실행 시 비어 있습니다. SQLite RawItem 저장소(#16)는 있으나 Context·Evidence·Recommendation 영속화는 공유 계약(`ContextRepository` 확장)이 필요합니다 — `docs/proposals/context-repository-contract-extension.md`(제 Stage 0 제안)를 팀이 합의하면 제가 `InterimContextStore`를 실제 Repository로 교체하는 작업을 이어가겠습니다. 이건 §1~7과 독립이라 나중에 해도 됩니다.

## 검증 방법

1. `.env` 없이: `npm run check` 통과 유지 + `npm start -- sync`가 지금처럼 규칙 폴백으로 동작(회귀 없음).
2. VM에 Ollama + `gemma3:12b`/`gemma3:4b` 띄우고 `.env`에 `DODODO_LLM_BASE_URL=http://<VM_IP>:11434` 설정:
   - `npm start -- doctor` → LLM 연결 OK 표시
   - `npm start -- sync` → 실제 LLM이 Fact 추출(임시 규칙 아님)
   - `npm start -- today` → LLM이 생성한 추천 문장
   - `npm start -- advise --screen` / `ask "..."` → LLM 응답

## 요약

엔진은 준비 완료. `container.ts`에서 (1) `.env` 읽어 `OllamaProvider` 생성 → (2)(3)(4) 추출기·추천엔진·PrivacyGateway 교체, 그리고 `advise`/`ask`/`add` 명령 연결이 핵심입니다. provider가 없으면 전부 기존 폴백으로 안전하게 동작하므로, **`.env` 한 줄로 LLM on/off가 됩니다.** 시그니처나 동작에 궁금한 점 있으면 이 PR에 코멘트 주세요.
