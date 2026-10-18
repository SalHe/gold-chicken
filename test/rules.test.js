/* 纯规则回归：布局不变量、吃子顺序、岸/河/堵岸/引爆、终局、AI soak。无 DOM。 */
import { describe, it, expect } from "vitest";
import { N, DRAGON, ELEPHANT, LEOPARD, ROOSTER } from "../src/constants.js";
import * as rules from "../src/rules.js";
import * as ai from "../src/ai.js";
import * as state from "../src/state.js";
import { mk, xy2i, i2xy } from "./helpers/factory.js";

const P = t => ({ t, c: "r", rv: true, uid: 1 });
const move = (from, to) => ({ from, to, kind: "move" });

describe("布局", () => {
  it("开局布局不变量", () => {
    state.newGame();
    const G = state.getGame();
    expect(G.board.length).toBe(28);
    expect(G.board.filter(Boolean).length).toBe(24);
    let bankOrRiver = 0, faceUp = 0;
    const perColor = { r: 0, b: 0 };
    for (let i = 0; i < N; i++){
      const p = G.board[i];
      if (!p) continue;
      const { x, y } = i2xy(i);
      if (y === 4) bankOrRiver++;
      if (p.rv) faceUp++;
      perColor[p.c]++;
    }
    expect(bankOrRiver).toBe(0);
    expect(faceUp).toBe(0);
    expect(perColor.r).toBe(12);
    expect(perColor.b).toBe(12);
    const kinds = {};
    G.board.forEach(p => p && (kinds[p.t] = (kinds[p.t] || 0) + 1));
    expect(Object.keys(kinds).length).toBe(12);
    expect(Object.values(kinds).every(v => v === 2)).toBe(true);
    expect(rules.allActions(G, 0).length).toBe(24);
    expect(rules.allActions(G, 0).every(a => a.kind === "flip")).toBe(true);
  });

  it("60 次新局河界始终为空", () => {
    let bad = 0;
    for (let n = 0; n < 60; n++){
      state.newGame();
      for (let i = 0; i < N; i++){
        const { y } = i2xy(i);
        if (y === 4 && state.getGame().board[i]) bad++;
      }
    }
    expect(bad).toBe(0);
  });
});

describe("吃子顺序", () => {
  it("大小与特例", () => {
    const { canEat } = rules;
    expect(canEat(P(1), P(2))).toBe(true);
    expect(canEat(P(2), P(1))).toBe(false);
    expect(canEat(P(11), P(12))).toBe(true);
    expect(canEat(P(12), P(11))).toBe(false);
    expect(canEat(P(5), P(5))).toBe(true);
    expect(canEat(P(DRAGON), P(ROOSTER))).toBe(false);
    expect(canEat(P(ROOSTER), P(DRAGON))).toBe(true);
    expect(canEat(P(DRAGON), P(DRAGON))).toBe(true);
  });
});

describe("邀兑", () => {
  it("同子同归于尽", () => {
    const a = xy2i(1, 1), b = xy2i(1, 2);
    state.setGame(mk([[a, 3]], [[b, 3]]));
    rules.applyMove(state.getGame(), move(a, b));
    const G = state.getGame();
    expect(!G.board[a] && !G.board[b]).toBe(true);
    expect(G.caps.b.includes(3)).toBe(true);
    expect(G.caps.r.includes(3)).toBe(true);
    expect(G.caps.r.length + G.caps.b.length).toBe(2);
  });

  it("同阶自残亦同归于尽", () => {
    const a = xy2i(1, 1), b = xy2i(1, 2);
    state.setGame(mk([[a, 6], [b, 6]], []));
    rules.applyMove(state.getGame(), { from: a, to: b, kind: "self" });
    expect(!state.getGame().board[a] && !state.getGame().board[b]).toBe(true);
  });
});

