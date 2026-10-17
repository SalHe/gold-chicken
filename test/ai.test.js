/* AI 策略：终局意识、兑子/保护估值、堵岸、压子价值、暗棋公平性。 */
import { describe, it, expect } from "vitest";
import { N, DRAGON, ELEPHANT, LEOPARD, ROOSTER, VAL } from "../src/constants.js";
import * as rules from "../src/rules.js";
import * as ai from "../src/ai.js";
import * as state from "../src/state.js";
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

describe("龙、金鸡与河界", () => {
  it("受到敌方金鸡威胁时，龙沉入河中更安全", () => {
    const land = mk([[xy2i(2, 3), DRAGON]], [[xy2i(4, 7), ROOSTER]]);
    const river = mk([[xy2i(2, 4), DRAGON]], [[xy2i(4, 7), ROOSTER]]);
    expect(ai.evalPos(river, "r")).toBeGreaterThan(ai.evalPos(land, "r") + 30);
  });

  it("AI 会把被金鸡盯上的龙挪进河里", () => {
    const g = mk([[xy2i(2, 3), DRAGON]], [[xy2i(4, 7), ROOSTER]]);
    /* 两个河格都安全；龙还可以斜着下河，落哪一格由估值决定 */
    expect(rules.isRiver(ai.aiPick(g, 0).to)).toBe(true);
  });

  it("堵岸把敌方金鸡挡在河界另一侧时，己方龙更安全", () => {
    const bankL = xy2i(1, 4), bankR = xy2i(4, 4), dragon = xy2i(1, 2);
    const reds = [[bankL, 3], [bankR, LEOPARD], [dragon, DRAGON]];
    const farSide = mk(reds, [[xy2i(4, 7), ROOSTER]]);
    const sameSide = mk(reds, [[xy2i(4, 2), ROOSTER]]);
    expect(ai.evalPos(farSide, "r")).toBeGreaterThan(ai.evalPos(sameSide, "r") + 40);
  });

  it("豹能一波炸掉更多敌子时，引爆期权更有价值", () => {
    const reds = [[xy2i(1, 4), 11], [xy2i(4, 4), 10], [xy2i(2, 3), LEOPARD]];
    const inZone = mk(reds, [[xy2i(4, 5), DRAGON], [xy2i(3, 5), ELEPHANT]]);
    const outside = mk(reds, [[xy2i(4, 6), DRAGON], [xy2i(3, 6), ELEPHANT]]);
    expect(ai.evalPos(inZone, "r")).toBeGreaterThan(ai.evalPos(outside, "r") + 15);
  });
});

