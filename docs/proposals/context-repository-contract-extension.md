# 제안: ContextRepository·ContextResolver·RecommendationEngine 계약 확장

- 작성자: 김도현 (Context Intelligence & Recommendation)
- 대상 파일: `packages/shared/src/domain.ts`, `packages/shared/src/contracts.ts`
- 상태: 제안 (팀 리뷰 대기, 아직 코드에 반영하지 않음)
- 관련 PR: Stage 0 — Context Intelligence 임시 저장소

AGENTS.md의 "공동 소유 파일과 변경 절차"에 따라, 변경 이유와 예시를 먼저 제시하고
팀 합의 후 반영하기 위한 문서다. **이 PR은 `packages/shared/`를 실제로 수정하지 않는다.**
대신 이 문서와 동일한 시그니처를 가진 임시 구현(`InterimContextStore`)을
`packages/context-engine/src/store/`에 두어 합의 전까지 작업이 막히지 않게 했다.

## 1. 변경 이유

현재 `ContextRepository`(`packages/shared/src/contracts.ts`)에는 `RawItem`·`Fact`·`ContextItem`을
저장/조회하는 메서드만 있고, `Evidence`·변경 이력·`Recommendation`을 저장하는 방법이 없다.
`domain.ts`에는 `Evidence` 타입은 있지만 변경 이력을 표현하는 타입이 아예 없다.

그런데 AGENTS.md의 데이터 정책은 다음을 완료 조건으로 명시한다.

- "모든 자동 생성 `ContextItem`과 `Recommendation`은 원본으로 추적 가능한 Evidence를 가진다."
- "동일 공지가 여러 Source에 있으면 Evidence는 모두 보존하되 ContextItem은 하나로 병합한다."
- "수정 공지는 기존 Context를 갱신하고 이전 값과 변경 근거를 보존한다."
- "완료·취소·Dismiss·Snooze 상태를 무시하고 같은 추천을 반복하지 않는다."

지금 계약만으로는:
- `Evidence` 레코드를 저장할 방법이 없어 "Evidence가 있다"를 검증할 수 없다.
- 마감 변경 시 "이전 값"을 남길 저장소가 없다.
- `dododo watch`(장기 실행)와 `dododo inbox`/`today`(단발 실행)가 별도 프로세스이므로,
  `watch`가 계산한 `Recommendation`을 저장하지 않으면 `inbox`가 볼 수 없고, 30분 중복 억제·Snooze
  판단에 필요한 "최근 추천 이력"도 조회할 방법이 없다.

## 2. 제안하는 변경 (Before → After)

### `domain.ts` — 타입 추가 (기존 타입 변경 없음)

```ts
export interface ContextChangeEvent {
  id: string;
  contextItemId: string;
  changeType: "created" | "field_updated" | "status_changed" | "merged" | "evidence_added";
  field?: string;
  previousValue?: unknown;
  newValue?: unknown;
  evidenceId?: string;
  changedAt: string;
}
```

### `contracts.ts` — `ContextRepository`에 메서드 추가

```diff
 export interface ContextRepository {
   saveRawItems(items: RawItem[]): Promise<void>;
   saveFacts(facts: Fact[]): Promise<void>;
   saveContextItems(items: ContextItem[]): Promise<void>;
   listContextItems(kind?: ContextItem["kind"]): Promise<ContextItem[]>;
   findContextItem(id: string): Promise<ContextItem | undefined>;
+  saveEvidence(evidence: Evidence[]): Promise<void>;
+  listEvidence(ids: string[]): Promise<Evidence[]>;
+  saveContextHistory(events: ContextChangeEvent[]): Promise<void>;
+  listContextHistory(contextItemId: string): Promise<ContextChangeEvent[]>;
+  saveRecommendations(recommendations: Recommendation[]): Promise<void>;
+  listRecommendations(contextItemId?: string): Promise<Recommendation[]>;
 }
```

### `contracts.ts` — `ContextResolver` 시그니처 확장

Resolver가 Evidence를 만들려면 Fact의 출처인 원본 `RawItem`이 필요하고,
"이미 병합된 출처인지" 판단하려면 기존 `Evidence`도 필요하다.

```diff
 export interface ContextResolver {
-  resolve(facts: Fact[], existing: ContextItem[]): Promise<ContextItem[]>;
+  resolve(
+    facts: Fact[],
+    existing: ContextItem[],
+    context: { rawItemsById: Map<string, RawItem>; existingEvidence: Evidence[] },
+  ): Promise<{ items: ContextItem[]; evidence: Evidence[]; history: ContextChangeEvent[] }>;
 }
```

### `contracts.ts` — `RecommendationEngine`에 이력 입력 추가

```diff
 export interface RecommendationEngine {
   recommend(
     items: ContextItem[],
     profile: UserProfile,
     now: Date,
+    recentRecommendations: Recommendation[],
   ): Promise<Recommendation[]>;
 }
```

## 3. 영향 범위

- **생산자(구현체)**: `packages/context-engine/`(내 소유) — `ContextResolver`/`RecommendationEngine`
  구현을 새 시그니처에 맞춘다. `packages/storage/`(김도연 소유) — `InMemoryContextRepository`와
  이후 `SQLiteRepository`에 6개 메서드를 추가 구현해야 한다.
- **소비자**: `packages/context-engine/src/pipeline.ts`(내 소유, `ContextPipeline.sync()`가
  `resolve()`/`recommend()` 호출부를 갱신), `apps/cli/`(박도현 소유) — 아직 CLI가 이 메서드들을
  직접 호출하지 않으므로 영향 없음(향후 `evidence` 명령에서 사용 예정).
- **기존 테스트**: `tests/smoke.test.ts`의 inline mock `ContextResolver`(narrow 시그니처)가 있다.
  이 PR에서는 `ContextPipeline`이 넓은 시그니처와 좁은 시그니처를 모두 허용하도록 폴백을 두어
  기존 테스트가 깨지지 않게 했다 — 계약이 실제로 바뀌면 이 폴백도 함께 정리한다.

## 4. 반영 절차 (AGENTS.md 기준)

1. (완료) 변경 이유와 Before/After 예시 제시 — 본 문서.
2. 생산자(context-engine)·소비자(storage) 영향 범위 확인 — 위 3번 항목.
3. 합의되면 `domain.ts`/`contracts.ts`를 이 문서대로 갱신하고, 대표 Fixture 기대 결과도 함께 갱신한다.
4. `packages/storage/src/index.ts`의 `InMemoryContextRepository`에 6개 메서드를 구현한다(김도연).
5. `packages/context-engine/src/store/interimStore.ts`를 삭제하고, `ContextPipeline`이
   실제 `ContextRepository`를 호출하도록 교체한다(김도현).
6. `npm run check` 통과 확인.

## 5. 대안으로 고려했으나 채택하지 않은 것

- **Evidence를 ContextItem.metadata에 통째로 넣기**: 타입 안정성이 없고, `evidenceId`로
  다른 레코드가 참조할 수 없어 변경 이력 추적이 불가능해 기각.
- **ContextResolver가 RawItem 저장소를 직접 조회**: `ContextResolver`가 `ContextRepository`를
  알게 되어 "Collector가 저장소를 직접 호출하지 않는다"와 대칭되는 계층 위반이 발생해 기각.
  대신 파이프라인이 이미 갖고 있는 `rawItemsById`를 인자로 전달하는 방식을 택했다.
