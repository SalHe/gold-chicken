/* DOM 渲染 + 点击交互。import state 访问器；import 时不碰 document。 */
import { W, H, N, NAME, NUM } from "./constants.js";
import { xy, terrain, blockadeColor, isBank, pname, counts, movesFor, blockadeDrawLoser } from "./rules.js";
import {
  getGame, getSel, setSel, getCurMoves, setCurMoves, getArmed, setArmed,
  getMode, getUndoStack, getActions, findMove, pendingMove, blastZone, commit, isAITurn,
  getAiPaused, isReplaying, getReplayInfo, getReplayLog
} from "./state.js";
import { listDemos } from "./demo.js";
import { pieceArtSrc } from "./piece-art.js";
import {
  createEditor, isPlaced, selectRank, placeAt, removeAt,
  clearPlacements, setFirst, setHidden, validateEditor, placementIssue
} from "./editor.js";

let gridEl = null, pieceEl = null, stackEl = null;
let cellEls = [];
const cache = new Map();
/* 棋面模式：text = 汉字，icon = 图案 + 阶数，art = 纯图案（不显示数字）；
   由设置里的「棋子」切换。图案为压缩后的 WebP，构建时内联。 */
let pieceFace = "text";
export function setPieceFace(mode){
  pieceFace = mode === "icon" || mode === "art" ? mode : "text";
  if (pieceEl) pieceEl.dataset.face = pieceFace;
  if (edPieceEl) edPieceEl.dataset.face = pieceFace;
}

/* ---------- 棋盘编辑器 ----------
   草稿只存在于 UI 层：取消/关闭直接丢弃，不会碰活棋状态。 */
let ed = null, edOpen = false, edReturnFocus = null;
let edModalEl = null, edGridEl = null, edPieceEl = null, edRedEl = null, edBlackEl = null;
let edReasonEl = null, edStartEl = null, edFirstREl = null, edFirstBEl = null;
let edVisHiddenEl = null, edVisShownEl = null;
let edCells = [], edPalette = [], edFocusIdx = 0;
/* 最近一次落子被拒绝的原因；显示在状态行，下一次操作时清掉 */
let edNotice = null;
/* 键盘焦点所在的格（roving tabindex）：整张棋盘只占一个 Tab 位 */
let focusIdx = 0;
/* 被用户关掉的结束界面。记结果对象本身而不是布尔值：
   新一局的结果是另一个对象，界面会重新弹出。 */
let dismissedResult = null;
/* 回放时的行棋记录模式：false = 只列已走过的（原有行为），true = 列整段 Demo */
let logFullMode = false;
export function toggleLogFullMode(){ logFullMode = !logFullMode; return logFullMode; }

/* 懒解析 DOM：import ui.js 时不碰 document，测试可自由控制导入顺序 */
export function initUi(){
  gridEl = document.getElementById("grid");
  pieceEl = document.getElementById("pieces");
  if (pieceEl) pieceEl.dataset.face = pieceFace;
  stackEl = document.getElementById("stack");
  stackEl.addEventListener("click", function(e){
    const t = e.target.closest("[data-i]");
    if (!t) return;
    const i = parseInt(t.dataset.i, 10);
    if (isFinite(i)) focusIdx = i;
    onCell(i);
  });
  /* 键盘：方向键在棋盘上移动焦点，回车/空格落子或翻棋 */
  stackEl.addEventListener("keydown", function(e){
    const t = e.target && e.target.closest ? e.target.closest("[data-i]") : null;
    if (!t) return;
    const i = parseInt(t.dataset.i, 10);
    if (!isFinite(i)) return;
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar"){
      e.preventDefault();
      onCell(i);
      return;
    }
    const c = xy(i);
    let nx = c.x, ny = c.y;
    if (e.key === "ArrowLeft") nx--;
    else if (e.key === "ArrowRight") nx++;
    else if (e.key === "ArrowUp") ny--;
    else if (e.key === "ArrowDown") ny++;
    else return;
    e.preventDefault();
    nx = Math.max(1, Math.min(W, nx));
    ny = Math.max(1, Math.min(H, ny));
    const n = (ny - 1) * W + (nx - 1);
    focusIdx = n;
    for (let k = 0; k < cellEls.length; k++) cellEls[k].tabIndex = k === n ? 0 : -1;
    if (cellEls[n] && cellEls[n].focus) cellEls[n].focus();
  });
}

