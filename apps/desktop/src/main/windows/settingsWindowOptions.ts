// docs/frontend-plan.md 6.7: 설정 창은 캐릭터 창과 달리 일반 프레임·크기 조절
// 가능·alwaysOnTop 아님이어야 하고, 보안 설정(contextIsolation/sandbox 등)은
// 캐릭터 창과 동일해야 한다. 이 값 자체는 electron의 BrowserWindow를 실제로
// 생성하지 않아도 검증할 수 있는 순수 데이터라 별도 함수로 분리해 테스트한다.
export interface SettingsWindowOptions {
  width: number;
  height: number;
  frame: boolean;
  alwaysOnTop: boolean;
  resizable: boolean;
  webPreferences: {
    contextIsolation: boolean;
    nodeIntegration: boolean;
    sandbox: boolean;
    preload: string;
  };
}

const DEFAULT_WIDTH = 720;
const DEFAULT_HEIGHT = 560;

export function buildSettingsWindowOptions(preloadPath: string): SettingsWindowOptions {
  return {
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    frame: true,
    alwaysOnTop: false,
    resizable: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath,
    },
  };
}
