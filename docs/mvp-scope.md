# CLI MVP 범위

## 1. MVP 정의

CLI MVP는 완성된 데스크톱 GUI가 아니라, 다음 핵심 파이프라인을 검증하는 실행 가능한 프로그램이다.

```text
데이터 수집
→ 정보 추출
→ Opportunity·Task·Event 분류
→ 중복 병합과 변경 반영
→ 로컬 저장
→ CLI 조회·질문·피드백
→ 추천과 알림
```

CLI는 임시 UI이며 수집기, Context Engine, 저장소는 이후 GUI에서도 재사용할 수 있도록 분리한다.

## 2. 필수 범위

### 사용자 프로필

- 전공·학년·관심 분야·관심 활동 입력
- 알림 가능 시간과 선호 설정
- 저장·무시한 Opportunity 기록
- 프로필 조회와 수정

### 학교 공지

- 대상 학교 공개 공지 사이트 1곳
- 신규 공지 수집 또는 제공된 HTML Fixture 수집
- 대회·공모전·봉사·대외활동 분류
- 지원 자격, 신청 마감, 활동 일자, 원본 URL 추출
- 사용자 관련도 계산
- Opportunity 추천·저장·무시

### 학교 이메일

- 학교 이메일 계정 1개 또는 제공된 `.eml`·텍스트 Fixture 1종
- 사용자가 허용한 메일함·라벨 또는 학교 도메인 발신자만 수집
- 제목, 본문, 발신자, 수신 시각, Message-ID와 첨부파일 메타데이터 보존
- 공모전·장학금·대외활동은 Opportunity로 분류
- 과제 변경·면담·수업 안내는 Task·Event·Note로 분류
- Message-ID와 Content Hash를 이용한 중복 방지
- 학교 사이트·LMS와 같은 내용을 전달한 이메일은 기존 Context와 병합
- 읽기 전용으로 동작하고 메일 전송·삭제·답장 금지

### LMS

- 특정 LMS 또는 제공된 LMS 공지 Fixture 1종
- 과목명, 과제명, 마감, 시험 일정, 요구사항 추출
- Task와 Event 생성
- 동일 공지 재수집 시 중복 생성 방지
- 수정 공지로 기존 마감 갱신

### 일정과 할 일

- 오늘·이번 주 Task 조회
- Event와 마감 목록 조회
- Task 완료와 미루기
- Opportunity를 준비 Task로 전환
- 자연어로 일정·할 일 추가
- 모호한 날짜와 시간 확인

### Context Intelligence

- 로컬 Ollama 또는 외부 API 중 LLM Provider 1개 선택
- RawItem에서 근거가 있는 Fact 추출
- Opportunity·Task·Event·Note 분류
- 같은 항목 병합
- 출처 충돌 해결과 변경 이력 보존
- Task 우선순위 계산
- 공지 관련도 계산
- 추천 이유 생성

### 화면 조언

- 사용자가 명령했을 때 선택 화면 또는 제공된 화면 Fixture 분석
- 화면 원본을 영구 저장하지 않음
- 활동 요약을 기존 Task와 연결
- 관련성이 높을 때만 구체적인 조언 생성

### CLI와 실행 방식

- 초기 설정 명령
- 수동 동기화 명령
- `watch` 장기 실행 명령
- Today, Inbox, Tasks, Calendar 조회
- Ask, Add, Advise 명령
- 근거 조회
- 로그와 오류 상태 조회

## 3. 권장 MVP 구현 방식

### 공개 학교 공지

실제 사이트 하나를 지원한다. 사이트 접근이 불안정하면 동일 구조의 HTML Fixture로 데모가 계속 가능해야 한다.

### 학교 이메일

학교 이메일은 Gmail, Outlook, 자체 메일 등 인증 방식이 다르므로 다음 순서로 구현한다.

1. `.eml` 또는 텍스트 Fixture 가져오기
2. 사용자가 허용한 계정·메일함을 읽기 전용으로 연결
3. `watch` 실행 중 신규 메일 자동 동기화

MVP 완료 조건은 1번이며, 실제 계정 연결은 대상 학교 이메일 시스템과 팀 진행 상황에 따라 IMAP 또는 Provider API 중 하나만 선택한다. 앱은 비밀번호 원문을 저장하지 않고, 가능하면 OAuth 또는 앱 비밀번호를 사용한다.

### LMS

로그인 자동화는 MVP의 가장 큰 위험 요소다. 다음 우선순위를 권장한다.

1. LMS 공지 HTML 또는 텍스트 가져오기
2. 사용자가 로그인한 앱 내부 세션에서 현재 공지 가져오기
3. 세션이 유지되는 동안 특정 LMS 자동 동기화

