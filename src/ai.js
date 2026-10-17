/* 纯 AI：只依据「已翻开」的信息估值、挑着法。import rules+constants。
   设计要点：
   1. 暗棋身份绝不可读——翻棋按「剩余未知棋子池」的期望值计价。
   2. 估值区分吃子 / 同阶邀兑 / 河格压子 / 龙上岸渴死，并考虑目标是否受保护。
   3. 识别困毙、吃光、60 手无吃子、死局等终局与和棋。
   4. 理解堵岸：冰封敌子、双岸免疫、豹的引爆威胁。
*/
import { N, W, H, DRAGON, ELEPHANT, LEOPARD, ROOSTER, VAL } from "./constants.js";
import {
  xy, id, movesFor, allActions, applyMove, counts, canEat, blockadeColor,
  deadPosition, isRiver, isBank, touchesRiver, crossesRiver, positionKey
} from "./rules.js";

/* 快速深拷贝：只复制对局所需字段。搜索里会克隆成千上万个节点，
   JSON 序列化的开销太大；棋子对象也没有多余字段需要保留。 */
export function cloneG(g){
  var board = new Array(N), i, p, q;
  for (i = 0; i < N; i++){
    p = g.board[i];
    if (!p){ board[i] = null; continue; }
    q = { uid: p.uid, t: p.t, c: p.c, rv: p.rv, under: null };
    if (p.under) q.under = { uid: p.under.uid, t: p.under.t, c: p.under.c, rv: p.under.rv };
    board[i] = q;
  }
  return {
    board: board,
    turn: g.turn,
    pcolor: [g.pcolor[0], g.pcolor[1]],
    noCap: g.noCap,
    firstFlip: g.firstFlip,
    result: g.result,
    last: g.last,
    caps: { r: g.caps.r.slice(), b: g.caps.b.slice() },
    log: g.log,
    pulse: g.pulse
  };
}

export function adjacentCount(g, i){
  var c = xy(i), n = 0, dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (var k = 0; k < 4; k++){
    var nx = c.x + dirs[k][0], ny = c.y + dirs[k][1];
    if (nx < 1 || nx > W || ny < 1 || ny > H) continue;
    if (g.board[id(nx, ny)]) n++;
  }
  return n;
}

const WIN = 1e7;
/* 威胁权重：对手的威胁马上会兑现，自己的威胁对手还有一手可解 */
const W_OPP_THREAT = 0.55;
const W_MY_THREAT = 0.35;

/* 两个河格与各格的上下左右邻居（纯几何，模块初始化时算好） */
const RIVER_CELLS = [id(2, 4), id(3, 4)];
const NEI = [];
for (var ni = 0; ni < N; ni++){
  var nc = xy(ni), arr = [];
  if (nc.x > 1) arr.push(id(nc.x - 1, nc.y));
  if (nc.x < W) arr.push(id(nc.x + 1, nc.y));
  if (nc.y > 1) arr.push(id(nc.x, nc.y - 1));
  if (nc.y < H) arr.push(id(nc.x, nc.y + 1));
  NEI.push(arr);
}

/* ---------- 终局 / 和棋 ---------- */
/* 走完一手后，从行棋方 mover 的视角返回终局分；null 表示未结束。
   镜像 state.checkResult：吃光 > 60 手 / 死局 > 困毙。 */
export function terminalScore(g, mover){
  var me = g.pcolor[mover];
  if (!me) return null;
  var opp = me === "r" ? "b" : "r";
  var c = counts(g);
  if (c[opp] === 0) return c[me] === 0 ? 0 : WIN;
  if (c[me] === 0) return -WIN;
  if (g.noCap >= 60 || deadPosition(g)) return 0;
  if (opponentStuck(g, opp)) return WIN;
  return null;
}
/* 对方是否已无任何合法行动（无暗棋可翻、已翻开的子全不能动） */
function opponentStuck(g, color){
  var i, p;
  for (i = 0; i < N; i++){
    p = g.board[i];
    if (p && !p.rv) return false;              /* 还有暗棋可翻 */
  }
  for (i = 0; i < N; i++){
    p = g.board[i];
    if (p && p.rv && p.c === color && movesFor(g, i).length) return false;
  }
  return true;
}

