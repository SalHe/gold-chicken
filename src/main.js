/* 装配/启动：change hook、scheduleAI、模式切换、Demo 回放、事件绑定、bootstrap（esbuild 入口）。 */
import { aiPick } from "./ai.js";
import * as ui from "./ui.js";
import { getDemo, saveDemo, removeDemo, newDemoId, parseDemos, importDemos } from "./demo.js";
import {
  setChanged, newGame, snapshot, commit, isAITurn, undo,
  getGame, getMode, getAiFirst, setAiFirst, getUndoStack, getActions, getBaseSnapshot,
  getPositionHistory, getAiPaused, setAiPaused,
  isReplaying, getReplayInfo, beginReplay, replayStep, replayGoto, adoptReplay, endReplay,
  setMode as setStateMode
} from "./state.js";

let aiTimer = null;
let replayTimer = null;
let replayDemo = null;

/* ---------- 剪贴板 ---------- */
/* 异步剪贴板 API 在非安全上下文 / 部分浏览器里不可用，退回 execCommand。 */
function copyText(text){
  try{
    if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText){
      return navigator.clipboard.writeText(text);
    }
  }catch(e){}
  return Promise.reject(new Error("clipboard unavailable"));
}
function legacyCopy(text){
  var ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "-1000px";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  var ok = false;
  try{ ok = !!(document.execCommand && document.execCommand("copy")); }catch(e){}
  document.body.removeChild(ta);
  return ok;
}

function stopAI(){ if (aiTimer){ clearTimeout(aiTimer); aiTimer = null; } }

function scheduleAI(){
  if (getAiPaused()) return;
  if (aiTimer) clearTimeout(aiTimer);
  aiTimer = setTimeout(function(){
    aiTimer = null;
    if (isReplaying() || !isAITurn() || getAiPaused()) return;
    var g = getGame();
    var a = aiPick(g, g.turn, { history: getPositionHistory() });
    if (a) commit(a);
  }, 480 + Math.random() * 260);
}

/* AI 对弈的单步：暂停自动行棋，立刻替当前一方走一手。
   走完仍保持暂停，用户可以继续单步、悔棋，或点「自动」恢复连走。 */
function stepAI(){
  stopAI();
  setAiPaused(true);
  if (isReplaying() || getMode() !== "aiai") return;
  var g = getGame();
  if (!g || g.result) return;
  var a = aiPick(g, g.turn, { history: getPositionHistory() });
  if (a) commit(a); else syncPace();
}
function applyPace(paused){
  setAiPaused(paused);
  stopAI();
  syncPace();
  if (!paused && !isReplaying() && getMode() === "aiai" && !getGame().result) scheduleAI();
}
function syncPace(){
  var aiai = getMode() === "aiai";
  var paused = getAiPaused();
  var over = !getGame() || !!getGame().result || isReplaying();
  document.getElementById("paceSeg").hidden = !aiai;
  document.getElementById("bAuto").setAttribute("aria-pressed", paused ? "false" : "true");
  document.getElementById("bStep").setAttribute("aria-pressed", paused ? "true" : "false");
  document.getElementById("bAuto").disabled = over;
  document.getElementById("bStep").disabled = over;
}

/* ---------- Demo 回放 ---------- */
function stopReplayTimer(){
  if (replayTimer){ clearInterval(replayTimer); replayTimer = null; }
}
function updateReplayButtons(){
  var on = isReplaying();
  var info = getReplayInfo();
  var idx = info ? info.idx : 0, total = info ? info.total : 0;
  document.getElementById("btnReplayPlay").textContent = replayTimer ? "暂停" : "播放";
  document.getElementById("btnReplayPlay").disabled = !on;
  document.getElementById("btnReplayStep").disabled = !on || idx >= total;
  document.getElementById("btnReplayBack").disabled = !on || idx <= 0;
  document.getElementById("btnReplayStop").disabled = !on;
  var over = !on || !!getGame().result;
  document.getElementById("btnReplayResume").disabled = over;
  document.getElementById("replayMode").disabled = over;
}
function seekReplay(n){
  if (!isReplaying()) return;
  stopReplayTimer();
  replayGoto(n);
  updateReplayButtons();
}
function startReplayTimer(){
  stopReplayTimer();
  replayTimer = setInterval(function(){
    if (!replayStep()){
      stopReplayTimer();
      if (!isReplaying()) replayDemo = null;
      updateReplayButtons();
    }
  }, 620);
  updateReplayButtons();
}
function playDemo(d){
  stopAI();
  stopReplayTimer();
  if (isReplaying()) endReplay();
  replayDemo = d;
  if (!beginReplay(d.start, d.actions)){
    replayDemo = null;
    updateReplayButtons();
    return;
  }
  document.getElementById("replayMode").value = getMode();
  startReplayTimer();
}
function exitReplay(){
  stopReplayTimer();
  if (isReplaying()) endReplay();
  replayDemo = null;
  updateReplayButtons();
}

