import type { ContextKind } from "../../shared/src/index.ts";

// Stage 0 형식 정의. Benchmark 실행기(Stage 8)가 이 타입을 소비한다.
// 파일 포맷 설명과 예시는 fixtures/ground-truth/README.md 참고.
export interface GroundTruthCase {
  id: string;
  description: string;
  inputRawItemIds: string[];
  expectedContextItems: ExpectedContextItem[];
  expectedMerges: [string, string][];
}

export interface ExpectedContextItem {
  title: string;
  kind: ContextKind;
  deadline?: string;
  evidenceCount: number;
}
