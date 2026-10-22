/* 活棋状态 + 回合流转 + 访问器。不碰 DOM；靠 change hook 通知渲染层。 */
import { N } from "./constants.js";
import {
  xy, isRiver, isBank, shuffle, posName, pname,
  counts, deadPosition, allActions, applyMove, positionKey,
  updateChase, chaseLoss, blockadeDrawLoser
} from "./rules.js";
import { buildGame, validatePosition, pieceCount } from "./editor.js";

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
/* 最近一手的纯文本描述（不含颜色前缀），供界面做走子播报 */
let lastNote = "";
/* 行棋音效/震动的回调；回放与测试中不触发 */
let feedback = null;

function notify(reset){ if (changed) changed(reset); }
function rememberPos(){ if (game) posHistory.push(positionKey(game)); }
function emit(kind){
  if (!feedback || replay || !kind) return;
  try{ feedback(kind); }catch(e){}
}

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
export function setFeedback(fn){ feedback = fn; }
export function getLastNote(){ return lastNote; }

export function newGame(){
  const pieces = [];
  let c, t;
  for (let k = 0; k < 2; k++){
    c = k === 0 ? "r" : "b";
    for (t = 1; t <= 12; t++) pieces.push({ uid: ++uidSeq, t: t, c: c, rv: false });
  }
  shuffle(pieces);
  /* 布子池：河界与两岸都留空，只剩 24 个陆地格，刚好铺满 */
  const cells = [];
  for (let i = 0; i < N; i++) if (!isRiver(i) && !isBank(i)) cells.push(i);
  shuffle(cells);
  const board = new Array(N).fill(null);
  for (let m = 0; m < pieces.length && m < cells.length; m++) board[cells[m]] = pieces[m];

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
    pulse: null,
    chase: null
  };
  sel = -1; curMoves = []; armed = -1; undoStack = []; actions = [];
  aiPaused = false;                 /* 新开局总是回到自动行棋 */
  say("s", "开局。先手请翻棋，翻出的颜色即先手方阵营。");
  posHistory = [positionKey(game)];
  baseSnapshot = snapshot();
  notify(true);
}

/* 用摆好的初始局面开一局。placements 为 editor.js 的 placementsOf() 结果；
   opts.first 是先手颜色（占座位 0）。回放中拒绝，调用方应先 endReplay()。 */
export function startFromPosition(placements, opts){
  if (replay) return false;
  const first = opts && opts.first === "b" ? "b" : "r";
  if (!validatePosition(placements, first).ok) return false;
  game = buildGame(placements, first, uidSeq);
  uidSeq += pieceCount(placements);
  sel = -1; curMoves = []; armed = -1; undoStack = [];
  actions = []; aiPaused = false;          /* 新开局总是回到自动行棋 */
  let r = 0, b = 0;
  for (let k = 0; k < placements.length; k++){
    const pl = placements[k];
    if (pl.c === "r") r++; else b++;
    if (pl.under){
      if (pl.under.c === "r") r++; else b++;
    }
  }
  /* 恰好一条系统日志：它会占据行棋记录的第一行，但不算「第几手」。 */
  say("s", "自定义开局：" + (first === "r" ? "红方" : "黑方") + "先手，红方 " + r +
           " 子、黑方 " + b + " 子。");
  posHistory = [positionKey(game)];
  baseSnapshot = snapshot();
  notify(true);
  return true;
}

