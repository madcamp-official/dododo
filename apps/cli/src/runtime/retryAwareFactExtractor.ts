import type { LLMFactExtractor } from "../../../../packages/context-engine/src/index.ts";
import type { Fact, FactExtractor, RawItem } from "../../../../packages/shared/src/index.ts";

// LLMFactExtractor.extract()는 FactExtractor 계약(Promise<Fact[]>)을 맞추려고 재시도
// 가능한 일시적 실패(retryable_failure)와 "LLM이 명시적으로 사실 없음을 반환"(no_facts)을
// 똑같이 빈 배열로 합쳐서 반환한다. pipeline.sync()는 그래서 이걸 오류로 못 보고,
// incrementalSync.ts는 result.errors가 비어 있으니 해당 RawItem을 처리완료로
// rawItemRepository에 커밋해버린다 — 같은 contentHash는 다음 tick에 "안 바뀜"으로
// 걸러져서, Ollama가 복구돼도 그 RawItem은 영영 재분석되지 않는다(PR #33 리뷰,
// doyeonid 지적). extractWithStatus()로 retryable_failure만 구분해 throw하면
// pipeline.sync()가 그 Source를 오류로 보고하고, incrementalSync.ts가 이미 갖고 있는
// "오류난 배치는 커밋하지 않는다" 규칙이 그대로 다음 tick 재시도를 보장한다 —
// context-engine의 pipeline.ts 계약은 안 건드리고 Runtime 쪽에서만 해결한다.
export class RetryAwareFactExtractor implements FactExtractor {
  private readonly inner: LLMFactExtractor;

  constructor(inner: LLMFactExtractor) {
    this.inner = inner;
  }

  async extract(rawItem: RawItem): Promise<Fact[]> {
    const outcome = await this.inner.extractWithStatus(rawItem);
    if (outcome.status === "retryable_failure") {
      const reason = outcome.error?.message ?? "알 수 없는 오류";
      throw new Error(`일시적 LLM 오류로 재시도가 필요합니다 (${rawItem.id}): ${reason}`);
    }
    return outcome.facts;
  }
}