/* ---------- 到达 / 保护 ---------- */
/* 忽略落点上的棋子，判断 from 的子能否走到 to（用于「吃掉之后会不会被反吃」）。
   龙踏上「岸」会渴死，因此不构成保护。 */
function canReachCell(g, from, to, bl){
  if (from === to) return false;
  var p = g.board[from];
  if (!p || !p.rv) return false;
  var cf = xy(from), ct = xy(to);
  if (isRiver(from)){
    if (bl && bl !== p.c) return false;         /* 河中被敌方堵岸冰封 */
    return !isRiver(to) && touchesRiver(to);
  }
  if (p.t === ROOSTER){
    if (isRiver(to)) return false;
    if (bl && bl !== p.c && crossesRiver(cf.y, ct.y)) return false;
    return true;
  }
  if (Math.abs(cf.x - ct.x) + Math.abs(cf.y - ct.y) !== 1) return false;
  if (isRiver(to)) return p.t === DRAGON || p.t === ELEPHANT;
  if (p.t === DRAGON && isBank(to)) return false;
  return true;
}
/* 吃掉 to 格的敌子后，对方是否有人能立刻反吃（只查可能的反吃者：
   四邻、河格出水、任意位置的金鸡）。 */
function isProtected(g, target, color, attackerIdx, bl){
  var a = g.board[attackerIdx];
  if (!a) return false;
  var cands = NEI[target].slice(), i, q;
  if (touchesRiver(target)) cands.push(RIVER_CELLS[0], RIVER_CELLS[1]);
  for (i = 0; i < N; i++){
    q = g.board[i];
    if (q && q.rv && q.c === color && q.t === ROOSTER) cands.push(i);
  }
  for (i = 0; i < cands.length; i++){
    var j = cands[i];
    if (j === target) continue;
    q = g.board[j];
    if (!q || !q.rv || q.c !== color) continue;
    if (!canReachCell(g, j, target, bl)) continue;
    if (q.t === a.t || canEat(q, a)) return true;
  }
  return false;
}

/* 一次交战的净子力收益（攻击方视角）。同阶邀兑为 0；压子只算压制，
   龙上岸渴死要扣掉自己。 */
export function attackGain(g, from, to, ctx){
  var a = g.board[from], d = g.board[to];
  if (!a || !d || !d.rv) return 0;
  var kind = ctx.kindAt[from] && ctx.kindAt[from][to];
  if (!kind) return 0;
  if (kind === "press") return 0.3 * VAL[d.t];
  if (kind === "thirst") return VAL[d.t] - VAL[a.t];
  if (kind !== "capture") return 0;
  if (a.t === d.t) return 0;                     /* 同归于尽，不赚子力 */
  var gain = VAL[d.t];
  if (isProtected(g, to, d.c, from, ctx.bl)) gain -= VAL[a.t];
  return gain;
}

function otherColor(c){ return c === "r" ? "b" : "r"; }

