/* DOM 渲染 + 点击交互。import state 访问器；import 时不碰 document。 */
import { N, NAME, NUM } from "./constants.js";
import { xy, terrain, blockadeColor, isBank, pname, counts, movesFor } from "./rules.js";
import {
  getGame, getSel, setSel, getCurMoves, setCurMoves, getArmed, setArmed,
  getMode, getUndoStack, getActions, findMove, pendingMove, blastZone, commit, isAITurn,
  isReplaying, getReplayInfo
} from "./state.js";
import { listDemos } from "./demo.js";

let gridEl = null, pieceEl = null, stackEl = null;
let cellEls = [], cache = new Map();

/* 懒解析 DOM：import ui.js 时不碰 document，测试可自由控制导入顺序 */
export function initUi(){
  gridEl = document.getElementById("grid");
  pieceEl = document.getElementById("pieces");
  stackEl = document.getElementById("stack");
  stackEl.addEventListener("click", function(e){
    var t = e.target.closest("[data-i]");
    if (!t) return;
    onCell(parseInt(t.dataset.i, 10));
  });
}

export function buildGrid(){
  gridEl.innerHTML = "";
  cellEls = [];
  for (var i = 0; i < N; i++){
    var c = xy(i), t = terrain(c.x, c.y);
    var d = document.createElement("div");
    d.className = "cell " + (t === "river" ? "river" : t === "bank" ? "bank" : "land-b");
    d.dataset.i = i;
    if (t === "bank"){
      var l = document.createElement("span");
      l.className = "lbl";
      l.textContent = "岸";
      d.appendChild(l);
    }
    gridEl.appendChild(d);
    cellEls.push(d);
  }
}
export function clearPieceCache(){
  cache.forEach(function(el){ el.remove(); });
  cache.clear();
  if (pieceEl) pieceEl.innerHTML = "";   /* 连同正在淡出的旧棋子一起清掉 */
}
export function makePieceEl(p){
  var el = document.createElement("div");
  el.className = "piece" + (NAME[p.t].length > 1 ? " long" : "");
  el.innerHTML =
    '<div class="inner">' +
      '<div class="disc front"><span class="num"></span><span class="nm"></span>' +
        '<svg class="skull" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
          '<path d="M12 1.8C7.3 1.8 3.5 5.4 3.5 9.9c0 2.6 1.3 4.6 3.2 5.9v2.4c0 .9.7 1.6 1.6 1.6h.8v2.3c0 .6.5 1.1 1.1 1.1h3.6c.6 0 1.1-.5 1.1-1.1v-2.3h.8c.9 0 1.6-.7 1.6-1.6v-2.4c1.9-1.3 3.2-3.3 3.2-5.9 0-4.5-3.8-8.1-8.5-8.1z" ' +
            'fill="#f7f1e6" stroke="#171310" stroke-width="1.1" stroke-linejoin="round"/>' +
          '<circle cx="8.9" cy="9.7" r="2.35" fill="#171310"/>' +
          '<circle cx="15.1" cy="9.7" r="2.35" fill="#171310"/>' +
          '<path d="M12 12.4l-1.45 2.3h2.9z" fill="#171310"/>' +
          '<path d="M9.4 17.3v2.5M12 17.3v2.7M14.6 17.3v2.5" stroke="#171310" stroke-width="1.05" stroke-linecap="round"/>' +
        '</svg>' +
      '</div>' +
      '<div class="disc back">❖</div>' +
    '</div>';
  el.querySelector(".num").textContent = NUM[p.t];
  el.querySelector(".nm").textContent = NAME[p.t];
  return el;
}
export function syncPieces(){
  var g = getGame();
  var sel = getSel(), curMoves = getCurMoves(), armed = getArmed();
  var alive = new Set();

  /* 一枚棋子的落位。pressed = 被压在河格下面的那枚：缩小、偏移、不可点 */
  function place(p, i, pressed){
    alive.add(p.uid);
    var el = cache.get(p.uid);
    var c = xy(i);
    if (!el){
      /* 新棋子：先定好位再入 DOM，避免从左上角滑入 */
      el = makePieceEl(p);
      el.dataset.i = i;
      el.style.setProperty("--px", String(c.x - 1));
      el.style.setProperty("--py", String(c.y - 1));
      el.classList.add(p.c === "r" ? "red" : "black");
      if (!p.rv) el.classList.add("hidden");
      if (pressed) el.classList.add("pressed");
      else if (p.under) el.classList.add("pressing");
      pieceEl.appendChild(el);
      cache.set(p.uid, el);
      return;
    }
    el.dataset.i = i;
    el.style.setProperty("--px", c.x - 1);
    el.style.setProperty("--py", c.y - 1);
    el.classList.toggle("hidden", !p.rv);
    el.classList.toggle("red", p.c === "r");
    el.classList.toggle("black", p.c === "b");
    el.classList.toggle("pressed", pressed);
    el.classList.toggle("pressing", !pressed && !!p.under);
    if (pressed){
      el.classList.remove("sel", "cap", "selfcap", "armed", "doomed");
      return;
    }
    el.classList.toggle("sel", i === sel);
    var isCap = false, isSelf = false;
    curMoves.forEach(function(m){
      if (m.to !== i) return;
      if (m.kind === "capture") isCap = true;
      else if (m.kind === "self") isSelf = true;
    });
    el.classList.toggle("cap", isCap);
    el.classList.toggle("selfcap", isSelf);
    /* 待确认的危险着法：自残画在被吃的那枚子上；引爆则画在豹自己身上，
       同时把 Y3–Y5 的全体标成将毁。 */
    var pendMove = (armed >= 0 && sel >= 0) ? findMove(armed) : null;
    var diving = !!(pendMove && pendMove.kind === "dive");
    el.classList.toggle("armed", diving ? i === sel : i === armed);
    el.classList.toggle("doomed", diving && xy(i).y >= 3 && xy(i).y <= 5);
    if (g.pulse === i){
      el.classList.add("pulse");
      (function(node){ setTimeout(function(){ node.classList.remove("pulse"); }, 520); })(el);
    }
  }

  for (var i = 0; i < N; i++){
    var p = g.board[i];
    if (!p) continue;
    place(p, i, false);
    if (p.under) place(p.under, i, true);   /* 河格里被压住的子也照样画出来 */
  }
  cache.forEach(function(el, uid){
    if (alive.has(uid)) return;
    el.classList.add("gone");
    cache.delete(uid);
    setTimeout(function(){ el.remove(); }, 320);
  });
  g.pulse = null;
}
export function renderCells(){
  var g = getGame();
  var curMoves = getCurMoves();
  var mv = {}, m;
  for (var k = 0; k < curMoves.length; k++){
    m = curMoves[k];
    if (m.kind === "move") mv[m.to] = "mv";
    else if (m.kind === "press") mv[m.to] = "mv press";
    else if (m.kind === "thirst") mv[m.to] = "mv thirst";
    else if (m.kind === "dive") mv[m.to] = "mv boom";
  }
  var bl = blockadeColor(g);
  for (var i = 0; i < N; i++){
    var d = cellEls[i], cls = d.className.replace(/\s*(mv|press|thirst|boom|sel|last|blockade)\b/g, "");
    if (mv[i]) cls += " " + mv[i];
    if (i === getSel()) cls += " sel";
    if (g.last && (i === g.last.from || i === g.last.to)) cls += " last";
    if (bl && isBank(i)){
      var p = g.board[i];
      if (p && p.rv && p.c === bl) cls += " blockade";
    }
    d.className = cls;

    var mk = d.querySelector(".mk");
    if (mv[i] === "mv boom"){
      if (!mk){ mk = document.createElement("span"); mk.className = "mk"; d.appendChild(mk); }
      mk.textContent = "✸";
    } else if (mk){
      mk.remove();
    }
  }
}
export function render(){
  syncPieces();
  renderCells();
  renderPanel();
  renderVictory();
}
/* 终局大告示：铺满棋盘的一张牌，压过其它所有提示 */
export function renderVictory(){
  var g = getGame();
  var v = document.getElementById("victory");
  if (!g.result){ v.hidden = true; return; }
  var r = g.result, cls = "victory", badge, title, why;
  if (r.kind === "win"){
    var red = r.winner === "r";
    cls += red ? " win-r" : " win-b";
    badge = "胜";
    title = (red ? "红方" : "黑方") + "胜";
    why = r.stalemate ? "对方无子可走，困毙判负" : "敌方棋子已被吃光";
  } else {
    badge = "和";
    title = "和棋";
    why = r.why;
  }
  v.className = cls;
  document.getElementById("vBadge").textContent = badge;
  document.getElementById("vTitle").textContent = title;
  document.getElementById("vWhy").textContent = why;
  v.hidden = false;
}
export function renderPanel(){
  var g = getGame();
  var mode = getMode();
  var sel = getSel(), armed = getArmed();
  var c = counts(g);
  var pr = g.pcolor[0], pb = g.pcolor[1];
  document.getElementById("countR").textContent = c.r;
  document.getElementById("countB").textContent = c.b;
  document.getElementById("labelR").textContent = pr === "r" ? "红方（先手）" : (pb === "r" ? "红方（后手）" : "红方");
  document.getElementById("labelB").textContent = pb === "b" ? "黑方（后手）" : (pr === "b" ? "黑方（先手）" : "黑方");

  document.getElementById("sideR").classList.toggle("turn", !g.result && g.pcolor[g.turn] === "r");
  document.getElementById("sideB").classList.toggle("turn", !g.result && g.pcolor[g.turn] === "b");

  var dot = document.getElementById("turnDot");
  var who = document.getElementById("turnWho");
  var sub = document.getElementById("turnSub");
  var cur = g.pcolor[g.turn];
  dot.className = "dot " + (cur || "none");
  if (g.result){
    dot.className = "dot none";
    if (g.result.kind === "win"){
      who.textContent = (g.result.winner === "r" ? "红方" : "黑方") + "胜";
      sub.textContent = g.result.stalemate ? "困毙" : "对方棋子已被吃光";
    } else {
      who.textContent = "和棋";
      sub.textContent = g.result.why;
    }
  } else if (!g.firstFlip){
    who.textContent = "先手翻棋";
    sub.textContent = mode === "pvp" ? "先手方" : (isAITurn() ? "电脑执先手" : "你执先手");
  } else {
    who.textContent = (cur === "r" ? "红方" : "黑方") + "行棋";
    sub.textContent = "第 " + (g.log.filter(function(l){ return l.c !== "s"; }).length) + " 手";
    if (mode === "ai") sub.textContent += isAITurn() ? " · 电脑" : " · 你";
    if (mode === "aiai") sub.textContent += g.turn === 0 ? " · 电脑A" : " · 电脑B";
  }

  var hint = document.getElementById("hint");
  if (isReplaying()){
    hint.textContent = "回放中 · 点行棋记录可跳到那一手 · 也可从当前局面接着下";
  } else if (g.result){
    hint.textContent = "本局已结束 —— 点棋盘中央的「再来一盘」开新局";
  } else if (pendingMove() && pendingMove().kind === "self"){
    var sp = g.board[sel], tp = g.board[armed];
    hint.textContent = "⚠ 再点一次同一格确认自残：" + pname(sp)
      + (sp.t === tp.t ? " 与己方 " + pname(tp) + " 邀兑，同归于尽" : " 吃掉己方 " + pname(tp))
      + " · 点别处取消";
  } else if (pendingMove() && pendingMove().kind === "dive"){
    var z = blastZone(), mine = 0, theirs = 0, hid = 0, me = g.pcolor[g.turn];
    z.forEach(function(o){
      if (!o.p.rv) hid++;
      else if (o.p.c === me) mine++;
      else theirs++;
    });
    hint.textContent = "☠ 再点一次同一格确认引爆：Y3–Y5 将有 " + z.length + " 枚棋子阵亡"
      + "（己方 " + mine + " · 敌方 " + theirs + (hid ? " · 暗棋 " + hid + " 枚归属不明" : "") + "）"
      + "，豹自身也在其中 · 点别处取消";
  } else if (!g.firstFlip){
    hint.textContent = isAITurn()
      ? "电脑思考中…"
      : "点击任意一枚盖着的棋子翻开 · 先手翻出的颜色即先手方阵营";
  } else if (mode === "aiai"){
    hint.textContent = "电脑对弈进行中 · 「重新开局」可随时开始新的一盘";
  } else if (mode === "ai" && isAITurn()){
    hint.textContent = "电脑思考中…";
  } else {
    hint.textContent = "点己方棋子选中，再点高亮格落子；点暗棋即翻开";
  }

  var bn = document.getElementById("banner");
  var bl = blockadeColor(g);
  if (bl && !g.result){
    bn.hidden = false;
    document.getElementById("bannerTxt").innerHTML =
      "<b>" + (bl === "r" ? "红方" : "黑方") + "堵岸</b> —— 两岸之子免疫敌方攻击，" +
      (bl === "r" ? "黑" : "红") + "方金鸡不得渡河；此时任意一方的豹都可下河引爆。";
  } else {
    bn.hidden = true;
  }

  var gr = document.getElementById("graveR"), gb = document.getElementById("graveB");
  gr.innerHTML = g.caps.r.map(function(t){ return '<span class="gv r">' + NAME[t] + "</span>"; }).join("");
  gb.innerHTML = g.caps.b.map(function(t){ return '<span class="gv b">' + NAME[t] + "</span>"; }).join("");

  var lg = document.getElementById("log");
  var replaying = isReplaying();
  lg.innerHTML = g.log.map(function(l){
    var seek = replaying && l.step;
    var cls = l.c + (seek ? " seek" : "");
    var attr = seek ? ' data-step="' + l.step + '" title="回到第 ' + l.step + ' 手"' : "";
    return '<div class="' + cls + '"' + attr + ">" + l.h + "</div>";
  }).join("");
  /* 行棋记录总是停在最新的一步 */
  lg.scrollTop = lg.scrollHeight;

  document.getElementById("btnUndo").disabled =
    getUndoStack().length === 0 || !!g.result || mode === "aiai" || isReplaying();
  document.getElementById("btnSaveDemo").disabled = isReplaying() || !getActions().length;

  renderDemos();
  renderReplay();
}

