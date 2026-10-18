/* 装配/启动：change hook、scheduleAI、模式切换、Demo 回放、事件绑定、bootstrap（esbuild 入口）。 */
import { aiPick } from "./ai.js";
import * as ui from "./ui.js";
import { getDemo, saveDemo, removeDemo, newDemoId, parseDemos, importDemos } from "./demo.js";
import {
  setChanged, newGame, snapshot, commit, isAITurn, undo,
  getGame, getMode, getAiFirst, setAiFirst, getUndoStack, getActions, getBaseSnapshot,
  getPositionHistory, getAiPaused, setAiPaused,
  isReplaying, getReplayInfo, beginReplay, replayStep, replayGoto, adoptReplay, endReplay,
  setMode as setStateMode, getLastNote, setFeedback
} from "./state.js";

let aiTimer = null;
let replayTimer = null;

/* ---------- 偏好设置：速度 / 主题 / 棋子样式 / 音效 / 震动 ---------- */
var PREF = {
  speed: "gold-chicken.speed.v1",
  theme: "gold-chicken.theme.v1",
  face: "gold-chicken.face.v1",
  sound: "gold-chicken.sound.v1",
  vibe: "gold-chicken.vibe.v1"
};
var speed = "mid", theme = "auto", face = "text", soundOn = false, vibeOn = false;
var SPEED_DELAY = { slow: [920, 320], mid: [480, 260], fast: [150, 120] };
var REPLAY_MS = { slow: 1100, mid: 620, fast: 280 };

function readPref(key, valid, dflt){
  try{
    var v = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    if (v == null) return dflt;
    if (valid && valid.indexOf(v) < 0) return dflt;
    return v;
  }catch(e){ return dflt; }
}
function writePref(key, v){
  try{ if (typeof localStorage !== "undefined") localStorage.setItem(key, v); }catch(e){}
}

function syncSpeed(){
  var ids = { slow: "spSlow", mid: "spMid", fast: "spFast" };
  for (var k in ids){
    if (Object.prototype.hasOwnProperty.call(ids, k)){
      document.getElementById(ids[k]).setAttribute("aria-pressed", speed === k ? "true" : "false");
    }
  }
}
function setSpeed(v){
  if (v !== "slow" && v !== "mid" && v !== "fast") return;
  speed = v;
  writePref(PREF.speed, v);
  syncSpeed();
  if (replayTimer) startReplayTimer();   /* 回放中改速度立即生效 */
}
function syncTheme(){
  var ids = { auto: "thAuto", light: "thLight", dark: "thDark" };
  for (var k in ids){
    if (Object.prototype.hasOwnProperty.call(ids, k)){
      document.getElementById(ids[k]).setAttribute("aria-pressed", theme === k ? "true" : "false");
    }
  }
}
function applyTheme(){
  try{
    var root = document.documentElement;
    if (!root) return;
    if (theme === "auto"){
      if (root.removeAttribute) root.removeAttribute("data-theme");
    } else if (root.setAttribute){
      root.setAttribute("data-theme", theme);
    }
  }catch(e){}
}
function setTheme(v){
  if (v !== "auto" && v !== "light" && v !== "dark") return;
  theme = v;
  writePref(PREF.theme, v);
  applyTheme();
  syncTheme();
}
/* 棋子样式：汉字棋名 / 图案 + 阶数 / 纯图案（无数字，WebP 内联，无外部资源） */
function syncFace(){
  document.getElementById("fcText").setAttribute("aria-pressed", face === "text" ? "true" : "false");
  document.getElementById("fcIcon").setAttribute("aria-pressed", face === "icon" ? "true" : "false");
  document.getElementById("fcArt").setAttribute("aria-pressed", face === "art" ? "true" : "false");
  ui.setPieceFace(face);
}
function setFace(v){
  if (v !== "text" && v !== "icon" && v !== "art") return;
  face = v;
  writePref(PREF.face, v);
  syncFace();
}
function syncSwitches(){
  var s = document.getElementById("swSound"), v = document.getElementById("swVibe");
  s.setAttribute("aria-checked", soundOn ? "true" : "false");
  s.textContent = soundOn ? "开" : "关";
  s.classList.toggle("on", soundOn);
  v.setAttribute("aria-checked", vibeOn ? "true" : "false");
  v.textContent = vibeOn ? "开" : "关";
  v.classList.toggle("on", vibeOn);
}

