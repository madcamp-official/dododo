import { mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ContextPipeline,
  DeterministicContextResolver,
  LLMFactExtractor,
  RuleBasedRecommendationEngine,
} from "../../../../packages/context-engine/src/index.ts";
import {
  captureActiveScreen,
  createSourceCollectors,
  JsonFixtureCollector,
  ScreenCollector,
  type ScreenCaptureResult,
} from "../../../../packages/collectors/src/index.ts";
import { ChunkingPrivacyGateway } from "../../../../packages/privacy/src/index.ts";
import { InMemoryProfileRepository } from "../../../../packages/profile/src/index.ts";
import { ConsoleNotifier, SyncStatusStore } from "../../../../packages/scheduler/src/index.ts";
import {
  InMemoryContextRepository,
  InMemoryRawItemRepository,
  openContextDatabase,
  SQLiteContextRepository,
  SQLiteProfileRepository,
  SQLiteRawItemRepository,
} from "../../../../packages/storage/src/index.ts";
import type { RawItemRepository } from "../../../../packages/storage/src/index.ts";
import type {
  Collector,
  ContextRepository,
  Notifier,
  PrivacyGateway,
  ProfileRepository,
  RecommendationEngine,
  SourceType,
  UserProfile,
} from "../../../../packages/shared/src/index.ts";
import type { LLMProvider } from "../../../../packages/context-engine/src/index.ts";
import { defaultScreenAdvicePolicy, LlmScreenAdvicePolicy, type ScreenAdvicePolicy } from "./adviceLookup.ts";
import { normalizeDbPath, resolveDbPath } from "./dbConfig.ts";
import { createLlmProvider, resolveLlmConfig, type LlmConfig } from "./llmProvider.ts";
import { MaskingLLMProvider } from "./maskingLlmProvider.ts";
import { createMutex, type Mutex } from "./mutex.ts";
import { RetryAwareFactExtractor } from "./retryAwareFactExtractor.ts";
import { loadSourceInputConfig, resolveSourceInputConfigPath } from "./sourceInputConfig.ts";
import { TempHeuristicFactExtractor } from "./tempFactExtractor.ts";

// Fixture 기반 데모 Source. 실제 Collector(school-site/school-email/lms)는 아직 미구현이라
// Data & Storage 팀 작업이 끝날 때까지 fixtures/*.json을 대신 사용한다.
// 파싱·검증은 packages/collectors/src/fixtures(JsonFixtureCollector)에 위임한다 — 여기서 중복 구현하지 않는다.
const FIXTURE_SOURCES: Array<{ dir: string; sourceId: string; sourceType: SourceType }> = [
  { dir: "school-site", sourceId: "school-site-main", sourceType: "school-site" },
  { dir: "school-email", sourceId: "school-email-main", sourceType: "school-email" },
  { dir: "lms", sourceId: "lms-main", sourceType: "lms" },
];

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

