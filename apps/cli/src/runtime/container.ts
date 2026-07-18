import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ContextPipeline,
  DeterministicContextResolver,
  RuleBasedRecommendationEngine,
} from "../../../../packages/context-engine/src/index.ts";
import { FixtureCollector } from "../../../../packages/collectors/src/index.ts";
import { AllowlistPrivacyGateway } from "../../../../packages/privacy/src/index.ts";
import { InMemoryProfileRepository } from "../../../../packages/profile/src/index.ts";
import { ConsoleNotifier, SyncStatusStore } from "../../../../packages/scheduler/src/index.ts";
import { InMemoryContextRepository } from "../../../../packages/storage/src/index.ts";
import type {
  Collector,
  ContextRepository,
  Notifier,
  ProfileRepository,
  RawItem,
  RecommendationEngine,
  UserProfile,
} from "../../../../packages/shared/src/index.ts";
import { TempHeuristicFactExtractor } from "./tempFactExtractor.ts";

// Fixture 기반 데모 Source. 실제 Collector(school-site/school-email/lms)는 아직 미구현이라
// Data & Storage 팀 작업이 끝날 때까지 fixtures/*.json을 RawItem으로 읽어 대신한다.
const FIXTURE_DIRS = ["school-site", "school-email", "lms"];

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
  const bySourceId = new Map<string, RawItem[]>();

  for (const dir of FIXTURE_DIRS) {
    const dirPath = join(repoRoot, "fixtures", dir);
    let fileNames: string[];
    try {
      fileNames = readdirSync(dirPath).filter((name) => name.endsWith(".json"));
    } catch {
      continue;
    }

    for (const fileName of fileNames) {
      const raw = JSON.parse(readFileSync(join(dirPath, fileName), "utf8")) as RawItem;
      const items = bySourceId.get(raw.sourceId) ?? [];
      items.push(raw);
      bySourceId.set(raw.sourceId, items);
    }
  }

  return [...bySourceId.entries()].map(
    ([sourceId, items]) => new FixtureCollector(sourceId, items[0].sourceType, items),
  );
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
