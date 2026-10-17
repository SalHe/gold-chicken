/* 活棋状态 + 回合流转 + 访问器。不碰 DOM；靠 change hook 通知渲染层。 */
import { N } from "./constants.js";
import {
  xy, isRiver, isBank, shuffle, posName, pname,
  counts, deadPosition, allActions, applyMove, positionKey
} from "./rules.js";

let game = null;
let sel = -1, curMoves = [], armed = -1, undoStack = [], uidSeq = 0, mode = "pvp";
let aiFirst = false;
/* AI 对弈的单步模式：暂停自动行棋，由「单步」按钮逐手推进 */
let aiPaused = false;
let changed = null;
/* 本局的起点与走子序列（供 Demo 存储/回放）；undoStack 与 actions 一一对应 */
let baseSnapshot = null, actions = [];
/* 依次走过的公开局面键（含起点），供 AI 识别重复局面 */
let posHistory = [];
/* 回放态：replay = { list, idx }；savedState 记住回放前的对局，退出时原样恢复 */
let replay = null, savedState = null;

function notify(reset){ if (changed) changed(reset); }
function rememberPos(){ if (game) posHistory.push(positionKey(game)); }

/* ---------- 访问器（setGame/setSel 等供测试注入摆局与点击态） ---------- */
export function getGame(){ return game; }
export function setGame(g){
  game = g;
  actions = [];
  undoStack = [];
  posHistory = [positionKey(g)];
  baseSnapshot = JSON.stringify({ g: g, uid: uidSeq });
}
export function getSel(){ return sel; }
export function setSel(v){ sel = v; }
export function getCurMoves(){ return curMoves; }
export function setCurMoves(v){ curMoves = v; }
export function getArmed(){ return armed; }
export function setArmed(v){ armed = v; }
export function getUndoStack(){ return undoStack; }
export function getMode(){ return mode; }
export function setMode(m){ mode = m; }
export function getAiFirst(){ return aiFirst; }
export function setAiFirst(v){ aiFirst = !!v; }
export function getAiPaused(){ return aiPaused; }
export function setAiPaused(v){ aiPaused = !!v; }
export function getActions(){ return actions; }
export function getBaseSnapshot(){ return baseSnapshot; }
/* 近期公开局面（含当前局面）；AI 用它避开重复、原地兜圈 */
export function getPositionHistory(){ return posHistory.slice(); }
export function isReplaying(){ return !!replay; }
export function getReplayInfo(){ return replay ? { idx: replay.idx, total: replay.list.length } : null; }
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
  sel = -1; curMoves = []; armed = -1; undoStack = []; actions = [];
  aiPaused = false;                 /* 新开局总是回到自动行棋 */
  say("s", "开局。先手请翻棋，翻出的颜色即先手方阵营。");
  posHistory = [positionKey(game)];
  baseSnapshot = snapshot();
  notify(true);
}

export function snapshot(){
  return JSON.stringify({ g: game, uid: uidSeq });
}
/* keepStack=true 供悔棋使用：退回到旧局面，但保留剩余的悔棋栈与走子序列 */
export function restore(json, keepStack){
  try{
    var o = JSON.parse(json);
    if (!o || !o.g || !o.g.board) return false;
    game = o.g; uidSeq = o.uid || uidSeq;
    sel = -1; curMoves = []; armed = -1;
    if (!keepStack){
      undoStack = []; actions = [];
      posHistory = [positionKey(game)];
      baseSnapshot = json;
    }
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
  var traded = !!(q && q.t === p.t && a.kind !== "press");

  if (q){
    if (a.kind === "press"){
      /* 河格压子：不杀不兑，被压的子留在下面 */
      line += "，<span class='k'>压住</span> " + (q.c === "r" ? "红方 " : "黑方 ") + pname(q);
    } else {
      ate = true;
      var whose = q.c === p.c ? "己方 " : (q.c === "r" ? "红方 " : "黑方 ");
      line += traded
        ? "，与 " + whose + pname(q) + " <span class='k'>邀兑同归于尽</span>"
        : "，吃掉 " + whose + pname(q);
    }
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
  actions.push(a);
  if (a.kind === "flip") doFlip(a.i, game.turn);
  else doMove(a, game.turn);
  endTurn();
  rememberPos();
}
/* 悔棋 n 手：悔棋栈与走子序列同步回退，栈本身保留，因此可以一直悔下去 */
export function undo(n){
  var count = n || 1;
  if (!undoStack.length) return false;
  var s = null, k = 0;
  while (k < count && undoStack.length){ s = undoStack.pop(); actions.pop(); k++; }
  if (!s) return false;
  restore(s, true);
  posHistory.length = Math.max(1, posHistory.length - k);
  return true;
}
export function say(cls, html){
  game.log.push({ c: cls, h: html });
  if (game.log.length > 160) game.log.shift();
}

export function isAITurn(){
  if (!game || game.result) return false;
  if (mode === "ai") return game.turn === (aiFirst ? 0 : 1);
  if (mode === "aiai") return true;
  return false;
}

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
    if (!p || xy(i).y < 3 || xy(i).y > 5) continue;
    out.push({ p: p, i: i });
    if (p.under) out.push({ p: p.under, i: i });   /* 河格下被压的棋子同样会被炸掉 */
  }
  return out;
}

