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

const mockOpportunity = {
  id: "mock-opportunity-ai-hackathon",
  kind: "opportunity",
  title: "대학생 AI 해커톤",
  status: "new",
  deadline: "2026-07-25T18:00:00+09:00",
};

// Main/Preload 공동 IPC 계약이 연결되기 전 Renderer 개발용 어댑터다. UI에서는 이 객체만
// 호출하므로 실제 window.desktopApi가 준비되면 구현을 교체하고 화면 코드는 유지한다.
export const desktopApi = {
  async today() {
    return ok({
      items: mockItems.map((item, index) => ({
        item,
        score: index === 0 ? 82 : 55,
        reason: index === 0 ? "내일 마감" : "오늘 예정된 일정",
      })),
    });
  },
  async calendar() {
    return ok({
      items: mockItems.map((item) => ({ item, at: item.startAt ?? item.deadline })),
    });
  },
  async inbox() {
    return ok({
      items: [{
        item: mockOpportunity,
        score: 70,
        reason: "AI 관심 분야와 관련된 새로운 공지예요.",
      }],
    });
  },
  async ask(question) {
    return ok({
      answer: `“${question}”에 대한 답변은 실제 IPC 연결 후 로컬 Context에서 찾습니다.`,
      evidenceIds: [],
      evidence: [],
    });
  },
  async sync() {
    return ok({ collected: 3, created: 1 });
  },
};

export function unwrapResult(result) {
  if (result?.ok === true) return result.data;
  const message = result?.error?.message;
  throw new Error(typeof message === "string" && message !== "" ? message : "요청 처리에 실패했습니다.");
}

export function formatSyncSummary({ collected, created }) {
  if (collected === 0) return "확인한 항목이 없습니다.";
  if (created === 0) return `${collected}개 항목을 확인했고, 새로 저장된 항목은 없어요.`;
  return `${collected}개 항목을 확인했고, 새 항목 ${created}개를 저장했어요.`;
}

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

function ok(data) {
  return { ok: true, data };
}