/* ---------- 估值 ---------- */
/* 只依据「已翻开」的信息估值（暗棋身份不参与任何计算） */
export function evalPos(g, col){
  var opp = otherColor(col);
  var mine = [], theirs = [], mvs = {}, kindAt = {}, i, p;
  var myMat = 0, opMat = 0, totalPieces = 0;

  for (i = 0; i < N; i++){
    p = g.board[i];
    if (!p) continue;
    totalPieces++;
    if (!p.rv) continue;
    if (p.c === col){ mine.push(i); myMat += VAL[p.t]; }
    else { theirs.push(i); opMat += VAL[p.t]; }
    mvs[i] = movesFor(g, i);
    var km = null;
    for (var k = 0; k < mvs[i].length; k++){
      if (!km) km = {};
      km[mvs[i][k].to] = mvs[i][k].kind;
    }
    kindAt[i] = km;
  }
  /* 河下被压住的棋子仍然活着，也要计入子力 */
  for (i = 0; i < RIVER_CELLS.length; i++){
    var top = g.board[RIVER_CELLS[i]];
    var u = top && top.under;
    if (!u) continue;
    if (u.c === col) myMat += VAL[u.t]; else opMat += VAL[u.t];
  }

  /* 子力差在残局里权重更大：领先时乐于兑子，落后时回避兑子 */
  var s = (myMat - opMat) * (1 + 320 / (myMat + opMat + 320));

  var ctx = { mvs: mvs, kindAt: kindAt, bl: blockadeColor(g), dive: { r: false, b: false } };
  for (i = 0; i < mine.length; i++){
    p = g.board[mine[i]];
    if (p.t === LEOPARD){
      for (var d = 0; d < mvs[mine[i]].length; d++){
        if (mvs[mine[i]][d].kind === "dive"){ ctx.dive[p.c] = true; break; }
      }
    }
  }
  for (i = 0; i < theirs.length; i++){
    p = g.board[theirs[i]];
    if (p.t === LEOPARD){
      for (var e = 0; e < mvs[theirs[i]].length; e++){
        if (mvs[theirs[i]][e].kind === "dive"){ ctx.dive[p.c] = true; break; }
      }
    }
  }

  /* 龙与金鸡是天然的制衡关系：金鸡是唯一能稳定换掉龙的子，龙又吃不了金鸡。
     暗棋不参与判断，这里只看已经翻开的棋子。 */
  var myDragon = -1, opDragon = -1, myRooster = -1, opRooster = -1;
  for (i = 0; i < mine.length; i++){
    p = g.board[mine[i]];
    if (p.t === DRAGON) myDragon = mine[i];
    else if (p.t === ROOSTER) myRooster = mine[i];
  }
  for (i = 0; i < theirs.length; i++){
    p = g.board[theirs[i]];
    if (p.t === DRAGON) opDragon = theirs[i];
    else if (p.t === ROOSTER) opRooster = theirs[i];
  }

  /* 威胁：区分吃子 / 邀兑 / 压子 / 渴死，并考虑目标有无保护。
     对手「亏子」的攻击不是威胁（它不会走），不能倒过来给我加分——
     否则把自己的子摆在对手嘴边当诱饵反而成了收益，还会阻碍腾挪。 */
  var a, b, gain;
  for (a = 0; a < mine.length; a++){
    for (b = 0; b < theirs.length; b++){
      s += W_MY_THREAT * attackGain(g, mine[a], theirs[b], ctx);
    }
  }
  for (a = 0; a < theirs.length; a++){
    for (b = 0; b < mine.length; b++){
      gain = attackGain(g, theirs[a], mine[b], ctx);
      if (gain > 0) s -= W_OPP_THREAT * gain;
    }
  }

  /* 金鸡的制衡价值：己方金鸡在场，敌方的龙就不敢放肆；敌方金鸡在场，
     己方龙则要格外小心。这是子力表之外的额外权重。 */
  if (myRooster >= 0 && opDragon >= 0) s += 12;
  if (opRooster >= 0 && myDragon >= 0) s -= 12;

  /* 己方龙正被敌方金鸡盯上：哪怕有子保护，龙换鸡也是巨亏。
     在常规威胁项之外再加一笔，确保 AI 优先把龙挪开或沉进河里。 */
  if (myDragon >= 0 && opRooster >= 0 &&
      kindAt[opRooster] && kindAt[opRooster][myDragon] === "capture"){
    s -= isProtected(g, myDragon, col, opRooster, ctx.bl) ? 10 : 22;
  }

  /* 己方金鸡正被攻击、而敌方龙还在：这枚制衡子比子力表更值得保 */
  if (myRooster >= 0 && opDragon >= 0){
    for (i = 0; i < theirs.length; i++){
      if (kindAt[theirs[i]] && kindAt[theirs[i]][myRooster] === "capture"){ s -= 10; break; }
    }
  }

  /* 无吃子手数逼近上限：领先方必须主动收束，否则判和等于输。
     吃子会把 noCap 归零，因此这一项会自然把 AI 推向能兑现的着法。 */
  var lead = myMat - opMat;
  if (g.noCap >= 40 && lead > 0){
    s -= (g.noCap - 40) * (0.35 + Math.min(lead, 300) / 300);
  }

  /* 领先时的简化奖励：子力越少，优势越难被翻盘。
     落后方在同一局面里得到相反的符号，双方对「兑子」的判断一致。 */
  if (lead > 50) s += (24 - totalPieces) * 0.5;

  /* 追猎梯度：领先时对手往往只剩一两枚子，距离本身就是进展。
     只奖励「对方占不到便宜」的己方子接近目标：被目标白吃不算追猎，
     同阶邀兑在领先时可以接受。距离越近分越高，避免来回摆动。 */
  if (lead > 50 && theirs.length){
    var prox = 0;
    for (i = 0; i < mine.length; i++){
      var mp = g.board[mine[i]], nd = 99;
      if (mp.t === ROOSTER) continue;               /* 金鸡不受距离限制 */
      for (var hj = 0; hj < theirs.length; hj++){
        var hq = g.board[theirs[hj]];
        if (!canEat(mp, hq) || hq.t < mp.t) continue;
        var hd = Math.abs(xy(mine[i]).x - xy(theirs[hj]).x) +
                 Math.abs(xy(mine[i]).y - xy(theirs[hj]).y);
        if (hd < nd) nd = hd;
      }
      if (nd === 1) prox += 14;
      else if (nd === 2) prox += 4;
      else if (nd === 3) prox += 1.5;
    }
    s += prox * Math.min(lead, 300) / 300;
  }

  /* 机动性：金鸡的全盘飞行也会体现在这里 */
  var myMob = 0, opMob = 0;
  for (i = 0; i < mine.length; i++) myMob += Math.min(mvs[mine[i]].length, 20);
  for (i = 0; i < theirs.length; i++) opMob += Math.min(mvs[theirs[i]].length, 20);
  s += (myMob - opMob) * 0.3;

  /* 准备着法的价值：下一步能走到某个敌子旁边（再下一步可吃），
     这类「逼近威胁」不直接兑现，却正是清障、包抄、追猎的组成部分。
     只计目前还吃不到的目标，避免与上面的即时威胁重复；无吃子手数
     逼近 60 时逐步加权，逼 AI 在判和之前收束。 */
  var pot = 0.10 * (1 + Math.min(g.noCap || 0, 60) / 60);
  for (i = 0; i < mine.length; i++){
    var ap = g.board[mine[i]], want = null;
    for (var wk = 0; wk < mvs[mine[i]].length; wk++){
      var wm = mvs[mine[i]][wk];
      if (wm.kind === "dive" || wm.kind === "thirst" || wm.kind === "self") continue;
      var nb = NEI[wm.to];
      for (var wn = 0; wn < nb.length; wn++){
        var wq = g.board[nb[wn]];
        if (!wq || !wq.rv || wq.c === col) continue;
        if (kindAt[mine[i]] && kindAt[mine[i]][nb[wn]] === "capture") continue;
        if (!canEat(ap, wq)) continue;
        if (!want) want = {};
        want[nb[wn]] = VAL[wq.t];
      }
    }
    if (want) for (var wj in want) s += pot * want[wj];
  }

  /* 位置：贴河更活；河中是安全屋——河中子不会被吃（只能被压），
     尤其龙进河后，敌方金鸡再也够不到它。敌方堵岸会把河中子冰封，
     这份保护价值随之大打折扣。 */
  var riverSafe = !ctx.bl || ctx.bl === col;
  for (i = 0; i < mine.length; i++){
    var c = xy(mine[i]);
    if (c.y === 3 || c.y === 5) s += 1.0;
    if (isRiver(mine[i])){
      if (riverSafe){
        s += 2.0 + 0.08 * VAL[g.board[mine[i]].t];
        /* 有敌方金鸡时，龙沉在河里比留在岸上安全得多 */
        if (g.board[mine[i]].t === DRAGON && opRooster >= 0) s += 8;
      } else {
        s += 1.0;               /* 被敌方堵岸冰封：仍然安全，但失去机动 */
      }
    }
  }

  /* 河格压子：按被压棋子的价值计价（河里只有龙/象会被压） */
  for (i = 0; i < RIVER_CELLS.length; i++){
    var t = g.board[RIVER_CELLS[i]];
    if (!t || !t.under) continue;
    var pv = 0.3 * VAL[t.under.t];
    s += t.c === col ? pv : -pv;
  }

  /* 堵岸：敌方河中子被冰封、双岸免疫；对方豹能引爆时价值打折 */
  if (ctx.bl){
    var bl = ctx.bl;
    var frozen = 0;
    for (i = 0; i < RIVER_CELLS.length; i++){
      var rp = g.board[RIVER_CELLS[i]];
      if (!rp) continue;
      if (rp.rv && rp.c !== bl) frozen += VAL[rp.t];
      if (rp.under && rp.under.c !== bl) frozen += VAL[rp.under.t];
    }
    /* 堵岸的基础价值按局面调整：双岸免疫本身值钱，但它的主要意义
       在于「冻住河中敌子」和「拦住敌方金鸡」。没有这两样时价值打折；
       己方在河边堆子堵住龙的入水口，则还要再扣。 */
    var bv = 30 + 0.3 * frozen;
    if (bl === col){
      if (opRooster >= 0) bv += 8;
      if (myDragon >= 0 && !isRiver(myDragon) && opRooster >= 0){
        var freeEntrances = 0;
        for (i = 0; i < N; i++){
          if (!touchesRiver(i) || isRiver(i) || g.board[i]) continue;
          freeEntrances++;
        }
        if (freeEntrances < 2) bv -= 8;     /* 自己的子堵住了龙的入水路线 */
      }
    } else if (myRooster >= 0){
      bv += 8;
    }
    var ownRiverland = 0;
    for (i = 0; i < mine.length; i++){
      if (!isBank(mine[i]) && touchesRiver(mine[i])) ownRiverland++;
    }
    if (ownRiverland >= 3) bv -= 6;          /* 河岸拥堵：拦了别人，也拦了自己 */
    if (ctx.dive[otherColor(bl)]) bv *= 0.55;   /* 对方随时可以炸掉堵岸 */
    /* 堵岸的另一个用处：把敌方金鸡拦在河界另一侧，己方龙才真正安全 */
    if (bl === col && myDragon >= 0 && opRooster >= 0 && !isRiver(myDragon)){
      var dy = xy(myDragon).y, ry = xy(opRooster).y;
      if ((dy < 4) !== (ry < 4)) bv += 16;
    }
    s += bl === col ? bv : -bv;
  }

  /* 敌方豹的引爆威胁：己方摆在 Y3–Y5 的子有被一波带走的风险 */
  if (ctx.bl && ctx.dive[opp]){
    var risk = 0;
    for (i = 0; i < N; i++){
      p = g.board[i];
      if (!p) continue;
      var pc = xy(i);
      if (pc.y < 3 || pc.y > 5) continue;
      if (p.rv && p.c === col) risk += VAL[p.t];
      if (p.under && p.under.c === col) risk += VAL[p.under.t];
    }
    s -= 0.18 * risk;
  }

  /* 豹的引爆期权：堵岸时双方都能把 Y3–Y5 一波带走。若己方的豹随时能炸，
     而敌人在这一带堆了更多子力，这张牌本身就有价值——己方大子阵亡后，
     豹的这手「全换」正是翻盘手段，因此落后时权重更高。
     暗棋身份未知，不计入爆区价值。 */
  if (ctx.bl){
    var zone = { r: 0, b: 0 };
    for (i = 0; i < N; i++){
      p = g.board[i];
      if (!p) continue;
      var zc = xy(i);
      if (zc.y < 3 || zc.y > 5) continue;
      if (p.rv) zone[p.c] += VAL[p.t];
      if (p.under && p.under.rv) zone[p.under.c] += VAL[p.under.t];
    }
    if (ctx.dive[col]){
      var net = zone[opp] - zone[col];
      if (net > 0) s += 0.22 * net * (myMat < opMat ? 1.3 : 1);
    }
    if (ctx.dive[opp]){
      var onet = zone[col] - zone[opp];
      if (onet > 0) s -= 0.22 * onet * (opMat < myMat ? 1.3 : 1);
    }
  }
  return s;
}

