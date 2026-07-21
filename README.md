# Context Assistant (`dododo`)

> KAIST 몰입캠프 공통과제 III — Option 1. Build the Core (3인 1팀)

**한 줄 소개:** 학교 사이트·학교 이메일·LMS·파일·캘린더·화면 활동을 로컬 Context로 통합하고, 근거와 함께 다음 행동을 추천하는 대학생용 AI 비서.

> 현재 단계는 핵심 파이프라인을 검증하는 Node.js 기반 CLI MVP다. Windows/macOS 설치형
> Electron 데스크톱 UI는 같은 Core를 재사용해 병렬로 구현 중이다([프론트엔드 기획](docs/frontend-plan.md)).

**슬로건:** 흩어진 정보를, 하나의 최신 Task Context로.

---

## 팀원

| 이름 | GitHub | 역할 |
|---|---|---|
| 김도연(팀장) | [doyeonid](https://github.com/doyeonid) | Data Ingestion & Local Storage |
| 김도현 | [GitHub ID](https://github.com/) | Context Intelligence & Recommendation |
| 박도현 | [dotori235](https://github.com/dotori235) | Runtime & CLI |

역할별 담당 경로와 책임 상세는 [`AGENTS.md`](AGENTS.md#팀-역할과-소유권)와
[MVP 범위의 3인 분업](docs/mvp-scope.md#9-3인-분업-상세)을 따른다.

---

## 문서

이 README는 진입점이다. 기획·범위·시나리오·구조에 대한 내용은 각 문서가 하나씩만
소유하며, 아래 목록 밖에서는 같은 내용을 다시 설명하지 않는다. 문서와 구현이 어긋나면
조용히 한쪽을 가정하지 말고 어느 쪽을 갱신할지 먼저 정한다.

| 문서 | 소유 내용 |
|---|---|
| [프로젝트 기획안](docs/product-plan.md) | 문제 정의, 목표 사용자, 핵심 가치·가설, 제품 원칙, MVP 결과물 정의 |
| [MVP 범위](docs/mvp-scope.md) | 필수·선택·제외 범위, 7일 구현 계획, 3인 분업 상세, 완료 조건 |
| [대표 사용 시나리오](docs/user-scenarios.md) | 공모전 발견·이메일 병합·LMS 정리·오늘 할 일·화면 조언·자연어 일정·질문 응답 시나리오 |
| [시스템 구조](docs/architecture.md) | 상위 구조, 처리 파이프라인, 저장소 구조, 모듈 계약, 팀 경계 |
| [LLM 활용 아키텍처](docs/llm-architecture.md) | LLM에 맡기는 일과 코드가 통제하는 일, 원격 Gateway 구현 상태, 확장 로드맵 |
| [프론트엔드(Desktop UI) 기획](docs/frontend-plan.md) | Electron 캐릭터 오버레이·패널·설정 창 UI 구성과 역할 분담 |
| [KCloud VM 사양](docs/KCLOUD_VM_사양.md) | 원격 Inference Gateway VM의 하드웨어·운영 사양 |
| [`AGENTS.md`](AGENTS.md) | 코딩 에이전트 공통 작업 규칙, 소유권 경계, 실행·검증 절차 |

---

## Getting Started

### 요구 환경

- Node.js: `22.18 이상`
- npm: Node.js에 포함된 버전
- Windows 또는 macOS
- 팀 Gateway를 사용할 경우 운영진이 발급한 일회용 설치 코드
- 로컬 Ollama를 직접 사용할 경우에만 별도 Ollama와 모델 설치

### 제3자 설치 및 원격 LLM 연결

```bash
# 1. 저장소 복제
git clone https://github.com/madcamp-official/dododo.git
cd dododo

# 2. 의존성 설치
npm ci

# 3. 프로필 설정과 설치 코드 활성화
# 운영진에게 받은 일회용 설치 코드를 질문에 입력한다.
npm start -- setup

# 4. 공개 Gateway와 실제 인증 추론 확인
npm start -- doctor --llm-test

# 5. Fixture 기반 첫 사용
npm start -- sync
npm start -- inbox
npm start -- today
npm start -- ask "운영체제"
```

`setup`은 기본적으로 `https://llm.madcamp-kaist.org`에서 설치 코드를 기기별 Token으로
교환하고, Token을 Git에서 제외되는 `.env`에 권한 `0600`으로 저장한다. Token 원문은
콘솔이나 Git에 남기지 않는다.

> 원격 Gateway를 사용할 사람은 먼저 `cp .env.example .env`를 실행할 필요가 없다.
> `.env.example`의 기본값은 로컬 Ollama를 직접 운영하는 개발자를 위한 예시다.

`dododo.sources.json`을 만들지 않은 첫 실행은 학교 사이트·학교 이메일·LMS Fixture로
동작한다. 실제 Source를 쓰려면 학교 사이트 URL과 Selector, 이메일 `.eml` 디렉터리,
LMS HTML 경로를 `dododo.sources.json`에 별도로 설정해야 한다. 계정 자동 로그인이나
OAuth 연동은 현재 MVP 범위에 포함되지 않는다.

### 운영자: 사용자별 설치 코드 발급

Gateway VM의 `/opt/dododo`에서 사용자마다 코드를 하나씩 발급한다. 코드는 기본 7일 후
만료되며 한 번 활성화하면 다시 사용할 수 없다. 발급 명령은 코드 Hash만 Gateway SQLite에
저장하고 원문은 명령 실행 직후 한 번만 출력한다. 서비스 재시작은 필요하지 않다.

```bash
cd /opt/dododo

# 사용자별 코드 발급·등록
sudo -u dododo env GATEWAY_DB_PATH=/var/lib/dododo/gateway.db \
  npm run gateway:activation-code -- issue \
  --label "홍길동 MacBook" \
  --expires-days 7

# 발급 상태 확인(원문은 표시하지 않음)
sudo -u dododo env GATEWAY_DB_PATH=/var/lib/dododo/gateway.db \
  npm run gateway:activation-code -- list

# 아직 사용하지 않은 코드 취소
sudo -u dododo env GATEWAY_DB_PATH=/var/lib/dododo/gateway.db \
  npm run gateway:activation-code -- revoke --id ac_발급된_ID
```

기존 `GATEWAY_ACTIVATION_CODES` 환경변수 방식도 호환을 위해 유지하지만, 신규 사용자는
위 DB 기반 명령으로 발급한다. 설치 코드와 기기 Token을 README, 이슈, PR 또는 Git에
커밋하지 않는다.

### 설치 파일

| 운영체제 | 파일 | 상태 |
|---|---|---|
| Windows | `[installer.exe 또는 .msi]` | [ ] |
| macOS | `[app 또는 .dmg]` | [ ] |

> 공개 배포용 코드 서명은 확장 범위로 두고, MVP는 테스트 기기에 직접 설치해 검증한다.

---

## 기술 스택

| 영역 | 기술 |
|---|---|
| Runtime | Node.js 22.18 이상, TypeScript(ESM, `.ts` 직접 실행) |
| 저장소 | `node:sqlite`(Node 내장, 외부 DB 드라이버 의존 없음) |
| 수집 | cheerio(학교 사이트 HTML), mailparser(`.eml` 학교 이메일) |
| LLM | Ollama(로컬) 또는 `RemoteJobLLMProvider`(Cloudflare Tunnel + 팀 Inference Gateway) |
| 테스트 | Node Test Runner(`node --test`), 외부 테스트 프레임워크 의존 없음 |
| Desktop UI(진행 중) | Electron — 상세는 [프론트엔드 기획](docs/frontend-plan.md) |

---

## 팀원별 참여 내용

담당 경로, 받는 입력·내보내는 결과, 완료 기준은 [MVP 범위의 3인 분업 상세](docs/mvp-scope.md#9-3인-분업-상세)와
[`AGENTS.md`의 팀 역할과 소유권](AGENTS.md#팀-역할과-소유권)을 따른다. 아래는 회고용 기록만 남긴다.

### 박도현 — Runtime & CLI

- **주요 구현:** [작성]
- **실험 및 문제 해결:** [작성]

### 김도연 — Data Ingestion & Local Storage

- **주요 구현:** [작성]
- **실험 및 문제 해결:** [작성]

### 김도현 — Context Intelligence & Recommendation

- **주요 구현:** [작성]
- **실험 및 문제 해결:** [작성]

매일 최소 두 번 통합하는 순서는 [MVP 범위 11. 통합 순서](docs/mvp-scope.md#11-통합-순서)를 따른다.

---

## 평가 계획 및 결과

### 비교 기준

- **Baseline:** 각 문서를 독립적으로 요약(출처 간 병합 없음)
- **Proposed:** 다중 출처 Context 통합 및 상태 갱신
- **실험 조건:** Windows/macOS, 학교 공지 사이트 1곳 이상, 학교 이메일 또는 Fixture 1종, LMS Fixture 1종 기준

### 데이터셋

| 종류 | 개수 | 설명 |
|---|---:|---|
| 학교 공지 | [TBD] | 정상 공지·마감 변경·취소 공지 등 |
| 학교 이메일 | [TBD] | 모집 안내·과제 변경·면담 안내 등 |
| LMS 공지 | [TBD] | 과제·시험 일정 공지와 수정 공지 |
| 화면 Fixture | [TBD] | 코딩·문서 작성·브라우징 등 |

### 핵심 지표

| 지표 | 초기값 | 목표 | 최종 결과 |
|---|---:|---:|---:|
| 할 일·마감 추출 F1 | [TBD] | [TBD] | [TBD] |
| 다중 출처 Context 병합 정확도 | [TBD] | [TBD] | [TBD] |
| 변경 감지 후 반영 시간 | [TBD] | [TBD] | [TBD] |
| 잘못된 추천 비율 | [TBD] | [TBD] | [TBD] |
| 중복 알림 비율 | [TBD] | [TBD] | [TBD] |
| 화면 조언 생성 시간 | [TBD] | [TBD] | [TBD] |
| 외부 LLM 전송 데이터 크기 | [TBD] | [TBD] | [TBD] |

### 실패한 시도와 발견

- [실패한 접근 또는 예상과 달랐던 결과]
- [실패 원인]
- [변경한 방법]
- [발견한 내용]

---

## 배포 결과물

- **GitHub:** [REPOSITORY_URL]
- **Windows 설치 파일:** [URL]
- **macOS 설치 파일:** [URL]
- **데모 영상:** [URL]
- **실행 방법:** [Getting Started](#getting-started) 참고

---

## 회고

### Keep

- [계속 유지하고 싶은 점]

### Problem

- [문제가 되었던 점]

### Try

- [다음에 시도하거나 개선할 점]
