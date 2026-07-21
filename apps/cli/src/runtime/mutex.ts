export interface Mutex {
  run<T>(fn: () => Promise<T>): Promise<T>;
}

// doyeonid 리뷰(PR #61): 데스크톱 앱은 CLI와 달리 한 container를 여러 진입점이
// 동시에 쓴다 — 앱 시작 직후 startDesktopWatch()의 첫 tick과 Renderer의 수동
// sync:run IPC가 같은 collectors/pipeline/rawItemRepository를 직렬화 없이 건드리면
// 같은 RawItem을 양쪽이 동시에 "변경됨"으로 판단해 중복 분석·LLM 호출이나
// History 쓰기 경합이 생길 수 있다. Promise 체인 하나로 "동기화 한 번"을 직렬화한다
// (별도 락 라이브러리 없이 단일 프로세스 안에서 충분 — 여러 프로세스 간 락은 필요 없다).
export function createMutex(): Mutex {
  let tail: Promise<unknown> = Promise.resolve();

  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      // 김도현 리뷰(PR #61): tail은 아래에서 항상 resolve로만 재구성되어 절대
      // reject하지 않는다 — 그래서 .then의 두 번째 인자(onRejected)는 실행될 일이
      // 없는 죽은 코드였다. onFulfilled 하나만 넘겨도 동작은 같다.
      const result = tail.then(fn);
      // 이전 작업이 실패해도 체인이 끊기지 않게 한다 — 실패는 각 호출자의 result에서
      // 그대로 드러난다(catch로 삼키는 대상은 체인 유지용 더미일 뿐).
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}