describe("自残", () => {
  it("大吃小、弱不能自吃强", () => {
    const a = xy2i(1, 1), b = xy2i(1, 2);
    state.setGame(mk([[a, 1], [b, 10]], []));
    const ms = rules.movesFor(state.getGame(), a);
    expect(ms.some(m => m.to === b && m.kind === "self")).toBe(true);
    expect(rules.movesFor(mk([[b, 10], [a, 1]], []), b).some(m => m.to === a)).toBe(false);
  });

  it("自残后吃子方移入目标格并计入战果", () => {
    const a = xy2i(1, 1), b = xy2i(1, 2);
    state.setGame(mk([[a, 1], [b, 10]], []));
    rules.applyMove(state.getGame(), { from: a, to: b, kind: "self" });
    const G = state.getGame();
    expect(G.board[b] && G.board[b].t).toBe(1);
    expect(G.board[a]).toBe(null);
    expect(G.caps.r.includes(10)).toBe(true);
  });

  it("普通吃子也入账", () => {
    const a = xy2i(1, 1), b = xy2i(1, 2);
    state.setGame(mk([[a, 2]], [[b, 3]]));
    rules.applyMove(state.getGame(), move(a, b));
    const G = state.getGame();
    expect(G.caps.b.includes(3)).toBe(true);
    expect(G.caps.r.length).toBe(0);
  });
});

describe("岸与渴死", () => {
  it("龙上岸渴死，其它子可站岸", () => {
    const src = xy2i(1, 3), bank = xy2i(1, 4);
    state.setGame(mk([[src, DRAGON]], [[xy2i(4, 7), 3]]));
    const ms = rules.movesFor(state.getGame(), src);
    const m = ms.find(m => m.to === bank);
    expect(m && m.kind).toBe("thirst");
    expect(state.getGame().board[bank]).toBe(null);
    rules.applyMove(state.getGame(), m);
    expect(state.getGame().board[bank]).toBe(null);
    expect(state.getGame().caps.r.includes(DRAGON)).toBe(true);

    const s2 = xy2i(1, 3);
    state.setGame(mk([[s2, 3]], []));
    rules.applyMove(state.getGame(), { from: s2, to: bank, kind: "move" });
    expect(state.getGame().board[bank] && state.getGame().board[bank].t).toBe(3);
  });
});

describe("堵岸", () => {
  it("堵岸与免疫", () => {
    const L = xy2i(1, 4), R = xy2i(4, 4);
    state.setGame(mk([[L, 3], [R, 3]], [[xy2i(2, 3), 1]]));
    const G = state.getGame();
    expect(rules.blockadeColor(G)).toBe("r");
    expect(rules.isImmune(G, G.board[L], L)).toBe(true);
    expect(rules.movesFor(G, xy2i(2, 3)).some(m => m.to === L)).toBe(false);
    const extra = xy2i(3, 6);
    G.board[extra] = { t: 6, c: "r", rv: true, uid: 77 };
    expect(rules.isImmune(G, G.board[extra], extra)).toBe(false);
    const L2 = xy2i(1, 4), R2 = xy2i(4, 4);
    state.setGame(mk([[L2, 3, false], [R2, 3, false]], []));
    expect(rules.blockadeColor(state.getGame())).toBe(null);
  });

  it("堵岸后敌方金鸡不能飞越，己方不受限", () => {
    const L = xy2i(1, 4), R = xy2i(4, 4);
    const roi = xy2i(1, 1);
    state.setGame(mk([[L, 3], [R, 3]], [[roi, ROOSTER]]));
    const ms = rules.movesFor(state.getGame(), roi);
    expect(ms.filter(m => i2xy(m.to).y > 4).length).toBe(0);
    const roi2 = xy2i(1, 1);
    state.setGame(mk([[L, 3], [R, 3], [roi2, ROOSTER]], []));
    state.getGame().pcolor = ["b", "r"];
    expect(rules.movesFor(state.getGame(), roi2).some(m => i2xy(m.to).y > 4)).toBe(true);
  });

  it("堵岸时，岸上的象可跃入任意河格", () => {
    const L = xy2i(1, 4), R = xy2i(4, 4), r24 = xy2i(2, 4), r34 = xy2i(3, 4);
    const riverDests = (g, i) => rules.movesFor(g, i)
      .filter(m => rules.isRiver(m.to)).map(m => m.to).sort((a, b) => a - b);

    /* 未堵岸：岸上的象只能进正对的那一格河 */
    state.setGame(mk([[L, ELEPHANT]], []));
    expect(riverDests(state.getGame(), L)).toEqual([r24]);

    /* 己方堵岸：两格河都能进，且没有重复着法 */
    state.setGame(mk([[L, ELEPHANT], [R, 9]], []));
    const G = state.getGame();
    expect(riverDests(G, L)).toEqual([r24, r34]);
    expect(rules.movesFor(G, L).filter(m => m.to === r24).length).toBe(1);

    /* 另一格河里有敌子：照常「压住」 */
    state.setGame(mk([[L, ELEPHANT], [R, 9]], [[r34, DRAGON]]));
    const G2 = state.getGame();
    expect(rules.movesFor(G2, L).find(m => m.to === r34).kind).toBe("press");

    /* 河格已有己方子（明面或被压在下面）：跳不进去 */
    G2.board[r34] = { t: 7, c: "r", rv: true, uid: 90 };
    expect(rules.movesFor(G2, L).some(m => m.to === r34)).toBe(false);
    G2.board[r34] = { t: DRAGON, c: "b", rv: true, uid: 91,
      under: { t: 7, c: "r", rv: true, uid: 92 } };
    expect(rules.movesFor(G2, L).some(m => m.to === r34)).toBe(false);

    /* 象一离开岸，堵岸即解除 */
    state.setGame(mk([[L, ELEPHANT], [R, 9]], []));
    const G3 = state.getGame();
    rules.applyMove(G3, { from: L, to: r34, kind: "move" });
    expect(rules.blockadeColor(G3)).toBe(null);
  });
});

