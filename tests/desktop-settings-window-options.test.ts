import assert from "node:assert/strict";
import test from "node:test";

import { buildSettingsWindowOptions } from "../apps/desktop/src/main/windows/settingsWindowOptions.ts";

test("설정 창은 alwaysOnTop이 아니고 크기 조절이 가능하다", () => {
  const options = buildSettingsWindowOptions("/path/to/preload.cjs");

  assert.equal(options.alwaysOnTop, false);
  assert.equal(options.resizable, true);
  assert.equal(options.frame, true);
});

test("설정 창은 캐릭터 창과 같은 안전한 webPreferences를 쓴다", () => {
  const options = buildSettingsWindowOptions("/path/to/preload.cjs");

  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.nodeIntegration, false);
  assert.equal(options.webPreferences.sandbox, true);
  assert.equal(options.webPreferences.preload, "/path/to/preload.cjs");
});