export function snapshot(){
  return JSON.stringify({ g: game, uid: uidSeq });
}
/* Export full positions for exact AI match reproduction; this includes hidden identities. */
export function copyPosition(){
  if (!game) return null;
  const seen = { r: new Array(13).fill(false), b: new Array(13).fill(false) };
  let invalid = false;
  function mark(piece){
    if (!piece || (piece.c !== "r" && piece.c !== "b") ||
        !Number.isInteger(piece.t) || piece.t < 1 || piece.t > 12 || seen[piece.c][piece.t]){
      invalid = true;
      return;
    }
    seen[piece.c][piece.t] = true;
  }
  const board = game.board.map(function(p, i){
    if (!p) return null;
    const q = { uid: p.uid, rv: p.rv === true, under: null };
    if (q.rv) { q.c = p.c; q.t = p.t; mark(q); }
    else {
      if (isRiver(i) || isBank(i)) invalid = true;
      q.c = p.c; q.t = p.t; mark(q);
    }
    if (p.under){
      if (p.under.rv !== true || !isRiver(i)) invalid = true;
      else {
        q.under = { uid: p.under.uid, c: p.under.c, t: p.under.t, rv: true };
        mark(q.under);
      }
    }
    return q;
  });
  const caps = { r: game.caps.r.slice(), b: game.caps.b.slice() };
  for (const c of ["r", "b"]){
    for (let i = 0; i < caps[c].length; i++) mark({ c: c, t: caps[c][i] });
  }
  if (invalid) return null;

  const g = Object.assign({}, game, {
    board: board,
    caps: caps,
    log: game.log.map(function(line){ return { c: line.c, h: line.h }; }),
    last: game.last ? { from: game.last.from, to: game.last.to } : null,
    pcolor: game.pcolor.slice(),
    chase: game.chase ? Object.assign({}, game.chase) : null
  });
  return JSON.stringify({ type: "gold-chicken-position", version: 2, state: { g: g, uid: uidSeq } });
}
/* Import v1 public positions with shuffled hidden pieces; v2 restores exact identities. */
export function preparePositionImport(text){
  let data;
  try{ data = JSON.parse(text); }catch(e){ return null; }
  if (!data || data.type !== "gold-chicken-position") return null;
  const fail = message => ({ ok: false, message: message });
  if ((data.version !== 1 && data.version !== 2) || !data.state || !data.state.g) return fail("局面数据版本或结构不支持。");
  const source = data.state, g = source.g;
  if (!Array.isArray(g.board) || g.board.length !== N ||
      (g.turn !== 0 && g.turn !== 1) || !Array.isArray(g.pcolor) || g.pcolor.length !== 2 ||
      !g.caps || !Array.isArray(g.caps.r) || !Array.isArray(g.caps.b) ||
      !Number.isInteger(g.noCap) || g.noCap < 0 || typeof g.firstFlip !== "boolean"){
    return fail("棋局状态不完整或格式无效。");
  }
  const colorOk = c => c === "r" || c === "b";
  if (g.firstFlip){
    if (!colorOk(g.pcolor[0]) || !colorOk(g.pcolor[1]) || g.pcolor[0] === g.pcolor[1]) return fail("双方阵营信息无效。");
  } else if (g.pcolor[0] !== null || g.pcolor[1] !== null){
    return fail("开局阵营信息无效。");
  }
  const seen = { r: new Array(13).fill(false), b: new Array(13).fill(false) };
  const uids = new Set(), hidden = [];
  let invalid = false, maxUid = 0, revealed = 0;
  function addUid(piece){
    if (!Number.isInteger(piece.uid) || piece.uid < 1 || uids.has(piece.uid)){ invalid = true; return; }
    uids.add(piece.uid);
    if (piece.uid > maxUid) maxUid = piece.uid;
  }
  function mark(piece){
    if (!piece || !colorOk(piece.c) || !Number.isInteger(piece.t) || piece.t < 1 || piece.t > 12 || seen[piece.c][piece.t]){
      invalid = true;
      return;
    }
    seen[piece.c][piece.t] = true;
  }
  for (let i = 0; i < N; i++){
    const p = g.board[i];
    if (!p) continue;
    if (typeof p !== "object" || typeof p.rv !== "boolean") return fail("棋子数据无效。");
    addUid(p);
    if (p.rv){
      revealed++;
      mark(p);
      if ((isRiver(i) && p.t !== 1 && p.t !== 4) || (isBank(i) && p.t === 1)) invalid = true;
    } else {
      if (isRiver(i) || isBank(i)) invalid = true;
      if (data.version === 2) mark(p);
      else { delete p.c; delete p.t; }
      hidden.push(p);
    }
    if (p.under){
      const u = p.under;
      if (!isRiver(i) || !p.rv || typeof u !== "object" || u.rv !== true) return fail("河中压子状态无效。");
      addUid(u); mark(u);
      if (u.t !== 1 && u.t !== 4) invalid = true;
      if (u.c === p.c) invalid = true;
    }
  }
  if (!g.firstFlip && revealed) return fail("尚未翻棋的局面不能包含已翻开的棋子。");
  for (const c of ["r", "b"]){
    for (let i = 0; i < g.caps[c].length; i++) mark({ c: c, t: g.caps[c][i] });
  }
  if (invalid) return fail("棋子库存或位置不符合规则。");
  const pool = [];
  for (const c of ["r", "b"]) for (let t = 1; t <= 12; t++) if (!seen[c][t]) pool.push({ c: c, t: t });
  if (data.version === 1){
    if (hidden.length && pool.length !== hidden.length) return fail("暗棋池无法仅凭公开信息还原，无法安全载入此局面。");
    shuffle(pool);
    for (let i = 0; i < hidden.length; i++){
      hidden[i].c = pool[i].c;
      hidden[i].t = pool[i].t;
    }
  }
  if (source.uid != null && (!Number.isInteger(source.uid) || source.uid < maxUid)) return fail("棋子序号无效。");
  g.log = [];
  g.last = null;
  g.pulse = null;
  if (g.chase){
    const ch = g.chase;
    if ((ch.by !== "r" && ch.by !== "b") || !Number.isInteger(ch.chaserUid) ||
        !Number.isInteger(ch.targetUid) || !Number.isInteger(ch.rounds) || ch.rounds < 0 ||
        typeof ch.pending !== "boolean") return fail("长捉记录无效。");
    const chaser = g.board.find(p => p && p.uid === ch.chaserUid);
    const target = g.board.find(p => p && p.uid === ch.targetUid);
    if (!chaser || !target || !chaser.rv || !target.rv || chaser.c !== ch.by || target.c === ch.by){
      return fail("长捉涉及的棋子不存在。");
    }
  }
  if (g.result && g.result.kind !== "win" && g.result.kind !== "draw") return fail("终局数据无效。");
  return { ok: true, json: JSON.stringify({ g: g, uid: source.uid || maxUid }) };
}

