/* 活棋状态 + 回合流转 + 访问器。不碰 DOM；靠 change hook 通知渲染层。 */
import { N } from "./constants.js";
import {
  xy, isRiver, isBank, shuffle, posName, pname,
  counts, deadPosition, allActions, applyMove
} from "./rules.js";

let game = null;
let sel = -1, curMoves = [], armed = -1, undoStack = [], uidSeq = 0, mode = "pvp";
let changed = null;

function notify(reset){ if (changed) changed(reset); }

/* ---------- 访问器（setGame/setSel 等供测试注入摆局与点击态） ---------- */
export function getGame(){ return game; }
export function setGame(g){ game = g; }
export function getSel(){ return sel; }
export function setSel(v){ sel = v; }
export function getCurMoves(){ return curMoves; }
export function setCurMoves(v){ curMoves = v; }
export function getArmed(){ return armed; }
export function setArmed(v){ armed = v; }
export function getUndoStack(){ return undoStack; }
export function getMode(){ return mode; }
export function setMode(m){ mode = m; }
export function setChanged(fn){ changed = fn; }

export function newGame(){
  var pieces = [], c, t;
  for (var k = 0; k < 2; k++){
    c = k === 0 ? "r" : "b";
    for (t = 1; t <= 12; t++) pieces.push({ uid: ++uidSeq, t: t, c: c, rv: false });
  }
  shuffle(pieces);
  /* 布子池：河界与两岸都留空，只剩 24 个陆地格，刚好铺满 */
  var cells = [];
  for (var i = 0; i < N; i++) if (!isRiver(i) && !isBank(i)) cells.push(i);
  shuffle(cells);
  var board = new Array(N).fill(null);
  for (var m = 0; m < pieces.length && m < cells.length; m++) board[cells[m]] = pieces[m];

  game = {
    board: board,
    turn: 0,
    pcolor: [null, null],
    noCap: 0,
    firstFlip: false,
    result: null,
    last: null,
    caps: { r: [], b: [] },
    log: [],
    pulse: null
  };
  sel = -1; curMoves = []; armed = -1; undoStack = [];
  say("s", "开局。先手请翻棋，翻出的颜色即先手方阵营。");
  notify(true);
}

export function snapshot(){
  return JSON.stringify({ g: game, uid: uidSeq });
}
export function restore(json){
  try{
    var o = JSON.parse(json);
    if (!o || !o.g || !o.g.board) return false;
    game = o.g; uidSeq = o.uid || uidSeq;
    sel = -1; curMoves = []; armed = -1; undoStack = [];
    notify(true);
    return true;
  }catch(e){ return false; }
}

export function doFlip(i, pi){
  var p = game.board[i];
  p.rv = true;
  var assigned = false;
  if (!game.firstFlip){
    game.firstFlip = true;
    game.pcolor[0] = p.c;
    game.pcolor[1] = p.c === "r" ? "b" : "r";
    assigned = true;
  }
  game.pulse = i;
  if (assigned){
    say("s", "先手翻开 " + posName(i) + "：<span class='k'>" + (p.c === "r" ? "红" : "黑") + "方 " + pname(p) +
             "</span> —— 先手执" + (p.c === "r" ? "红" : "黑") + "，后手执" + (p.c === "r" ? "黑" : "红") + "。");
  } else {
    say(p.c, (p.c === "r" ? "红" : "黑") + "方 翻开 " + posName(i) + "：<span class='k'>" + pname(p) + "</span>");
  }
  game.last = { from: -1, to: i };
  return false;
}
export function doMove(a, pi){
  var p = game.board[a.from];
  var q = game.board[a.to];
  var col = p.c === "r" ? "红" : "黑";
  var line = col + "方 " + pname(p) + " " + posName(a.from) + "→" + posName(a.to);
  var ate = false;
  var traded = !!(q && q.t === p.t);

  if (q){
    ate = true;
    var whose = q.c === p.c ? "己方 " : (q.c === "r" ? "红方 " : "黑方 ");
    line += traded
      ? "，与 " + whose + pname(q) + " <span class='k'>邀兑同归于尽</span>"
      : "，吃掉 " + whose + pname(q);
  }
  var ev = applyMove(game, a);

  if (a.kind === "thirst"){
    ate = true;
    line += "，<span class='k'>上岸渴死</span>";
    game.pulse = a.to;
  } else if (a.kind === "dive"){
    var names = [];
    for (var k = 0; k < ev[ev.length - 1].lost.length; k++){
      var L = ev[ev.length - 1].lost[k];
      names.push((L.p.c === "r" ? "红" : "黑") + pname(L.p));
    }
    line = col + "方 " + pname(p) + " " + posName(a.from) + "→" + posName(a.to) +
           "，<span class='k'>下河引爆</span>！Y3–Y5 尽毁：" + (names.length ? names.join("、") : "空");
    ate = true;
  }
  game.last = { from: a.from, to: a.to };
  say(p.c, line);

  /* 计数：无吃子手数 */
  if (ate) game.noCap = 0; else game.noCap++;
  return ate;
}

export function checkResult(){
  var c = counts(game);
  if (c.r === 0 && c.b === 0) return (game.result = { kind: "draw", why: "双方同归于尽" });
  if (c.r === 0) return (game.result = { kind: "win", winner: "b" });
  if (c.b === 0) return (game.result = { kind: "win", winner: "r" });
  if (game.noCap >= 60) return (game.result = { kind: "draw", why: "连续 60 手无吃子" });
  if (deadPosition(game)) return (game.result = { kind: "draw", why: "双方已无法互吃，死局" });
  if (allActions(game, game.turn).length === 0){
    var loser = game.pcolor[game.turn];
    var winner = loser === "r" ? "b" : (loser === "b" ? "r" : (game.turn === 0 ? "b" : "r"));
    game.result = { kind: "win", winner: winner, stalemate: true };
    return game.result;
  }
  return null;
}

export function endTurn(){
  game.turn = 1 - game.turn;
  checkResult();
  sel = -1; curMoves = []; armed = -1;
  notify(false);
}
export function commit(a){
  undoStack.push(snapshot());
  if (undoStack.length > 200) undoStack.shift();
  if (a.kind === "flip") doFlip(a.i, game.turn);
  else doMove(a, game.turn);
  endTurn();
}
export function say(cls, html){
  game.log.push({ c: cls, h: html });
  if (game.log.length > 160) game.log.shift();
}

export function isAITurn(){ return mode === "ai" && game && !game.result && game.turn === 1; }

export function findMove(to){
  for (var k = 0; k < curMoves.length; k++) if (curMoves[k].to === to) return curMoves[k];
  return null;
}
/* 已进入「骷髅待确认」状态的那个着法 */
export function pendingMove(){ return (armed >= 0 && sel >= 0) ? findMove(armed) : null; }
/* 引爆波及的范围：Y=3、4、5 三行上的所有棋子，不分敌我、不论明暗 */
export function blastZone(){
  var out = [];
  for (var i = 0; i < N; i++){
    var p = game.board[i];
    if (p && xy(i).y >= 3 && xy(i).y <= 5) out.push({ p: p, i: i });
  }
  return out;
}