/* ---------- 暗棋：剩余未知棋子池 ---------- */
/* 双方各有一套 1..12 的棋子。已翻开的 (颜色, 种类) 是公开信息，
   所以剩余暗子恰好是「尚未露面的 (颜色, 种类)」组成的多重集合，
   每个暗格的身份在这个集合上均匀分布。测试摆局不满足整套棋子时返回 null。 */
function hiddenPool(g){
  var seen = { r: {}, b: {} }, hidden = 0, i, p;
  for (i = 0; i < N; i++){
    p = g.board[i];
    if (!p) continue;
    if (p.rv) seen[p.c][p.t] = true; else hidden++;
  }
  if (!hidden) return [];
  var pool = [];
  ["r", "b"].forEach(function(c){
    for (var t = 1; t <= 12; t++) if (!seen[c][t]) pool.push({ c: c, t: t });
  });
  return pool.length === hidden ? pool : null;
}
/* 翻棋的期望值：对暗格可能出现的每种身份各估一次，按等概率平均。
   注意：这里只使用「可能的身份」，绝不读取该格真实的暗子。 */
function expectedFlip(g, pi, cell, pool){
  var col = g.pcolor[pi], sum = 0, i;
  for (i = 0; i < pool.length; i++){
    var g2 = cloneG(g);
    var c = g2.board[cell];
    c.c = pool[i].c; c.t = pool[i].t; c.rv = true;
    var t = terminalScore(g2, pi);
    sum += (t !== null) ? t : evalPos(g2, col);
  }
  return sum / pool.length;
}

