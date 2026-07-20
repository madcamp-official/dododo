import type { Recommendation } from "../../shared/src/index.ts";

export function shouldSuppress(recommendation: Recommendation, now: Date): boolean {
  return recommendation.suppressedUntil !== undefined
    && new Date(recommendation.suppressedUntil) > now;
}
