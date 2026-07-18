# Ground Truth Fixture 포맷 (제안, 팀 리뷰 대기)

이 디렉터리는 `packages/evaluation`의 Benchmark 실행기(구현 예정, Stage 8)가 소비할
Ground Truth 파일을 담는다. 형식은 [packages/evaluation/src/groundTruth.ts](../../packages/evaluation/src/groundTruth.ts)의
`GroundTruthCase`와 1:1로 대응한다.

`docs/mvp-scope.md`의 "대표 Fixture의 기대 결과"는 AGENTS.md 기준 공동 소유 항목이므로,
이 포맷과 최초 예시 파일은 확정이 아니라 팀 검토를 위한 제안이다.

## 파일 규칙

- 파일명: `<케이스 이름>.expected.json`
- 하나의 파일은 하나의 `GroundTruthCase`를 담는다.
- `inputRawItemIds`는 `fixtures/school-site/`, `fixtures/school-email/`, `fixtures/lms/`,
  `fixtures/screen/` 등에 있는 RawItem Fixture의 `id`를 가리킨다(파일 자체를 복제하지 않는다).

## 필드

| 필드 | 설명 |
|---|---|
| `id` | 케이스 식별자 |
| `description` | 이 케이스가 검증하는 시나리오 한 줄 설명 |
| `inputRawItemIds` | 파이프라인에 입력될 RawItem id 목록 |
| `expectedContextItems` | 최종적으로 존재해야 하는 ContextItem 목록(`title`/`kind`/`deadline?`/`evidenceCount`) |
| `expectedMerges` | 하나의 ContextItem으로 병합되어야 하는 RawItem id 쌍 목록 |

## 예시

[ai-hackathon.expected.json](./ai-hackathon.expected.json) — `fixtures/school-site/ai-hackathon.json`과
`fixtures/school-email/ai-hackathon-email.json`이 같은 Opportunity로 병합되는지 검증한다
(user-scenarios.md 시나리오 2).
