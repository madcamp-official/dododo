import type { LLMJSONRequest, LLMProvider } from "../../../../packages/context-engine/src/index.ts";
import type { PrivacyGateway, RawItem } from "../../../../packages/shared/src/index.ts";

// generateActionAndReason(추천 문장 생성, packages/context-engine/src/recommendation/phrasing.ts)은
// ContextItem.title 등을 마스킹 없이 바로 provider.completeJSON()에 넘긴다(PR #33 리뷰,
// doyeonid 지적) — add로 입력한 일정 제목엔 이름·장소 같은 개인정보가 들어갈 수 있어
// "Provider 호출 전 PrivacyGateway 통과" 규칙(AGENTS.md)과 충돌한다.
//
// ask(qa.ts)와 advise --screen(adviceLookup.ts)은 이미 자기 안에서 직접
// privacyGateway.prepare()를 거친 뒤 provider를 호출하므로, 거기에 이 래퍼를 또 씌우면
// 이미 마스킹된 텍스트를 다시 마스킹하는 이중 처리라 오히려 위험하다(예: 마스킹 placeholder가
// 또 한 번 chunk 선택/마스킹 대상이 됨). 그래서 이 래퍼는 RuleBasedRecommendationEngine에
// 주입하는 llmProvider에만 한정해서 쓴다 — phrasing.ts 자체(Context Intelligence 소유)는
// 안 건드리고 Runtime 쪽 provider 주입 지점에서만 마스킹을 강제한다.
export class MaskingLLMProvider implements LLMProvider {
  private readonly inner: LLMProvider;
  private readonly privacyGateway: PrivacyGateway;

  constructor(inner: LLMProvider, privacyGateway: PrivacyGateway) {
    this.inner = inner;
    this.privacyGateway = privacyGateway;
  }

  async completeJSON<T>(request: LLMJSONRequest<T>): Promise<T> {
    const safe = await this.privacyGateway.prepare(toRawItem(request.userPrompt));
    return this.inner.completeJSON({ ...request, userPrompt: safe.content });
  }
}

// privacyGateway.prepare()는 RawItem 계약을 요구할 뿐 저장되거나 Evidence로 남지 않는
// 휘발성 프롬프트다 — sourceType은 qa.ts의 promptRawItem과 같은 "conversation"을 쓴다
// (container.ts의 allowedSources에 이미 포함돼 있어야 한다).
function toRawItem(userPrompt: string): RawItem {
  return {
    id: "raw-recommendation-phrasing",
    sourceId: "conversation",
    sourceType: "conversation",
    uri: "conversation://recommendation-phrasing",
    content: userPrompt,
    contentHash: "ephemeral",
    observedAt: new Date().toISOString(),
    metadata: {},
  };
}
