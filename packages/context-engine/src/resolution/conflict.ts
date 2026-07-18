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
// 동률 비교는 observedAt 문자열이 아니라 Date.parse()로 얻은 실제 시각(ms)으로 한다 —
// UTC offset이 다른 Source(예: Calendar는 보통 Z, 이메일 헤더는 제각각)가 섞이면
// 문자열 순서와 실제 시간 순서가 달라져 오래된 근거를 최신으로 오판할 수 있기 때문이다.
// 파싱 불가능한 observedAt은 신뢰할 시각 정보가 없는 것으로 보고, 유효한 시각을 가진
// 쪽을 우선한다. 둘 다 파싱 불가면 기존 승자(a)를 그대로 유지한다(보수적 기본값).
export function resolveConflict(a: Evidence, b: Evidence): Evidence {
  const rankA = AUTHORITY_RANK[a.authority];
  const rankB = AUTHORITY_RANK[b.authority];
  if (rankA !== rankB) return rankA > rankB ? a : b;

  const msA = Date.parse(a.observedAt);
  const msB = Date.parse(b.observedAt);
  const validA = !Number.isNaN(msA);
  const validB = !Number.isNaN(msB);

  if (validA && validB) return msA >= msB ? a : b;
  if (validA) return a;
  if (validB) return b;
  return a;
}

export function strongestEvidence(evidence: Evidence[]): Evidence | undefined {
  return evidence.reduce<Evidence | undefined>(
    (best, candidate) => (best === undefined ? candidate : resolveConflict(best, candidate)),
    undefined,
  );
}
