/* 河格压子：河里不兑子、不吃子；不得与己方同格；被压的子不动、可复活。 */
import { describe, it, expect } from "vitest";
import { DRAGON, ELEPHANT, LEOPARD, ROOSTER } from "../src/constants.js";
import * as rules from "../src/rules.js";
import * as state from "../src/state.js";
import { mk, xy2i } from "./helpers/factory.js";

const from = xy2i(2, 3);   /* 陆地，紧邻河格 */
const to = xy2i(2, 4);     /* 河格 */

describe("河格压子", () => {
  it("同阶敌子不邀兑，改为压住", () => {
    state.setGame(mk([[from, DRAGON]], [[to, DRAGON]]));
    const G = state.getGame();
    const m = rules.movesFor(G, from).find(x => x.to === to);
    expect(m && m.kind).toBe("press");
    const ev = rules.applyMove(G, m);
    expect(ev.some(e => e.type === "press")).toBe(true);
    expect(G.board[to].c).toBe("r");
    expect(G.board[to].under.c).toBe("b");
    expect(G.caps.r.length + G.caps.b.length).toBe(0);
    expect(rules.counts(G)).toEqual({ r: 1, b: 1 });
  });

  it("压子不分大小：象也能压龙", () => {
    state.setGame(mk([[from, ELEPHANT]], [[to, DRAGON]]));
    const G = state.getGame();
    expect(rules.movesFor(G, from).find(x => x.to === to).kind).toBe("press");
    rules.applyMove(G, rules.movesFor(G, from).find(x => x.to === to));
    expect(G.board[to].t).toBe(ELEPHANT);
    expect(G.board[to].under.t).toBe(DRAGON);
    expect(G.caps.b.length).toBe(0);
  });

  it("不能踏入有己方棋子的河格", () => {
    state.setGame(mk([[from, DRAGON], [to, ELEPHANT]], []));
    expect(rules.movesFor(state.getGame(), from).some(m => m.to === to)).toBe(false);
  });

  it("己方子被压在下面时，该河格同样进不去", () => {
    state.setGame(mk([[from, DRAGON]], [[to, ELEPHANT]]));
    const G = state.getGame();
    G.board[to].under = { t: 7, c: "r", rv: true, uid: 70 };
    expect(rules.movesFor(G, from).some(m => m.to === to)).toBe(false);
  });

  it("被压的棋子不能动", () => {
    state.setGame(mk([[from, DRAGON]], [[to, ELEPHANT]]));
    const G = state.getGame();
    rules.applyMove(G, { from, to, kind: "press" });
    /* 黑方只剩这枚被压的象：没有任何着法（也没有暗棋可翻） */
    expect(rules.allActions(G, 1).length).toBe(0);
  });

  it("压在上面的子离开后，下面的子重新露出", () => {
    const out = xy2i(2, 5);
    state.setGame(mk([[from, DRAGON]], [[to, ELEPHANT]]));
    const G = state.getGame();
    rules.applyMove(G, { from, to, kind: "press" });
    rules.applyMove(G, { from: to, to: out, kind: "move" });
    expect(G.board[to] && G.board[to].c).toBe("b");
    expect(G.board[to] && G.board[to].t).toBe(ELEPHANT);
    expect(G.board[to].under).toBeFalsy();
    expect(G.board[out] && G.board[out].c).toBe("r");
    expect(G.board[from]).toBe(null);
  });

  it("压住时的走子记录写「压住」，且不算吃子", () => {
    state.setGame(mk([[from, ELEPHANT]], [[to, DRAGON]]));
    const G = state.getGame();
    G.noCap = 5;
    const ate = state.doMove({ from, to, kind: "press" }, 0);
    expect(ate).toBe(false);
    expect(G.noCap).toBe(6);
    expect(G.log[G.log.length - 1].h).toContain("压住");
  });

  it("豹只能从陆地跳河引爆，不能从岸上下河", () => {
    const bank = xy2i(1, 4), bank2 = xy2i(4, 4), land = xy2i(2, 3);
    /* 岸上的豹：不得跳入相邻河格 */
    state.setGame(mk([[bank, LEOPARD], [bank2, 3]], []));
    expect(rules.movesFor(state.getGame(), bank).some(m => m.kind === "dive")).toBe(false);
    /* 陆地上的豹：可以跳入相邻河格 */
    state.setGame(mk([[land, LEOPARD], [bank, 3], [bank2, 3]], []));
    const dive = rules.movesFor(state.getGame(), land).find(m => m.kind === "dive");
    expect(dive && dive.to).toBe(to);
  });

  it("河边陆地格可以跳进任意河格", () => {
    const bank = xy2i(1, 4), bank2 = xy2i(4, 4);
    const land23 = xy2i(2, 3), land33 = xy2i(3, 3);
    const r24 = xy2i(2, 4), r34 = xy2i(3, 4);
    /* 左上角 (2,3) 斜对着 (3,4)，也要能跳过去 */
    state.setGame(mk([[land23, LEOPARD], [bank, 3], [bank2, 3]], []));
    expect(rules.movesFor(state.getGame(), land23)
      .filter(m => m.kind === "dive").map(m => m.to).sort())
      .toEqual([r24, r34].sort());
    /* 右上角 (3,3) 同理 */
    state.setGame(mk([[land33, LEOPARD], [bank, 3], [bank2, 3]], []));
    expect(rules.movesFor(state.getGame(), land33)
      .filter(m => m.kind === "dive").map(m => m.to).sort())
      .toEqual([r24, r34].sort());
    /* 河另一侧的 (2,5)、(3,5) 同样可以任选河格 */
    [xy2i(2, 5), xy2i(3, 5)].forEach(function(lp){
      state.setGame(mk([[lp, LEOPARD], [bank, 3], [bank2, 3]], []));
      expect(rules.movesFor(state.getGame(), lp)
        .filter(m => m.kind === "dive").map(m => m.to).sort())
        .toEqual([r24, r34].sort());
    });
    /* 不紧挨河界的陆地豹没有这条着法 */
    const far = xy2i(1, 2);
    state.setGame(mk([[far, LEOPARD], [bank, 3], [bank2, 3]], []));
    expect(rules.movesFor(state.getGame(), far).some(m => m.kind === "dive")).toBe(false);
  });

  it("引爆会炸掉河格上下两层", () => {
    const L = xy2i(1, 4), R = xy2i(4, 4), lp = xy2i(2, 3);
    const stack = xy2i(3, 4);
    state.setGame(mk([[lp, LEOPARD], [L, 3], [R, 3], [stack, ELEPHANT]], []));
    const G = state.getGame();
    G.board[stack].under = { t: DRAGON, c: "b", rv: true, uid: 99 };
    rules.applyMove(G, { from: lp, to, kind: "dive" });
    expect(G.board[stack]).toBe(null);
    expect(G.caps.r.includes(ELEPHANT)).toBe(true);
    expect(G.caps.b.includes(DRAGON)).toBe(true);
  });

  it("河里仍有被压的子时不算死局", () => {
    const w = xy2i(2, 4);
    state.setGame(mk([[w, DRAGON]], []));
    const G = state.getGame();
    G.board[w].under = { t: ROOSTER, c: "b", rv: true, uid: 99 };
    expect(rules.deadPosition(G)).toBe(false);
    expect(rules.counts(G)).toEqual({ r: 1, b: 1 });
  });
});