describe("残局技术", () => {
  it("己方堵岸时，龙渡河到敌方半场施压更有价值", () => {
    /* 两岸都是黑子 → 黑方堵岸，河只冻敌方子，龙可自由横渡 */
    const banks = [[xy2i(1, 4), 3], [xy2i(4, 4), LEOPARD]];
    const own = mk([], [...banks, [xy2i(2, 6), DRAGON]]);
    const crossed = mk([], [...banks, [xy2i(2, 2), DRAGON]]);
    expect(ai.evalPos(crossed, "b")).toBeGreaterThan(ai.evalPos(own, "b") + 5);
  });

  it("堵岸把敌方金鸡锁在一侧后，逼近围杀更有价值", () => {
    /* 黑方双岸堵岸：红鸡被锁在 y≥4 一侧，黑方虎从 y=7 逼近 */
    const black = [[xy2i(1, 4), 3], [xy2i(4, 4), LEOPARD], [xy2i(1, 7), 5]];
    const near = mk([[xy2i(1, 5), ROOSTER]], [...black]);
    const far = mk([[xy2i(4, 5), ROOSTER]], [...black]);
    expect(ai.evalPos(near, "b")).toBeGreaterThan(ai.evalPos(far, "b") + 3);
  });

  it("未堵岸时，金鸡可全盘飞行，不奖励盲目逼近", () => {
    const near = mk([[xy2i(2, 6), 5]], [[xy2i(1, 5), ROOSTER]]);
    const far = mk([[xy2i(2, 6), 5]], [[xy2i(3, 5), ROOSTER]]);
    /* 两处距离相同（都是 2），但都没有围杀条件，分数应保持一致 */
    expect(ai.evalPos(near, "r")).toBeCloseTo(ai.evalPos(far, "r"), 6);
  });

  it("领先时把敌子逼到边角、保留闲棋更有利", () => {
    const reds = [[xy2i(1, 7), 2], [xy2i(4, 7), 3]];
    const cornered = mk(reds, [[xy2i(1, 1), 8]]);
    const centered = mk(reds, [[xy2i(2, 3), 8]]);
    expect(ai.evalPos(cornered, "r")).toBeGreaterThan(ai.evalPos(centered, "r") + 3);
  });

  it("多子分头绞杀不同目标，比全堆在一个目标上更有利", () => {
    /* 红方一鼠一猫：分头压住时，两枚敌子同时被盯死；
       扎堆在鼠旁边时，猫还完全自由——前者才是绞杀。 */
    const reds = [[xy2i(1, 5), 11], [xy2i(4, 7), 10]];
    const spread = mk(reds, [[xy2i(1, 6), 3], [xy2i(4, 6), 5]]);
    const stacked = mk(reds, [[xy2i(1, 6), 3], [xy2i(2, 5), 5]]);
    expect(ai.evalPos(spread, "b")).toBeGreaterThan(ai.evalPos(stacked, "b") + 2);
  });

  it("明显领先时，弱子被追击的顾虑更小（可以适当放弃）", () => {
    /* 同一对局面只挪动敌方豹：贴住红鼠 = 真威胁，隔一格 = 无威胁。
       两处豹的机动性相同、周围也没有红方猎手，分差应几乎只剩
       「弱子被追击」这一项。领先越多，这一项的权重越小。 */
    const atk = xy2i(2, 2), safe = xy2i(3, 2), rat = xy2i(2, 3);
    const far = xy2i(4, 7), extra = xy2i(1, 1);
    const lowA = mk([[far, DRAGON], [rat, RAT]], [[atk, LEOPARD]]);
    const lowS = mk([[far, DRAGON], [rat, RAT]], [[safe, LEOPARD]]);
    const highA = mk([[far, DRAGON], [extra, ELEPHANT], [rat, RAT]], [[atk, LEOPARD]]);
    const highS = mk([[far, DRAGON], [extra, ELEPHANT], [rat, RAT]], [[safe, LEOPARD]]);
    const low = ai.evalPos(lowS, "r") - ai.evalPos(lowA, "r");
    const high = ai.evalPos(highS, "r") - ai.evalPos(highA, "r");
    expect(low).toBeGreaterThan(1);
    expect(high).toBeLessThan(low * 0.6);
  });
});

describe("堵岸先机", () => {
  const BANK_L = xy2i(1, 4), BANK_R = xy2i(4, 4);
  const farB = xy2i(4, 7);

  it("先占一岸比无人占岸更有利", () => {
    const held = mk([[BANK_L, LEOPARD]], [[farB, LEOPARD]]);
    const open = mk([[xy2i(1, 3), LEOPARD]], [[farB, LEOPARD]]);
    /* 岸旁虽也算「踏岸先机」，但真正占住一岸仍明显更值钱。 */
    expect(ai.evalPos(held, "r")).toBeGreaterThan(ai.evalPos(open, "r") + 3);
  });

  it("另一岸在望且无人争抢时，先机价值更高", () => {
    /* 红猫在 (4,3) 时下一步能补上 (4,4)；挪到 (3,3) 后只能斜看，补不上。 */
    const inReach = mk([[BANK_L, LEOPARD], [xy2i(4, 3), 10]], [[farB, LEOPARD]]);
    const outOfReach = mk([[BANK_L, LEOPARD], [xy2i(3, 3), 10]], [[farB, LEOPARD]]);
    expect(ai.evalPos(inReach, "r")).toBeGreaterThan(ai.evalPos(outOfReach, "r") + 5);
  });

  it("对方只占一岸且能补上另一岸时，先机不牢", () => {
    /* 黑方占 (4,4)，黑鸡可飞到 (1,4) 补岸。红豹在 (1,3) 能踩上 (1,4)
       拦住这一手；挪到 (2,3) 就拦不住了，红方局势应更差。 */
    const canBlock = mk([[xy2i(1, 3), LEOPARD]], [[BANK_R, LEOPARD], [farB, ROOSTER]]);
    const cannot = mk([[xy2i(2, 3), LEOPARD]], [[BANK_R, LEOPARD], [farB, ROOSTER]]);
    expect(ai.evalPos(canBlock, "r")).toBeGreaterThan(ai.evalPos(cannot, "r") + 3);
  });

  it("能补上另一岸时，AI 会完成堵岸", () => {
    /* 红方还有一枚闲子（鼠），补岸后不必马上离开河岸；黑豹紧贴空岸，
       红方若拖一手，黑豹就会先踏上空岸拆掉这次堵岸。 */
    const g = mk(
      [[BANK_L, LEOPARD], [xy2i(4, 3), 10], [xy2i(1, 7), RAT]],
      [[xy2i(4, 5), LEOPARD]]
    );
    const picked = ai.aiPick(g, 0);
    expect(picked).toMatchObject({ kind: "move", to: BANK_R });
  });

  it("对方即将补岸时，AI 会抢先踩上空岸拦堵", () => {
    /* 红方另有一枚闲子，可以留在岸上持续拦堵。 */
    const g = mk([[xy2i(1, 3), LEOPARD], [xy2i(1, 7), 10]], [[BANK_R, LEOPARD], [farB, ROOSTER]]);
    const picked = ai.aiPick(g, 0);
    expect(picked).toMatchObject({ kind: "move", to: BANK_L });
  });

  it("两岸皆空时，先能踏岸的一方占先机", () => {
    /* 同样的红豹：在 (1,3) 下一手能踏上 (1,4)，在 (2,3) 不能。 */
    const canStep = mk([[xy2i(1, 3), LEOPARD]], [[xy2i(3, 7), LEOPARD]]);
    const cannot = mk([[xy2i(2, 3), LEOPARD]], [[xy2i(3, 7), LEOPARD]]);
    expect(ai.evalPos(canStep, "r")).toBeGreaterThan(ai.evalPos(cannot, "r") + 3);
  });
});

