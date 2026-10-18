/* 摆棋端到端：从按钮打开弹层，摆好后开始对局；AI 与回放的生命周期。 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { installDomStub } from "./helpers/dom-stub.js";
import * as state from "../src/state.js";
import * as ui from "../src/ui.js";
import { xy2i } from "./helpers/factory.js";

let doc;
const el = id => doc.getElementById(id);

function palette(c, t){
  const box = el(c === "r" ? "edRed" : "edBlack");
  return box.children.find(function(b){
    return b.dataset.c === c && b.dataset.t === String(t);
  });
}
function place(c, t, i){
  palette(c, t).click();
  el("edGrid").children[i].click();
}

beforeAll(async () => {
  installDomStub();
  vi.useFakeTimers();
  await import("../src/main.js");   /* main.js 在导入时启动 UI 与事件绑定 */
  doc = globalThis.document;
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(() => {
  ui.closeEditor();
  el("mPvp").click();               /* 回到双人、新开一局，顺带清掉 AI 定时器 */
});

describe("摆棋开始游戏", () => {
  it("摆好双方棋子后开始，局面取代当前对局", () => {
    el("btnEditor").click();
    expect(el("editor").hidden).toBe(false);
    expect(ui.isEditorOpen()).toBe(true);

    place("r", 5, 0);               /* 红虎 (1,1)，默认暗棋 */
    place("b", 6, 27);              /* 黑豹 (4,7)，默认暗棋 */
    expect(el("edStart").disabled).toBe(false);

    el("edStart").click();
    expect(el("editor").hidden).toBe(true);
    expect(ui.isEditorOpen()).toBe(false);

    const g = state.getGame();
    expect(g.board[0]).toMatchObject({ t: 5, c: "r", rv: false });
    expect(g.board[27]).toMatchObject({ t: 6, c: "b", rv: false });
    expect(g.pcolor).toEqual(["r", "b"]);
    expect(g.turn).toBe(0);
    expect(g.firstFlip).toBe(true);
    expect(g.log.length).toBe(1);
    expect(g.log[0].h).toContain("自定义开局");
    expect(state.getActions()).toEqual([]);
    expect(state.getUndoStack()).toEqual([]);
    expect(state.getBaseSnapshot()).toBe(state.snapshot());
  });

  it("黑方先手选项生效", () => {
    el("qbEditor").click();
    el("edFirstB").click();
    place("r", 5, 0);
    place("b", 6, 27);
    el("edStart").click();
    expect(state.getGame().pcolor).toEqual(["b", "r"]);
    expect(state.getGame().turn).toBe(0);
  });

  it("明棋选项生效", () => {
    el("btnEditor").click();
    el("edVisShown").click();
    place("r", 5, 0);
    place("b", 6, 27);
    el("edStart").click();
    expect(state.getGame().board[0].rv).toBe(true);
    expect(state.getGame().board[27].rv).toBe(true);
  });

  it("取消不改动当前对局", () => {
    state.newGame();
    const before = state.snapshot();
    el("btnEditor").click();
    place("r", 7, 0);
    el("edCancel").click();
    expect(ui.isEditorOpen()).toBe(false);
    expect(el("editor").hidden).toBe(true);
    expect(state.snapshot()).toBe(before);
  });

  it("河格压子能带进对局", () => {
    el("btnEditor").click();
    place("b", 4, xy2i(2, 4));        /* 黑象入河（自动明棋） */
    place("r", 1, xy2i(2, 4));        /* 红龙压住黑象 */
    place("r", 5, xy2i(1, 1));
    place("b", 6, xy2i(4, 7));
    el("edStart").click();

    const g = state.getGame();
    expect(g.board[xy2i(2, 4)]).toMatchObject({
      t: 1, c: "r", rv: true, under: { t: 4, c: "b", rv: true }
    });
    expect(g.board[xy2i(2, 4)].under.uid).not.toBe(g.board[xy2i(2, 4)].uid);
    expect(g.log[0].h).toContain("红方 2 子、黑方 2 子");
  });
});

describe("摆棋期间的 AI 与回放", () => {
  it("弹层打开时电脑不会在背后行棋，关闭后恢复", () => {
    el("mAi").click();
    el("aFirst").click();           /* 电脑先手（座位 0） */
    expect(state.getMode()).toBe("ai");
    expect(state.getAiFirst()).toBe(true);

    el("btnEditor").click();
    vi.advanceTimersByTime(3000);
    expect(state.getActions().length).toBe(0);

    el("edCancel").click();
    vi.advanceTimersByTime(1000);
    expect(state.getActions().length).toBe(1);

    state.setAiFirst(false);
    el("mPvp").click();
  });

  it("回放中打开摆棋会先退出回放", () => {
    state.setMode("pvp");
    state.newGame();
    state.commit({ kind: "flip", i: 0 });
    expect(state.beginReplay(state.getBaseSnapshot(), state.getActions().slice())).toBe(true);
    expect(state.isReplaying()).toBe(true);

    el("btnEditor").click();
    expect(state.isReplaying()).toBe(false);
    expect(ui.isEditorOpen()).toBe(true);

    el("edCancel").click();
  });
});
