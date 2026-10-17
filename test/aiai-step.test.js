/* AI 对弈节奏：自动连走、单步暂停、单步中悔棋、再切回自动。 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { installDomStub } from "./helpers/dom-stub.js";
import * as state from "../src/state.js";

let doc;
beforeAll(async () => {
  installDomStub();
  vi.useFakeTimers();
  await import("../src/main.js");   /* main.js 在导入时启动 UI 与事件绑定 */
  doc = globalThis.document;
});
afterAll(() => {
  vi.useRealTimers();
});

describe("AI 对弈单步", () => {
  it("单步走一手，可悔棋，再切回自动", () => {
    doc.getElementById("mAiAi").click();
    expect(state.getMode()).toBe("aiai");
    expect(state.getAiPaused()).toBe(false);

    /* 自动连走：等一个调度周期，电脑走一手 */
    vi.advanceTimersByTime(800);
    expect(state.getActions().length).toBe(1);

    /* 切到单步：待触发的自动行棋被取消，只走当前这一手，然后停住 */
    doc.getElementById("bStep").click();
    expect(state.getAiPaused()).toBe(true);
    expect(state.getActions().length).toBe(2);
    vi.advanceTimersByTime(3000);
    expect(state.getActions().length).toBe(2);

    /* 单步中悔棋：退回一手，且仍保持单步 */
    doc.getElementById("btnUndo").click();
    expect(state.getActions().length).toBe(1);
    expect(state.getAiPaused()).toBe(true);
    vi.advanceTimersByTime(3000);
    expect(state.getActions().length).toBe(1);

    /* 再单步一手 */
    doc.getElementById("bStep").click();
    expect(state.getActions().length).toBe(2);

    /* 切回自动：恢复连走 */
    doc.getElementById("bAuto").click();
    expect(state.getAiPaused()).toBe(false);
    vi.advanceTimersByTime(800);
    expect(state.getActions().length).toBe(3);

    state.setMode("pvp");
  });
});
