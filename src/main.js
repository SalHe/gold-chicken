/* 装配/启动：change hook、scheduleAI、模式切换、Demo 回放、事件绑定、bootstrap（esbuild 入口）。 */
import { aiPick } from "./ai.js";
import * as ui from "./ui.js";
import { getDemo, saveDemo, removeDemo, newDemoId } from "./demo.js";
import {
  setChanged, newGame, snapshot, commit, isAITurn, undo,
  getGame, getMode, getAiFirst, setAiFirst, getUndoStack, getActions, getBaseSnapshot,
  getPositionHistory,
  isReplaying, getReplayInfo, beginReplay, replayStep, replayGoto, adoptReplay, endReplay,
  setMode as setStateMode
} from "./state.js";

let aiTimer = null;
let replayTimer = null;
let replayDemo = null;

function stopAI(){ if (aiTimer){ clearTimeout(aiTimer); aiTimer = null; } }

function scheduleAI(){
  if (aiTimer) clearTimeout(aiTimer);
  aiTimer = setTimeout(function(){
    aiTimer = null;
    if (isReplaying() || !isAITurn()) return;
    var g = getGame();
    var a = aiPick(g, g.turn, { history: getPositionHistory() });
    if (a) commit(a);
  }, 480 + Math.random() * 260);
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
    if (!getGame().result && !isReplaying() && isAITurn()) scheduleAI();
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

  document.getElementById("btnUndo").addEventListener("click", function(){
    if (isReplaying() || !getUndoStack().length) return;
    stopAI();
    /* 人机模式：一次悔棋退回到自己行棋前的一手（连电脑那一手一起退） */
    var n = 1;
    if (getMode() === "ai" && getGame().turn === (getAiFirst() ? 1 : 0)) n = 2;
    undo(n);                       /* 悔棋栈保留，可以一直悔下去 */
  });

  var btnSaveDemo = document.getElementById("btnSaveDemo");
  btnSaveDemo.addEventListener("click", function(){
    if (isReplaying()) return;
    var acts = getActions(), start0 = getBaseSnapshot();
    if (!acts.length || !start0) return;
    var g = getGame();
    var ok = saveDemo({
      id: newDemoId(),
      at: Date.now(),
      result: g.result || null,
      start: start0,
      actions: acts.slice()
    });
    ui.renderDemos();
    btnSaveDemo.textContent = ok ? "已保存 ✓" : "保存失败";
    setTimeout(function(){ btnSaveDemo.textContent = "保存 Demo"; }, 1200);
  });

  /* Demo 列表：▶ 回放 / 删 删除 */
  document.getElementById("demoList").addEventListener("click", function(e){
    var t = e.target.closest ? e.target.closest("[data-play],[data-del]") : null;
    if (!t) return;
    if (t.hasAttribute("data-del")){
      removeDemo(t.getAttribute("data-del"));
      ui.renderDemos();
      return;
    }
    var d = getDemo(t.getAttribute("data-play"));
    if (d) playDemo(d);
  });

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