describe("河", () => {
  it("龙象可下河，其余不可", () => {
    const r1 = xy2i(2, 3), r2 = xy2i(2, 4);
    state.setGame(mk([[r1, DRAGON]], []));
    expect(rules.movesFor(state.getGame(), r1).some(m => m.to === r2)).toBe(true);
    state.setGame(mk([[r1, ELEPHANT]], []));
    expect(rules.movesFor(state.getGame(), r1).some(m => m.to === r2)).toBe(true);
    for (const t of [2, 3, 5, 6, 7, 8, 9, 10, 11, ROOSTER]){
      state.setGame(mk([[r1, t]], []));
      expect(rules.movesFor(state.getGame(), r1).some(m => m.to === r2)).toBe(false);
    }
  });

  it("河中棋子六格出水", () => {
    const rv1 = xy2i(2, 4), rv2 = xy2i(3, 4);
    const EXITS = [xy2i(1, 4), xy2i(4, 4), xy2i(2, 3), xy2i(3, 3), xy2i(2, 5), xy2i(3, 5)];
    state.setGame(mk([[rv1, ELEPHANT]], []));
    const ms = rules.movesFor(state.getGame(), rv1);
    const dests = ms.map(m => m.to).sort((a, b) => a - b);
    expect(dests.length).toBe(6);
    expect(dests.join(",")).toBe(EXITS.slice().sort((a, b) => a - b).join(","));
    expect(ms.some(m => m.to === rv2)).toBe(false);

    state.setGame(mk([[rv2, ELEPHANT]], []));
    const ms2 = rules.movesFor(state.getGame(), rv2).map(m => m.to).sort((a, b) => a - b);
    expect(ms2.join(",")).toBe(dests.join(","));

    for (const bad of [xy2i(1, 3), xy2i(4, 3), xy2i(1, 5), xy2i(4, 5), xy2i(2, 2), xy2i(2, 6)]){
      expect(rules.movesFor(mk([[rv1, ELEPHANT]], []), rv1).some(m => m.to === bad)).toBe(false);
    }

    state.setGame(mk([[rv1, DRAGON]], []));
    const dms = rules.movesFor(state.getGame(), rv1);
    expect(dms.length).toBe(6);
    expect(dms.filter(m => m.kind === "thirst").length).toBe(2);
  });

  it("出水可吃/自残出口上的子", () => {
    const rv1 = xy2i(2, 4);
    state.setGame(mk([[rv1, ELEPHANT]], [[xy2i(3, 5), 6]]));
    const m = rules.movesFor(state.getGame(), rv1).find(x => x.to === xy2i(3, 5));
    expect(m && m.kind).toBe("capture");
    state.setGame(mk([[rv1, ELEPHANT]], [[xy2i(3, 5), 1]]));
    expect(rules.movesFor(state.getGame(), rv1).some(x => x.to === xy2i(3, 5))).toBe(false);
    state.setGame(mk([[rv1, ELEPHANT], [xy2i(3, 5), 7]], []));
    const s = rules.movesFor(state.getGame(), rv1).find(x => x.to === xy2i(3, 5));
    expect(s && s.kind).toBe("self");
  });

  it("龙象可以从河边陆地斜着进河", () => {
    const diag = xy2i(3, 3), target = xy2i(2, 4), other = xy2i(3, 4);

    /* 斜角的 (3,3) → (2,4)，龙、象都可以 */
    state.setGame(mk([[diag, ELEPHANT]], []));
    expect(rules.movesFor(state.getGame(), diag).some(m => m.to === target && m.kind === "move")).toBe(true);
    state.setGame(mk([[diag, DRAGON]], []));
    expect(rules.movesFor(state.getGame(), diag).some(m => m.to === target)).toBe(true);

    /* 四个河边陆地格都能进任一河格，且不发生重复着法 */
    for (const [x, y] of [[2, 3], [3, 3], [2, 5], [3, 5]]){
      const from = xy2i(x, y);
      state.setGame(mk([[from, ELEPHANT]], []));
      const ms = rules.movesFor(state.getGame(), from);
      const dests = ms.filter(m => rules.isRiver(m.to)).map(m => m.to).sort((a, b) => a - b);
      expect(dests).toEqual([target, other].sort((a, b) => a - b));
      expect(ms.filter(m => m.to === target).length).toBe(1);
    }

    /* 斜着进有敌子的河格是「压住」，有己方子的河格进不去 */
    state.setGame(mk([[diag, ELEPHANT]], [[target, DRAGON]]));
    expect(rules.movesFor(state.getGame(), diag).find(m => m.to === target).kind).toBe("press");
    state.setGame(mk([[diag, ELEPHANT], [target, 7]], []));
    expect(rules.movesFor(state.getGame(), diag).some(m => m.to === target)).toBe(false);

    /* 不能下河的棋子依旧不能斜着进河 */
    state.setGame(mk([[diag, LEOPARD]], []));
    expect(rules.movesFor(state.getGame(), diag).some(m => m.to === target)).toBe(false);
  });

  it("敌方堵岸封死河中之子，拆岸即解封", () => {
    const L = xy2i(1, 4), R = xy2i(4, 4), rv1 = xy2i(2, 4);
    state.setGame(mk([[rv1, DRAGON]], [[L, 3], [R, 3]]));
    expect(rules.movesFor(state.getGame(), rv1).length).toBe(0);
    state.setGame(mk([[rv1, DRAGON], [L, 3], [R, 3]], []));
    expect(rules.movesFor(state.getGame(), rv1).length).toBeGreaterThan(0);
    state.setGame(mk([[rv1, DRAGON]], [[L, 3, false], [R, 3, false]]));
    expect(rules.movesFor(state.getGame(), rv1).length).toBeGreaterThan(0);
    const land = xy2i(1, 6);
    state.setGame(mk([[rv1, DRAGON], [land, 3]], [[L, 1], [R, 1]]));
    expect(rules.movesFor(state.getGame(), land).length).toBeGreaterThan(0);
    state.setGame(mk([[rv1, ELEPHANT]], [[L, 3], [R, 3]]));
    expect(rules.movesFor(state.getGame(), rv1).length).toBe(0);
    state.setGame(mk([[rv1, DRAGON]], [[L, 3], [R, 3]]));
    expect(rules.movesFor(state.getGame(), rv1).length).toBe(0);
    state.getGame().board[L] = null;
    expect(rules.movesFor(state.getGame(), rv1).length).toBeGreaterThan(0);
  });
});

