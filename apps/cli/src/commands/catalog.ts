export interface CommandDefinition {
  name: string;
  description: string;
  owner: "runtime" | "data" | "intelligence" | "shared";
  status: "ready" | "skeleton";
}

export const commandCatalog: CommandDefinition[] = [
  { name: "help", description: "명령 목록을 표시합니다", owner: "runtime", status: "ready" },
  { name: "doctor", description: "환경과 모듈 상태를 확인합니다", owner: "runtime", status: "ready" },
  { name: "setup", description: "사용자 프로필과 Source를 설정합니다", owner: "shared", status: "ready" },
  { name: "sync", description: "등록된 Source를 한 번 동기화합니다", owner: "data", status: "ready" },
  { name: "task", description: "Task 상세 조회, 완료 처리, Snooze", owner: "runtime", status: "ready" },
  { name: "watch", description: "주기 동기화와 알림을 실행합니다 (기본 지속 실행, --once로 1회, --interval <seconds>, --os-notify로 OS 알림)", owner: "runtime", status: "ready" },
  { name: "inbox", description: "추천 Opportunity를 표시합니다", owner: "intelligence", status: "ready" },
  { name: "today", description: "오늘의 Task와 Event를 표시합니다", owner: "intelligence", status: "ready" },
  { name: "ask", description: "로컬 Context를 기반으로 답합니다", owner: "runtime", status: "ready" },
  { name: "add", description: "자연어로 Task 또는 Event를 추가합니다", owner: "runtime", status: "ready" },
  { name: "advise", description: "현재 화면과 Context를 바탕으로 조언합니다 (--screen [--live])", owner: "runtime", status: "ready" },
  { name: "screen", description: "화면 캡처를 한 번 수집해 Context에 반영합니다 (수동)", owner: "runtime", status: "ready" },
  { name: "evidence", description: "Context ID의 원본 근거(출처·인용·관찰 시각)를 표시합니다", owner: "runtime", status: "ready" },
];
