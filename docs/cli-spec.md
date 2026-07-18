# CLI 명세

## 1. CLI 목표

CLI는 멋진 화면보다 전체 Context 파이프라인을 빠르게 검증하기 위한 인터페이스다. 모든 명령은 사람이 읽을 수 있는 기본 출력과 테스트 가능한 JSON 출력 옵션을 제공하는 것을 권장한다.

```text
dododo <command> [options]
dododo <command> --json
```

## 2. 핵심 명령

### 초기 설정

```text
dododo setup
dododo profile show
dododo profile edit
```

`setup`에서 입력할 내용:

- 학교와 전공
- 학년
- 관심 분야와 활동 종류
- 기본 시간대
- Quiet Hours
- 외부 LLM API 설정

### Source 관리

```text
dododo source list
dododo source add school <url>
dododo source add lms --file <path>
dododo source add calendar <path-or-url>
dododo source remove <source-id>
dododo source status
```

LMS 로그인 자동화가 구현되기 전에는 `--file`로 HTML 또는 Fixture를 가져온다.

### 동기화와 Watch

```text
dododo sync
dododo sync --source <source-id>
dododo watch
dododo doctor
```

- `sync`: 즉시 한 번 수집하고 분석한다.
- `watch`: 실행 중 주기적으로 동기화하고 알림을 보낸다.
- `doctor`: DB, API Key, Source와 권한 상태를 점검한다.

### Opportunity Inbox

```text
dododo inbox
dododo opportunity show <id>
dododo opportunity save <id>
dododo opportunity prepare <id>
dododo opportunity dismiss <id>
```

기본 출력 예시:

```text
Opportunity Inbox

[opp-12] 관련도 87  대학생 AI 해커톤
  마감: 2026-07-25 18:00
  이유: AI 관심 분야, 대학생 지원 가능, 온라인 참가
  출처: 학교 공지 #1542
```

### Task와 Calendar

```text
dododo today
dododo tasks
dododo task show <id>
dododo task done <id>
dododo task snooze <id> --until <datetime>
dododo calendar today
dododo calendar week
```

`today` 출력 예시:

```text
2026-07-18 Today

1. [82] 운영체제 과제 3 보고서 작성
   내일 마감 · 요구사항 2개 미완료
2. [55] AI 해커톤 신청서 초안
   5일 후 마감 · 관심 있음으로 저장

다음 일정: 19:00 민수와 저녁 약속
```

### 자연어 입력과 질문

```text
dododo add "이번 주 금요일 저녁에 민수랑 약속"
dododo ask "오늘 저녁 전까지 뭘 먼저 해야 해?"
dododo chat
```

모호한 일정 예시:

```text
민수와 약속
날짜: 2026-07-24
시간: 저녁(확인 필요)

19:00으로 저장할까요? [y/N/edit]
```

### 화면 조언

```text
dododo screen list
dododo advise --screen
dododo advise --fixture <path>
```

화면 선택, 분석 동의와 원본 삭제 여부를 명확하게 표시한다. Fixture 옵션은 화면 권한이나 LLM Vision이 실패해도 데모와 테스트를 진행하기 위해 둔다.

### 근거와 기록

```text
dododo evidence <context-id>
dododo history <context-id>
dododo recommendations
dododo feedback <recommendation-id> useful
dododo feedback <recommendation-id> not-useful
```

근거 출력 예시:

```text
운영체제 과제 3 마감: 2026-07-22 23:59

[공식 LMS 공지]
“과제 3은 7월 22일 23:59까지 제출합니다.”
원본: https://lms.example/course/42/notice/18
수집: 2026-07-18 09:10
```

## 3. 공통 UX 규칙

- ID는 복사하기 쉬운 짧은 형태로 표시한다.
- 날짜는 사용자 시간대로 출력한다.
- 위험하거나 애매한 변경은 실행 전 확인한다.
- 모든 추천은 한 줄 이유와 Evidence 접근 방법을 제공한다.
- 오류는 `무엇이 실패했는지`, `다른 Source는 계속 작동하는지`, `사용자가 할 일`을 알려준다.
- 기본 출력은 사람이 읽기 쉽게, `--json`은 자동 테스트에 적합하게 유지한다.

## 4. MVP 명령 우선순위

### P0

```text
setup, source, sync, watch, inbox, today,
opportunity show/prepare/dismiss,
task show/done/snooze,
calendar week, add, ask, advise, evidence, doctor
```

### P1

```text
chat, history, feedback, profile edit, --json
```

### P2

```text
대화형 검색, 복잡한 필터, 데이터 내보내기, 테마 설정
```