describe("金鸡", () => {
  it("飞行不受阻挡，落点不含河格", () => {
    const at = xy2i(2, 2);
    state.setGame(mk([[at, ROOSTER]], []));
    const ms = rules.movesFor(state.getGame(), at);
    expect(ms.length).toBe(25);
    expect(ms.some(m => i2xy(m.to).y === 4 && (i2xy(m.to).x === 2 || i2xy(m.to).x === 3))).toBe(false);
    expect(ms.some(m => i2xy(m.to).x === 1 && i2xy(m.to).y === 4)).toBe(true);
    const around = [[1, 2], [3, 2], [2, 1], [2, 3]].map(([x, y]) => [xy2i(x, y), 3]);
    state.setGame(mk([[at, ROOSTER]], around));
    expect(rules.movesFor(state.getGame(), at).length).toBeGreaterThan(4);
  });
});

describe("豹引爆", () => {
  it("堵岸后可引爆，清空 Y3–Y5", () => {
    const L = xy2i(1, 4), R = xy2i(4, 4), lp = xy2i(2, 3), river = xy2i(2, 4);
    state.setGame(mk([[lp, LEOPARD]], [[xy2i(1, 1), 3]]));
    expect(rules.movesFor(state.getGame(), lp).some(m => m.kind === "dive")).toBe(false);
    state.setGame(mk([[lp, LEOPARD], [L, 3], [R, 3]], []));
    const dv = rules.movesFor(state.getGame(), lp).find(m => m.to === river);
    expect(dv && dv.kind).toBe("dive");
    state.getGame().board[river] = { t: 5, c: "b", rv: true, uid: 88 };
    /* 河格被占也照样能扑进去：落点上的棋子随引爆一并阵亡 */
    expect(rules.movesFor(state.getGame(), lp).some(m => m.to === river && m.kind === "dive")).toBe(true);
    const other = xy2i(3, 4);
    expect(rules.movesFor(state.getGame(), lp).some(m => m.to === other && m.kind === "dive")).toBe(true);
    state.getGame().board[other] = { t: 6, c: "b", rv: true, uid: 89 };
    /* 两个河格都被占，依然可以引爆 */
    expect(rules.movesFor(state.getGame(), lp).some(m => m.kind === "dive")).toBe(true);

    const setup = mk([[lp, LEOPARD], [L, 3], [R, 3]], [[xy2i(2, 3), 1], [xy2i(4, 5), 2], [xy2i(1, 6), 3]]);
    state.setGame(setup);
    const before3 = setup.board.filter((p, i) => p && i2xy(i).y >= 3 && i2xy(i).y <= 5).length;
    expect(before3).toBeGreaterThan(0);
    rules.applyMove(state.getGame(), { from: lp, to: river, kind: "dive" });
    let left = 0;
    for (let i = 0; i < N; i++){
      const y = i2xy(i).y;
      if (y >= 3 && y <= 5 && state.getGame().board[i]) left++;
    }
    expect(left).toBe(0);
    expect(state.getGame().caps.r.length > 0 && state.getGame().caps.b.length > 0).toBe(true);
    expect(state.getGame().board[xy2i(1, 6)] && state.getGame().board[xy2i(1, 6)].t).toBe(3);
  });

  it("河格被占时也能引爆，落点上的子与压着的子一并阵亡", () => {
    const L = xy2i(1, 4), R = xy2i(4, 4), lp = xy2i(2, 3);
    const target = xy2i(2, 4), other = xy2i(3, 4);
    state.setGame(mk(
      [[lp, LEOPARD], [L, 3], [R, LEOPARD], [target, ELEPHANT]],
      [[xy2i(4, 5), 2]]
    ));
    const G = state.getGame();
    G.board[target].under = { t: DRAGON, c: "b", rv: true, uid: 99 };

    expect(rules.movesFor(G, lp).some(m => m.to === target && m.kind === "dive")).toBe(true);
    rules.applyMove(G, { from: lp, to: target, kind: "dive" });

    expect(G.board[target]).toBe(null);
    expect(G.board[other]).toBe(null);
    expect(G.board[lp]).toBe(null);
    /* 落点上的象、被压住的龙，以及爆区内的麒麟都要计入阵亡 */
    expect(G.caps.r).toEqual(expect.arrayContaining([ELEPHANT, LEOPARD, 3]));
    expect(G.caps.b).toEqual(expect.arrayContaining([DRAGON, 2]));
    let left = 0;
    for (let i = 0; i < N; i++){
      const y = i2xy(i).y;
      if (y >= 3 && y <= 5 && G.board[i]) left++;
    }
    expect(left).toBe(0);
  });
});