MVP 완료 조건은 1번이며, 2번과 3번은 대상 LMS 구조와 팀 진행 상황에 따라 확장한다.

### 백그라운드 실행

CLI가 종료된 상태에서 자동 수집과 알림을 계속하려면 별도 서비스가 필요하다. MVP에서는 아래처럼 정의한다.

```text
dododo watch
```

이 프로세스가 실행되는 동안에만 주기 동기화와 알림을 수행한다. OS 시작 프로그램 등록과 완전한 백그라운드 서비스는 확장 범위다.

## 4. 선택 기능

- 특정 LMS 로그인 세션 자동 동기화
- 학교 이메일 계정 읽기 전용 자동 동기화
- 이메일 첨부 PDF 분석
- ICS 파일 또는 구독 URL 연결
- 로컬 PDF 폴더 자동 감시
- 3~5분 간격 자동 화면 분석
- 사용자 피드백을 이용한 추천 점수 자동 보정
- 복수 학교 공지 사이트
- OS 시작 시 `watch` 자동 실행
- 외부 캘린더 OAuth

## 5. 범위 제외

- 모든 대학과 모든 LMS 자동 지원
- 브라우저 전체 방문 기록 수집
- 실시간 화면 영상 분석
- 키보드 입력 수집
- 개인 이메일 전체 수집과 메신저 자동 수집
- 이메일 전송·삭제·답장·읽음 상태 변경
- AI가 공모전·대외활동에 자동 지원
- 파일 자동 수정 또는 과제 자동 제출
- 사용자 확인 없는 일정 변경
- 장기 성격 분석
- 모델 학습·파인튜닝과 여러 LLM Provider 동시 운영
- 완전한 암호화와 공개 배포용 코드 서명

## 6. MVP 성공 조건

다음 데모가 처음부터 끝까지 성공하면 MVP의 핵심이 완성된 것으로 본다.

1. 사용자 프로필을 등록한다.
2. 학교 공지에서 관련 공모전을 발견한다.
3. 학교 이메일에서 같은 공모전 안내를 발견해 기존 Opportunity에 새 근거로 병합한다.
4. 추천 이유가 포함된 Opportunity가 생성된다.
5. 사용자가 지원 준비를 선택하면 Task와 마감 Event가 생성된다.
6. LMS 공지 또는 교수 이메일에서 과제와 시험을 추출한다.
7. 수정 공지로 기존 마감이 갱신되고 이전 값이 보존된다.
8. `today` 명령이 오늘 할 일과 가까운 마감을 보여준다.
9. 자연어 약속을 입력하면 확인 후 Calendar에 저장한다.
10. 현재 화면 분석이 관련 Task를 찾아 구체적인 조언을 제공한다.
11. 모든 결과에서 원본 URL, 이메일 또는 LMS 근거를 확인할 수 있다.

## 7. 구현 단계

기능을 Source별로 따로 완성한 뒤 마지막에 연결하지 않는다. 매 단계마다 입력부터 CLI 출력까지 이어지는 수직 흐름을 완성한다.

### 단계 0. 계약 고정

세 팀원이 함께 다음 타입과 인터페이스를 확정한다.

```text
Collector.sync() → RawItem[]
FactExtractor.extract(RawItem) → Fact[]
ContextResolver.resolve(Fact[], existing) → ContextItem[]
ContextRepository → RawItem·Fact·ContextItem 저장과 조회
RecommendationEngine.recommend(ContextItem[], Profile) → Recommendation[]
```

완료 조건:

- 학교 사이트·학교 이메일·LMS Fixture가 같은 `RawItem` 형식을 사용한다.
- 모든 Fact에 `rawItemId`, `confidence`, `evidenceText`가 있다.
- CLI, Collector, Context Engine이 상대 모듈의 내부 구현을 직접 참조하지 않는다.

### 단계 1. Fixture 수직 흐름

```text
Fixture JSON
→ FixtureCollector
→ Fact
→ ContextItem
→ InMemoryRepository
→ inbox 또는 today 출력
```

이 단계에서는 실제 네트워크, SQLite와 LLM 없이 전체 연결만 검증한다.

완료 조건:

- 학교 사이트와 이메일의 같은 공모전이 Opportunity 하나로 나타난다.
- LMS 과제가 Task와 마감 Event로 나타난다.
- 모든 결과에서 Fixture 원문 근거를 확인할 수 있다.

### 단계 2. 실제 저장소와 수집기

