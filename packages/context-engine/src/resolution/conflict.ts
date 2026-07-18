import type { Evidence } from "../../../shared/src/index.ts";

// README의 충돌 우선순위(최신 공식 공지 > 지정 공식 문서 > 외부 Calendar > 화면 분석 >
// LLM 추정)는 5단계지만, domain.ts의 Evidence.authority는 4개 값(official/user/
// observation/derived)만 있어 그대로 옮길 수 없다. "최신 공식 공지"와 "지정 공식
// 문서"는 둘 다 official로 합쳐지고, "외부 Calendar"는 resolution/evidence.ts에서
// user 등급으로 매핑한다(파일 출처와 동급) — 원래 계획보다 한 단계 더 신뢰하는
// 셈이라, 실제로 문제가 생기면 domain.ts에 전용 등급 추가를 팀에 제안해야 한다.
const AUTHORITY_RANK: Record<Evidence["authority"], number> = {
  official: 3,
  user: 2,
  observation: 1,
  derived: 0,
};

// 두 Evidence가 같은 필드에 대해 서로 다른 값을 뒷받침할 때 어느 쪽을 믿을지 정한다.
// 권위가 높은 쪽이 우선하고, 권위가 같으면 더 최근에 관찰된 쪽이 우선한다.
export function resolveConflict(a: Evidence, b: Evidence): Evidence {
  const rankA = AUTHORITY_RANK[a.authority];
  const rankB = AUTHORITY_RANK[b.authority];
  if (rankA !== rankB) return rankA > rankB ? a : b;
  return a.observedAt >= b.observedAt ? a : b;
}

export function strongestEvidence(evidence: Evidence[]): Evidence | undefined {
  return evidence.reduce<Evidence | undefined>(
    (best, candidate) => (best === undefined ? candidate : resolveConflict(best, candidate)),
    undefined,
  );
}
