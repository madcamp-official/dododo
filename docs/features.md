# 기능 목록

상태 표기:

- `[ ]` 미구현
- `[~]` 구현 중
- `[x]` 완료
- `[?]` 팀 결정 필요

## P0 — MVP 필수

### CLI Runtime

- [ ] `setup` 초기 설정
- [ ] `sync` 단발성 동기화
- [ ] `watch` 장기 실행
- [ ] `doctor` 상태 점검
- [ ] 사람이 읽는 기본 출력
- [ ] Source 실패가 전체 프로세스를 중단하지 않음

### 사용자 프로필

- [ ] 학교·전공·학년 저장
- [ ] 관심 분야·활동 종류 저장
- [ ] Quiet Hours 저장
- [ ] 프로필 조회
- [ ] 저장·무시 행동 기록

### 학교 공지

- [ ] 대상 공개 공지 사이트 또는 HTML Fixture 수집
- [ ] 신규·수정·중복 판별
- [ ] 활동 종류 분류
- [ ] 자격·마감·행사 일정 추출
- [ ] 원본 URL과 근거 보존
- [ ] 사용자 관련도 점수
- [ ] Opportunity Inbox
- [ ] 저장·준비·무시

### LMS

- [ ] LMS HTML·텍스트 Fixture 입력
- [ ] 과목과 공지 종류 추출
- [ ] 과제명·마감·요구사항 추출
- [ ] 시험 시각·장소·범위 추출
- [ ] Task와 Event 생성
- [ ] 동일 공지 중복 방지
- [ ] 수정 공지의 마감 갱신
- [ ] 변경 이력 보존

### Context Engine

- [ ] LLM Provider Adapter
- [ ] 구조화 출력 검증
- [ ] Evidence가 있는 Fact 추출
- [ ] Opportunity·Task·Event·Note·Activity 분류
- [ ] 동일 ContextItem 병합
- [ ] 충돌 해결
- [ ] 확신도 낮은 결과 Candidate 처리
- [ ] 원본 없는 추정 거부

### Task와 Calendar

- [ ] Today 목록
- [ ] 이번 주 Calendar
- [ ] Task 상세와 요구사항
- [ ] Task 완료
- [ ] Snooze
- [ ] Opportunity를 준비 Task로 전환
- [ ] 자연어 일정·할 일 추가
- [ ] 모호한 날짜·시간 확인

### Recommendation

- [ ] Opportunity 관련도 계산
- [ ] Task 우선순위 계산
- [ ] 점수 이유 기록
- [ ] 추천 문장 생성
- [ ] LLM 실패 시 기본 문장
- [ ] 동일 추천 반복 억제
- [ ] Quiet Hours
- [ ] 완료·취소 항목 제외

### 화면 조언

- [ ] 화면 또는 Fixture 선택
- [ ] Activity 요약
- [ ] 기존 Task와 연결
- [ ] 조언 조건 검사
- [ ] 구체적 다음 행동 생성
- [ ] 원본 화면 영구 저장 방지

### 근거와 개인정보

- [ ] 모든 ContextItem의 Evidence 조회
- [ ] Recommendation의 근거 조회
- [ ] 외부 전송 최소화
- [ ] API Key와 원문 로그 금지
- [ ] Prompt Injection 대응
- [ ] 로컬 데이터 전체 삭제

### 평가

- [ ] 학교 공지 Ground Truth
- [ ] LMS Ground Truth
- [ ] 자연어 일정 Ground Truth
- [ ] 화면 Activity Fixture
- [ ] 추출 정확도 측정
- [ ] Opportunity 추천 Precision@K
- [ ] Task 중복·병합 정확도
- [ ] 데모 회귀 테스트

## P1 — 시간이 남으면

- [ ] 특정 LMS 앱 내부 로그인
- [ ] 로그인 세션 기반 LMS 자동 동기화
- [ ] ICS 파일 가져오기
- [ ] PDF 폴더 감시
- [ ] OS 시스템 알림
- [ ] 자동 화면 분석
- [ ] 추천 피드백 반영
- [ ] JSON CLI 출력
- [ ] Context 변경 이력 CLI

## P2 — 이후 확장

- [ ] GUI 데스크톱 앱
- [ ] OS 시작 시 자동 실행
- [ ] 브라우저 확장 프로그램
- [ ] 복수 학교·LMS Connector
- [ ] Google·Outlook Calendar OAuth
- [ ] 추천 모델 개인화
- [ ] 로컬 Context 검색
- [ ] 데이터 내보내기와 백업

## 기능 완료 정의

기능은 다음 조건을 모두 만족해야 완료로 표시한다.

1. 정상 입력에서 기대 결과가 나온다.
2. 중복 입력과 잘못된 입력을 처리한다.
3. 결과에서 Evidence를 확인할 수 있다.
4. 최소 하나의 자동 테스트 또는 재현 가능한 Fixture가 있다.
5. CLI 오류 메시지가 사용자의 다음 행동을 설명한다.

