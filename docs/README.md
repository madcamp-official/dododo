# dododo 기획 문서

이 폴더는 대학생용 로컬 AI Context Assistant의 CLI MVP를 설계하기 위한 문서 모음이다.

현재 문서는 구현 전 초안이며, `결정 필요`와 `가정`으로 표시된 내용은 팀 검토 후 확정한다.

## 권장 읽기 순서

1. [프로젝트 기획안](product-plan.md)
2. [MVP 범위](mvp-scope.md)
3. [대표 사용 시나리오](user-scenarios.md)
4. [시스템 구조](architecture.md)
5. [Context 데이터 모델](data-model.md)
6. [Context Intelligence 정책](intelligence-policy.md)
7. [CLI 명세](cli-spec.md)
8. [기능 목록](features.md)
9. [평가 계획](evaluation.md)
10. [결정 필요 사항](decisions.md)

## 문서별 목적

| 문서 | 답하는 질문 |
|---|---|
| `product-plan.md` | 누구의 어떤 문제를 해결하는가? |
| `mvp-scope.md` | 일주일 동안 어디까지 구현하는가? |
| `user-scenarios.md` | 사용자는 실제로 어떻게 사용하는가? |
| `architecture.md` | 데이터가 어떤 순서로 처리되는가? |
| `data-model.md` | 시스템이 어떤 Context를 기억하는가? |
| `intelligence-policy.md` | AI와 일반 코드가 어떤 판단을 담당하는가? |
| `cli-spec.md` | 사용자가 CLI에서 무엇을 보고 조작하는가? |
| `features.md` | 기능별 우선순위와 완료 조건은 무엇인가? |
| `evaluation.md` | 프로젝트가 잘 작동함을 어떻게 증명하는가? |
| `decisions.md` | 팀이 아직 결정해야 하는 것은 무엇인가? |

## 핵심 용어

- **RawItem**: 웹페이지, LMS 공지, 파일, 화면 요약 등 수집된 원본
- **Fact**: 원본에서 추출한 개별 사실과 그 근거
- **Opportunity**: 아직 하기로 결정하지 않은 공모전·대외활동·봉사 등의 기회
- **Task**: 사용자가 해야 하거나 하기로 결정한 작업
- **Event**: 시험·약속·회의·마감처럼 특정 시각과 연결된 일정
- **Note**: 나중에 참고할 요약과 메모
- **Activity**: 선택한 화면에서 관찰한 현재 활동
- **Recommendation**: 저장된 Context를 바탕으로 만든 다음 행동 또는 기회 추천
- **Evidence**: 판단을 뒷받침하는 원문, URL, 파일 위치 또는 화면 요약

