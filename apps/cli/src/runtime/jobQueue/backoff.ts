// docs/llm-architecture.md §5: 재시도 한도 + 지수 Backoff. 30초에서 시작해 실패할
// 때마다 두 배로 늘리고 1시간에서 상한을 둔다 — LLM 서버가 잠깐 죽었을 때는 금방
// 다시 시도하고, 오래 죽어 있으면 tick마다(예: 5분) 헛수고하지 않는다.
const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 60 * 60_000;

export function computeBackoffDelayMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  const delay = BASE_DELAY_MS * 2 ** exponent;
  return Math.min(delay, MAX_DELAY_MS);
}
