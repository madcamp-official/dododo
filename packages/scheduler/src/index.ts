import type { Notifier, Recommendation } from "../../shared/src/index.ts";

export class ConsoleNotifier implements Notifier {
  async send(recommendation: Recommendation): Promise<void> {
    console.log(`[notification] ${recommendation.action} — ${recommendation.reason}`);
  }
}

export function shouldSuppress(
  recommendation: Recommendation,
  now: Date,
): boolean {
  return recommendation.suppressedUntil !== undefined
    && new Date(recommendation.suppressedUntil) > now;
}
