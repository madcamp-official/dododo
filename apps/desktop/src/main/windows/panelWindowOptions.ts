// docs/frontend-plan.md 6.3/6.8.2: 패널 창은 캐릭터 근처에 뜨는 보조 창이라
// 프레임 없이(캐릭터 창과 비슷하게) 두되, 설정 창과 마찬가지로 alwaysOnTop은
// 아니고 보안 webPreferences는 동일하게 유지한다.
export interface PanelWindowSize {
  width: number;
  height: number;
}

export const PANEL_SIZE: PanelWindowSize = { width: 460, height: 420 };

export interface PanelWindowOptions {
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

export function buildPanelWindowOptions(preloadPath: string): PanelWindowOptions {
  return {
    width: PANEL_SIZE.width,
    height: PANEL_SIZE.height,
    frame: false,
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