/* ---------- 音效 / 震动：默认关闭，由设置里的开关打开 ---------- */
var actx = null;
var SOUND = {
  flip: [520, .06, "triangle", .04],
  move: [300, .05, "sine", .035],
  press: [190, .09, "square", .04],
  capture: [150, .13, "sawtooth", .05],
  trade: [240, .11, "triangle", .045],
  thirst: [120, .2, "sawtooth", .05],
  dive: [90, .35, "sawtooth", .06],
  win: [660, .25, "triangle", .05],
  draw: [330, .2, "sine", .045]
};
var VIBE = {
  flip: 12, move: 8, press: 16, capture: 24, trade: 20,
  thirst: 30, dive: [30, 50, 30], win: [25, 60, 25], draw: 28
};
function tone(freq, dur, type, gain){
  try{
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!actx) actx = new AC();
    if (actx.state === "suspended" && actx.resume) actx.resume();
    var t0 = actx.currentTime;
    var o = actx.createOscillator(), g = actx.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(Math.max(0.0001, gain || 0.04), t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(actx.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }catch(e){}
}
function feedback(kind){
  var s = SOUND[kind];
  if (soundOn && s) tone(s[0], s[1], s[2], s[3]);
  if (vibeOn && VIBE[kind] && typeof navigator !== "undefined" && navigator.vibrate){
    try{ navigator.vibrate(VIBE[kind]); }catch(e){}
  }
}
function setSound(on){
  soundOn = !!on;
  writePref(PREF.sound, soundOn ? "1" : "0");
  syncSwitches();
  if (soundOn) tone(660, .08, "triangle", .05);   /* 在点击手势里初始化音频上下文 */
}
function setVibe(on){
  vibeOn = !!on;
  writePref(PREF.vibe, vibeOn ? "1" : "0");
  syncSwitches();
  if (vibeOn && typeof navigator !== "undefined" && navigator.vibrate){
    try{ navigator.vibrate(20); }catch(e){}
  }
}

/* ---------- 走子播报 ---------- */
var popTimer = null;
function hideMovePop(){
  if (popTimer){ clearTimeout(popTimer); popTimer = null; }
  var pop = document.getElementById("movePop");
  if (pop){ pop.classList.remove("show"); pop.textContent = ""; }
}
function announce(turnBefore){
  var pop = document.getElementById("movePop");
  var note = getLastNote();
  if (!pop || !note) return;
  var who = getMode() === "aiai" ? (turnBefore === 0 ? "电脑A" : "电脑B") : "电脑";
  pop.textContent = who + "：" + note;
  pop.classList.add("show");
  if (popTimer) clearTimeout(popTimer);
  popTimer = setTimeout(function(){
    popTimer = null;
    pop.classList.remove("show");
  }, 1900);
}
let replayDemo = null;
/* 本次回放是否由结束界面的「复盘本局」发起；退出时要把终局告示还原 */
let replayFromVictory = false;

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
    var turnBefore = g.turn;
    var a = aiPick(g, g.turn, { history: getPositionHistory() });
    if (a){ commit(a); announce(turnBefore); }
  }, SPEED_DELAY[speed][0] + Math.random() * SPEED_DELAY[speed][1]);
}

/* AI 对弈的单步：暂停自动行棋，立刻替当前一方走一手。
   走完仍保持暂停，用户可以继续单步、悔棋，或点「自动」恢复连走。 */
