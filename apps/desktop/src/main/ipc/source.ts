import { validateSourceInputConfig } from "../../../../../packages/collectors/src/index.ts";
import {
  listRegisteredSources,
  registerSchoolSiteSource,
  removeRegisteredSource,
  type RegisteredSourceType,
  type SourceListEntry,
} from "../../../../cli/src/runtime/sourceRegistration.ts";
import { fail, ok, toResult, type Result } from "./result.ts";

export function listSources(): Promise<Result<{ sources: SourceListEntry[] }>> {
  return toResult(async () => ({ sources: listRegisteredSources() }));
}

export interface RegisterSourceInput {
  type: RegisteredSourceType;
  value: string;
}

// docs/frontend-plan.md 2.3: 지금은 school-site만 등록 가능하다(sourceRegistration.ts
// 주석 참고 — school-email/lms는 안전한 기본값이 없는 필수 필드가 있다). 등록은
// dododo.sources.json만 쓰고 실행 중인 앱에는 반영되지 않는다 — restartRequired로
// Renderer가 "재시작 후 적용됩니다" 안내를 보여줄 수 있게 한다.
export async function registerSource(
  input: RegisterSourceInput,
): Promise<Result<{ restartRequired: true }>> {
  if (input.type !== "school-site") {
    return fail("not-supported", `${input.type} 등록은 아직 지원하지 않습니다(school-site만 가능).`);
  }

  const value = input.value.trim();
  if (value === "") return fail("validation", "URL을 입력해주세요.");

  // 김도현 리뷰(PR #67): URL 형식 오류가 toResult() 안에서 던져지면 전부 "unknown"으로
  // 뭉개진다 — result.ts의 관례대로(#64의 combineLocalDateTime과 같은 패턴) 검증은
  // toResult() 밖에서 먼저 하고 fail("validation", ...)로 바로 반환한다.
  // registerSchoolSiteSource가 내부적으로도 병합된 전체 설정 기준으로 다시 검증하지만,
  // 여기서는 URL 하나만 미리 같은 함수로 형식 확인해 실패 코드가 정확히 나가게 한다.
  try {
    validateSourceInputConfig({ schoolSite: { url: value } });
  } catch (error) {
    return fail("validation", error instanceof Error ? error.message : String(error));
  }

  return toResult(async () => {
    registerSchoolSiteSource(value);
    return { restartRequired: true };
  });
}

export async function removeSource(id: RegisteredSourceType): Promise<Result<{ restartRequired: true }>> {
  const result = await toResult(async () => removeRegisteredSource(id));
  if (!result.ok) return result;
  if (!result.data) return fail("not-found", `등록된 ${id} Source가 없습니다.`);
  return ok({ restartRequired: true });
}
