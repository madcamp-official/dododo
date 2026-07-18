# Context 데이터 모델

## 1. 모델링 원칙

- 관심 정보와 확정된 의무를 분리한다.
- 모든 판단 결과에 Evidence를 연결한다.
- 현재 값뿐 아니라 변경 이력을 보존한다.
- 화면 관찰은 참고 정보이며 사용자 상태를 자동 확정하지 않는다.
- LLM의 추정과 원문에서 확인된 사실을 구분한다.

## 2. 핵심 객체

### UserProfile

사용자가 직접 제공한 정보와 추천에 사용되는 선호다.

| 필드 | 설명 |
|---|---|
| school | 학교 |
| major | 전공 |
| year | 학년 |
| interests | 관심 분야 |
| activityTypes | 선호 활동 종류 |
| preferredLocations | 선호 지역·온라인 여부 |
| quietHours | 알림 금지 시간 |
| explicitConstraints | 사용자가 직접 설정한 제외 조건 |

추정 선호는 직접 입력 값과 분리하고 사용자가 수정할 수 있어야 한다.

### Source

정보를 가져오는 대상이다.

```text
school_notice | lms | file | calendar | screen | conversation
```

Source는 이름, 위치, 수집 설정, 마지막 동기화 시각과 상태를 가진다.

### RawItem

수집된 원본 단위다.

| 필드 | 설명 |
|---|---|
| sourceId | 어느 Source에서 왔는가 |
| externalId | 원본 시스템의 ID |
| uri | URL 또는 파일 위치 |
| title | 원본 제목 |
| content | 분석할 텍스트 또는 화면 요약 입력 |
| contentHash | 변경 확인용 Hash |
| observedAt | 수집 시각 |
| metadata | 과목, 게시일, 페이지 등 출처별 정보 |

### Fact

원본에서 추출한 최소 판단 단위다.

```text
category
subject
value
eventTime
confidence
evidenceText
rawItemId
```

Fact 예시:

```text
종류: deadline
대상: 운영체제 과제 3
값: 제출 마감
시각: 2026-07-22T23:59:00+09:00
근거: “과제 3은 7월 22일 23:59까지 제출합니다.”
```

### ContextItem

Fact를 사용자가 이해할 수 있는 객체로 통합한 상위 개념이다.

#### Opportunity

공모전, 봉사, 대외활동, 장학금처럼 아직 참여를 확정하지 않은 기회다.

```text
new | recommended | saved | preparing | applied | dismissed | expired
```

#### Task

과제 제출, 시험 공부, 신청서 작성처럼 해야 하는 행동이다.

```text
candidate | todo | in_progress | done | cancelled
```

#### Event

시험, 약속, 회의, 행사, 마감처럼 특정 시간과 연결된 일정이다.

#### Note

공지 요약, 시험 범위, 과제 참고사항처럼 행동이나 시간으로 바로 변환되지 않는 정보다.

#### Activity

현재 화면에서 요약한 사용자의 활동이다. 원본 화면 대신 요약, 앱 힌트, 관찰 시각, 관련 Task 후보와 확신도를 저장한다.

### Evidence

ContextItem과 Recommendation의 근거다.

| 필드 | 설명 |
|---|---|
| rawItemId | 원본 RawItem |
| location | URL, 파일 페이지, LMS 항목 ID 등 |
| quote | 근거 문장 |
| observedAt | 관찰 시각 |
| authority | 공식 공지, 공식 문서, 화면 추정 등 |

### Relation

ContextItem 사이의 연결이다.

```text
Opportunity --creates--> Task
Task --has_deadline--> Event
Task --related_to--> Event
Activity --works_on--> Task
Note --supports--> Task
Task --depends_on--> Task
```

### Recommendation

사용자에게 보여줄 제안이다.

```text
대상 ContextItem
추천 행동
추천 이유
우선순위
근거
생성 시각
억제 종료 시각
사용자 반응
```

## 3. 상태 전환

### Opportunity

```text
new
→ recommended
→ saved
→ preparing
→ applied

new/recommended/saved
→ dismissed

미신청 상태에서 마감 경과
→ expired
```

`preparing`으로 전환할 때 준비 Task와 신청 마감 Event를 생성한다.

### Task

```text
candidate → todo → in_progress → done
                     ↘ cancelled
```

- 화면 Activity는 `in_progress` 후보 근거가 될 수 있다.
- `done`은 사용자 명시 행동 또는 신뢰할 수 있는 제출 완료 근거로만 확정한다.
- 삭제 대신 `cancelled`를 사용해 이력을 유지한다.

## 4. 시간 규칙

- 저장 시간은 ISO 8601과 명시적 시간대를 사용한다.
- 기본 시간대는 `Asia/Seoul`로 가정하되 설정 가능하게 한다.
- 날짜만 있는 마감은 시간이 없는 상태를 별도로 표시한다.
- `저녁`, `다음 주`, `주말까지` 같은 표현은 확인 전 확정하지 않는다.
- 원문 시간과 시스템이 해석한 시간을 모두 보존한다.

