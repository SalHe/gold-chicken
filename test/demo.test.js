/* 对局 Demo：起点 + 走子序列的存取与回放；悔棋不限制次数。无 DOM。 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { LEOPARD } from "../src/constants.js";
import * as state from "../src/state.js";
import * as demo from "../src/demo.js";
import { mk, xy2i } from "./helpers/factory.js";

const R0 = xy2i(1, 1), R1 = xy2i(1, 2);
const B0 = xy2i(4, 7), B1 = xy2i(4, 6);

function newBoard(){
  return mk(
    [[R0, LEOPARD, false]],
    [[B0, LEOPARD]]
  );
}

describe("Demo 回放", () => {
  beforeEach(() => { state.setMode("pvp"); state.setAiFirst(false); });
  afterEach(() => { state.endReplay(); });

  it("按记录的起点与走子序列能重现最终局面", () => {
    state.setGame(newBoard());
    var start = state.getBaseSnapshot();
    state.commit({ kind: "flip", i: R0 });
    state.commit({ kind: "move", from: B0, to: B1 });
    state.commit({ kind: "move", from: R0, to: R1 });
    state.commit({ kind: "move", from: B1, to: B0 });
    var acts = state.getActions().slice();
    var expected = JSON.stringify(state.getGame());

    /* 换一盘无关的对局，再从起点重放 */
    state.setGame(mk([[xy2i(3, 1), LEOPARD]], [[xy2i(1, 7), LEOPARD]]));
    expect(state.beginReplay(start, acts)).toBe(true);
    expect(state.getReplayInfo()).toEqual({ idx: 0, total: acts.length });
    while (state.replayStep());
    expect(state.getReplayInfo()).toEqual({ idx: acts.length, total: acts.length });
    expect(JSON.stringify(state.getGame())).toBe(expected);
  });

  it("退出回放会原样恢复回放前的对局与悔棋栈", () => {
    /* 回放前的对局：先走一步，保证悔棋栈非空 */
    state.setGame(newBoard());
    state.commit({ kind: "flip", i: R0 });
    var before = state.snapshot();
    var stackLen = state.getUndoStack().length;
    expect(stackLen).toBe(1);

    expect(state.beginReplay(state.getBaseSnapshot(), [])).toBe(true);
    expect(state.isReplaying()).toBe(true);
    expect(state.getUndoStack().length).toBe(0);

    expect(state.endReplay()).toBe(true);
    expect(state.isReplaying()).toBe(false);
    expect(state.snapshot()).toBe(before);
    expect(state.getUndoStack().length).toBe(stackLen);

    /* 悔棋栈确实还能用 */
    expect(state.undo(1)).toBe(true);
    expect(state.getGame().board[R0].rv).toBe(false);
  });

  it("记录不合法时立即退出回放并还原", () => {
    state.setGame(newBoard());
    var before = state.snapshot();
    expect(state.beginReplay(state.getBaseSnapshot(), [
      { kind: "move", from: xy2i(2, 2), to: xy2i(2, 3) }
    ])).toBe(true);
    expect(state.replayStep()).toBe(false);
    expect(state.isReplaying()).toBe(false);
    expect(state.snapshot()).toBe(before);
  });

  it("回放期间不能再开一盘回放", () => {
    state.setGame(newBoard());
    var start = state.getBaseSnapshot();
    expect(state.beginReplay(start, [])).toBe(true);
    expect(state.beginReplay(start, [])).toBe(false);
  });
});

describe("悔棋不限制次数", () => {
  beforeEach(() => { state.setMode("pvp"); });

  it("可以一路悔到开局，之后不再可悔", () => {
    state.setGame(newBoard());
    var start = state.getBaseSnapshot();
    var moves = [
      { kind: "flip", i: R0 },
      { kind: "move", from: B0, to: B1 },
      { kind: "move", from: R0, to: R1 },
      { kind: "move", from: B1, to: B0 },
      { kind: "move", from: R1, to: R0 },
      { kind: "move", from: B0, to: B1 }
    ];
    moves.forEach(a => state.commit(a));
    expect(state.getActions().length).toBe(6);

    /* 一手一手地悔，悔棋栈始终保留 */
    for (var k = 6; k > 0; k--){
      expect(state.getUndoStack().length).toBe(k);
      expect(state.undo(1)).toBe(true);
    }
    expect(state.getUndoStack().length).toBe(0);
    expect(state.getActions().length).toBe(0);
    expect(state.getGame()).toEqual(JSON.parse(start).g);
    expect(state.undo(1)).toBe(false);
  });

  it("undo(n) 一次退多手，步数超过栈深时退到开局为止", () => {
    state.setGame(newBoard());
    state.commit({ kind: "flip", i: R0 });
    state.commit({ kind: "move", from: B0, to: B1 });
    state.commit({ kind: "move", from: R0, to: R1 });

    expect(state.undo(9)).toBe(true);
    expect(state.getUndoStack().length).toBe(0);
    expect(state.getGame().firstFlip).toBe(true);
    expect(state.getGame().board[R0].rv).toBe(false);
    expect(state.getGame().turn).toBe(0);
  });

  it("悔棋后的走子序列与新走法保持同步", () => {
    state.setGame(newBoard());
    state.commit({ kind: "flip", i: R0 });
    state.commit({ kind: "move", from: B0, to: B1 });
    state.undo(1);
    state.commit({ kind: "move", from: B0, to: B1 });
    expect(state.getActions()).toEqual([
      { kind: "flip", i: R0 },
      { kind: "move", from: B0, to: B1 }
    ]);
    expect(state.getUndoStack().length).toBe(2);
  });
});

describe("Demo 存储", () => {
  var saved;
  beforeEach(() => { saved = globalThis.localStorage; });
  afterEach(() => {
    if (saved === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = saved;
  });

  function stub(){
    var m = new Map();
    return {
      getItem: k => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => { m.set(k, String(v)); },
      removeItem: k => { m.delete(k); }
    };
  }

  it("没有 localStorage 时安静地返回空列表且保存失败", () => {
    delete globalThis.localStorage;
    expect(demo.listDemos()).toEqual([]);
    expect(demo.saveDemo({ id: "x", start: "{}", actions: [] })).toBe(false);
    expect(demo.getDemo("x")).toBe(null);
  });

  it("保存、读取、删除一条 Demo", () => {
    globalThis.localStorage = stub();
    var d = { id: "d1", at: 123, result: null, start: "{}", actions: [{ kind: "flip", i: 0 }] };
    expect(demo.saveDemo(d)).toBe(true);
    expect(demo.listDemos().length).toBe(1);
    expect(demo.getDemo("d1").id).toBe("d1");
    expect(demo.getDemo("nope")).toBe(null);
    expect(demo.removeDemo("d1")).toBe(true);
    expect(demo.listDemos()).toEqual([]);
  });

  it("新存的排在前面，最多保留 30 条", () => {
    globalThis.localStorage = stub();
    for (var k = 0; k < 33; k++){
      demo.saveDemo({ id: "d" + k, at: k, start: "{}", actions: [] });
    }
    var list = demo.listDemos();
    expect(list.length).toBe(30);
    expect(list[0].id).toBe("d32");
  });

  it("条目结构不完整时拒绝保存", () => {
    globalThis.localStorage = stub();
    expect(demo.saveDemo({ id: "x", actions: [] })).toBe(false);
    expect(demo.saveDemo({ id: "x", start: "{}" })).toBe(false);
    expect(demo.saveDemo(null)).toBe(false);
    expect(demo.listDemos()).toEqual([]);
  });
});
