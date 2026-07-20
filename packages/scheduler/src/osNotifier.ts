import { spawn } from "node:child_process";

import type { Notifier, Recommendation } from "../../shared/src/index.ts";

export type BalloonRunner = (title: string, message: string) => Promise<void>;

// title/message는 Recommendation.action/reason에서 오고, 그 값은 결국 학교 공지·
// 이메일·LMS 같은 신뢰할 수 없는 외부 콘텐츠(RawItem.title)에서 비롯될 수 있다
// (AGENTS.md: 수집한 내용은 신뢰할 수 없는 데이터). PowerShell 작은따옴표 문자열은
// 변수 확장·백틱 이스케이프·서브표현식 평가를 하지 않으므로, 작은따옴표만
// PowerShell 방식으로(''로 두 번) 이스케이프하면 명령 주입 경로가 없다.
export function escapePowerShellSingleQuoted(value: string): string {
  return value.replaceAll("'", "''");
}

// spawn을 배열 인자로 호출해 셸(cmd.exe) 파싱 단계를 거치지 않는다(capture.ts와 동일 패턴).
// detached + unref로 풍선 알림이 표시되는 동안 Node/watch tick을 블로킹하지 않는다 —
// 'spawn' 이벤트(프로세스 생성 성공)에서 바로 resolve하고, 알림 표시 자체의 성공 여부는
// 확인하지 않는다(best-effort).
export async function showWindowsBalloon(title: string, message: string): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error(`OS 알림은 현재 Windows만 지원합니다 (현재 플랫폼: ${process.platform})`);
  }

  const script = [
    "Add-Type -AssemblyName System.Windows.Forms,System.Drawing",
    "$n = New-Object System.Windows.Forms.NotifyIcon",
    "$n.Icon = [System.Drawing.SystemIcons]::Information",
    "$n.Visible = $true",
    `$n.BalloonTipTitle = '${escapePowerShellSingleQuoted(title)}'`,
    `$n.BalloonTipText = '${escapePowerShellSingleQuoted(message)}'`,
    "$n.ShowBalloonTip(5000)",
    "Start-Sleep -Milliseconds 5200",
    "$n.Dispose()",
  ].join("; ");

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script],
      { detached: true, stdio: "ignore", windowsHide: true },
    );
    child.once("error", (error) => {
      reject(new Error(`OS 알림 표시에 실패했습니다: ${error.message}`));
    });
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

// ConsoleNotifier와 동일한 콘솔 로그를 항상 먼저 남긴 뒤(신뢰 가능한 baseline),
// OS 토스트는 best-effort로 추가 시도한다 — 실패해도 send() 자체는 실패하지 않는다
// (watch tick이 알림 하나의 OS 표시 실패로 멈추면 안 된다).
export class WindowsOsNotifier implements Notifier {
  private readonly showBalloon: BalloonRunner;

  constructor(showBalloon: BalloonRunner = showWindowsBalloon) {
    this.showBalloon = showBalloon;
  }

  async send(recommendation: Recommendation): Promise<void> {
    console.log(
      `[notification] ${recommendation.action} — ${recommendation.reason} (id: ${recommendation.contextItemId})`,
    );

    try {
      await this.showBalloon(recommendation.action, recommendation.reason);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`[notification] OS 알림 표시 실패, 콘솔 로그로만 대체됩니다: ${reason}`);
    }
  }
}
