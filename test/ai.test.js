/* AI 策略：终局意识、兑子/保护估值、堵岸、压子价值、暗棋公平性。 */
import { describe, it, expect } from "vitest";
import { N, DRAGON, ELEPHANT, LEOPARD, VAL } from "../src/constants.js";
import * as rules from "../src/rules.js";
import * as ai from "../src/ai.js";
import { mk, xy2i } from "./helpers/factory.js";

const RAT = 11;

describe("终局意识", () => {
  it("识别吃光胜与和棋", () => {
    const win = mk([[xy2i(1, 1), DRAGON]], []);
    expect(ai.terminalScore(win, 0)).toBeGreaterThan(1e6);

    const none = mk([], []);
    expect(ai.terminalScore(none, 0)).toBe(0);

    const draw = mk([[xy2i(1, 1), DRAGON]], [[xy2i(1, 2), RAT]], { noCap: 60 });
    expect(ai.terminalScore(draw, 0)).toBe(0);
  });

  it("优先选择能立刻结束对局的一手", () => {
    /* 红方走完这手，黑方只剩一只鼠且无路可走（或直接被吃光） */
    const A = xy2i(1, 2), B = xy2i(2, 2), C = xy2i(1, 1);
    const g = mk([[A, DRAGON], [B, ELEPHANT]], [[C, RAT]]);
    expect(ai.terminalScore(g, 0)).toBe(null);

    const a = ai.aiPick(g, 0);
    expect(a).not.toBe(null);
    const g2 = ai.cloneG(g);
    rules.applyMove(g2, a);
    expect(ai.terminalScore(g2, 0)).toBeGreaterThan(1e6);
  });
});

describe("交战估值", () => {
  const ctx = (from, to, kind, bl) => ({ kindAt: { [from]: { [to]: kind } }, bl: bl || null });

  it("同阶邀兑不当作赚子", () => {
    const from = xy2i(1, 2), to = xy2i(2, 2);
    const g = mk([[from, LEOPARD]], [[to, LEOPARD]]);
    expect(ai.attackGain(g, from, to, ctx(from, to, "capture"))).toBe(0);
  });

  it("吃有保护的子要扣掉被反吃的损失", () => {
    const from = xy2i(1, 2), to = xy2i(2, 2), guard = xy2i(2, 3);
    const free = mk([[from, LEOPARD]], [[to, 7]]);
    expect(ai.attackGain(free, from, to, ctx(from, to, "capture"))).toBe(VAL[7]);

    const guarded = mk([[from, LEOPARD]], [[to, 7], [guard, LEOPARD]]);
    expect(ai.attackGain(guarded, from, to, ctx(from, to, "capture")))
      .toBe(VAL[7] - VAL[LEOPARD]);
  });

  it("压子按被压棋子的价值计价；龙上岸渴死是净亏", () => {
    const from = xy2i(1, 2), to = xy2i(2, 2);
    const g = mk([[from, ELEPHANT]], [[to, DRAGON]]);
    expect(ai.attackGain(g, from, to, ctx(from, to, "press")))
      .toBeCloseTo(0.3 * VAL[DRAGON]);

    const g2 = mk([[from, DRAGON]], [[to, RAT]]);
    expect(ai.attackGain(g2, from, to, ctx(from, to, "thirst")))
      .toBe(VAL[RAT] - VAL[DRAGON]);
  });
});

describe("局面估值", () => {
  it("己方堵岸是正收益", () => {
    const block = mk(
      [[xy2i(1, 4), 7], [xy2i(4, 4), LEOPARD]],
      [[xy2i(2, 2), ELEPHANT]]
    );
    const open = mk(
      [[xy2i(1, 3), 7], [xy2i(4, 3), LEOPARD]],
      [[xy2i(2, 2), ELEPHANT]]
    );
    expect(ai.evalPos(block, "r")).toBeGreaterThan(ai.evalPos(open, "r") + 20);
  });

  it("压住龙比压住象更有价值", () => {
    const cell = xy2i(2, 4), free = xy2i(1, 5);
    const pressDragon = mk([[cell, ELEPHANT]], [[free, ELEPHANT]]);
    pressDragon.board[cell].under = { t: DRAGON, c: "b", rv: true, uid: 99 };
    const pressElephant = mk([[cell, ELEPHANT]], [[free, DRAGON]]);
    pressElephant.board[cell].under = { t: ELEPHANT, c: "b", rv: true, uid: 99 };
    expect(ai.evalPos(pressDragon, "r")).toBeGreaterThan(ai.evalPos(pressElephant, "r") + 10);
  });
});

describe("暗棋公平性", () => {
  it("暗棋身份不参与局面估值", () => {
    const A = xy2i(1, 1), B = xy2i(4, 7);
    const g1 = mk([[A, LEOPARD]], [[B, LEOPARD, false]]);
    const g2 = mk([[A, LEOPARD]], [[B, DRAGON, false]]);
    expect(ai.evalPos(g1, "r")).toBe(ai.evalPos(g2, "r"));
  });

  it("交换两枚暗子的真实身份不会改变 AI 的选择", () => {
    /* 满盘 24 枚全暗：公开信息完全相同，只有未公开的身份被交换。
       固定随机数后，公平的 AI 必须给出同一手；若读取了暗子身份就会分叉。 */
    const cells = [];
    for (let i = 0; i < N; i++){
      if (!rules.isRiver(i) && !rules.isBank(i)) cells.push(i);
    }
    function board(swap){
      const reds = [], blacks = [];
      for (let t = 1; t <= 12; t++){
        reds.push([cells[t - 1], t, false]);
        blacks.push([cells[11 + t], t, false]);
      }
      if (swap){
        const t0 = blacks[0][1], t5 = blacks[5][1];
        blacks[0][1] = t5; blacks[5][1] = t0;
      }
      return mk(reds, blacks);
    }

    const rnd = Math.random;
    Math.random = () => 0.42;
    let a1, a2;
    try {
      a1 = ai.aiPick(board(false), 0);
      a2 = ai.aiPick(board(true), 0);
    } finally {
      Math.random = rnd;
    }
    expect(a1).toEqual(a2);
  });
});