describe("暗棋", () => {
  it("不可动不可吃，只贡献翻棋", () => {
    const a = xy2i(1, 1), b = xy2i(1, 2);
    state.setGame(mk([[a, DRAGON]], [[b, 3, false]]));
    expect(rules.movesFor(state.getGame(), a).some(m => m.to === b)).toBe(false);
    expect(rules.movesFor(state.getGame(), b).length).toBe(0);
    expect(rules.allActions(state.getGame(), 0).length).toBe(2);
  });
});

describe("终局", () => {
  it("吃光对方即胜", () => {
    state.setGame(mk([[xy2i(1, 1), 1]], []));
    state.checkResult();
    expect(state.getGame().result && state.getGame().result.kind).toBe("win");
    expect(state.getGame().result.winner).toBe("r");
  });
  it("双方同归于尽判和", () => {
    state.setGame(mk([], []));
    state.checkResult();
    expect(state.getGame().result.kind).toBe("draw");
  });
  it("60 手无吃子判和", () => {
    state.setGame(mk([[xy2i(1, 1), 1]], [[xy2i(4, 7), 1]], { noCap: 60 }));
    state.checkResult();
    expect(state.getGame().result.kind).toBe("draw");
    state.setGame(mk([[xy2i(1, 1), 1]], [[xy2i(4, 7), 1]], { noCap: 59 }));
    expect(state.checkResult()).toBe(null);
  });
  it("无着可走判负（困毙）", () => {
    const corner = xy2i(2, 1);
    state.setGame(mk([[corner, 8]], [[xy2i(1, 1), 1], [xy2i(3, 1), 1], [xy2i(2, 2), 1]]));
    expect(rules.allActions(state.getGame(), 0).length).toBe(0);
    state.checkResult();
    expect(state.getGame().result.kind).toBe("win");
    expect(state.getGame().result.winner).toBe("b");
    expect(state.getGame().result.stalemate).toBe(true);
  });
});

