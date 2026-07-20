import type { Collector, RawItem, SourceType } from "../../../../packages/shared/src/index.ts";
import { RawItemSyncService } from "../../../../packages/storage/src/index.ts";

// ContextPipeline.sync()는 collector.sync()가 반환한 RawItem을 전부(스킵 없이)
// 다시 Fact 추출·resolve한다(packages/context-engine, Intelligence 소유이므로 여기서
// 고치지 않는다). watch가 같은 Collector를 매 tick 다시 부르면 내용이 안 바뀐
// RawItem도 계속 재분석돼 변경 이력이 가짜로 쌓이고(팀 리뷰 지적), 실제 LLM이
// 붙으면 매 tick 불필요한 추론 비용도 든다.
//
// 이 래퍼는 Runtime 쪽 입력만 필터링한다: 안에서 실제 Collector를 부른 뒤
// RawItemSyncService(이미 Data & Storage가 만든 증분 판정 로직)로 걸러 created/
// updated만 pipeline에 넘긴다. sourceId/sourceType은 그대로 위임하므로 이 래퍼로
// 감싸도 SyncResult의 sourceId 등은 안 바뀐다 — collected 수치만 "이번 tick에
// 실제로 새로 처리한 개수"로 바뀐다(재분석 방지가 목적이므로 의도한 변화).
export class IncrementalCollector implements Collector {
  private readonly inner: Collector;
  private readonly syncService: RawItemSyncService;

  constructor(inner: Collector, syncService: RawItemSyncService) {
    this.inner = inner;
    this.syncService = syncService;
  }

  get sourceId(): string {
    return this.inner.sourceId;
  }

  get sourceType(): SourceType {
    return this.inner.sourceType;
  }

  async sync(): Promise<RawItem[]> {
    const rawItems = await this.inner.sync();
    const summary = await this.syncService.sync(rawItems);
    return summary.itemsToAnalyze;
  }
}
