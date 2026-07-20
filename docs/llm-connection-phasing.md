# LLM 연결·배포 단계 계획

이 문서는 "VM의 로컬 LLM을 dododo가 실제로 사용하게 만드는" 작업의 **순서 전략**이다. VM부터 Cloudflare Tunnel·설치 코드까지 전부 배포하는 상세 아키텍처 제안을 받았고, 그 방향(특히 Ollama를 직접 노출하지 않고 Gateway 뒤에 두는 것)은 옳다. 다만 현재 저장소 상태 기준으로 **먼저 증명할 것과 나중에 할 것의 순서**를 조정한다.

관련 문서: `docs/llm-architecture.md`(LLM 역할·경계), `docs/handoff-cli-llm-wiring.md`(CLI 배선 요청), Issue #27(시나리오 배선 점검).

## 원칙

1. **데모는 단일 기기부터.** README도 "테스트 기기에 직접 설치해 검증"이라 명시한다. 발표 데모의 핵심은 "로컬 CLI가 VM의 실제 LLM에 붙어 추출·추천이 되는 것"이지, 다중 사용자 배포가 아니다.
2. **저비용부터.** 같은 목표를 SSH 터널로 오늘 증명할 수 있으면, Gateway+Tunnel 인프라를 먼저 만들 이유가 없다.
3. **Ollama는 절대 직접 노출하지 않는다.** 인증이 없어 공개 시 GPU 무단 사용·임의 프롬프트 악용이 가능하다. SSH 터널(Phase 1)도, Gateway(Phase 3)도 이 원칙을 지킨다. "Gateway 없이 Tunnel을 11434에 직접 연결"은 금지.

## 현재 병목 (배포 인프라가 아니다)

