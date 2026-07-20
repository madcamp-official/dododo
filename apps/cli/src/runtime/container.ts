import { readdirSync } from "node:fs";
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
import { createLlmProvider } from "./llmProvider.ts";
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

export function createCliContainer(): CliContainer {
  const repository = new InMemoryContextRepository();
  const profileRepository = new InMemoryProfileRepository();
  const notifier = new ConsoleNotifier();
  const syncStatus = new SyncStatusStore();
  // sync/watch가 syncIncrementally로 이 저장소를 써서 변경 없는 RawItem은 재분석을
  // 건너뛴다. screenCollector는 여기 관여하지 않는다 — advise --screen은 매번
  // "지금" 활동 스냅샷을 원하지 "지난번과 다를 때만"이 아니다.
  const rawItemRepository = new InMemoryRawItemRepository();
  const collectors = loadFixtureCollectors();
  const screenCollector = loadScreenCollector();
  const llmProvider = createLlmProvider();

  // screenCollector는 collectors 배열엔 없지만(자동 sync/watch 대상 아님) 수동
  // screen/advise 명령이 pipeline.sync()를 직접 호출하므로 allowlist엔 포함해야
  // "Source is not allowed: screen"으로 조용히 막히지 않는다.
  // 마스킹+Chunk 선택 적용(#21). allowedEmailAddresses는 실제 학교 공식 발신 주소가
  // 정해지면 채운다(이슈#27 논의 1번, 도메인 전체 허용은 금지 — masking.ts 참고). 지금은
  // 비워둬서 모든 이메일 주소가 안전하게 마스킹된다(과소 노출 쪽으로 fail). advise의
  // LlmScreenAdvicePolicy도 이 인스턴스를 그대로 재사용한다(마스킹 정책 이원화 방지).
  const privacyGateway = new ChunkingPrivacyGateway({
    allowedSources: [...collectors, screenCollector].map((collector) => collector.sourceType),
    allowedEmailAddresses: [],
  });

  const pipeline = new ContextPipeline({
    repository,
    privacyGateway,
    // provider가 없으면(.env 미설정) 기존 임시 규칙 추출기를 그대로 쓴다 — 회귀 없음.
    factExtractor: llmProvider !== undefined
      ? new LLMFactExtractor(llmProvider)
      : new TempHeuristicFactExtractor(),
    contextResolver: new DeterministicContextResolver(),
  });
  // watch가 저장한 알림 이력(evidenceStore)을 재알림 dedup(30분 억제)에 그대로 재사용한다.
  // watch를 한 번도 안 돌렸으면 listRecommendations()가 빈 배열이라 today/inbox 동작은 그대로다.
  // llmProvider가 undefined면 추천 문장도 기존 결정론적 템플릿으로 폴백한다.
  const recommendationEngine = new RuleBasedRecommendationEngine({
    history: pipeline.evidenceStore,
    llmProvider,
  });

  return {
    repository,
    profileRepository,
    notifier,
    recommendationEngine,
    syncStatus,
    pipeline,
    rawItemRepository,
    collectors,
    screenCollector,
    // provider 없으면(.env 미설정) 기존 substring-매칭 placeholder로 폴백 — 회귀 없음.
    screenAdvicePolicy: llmProvider !== undefined
      ? new LlmScreenAdvicePolicy(llmProvider, privacyGateway)
      : defaultScreenAdvicePolicy,
    captureLiveScreen: () => captureActiveScreen(),
    llmProvider,
    privacyGateway,
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
