// 아래 타입은 packages/shared/src/domain.ts로 이전을 제안 중인 초안이다.
// 팀 합의 전까지는 이 패키지 내부에서만 사용한다.
// 제안 배경: docs/proposals/context-repository-contract-extension.md
export type ContextChangeType =
  | "created"
  | "field_updated"
  | "status_changed"
  | "merged"
  | "evidence_added";

export interface ContextChangeEvent {
  id: string;
  contextItemId: string;
  changeType: ContextChangeType;
  field?: string;
  previousValue?: unknown;
  newValue?: unknown;
  evidenceId?: string;
  changedAt: string;
}