/* ---------- 残局搜索 ---------- */
/* 暗棋身份不可读，翻棋只能按期望值计价，因此搜索只在全盘翻开后进行。
   搜索按节点预算截断，不依赖真实时间，测试与对局都可复现。 */
const SEARCH_INF = 1e9;
const NODE_BUDGET = 6000;
const SEARCH_MAX_PIECES = 8;    /* 只在中残局搜索；开局子多，一步评估已足够 */

function hasHidden(g){
  for (var i = 0; i < N; i++) if (g.board[i] && !g.board[i].rv) return true;
  return false;
}
function pieceCount(g){
  var n = 0;
  for (var i = 0; i < N; i++) if (g.board[i]) n++;
  return n;
}
/* 在克隆局面上走一步，并同步无吃子计数（与 state.doMove 的语义一致） */
function applyAction(g, a){
  var ev = applyMove(g, a), ate = false;
  for (var i = 0; i < ev.length; i++){
    var t = ev[i].type;
    if (t === "eat" || t === "trade" || t === "thirst" || t === "boom"){ ate = true; break; }
  }
  g.noCap = ate ? 0 : (g.noCap || 0) + 1;
  return ate;
}
/* 着法排序：吃子、压子优先，让 alpha-beta 尽早剪枝 */
function orderActions(g, acts){
  var arr = [], i, a, d, p, pr;
  for (i = 0; i < acts.length; i++){
    a = acts[i]; pr = 0;
    if (a.kind === "flip"){ pr = -1; }
    else {
      d = g.board[a.to]; p = g.board[a.from];
      if (a.kind === "dive") pr = 1;
      else if (a.kind === "thirst") pr = p ? -VAL[p.t] : 0;
      else if (a.kind === "press") pr = d ? 0.5 * VAL[d.t] : 0;
      else if (d && d.rv && p) pr = VAL[d.t];
    }
    arr.push({ a: a, pr: pr, i: i });
  }
  arr.sort(function(x, y){ return (y.pr - x.pr) || (x.i - y.i); });
  var out = [];
  for (i = 0; i < arr.length; i++) out.push(arr[i].a);
  return out;
}
/* 搜到判和时的回退分：和棋本身价值相同，但用一层很薄的位置分打破平局，
   避免「所有着法都判和」时随机乱走，把最后的实战机会也丢掉。 */