function syncModeButtons(){
  var m = getMode();
  document.getElementById("mPvp").setAttribute("aria-pressed", m === "pvp" ? "true" : "false");
  document.getElementById("mAi").setAttribute("aria-pressed", m === "ai" ? "true" : "false");
  document.getElementById("mAiAi").setAttribute("aria-pressed", m === "aiai" ? "true" : "false");
  /* 先手选择只在人机对弈时有意义 */
  document.getElementById("firstSeg").hidden = m !== "ai";
  document.getElementById("pFirst").setAttribute("aria-pressed", getAiFirst() ? "false" : "true");
  document.getElementById("aFirst").setAttribute("aria-pressed", getAiFirst() ? "true" : "false");
  syncPace();
}

function setMode(m){
  exitReplay();
  setStateMode(m);
  syncModeButtons();
  stopAI();
  newGame();
}

function start(){
  setChanged(function(reset){
    if (reset) ui.clearPieceCache();
    ui.render();
    syncPace();
    if (!getGame().result && !isReplaying() && isAITurn() && !getAiPaused()) scheduleAI();
  });

  ui.initUi();
  ui.buildGrid();
  syncModeButtons();
  newGame();

  function freshGame(){
    exitReplay();
    stopAI();
    newGame();
  }

  document.getElementById("btnNew").addEventListener("click", freshGame);
  document.getElementById("vBtn").addEventListener("click", freshGame);

  /* 结束界面：按住「查看棋局」暂时隐藏，松开恢复；「关闭」彻底收起。
     关闭后 onCell 仍因 result 直接返回，棋局保持只读。 */
  var vPeek = document.getElementById("vPeek");
  var peeking = false;
  function startPeek(e){
    if (e && e.pointerType === "mouse" && e.button !== 0) return;
    if (e && e.preventDefault) e.preventDefault();
    peeking = true;
    ui.hideVictory();
  }
  function endPeek(){
    if (!peeking) return;
    peeking = false;
    ui.restoreVictory();
  }
  vPeek.addEventListener("pointerdown", startPeek);
  vPeek.addEventListener("pointerleave", endPeek);
  vPeek.addEventListener("contextmenu", function(e){ e.preventDefault(); });
  /* 键盘：按住空格/回车同样可以短暂查看 */
  vPeek.addEventListener("keydown", function(e){
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    if (!peeking){ peeking = true; ui.hideVictory(); }
  });
  vPeek.addEventListener("keyup", function(e){
    if (e.key === " " || e.key === "Enter") endPeek();
  });
  vPeek.addEventListener("blur", endPeek);
  /* 手指/鼠标在按钮外松开也要恢复，否则结束界面会一直隐身 */
  window.addEventListener("pointerup", endPeek);
  window.addEventListener("pointercancel", endPeek);
  document.getElementById("vClose").addEventListener("click", function(){
    endPeek();
    ui.dismissVictory();
    ui.render();
  });

  document.getElementById("btnUndo").addEventListener("click", function(){
    if (isReplaying() || !getUndoStack().length) return;
    stopAI();
    /* AI 对弈：悔棋时一并暂停自动行棋，方便逐步复盘；点「自动」继续 */
    if (getMode() === "aiai") setAiPaused(true);
    /* 人机模式：一次悔棋退回到自己行棋前的一手（连电脑那一手一起退） */
    var n = 1;
    if (getMode() === "ai" && getGame().turn === (getAiFirst() ? 1 : 0)) n = 2;
    undo(n);                       /* 悔棋栈保留，可以一直悔下去 */
    syncPace();
  });

  /* 当前对局打包成 Demo：起始快照 + 走子序列，保存和复制共用。
     回放中或还没走过子时没有可导出的对局，返回 null。 */
  function currentDemo(){
    if (isReplaying()) return null;
    var acts = getActions(), start0 = getBaseSnapshot();
    if (!acts.length || !start0) return null;
    var g = getGame();
    return {
      id: newDemoId(),
      at: Date.now(),
      result: g.result || null,
      start: start0,
      actions: acts.slice()
    };
  }

  var btnSaveDemo = document.getElementById("btnSaveDemo");
  btnSaveDemo.addEventListener("click", function(){
    var demo = currentDemo();
    if (!demo) return;
    var ok = saveDemo(demo);
    ui.renderDemos();
    btnSaveDemo.textContent = ok ? "已保存 ✓" : "保存失败";
    setTimeout(function(){ btnSaveDemo.textContent = "保存 Demo"; }, 1200);
  });

  /* 只复制，不写 localStorage */
  var btnCopyDemo = document.getElementById("btnCopyDemo");
  btnCopyDemo.addEventListener("click", function(){
    var demo = currentDemo();
    if (!demo) return;
    var txt = JSON.stringify(demo);
    var done = function(ok){
      btnCopyDemo.textContent = ok ? "已复制 ✓" : "复制失败";
      setTimeout(function(){ btnCopyDemo.textContent = "复制当前 Demo"; }, 1200);
    };
    copyText(txt).then(function(){ done(true); }, function(){ done(legacyCopy(txt)); });
  });

  /* Demo 列表：▶ 回放 / 复制 / 删 删除 */
  document.getElementById("demoList").addEventListener("click", function(e){
    var t = e.target.closest ? e.target.closest("[data-play],[data-copy],[data-del]") : null;
    if (!t) return;
    if (t.hasAttribute("data-del")){
      removeDemo(t.getAttribute("data-del"));
      ui.renderDemos();
      return;
    }
    if (t.hasAttribute("data-copy")){
      var dc = getDemo(t.getAttribute("data-copy"));
      if (!dc) return;
      var label = t, txt = JSON.stringify(dc);
      var show = function(ok){
        label.textContent = ok ? "✓" : "失败";
        setTimeout(function(){ label.textContent = "复制"; }, 1200);
      };
      copyText(txt).then(function(){ show(true); }, function(){ show(legacyCopy(txt)); });
      return;
    }
    var d = getDemo(t.getAttribute("data-play"));
    if (d) playDemo(d);
  });

  /* Demo 导入：先直接读剪贴板；读不到（无权限 / 浏览器不支持）就展开粘贴框 */
  var importBtn = document.getElementById("btnDemoImport");
  var importBox = document.getElementById("demoImportBox");
  var importText = document.getElementById("demoImportText");
  var importTimer = null;
  function importFeedback(msg){
    importBtn.textContent = msg;
    if (importTimer) clearTimeout(importTimer);
    importTimer = setTimeout(function(){ importBtn.textContent = "从剪贴板导入"; }, 1600);
  }
  function showImportBox(){
    importBox.hidden = false;
    try{ importText.focus(); }catch(e){}
  }
  function hideImportBox(){ importBox.hidden = true; }
  function doImport(text){
    var parsed = parseDemos(text);
    var added = importDemos(text);
    ui.renderDemos();
    if (!parsed.length){ importFeedback("不是有效的 Demo"); return; }
    hideImportBox();
    importText.value = "";
    importFeedback(added ? "已导入 " + added + " 局 ✓" : "已在列表里，或本地存储不可用");
  }
  importBtn.addEventListener("click", function(){
    var p;
    try{
      p = (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.readText)
        ? navigator.clipboard.readText()
        : Promise.reject(new Error("clipboard unavailable"));
    }catch(e){ p = Promise.reject(e); }
    p.then(function(text){
      if (text && text.trim()) doImport(text);
      else showImportBox();
    }, showImportBox);
  });
  document.getElementById("btnDemoImportDo").addEventListener("click", function(){
    doImport(importText.value || "");
  });
  document.getElementById("btnDemoImportCancel").addEventListener("click", hideImportBox);

  document.getElementById("btnReplayStop").addEventListener("click", exitReplay);
  document.getElementById("btnReplayBack").addEventListener("click", function(){
    var info = getReplayInfo();
    if (!isReplaying() || !info || info.idx <= 0) return;
    seekReplay(info.idx - 1);
  });
  /* 回放中点击行棋记录：跳到那一手之后的局面 */
  document.getElementById("log").addEventListener("click", function(e){
    if (!isReplaying()) return;
    var t = e.target.closest ? e.target.closest("[data-step]") : null;
    if (!t) return;
    var n = parseInt(t.getAttribute("data-step"), 10);
    if (!isFinite(n)) return;
    seekReplay(n);
  });
  document.getElementById("btnReplayResume").addEventListener("click", function(){
    if (!isReplaying() || getGame().result) return;
    stopReplayTimer();
    var m = document.getElementById("replayMode").value;
    if (m !== "pvp" && m !== "ai" && m !== "aiai") m = "pvp";
    var turn = getGame().turn;
    setStateMode(m);
    /* 人机模式：人接手当前行棋的一方，AI 执另一方 */
    if (m === "ai") setAiFirst(turn === 1);
    setAiPaused(false);             /* 从回放接续时恢复自动行棋 */
    replayDemo = null;
    if (!adoptReplay()) return;
    syncModeButtons();
    updateReplayButtons();
  });
  document.getElementById("btnReplayStep").addEventListener("click", function(){
    if (!isReplaying()) return;
    stopReplayTimer();
    if (!replayStep() && !isReplaying()) replayDemo = null;
    updateReplayButtons();
  });
  document.getElementById("btnReplayPlay").addEventListener("click", function(){
    if (!isReplaying()) return;
    if (replayTimer){ stopReplayTimer(); updateReplayButtons(); return; }
    var info = getReplayInfo();
    if (info && info.idx >= info.total && replayDemo){
      var d = replayDemo;
      endReplay();
      if (beginReplay(d.start, d.actions)) startReplayTimer();
      else { replayDemo = null; updateReplayButtons(); }
      return;
    }
    startReplayTimer();
  });

  var modal = document.getElementById("modal");
  document.getElementById("btnRules").addEventListener("click", function(){ modal.hidden = false; });
  modal.addEventListener("click", function(e){ if (e.target.hasAttribute("data-close")) modal.hidden = true; });
  document.addEventListener("keydown", function(e){ if (e.key === "Escape") modal.hidden = true; });

  document.getElementById("mPvp").addEventListener("click", function(){ setMode("pvp"); });
  document.getElementById("mAi").addEventListener("click", function(){ setMode("ai"); });
  document.getElementById("mAiAi").addEventListener("click", function(){ setMode("aiai"); });
  /* AI 对弈节奏：自动连走 / 暂停逐手 */
  document.getElementById("bAuto").addEventListener("click", function(){
    if (getMode() !== "aiai" || getGame().result || isReplaying()) return;
    applyPace(false);
  });
  document.getElementById("bStep").addEventListener("click", function(){
    if (getMode() !== "aiai" || getGame().result || isReplaying()) return;
    stepAI();
  });
  document.getElementById("pFirst").addEventListener("click", function(){
    if (!getAiFirst()) return;
    setAiFirst(false);
    syncModeButtons();
    freshGame();
  });
  document.getElementById("aFirst").addEventListener("click", function(){
    if (getAiFirst()) return;
    setAiFirst(true);
    syncModeButtons();
    freshGame();
  });

  /* 页面被重新发布时保留对局 */
  try{
    if (window.claude && window.claude.hot && typeof window.claude.hot.snapshot === "function"){
      window.claude.hot.snapshot(function(){ return snapshot(); });
    }
  }catch(e){}
}

start();
