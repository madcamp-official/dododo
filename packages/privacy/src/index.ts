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

// 화면 원본 이미지가 실수로 metadata에 담겨 외부 LLM으로 나가는 것을 막기 위한 키 목록.
// README 로컬·외부 경계 표: "화면 원본 이미지는 외부 전송 X, 요약 텍스트만 전송".
const SCREEN_IMAGE_KEYS = ["screenshot", "screenshotBase64", "imageData", "imageBytes", "rawImage"];

export interface ChunkingPrivacyGatewayOptions {
  allowedSources: SourceType[];
  allowedEmailDomains?: string[];
  maxChars?: number;
}

// LLM 전달 전 개인정보 정책을 적용하는 Gateway. allowlist 확인(기존 동작)에 더해
// (1) 필요한 최소 Chunk만 선택하고 (2) 개인정보를 마스킹한다. 반환하는 RawItem은
// "LLM에 보내도 되는 안전한 사본"이며, 원본 RawItem은 파이프라인이 그대로 보관해
// Evidence의 출처·위치는 정확하게 유지된다(pipeline.ts 참고).
export class ChunkingPrivacyGateway implements PrivacyGateway {
  private readonly allowedSources: Set<SourceType>;
  private readonly allowedEmailDomains: string[];
  private readonly maxChars: number | undefined;

  constructor(options: ChunkingPrivacyGatewayOptions) {
    this.allowedSources = new Set(options.allowedSources);
    this.allowedEmailDomains = options.allowedEmailDomains ?? [];
    this.maxChars = options.maxChars;
  }

  async prepare(rawItem: RawItem): Promise<RawItem> {
    if (!this.allowedSources.has(rawItem.sourceType)) {
      throw new Error(`Source is not allowed: ${rawItem.sourceType}`);
    }

    if (rawItem.sourceType === "screen") {
      assertNoRawImage(rawItem);
    }

    const selected = selectRelevantContent(rawItem.content, {
      maxChars: this.maxChars,
      title: rawItem.title,
    });
    const safeContent = maskSensitiveText(selected, {
      allowedEmailDomains: this.allowedEmailDomains,
    });

    const safe = structuredClone(rawItem);
    safe.content = safeContent;
    if (safe.title !== undefined) {
      safe.title = maskSensitiveText(safe.title, { allowedEmailDomains: this.allowedEmailDomains });
    }
    return safe;
  }
}

function assertNoRawImage(rawItem: RawItem): void {
  for (const key of SCREEN_IMAGE_KEYS) {
    if (rawItem.metadata[key] !== undefined) {
      throw new Error(`화면 원본 이미지는 외부 전송할 수 없습니다: metadata.${key}`);
    }
  }
}
