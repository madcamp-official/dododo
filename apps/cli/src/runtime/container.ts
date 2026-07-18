import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ContextPipeline,
  DeterministicContextResolver,
  RuleBasedRecommendationEngine,
} from "../../../../packages/context-engine/src/index.ts";
import { JsonFixtureCollector } from "../../../../packages/collectors/src/index.ts";
import { AllowlistPrivacyGateway } from "../../../../packages/privacy/src/index.ts";
import { InMemoryProfileRepository } from "../../../../packages/profile/src/index.ts";
import { ConsoleNotifier, SyncStatusStore } from "../../../../packages/scheduler/src/index.ts";
import { InMemoryContextRepository } from "../../../../packages/storage/src/index.ts";
import type {
  Collector,
  ContextRepository,
  Notifier,
  ProfileRepository,
  RecommendationEngine,
  SourceType,
  UserProfile,
} from "../../../../packages/shared/src/index.ts";
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
  collectors: Collector[];
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

export function createCliContainer(): CliContainer {
  const repository = new InMemoryContextRepository();
  const profileRepository = new InMemoryProfileRepository();
  const notifier = new ConsoleNotifier();
  const recommendationEngine = new RuleBasedRecommendationEngine();
  const syncStatus = new SyncStatusStore();
  const collectors = loadFixtureCollectors();

  const pipeline = new ContextPipeline({
    repository,
    privacyGateway: new AllowlistPrivacyGateway(collectors.map((collector) => collector.sourceType)),
    factExtractor: new TempHeuristicFactExtractor(),
    contextResolver: new DeterministicContextResolver(),
  });

  return {
    repository,
    profileRepository,
    notifier,
    recommendationEngine,
    syncStatus,
    pipeline,
    collectors,
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
