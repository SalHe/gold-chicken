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

describe("回放跳转与接手", () => {
  beforeEach(() => { state.setMode("pvp"); state.setAiFirst(false); });
  afterEach(() => { state.endReplay(); });

  /* 走三步并留下每一步的快照，供回放任意跳转后比对 */
  function setup(){
    state.setGame(newBoard());
    var start = state.getBaseSnapshot();
    var snaps = [state.snapshot()];
    var moves = [
      { kind: "flip", i: R0 },
      { kind: "move", from: B0, to: B1 },
      { kind: "move", from: R0, to: R1 }
    ];
    moves.forEach(a => { state.commit(a); snaps.push(state.snapshot()); });
    return { start: start, acts: state.getActions().slice(), snaps: snaps };
  }

  it("可以向前、向后跳到任意一手", () => {
    var o = setup();
    expect(state.beginReplay(o.start, o.acts)).toBe(true);

    while (state.replayStep());
    expect(state.getReplayInfo().idx).toBe(3);

    expect(state.replayGoto(1)).toBe(true);
    expect(state.getReplayInfo().idx).toBe(1);
    expect(state.getGame()).toEqual(JSON.parse(o.snaps[1]).g);

    expect(state.replayGoto(0)).toBe(true);
    expect(state.getGame()).toEqual(JSON.parse(o.snaps[0]).g);

    expect(state.replayGoto(99)).toBe(true);   /* 超出范围时夹到末手 */
    expect(state.getReplayInfo().idx).toBe(3);
    expect(state.getGame()).toEqual(JSON.parse(o.snaps[3]).g);
  });

  it("行棋记录带手数标记，可在跳转后重建", () => {
    var o = setup();
    expect(state.beginReplay(o.start, o.acts)).toBe(true);

    expect(state.replayStep()).toBe(true);
    var log = state.getGame().log;
    expect(log.length).toBe(1);
    expect(log[0].step).toBe(1);

    /* 跳回起点日志随之清空，再跳回来又能重建 */
    expect(state.replayGoto(0)).toBe(true);
    expect(state.getGame().log.length).toBe(0);
    expect(state.replayGoto(2)).toBe(true);
    expect(state.getGame().log.map(l => l.step)).toEqual([1, 2]);

    /* step 不写入快照，回放前后局面仍可逐字节比较 */
    expect(state.snapshot()).not.toContain('"step"');
  });

  it("可以把当前回放局面变成一局可继续的对局", () => {
    var o = setup();
    expect(state.beginReplay(o.start, o.acts)).toBe(true);
    expect(state.replayStep()).toBe(true);
    expect(state.replayStep()).toBe(true);     /* 停在第 2 手，轮到红方 */

    expect(state.adoptReplay()).toBe(true);
    expect(state.isReplaying()).toBe(false);
    expect(state.endReplay()).toBe(false);     /* 回放前的对局已被丢弃 */
    expect(state.getActions()).toEqual([]);
    expect(state.getUndoStack().length).toBe(0);
    expect(state.getBaseSnapshot()).toBe(state.snapshot());
    expect(state.getGame().turn).toBe(0);

    /* 从这里接着下：悔棋/保存 Demo 都以接手时刻为起点 */
    state.commit({ kind: "move", from: R0, to: R1 });
    expect(state.getActions().length).toBe(1);
    expect(state.getUndoStack().length).toBe(1);
    expect(state.undo(1)).toBe(true);
    expect(state.getGame()).toEqual(JSON.parse(o.snaps[2]).g);
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

  function validDemo(id, cell){
    return {
      id: id, at: 123, result: null,
      start: JSON.stringify({ g: { board: [cell || 0] } }),
      actions: [{ kind: "move", from: 0, to: 1 }]
    };
  }

  it("parseDemos 接受单条、数组与整份列表，跳过坏条目", () => {
    var d = validDemo("d1");
    expect(demo.parseDemos(JSON.stringify(d))).toHaveLength(1);
    expect(demo.parseDemos(JSON.stringify([d, validDemo("d2")]))).toHaveLength(2);
    expect(demo.parseDemos("not json")).toEqual([]);
    expect(demo.parseDemos(JSON.stringify([
      d,
      { start: "{}", actions: [{ kind: "flip" }] },       /* start 里没有棋盘 */
      { start: "not json", actions: [{ kind: "flip" }] },
      { start: d.start, actions: [] },                    /* 没有动作 */
      null
    ]))).toHaveLength(1);
  });

  it("importDemos 导入有效条目并跳过完全重复的对局", () => {
    globalThis.localStorage = stub();
    expect(demo.importDemos("not json")).toBe(0);
    expect(demo.importDemos(JSON.stringify([validDemo("d1")]))).toBe(1);
    expect(demo.importDemos(JSON.stringify([validDemo("d1")]))).toBe(0);
    expect(demo.listDemos()).toHaveLength(1);
  });

  it("导入时保留可用 id，冲突或缺失则重新分配", () => {
    globalThis.localStorage = stub();
    demo.importDemos(JSON.stringify([validDemo("d1", 1)]));
    demo.importDemos(JSON.stringify([validDemo("d1", 2)]));     /* 同 id、不同对局 */
    var noId = validDemo("", 3);
    demo.importDemos(JSON.stringify([noId]));

    var list = demo.listDemos();
    expect(list).toHaveLength(3);
    var ids = list.map(function(d){ return d.id; });
    expect(ids.filter(function(x){ return x === "d1"; })).toHaveLength(1);
    ids.forEach(function(x){ expect(x).toBeTruthy(); });
    expect(new Set(ids).size).toBe(3);
  });
});