describe("先手翻棋", () => {
  const BANK_ADJ = new Set([
    xy2i(1, 3), xy2i(1, 5), xy2i(4, 3), xy2i(4, 5)
  ]);

  it("优先翻岸旁的陆地，为占岸做准备", () => {
    /* 第一翻决定 AI 执哪一方；翻在岸旁，下一手就能踏上空岸，
       抢在对手之前握住堵岸的主动。 */
    state.newGame();
    const a = ai.aiPick(state.getGame(), 0);
    expect(a.kind).toBe("flip");
    expect(BANK_ADJ.has(a.i)).toBe(true);
  });

  it("第一翻同样只按公开暗子池计价，不读取暗子身份", () => {
    /* 满盘 24 枚全暗、尚未定色：交换两枚暗子的真实身份不改变选择。 */
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
      return mk(reds, blacks, { pcolor: [null, null], firstFlip: false });
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

describe("优势残局收束（Demo dmvbz53xwj2t1x 回归）", () => {
  /* 这盘 Demo 在第 118 手时黑方多出龙、麒麟、狮、虎、狸、鼠，
     却因为 AI 原地兜圈，最终连续 60 手无吃子判和。现在要求：
     同样的局面、同样的确定性 AI 对弈，黑方必须把优势兑现成胜利。 */
  it("黑方不会再把必胜残局走成和棋", () => {
    const g = mk(
      [[7, 4], [8, 3]],                                   /* 红象、红狮 */
      [[6, 9], [10, 1], [11, 11], [12, 3], [15, 5], [18, 2]], /* 狸、龙、鼠、狮、虎、麒麟 */
      { turn: 0, noCap: 45 }
    );
    state.setGame(g);
    let plies = 0;
    while (!state.getGame().result && plies < 200){
      const cur = state.getGame();
      const a = ai.aiPick(cur, cur.turn, {
        history: state.getPositionHistory(),
        deterministic: true
      });
      expect(a).not.toBe(null);
      state.commit(a);
      plies++;
    }
    const result = state.getGame().result;
    expect(result).toMatchObject({ kind: "win", winner: "b" });
  });
});

describe("单龙残局", () => {
  it("单龙对单象：借岸固守是必和，不能按子力判负", () => {
    const g = mk([[xy2i(3, 5), DRAGON]], [[xy2i(4, 2), ELEPHANT]]);
    expect(ai.evalPos(g, "r")).toBe(0);
    expect(ai.evalPos(g, "b")).toBe(0);
  });

  it("单龙能逼杀时直接判胜", () => {
    const g = mk([[xy2i(2, 3), DRAGON]], [[xy2i(3, 1), ELEPHANT]]);
    expect(ai.evalPos(g, "r")).toBeGreaterThan(1e6);
    expect(ai.evalPos(g, "b")).toBeLessThan(-1e6);
  });

  it("黑麒麟宁可邀兑求和，也不逃象送死", () => {
    /* (4,2)黑象、(4,3)红麒麟、(4,4)黑麒麟、(3,5)红龙，黑先。
       兑掉麒麟后是单龙对单象的必和残局；逃象则被红麒麟追死。 */
    const g = mk(
      [[xy2i(4, 3), 2], [xy2i(3, 5), DRAGON]],
      [[xy2i(4, 2), ELEPHANT], [xy2i(4, 4), 2]],
      { turn: 1 }
    );
    const picked = ai.aiPick(g, 1);
    expect(picked).toMatchObject({
      from: xy2i(4, 4), to: xy2i(4, 3), kind: "capture"
    });
  });
});

describe("暗棋公平性", () => {
  it("有子阵亡后仍按期望值给翻棋计价，不会为躲负分而乱翻", () => {
    /* Demo dmvcndjxxeuixx 终局：红方只有明金鸡、明象和六枚暗子，
       黑方多子，且红金鸡正被黑麒麟盯着。唯一的好手是金鸡飞吃黑龙，
       既救下金鸡又兑掉对方大子。旧实现把已阵亡棋子也算进暗子池，
       池子大小对不上后翻棋只得到 1.2 分——远高于负几百的局面分，
       AI 就会一直翻棋。 */
    const g = mk(
      [[0, 10, false], [1, 1, false], [8, 6, false], [11, 5, false],
       [19, 11, false], [20, 2, false], [26, ROOSTER, true], [27, 4, true]],
      [[2, 10, false], [3, 6, true], [4, DRAGON, true], [5, 5, true],
       [10, 8, true], [16, 4, false], [17, 3, true], [18, 11, true],
       [21, 7, false], [25, 2, true]],
      { caps: { r: [9, 7, 8, 3], b: [12, 9] }, noCap: 1 }
    );
    const picked = ai.aiPick(g, 0);
    expect(picked).toMatchObject({ from: 26, to: 4, kind: "capture" });
  });

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

describe("对手兑现反吃（两步估值）", () => {
  it("黑麒麟不会离岸吃狮换龙（Demo dmvcpces8wbmd0）", () => {
    /* 黑麒麟在岸上，吃红狮后必然被红龙反吃；留在岸上则狮、虎、鼠
       都啃不动它，只有同级麒麟能兑。一步静态分只把反吃算成 0.55
       的威胁权重，于是「吃狮」反而更划算。这里仍然只用公开信息：
       对手的反吃只从已翻开的棋子枚举，暗子不参与。 */
    const reds = [
      [xy2i(1, 2), DRAGON], [xy2i(1, 3), 3], [xy2i(3, 3), RAT], [xy2i(4, 4), 5]
    ];
    const blacks = [[xy2i(1, 4), 2]];
    [0, 1, 2, 3, 5, 6].forEach((cell, k) => {
      reds.push([cell, [2, 4, 6, 9, 10, 12][k], false]);
    });
    [7, 9, 11, 20, 21, 22, 23, 24, 25, 26, 27].forEach((cell, k) => {
      blacks.push([cell, [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12][k], false]);
    });
    const g = mk(reds, blacks, {
      pcolor: ["r", "b"], turn: 1, caps: { r: [8, 7], b: [] }, noCap: 1
    });
    const picked = ai.aiPick(g, 1, { deterministic: true });
    expect(picked.kind).toBe("flip");
  });

  it("黑金鸡不会为了吃豹而被狼白吃（Demo dmvcq6hycvaizs）", () => {
    /* 黑虎吃红豹后，红狼立刻白吃黑金鸡；而黑猫吃不动狼，无法反吃。
       正确的选择是让金鸡飞走自保。 */
    const g = mk(
      [[xy2i(4, 1), 6], [xy2i(1, 3), ROOSTER], [xy2i(1, 4), 2],
       [xy2i(3, 4), DRAGON], [xy2i(4, 4), 3], [xy2i(2, 5), RAT],
       [xy2i(4, 6), 7], [xy2i(2, 1), 9, false]],
      [[xy2i(4, 2), 5], [xy2i(2, 4), DRAGON], [xy2i(1, 6), 2],
       [xy2i(3, 7), 10], [xy2i(4, 7), ROOSTER],
       [xy2i(3, 1), 6, false], [xy2i(3, 6), 8, false]],
      { pcolor: ["b", "r"], turn: 0, caps: { r: [4, 8, 5, 10], b: [3, 7, 11, 9] }, noCap: 6 }
    );
    g.board[xy2i(3, 4)].under = { t: ELEPHANT, c: "b", rv: true, uid: 99 };
    const picked = ai.aiPick(g, 0, { deterministic: true });
    expect(picked.from).toBe(xy2i(4, 7));
    expect(picked.kind).toBe("move");
  });
});