function drawScore(g, col){ return 1e-3 * evalPos(g, col); }

/* 极小化极大：返回值始终从 col（AI 一方）的视角计分。 */
function searchNode(g, pi, depth, col, alpha, beta, nodes){
  nodes.n++;
  var color = g.pcolor[pi];
  var opp = otherColor(color);
  var cnt = counts(g);
  if (cnt[opp] === 0) return color === col ? WIN : -WIN;
  if (cnt[color] === 0) return color === col ? -WIN : WIN;
  if (g.noCap >= 60 || deadPosition(g)) return drawScore(g, col);
  if (depth <= 0 || nodes.n >= nodes.max) return evalPos(g, col);
  var acts = allActions(g, pi);
  if (!acts.length) return color === col ? -WIN : WIN;   /* 困毙 */
  var maxing = color === col;
  var best = maxing ? -SEARCH_INF : SEARCH_INF;
  var ordered = orderActions(g, acts);
  for (var i = 0; i < ordered.length; i++){
    var g2 = cloneG(g);
    applyAction(g2, ordered[i]);
    var v = searchNode(g2, 1 - pi, depth - 1, col, alpha, beta, nodes);
    if (maxing){
      if (v > best) best = v;
      if (best > alpha) alpha = best;
    } else {
      if (v < best) best = v;
      if (best < beta) beta = best;
    }
    if (beta <= alpha) break;
  }
  return best;
}
/* 根节点逐层加深；某一层超出节点预算就沿用上一层的完整结果。
   根节点共享 alpha：第一个（上一层的）最优着法先搜，其余着法一旦
   不可能超过当前最优就快速剪掉。 */