/* ---------- Demo 回放 ---------- */
/* 从 startJson（本局开始时的快照）出发，按 list 里的走子序列重现对局。
   回放期间棋盘只读；退出时把回放前的对局原样恢复。 */
export function beginReplay(startJson, list){
  if (replay || !Array.isArray(list)) return false;
  try{
    var o = JSON.parse(startJson);
    if (!o || !o.g || !o.g.board) return false;
    savedState = {
      game: snapshot(),
      undoStack: undoStack.slice(),
      actions: actions.slice(),
      posHistory: posHistory.slice(),
      base: baseSnapshot
    };
    game = o.g; uidSeq = o.uid || uidSeq;
    baseSnapshot = startJson;
    undoStack = []; actions = [];
    posHistory = [positionKey(game)];
    replay = { start: startJson, list: list.slice(), idx: 0 };
    sel = -1; curMoves = []; armed = -1;
    notify(true);
    return true;
  }catch(e){ return false; }
}

function actionMatches(legal, a){
  if (a.kind === "flip") return legal.kind === "flip" && legal.i === a.i;
  return legal.kind === a.kind && legal.from === a.from && legal.to === a.to;
}
/* 应用一步回放，并给这一步新增的日志打上「第几手」标记，
   供行棋记录点击跳转使用（不依赖日志下标，日志截断也不会错位）。 */
function applyReplayAction(a, step){
  var prev = game.log.length ? game.log[game.log.length - 1] : null;
  if (a.kind === "flip") doFlip(a.i, game.turn);
  else doMove(a, game.turn);
  var from = 0;
  if (prev){
    var p = game.log.indexOf(prev);
    from = p >= 0 ? p + 1 : game.log.length - 1;   /* 旧日志已被截断时只标记最新一条 */
  }
  for (var k = from; k < game.log.length; k++){
    /* 非枚举属性：不会进入快照 JSON，回放前后局面比较不受影响 */
    Object.defineProperty(game.log[k], "step", { value: step, enumerable: false, configurable: true });
  }
  game.turn = 1 - game.turn;
  checkResult();
  rememberPos();
}

/* 走一步回放。返回 false 表示已播完或记录不合法（不合法时直接退出回放）。 */
export function replayStep(){
  if (!replay || replay.idx >= replay.list.length) return false;
  var i = replay.idx;
  var a = replay.list[i];
  var acts = allActions(game, game.turn), ok = false;
  for (var k = 0; k < acts.length; k++){
    if (actionMatches(acts[k], a)){ ok = true; break; }
  }
  if (!ok){ endReplay(); return false; }
  replay.idx++;
  applyReplayAction(a, i + 1);
  sel = -1; curMoves = []; armed = -1;
  notify(false);
  return true;
}

/* 跳到第 n 手（0 = 回放起点）。始终从起点重建，保证前进/后退结果一致。 */
export function replayGoto(n){
  if (!replay) return false;
  var target = Math.max(0, Math.min(replay.list.length, n | 0));
  var o;
  try{ o = JSON.parse(replay.start); }catch(e){ return false; }
  if (!o || !o.g || !o.g.board) return false;
  game = o.g; uidSeq = o.uid || uidSeq;
  posHistory = [positionKey(game)];
  for (var i = 0; i < target; i++){
    var a = replay.list[i];
    var acts = allActions(game, game.turn), ok = false;
    for (var k = 0; k < acts.length; k++){
      if (actionMatches(acts[k], a)){ ok = true; break; }
    }
    if (!ok){ endReplay(); return false; }
    applyReplayAction(a, i + 1);
  }
  replay.idx = target;
  sel = -1; curMoves = []; armed = -1;
  notify(true);
  return true;
}

/* 把当前回放局面变成一局可以继续下的对局。
   回放前的对局被丢弃，悔棋/保存 Demo 都从这一刻重新开始。 */
export function adoptReplay(){
  if (!replay) return false;
  for (var i = 0; i < game.log.length; i++) delete game.log[i].step;
  replay = null;
  savedState = null;
  undoStack = []; actions = [];
  baseSnapshot = snapshot();
  sel = -1; curMoves = []; armed = -1;
  notify(true);
  return true;
}

export function endReplay(){
  if (!replay) return false;
  replay = null;
  if (savedState){
    try{
      var o = JSON.parse(savedState.game);
      game = o.g; uidSeq = o.uid || uidSeq;
    }catch(e){}
    undoStack = savedState.undoStack;
    actions = savedState.actions;
    posHistory = savedState.posHistory || [positionKey(game)];
    baseSnapshot = savedState.base;
    savedState = null;
  }
  sel = -1; curMoves = []; armed = -1;
  notify(true);
  return true;
}
