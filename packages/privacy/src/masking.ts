// 외부 LLM에 전달하기 전 개인정보를 placeholder로 가린다. 마감·요구사항 같은 Task
// 텍스트는 판단에 필요하므로 건드리지 않고, 학번·전화번호·개인 이메일만 대상으로 한다.
// 허용된 학교 도메인 이메일(예: 학생지원팀 발신 주소)은 출처 판단·권위 비교에 필요하므로
// 보존한다.

const PHONE_TOKEN = "[전화번호]";
const EMAIL_TOKEN = "[이메일]";
const STUDENT_ID_TOKEN = "[학번]";

// 010-1234-5678 / 01012345678 / 010 1234 5678 등. 국번(2,3자리)까지 관대하게 잡되
// 휴대폰(01X) 형태만 대상으로 한다.
const PHONE_PATTERN = /01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/g;

// 이메일 전체를 먼저 잡고, 도메인이 허용 학교 도메인이면 마스킹에서 제외한다.
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// 학번은 순수 8~10자리 숫자로 본다. 날짜(2026-07-25)나 시각처럼 구분자가 있는 숫자는
// 매칭되지 않으므로 마감 텍스트를 훼손하지 않는다. 전화번호는 이 단계 전에 이미
// placeholder로 바뀌어 있어 중복 매칭되지 않는다.
const STUDENT_ID_PATTERN = /\b\d{8,10}\b/g;

export interface MaskingOptions {
  // 이 도메인(및 하위 도메인)으로 끝나는 이메일은 마스킹하지 않는다.
  allowedEmailDomains?: string[];
}

export function maskSensitiveText(text: string, options: MaskingOptions = {}): string {
  const allowedDomains = (options.allowedEmailDomains ?? [])
    .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
    .filter((domain) => domain !== "");

  // 순서 주의: 이메일 → 전화번호 → 학번. 이메일을 먼저 치환해야 이메일 안의 숫자열이
  // 학번으로 오인되지 않고, 전화번호를 학번보다 먼저 처리해야 11자리가 8~10자리 학번
  // 패턴에 부분 매칭되지 않는다.
  let masked = text.replace(EMAIL_PATTERN, (address) =>
    isAllowedEmail(address, allowedDomains) ? address : EMAIL_TOKEN,
  );
  masked = masked.replace(PHONE_PATTERN, PHONE_TOKEN);
  masked = masked.replace(STUDENT_ID_PATTERN, STUDENT_ID_TOKEN);
  return masked;
}

function isAllowedEmail(address: string, allowedDomains: string[]): boolean {
  const at = address.lastIndexOf("@");
  if (at === -1) return false;
  const domain = address.slice(at + 1).toLowerCase();
  return allowedDomains.some(
    (allowed) => domain === allowed || domain.endsWith(`.${allowed}`),
  );
}
