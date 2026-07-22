const EXPRESSIONS = {
  priority: ["alert.png", "중요한 할 일을 알려주는 DoDoDo 도토리 캐릭터"],
  conflict: ["worried.png", "일정 충돌을 걱정하는 DoDoDo 도토리 캐릭터"],
  reminder: ["alert.png", "마감을 알려주는 DoDoDo 도토리 캐릭터"],
  opportunity: ["happy.png", "새로운 기회를 발견한 DoDoDo 도토리 캐릭터"],
  "sync-complete": ["cheering.png", "동기화 완료를 기뻐하는 DoDoDo 도토리 캐릭터"],
  advice: ["point.png", "공부 조언을 건네는 DoDoDo 도토리 캐릭터"],
  distraction: ["worried.png", "집중 상태를 걱정하는 DoDoDo 도토리 캐릭터"],
  "daily-summary": ["greeting.png", "오늘 할 일을 인사하는 DoDoDo 도토리 캐릭터"],
};

export function notificationExpression(kind) {
  const [asset, alt] = EXPRESSIONS[kind] ?? ["alert.png", "알림을 전하는 DoDoDo 도토리 캐릭터"];
  return { asset, alt };
}

export function restingExpression(isStudying) {
  return isStudying
    ? { asset: "reading.png", alt: "같이 공부 중인 DoDoDo 도토리 캐릭터" }
    : { asset: "idle.png", alt: "DoDoDo 도토리 캐릭터" };
}
