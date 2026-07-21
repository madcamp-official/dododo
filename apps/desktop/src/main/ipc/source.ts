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
