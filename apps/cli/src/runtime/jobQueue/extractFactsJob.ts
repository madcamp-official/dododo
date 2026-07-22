import type { ContextPipeline } from "../../../../../packages/context-engine/src/index.ts";
import type { Collector, RawItem, SourceType } from "../../../../../packages/shared/src/index.ts";
import type { RawItemRepository } from "../../../../../packages/storage/src/index.ts";
import type { JobHandler } from "./worker.ts";

// pipeline.sync()는 Collector 하나가 반환한 RawItem 배열 전체를 처리하는 계약이라,
// 큐에서 꺼낸 RawItem 하나만 다시 태우기 위해 그 값만 돌려주는 1회용 Collector로
// 감싼다 — incrementalSync.ts의 FixedItemsCollector와 같은 패턴이지만 그 파일을
// 건드리지 않기 위해 여기 따로 둔다(둘 다 사소해서 공유 추상화를 만들 정도는 아니다).
class SingleRawItemCollector implements Collector {
  readonly sourceId: string;
  readonly sourceType: SourceType;
  private readonly item: RawItem;

  constructor(item: RawItem) {
    this.item = item;
    this.sourceId = item.sourceId;
    this.sourceType = item.sourceType;
  }

  async sync(): Promise<RawItem[]> {
    return [this.item];
  }
}

export interface ExtractFactsJobDependencies {
  rawItemRepository: RawItemRepository;
  pipeline: ContextPipeline;
}

// extract_facts Job의 실제 처리: inputRef는 RawItem id다. incrementalSync.ts가 배치
// 실패 시 이 Job을 enqueue하기 전에 이미 rawItemRepository.save()로 RawItem 자체는
// 저장해 뒀으므로(관찰 자체를 잃지 않기 위해), 여기서는 그 RawItem을 다시 읽어
// Fact 추출·Context 해석만 재시도한다.
export function createExtractFactsJobHandler(dependencies: ExtractFactsJobDependencies): JobHandler {
  return async function extractFactsJobHandler(rawItemId: string): Promise<void> {
    const item = await dependencies.rawItemRepository.findById(rawItemId);
    if (item === undefined) {
      // RawItem이 이미 없어졌으면(이론상 삭제 기능이 없어 드묾) 재처리할 대상이
      // 없다 — 실패가 아니라 "할 일 없음"으로 보고 성공 처리해 Dead Letter로
      // 영원히 남기지 않는다.
      return;
    }

    const result = await dependencies.pipeline.sync(new SingleRawItemCollector(item));
    if (result.errors.length > 0) {
      throw new Error(result.errors.join("; "));
    }
  };
}