지금 안 되는 것은 배포가 아니라 **CLI가 LLM을 아예 호출하지 않는 것**이다. `apps/cli/src/runtime/container.ts`가 임시 규칙 추출기를 쓰고, `.env`(`DODODO_LLM_BASE_URL`)를 읽는 코드가 없다(Issue #27, `docs/handoff-cli-llm-wiring.md`). 이걸 두고 Gateway·Tunnel·설치 코드부터 만들면, 정작 LLM이 파이프라인에 붙지 않는다.

## 3단계 계획

### Phase 1 — 실제 LLM MVP (지금)

목표: 로컬 CLI가 VM의 `gemma3:12b`로 실제 Fact 추출·추천 문장을 생성.

- **VM (인프라)**: 받은 제안서의 1~4단계 그대로 — 아키텍처/GPU 점검, Node 22 설치, Ollama 설치(`OLLAMA_HOST=127.0.0.1`로 localhost 제한), `gemma3:12b`/`gemma3:4b` pull, 구조화 출력·GPU 사용 검증.
- **로컬 (CLI, 박도현)**: `docs/handoff-cli-llm-wiring.md`대로 `.env` 읽어 `OllamaProvider` 생성 → `LLMFactExtractor`/추천엔진/화면조언에 주입.
- **연결 (SSH 포트포워딩)**: Gateway·Tunnel 없이 로컬 ↔ VM Ollama를 암호화된 1:1 터널로 연결.
  ```bash
  # 로컬 PC에서 (VM Ollama를 로컬 11434로 포워딩)
  ssh -N -L 11434:127.0.0.1:11434 <user>@<VM_HOST>
  ```
  ```bash
  # 로컬 .env
  DODODO_LLM_BASE_URL=http://127.0.0.1:11434
  DODODO_TEXT_MODEL=gemma3:12b
  DODODO_VISION_MODEL=gemma3:4b
  ```
- **완료 조건**:
  - `npm start -- doctor` → LLM 연결 OK 표시
  - `npm start -- sync` → 임시 규칙이 아니라 실제 LLM이 Fact 추출
  - `npm start -- today` → LLM이 생성한 추천 문장(템플릿 아님)
  - SSH 세션 종료 시 자동으로 폴백(provider 미연결)으로 안전 동작

이 단계까지가 "실제 LLM MVP"이고, 발표 데모로 충분하다. Ollama는 여전히 VM localhost에만 열려 외부 노출이 없다.

### Phase 2 — 나머지 시나리오 배선

Issue #27이 지적한, 대표 시나리오를 CLI에서 끝까지 돌리기 위한 배선.

- CLI: `add`(→ `parseScheduleIntent`), `ask`(→ `answerContextQuestion`), `evidence` 명령, `advise` 실 정책 어댑터, 실제 수집기(HTTP loader/`.eml`/LMS HTML) 연결, `ChunkingPrivacyGateway` 교체 — 박도현.
- Storage: SQLite `ContextRepository`(#30/#32) 머지 → 프로세스 간 Context 유지 — 김도연.
- Intelligence(나): 관련도 이중화 해소(`relevanceScore`를 우선순위에 통합), `resolveWithEvidence` 시각 주입(History append-only 멱등), 파이프라인 변경 감지 연동(같은 contentHash 재분석 스킵 — PR #32 리뷰 참고).

### Phase 3 — 다중 사용자 배포 (실제로 필요해질 때)

여러 사용자에게 "다운로드 후 설치 코드로 바로 연결"을 제공할 때. **받은 제안서(Inference Gateway + Cloudflare Tunnel + 설치 코드 + `RemoteJobLLMProvider`)를 그대로 설계도로 사용한다.** 핵심:

- `apps/inference-gateway/`: operation 기반 API(`extract_facts` 등), 토큰 hash, SQLite Job Queue, 동시 추론 1개, TTL 삭제, rate limit, 요청 본문 비로그, Ollama 관리 API 비노출.
- Cloudflare Tunnel: 인바운드 포트 없이 Gateway(18080)만 HTTPS로 노출. 비동기 Job + polling(Cloudflare 120초 timeout 회피).
- `RemoteJobLLMProvider`: 사용자 PC에서 `LLMProvider`를 구현, 설치 코드로 기기 토큰 발급 후 OS Keychain 저장.

## LLMProvider 통합 결정 (Phase 3 전에 확정)

Gateway로 갈 때 반드시 미리 정해야 하는 것이다. 제안의 operation 기반 API는 **서버가 프롬프트·스키마를 갖고** 클라이언트는 operation만 보낸다. 그런데 현재 `LLMProvider.completeJSON()`은 **클라이언트가 systemPrompt·schema를 보내는** 구조다(프롬프트가 지금 `extraction`/`recommendation/phrasing`/`intent`에 있음).

| 옵션 | 내용 | 언제 |
|---|---|---|
| (b) 클라이언트가 프롬프트 전송 | 현재 구조 유지, `OllamaProvider` 그대로 | **Phase 1~2 (MVP)** |
| (a) 서버가 프롬프트·스키마 소유 | 엔진 6개(추출·추천·조언·질문·일정) 프롬프트를 Gateway로 이관, operation 매핑 | Phase 3 (공개 배포 악용 방지) |

**MVP는 (b)로 간다.** 지금 구조가 단순하고 SSH 터널·로컬 Ollama에 그대로 맞는다. operation 기반 악용 방지 이점은 실제 공개 배포가 문제될 때(Phase 3) (a)로 이관하면 되고, 그때 `RemoteJobLLMProvider`가 `LLMProvider`를 구현하되 내부에서 operation으로 매핑한다. 이 결정 없이 Gateway부터 만들면 엔진들과 맞물리지 않는다.

## 요약

```
Phase 1 (지금): VM Ollama + CLI 배선 + SSH 터널 → 실제 LLM MVP 데모
Phase 2:        add/ask/evidence·수집기·Context 영속화·관련도/시각 정리
Phase 3 (배포): Inference Gateway + Cloudflare Tunnel + 설치 코드 (제안서대로)
```

받은 배포 아키텍처는 Phase 3의 설계도로 매우 훌륭하다. 다만 지금은 그 인프라보다 **SSH 터널로 "로컬 CLI ↔ VM 실제 LLM"을 먼저 증명**하는 것이 10배 저비용이고 발표 데모의 핵심이다.
