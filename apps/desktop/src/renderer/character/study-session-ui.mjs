export function elapsedStudyTime(startedAt, now = new Date()) {
  const start = new Date(startedAt);
  if (Number.isNaN(start.getTime())) return { minutes: 0, label: "시간 확인 중" };
  const totalSeconds = Math.max(0, Math.floor((now.getTime() - start.getTime()) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  const seconds = totalSeconds % 60;
  const label = hours > 0
    ? `${hours}시간 ${String(minutes).padStart(2, "0")}분`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return { minutes: Math.floor(totalSeconds / 60), label };
}

export function studyProgressView(session, now = new Date()) {
  const elapsed = elapsedStudyTime(session.startedAt, now);
  return {
    elapsedLabel: elapsed.label,
    statusText: session.restored
      ? "이전에 진행하던 세션을 복원했습니다."
      : "도토리와 같이 공부하는 중입니다.",
  };
}

export function studySummaryView(result) {
  const duration = Number.isSafeInteger(result?.durationMinutes) && result.durationMinutes >= 0
    ? result.durationMinutes : 0;
  const adviceCount = Number.isSafeInteger(result?.adviceCount) && result.adviceCount >= 0
    ? result.adviceCount : 0;
  return {
    title: typeof result?.summaryText === "string" && result.summaryText.trim() !== ""
      ? result.summaryText.trim() : "같이 공부하기 세션을 마쳤어요.",
    durationLabel: duration >= 60
      ? `${Math.floor(duration / 60)}시간 ${String(duration % 60).padStart(2, "0")}분`
      : `${duration}분`,
    adviceLabel: adviceCount === 0 ? "방해 없이 집중했어요" : `도토리 조언 ${adviceCount}회`,
  };
}