describe("死局守卫", () => {
  it("deadPosition 判定", () => {
    state.setGame(mk([[xy2i(1, 1), DRAGON]], [[xy2i(4, 7), ROOSTER]]));
    expect(rules.deadPosition(state.getGame())).toBe(false);
    state.setGame(mk([[xy2i(1, 1), 1]], [[xy2i(1, 2), 1]]));
    expect(rules.deadPosition(state.getGame())).toBe(false);
    state.setGame(mk([[xy2i(1, 1), 1, false]], [[xy2i(4, 7), 3]]));
    expect(rules.deadPosition(state.getGame())).toBe(false);
  });
});

describe("对局 soak", () => {
  /* 整局对弈是同步计算；每跑几盘让出一次事件循环，避免长时间占住
     worker 线程导致 Vitest 的 RPC 心跳超时（表现为 unhandled error）。 */
  it("120 局自然终局无死锁", async () => {
    let stalls = 0, games = 0, wins = 0, draws = 0, maxPly = 0;
    /* 终局由 60 手无吃子/死局/吃光保证；这里只是防止实现死循环的守卫，
       取 800 手留足余量（实测单局最长约 400 手）。 */
    const PLY_CAP = 800;
    for (let n = 0; n < 120; n++){
      state.newGame();
      games++;
      let ply = 0;
      while (ply < PLY_CAP){
        const G = state.getGame();
        const acts = rules.allActions(G, G.turn);
        if (!acts.length) break;
        if (G.firstFlip && G.pcolor[G.turn]){
          const d = ai.aiPick(G, G.turn);
          if (!d) { stalls++; break; }
          if (d.kind === "flip") state.doFlip(d.i, G.turn);
          else state.doMove(d, G.turn);
        } else {
          const fs = acts.filter(a => a.kind === "flip");
          const a = fs[Math.random() * fs.length | 0];
          state.doFlip(a.i, G.turn);
        }
        G.turn = 1 - G.turn;
        const r = state.checkResult();
        ply++;
        if (r) break;
      }
      maxPly = Math.max(maxPly, ply);
      if (ply >= PLY_CAP && !state.getGame().result) stalls++;
      if (state.getGame().result && state.getGame().result.kind === "win") wins++; else draws++;
      if (n % 5 === 4) await new Promise(r => setTimeout(r, 0));
    }
    expect(stalls).toBe(0);
    expect(draws).toBeGreaterThan(0);
  });
});