/* ---------- Demo 列表 / 回放条 ---------- */
function esc(s){
  return String(s).replace(/[&<>"']/g, function(c){
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function pad2(n){ return (n < 10 ? "0" : "") + n; }

export function renderDemos(){
  var box = document.getElementById("demoList");
  var list = listDemos();
  if (!list.length){
    box.innerHTML = '<div class="demo-empty">还没有保存的对局 —— 走几步后点「保存 Demo」。</div>';
    return;
  }
  box.innerHTML = list.map(function(d){
    var t = new Date(d.at || 0);
    var when = (t.getMonth() + 1) + "-" + t.getDate() + " " + pad2(t.getHours()) + ":" + pad2(t.getMinutes());
    var res = !d.result ? "未完" :
      (d.result.kind === "win"
        ? ((d.result.winner === "r" ? "红方" : "黑方") + "胜")
        : "和棋");
    return '<div class="demo">' +
      '<button class="demo-play" data-play="' + esc(d.id) + '" title="回放">▶</button>' +
      '<span class="demo-info"><b>' + esc(when) + "</b> · " + ((d.actions && d.actions.length) || 0) + " 手 · " + esc(res) + "</span>" +
      '<button class="demo-del" data-del="' + esc(d.id) + '" title="删除">删</button>' +
    "</div>";
  }).join("");
}

export function renderReplay(){
  var bar = document.getElementById("replayBar");
  var info = getReplayInfo();
  if (!info){ bar.hidden = true; return; }
  bar.hidden = false;
  document.getElementById("replayInfo").textContent = "回放 " + info.idx + " / " + info.total + " 手";
}

/* ================= 交互 ================= */
export function onCell(i){
  var g = getGame();
  if (!g || g.result || isReplaying() || isAITurn()) return;
  var p = g.board[i];
  var mine = g.pcolor[g.turn];

  /* 已选中棋子时，先判断这一格是不是它的合法落点——含己方棋子（自残）。
     这一步必须排在「点自己人就改选」之前，否则自残永远点不出来。 */
  if (getSel() >= 0 && getSel() !== i){
    var mv = findMove(i);
    if (mv){
      /* 自残 / 引爆都是「会伤到自己人」的着法：再点一次同一格确认，避免误触 */
      if ((mv.kind === "self" || mv.kind === "dive") && getArmed() !== i){ setArmed(i); render(); return; }
      commit(mv);
      return;
    }
    setSel(-1); setCurMoves([]);
  }
  setArmed(-1);

  if (!p){ render(); return; }
  if (!p.rv){ commit({ kind: "flip", i: i }); return; }
  if (i === getSel()){ setSel(-1); setCurMoves([]); render(); return; }
  if (mine && p.c === mine){ setSel(i); setCurMoves(movesFor(g, i)); render(); return; }
  render();
}