function rootSearch(g, pi, maxDepth, budget){
  var col = g.pcolor[pi];
  var acts = allActions(g, pi);
  var best = null;
  for (var d = 1; d <= maxDepth; d++){
    var nodes = { n: 0, max: budget };
    var cur = [], complete = true, alpha = -SEARCH_INF, i, a, g2, sc;
    for (i = 0; i < acts.length; i++){
      a = acts[i];
      if (a.kind === "flip"){ complete = false; break; }
      g2 = cloneG(g);
      applyAction(g2, a);
      sc = searchNode(g2, 1 - pi, d - 1, col, alpha, SEARCH_INF, nodes);
      if (sc > alpha) alpha = sc;
      cur.push({ a: a, sc: sc });
      if (nodes.n >= budget && i < acts.length - 1){ complete = false; break; }
    }
    if (!complete) break;
    best = cur;
    if (nodes.n >= budget) break;
    /* 下一层按本层分数排序：最有希望的着法先搜，剪枝更早生效 */
    var sorted = cur.slice().sort(function(x, y){ return y.sc - x.sc; });
    var next = [];
    for (i = 0; i < sorted.length; i++) next.push(sorted[i].a);
    acts = next;
  }
  return best;
}

/* ---------- 选着 ---------- */
/* 先手尚未定色：只在中路附近翻棋（翻出的颜色即先手方阵营，位置决定后续机动）。 */
function pickOpeningFlip(acts){
  var best = acts[0], bs = -1e9;
  for (var i = 0; i < acts.length; i++){
    var c = xy(acts[i].i);
    var sc = -Math.abs(c.x - 2.5) * 0.6 - Math.abs(c.y - 4) * 0.25 + Math.random() * 0.6;
    if (sc > bs){ bs = sc; best = acts[i]; }
  }
  return best;
}

