import type { ContextItem, Recommendation, UserProfile } from "../../../shared/src/index.ts";
import { pickSubjectSignal } from "../resolution/mergeScore.ts";

const EXCLUDED_STATUSES: ReadonlySet<ContextItem["status"]> = new Set([
  "done",
  "cancelled",
  "dismissed",
  "expired",
]);

// domain.ts에 Snooze 전용 필드가 없어 apps/cli/src/runtime/snooze.ts가 이미
// ContextItem.metadata.snoozedUntil 관례로 처리하고 있다. context-engine은
// apps/cli/에 의존할 수 없으므로(AGENTS.md 모듈 경계) 같은 키를 여기서 독립적으로
// 다시 읽는다 — 로직이 갈라지지 않도록 두 곳 다 이 주석을 남긴다.
const SNOOZED_UNTIL_KEY = "snoozedUntil";

function isSnoozed(item: ContextItem, now: Date): boolean {
  const value = item.metadata[SNOOZED_UNTIL_KEY];
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value) > now;
}

const KIND_BASE_IMPORTANCE: Partial<Record<ContextItem["kind"], number>> = {
  task: 15,
  event: 10,
  opportunity: 5,
};

const RECENT_SUPPRESS_MINUTES = 30;
const RECENT_DECAY_MINUTES = 120;
const DEFAULT_TIMEZONE = "Asia/Seoul";

export interface PriorityContext {
  now: Date;
  profile: UserProfile;
  recentRecommendations: Recommendation[];
  // Stage 6(화면 Activity 연결)이 실제 값을 채우기 전까지는 0으로 둔다.
  currentActivityRelevance?: number;
}

export interface PriorityBreakdown {
  total: number;
  deadlineUrgency: number;
  importance: number;
  unmetRequirements: number;
  todayRelated: number;
  currentActivity: number;
  recentNotificationPenalty: number;
  excluded: boolean;
  excludedReason?: string;
}

// Priority = 마감 긴급도 + 중요도 + 미완료 요구사항 + 오늘 관련 일정 + 현재 작업 관련도
//            − 최근 알림 패널티 (README "우선순위 계산" 섹션).
// todayEvents는 recommendation/index.ts가 전체 items에서 미리 뽑아 전달한다 — 이
// 함수 자체는 항목 하나만 보고 계산하는 순수 함수로 유지한다.
export function computePriority(
  item: ContextItem,
  todayEvents: ContextItem[],
  ctx: PriorityContext,
): PriorityBreakdown {
  if (EXCLUDED_STATUSES.has(item.status)) {
    return excluded(`status: ${item.status}`);
  }
  if (isSnoozed(item, ctx.now)) {
    return excluded("snoozed");
  }

  const recentPenalty = recentNotificationPenalty(item, ctx.recentRecommendations, ctx.now);
  if (recentPenalty.excluded) {
    return excluded("동일 추천이 30분 이내에 이미 있었음");
  }

  const deadlineUrgency = deadlineUrgencyScore(item.deadline ?? item.startAt, ctx.now);
  const importance = importanceScore(item, ctx.profile);
  const unmetRequirements = Math.min(item.requirements.length * 5, 15);
  const todayRelated = Math.min(countTodayRelatedEvents(item, todayEvents) * 5, 15);
  const currentActivity = clamp(ctx.currentActivityRelevance ?? 0, 0, 15);

  const total = clamp(
    deadlineUrgency + importance + unmetRequirements + todayRelated + currentActivity - recentPenalty.penalty,
    0,
    100,
  );

  return {
    total,
    deadlineUrgency,
    importance,
    unmetRequirements,
    todayRelated,
    currentActivity,
    recentNotificationPenalty: recentPenalty.penalty,
    excluded: false,
  };
}

export function findTodayEvents(items: ContextItem[], now: Date, timeZone: string = DEFAULT_TIMEZONE): ContextItem[] {
  const todayKey = toDateKey(now, timeZone);
  return items.filter((item) =>
    item.kind === "event"
    && item.startAt !== undefined
    && !Number.isNaN(Date.parse(item.startAt))
    && toDateKey(new Date(item.startAt), timeZone) === todayKey
  );
}

function toDateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(date);
}

function countTodayRelatedEvents(item: ContextItem, todayEvents: ContextItem[]): number {
  if (item.kind === "event") return 0;
  const subject = pickSubjectSignal(item.metadata);
  if (subject === undefined) return 0;
  return todayEvents.filter((event) => pickSubjectSignal(event.metadata) === subject).length;
}

// 마감까지 남은 시간이 짧을수록 점수가 높다. 이미 지난 마감(overdue)도 무한정
// 커지지 않고 40점에서 캡되고, 7일(168시간) 이상 남았으면 0점이다.
function deadlineUrgencyScore(deadline: string | undefined, now: Date): number {
  if (deadline === undefined) return 0;
  const deadlineMs = Date.parse(deadline);
  if (Number.isNaN(deadlineMs)) return 0;

  const hoursLeft = (deadlineMs - now.getTime()) / (1000 * 60 * 60);
  const clampedHours = clamp(hoursLeft, 0, 168);
  return 40 * (1 - clampedHours / 168);
}

// kind별 기본 중요도에 profile.interests/activityTypes와 태그가 겹치는 만큼 가산한다.
// tags는 resolution/index.ts가 생성 시점에 kind와 course/category로 채운다.
function importanceScore(item: ContextItem, profile: UserProfile): number {
  const base = KIND_BASE_IMPORTANCE[item.kind] ?? 0;
  const interestSignals = new Set([...profile.interests, ...profile.activityTypes]);
  const overlapCount = item.tags.filter((tag) => interestSignals.has(tag)).length;
  const interestBonus = Math.min(overlapCount * 5, 10);
  return Math.min(base + interestBonus, 20);
}

// "동일 추천은 30분 내 반복하지 않는다"(README)를 두 단계로 구현한다: 30분 이내는
// 아예 제외(excluded)하고, 30분~2시간 사이는 -20에서 0으로 선형 감소하는 패널티만
// 줘서 억제가 풀린 직후 곧바로 다시 최상단으로 튀어오르지 않게 한다.
function recentNotificationPenalty(
  item: ContextItem,
  recent: Recommendation[],
  now: Date,
): { excluded: boolean; penalty: number } {
  const lastMs = recent
    .filter((recommendation) => recommendation.contextItemId === item.id)
    .map((recommendation) => Date.parse(recommendation.createdAt))
    .filter((ms) => !Number.isNaN(ms))
    .reduce<number | undefined>((latest, ms) => (latest === undefined || ms > latest ? ms : latest), undefined);

  if (lastMs === undefined) return { excluded: false, penalty: 0 };

  const minutesAgo = (now.getTime() - lastMs) / (1000 * 60);
  if (minutesAgo < RECENT_SUPPRESS_MINUTES) return { excluded: true, penalty: 20 };
  if (minutesAgo >= RECENT_DECAY_MINUTES) return { excluded: false, penalty: 0 };

  const decayWindow = RECENT_DECAY_MINUTES - RECENT_SUPPRESS_MINUTES;
  const penalty = 20 * (1 - (minutesAgo - RECENT_SUPPRESS_MINUTES) / decayWindow);
  return { excluded: false, penalty };
}

function excluded(reason: string): PriorityBreakdown {
  return {
    total: -Infinity,
    deadlineUrgency: 0,
    importance: 0,
    unmetRequirements: 0,
    todayRelated: 0,
    currentActivity: 0,
    recentNotificationPenalty: 0,
    excluded: true,
    excludedReason: reason,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
