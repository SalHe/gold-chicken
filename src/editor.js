/* 棋盘编辑器：纯摆棋模型与开局校验。不碰 DOM、不读模块状态。 */
import { N, NAME, NUM } from "./constants.js";
import { allActions } from "./rules.js";

/* 草稿：cells 每格为 { t, c, rv } 或 null；hidden 只决定「下一枚」放成
   明棋还是暗棋，落子时写进棋子自己的 rv，之后不再受 hidden 影响。 */
export function createEditor(){
  return { cells: new Array(N).fill(null), first: "r", hidden: true, sel: null };
}

function validColor(c){ return c === "r" || c === "b"; }
function validRank(t){ return t === (t | 0) && t >= 1 && t <= 12; }
function colorName(c){ return c === "r" ? "红方" : "黑方"; }

export function isPlaced(ed, c, t){
  for (let i = 0; i < N; i++){
    const p = ed.cells[i];
    if (p && p.c === c && p.t === t) return true;
  }
  return false;
}

/* 选中调色板里的一枚棋子。已摆过的阶数不能再选；再次点同一枚取消选择。 */
export function selectRank(ed, c, t){
  if (!validColor(c) || !validRank(t)) return false;
  if (isPlaced(ed, c, t)) return false;
  if (ed.sel && ed.sel.c === c && ed.sel.t === t){ ed.sel = null; return true; }
  ed.sel = { c: c, t: t };
  return true;
}

export function placementsOf(ed){
  const out = [];
  for (let i = 0; i < N; i++){
    const p = ed.cells[i];
    if (p) out.push({ i: i, t: p.t, c: p.c, rv: p.rv });
  }
  return out;
}

/* 用当前选中的棋子落子；目标格已有棋子时替换（旧阶数随之释放）。 */
export function placeAt(ed, i){
  if (!ed.sel) return false;
  if (i !== (i | 0) || i < 0 || i >= N) return false;
  ed.cells[i] = { t: ed.sel.t, c: ed.sel.c, rv: !ed.hidden };
  ed.sel = null;
  return true;
}

export function removeAt(ed, i){
  if (i !== (i | 0) || i < 0 || i >= N || !ed.cells[i]) return false;
  ed.cells[i] = null;
  return true;
}

export function clearPlacements(ed){
  ed.cells.fill(null);
  ed.sel = null;
}

export function setFirst(ed, c){
  if (!validColor(c)) return false;
  ed.first = c;
  return true;
}

export function setHidden(ed, hidden){
  ed.hidden = !!hidden;
}

/* 与 newGame() 的游戏对象形状一致。
   firstFlip:true 表示阵营已由摆棋指定，之后再翻棋不会改写 pcolor。 */
export function buildGame(placements, first, uidStart){
  const board = new Array(N).fill(null);
  let uid = uidStart || 0;
  for (let k = 0; k < placements.length; k++){
    const pl = placements[k];
    board[pl.i] = { uid: ++uid, t: pl.t, c: pl.c, rv: pl.rv !== false };
  }
  return {
    board: board,
    turn: 0,
    pcolor: [first, first === "r" ? "b" : "r"],
    noCap: 0,
    firstFlip: true,
    result: null,
    last: null,
    caps: { r: [], b: [] },
    log: [],
    pulse: null,
    chase: null
  };
}

/* 开局校验。先手方必须至少有一个合法着法；暗棋的翻棋着法也算，
   所以「有暗棋可翻」不会误判为困毙。 */
export function validatePosition(placements, first){
  if (first !== "r" && first !== "b") return { ok: false, reason: "先手必须是红方或黑方。" };
  if (!Array.isArray(placements)) return { ok: false, reason: "摆棋数据不完整。" };
  const seen = { r: new Array(13).fill(false), b: new Array(13).fill(false) };
  const used = new Array(N).fill(false);
  let r = 0, b = 0;
  for (let k = 0; k < placements.length; k++){
    const pl = placements[k];
    if (!pl || pl.i !== (pl.i | 0) || pl.i < 0 || pl.i >= N){
      return { ok: false, reason: "棋子的位置不合法。" };
    }
    if (!validColor(pl.c) || !validRank(pl.t)){
      return { ok: false, reason: "棋子的颜色或阶数不合法。" };
    }
    if (used[pl.i]) return { ok: false, reason: "同一格不能放两枚棋子。" };
    if (seen[pl.c][pl.t]){
      return { ok: false, reason: colorName(pl.c) + NUM[pl.t] + NAME[pl.t] + "已经摆过了。" };
    }
    used[pl.i] = true;
    seen[pl.c][pl.t] = true;
    if (pl.c === "r") r++; else b++;
  }
  if (!r) return { ok: false, reason: "红方至少需要一枚棋子。" };
  if (!b) return { ok: false, reason: "黑方至少需要一枚棋子。" };
  const g = buildGame(placements, first, 0);
  if (!allActions(g, 0).length){
    return { ok: false, reason: "先手方无子可动、也无暗棋可翻。" };
  }
  return { ok: true, reason: "" };
}

/* 编辑器当前草稿的校验 + 给状态行用的文案。 */
export function validateEditor(ed){
  const placements = placementsOf(ed);
  const v = validatePosition(placements, ed.first);
  if (!v.ok) return { ok: false, reason: v.reason, placements: placements, first: ed.first };
  let r = 0, b = 0;
  for (let k = 0; k < placements.length; k++){
    if (placements[k].c === "r") r++; else b++;
  }
  return {
    ok: true,
    reason: "可以开始 · " + colorName(ed.first) + "先手 · 红 " + r + " 子 / 黑 " + b + " 子",
    placements: placements,
    first: ed.first
  };
}
