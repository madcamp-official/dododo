import {
  extractScreenActivity,
  linkActivityToContext,
  type LLMProvider,
} from "../../../../../packages/context-engine/src/index.ts";
import type { ContextItem } from "../../../../../packages/shared/src/index.ts";
import type { ScreenAdvicePolicy } from "../../../../cli/src/runtime/adviceLookup.ts";
import type { NotificationEvent } from "../notifier/notificationEvent.ts";
import type { Result } from "../ipc/result.ts";

export interface ActiveStudySession {
  sessionId: string;
  startedAt: string;
}

export interface CaptureVisionPipelineDependencies {
  // study:end 이후 실행 중이던 trigger가 뒤늦게 도착해도 조용히 건너뛰도록,
  // 세션이 여전히 같은지 여러 시점에서 다시 확인하는 데 쓴다(doyeonid 리뷰 요구).
  getActiveSession: () => Promise<Result<ActiveStudySession | undefined>>;
  recordAdvice: (sessionId: string) => Promise<Result<void>>;
  isRemoteProvider: () => boolean;
  llmProvider: LLMProvider | undefined;
  captureLiveScreen: () => Promise<{ imageBase64: string; capturedAt: Date }>;
  listContextItems: () => Promise<ContextItem[]>;
  screenAdvicePolicy: ScreenAdvicePolicy;
  broadcast: (event: NotificationEvent) => void;
  now?: () => Date;
  onError?: (error: unknown) => void;
}

const DISTRACTION_MESSAGE = "지금 화면이 공부 중인 항목과 관련 없어 보여요. 계속 진행 중이면 무시해도 괜찮아요.";

export interface CaptureVisionPipeline {
  run(reason: "idle-to-active", at: Date): Promise<void>;
}

// docs/frontend-plan.md 6.8.1의 수직 흐름을 그대로 구현한다:
// Idle→Active → 세션 확인 → 화면 캡처 → extractScreenActivity → Context 연결 →
// (연결 안 되면 distraction, 연결되면) 조언 정책 평가 → advice 또는 무응답 →
// adviceCount 증가.
//
// advise:false를 곧바로 distraction으로 보지 않는다 — screenAdvicePolicy.evaluate가
// advise:false를 반환하는 경우 중에는 linkActivityToContext가 이미 관련 Task를 찾은
// 뒤에도 "최근 30분 안에 이미 이 Task로 조언함"이라 다시 조언만 안 하는 경우가 있다
// (packages/context-engine/src/activity/index.ts의 generateScreenAdvice 억제 로직).
// 그건 사용자가 여전히 같은 작업 중이라는 뜻이라 "이탈"이 아니다 — 조용히 아무 알림도
// 보내지 않는다. distraction은 linkActivityToContext 자체가 관련 Task를 못 찾았을 때
// (활동이 확신도 낮거나 어떤 Task와도 안 겹칠 때)만 보낸다.
//
// 캡처·Vision·정책 평가 각각이 시간이 걸릴 수 있어 세션이 그 사이에 끝날 수 있다 —
// 그래서 무거운 단계 앞에서 getActiveSession()을 다시 불러 여전히 같은 sessionId인지
// 확인한다. 어느 단계에서든 세션이 없거나 바뀌었으면 나머지를 건너뛴다(세션 종료 후
// 호출·알림·횟수 증가가 없어야 한다는 요구사항).
//
// 실패(캡처 실패, Vision 실패, 민감 콘텐츠, 원격 Provider)는 전부 이 trigger 한 번만
// 조용히 건너뛴다 — 다음 Idle→Active 트리거와 desktop watch에는 영향을 주지 않는다
// (AGENTS.md: 한 Source/trigger의 실패가 다른 처리를 막지 않는다).
export function createCaptureVisionPipeline(
  dependencies: CaptureVisionPipelineDependencies,
): CaptureVisionPipeline {
  const now = dependencies.now ?? (() => new Date());

  async function isStillActiveSession(sessionId: string): Promise<boolean> {
    const active = await dependencies.getActiveSession();
    return active.ok && active.data !== undefined && active.data.sessionId === sessionId;
  }

  async function run(_reason: "idle-to-active", at: Date): Promise<void> {
    try {
      const active = await dependencies.getActiveSession();
      if (!active.ok || active.data === undefined) return;
      const sessionId = active.data.sessionId;

      // 원격 LLM에는 이미지 Privacy Gateway가 준비될 때까지 원본 화면을 보내지
      // 않는다(apps/cli/src/commands/advise.ts의 runLiveCapture와 같은 방어선).
      if (dependencies.isRemoteProvider()) return;
      if (dependencies.llmProvider === undefined) return;

      let capture: { imageBase64: string; capturedAt: Date };
      try {
        capture = await dependencies.captureLiveScreen();
      } catch {
        return;
      }

      // capture.imageBase64는 extractScreenActivity 호출에만 쓰이고 그 뒤로 어떤
      // 변수에도 저장하지 않는다 — run()이 반환하면 스코프를 벗어나 GC 대상이 된다.
      const extraction = await extractScreenActivity({
        imageBase64: capture.imageBase64,
        observedAt: capture.capturedAt,
        provider: dependencies.llmProvider,
      });

      if (extraction.outcome !== "extracted") return;
      if (!(await isStillActiveSession(sessionId))) return;

      const contextItems = await dependencies.listContextItems();
      const link = linkActivityToContext(extraction.activity, contextItems, at);

      if (link === undefined) {
        if (!(await isStillActiveSession(sessionId))) return;
        dependencies.broadcast({
          kind: "distraction",
          message: DISTRACTION_MESSAGE,
          createdAt: now().toISOString(),
        });
        return;
      }

      const decision = await dependencies.screenAdvicePolicy.evaluate({
        activity: extraction.activity,
        contextItems,
        now: at,
      });

      if (!decision.advise) return; // 관련 Task는 찾았지만 조언 조건 미충족(억제 등) — 조용히 무응답
      if (!(await isStillActiveSession(sessionId))) return;

      dependencies.broadcast({
        kind: "advice",
        message: decision.message ?? "",
        createdAt: now().toISOString(),
      });
      await dependencies.recordAdvice(sessionId);
    } catch (error) {
      dependencies.onError?.(error);
    }
  }

  return { run };
}