/* 将导入的局面设为新对局起点，悔棋与行棋记录从此处重新开始。 */
export function startFromImportedPosition(json){
  if (replay) return false;
  try{
    const o = JSON.parse(json);
    if (!o || !o.g || !Array.isArray(o.g.board) || o.g.board.length !== N) return false;
    game = o.g; uidSeq = o.uid || 0;
    sel = -1; curMoves = []; armed = -1; undoStack = []; actions = [];
    aiPaused = false; lastNote = "";
    say("s", "从复制的完整局面开始对局，暗棋身份与复制时一致。");
    posHistory = [positionKey(game)];
    baseSnapshot = snapshot();
    notify(true);
    return true;
  }catch(e){ return false; }
}
/* keepStack=true 供悔棋使用：退回到旧局面，但保留剩余的悔棋栈与走子序列 */
export function restore(json, keepStack){
  try{
    const o = JSON.parse(json);
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
  const p = game.board[i];
  p.rv = true;
  game.chase = null;                 /* 新棋子入场会改变威胁关系，长捉重新计数 */
  let assigned = false;
  if (!game.firstFlip){
    game.firstFlip = true;
    game.pcolor[0] = p.c;
    game.pcolor[1] = p.c === "r" ? "b" : "r";
    assigned = true;
  }
  game.pulse = i;
  lastNote = "翻开 " + posName(i) + "：" + pname(p);
  if (assigned){
    say("s", "先手翻开 " + posName(i) + "：<span class='k'>" + (p.c === "r" ? "红" : "黑") + "方 " + pname(p) +
             "</span> —— 先手执" + (p.c === "r" ? "红" : "黑") + "，后手执" + (p.c === "r" ? "黑" : "红") + "。");
  } else {
    say(p.c, (p.c === "r" ? "红" : "黑") + "方 翻开 " + posName(i) + "：<span class='k'>" + pname(p) + "</span>");
  }
  game.last = { from: -1, to: i };
  emit("flip");
  return false;
}
export function doMove(a, pi){
  const p = game.board[a.from];
  const q = game.board[a.to];
  const col = p.c === "r" ? "红" : "黑";
  let line = col + "方 " + pname(p) + " " + posName(a.from) + "→" + posName(a.to);
  let note = pname(p) + " " + posName(a.from) + "→" + posName(a.to);
  let ate = false;
  const traded = !!(q && q.t === p.t && a.kind !== "press");
  const movedUid = p.uid, moverColor = p.c;

  if (q){
    if (a.kind === "press"){
      /* 河格压子：不杀不兑，被压的子留在下面 */
      line += "，<span class='k'>压住</span> " + (q.c === "r" ? "红方 " : "黑方 ") + pname(q);
      note += " 压 " + pname(q);
    } else {
      ate = true;
      const whose = q.c === p.c ? "己方 " : (q.c === "r" ? "红方 " : "黑方 ");
      line += traded
        ? "，与 " + whose + pname(q) + " <span class='k'>邀兑同归于尽</span>"
        : "，吃掉 " + whose + pname(q);
      note += (q.c === p.c ? " 吃己方 " : " 吃 ") + pname(q);
      if (traded) note = pname(p) + " " + posName(a.from) + "→" + posName(a.to) + " 与 " + pname(q) + " 邀兑";
    }
  }
  const ev = applyMove(game, a);
  updateChase(game, movedUid, moverColor);

  if (a.kind === "thirst"){
    ate = true;
    line += "，<span class='k'>上岸渴死</span>";
    note += " · 上岸渴死";
    game.pulse = a.to;
  } else if (a.kind === "dive"){
    const names = [];
    for (let k = 0; k < ev[ev.length - 1].lost.length; k++){
      const L = ev[ev.length - 1].lost[k];
      names.push((L.p.c === "r" ? "红" : "黑") + pname(L.p));
    }
    line = col + "方 " + pname(p) + " " + posName(a.from) + "→" + posName(a.to) +
           "，<span class='k'>下河引爆</span>！Y3–Y5 尽毁：" + (names.length ? names.join("、") : "空");
    note = pname(p) + " " + posName(a.from) + "→" + posName(a.to) + " · 下河引爆";
    ate = true;
  }
  game.last = { from: a.from, to: a.to };
  lastNote = note;
  say(p.c, line);
  emit(a.kind === "dive" ? "dive" : a.kind === "thirst" ? "thirst"
    : q ? (a.kind === "press" ? "press" : (traded ? "trade" : "capture")) : "move");

  /* 计数：无吃子手数 */
  if (ate) game.noCap = 0; else game.noCap++;
  return ate;
}

/* 和棋判定：若此时仍在堵岸、且堵岸方子力较弱，改判堵岸方负 */
function drawResult(reason){
  const loser = blockadeDrawLoser(game);
  if (loser){
    const l = loser === "r" ? "红方" : "黑方";
    game.result = {
      kind: "win",
      winner: loser === "r" ? "b" : "r",
      why: l + "堵岸且子力较弱，和棋改判" + l + "负",
      blockadeLoss: true
    };
    return game.result;
  }
  game.result = { kind: "draw", why: reason };
  return game.result;
}
export function checkResult(){
  const c = counts(game);
  if (c.r === 0 && c.b === 0) return (game.result = { kind: "draw", why: "双方同归于尽" });
  if (c.r === 0) return (game.result = { kind: "win", winner: "b" });
  if (c.b === 0) return (game.result = { kind: "win", winner: "r" });
  const chaser = chaseLoss(game);
  if (chaser){
    const cl = chaser === "r" ? "红方" : "黑方";
    game.result = {
      kind: "win",
      winner: chaser === "r" ? "b" : "r",
      why: cl + "长捉同一子超过 10 回合，判负",
      longChase: true
    };
    return game.result;
  }
  if (game.noCap >= 60) return drawResult("连续 60 手无吃子");
  if (deadPosition(game)) return drawResult("双方已无法互吃，死局");
  if (allActions(game, game.turn).length === 0){
    const loser = game.pcolor[game.turn];
    const winner = loser === "r" ? "b" : (loser === "b" ? "r" : (game.turn === 0 ? "b" : "r"));
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
  emit(game.result ? (game.result.kind === "win" ? "win" : "draw") : null);
}
export function commit(a){
  undoStack.push(snapshot());
  actions.push(a);
  if (a.kind === "flip") doFlip(a.i, game.turn);
  else doMove(a, game.turn);
  /* 本手序号：非枚举属性，不进快照；行棋记录用它编号 */
  const top = game.log[game.log.length - 1];
  if (top){
    Object.defineProperty(top, "no", { value: actions.length, enumerable: false, configurable: true });
  }
  endTurn();
  rememberPos();
}
/* 悔棋 n 手：悔棋栈与走子序列同步回退，栈本身保留，因此可以一直悔下去 */
export function undo(n){
  const count = n || 1;
  if (!undoStack.length) return false;
  let s = null, k = 0;
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
  for (let k = 0; k < curMoves.length; k++) if (curMoves[k].to === to) return curMoves[k];
  return null;
}
/* 已进入「骷髅待确认」状态的那个着法 */
export function pendingMove(){ return (armed >= 0 && sel >= 0) ? findMove(armed) : null; }
/* 引爆波及的范围：Y=3、4、5 三行上的所有棋子，不分敌我、不论明暗 */
export function blastZone(){
  const out = [];
  for (let i = 0; i < N; i++){
    const p = game.board[i];
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
    const o = JSON.parse(startJson);
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
  const prev = game.log.length ? game.log[game.log.length - 1] : null;
  if (a.kind === "flip") doFlip(a.i, game.turn);
  else doMove(a, game.turn);
  let from = 0;
  if (prev){
    const p = game.log.indexOf(prev);
    from = p >= 0 ? p + 1 : game.log.length - 1;   /* 旧日志已被截断时只标记最新一条 */
  }
  for (let k = from; k < game.log.length; k++){
    /* 非枚举属性：不会进入快照 JSON，回放前后局面比较不受影响 */
    Object.defineProperty(game.log[k], "step", { value: step, enumerable: false, configurable: true });
  }
  game.turn = 1 - game.turn;
  checkResult();
  rememberPos();
}

/* 回放模式下的完整行棋记录：从起点把整段走子序列预演一遍，
   返回起点日志（base）与每一步的日志行（moves，含尚未走到的）。
   结果缓存在 replay 上，只算一次；UI 用它显示「全程」记录并支持向前跳转。 */
export function getReplayLog(){
  if (!replay) return null;
  if (replay.fullLog) return replay.fullLog;
  let o;
  try{ o = JSON.parse(replay.start); }catch(e){ return null; }
  if (!o || !o.g || !o.g.board) return null;
  const sim = o.g, base = sim.log.slice(), moves = [];
  sim.log = [];
  const prevGame = game;
  game = sim;
  try{
    for (let i = 0; i < replay.list.length; i++){
      const a = replay.list[i];
      /* 与 replayStep/replayGoto 一致：记录不合法就停在这里 */
      const acts = allActions(sim, sim.turn);
      let ok = false;
      for (let k = 0; k < acts.length; k++){
        if (actionMatches(acts[k], a)){ ok = true; break; }
      }
      if (!ok) break;
      try{
        if (a.kind === "flip") doFlip(a.i, sim.turn);
        else doMove(a, sim.turn);
      }catch(e){ break; }
      /* 每个着法恰好追加一条日志；日志截断时最新一条仍在末尾 */
      const line = sim.log[sim.log.length - 1];
      if (line) moves.push({ step: i + 1, c: line.c, h: line.h });
      sim.turn = 1 - sim.turn;
    }
  }finally{ game = prevGame; }
  replay.fullLog = { base: base, moves: moves };
  return replay.fullLog;
}

/* 走一步回放。返回 false 表示已播完或记录不合法（不合法时直接退出回放）。 */
export function replayStep(){
  if (!replay || replay.idx >= replay.list.length) return false;
  const i = replay.idx;
  const a = replay.list[i];
  const acts = allActions(game, game.turn);
  let ok = false;
  for (let k = 0; k < acts.length; k++){
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
  const target = Math.max(0, Math.min(replay.list.length, n | 0));
  let o;
  try{ o = JSON.parse(replay.start); }catch(e){ return false; }
  if (!o || !o.g || !o.g.board) return false;
  game = o.g; uidSeq = o.uid || uidSeq;
  posHistory = [positionKey(game)];
  for (let i = 0; i < target; i++){
    const a = replay.list[i];
    const acts = allActions(game, game.turn);
  let ok = false;
    for (let k = 0; k < acts.length; k++){
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
  for (let i = 0; i < game.log.length; i++) delete game.log[i].step;
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
      const o = JSON.parse(savedState.game);
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
