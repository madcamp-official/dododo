import { BrowserWindow } from "electron";

import { NOTIFICATION_CHANNEL, type NotificationEvent } from "./notificationEvent.ts";

// 캐릭터 창·패널 창 등 열려 있는 모든 창에 보낸다 — 어느 창이 지금 떠 있는지는
// Renderer 쪽(김도연) 소관이라 여기서 특정 창을 고르지 않는다.
export function broadcastNotification(event: NotificationEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(NOTIFICATION_CHANNEL, event);
  }
}
