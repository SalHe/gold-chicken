/* 纯 AI：只依据已翻开的信息估值、挑着法。import rules+constants。 */
import { N, W, H, VAL } from "./constants.js";
import { xy, id, movesFor, allActions, applyMove } from "./rules.js";

export function cloneG(g){ return JSON.parse(JSON.stringify(g)); }

export function adjacentCount(g, i){
  var c = xy(i), n = 0, dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (var k = 0; k < 4; k++){
    var nx = c.x + dirs[k][0], ny = c.y + dirs[k][1];
    if (nx < 1 || nx > W || ny < 1 || ny > H) continue;
    if (g.board[id(nx, ny)]) n++;
  }
  return n;
}
/* 只依据「已翻开」的信息估值 */
export function evalPos(g, col){
  var opp = col === "r" ? "b" : "r";
  var mine = [], theirs = [], i;
  for (i = 0; i < N; i++){
    var p = g.board[i];
    if (!p || !p.rv) continue;
    (p.c === col ? mine : theirs).push(i);
  }
  var s = 0, k, j, myMat = 0, opMat = 0;
  for (k = 0; k < mine.length; k++)  myMat += VAL[g.board[mine[k]].t];
  for (k = 0; k < theirs.length; k++) opMat += VAL[g.board[theirs[k]].t];
  /* 河格里被压住的子仍然活着，也要计入子力 */
  for (i = 0; i < N; i++){
    var u = g.board[i] && g.board[i].under;
    if (!u) continue;
    if (u.c === col) myMat += VAL[u.t]; else opMat += VAL[u.t];
  }
  /* 子力差在残局里权重更大：领先时乐于兑子，落后时回避兑子 */
  s = (myMat - opMat) * (1 + 320 / (myMat + opMat + 320));

  var cache = {};
  function mv(i){ if (!cache[i]) cache[i] = movesFor(g, i); return cache[i]; }
  function threat(a, d){
    var ms = mv(a), t = d;
    for (var m = 0; m < ms.length; m++) if (ms[m].to === t) return true;
    return false;
  }
  for (k = 0; k < mine.length; k++){
    for (j = 0; j < theirs.length; j++){
      if (threat(theirs[j], mine[k])){ s -= VAL[g.board[mine[k]].t] * 0.65; break; }
    }
  }
  for (k = 0; k < theirs.length; k++){
    for (j = 0; j < mine.length; j++){
      if (threat(mine[j], theirs[k])){ s += VAL[g.board[theirs[k]].t] * 0.65; break; }
    }
  }
  /* 位置：贴住河界中线更活；金鸡靠前是威胁 */
  for (k = 0; k < mine.length; k++){
    var c = xy(mine[k]);
    if (c.y === 3 || c.y === 5) s += 1.5;
  }
  /* 压子：把敌子压在河下，等于暂时废掉它；己方被压则吃紧 */
  for (i = 0; i < N; i++){
    var top = g.board[i];
    if (!top || !top.under) continue;
    if (top.c === col) s += 3; else s -= 3;
  }
  return s;
}
export function aiPick(g, pi){
  var col = g.pcolor[pi];
  var acts = allActions(g, pi);
  if (!acts.length) return null;
  if (!col){
    /* 首手翻棋：挑一个机动性最好的位置 */
    var best = acts[0], bs = -1e9;
    for (var i = 0; i < acts.length; i++){
      var c = xy(acts[i].i);
      var sc = -Math.abs(c.x - 2.5) * 0.6 - Math.abs(c.y - 4) * 0.25 + Math.random() * 0.8;
      if (sc > bs){ bs = sc; best = acts[i]; }
    }
    return best;
  }
  var bestA = acts[0], bestS = -1e9;
  for (var a = 0; a < acts.length; a++){
    var act = acts[a], sc2;
    if (act.kind === "flip"){
      var p = g.board[act.i], cx = xy(act.i);
      sc2 = 1.2 + Math.random() * 1.0;
      sc2 += adjacentCount(g, act.i) * 0.15;                  /* 周围有子，翻开后立刻能发挥作用 */
      if (Math.abs(cx.x - 2.5) < 1) sc2 += 0.5;               /* 中路更活 */
    } else {
      var g2 = cloneG(g);
      applyMove(g2, act);
      sc2 = evalPos(g2, col);
      if (act.kind === "thirst") sc2 -= 500;
      if (act.kind === "dive") sc2 -= 8;                      /* 自爆本身要谨慎 */
      sc2 += Math.random() * 1.4;
    }
    if (sc2 > bestS){ bestS = sc2; bestA = act; }
  }
  return bestA;
}