export function buildGrid(){
  gridEl.innerHTML = "";
  cellEls = [];
  for (let i = 0; i < N; i++){
    const c = xy(i), t = terrain(c.x, c.y);
    const d = document.createElement("div");
    d.className = "cell " + (t === "river" ? "river" : t === "bank" ? "bank" : "land-b");
    d.dataset.i = i;
    d.setAttribute("role", "button");
    d.tabIndex = i === focusIdx ? 0 : -1;
    if (t === "bank"){
      const l = document.createElement("span");
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
  const el = document.createElement("div");
  el.className = "piece" + (NAME[p.t].length > 1 ? " long" : "");
  el.innerHTML =
    '<div class="inner">' +
      '<div class="disc front"><span class="num"></span><span class="nm"></span>' +
        '<span class="art" aria-hidden="true">' +
          '<img class="art-img" src="' + pieceArtSrc(p.t) + '" alt="" draggable="false">' +
        "</span>" +
        '<svg class="skull" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
          '<path d="M12 1.8C7.3 1.8 3.5 5.4 3.5 9.9c0 2.6 1.3 4.6 3.2 5.9v2.4c0 .9.7 1.6 1.6 1.6h.8v2.3c0 .6.5 1.1 1.1 1.1h3.6c.6 0 1.1-.5 1.1-1.1v-2.3h.8c.9 0 1.6-.7 1.6-1.6v-2.4c1.9-1.3 3.2-3.3 3.2-5.9 0-4.5-3.8-8.1-8.5-8.1z" ' +
            'fill="#f7f1e6" stroke="#171310" stroke-width="1.1" stroke-linejoin="round"/>' +
          '<circle cx="8.9" cy="9.7" r="2.35" fill="#171310"/>' +
          '<circle cx="15.1" cy="9.7" r="2.35" fill="#171310"/>' +
          '<path d="M12 12.4l-1.45 2.3h2.9z" fill="#171310"/>' +
          '<path d="M9.4 17.3v2.5M12 17.3v2.7M14.6 17.3v2.5" stroke="#171310" stroke-width="1.05" stroke-linecap="round"/>' +
        "</svg>" +
      "</div>" +
      '<div class="disc back">❖</div>' +
    "</div>";
  el.querySelector(".num").textContent = NUM[p.t];
  el.querySelector(".nm").textContent = NAME[p.t];
  return el;
}
export function syncPieces(){
  const g = getGame();
  const sel = getSel(), curMoves = getCurMoves(), armed = getArmed();
  const alive = new Set();

  /* 一枚棋子的落位。pressed = 被压在河格下面的那枚：缩小、偏移、不可点 */
  function place(p, i, pressed){
    alive.add(p.uid);
    let el = cache.get(p.uid);
    const c = xy(i);
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
      /* 不 return：继续走下面的状态类，保证清空缓存后的首次渲染
         也能正确标出选中、可吃、邀兑等状态 */
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
      el.classList.remove("sel", "cap", "trade", "selfcap", "armed", "doomed");
      return;
    }
    el.classList.toggle("sel", i === sel);
    el.classList.toggle("last", !!(g.last && g.last.to === i));
    /* 同阶敌子相吃是「邀兑」，与普通吃子用不同的记号区分：
       吃子画红色危险圈，邀兑画中性虚线 + 「兑」字角标。 */
    let isCap = false, isSelf = false, isTrade = false;
    curMoves.forEach(function(m){
      if (m.to !== i) return;
      if (m.kind === "capture"){
        const from = g.board[m.from], to = g.board[i];
        if (from && to && from.t === to.t) isTrade = true;
        else isCap = true;
      } else if (m.kind === "self") isSelf = true;
    });
    el.classList.toggle("cap", isCap);
    el.classList.toggle("trade", isTrade);
    el.classList.toggle("selfcap", isSelf);
    /* 待确认的危险着法：自残画在被吃的那枚子上；引爆则画在豹自己身上，
       同时把 Y3–Y5 的全体标成将毁。 */
    const pendMove = (armed >= 0 && sel >= 0) ? findMove(armed) : null;
    const diving = !!(pendMove && pendMove.kind === "dive");
    el.classList.toggle("armed", diving ? i === sel : i === armed);
    el.classList.toggle("doomed", diving && xy(i).y >= 3 && xy(i).y <= 5);
    if (g.pulse === i){
      el.classList.add("pulse");
      (function(node){ setTimeout(function(){ node.classList.remove("pulse"); }, 520); })(el);
    }
  }

  for (let i = 0; i < N; i++){
    const p = g.board[i];
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
/* 屏幕阅读器用的格子描述：地形 + 棋子 + 选中/可落子提示。
   暗棋只报「暗棋」，不泄露尚未翻开的颜色与身份。 */
function pieceLabel(p){
  if (!p) return "";
  if (!p.rv) return "暗棋";
  return (p.c === "r" ? "红方" : "黑方") + pname(p);
}
function moveLabel(g, m, i){
  if (m.kind === "capture"){
    const from = g.board[m.from], to = g.board[i];
    return from && to && from.t === to.t ? "，可邀兑" : "，可吃";
  }
  if (m.kind === "self") return "，可吃己方，需确认";
  if (m.kind === "press") return "，可压住";
  if (m.kind === "thirst") return "，上岸会渴死";
  if (m.kind === "dive") return "，引爆，需确认";
  return "，可走";
}
function cellAria(g, i, curMoves){
  const c = xy(i), t = terrain(c.x, c.y);
  const pos = "(" + c.x + "," + c.y + ")";
  let label = t === "river" ? "河 " + pos : t === "bank" ? "岸 " + pos : pos;
  const p = g.board[i];
  if (p){
    label += "，" + pieceLabel(p);
    if (p.under) label += "，压着 " + pieceLabel(p.under);
  } else if (t === "land"){
    label += "，空";
  }
  if (i === getSel()) label += "，已选中";
  for (let k = 0; k < curMoves.length; k++){
    if (curMoves[k].to === i){ label += moveLabel(g, curMoves[k], i); break; }
  }
  return label;
}

export function renderCells(){
  const g = getGame();
  const curMoves = getCurMoves();
  const mv = {};
  let m;
  for (let k = 0; k < curMoves.length; k++){
    m = curMoves[k];
    if (m.kind === "move") mv[m.to] = "mv";
    else if (m.kind === "press") mv[m.to] = "mv press";
    else if (m.kind === "thirst") mv[m.to] = "mv thirst";
    else if (m.kind === "dive") mv[m.to] = "mv boom";
  }
  const bl = blockadeColor(g);
  for (let i = 0; i < N; i++){
    const d = cellEls[i];
    let cls = d.className.replace(/\s*(mv|press|thirst|boom|sel|last-from|last-to|last|blockade)\b/g, "");
    if (mv[i]) cls += " " + mv[i];
    if (i === getSel()) cls += " sel";
    if (g.last && i === g.last.from) cls += " last-from";
    else if (g.last && i === g.last.to) cls += " last-to";
    if (bl && isBank(i)){
      const p = g.board[i];
      if (p && p.rv && p.c === bl) cls += " blockade";
    }
    d.className = cls;
    d.tabIndex = i === focusIdx ? 0 : -1;
    d.setAttribute("aria-label", cellAria(g, i, curMoves));

    let mk = d.querySelector(".mk");
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
/* 结束界面的查看控制：按住暂时隐藏以回看棋局，松开恢复；
   也可以彻底关闭——关闭后棋局仍是只读的（onCell 在 result 时直接返回）。 */
/* 「按住查看」把遮罩和牌子一起淡出，但元素仍在原地接收指针事件：
   若直接 hidden 掉，按住的手指会在下一帧丢失目标，松开事件就收不到了。
   用透明度隐藏还避免重排，松开时不会闪。 */
export function hideVictory(){
  const v = document.getElementById("victory");
  if (v.hidden) return;
  v.classList.add("peek");
}
export function restoreVictory(){
  const v = document.getElementById("victory");
  v.classList.remove("peek");
  const g = getGame();
  v.hidden = !g || !g.result || dismissedResult === g.result;
}
export function dismissVictory(){
  const g = getGame();
  dismissedResult = g && g.result ? g.result : null;
  const v = document.getElementById("victory");
  v.classList.remove("peek");
  v.hidden = true;
}
export function isVictoryDismissed(){
  const g = getGame();
  return !!(g && g.result && dismissedResult === g.result);
}
/* 离开回放时用：让「本局已结束」的告示重新接管，回到只读终局 */
export function clearVictoryDismissed(){ dismissedResult = null; }
/* 终局大告示：铺满棋盘的一张牌，压过其它所有提示 */
export function renderVictory(){
  const g = getGame();
  const v = document.getElementById("victory");
  if (!g.result || dismissedResult === g.result){
    v.classList.remove("peek");
    v.hidden = true;
    return;
  }
  const r = g.result;
  let cls = "victory", badge, title, why;
  if (r.kind === "win"){
    const red = r.winner === "r";
    cls += red ? " win-r" : " win-b";
    badge = "胜";
    title = (red ? "红方" : "黑方") + "胜";
    why = r.why || (r.stalemate ? "对方无子可走，困毙判负" : "敌方棋子已被吃光");
  } else {
    badge = "和";
    title = "和棋";
    why = r.why;
  }
  const peeking = v.classList.contains("peek");
  v.className = cls;
  if (peeking) v.classList.add("peek");
  document.getElementById("vBadge").textContent = badge;
  document.getElementById("vTitle").textContent = title;
  document.getElementById("vWhy").textContent = why;
  /* 复盘/复制都依赖本局的走子序列；极短的异常对局没有可复盘的着法时禁用。
     回放中的「复制」没有可导出的活棋局（currentDemo 会返回 null），一并禁用。 */
  const hasDemo = getActions().length > 0;
  document.getElementById("vReplay").disabled = !hasDemo;
  document.getElementById("vCopyDemo").disabled = !hasDemo || isReplaying();
  /* 终局也能悔棋：撤回决胜的一手，结束告示随之收起，棋局继续 */
  document.getElementById("vUndo").disabled = isReplaying() || getUndoStack().length === 0;
  v.hidden = false;
}
/* 按 uid 找棋盘顶层的棋子（长捉提示用） */
function pieceByUid(g, uid){
  for (let i = 0; i < N; i++){
    const p = g.board[i];
    if (p && p.uid === uid) return p;
  }
  return null;
}
export function renderPanel(){
  const g = getGame();
  const mode = getMode();
  const sel = getSel(), armed = getArmed();
  const c = counts(g);
  const pr = g.pcolor[0], pb = g.pcolor[1];
  document.getElementById("countR").textContent = c.r;
  document.getElementById("countB").textContent = c.b;
  document.getElementById("labelR").textContent = pr === "r" ? "红方（先手）" : (pb === "r" ? "红方（后手）" : "红方");
  document.getElementById("labelB").textContent = pb === "b" ? "黑方（后手）" : (pr === "b" ? "黑方（先手）" : "黑方");

  document.getElementById("sideR").classList.toggle("turn", !g.result && g.pcolor[g.turn] === "r");
  document.getElementById("sideB").classList.toggle("turn", !g.result && g.pcolor[g.turn] === "b");

  const dot = document.getElementById("turnDot");
  const who = document.getElementById("turnWho");
  const sub = document.getElementById("turnSub");
  const cur = g.pcolor[g.turn];
  const turnLabel = cur === "r" ? "红方" : (cur === "b" ? "黑方" : "");
  dot.className = "dot " + (cur || "none");
  if (g.result){
    dot.className = "dot none";
    if (g.result.kind === "win"){
      who.textContent = (g.result.winner === "r" ? "红方" : "黑方") + "胜";
      sub.textContent = g.result.why || (g.result.stalemate ? "困毙" : "对方棋子已被吃光");
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
    if (mode === "aiai" && getAiPaused()) sub.textContent += " · 单步";
  }

  /* 新规则的提前预警：长捉到第 9 回合、无吃子还剩 10 手、
     以及堵岸方子力较弱（届时和棋会改判负）。 */
  let warnText = "";
  if (!isReplaying() && !g.result){
    const ch = g.chase;
    if (ch && ch.rounds >= 9 && ch.rounds <= 10){
      const tgt = pieceByUid(g, ch.targetUid);
      if (tgt){
        warnText = "⚠ " + (ch.by === "r" ? "红方" : "黑方") + "长捉" +
          (tgt.c === "r" ? "红方" : "黑方") + pname(tgt) +
          "：已 " + ch.rounds + " 回合，再追 " + (11 - ch.rounds) + " 回合判负";
      }
    }
    if (!warnText && g.noCap >= 50 && g.noCap < 60){
      warnText = "⚠ 再走 " + (60 - g.noCap) + " 手无吃子将判和";
      const blLoser = blockadeDrawLoser(g);
      if (blLoser){
        warnText += "；" + (blLoser === "r" ? "红方" : "黑方") +
          "堵岸且子力较弱，届时改判负";
      }
    }
  }
  let warnStyle = false;
  const hint = document.getElementById("hint");
  if (isReplaying()){
    hint.textContent = "回放中 · 点行棋记录可跳到那一手 · 也可从当前局面接着下";
  } else if (g.result){
    hint.textContent = isVictoryDismissed()
      ? "本局已结束 · 结束界面已关闭，点「重新开局」开始新的一盘"
      : "本局已结束 —— 点棋盘中央的「再来一盘」开新局，或按住「查看棋局」回看";
  } else if (pendingMove() && pendingMove().kind === "self"){
    const sp = g.board[sel], tp = g.board[armed];
    hint.textContent = "⚠ 再点一次同一格确认自残：" + pname(sp)
      + (sp.t === tp.t ? " 与己方 " + pname(tp) + " 邀兑，同归于尽" : " 吃掉己方 " + pname(tp))
      + " · 点别处取消";
  } else if (pendingMove() && pendingMove().kind === "dive"){
    const z = blastZone(), me = g.pcolor[g.turn];
    let mine = 0, theirs = 0, hid = 0;
    z.forEach(function(o){
      if (!o.p.rv) hid++;
      else if (o.p.c === me) mine++;
      else theirs++;
    });
    hint.textContent = "☠ 再点一次同一格确认引爆：Y3–Y5 将有 " + z.length + " 枚棋子阵亡"
      + "（己方 " + mine + " · 敌方 " + theirs + (hid ? " · 暗棋 " + hid + " 枚归属不明" : "") + "）"
      + "，豹自身也在其中 · 点别处取消";
  } else if (warnText){
    hint.textContent = warnText;
    warnStyle = true;
  } else if (!g.firstFlip){
    hint.textContent = isAITurn()
      ? "电脑思考中…"
      : "点击任意一枚盖着的棋子翻开 · 先手翻出的颜色即先手方阵营";
  } else if (mode === "aiai"){
    hint.textContent = getAiPaused()
      ? "单步模式 · 轮到" + turnLabel + " · 点「单步」走一手，「自动」恢复连走，「悔棋」可回退"
      : "电脑对弈进行中 · 轮到" + turnLabel + " · 点「单步」可暂停并逐手查看";
  } else if (mode === "ai" && isAITurn()){
    hint.textContent = "电脑思考中… · 轮到" + turnLabel;
  } else if (mode === "ai"){
    hint.textContent = "轮到你 · " + turnLabel + "：点己方棋子选中，再点高亮格落子；点暗棋即翻开";
  } else {
    hint.textContent = "轮到" + turnLabel + "：点己方棋子选中，再点高亮格落子；点暗棋即翻开";
  }
  hint.classList.toggle("warn", warnStyle);

  const bn = document.getElementById("banner");
  const bl = blockadeColor(g);
  if (bl && !g.result){
    const blLoser2 = blockadeDrawLoser(g);
    const ll = blLoser2 === "r" ? "红方" : "黑方";
    bn.hidden = false;
    document.getElementById("bannerTxt").innerHTML =
      "<b>" + (bl === "r" ? "红方" : "黑方") + "堵岸</b> —— 两岸之子免疫敌方攻击，" +
      (bl === "r" ? "黑" : "红") + "方金鸡不得渡河；此时任意一方的豹都可下河引爆。" +
      (blLoser2 ? "<br><b>⚠ " + ll + "子力较弱</b> —— 判和将改判" + ll + "负。" : "");
  } else {
    bn.hidden = true;
  }

  const gr = document.getElementById("graveR"), gb = document.getElementById("graveB");
  gr.innerHTML = g.caps.r.map(function(t){ return '<span class="gv r">' + NAME[t] + "</span>"; }).join("");
  gb.innerHTML = g.caps.b.map(function(t){ return '<span class="gv b">' + NAME[t] + "</span>"; }).join("");

  const lg = document.getElementById("log");
  const replaying = isReplaying();
  /* 「全程」开关只在回放时出现；离开回放自动回到只列已走的模式 */
  const logBtn = document.getElementById("logModeBtn");
  if (!replaying) logFullMode = false;
  logBtn.hidden = !replaying;
  logBtn.setAttribute("aria-pressed", logFullMode ? "true" : "false");
  const full = (replaying && logFullMode) ? getReplayLog() : null;
  if (full){
    const walked = getReplayInfo() ? getReplayInfo().idx : 0;
    const rows = full.base.map(function(l){
      return '<div class="' + l.c + '">' + l.h + "</div>";
    });
    full.moves.forEach(function(l){
      const cls = l.c + (l.step === walked ? " seek cur" : (l.step < walked ? " seek" : " future"));
      rows.push('<div class="' + cls + '" data-step="' + l.step + '" title="' +
        (l.step > walked ? "跳到第 " : "回到第 ") + l.step + ' 手">' +
        '<span class="no">' + l.step + ".</span>" + l.h + "</div>");
    });
    lg.innerHTML = rows.join("");
    /* 让当前手停在可视区内；停在开局时回到顶部 */
    if (!walked) lg.scrollTop = 0;
    else {
      let curRow = null;
      try{ curRow = lg.querySelector('[data-step="' + walked + '"]'); }catch(e){}
      if (curRow && curRow.scrollIntoView) curRow.scrollIntoView({ block: "nearest" });
      else lg.scrollTop = lg.scrollHeight;
    }
  } else {
    /* 手数：回放用记录上的 step；活棋局用 commit 打上的 no。
       每条着法恰好生成一条日志，只有开头那条「开局」系统消息不是着法；
       旧快照里的非枚举序号会随 JSON 丢失，退回按日志顺序计数。 */
    let acted = 0;
    lg.innerHTML = g.log.map(function(l, idx){
      /* 有 step/no 的一定是着法；只有在两者都丢失时，才靠「首条系统消息」
         这个特征认出开局说明（普通对局里它总是第一条）。 */
      const opening = idx === 0 && l.c === "s" && !l.step && !l.no;
      if (!opening) acted++;
      const n = l.step || l.no || acted;
      const seek = replaying && l.step;
      const cls = l.c + (seek ? " seek" : "");
      const attr = seek ? ' data-step="' + l.step + '" title="回到第 ' + l.step + ' 手"' : "";
      const num = opening ? "" : '<span class="no">' + n + ".</span>";
      return '<div class="' + cls + '"' + attr + ">" + num + l.h + "</div>";
    }).join("");
    /* 行棋记录总是停在最新的一步 */
    lg.scrollTop = lg.scrollHeight;
  }

  const undoDisabled = getUndoStack().length === 0 || !!g.result || isReplaying() ||
    (mode === "aiai" && !getAiPaused());
  document.getElementById("btnUndo").disabled = undoDisabled;
  document.getElementById("qbUndo").disabled = undoDisabled;
  /* 回放时底部已有专门的回放条，快捷操作条让位 */
  document.getElementById("quickBar").hidden = isReplaying();
  document.getElementById("btnSaveDemo").disabled = isReplaying() || !getActions().length;
  document.getElementById("btnCopyDemo").disabled = isReplaying() || !getActions().length;

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

/* Demo 删除的二次确认状态放在渲染层，重绘（AI 行棋等）不会把「确认?」抹掉 */
let demoDelConfirmId = null;
export function setDemoDelConfirm(id){ demoDelConfirmId = id; }

export function renderDemos(){
  const box = document.getElementById("demoList");
  const list = listDemos();
  if (!list.length){
    box.innerHTML = '<div class="demo-empty">还没有保存的对局 —— 走几步后点「保存 Demo」。</div>';
    return;
  }
  box.innerHTML = list.map(function(d){
    const t = new Date(d.at || 0);
    const when = (t.getMonth() + 1) + "-" + t.getDate() + " " + pad2(t.getHours()) + ":" + pad2(t.getMinutes());
    const res = !d.result ? "未完" :
      (d.result.kind === "win"
        ? ((d.result.winner === "r" ? "红方" : "黑方") + "胜")
        : "和棋");
    const confirming = d.id === demoDelConfirmId;
    return '<div class="demo">' +
      '<button class="demo-play" data-play="' + esc(d.id) + '" title="回放">▶</button>' +
      '<span class="demo-info"><b>' + esc(when) + "</b> · " + ((d.actions && d.actions.length) || 0) + " 手 · " + esc(res) + "</span>" +
      '<button class="demo-copy" data-copy="' + esc(d.id) + '" title="复制这一局的 JSON">复制</button>' +
      '<button class="demo-del' + (confirming ? " confirming" : "") + '" data-del="' + esc(d.id) + '"'
        + (confirming ? ' data-confirm="1"' : "") + ' title="' + (confirming ? "再点一次确认删除" : "删除") + '">'
        + (confirming ? "确认?" : "删") + "</button>" +
    "</div>";
  }).join("");
}

export function renderReplay(){
  const bar = document.getElementById("replayBar");
  const info = getReplayInfo();
  if (!info){ bar.hidden = true; return; }
  bar.hidden = false;
  document.getElementById("replayInfo").textContent = "回放 " + info.idx + " / " + info.total + " 手";
}

/* ================= 棋盘编辑器 ================= */
function clearNode(el){
  if (!el) return;
  while (el.firstChild) el.removeChild(el.firstChild);
}

function cacheEditorEls(){
  edModalEl = document.getElementById("editor");
  edGridEl = document.getElementById("edGrid");
  edPieceEl = document.getElementById("edPieces");
  edRedEl = document.getElementById("edRed");
  edBlackEl = document.getElementById("edBlack");
  edReasonEl = document.getElementById("edReason");
  edStartEl = document.getElementById("edStart");
  edFirstREl = document.getElementById("edFirstR");
  edFirstBEl = document.getElementById("edFirstB");
  edVisHiddenEl = document.getElementById("edVisHidden");
  edVisShownEl = document.getElementById("edVisShown");
}

export function isEditorOpen(){ return edOpen; }
export function getEditorState(){ return ed; }
export function editorStatus(){
  if (!ed) return { ok: false, reason: "编辑器未打开。", placements: [], first: "r" };
  return validateEditor(ed);
}

export function openEditor(){
  cacheEditorEls();
  edReturnFocus = document.activeElement || null;
  ed = createEditor();
  edOpen = true;
  edNotice = null;
  edFocusIdx = 0;
  if (edModalEl) edModalEl.hidden = false;
  buildEditorGrid();
  buildEditorPalette();
  renderEditor();
  if (edCells[0] && edCells[0].focus){
    try{ edCells[0].focus(); }catch(e){}
  }
}

/* 开始失败时把弹层重新亮出来（正常流程里不会走到）。 */
export function showEditor(){
  if (!ed){ openEditor(); return; }
  edOpen = true;
  if (edModalEl) edModalEl.hidden = false;
  renderEditor();
}

export function closeEditor(){
  if (edModalEl) edModalEl.hidden = true;
  edOpen = false;
  ed = null;                    /* 取消即丢弃草稿，不影响当前对局 */
  edNotice = null;
  edCells = [];
  edPalette = [];
  const back = edReturnFocus;
  edReturnFocus = null;
  if (back && back.focus){
    try{ back.focus(); }catch(e){}
  }
}

export function clearEditor(){
  if (!ed) return;
  clearPlacements(ed);
  edNotice = null;
  renderEditor();
}

export function setEditorFirst(c){
  if (!ed) return;
  setFirst(ed, c);
  edNotice = null;
  renderEditor();
}

export function setEditorHidden(hidden){
  if (!ed) return;
  setHidden(ed, hidden);
  edNotice = null;
  renderEditor();
}

/* 棋盘点击：选中调色板棋子时落子；河格里的敌方棋子会被压住，
   其余已有棋子则被替换。没有选择时点已有棋子即移除（连同压子）。 */
export function onEditorCell(i){
  if (!ed) return;
  if (ed.sel){
    const issue = placementIssue(ed, i);
    if (issue){
      edNotice = issue;
      renderEditor();
      return;
    }
    if (placeAt(ed, i)) edNotice = null;
  } else if (removeAt(ed, i)){
    edNotice = null;
  }
  renderEditor();
}

export function onEditorPalette(c, t){
  if (!ed) return;
  selectRank(ed, c, t);
  edNotice = null;
  renderEditor();
}

function editorKey(e, i){
  if (e.key === "Enter" || e.key === " " || e.key === "Spacebar"){
    if (e.preventDefault) e.preventDefault();
    onEditorCell(i);
    return;
  }
  const c = xy(i);
  let nx = c.x, ny = c.y;
  if (e.key === "ArrowLeft") nx--;
  else if (e.key === "ArrowRight") nx++;
  else if (e.key === "ArrowUp") ny--;
  else if (e.key === "ArrowDown") ny++;
  else return;
  if (e.preventDefault) e.preventDefault();
  nx = Math.max(1, Math.min(W, nx));
  ny = Math.max(1, Math.min(H, ny));
  const n = (ny - 1) * W + (nx - 1);
  edFocusIdx = n;
  for (let k = 0; k < edCells.length; k++) edCells[k].tabIndex = k === n ? 0 : -1;
  if (edCells[n] && edCells[n].focus) edCells[n].focus();
}

/* 编辑器的格子与调色板都在打开时重建，按钮直接绑 click——
   测试桩没有事件冒泡与 closest，直接绑定最稳。 */
function buildEditorGrid(){
  clearNode(edGridEl);
  edCells = [];
  for (let i = 0; i < N; i++){
    const c = xy(i), t = terrain(c.x, c.y);
    const d = document.createElement("div");
    d.className = "cell " + (t === "river" ? "river" : t === "bank" ? "bank" : "land-b");
    d.dataset.i = String(i);
    d.setAttribute("role", "button");
    d.tabIndex = i === edFocusIdx ? 0 : -1;
    if (t === "bank"){
      const l = document.createElement("span");
      l.className = "lbl";
      l.textContent = "岸";
      d.appendChild(l);
    }
    d.addEventListener("click", function(){ onEditorCell(i); });
    d.addEventListener("keydown", function(e){ editorKey(e, i); });
    edGridEl.appendChild(d);
    edCells.push(d);
  }
}

function buildEditorPalette(){
  clearNode(edRedEl);
  clearNode(edBlackEl);
  edPalette = [];
  for (let k = 0; k < 2; k++){
    const c = k === 0 ? "r" : "b";
    const box = c === "r" ? edRedEl : edBlackEl;
    for (let t = 1; t <= 12; t++){
      const b = document.createElement("button");
      b.className = "ed-pt " + c;
      b.dataset.c = c;
      b.dataset.t = String(t);
      b.textContent = NUM[t] + NAME[t];
      b.title = (c === "r" ? "红方 " : "黑方 ") + NUM[t] + NAME[t];
      b.addEventListener("click", function(){ onEditorPalette(c, t); });
      box.appendChild(b);
      edPalette.push({ el: b, c: c, t: t });
    }
  }
}

function editorPieceLabel(p){
  if (!p) return "";
  return (p.c === "r" ? "红方" : "黑方") + NUM[p.t] + NAME[p.t] + (p.rv ? "" : "（暗）");
}

/* 编辑器棋子预览。暗棋保留正面：摆棋时要能核对究竟是哪一枚，
   用虚线环 + 「暗」角标表示开局后是盖着的。
   pressed = 被压在河格下面的那枚，缩小后偏移到右下角。 */
function addEditorPiece(p, i, pressed){
  const c = xy(i);
  const el = makePieceEl(p);
  el.dataset.i = String(i);
  el.style.setProperty("--px", String(c.x - 1));
  el.style.setProperty("--py", String(c.y - 1));
  el.classList.add(p.c === "r" ? "red" : "black");
  if (pressed) el.classList.add("pressed");
  else if (p.under) el.classList.add("pressing");
  if (!p.rv){
    el.classList.add("ed-hidden");
    const tag = document.createElement("span");
    tag.className = "ed-hide-tag";
    tag.textContent = "暗";
    el.appendChild(tag);
  }
  edPieceEl.appendChild(el);
}

export function renderEditor(){
  if (!ed) return;
  const st = validateEditor(ed);

  clearNode(edPieceEl);
  for (let i = 0; i < N; i++){
    const p = ed.cells[i];
    if (!p) continue;
    addEditorPiece(p, i, false);
    if (p.under) addEditorPiece(p.under, i, true);   /* 河格下面压着的子 */
  }
  if (edPieceEl) edPieceEl.dataset.face = pieceFace;

  for (let k = 0; k < edPalette.length; k++){
    const p = edPalette[k];
    const used = isPlaced(ed, p.c, p.t);
    const on = !!(ed.sel && ed.sel.c === p.c && ed.sel.t === p.t);
    p.el.disabled = used;
    p.el.classList.toggle("used", used);
    p.el.classList.toggle("sel", on);
    p.el.setAttribute("aria-pressed", on ? "true" : "false");
  }
  if (edFirstREl) edFirstREl.setAttribute("aria-pressed", ed.first === "r" ? "true" : "false");
  if (edFirstBEl) edFirstBEl.setAttribute("aria-pressed", ed.first === "b" ? "true" : "false");
  if (edVisHiddenEl) edVisHiddenEl.setAttribute("aria-pressed", ed.hidden ? "true" : "false");
  if (edVisShownEl) edVisShownEl.setAttribute("aria-pressed", ed.hidden ? "false" : "true");
  if (edReasonEl){
    edReasonEl.textContent = edNotice || st.reason;
    edReasonEl.classList.toggle("ok", !edNotice && st.ok);
  }
  if (edStartEl) edStartEl.disabled = !st.ok;

  for (let i = 0; i < edCells.length; i++){
    const c = xy(i), t = terrain(c.x, c.y);
    let label = (t === "river" ? "河 " : t === "bank" ? "岸 " : "") +
      "(" + c.x + "," + c.y + ")" + "，";
    const p = ed.cells[i];
    label += p ? editorPieceLabel(p) : "空";
    if (p && p.under) label += "，压着 " + editorPieceLabel(p.under);
    edCells[i].setAttribute("aria-label", label);
  }
}

/* ================= 交互 ================= */
export function onCell(i){
  const g = getGame();
  if (!g || g.result || isReplaying() || isAITurn()) return;
  const p = g.board[i];
  const mine = g.pcolor[g.turn];

  /* 已选中棋子时，先判断这一格是不是它的合法落点——含己方棋子（自残）。
     这一步必须排在「点自己人就改选」之前，否则自残永远点不出来。 */
  if (getSel() >= 0 && getSel() !== i){
    const mv = findMove(i);
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
