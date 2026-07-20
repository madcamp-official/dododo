import type { PrivacyGateway, RawItem, SourceType } from "../../shared/src/index.ts";
import { selectRelevantContent } from "./chunking.ts";
import { maskSensitiveText } from "./masking.ts";

export * from "./chunking.ts";
export * from "./masking.ts";

export class AllowlistPrivacyGateway implements PrivacyGateway {
  private readonly allowedSources: Set<SourceType>;

  constructor(allowedSources: SourceType[]) {
    this.allowedSources = new Set(allowedSources);
  }

  async prepare(rawItem: RawItem): Promise<RawItem> {
    if (!this.allowedSources.has(rawItem.sourceType)) {
      throw new Error(`Source is not allowed: ${rawItem.sourceType}`);
    }

    return structuredClone(rawItem);
  }
}

export interface ChunkingPrivacyGatewayOptions {
  allowedSources: SourceType[];
  // 외부 전달이 꼭 필요한 비개인 공식 주소만 정확한 주소 단위로 허용한다.
  // 도메인 전체 허용은 같은 학교 도메인의 학생·교직원 개인 주소까지 노출하므로 금지한다.
  allowedEmailAddresses?: string[];
  maxChars?: number;
}

// LLM 전달 전 개인정보 정책을 적용하는 Gateway. allowlist 확인(기존 동작)에 더해
// (1) 필요한 최소 Chunk만 선택하고 (2) 개인정보를 마스킹한다. 반환하는 RawItem은
// "LLM에 보내도 되는 안전한 사본"이며, 원본 RawItem은 파이프라인이 그대로 보관해
// Evidence의 출처·위치는 정확하게 유지된다(pipeline.ts 참고).
export class ChunkingPrivacyGateway implements PrivacyGateway {
  private readonly allowedSources: Set<SourceType>;
  private readonly allowedEmailAddresses: string[];
  private readonly maxChars: number | undefined;

  constructor(options: ChunkingPrivacyGatewayOptions) {
    this.allowedSources = new Set(options.allowedSources);
    this.allowedEmailAddresses = options.allowedEmailAddresses ?? [];
    this.maxChars = options.maxChars;
  }

  async prepare(rawItem: RawItem): Promise<RawItem> {
    if (!this.allowedSources.has(rawItem.sourceType)) {
      throw new Error(`Source is not allowed: ${rawItem.sourceType}`);
    }

    const selected = selectRelevantContent(rawItem.content, {
      maxChars: this.maxChars,
      title: rawItem.title,
    });
    const safeContent = maskSensitiveText(selected, {
      allowedEmailAddresses: this.allowedEmailAddresses,
    });

    const safe = structuredClone(rawItem);
    safe.content = safeContent;
    if (safe.title !== undefined) {
      safe.title = maskSensitiveText(safe.title, {
        allowedEmailAddresses: this.allowedEmailAddresses,
      });
    }
    // screen metadata는 자유 형식이라 키 blacklist로 원본 이미지 유출을 완전히 막을 수 없다.
    // 현재 LLM 추출은 metadata를 사용하지 않으므로 화면 안전 사본에는 아무 필드도 전달하지 않는다.
    if (safe.sourceType === "screen") safe.metadata = {};
    return safe;
  }
}
