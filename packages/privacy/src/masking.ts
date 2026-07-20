// 외부 LLM에 전달하기 전 개인정보를 placeholder로 가린다. 마감·요구사항 같은 Task
// 텍스트는 판단에 필요하므로 건드리지 않고, 주민등록번호·학번·전화번호·개인 이메일을 대상으로 한다.
// 이메일은 기본적으로 모두 마스킹하고, 외부 전달이 꼭 필요한 비개인 공식 주소만 정확한
// 주소 allowlist로 보존한다. 학교 도메인 전체를 허용하면 학생·교직원 개인 주소도 노출된다.

const PHONE_TOKEN = "[전화번호]";
const EMAIL_TOKEN = "[이메일]";
const STUDENT_ID_TOKEN = "[학번]";
const RRN_TOKEN = "[주민등록번호]";

// 010-1234-5678 / 01012345678 / 010 1234 5678 등. 국번(2,3자리)까지 관대하게 잡되
// 휴대폰(01X) 형태만 대상으로 한다.
const PHONE_PATTERN = /01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/g;

// 이메일 전체를 먼저 잡고, 정확한 주소 allowlist에 있으면 마스킹에서 제외한다.
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// 주민등록번호와 외국인등록번호의 일반적인 6+7자리 형태. 하이픈·공백이 있거나
// 구분자가 없는 형태를 모두 가린다. 뒷자리 첫 숫자는 현재 사용되는 1~8만 허용해
// 임의의 13자리 숫자를 과도하게 마스킹하지 않는다.
const RRN_PATTERN = /\b\d{6}[-\s]?[1-8]\d{6}\b/g;

// 학번은 순수 8~10자리 숫자로 본다. 날짜(2026-07-25)나 시각처럼 구분자가 있는 숫자는
// 매칭되지 않으므로 마감 텍스트를 훼손하지 않는다. 전화번호는 이 단계 전에 이미
// placeholder로 바뀌어 있어 중복 매칭되지 않는다.
const STUDENT_ID_PATTERN = /\b\d{8,10}\b/g;

export interface MaskingOptions {
  allowedEmailAddresses?: string[];
}

export function maskSensitiveText(text: string, options: MaskingOptions = {}): string {
  const allowedAddresses = new Set(
    (options.allowedEmailAddresses ?? [])
      .map((address) => address.trim().toLowerCase())
      .filter((address) => address !== ""),
  );

  // 순서 주의: 이메일 → 주민등록번호 → 전화번호 → 학번. 더 구체적이고 긴 패턴부터
  // 치환해야 뒤의 숫자 패턴이 민감정보 일부만 가르는 일을 막을 수 있다.
  let masked = text.replace(EMAIL_PATTERN, (address) =>
    allowedAddresses.has(address.toLowerCase()) ? address : EMAIL_TOKEN,
  );
  masked = masked.replace(RRN_PATTERN, RRN_TOKEN);
  masked = masked.replace(PHONE_PATTERN, PHONE_TOKEN);
  masked = masked.replace(STUDENT_ID_PATTERN, STUDENT_ID_TOKEN);
  return masked;
}
