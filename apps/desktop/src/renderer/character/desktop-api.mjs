const mockItems = [
  {
    id: "mock-task-os-report",
    kind: "task",
    title: "운영체제 과제 3",
    status: "todo",
    deadline: "2026-07-22T18:00:00+09:00",
  },
  {
    id: "mock-event-team-meeting",
    kind: "event",
    title: "팀 회의",
    status: "confirmed",
    startAt: "2026-07-21T15:00:00+09:00",
  },
];

// Main/Preload 공동 IPC 계약이 연결되기 전 Renderer 개발용 어댑터다. UI에서는 이 객체만
// 호출하므로 실제 window.dododo API가 준비되면 구현을 교체하고 화면 코드는 유지한다.
export const desktopApi = {
  async today() {
    return { items: mockItems };
  },
  async calendar() {
    return { items: mockItems };
  },
  async inbox() {
    return {
      recommendations: [{
        id: "mock-opportunity-ai-hackathon",
        title: "대학생 AI 해커톤",
        reason: "AI 관심 분야와 관련된 새로운 공지예요.",
        deadline: "2026-07-25T18:00:00+09:00",
      }],
    };
  },
  async ask(question) {
    return { answer: `“${question}”에 대한 답변은 실제 IPC 연결 후 로컬 Context에서 찾습니다.` };
  },
  async sync() {
    return { collected: 3, created: 1, message: "새 항목 1개를 포함해 3개 Source를 확인했어요." };
  },
};

export function formatDateTime(value) {
  if (value === undefined) return "시간 정보 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "시간 확인 필요";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function statusLabel(status) {
  return ({ todo: "할 일", confirmed: "예정", preparing: "준비 중", done: "완료" })[status] ?? "확인 필요";
}
