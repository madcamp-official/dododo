import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ScreenCaptureResult {
  capturedAt: Date;
  byteLength: number;
  imageBase64: string;
}

export type CaptureRunner = () => Promise<Buffer>;

const DEFAULT_TIMEOUT_MS = 10_000;

// 화면을 메모리에서 PNG로 인코딩해 base64 문자열을 stdout으로만 출력한다 — 디스크에
// 임시 파일을 전혀 쓰지 않는다(AGENTS.md: 화면 캡처 원본을 영구 저장하지 않는다는
// 원칙을 "애초에 저장 자체를 안 함"으로 만족시킨다).
const CAPTURE_SCRIPT = [
  "Add-Type -AssemblyName System.Windows.Forms,System.Drawing",
  "$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds",
  "$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height",
  "$g = [System.Drawing.Graphics]::FromImage($bmp)",
  "$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)",
  "$ms = New-Object System.IO.MemoryStream",
  "$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)",
  "[Convert]::ToBase64String($ms.ToArray())",
  "$g.Dispose(); $bmp.Dispose(); $ms.Dispose()",
].join("; ");

// Windows 전용 기본 구현. mvp-scope.md는 "화면 권한이 실패해도 Fixture 데모가
// 가능해야 한다"를 요구하므로, 이 함수는 실패를 숨기지 않고 명확한 오류로
// 던져 호출부가 폴백(Fixture 등)을 선택할 수 있게 한다.
export async function captureWindowsScreenshot(timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<Buffer> {
  if (process.platform !== "win32") {
    throw new Error(`실제 화면 캡처는 현재 Windows만 지원합니다 (현재 플랫폼: ${process.platform})`);
  }

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", CAPTURE_SCRIPT],
      { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 },
    ));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`화면 캡처 명령 실행에 실패했습니다: ${reason}`);
  }

  const base64 = stdout.trim();
  if (base64 === "") {
    throw new Error("화면 캡처 결과가 비어 있습니다");
  }

  return Buffer.from(base64, "base64");
}

// runner를 주입받아 실제 OS 캡처 없이 테스트할 수 있다(school-site HTTP Loader의
// fetchImplementation 주입과 같은 패턴). 반환값에는 byteLength/capturedAt만 남기고
// 원본 바이트(imageBase64)는 호출부가 즉시 쓰고 버려야 한다 — 이 함수도, 어떤
// Collector도 이 값을 어디에도 저장하지 않는다.
export async function captureActiveScreen(
  runner: CaptureRunner = () => captureWindowsScreenshot(),
  now: () => Date = () => new Date(),
): Promise<ScreenCaptureResult> {
  const buffer = await runner();
  return {
    capturedAt: now(),
    byteLength: buffer.byteLength,
    imageBase64: buffer.toString("base64"),
  };
}