function stepAI(){
  stopAI();
  setAiPaused(true);
  if (isReplaying() || getMode() !== "aiai") return;
  var g = getGame();
  if (!g || g.result) return;
  var turnBefore = g.turn;
  var a = aiPick(g, g.turn, { history: getPositionHistory() });
  if (a){ commit(a); announce(turnBefore); } else syncPace();
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
  }, REPLAY_MS[speed]);
  updateReplayButtons();
}
function playDemo(d){
  stopAI();
  stopReplayTimer();
  if (isReplaying()) endReplay();
  replayFromVictory = false;
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
  /* 从结束界面进入的复盘：退出时把终局告示交还给只读的棋局 */
  if (replayFromVictory){
    replayFromVictory = false;
    ui.clearVictoryDismissed();
  }
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
  /* 偏好设置：读不到就回到默认（速度中、主题跟随系统、棋子文字、音效/震动关） */
  speed = readPref(PREF.speed, ["slow", "mid", "fast"], "mid");
  theme = readPref(PREF.theme, ["auto", "light", "dark"], "auto");
  face = readPref(PREF.face, ["text", "icon", "art"], "text");
  soundOn = readPref(PREF.sound, null, "0") === "1";
  vibeOn = readPref(PREF.vibe, null, "0") === "1";
  applyTheme();
  setFeedback(feedback);

  setChanged(function(reset){
    if (reset){
      ui.clearPieceCache();
      hideMovePop();
    }
    ui.render();
    syncPace();
    if (!getGame().result && !isReplaying() && isAITurn() && !getAiPaused()) scheduleAI();
  });

  ui.initUi();
  ui.buildGrid();
  syncModeButtons();
  syncSpeed();
  syncTheme();
  syncFace();
  syncSwitches();
  newGame();

  function freshGame(){
    exitReplay();
    stopAI();
    newGame();
  }

  /* 重新开局会清空当前对局，有走子又未终局时先问一句 */
  function requestNewGame(){
    var g = getGame();
    if (isReplaying() || !g || g.result || !getActions().length){ freshGame(); return; }
    askConfirm("重新开局？",
      "当前对局尚未结束。重新开局会清空本局进度和悔棋记录（已保存的 Demo 不受影响）。",
      "重新开局", freshGame);
  }

  /* ---------- 二次确认弹层 ---------- */
  var confirmEl = document.getElementById("confirm");
  var confirmOk = document.getElementById("confirmOk");
  var confirmCancel = document.getElementById("confirmCancel");
  var confirmAction = null;
  function askConfirm(title, msg, okText, fn){
    /* 弹层期间暂停 AI，避免它在用户犹豫时继续落子；取消后再恢复 */
    stopAI();
    document.getElementById("confirmTitle").textContent = title;
    document.getElementById("confirmMsg").textContent = msg;
    confirmOk.textContent = okText;
    confirmAction = fn;
    confirmEl.hidden = false;
    try{ confirmOk.focus(); }catch(e){}
  }
  function closeConfirm(){
    confirmEl.hidden = true;
    confirmAction = null;
  }
  /* 取消：关掉弹层，并把刚才暂停的 AI 行棋接上 */
  function cancelConfirm(){
    closeConfirm();
    if (getMode() === "pvp" || isReplaying()) return;
    var g = getGame();
    if (g && !g.result) scheduleAI();
  }
  confirmOk.addEventListener("click", function(){
    var fn = confirmAction;
    closeConfirm();
    if (fn) fn();
  });
  confirmCancel.addEventListener("click", cancelConfirm);
  confirmEl.addEventListener("click", function(e){
    if (e.target.hasAttribute && e.target.hasAttribute("data-cancel")) cancelConfirm();
  });

  document.getElementById("btnNew").addEventListener("click", requestNewGame);
  document.getElementById("qbNew").addEventListener("click", requestNewGame);
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

  function doUndo(){
    if (isReplaying() || !getUndoStack().length) return;
    stopAI();
    /* AI 对弈：悔棋时一并暂停自动行棋，方便逐步复盘；点「自动」继续 */
    if (getMode() === "aiai") setAiPaused(true);
    /* 人机模式：一次悔棋退回到自己行棋前的一手（连电脑那一手一起退） */
    var n = 1;
    if (getMode() === "ai" && getGame().turn === (getAiFirst() ? 1 : 0)) n = 2;
    undo(n);                       /* 悔棋栈保留，可以一直悔下去 */
    syncPace();
  }
  document.getElementById("btnUndo").addEventListener("click", doUndo);
  document.getElementById("qbUndo").addEventListener("click", doUndo);

  /* 终局告示上的悔棋：只撤回决胜的一手，让棋局回到未分胜负的状态 */
  function undoFromVictory(){
    if (isReplaying() || !getUndoStack().length) return;
    stopAI();
    if (getMode() === "aiai") setAiPaused(true);
    undo(1);
    hideMovePop();
    syncPace();
  }
  document.getElementById("vUndo").addEventListener("click", undoFromVictory);

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

  /* 只复制，不写 localStorage；保存与复制共用 currentDemo() */
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

  /* 结束界面的「复盘本局」：把本局当作一段 Demo 从头逐手回看，停在开局。
     关闭结束界面后再进回放，棋局由只读变为可控的回放视图。 */
  document.getElementById("vReplay").addEventListener("click", function(){
    var acts = getActions(), start0 = getBaseSnapshot();
    if (!acts.length || !start0) return;
    stopAI();
    stopReplayTimer();
    ui.dismissVictory();
    if (isReplaying()) endReplay();
    replayFromVictory = true;
    replayDemo = { start: start0, actions: acts.slice() };
    if (!beginReplay(start0, acts.slice())){
      replayFromVictory = false;
      replayDemo = null;
      ui.clearVictoryDismissed();
      updateReplayButtons();
      ui.render();
      return;
    }
    document.getElementById("replayMode").value = getMode();
    /* 不自动播放：先停在空盘，让用户自己按「播放」或「单步」 */
    updateReplayButtons();
  });

  /* 结束界面的「复制 Demo」：与侧栏「复制当前 Demo」同源同格式 */
  var vCopyDemo = document.getElementById("vCopyDemo");
  vCopyDemo.addEventListener("click", function(){
    var demo = currentDemo();
    if (!demo) return;
    var txt = JSON.stringify(demo);
    var done = function(ok){
      vCopyDemo.textContent = ok ? "已复制 ✓" : "复制失败";
      setTimeout(function(){ vCopyDemo.textContent = "复制 Demo"; }, 1400);
    };
    copyText(txt).then(function(){ done(true); }, function(){ done(legacyCopy(txt)); });
  });

  /* Demo 列表：▶ 回放 / 复制 / 删 删除。
     删除不可撤销：第一次点击只进入确认态，2.6 秒内再点一次才真正删除。
     确认态由 ui 渲染，中途重绘也不会丢掉。 */
  var delTimer = null;
  function clearDelConfirm(){
    if (delTimer){ clearTimeout(delTimer); delTimer = null; }
    ui.setDemoDelConfirm(null);
  }
  document.getElementById("demoList").addEventListener("click", function(e){
    var t = e.target.closest ? e.target.closest("[data-play],[data-copy],[data-del]") : null;
    if (!t) return;
    if (t.hasAttribute("data-del")){
      var delId = t.getAttribute("data-del");
      if (t.getAttribute("data-confirm") !== "1"){
        clearDelConfirm();
        ui.setDemoDelConfirm(delId);
        ui.renderDemos();
        delTimer = setTimeout(function(){
          delTimer = null;
          ui.setDemoDelConfirm(null);
          ui.renderDemos();
        }, 2600);
        return;
      }
      clearDelConfirm();
      removeDemo(delId);
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
  /* 回放：行棋记录在「已走」与「全程」之间切换；全程模式下可直接点未走的记录向前跳 */
  document.getElementById("logModeBtn").addEventListener("click", function(){
    if (!isReplaying()) return;
    ui.toggleLogFullMode();
    ui.renderPanel();
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
    replayFromVictory = false;
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
  function openRules(){ modal.hidden = false; }
  document.getElementById("btnRules").addEventListener("click", openRules);
  document.getElementById("qbRules").addEventListener("click", openRules);
  modal.addEventListener("click", function(e){ if (e.target.hasAttribute("data-close")) modal.hidden = true; });
  document.addEventListener("keydown", function(e){
    if (e.key !== "Escape") return;
    if (!confirmEl.hidden) cancelConfirm();
    else modal.hidden = true;
  });

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

  /* 速度：同时作用于电脑行棋与 Demo 回放 */
  document.getElementById("spSlow").addEventListener("click", function(){ setSpeed("slow"); });
  document.getElementById("spMid").addEventListener("click", function(){ setSpeed("mid"); });
  document.getElementById("spFast").addEventListener("click", function(){ setSpeed("fast"); });
  /* 主题：跟随系统 / 强制浅色 / 强制深色，写在 <html data-theme> 上并持久化 */
  document.getElementById("thAuto").addEventListener("click", function(){ setTheme("auto"); });
  document.getElementById("thLight").addEventListener("click", function(){ setTheme("light"); });
  document.getElementById("thDark").addEventListener("click", function(){ setTheme("dark"); });
  /* 棋子样式：汉字 / 图案 / 纯图案，选择持久化 */
  document.getElementById("fcText").addEventListener("click", function(){ setFace("text"); });
  document.getElementById("fcIcon").addEventListener("click", function(){ setFace("icon"); });
  document.getElementById("fcArt").addEventListener("click", function(){ setFace("art"); });
  /* 音效 / 震动：默认关闭，开关状态持久化 */
  document.getElementById("swSound").addEventListener("click", function(){ setSound(!soundOn); });
  document.getElementById("swVibe").addEventListener("click", function(){ setVibe(!vibeOn); });

  /* 页面被重新发布时保留对局 */
  try{
    if (window.claude && window.claude.hot && typeof window.claude.hot.snapshot === "function"){
      window.claude.hot.snapshot(function(){ return snapshot(); });
    }
  }catch(e){}
}

start();