export interface CliContainer {
  repository: ContextRepository;
  profileRepository: ProfileRepository;
  notifier: Notifier;
  recommendationEngine: RecommendationEngine;
  syncStatus: SyncStatusStore;
  pipeline: ContextPipeline;
  // sync/watch가 syncIncrementally(incrementalSync.ts)를 통해 변경 판정에 쓴다.
  // 판정만 먼저 하고 커밋(save)은 pipeline 처리 성공 후에만 해야 실패한 항목이
  // 다음 tick에 재시도된다 — 그래서 Collector를 감싸는 대신 이 저장소 자체를
  // 공개해 호출부가 직접 순서를 통제하게 한다.
  rawItemRepository: RawItemRepository;
  // watch tick의 자동 동기화와 수동 sync(CLI sync 명령, 데스크톱 sync:run IPC)가
  // 같은 collectors/pipeline을 동시에 건드리지 않도록 "동기화 한 번"을 이 락으로
  // 감싼다(mutex.ts, doyeonid 리뷰 PR #61) — CLI는 원래 한 진입점만 쓰지만 데스크톱은
  // watch 루프와 Renderer IPC가 같은 container를 공유해 실제로 겹칠 수 있다.
  syncLock: Mutex;
  collectors: Collector[];
  // 화면 캡처는 의도적으로 collectors에 넣지 않는다: "변경분만 동기화"라는
  // 주기 폴링 개념이 실시간 화면엔 안 맞고, AGENTS.md 최소수집 원칙상 사용자
  // 모르게 화면을 주기적으로 캡처해선 안 되며, user-scenarios.md도 화면 조언을
  // 명시적 사용자 액션(advise --screen)으로 서술한다. screen/advise 명령이
  // 이 필드를 직접 사용한다.
  screenCollector: Collector;
  // Context Intelligence의 실제 조언 정책이 이 필드를 교체해 넣는 연결 지점.
  screenAdvicePolicy: ScreenAdvicePolicy;
  // 실제 픽셀 캡처(Windows만 지원, 실패 시 명확한 오류). 테스트가 실제 OS 캡처를
  // 안 타도록 여기서 주입 지점을 둔다 — school-site HTTP Loader의 fetchImplementation과
  // 같은 이유(환경 의존 없는 테스트).
  captureLiveScreen: () => Promise<ScreenCaptureResult>;
  // .env의 DODODO_LLM_BASE_URL 미설정이면 undefined — advise/ask 등 LLM을 쓰는 명령이
  // 이 값으로 폴백 여부를 직접 판단한다(docs/handoff-cli-llm-wiring.md).
  llmProvider: LLMProvider | undefined;
  // pipeline이 쓰는 것과 같은 인스턴스. ask 명령이 answerContextQuestion 호출 시
  // 그대로 넘긴다(마스킹 정책 이원화 방지 — screenAdvicePolicy와 같은 이유).
  privacyGateway: PrivacyGateway;
  // doctor가 provider 내부(private baseUrl/model)를 안 건드리고 상태 문구를 만들 수 있게
  // llmProvider와 같은 소스(resolveLlmConfig)에서 뽑은 설정을 그대로 노출한다.
  llmConfig: LlmConfig | undefined;
  // undefined면 InMemory 저장소 사용 중(DODODO_DB_PATH=:memory: 명시)이라는 뜻,
  // 그 외엔 기본값이든 명시든 SQLite 경로 — doctor가 표시한다.
  dbPath: string | undefined;
  // 실제 Source 설정 파일(dododo.sources.json류)을 찾았으면 그 경로, 없으면 undefined
  // (Fixture Collector로 폴백 중이라는 뜻) — doctor가 표시한다.
  sourcesConfigPath: string | undefined;
  // sourcesConfigPath가 DODODO_SOURCE_CONFIG로 명시된 경로인지(true), cwd 기본값
  // (./dododo.sources.json)에서 우연히 찾은 것인지(false) — doctor가 구분해 표시한다.
  sourcesConfigPathIsExplicit: boolean;
  // 설정 파일은 있는데 파싱·검증에 실패했을 때의 사유. 이 경우에도 CLI 전체를
  // 죽이지 않고 Fixture로 폴백하되(AGENTS.md: 한 Source의 실패가 전체를 막지 않음),
  // doctor가 원인을 보여줘야 조용히 묻히지 않는다.
  sourcesConfigError: string | undefined;
  // SQLite를 열었으면 프로세스 종료 전에 파일 잠금을 풀기 위해 명시적으로 닫는다.
  // InMemory면 아무 것도 하지 않는다. index.ts가 모든 명령 경로에서 호출한다.
  close: () => void;
}

function loadFixtureCollectors(): Collector[] {
  const collectors: Collector[] = [];

  for (const source of FIXTURE_SOURCES) {
    const dirPath = join(repoRoot, "fixtures", source.dir);
    let fixturePaths: string[];
    try {
      fixturePaths = readdirSync(dirPath)
        .filter((name) => name.endsWith(".json"))
        .map((name) => join(dirPath, name));
    } catch {
      continue;
    }
    if (fixturePaths.length === 0) continue;

    collectors.push(new JsonFixtureCollector(source.sourceId, source.sourceType, fixturePaths));
  }

  return collectors;
}

function loadScreenCollector(): Collector {
  const dirPath = join(repoRoot, "fixtures", "screen");
  let fixturePaths: string[];
  try {
    fixturePaths = readdirSync(dirPath)
      .filter((name) => name.endsWith(".json"))
      .map((name) => join(dirPath, name));
  } catch {
    fixturePaths = [];
  }

  return new ScreenCollector("screen-manual", fixturePaths);
}

export interface CliContainerOptions {
  env?: NodeJS.ProcessEnv;
  // 명시하면 DODODO_DB_PATH보다 우선한다 — 테스트나 다른 진입점이 저장 위치를 직접
  // 통제해야 할 때 쓴다(#43/#45와 통일한 시그니처, PR #40 리뷰 nit). InMemory를 원하면
  // dbConfig.ts와 같은 규칙으로 ":memory:"를 넘긴다.
  databasePath?: string;
}

