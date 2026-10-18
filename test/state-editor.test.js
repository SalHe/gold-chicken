/* 自定义初始局面接入活棋状态：startFromPosition 的簿记、阵营与回放。 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as state from "../src/state.js";
import { xy2i } from "./helpers/factory.js";

const R = xy2i(1, 1), B = xy2i(4, 7), R2 = xy2i(2, 1);

function position(first){
  return {
    first: first || "r",
    placements: [
      { i: R, t: 5, c: "r", rv: false },
      { i: B, t: 6, c: "b", rv: true }
    ]
  };
}

function uids(g){
  return g.board.filter(Boolean).map(function(p){ return p.uid; });
}

beforeEach(() => {
  state.setMode("pvp");
  state.setAiFirst(false);
  state.setAiPaused(false);
});

afterEach(() => {
  state.endReplay();
  state.setChanged(null);
});

describe("startFromPosition", () => {
  it("建局、清空历史并写恰好一条系统日志", () => {
    let resets = 0;
    state.setChanged(function(reset){ if (reset) resets++; });
    state.newGame();          /* 先留一局有走子历史的对局 */
    state.commit({ kind: "flip", i: 0 });
    resets = 0;

    state.setAiPaused(true);
    const pos = position();
    expect(state.startFromPosition(pos.placements, { first: pos.first })).toBe(true);

    const g = state.getGame();
    expect(g.board[R]).toEqual({ uid: expect.any(Number), t: 5, c: "r", rv: false });
    expect(g.board[B]).toEqual({ uid: expect.any(Number), t: 6, c: "b", rv: true });
    expect(g.pcolor).toEqual(["r", "b"]);
    expect(g.turn).toBe(0);
    expect(g.firstFlip).toBe(true);
    expect(g.log.length).toBe(1);
    expect(g.log[0].c).toBe("s");
    expect(g.log[0].h).toContain("自定义开局");
    expect(g.log[0].h).toContain("红方 1 子、黑方 1 子");

    expect(state.getActions()).toEqual([]);
    expect(state.getUndoStack()).toEqual([]);
    expect(state.getAiPaused()).toBe(false);
    expect(state.getBaseSnapshot()).toBe(state.snapshot());
    expect(resets).toBe(1);
  });

  it("连续两次摆棋的 uid 不重叠", () => {
    const p = position();
    state.startFromPosition(p.placements, { first: "r" });
    const first = uids(state.getGame());
    state.startFromPosition(p.placements, { first: "r" });
    const second = uids(state.getGame());
    expect(first.length).toBe(2);
    second.forEach(function(u){ expect(first.indexOf(u)).toBe(-1); });
  });

  it("暗棋翻开后不会重排阵营", () => {
    const p = position();
    state.startFromPosition(p.placements, { first: "r" });
    state.commit({ kind: "flip", i: R });
    const g = state.getGame();
    expect(g.board[R].rv).toBe(true);
    expect(g.pcolor).toEqual(["r", "b"]);
    expect(g.firstFlip).toBe(true);
  });

  it("非法局面与回放中被拒绝", () => {
    expect(state.startFromPosition([], { first: "r" })).toBe(false);

    state.newGame();
    expect(state.beginReplay(state.getBaseSnapshot(), [])).toBe(true);
    const p = position();
    expect(state.startFromPosition(p.placements, { first: "r" })).toBe(false);
    expect(state.isReplaying()).toBe(true);
  });

  it("人机座位只由 turn 与 aiFirst 决定，与先手颜色无关", () => {
    const p = position("b");
    state.setMode("ai");
    state.startFromPosition(p.placements, { first: "b" });
    expect(state.getGame().pcolor[0]).toBe("b");

    state.setAiFirst(false);
    expect(state.isAITurn()).toBe(false);      /* 座位 0 是人 */
    state.setAiFirst(true);
    expect(state.isAITurn()).toBe(true);       /* 座位 0 是电脑 */

    state.setMode("pvp");
  });

  it("自定义开局后的走子可正常快照与回放", () => {
    const p = position();
    state.startFromPosition(p.placements, { first: "r" });
    const start = state.getBaseSnapshot();
    state.commit({ kind: "move", from: R, to: R2 });
    const acts = state.getActions().slice();
    const expected = JSON.stringify(state.getGame());

    expect(state.beginReplay(start, acts)).toBe(true);
    while (state.replayStep());
    expect(JSON.stringify(state.getGame())).toBe(expected);
  });

  it("河格压子保留在局面里，人数与连续开局的 uid 都算上压子", () => {
    const river = xy2i(2, 4);
    const pressed = [
      { i: river, t: 1, c: "r", rv: true, under: { t: 4, c: "b", rv: true } },
      { i: R, t: 5, c: "r", rv: false },
      { i: B, t: 6, c: "b", rv: true }
    ];
    expect(state.startFromPosition(pressed, { first: "r" })).toBe(true);
    let g = state.getGame();
    expect(g.board[river]).toMatchObject({
      t: 1, c: "r", rv: true, under: { t: 4, c: "b", rv: true }
    });
    expect(g.log[0].h).toContain("红方 2 子、黑方 2 子");
    const first = [g.board[river].uid, g.board[river].under.uid,
      g.board[R].uid, g.board[B].uid];
    expect(new Set(first).size).toBe(4);

    state.startFromPosition(pressed, { first: "r" });
    g = state.getGame();
    const second = [g.board[river].uid, g.board[river].under.uid,
      g.board[R].uid, g.board[B].uid];
    second.forEach(function(u){ expect(first.indexOf(u)).toBe(-1); });
  });
});