/* opts:
     depth         搜索深度上限（默认按棋子数取 3 或 2；1 表示只做一步评估）
     budget        搜索节点预算（默认 NODE_BUDGET）
     history       最近对局的公开局面键数组（重复局面惩罚，可含当前局面）
     deterministic true 时不做随机取样，稳定返回最优着 */
export function aiPick(g, pi, opts){
  if (!g || !g.pcolor) return null;
  var col = g.pcolor[pi];
  var acts = allActions(g, pi);
  if (!acts.length) return null;
  if (!col) return pickOpeningFlip(acts);

  opts = opts || {};
  var budget = opts.budget || NODE_BUDGET;
  var maxDepth = opts.depth || (pieceCount(g) <= 8 ? (g.noCap >= 25 ? 4 : 3) : 2);
  var pool = hiddenPool(g);
  var scored = [], i, act, sc;

  /* 一步制胜就直接兑现：搜索能算出「三步后必胜」，
     但有立即结束的着法时没有理由再兜圈子。 */
  var instant = [];
  for (i = 0; i < acts.length; i++){
    act = acts[i];
    if (act.kind === "flip") continue;
    var wg = cloneG(g);
    applyAction(wg, act);
    if (terminalScore(wg, pi) === WIN) instant.push(act);
  }
  if (instant.length) return instant[Math.random() * instant.length | 0];

  /* 全盘翻开后的中残局做浅层搜索，把「准备着法」的后续收益算进来。
     只要还有暗子，就退回一步期望估值——搜索树里不能偷看暗子身份。 */
  var searched = null;
  if (!hasHidden(g) && pieceCount(g) <= SEARCH_MAX_PIECES && maxDepth >= 2){
    searched = rootSearch(g, pi, maxDepth, budget);
  }

  if (searched){
    scored = searched;
  } else {
    for (i = 0; i < acts.length; i++){
      act = acts[i];
      if (act.kind === "flip"){
        sc = pool && pool.length ? expectedFlip(g, pi, act.i, pool)
                                 : 1.2 + Math.random() * 1.0;
        sc += Math.random() * 0.3;
      } else {
        var g2 = cloneG(g);
        applyAction(g2, act);
        var t = terminalScore(g2, pi);
        sc = (t !== null) ? t : evalPos(g2, col);
        sc += Math.random() * 0.05;
      }
      scored.push({ a: act, sc: sc });
    }
  }

  /* 重复局面惩罚：优势方最忌讳在残局里来回兜圈，
     同一公开局面在近期出现过就扣分（只回看最近 16 个局面）。 */
  var history = opts.history;
  if (history && history.length){
    for (i = 0; i < scored.length; i++){
      act = scored[i].a;
      if (act.kind === "flip") continue;
      var hg = cloneG(g);
      applyAction(hg, act);
      var key = positionKey(hg), hits = 0;
      for (var h = history.length - 1; h >= 0 && h >= history.length - 16; h--){
        if (history[h] === key) hits++;
      }
      if (hits) scored[i].sc -= 6 * hits;
    }
  }

  if (!scored.length) return null;
  var max = -Infinity;
  for (i = 0; i < scored.length; i++) if (scored[i].sc > max) max = scored[i].sc;

  if (opts.deterministic){
    var best = scored[0];
    for (i = 1; i < scored.length; i++) if (scored[i].sc > best.sc) best = scored[i];
    return best.a;
  }

  /* 在「近似最优」里随机挑一个：保留变化，但不再被噪声带偏。
     判和/败势的分数很小（来自 drawScore），此时不给随机余量，
     让位置分真正起到打破平局的作用。 */
  var margin = (max >= WIN || max < 1) ? 0 : 0.8;
  var top = [];
  for (i = 0; i < scored.length; i++) if (scored[i].sc >= max - margin) top.push(scored[i].a);
  return top[Math.random() * top.length | 0];
}