export function createCliContainer(options: CliContainerOptions = {}): CliContainer {
  const env = options.env ?? process.env;
  // 미설정이면 기본 영속 경로(./.dododo/dododo.db)를 쓴다 — issue #27(빈 저장소에서
  // 대표 시나리오 재현)이 .env 설정 여부에 안 걸리게 한다(PR #40 리뷰, 김도현 지적).
  // DODODO_DB_PATH=:memory:를 명시했을 때만 InMemory로 돌아간다. SQLite면 같은 커넥션을
  // ContextRepository·RawItemRepository 양쪽에 공유한다 — 커넥션이 갈리면
  // saveRawItemAnalysis의 canonical RawItem ID 보정이 서로 다른 raw_items 테이블 뷰를
  // 보게 돼 깨진다(PR #32 계약 전제).
  const dbPath = options.databasePath !== undefined ? normalizeDbPath(options.databasePath) : resolveDbPath(env);
  let repository: ContextRepository;
  let rawItemRepository: RawItemRepository;
  let profileRepository: ProfileRepository;
  let close: () => void;
  if (dbPath === undefined) {
    repository = new InMemoryContextRepository();
    rawItemRepository = new InMemoryRawItemRepository();
    profileRepository = new InMemoryProfileRepository();
    close = () => {};
  } else {
    mkdirSync(dirname(dbPath), { recursive: true });
    const database = openContextDatabase(dbPath);
    repository = new SQLiteContextRepository(database);
    rawItemRepository = new SQLiteRawItemRepository(database);
    // setup이 저장한 프로필이 프로세스 재시작 후에도 남아야 today/inbox/watch의
    // 관련도 계산(relevance/index.ts)이 매번 빈 프로필로 폴백하지 않는다
    // (docs/llm-architecture.md §4에서 지적된 병목).
    profileRepository = new SQLiteProfileRepository(database);
    close = () => database.close();
  }

  const notifier = new ConsoleNotifier();
  const syncStatus = new SyncStatusStore();
  const screenCollector = loadScreenCollector();
  const llmConfig = resolveLlmConfig(env);
  const llmProvider = createLlmProvider(env);

  // Source 설정 파일(dododo.sources.json류)이 있으면 실제 Collector를, 설정 파일 자체가
  // 없으면(전혀 시도한 적 없음) 기존 Fixture Collector를 쓴다(DODODO_DB_PATH와 같은
  // "설정 없으면 데모 모드" 패턴). CLI 전체를 죽이지 않되, doctor가 사유를 보여줄 수
  // 있게 sourcesConfigError에 남긴다.
  // DODODO_SOURCE_CONFIG 유래인지 cwd 기본값 유래인지를 doctor가 성공/실패 양쪽
  // 결과와 함께 보여줄 수 있게 미리 뽑아 둔다(PR #40 리뷰, 김도현 nit) — "설정한 적
  // 없는데 우연히 그 이름 파일이 있어서 실제 Source로 전환"과 구분돼야 한다.
  const sourcesConfigPathIsExplicit = resolveSourceInputConfigPath(env).isExplicit;
  let collectors: Collector[];
  let sourcesConfigPath: string | undefined;
  let sourcesConfigError: string | undefined;
  try {
    const loaded = loadSourceInputConfig(env);
    if (loaded === undefined) {
      collectors = loadFixtureCollectors();
    } else {
      collectors = createSourceCollectors(loaded.config);
      sourcesConfigPath = loaded.path;
    }
  } catch (error) {
    // 설정 파일을 실제로 시도했는데(읽기 실패·JSON 오류·검증 실패) Fixture로 섞어
    // 넣지 않는다 — createSourceCollectors()는 schoolSite/schoolEmail/lms 전체를
    // 한 번에 검증하므로, 예를 들어 lms 설정 하나만 오타여도 schoolSite처럼 정상인
    // 설정까지 여기서 통째로 버려진다. 그 상태에서 Fixture로 채우면 정상 Source
    // 처리가 중단되는 데다 실제 데이터인 줄 알고 데모 데이터가 영속 SQLite에 그대로
    // 저장된다(doyeonid, PR #40 리뷰 P1 — Source별 격리 전까지는 아예 수집하지
    // 않는 쪽이 안전하다). 반면 설정 파일 자체가 없어서 시도조차 안 한 경우(위
    // loaded === undefined)는 원래부터 데모 모드이므로 Fixture로 채우는 게 맞다.
    collectors = [];
    sourcesConfigError = error instanceof Error ? error.message : String(error);
  }

  // screenCollector는 collectors 배열엔 없지만(자동 sync/watch 대상 아님) 수동
  // screen/advise 명령이 pipeline.sync()를 직접 호출하므로 allowlist엔 포함해야
  // "Source is not allowed: screen"으로 조용히 막히지 않는다.
  // 마스킹+Chunk 선택 적용(#21). allowedEmailAddresses는 실제 학교 공식 발신 주소가
  // 정해지면 채운다(이슈#27 논의 1번, 도메인 전체 허용은 금지 — masking.ts 참고). 지금은
  // 비워둬서 모든 이메일 주소가 안전하게 마스킹된다(과소 노출 쪽으로 fail). advise의
  // LlmScreenAdvicePolicy도 이 인스턴스를 그대로 재사용한다(마스킹 정책 이원화 방지).
  // "conversation"은 실제 Collector가 없는 합성 sourceType이다 — ask(qa.ts)와 추천 문장
  // 생성(MaskingLLMProvider)이 질문/프롬프트를 담은 휘발성 RawItem을 이 sourceType으로
  // 만들어 privacyGateway.prepare()에 넘긴다. allowlist에 없으면 그 요청이 거부되고
  // 조용히 결정론적 폴백으로 넘어가 LLM이 설정돼 있어도 실제로는 절대 호출되지
  // 않는다(PR #33 리뷰, doyeonid 지적 — ask의 LLM 경로가 항상 막혀 있었음).
  const privacyGateway = new ChunkingPrivacyGateway({
    allowedSources: [
      ...[...collectors, screenCollector].map((collector) => collector.sourceType),
      "conversation",
    ],
    allowedEmailAddresses: [],
  });

  const pipeline = new ContextPipeline({
    repository,
    privacyGateway,
    // provider가 없으면(.env 미설정) 기존 임시 규칙 추출기를 그대로 쓴다 — 회귀 없음.
    // 있으면 RetryAwareFactExtractor로 감싸 일시적 LLM 실패(retryable_failure)를
    // "사실 없음"과 구분해 throw한다 — incrementalSync.ts가 이미 갖고 있는 "오류난 배치는
    // 커밋 안 함" 규칙 덕분에 같은 RawItem이 다음 tick에 재시도된다(retryAwareFactExtractor.ts 참고).
    factExtractor: llmProvider !== undefined
      ? new RetryAwareFactExtractor(new LLMFactExtractor(llmProvider))
      : new TempHeuristicFactExtractor(),
    contextResolver: new DeterministicContextResolver(),
  });
  // watch가 저장한 알림 이력(evidenceStore)을 재알림 dedup(30분 억제)에 그대로 재사용한다.
  // watch를 한 번도 안 돌렸으면 listRecommendations()가 빈 배열이라 today/inbox 동작은 그대로다.
  // llmProvider가 undefined면 추천 문장도 기존 결정론적 템플릿으로 폴백한다. 있으면
  // MaskingLLMProvider로 감싸 phrasing.ts가 ContextItem.title 등을 마스킹 없이 그대로
  // Provider에 보내지 않게 한다(maskingLlmProvider.ts 참고) — ask/advise와 달리 phrasing.ts는
  // 자체 마스킹이 없어서 여기서만 필요하다.
  const recommendationEngine = new RuleBasedRecommendationEngine({
    history: pipeline.evidenceStore,
    llmProvider: llmProvider !== undefined
      ? new MaskingLLMProvider(llmProvider, privacyGateway)
      : undefined,
  });

  return {
    repository,
    profileRepository,
    notifier,
    recommendationEngine,
    syncStatus,
    pipeline,
    rawItemRepository,
    syncLock: createMutex(),
    collectors,
    screenCollector,
    // provider 없으면(.env 미설정) 기존 substring-매칭 placeholder로 폴백 — 회귀 없음.
    screenAdvicePolicy: llmProvider !== undefined
      ? new LlmScreenAdvicePolicy(llmProvider, privacyGateway)
      : defaultScreenAdvicePolicy,
    captureLiveScreen: () => captureActiveScreen(),
    llmProvider,
    privacyGateway,
    llmConfig,
    dbPath,
    sourcesConfigPath,
    sourcesConfigPathIsExplicit,
    sourcesConfigError,
    close,
  };
}

export function emptyProfile(): UserProfile {
  return {
    school: "",
    major: "",
    year: "",
    interests: [],
    activityTypes: [],
    preferredLocations: [],
    explicitConstraints: [],
  };
}