- InMemoryRepository를 SQLiteRepository로 교체한다.
- Content Hash와 외부 ID로 증분 동기화한다.
- 학교 사이트 1곳을 실제 연결한다.
- 이메일 `.eml` 입력과 LMS HTML 입력을 연결한다.

완료 조건:

- 프로그램을 재시작해도 Context가 유지된다.
- 같은 입력을 두 번 동기화해도 중복이 생기지 않는다.
- Collector 하나가 실패해도 다른 Source는 처리된다.

### 단계 3. LLM 추출과 Context 정책

- LLM Provider Adapter를 구현한다.
- 구조화 출력과 Schema 검증을 적용한다.
- Opportunity·Task·Event·Note·Activity 분류를 구현한다.
- 병합, 충돌 해결, 관련도와 우선순위 정책을 구현한다.

완료 조건:

- 잘못된 LLM 응답이 DB에 들어가지 않는다.
- 낮은 확신도는 자동 확정하지 않고 Candidate가 된다.
- 수정 공지가 기존 마감을 갱신하고 변경 이력을 남긴다.

### 단계 4. CLI와 Watch

- `setup`, `sync`, `watch`, `inbox`, `today`, `ask`, `add`, `advise`, `evidence`를 연결한다.
- 반복 추천, Quiet Hours와 Snooze를 적용한다.
- 화면 조언은 수동 명령부터 구현한다.

완료 조건:

- 대표 사용 시나리오를 CLI에서 처음부터 끝까지 실행한다.
- CLI가 종료되면 `watch`도 종료된다는 상태가 명확히 표시된다.
- 애매한 일정은 저장 전에 확인한다.

### 단계 5. 평가와 안정화

- 정상·중복·수정·충돌·모호한 입력 Fixture를 만든다.
- Fact 추출, 병합, Opportunity 추천과 Evidence 연결을 측정한다.
- 네트워크·LLM·화면 권한이 실패해도 Fixture 데모가 가능하게 한다.

## 8. 7일 구현 계획

| 일차 | 공동 목표 | 팀원 1 — Runtime & CLI | 팀원 2 — Ingestion & Storage | 팀원 3 — Intelligence |
|---|---|---|---|---|
| 1일 | 계약과 Fixture 고정 | CLI 명령 Router, `help`, `doctor` | RawItem·Repository 계약 검토, Fixture Loader | Fact·ContextItem·Recommendation 정책과 Ground Truth |
| 2일 | 첫 수직 흐름 | `sync`, `inbox`, `today` 출력 | FixtureCollector, InMemory/SQLite 초안 | Fixture Fact 추출, 분류, 기본 Resolver |
| 3일 | Source 연결 | `setup`, Source 상태와 오류 출력 | 학교 사이트, 이메일 `.eml`, LMS HTML Collector | 관련도 계산, 사이트·이메일 중복 병합 |
| 4일 | Task Context 완성 | Task 상세·완료·Snooze CLI | SQLite Migration, 변경 이력, Evidence 조회 | 마감·요구사항·충돌 해결·우선순위 |
| 5일 | 대화·화면·추천 | `watch`, 화면 캡처, 알림 출력 | 화면 RawItem 저장 경계, 수집 장애 격리 | 자연어 일정, Activity 연결, 조언 정책 |
| 6일 | 통합과 평가 | 전체 CLI 회귀 실행, 오류 UX | 반복 동기화·재시작·DB 테스트 | Benchmark, 잘못된 병합·추천 분석 |
| 7일 | 데모 안정화 | 실행 스크립트와 데모 진행 | 실제 Source 실패 대비 Fixture | 결과 수치·추천 근거·발표 설명 |

## 9. 3인 분업 상세

7일 계획 시점의 분업 근거와 서사(받는 입력·내보내는 결과·완료 기준)를 기록한다. 이
3인 분업 자체가 이후 백엔드 1인 + 프론트엔드 2인 구조로 바뀌었다 — 아래 팀원별 소유
경로는 역사적 기록이며, 현재 소유 경로의 유일한 기준은 `AGENTS.md`의 "팀 역할과
소유권"이다.

### 팀원 1 — 박도현: Runtime & CLI

소유 경로:

```text
apps/cli/
packages/scheduler/
packages/collectors/src/screen/  # 캡처 런타임
```

책임:

- 명령 파싱과 사용자 확인 흐름
- `setup`, `sync`, `watch`, `today`, `inbox`, `ask`, `add`, `advise`, `evidence`
- Watch Process의 시작·중지·주기 실행
- 화면 선택과 일시 캡처
- 콘솔 또는 OS 알림
- 모듈 오류를 사용자가 이해할 수 있는 메시지로 변환

받는 입력:

