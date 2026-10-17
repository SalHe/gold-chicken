/* 装配/启动：change hook、scheduleAI、setMode、事件绑定、bootstrap（esbuild 入口）。 */
import { aiPick } from "./ai.js";
import * as ui from "./ui.js";
import {
  setChanged, newGame, restore, snapshot, commit, isAITurn,
  getGame, getMode, getAiFirst, setAiFirst, getUndoStack, setMode as setStateMode
} from "./state.js";

let aiTimer = null;

function scheduleAI(){
  if (aiTimer) clearTimeout(aiTimer);
  aiTimer = setTimeout(function(){
    aiTimer = null;
    if (!isAITurn()) return;
    var g = getGame();
    var a = aiPick(g, g.turn);
    if (a) commit(a);
  }, 480 + Math.random() * 260);
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
  setStateMode(m);
  syncModeButtons();
  if (aiTimer){ clearTimeout(aiTimer); aiTimer = null; }
  newGame();
}

function start(){
  setChanged(function(reset){
    if (reset) ui.clearPieceCache();
    ui.render();
    if (!getGame().result && isAITurn()) scheduleAI();
  });

  ui.initUi();
  ui.buildGrid();
  syncModeButtons();
  newGame();

  document.getElementById("btnNew").addEventListener("click", function(){
    if (aiTimer){ clearTimeout(aiTimer); aiTimer = null; }
    newGame();
  });
  document.getElementById("vBtn").addEventListener("click", function(){
    if (aiTimer){ clearTimeout(aiTimer); aiTimer = null; }
    newGame();
  });
  document.getElementById("btnUndo").addEventListener("click", function(){
    var undoStack = getUndoStack();
    if (!undoStack.length) return;
    if (aiTimer){ clearTimeout(aiTimer); aiTimer = null; }
    var s = undoStack.pop();
    /* 人机模式：一次悔棋退回到自己行棋前的一手（连电脑那一手一起退） */
    if (getMode() === "ai"){
      var humanTurn = getAiFirst() ? 1 : 0;
      if (getGame().turn === humanTurn && undoStack.length) s = undoStack.pop();
    }
    restore(s);
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
    if (aiTimer){ clearTimeout(aiTimer); aiTimer = null; }
    newGame();
  });
  document.getElementById("aFirst").addEventListener("click", function(){
    if (getAiFirst()) return;
    setAiFirst(true);
    syncModeButtons();
    if (aiTimer){ clearTimeout(aiTimer); aiTimer = null; }
    newGame();
  });

  /* 页面被重新发布时保留对局 */
  try{
    if (window.claude && window.claude.hot && typeof window.claude.hot.snapshot === "function"){
      window.claude.hot.snapshot(function(){ return snapshot(); });
    }
  }catch(e){}
}

start();