- 팀원 2의 Repository와 Collector
- 팀원 3의 Context Pipeline과 Recommendation

내보내는 결과:

- CLI 사용자 입력
- 화면 Activity용 RawItem
- 알림 반응과 완료·Snooze 피드백

완료 기준:

- Fixture와 실제 구현을 CLI 변경 없이 바꿀 수 있다.
- 한 Source가 실패해도 CLI가 종료되지 않는다.
- 사용자가 현재 동기화·Watch 상태를 확인할 수 있다.

### 팀원 2 — 김도연: Data Ingestion & Storage

소유 경로:

```text
packages/collectors/       # screen 캡처 부분 제외
packages/storage/
fixtures/*의 원본 입력
```

책임:

- 학교 사이트, 학교 이메일, LMS, 파일과 Calendar 수집
- HTML·이메일·문서 Parser
- 외부 ID, Message-ID와 Content Hash 생성
- SQLite Schema, Migration과 Repository
- RawItem·Fact·ContextItem·Evidence·변경 이력 저장
- 증분 동기화와 Source별 오류 격리

받는 입력:

- 공통 `Source`, `RawItem`, Repository 계약
- 팀원 3이 정의한 Evidence와 변경 이력 요구사항

내보내는 결과:

- 검증 가능한 `RawItem[]`
- 저장·조회 Repository
- Source 상태와 동기화 결과

완료 기준:

- 반복 수집 시 RawItem 중복이 없다.
- 원본 URL·Message-ID·LMS ID가 보존된다.
- 프로세스 재시작 뒤에도 같은 Context를 조회할 수 있다.

### 팀원 3 — 김도현: Context Intelligence & Recommendation

소유 경로:

```text
packages/context-engine/
packages/privacy/
packages/profile/
packages/evaluation/
fixtures/*의 Ground Truth
```

책임:

- LLM Provider Adapter와 구조화 Fact 추출
- Opportunity·Task·Event·Note·Activity 분류 정책
- 동일 Context 병합과 절대 병합 금지 조건
- 출처 충돌 해결과 확신도 처리
- 사용자 프로필 기반 Opportunity 관련도
- Task 우선순위와 추천 이유
- 화면 Activity 연결과 적극적 조언 조건
- 자연어 일정의 모호성 확인 정책
- Ground Truth, Benchmark와 실패 사례 분석

받는 입력:

- 팀원 2가 만든 RawItem과 기존 ContextItem
- 팀원 1이 만든 화면 Activity와 사용자 피드백

내보내는 결과:

- `Fact[]`, `ContextItem[]`, `Recommendation[]`
- 병합·충돌·추천의 설명 가능한 점수와 근거
- 평가 수치와 실패 Fixture

완료 기준:

- 모든 자동 생성 결과에 Evidence가 있다.
- 같은 공지가 사이트·이메일에 있어도 하나로 병합된다.
- 낮은 확신도와 모호한 일정은 자동 확정되지 않는다.
- 완료·Snooze한 Task를 다시 추천하지 않는다.

## 10. 공동 소유와 변경 규칙

다음 파일은 특정 팀원이 독단적으로 변경하지 않는다.

```text
packages/shared/src/domain.ts
packages/shared/src/contracts.ts
대표 Fixture의 기대 결과
SQLite Migration의 핵심 ID·관계
```

공통 계약 변경 절차:

1. 변경 이유와 실제 입력·출력 예시를 공유한다.
2. 소비하는 두 모듈의 영향 범위를 확인한다.
3. 타입과 Fixture를 먼저 변경한다.
4. 각 담당자가 자신의 모듈을 맞춘다.
5. 통합 테스트가 통과한 뒤 병합한다.

## 11. 통합 순서

매일 최소 두 번 다음 순서로 통합한다.

```text
팀원 2: RawItem 생성
→ 팀원 3: Fact·ContextItem 생성
→ 팀원 2: Repository 저장
→ 팀원 3: Recommendation 계산
→ 팀원 1: CLI 출력과 사용자 피드백
```

각 팀원은 상대 모듈이 완성되지 않아도 Mock 또는 Fixture로 자신의 작업을 실행할 수 있어야 한다.

## 12. 전체 완료 정의

- 새 기능에 정상·실패·중복 입력 테스트가 있다.
- 결과에서 원본 Evidence를 찾을 수 있다.
- 오류가 다른 Source와 CLI를 중단시키지 않는다.
- Fixture와 실제 Source가 같은 계약을 사용한다.
- 개인정보 범위를 넓히는 변경은 팀 검토를 거친다.
- 대표 사용 시나리오가 빈 DB에서 재현된다.
