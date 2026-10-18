/* 棋盘编辑器：纯摆棋模型与开局校验。不碰 DOM、不读模块状态。 */
import { N, NAME, NUM, DRAGON, ELEPHANT } from "./constants.js";
import { allActions, terrain, xy } from "./rules.js";

/* 草稿：cells 每格为 { t, c, rv, under? } 或 null；hidden 只决定「下一枚」
   放成明棋还是暗棋，落子时写进棋子自己的 rv，之后不再受 hidden 影响。
   河格可以被敌方棋子压住：under 是下面那枚（同样是 { t, c, rv }）。
   河格与岸上的棋子必须是明棋，落子时自动翻开。 */
export function createEditor(){
  return { cells: new Array(N).fill(null), first: "r", hidden: true, sel: null };
}

function validColor(c){ return c === "r" || c === "b"; }
function validRank(t){ return t === (t | 0) && t >= 1 && t <= 12; }
function colorName(c){ return c === "r" ? "红方" : "黑方"; }
function terrainOf(i){ const c = xy(i); return terrain(c.x, c.y); }
function riverOk(t){ return t === DRAGON || t === ELEPHANT; }

export function isPlaced(ed, c, t){
  for (let i = 0; i < N; i++){
    const p = ed.cells[i];
    if (!p) continue;
    if (p.c === c && p.t === t) return true;
    if (p.under && p.under.c === c && p.under.t === t) return true;
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
    if (!p) continue;
    const pl = { i: i, t: p.t, c: p.c, rv: p.rv !== false };
    if (p.under) pl.under = { t: p.under.t, c: p.under.c, rv: p.under.rv !== false };
    out.push(pl);
  }
  return out;
}

/* 棋子总数（含河格下面压住的子），用于分配不重叠的 uid。 */
export function pieceCount(placements){
  let n = 0;
  for (let k = 0; k < placements.length; k++){
    n += placements[k].under ? 2 : 1;
  }
  return n;
}

/* 落子前的阵地限制；返回空串表示可以落子。
   河格只有龙、象能进；龙上岸会渴死，所以不能摆在岸上。 */
export function placementIssue(ed, i){
  if (!ed.sel) return "先选一枚棋子。";
  if (i !== (i | 0) || i < 0 || i >= N) return "棋子的位置不合法。";
  const tt = terrainOf(i);
  if (tt === "river" && !riverOk(ed.sel.t)) return "只有龙和象能进河。";
  if (tt === "bank" && ed.sel.t === DRAGON) return "龙上岸会渴死，不能摆在岸上。";
  const old = ed.cells[i];
  if (tt === "river" && old && old.under) return "这格已经压着一枚棋子，先清空再摆。";
  return "";
}

/* 用当前选中的棋子落子。
   河格已有敌方棋子时「压住」它（河里不吃子）；其余情况替换原格。
   河格与岸上的棋子一律写成明棋。 */
export function placeAt(ed, i){
  if (placementIssue(ed, i)) return false;
  const tt = terrainOf(i);
  const old = ed.cells[i];
  const sel = ed.sel;
  if (tt === "river" && old && old.c !== sel.c){
    ed.cells[i] = {
      t: sel.t, c: sel.c, rv: true,
      under: { t: old.t, c: old.c, rv: true }
    };
  } else {
    ed.cells[i] = { t: sel.t, c: sel.c, rv: tt === "land" ? !ed.hidden : true };
  }
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
    const top = { uid: ++uid, t: pl.t, c: pl.c, rv: pl.rv !== false };
    if (pl.under){
      top.under = { uid: ++uid, t: pl.under.t, c: pl.under.c, rv: pl.under.rv !== false };
    }
    board[pl.i] = top;
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
   所以「有暗棋可翻」不会误判为困毙。
   阵地限制与落子一致：河格只有龙、象能进，龙不能摆在岸上，
   河格与岸上的棋子必须是明棋；河格最多压住一枚敌方棋子。 */
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
    const tt = terrainOf(pl.i), u = pl.under;
    if (tt === "river" && !riverOk(pl.t)) return { ok: false, reason: "只有龙和象能进河。" };
    if (tt === "bank" && pl.t === DRAGON) return { ok: false, reason: "龙不能摆在岸上。" };
    if (tt !== "land" && pl.rv === false){
      return { ok: false, reason: "河里和岸上的棋子不能是暗棋。" };
    }
    used[pl.i] = true;
    seen[pl.c][pl.t] = true;
    if (pl.c === "r") r++; else b++;
    if (u !== undefined && u !== null){
      if (typeof u !== "object" || !validColor(u.c) || !validRank(u.t)){
        return { ok: false, reason: "被压住的棋子不合法。" };
      }
      if (tt !== "river") return { ok: false, reason: "只有河格才能压子。" };
      if (u.under) return { ok: false, reason: "河格最多压住一枚棋子。" };
      if (u.c === pl.c) return { ok: false, reason: "河格只能压住敌方棋子。" };
      if (!riverOk(u.t)) return { ok: false, reason: "只有龙和象能进河。" };
      if (u.rv === false) return { ok: false, reason: "河里和岸上的棋子不能是暗棋。" };
      if (seen[u.c][u.t]){
        return { ok: false, reason: colorName(u.c) + NUM[u.t] + NAME[u.t] + "已经摆过了。" };
      }
      seen[u.c][u.t] = true;
      if (u.c === "r") r++; else b++;
    }
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
    const pl = placements[k];
    if (pl.c === "r") r++; else b++;
    if (pl.under){
      if (pl.under.c === "r") r++; else b++;
    }
  }
  return {
    ok: true,
    reason: "可以开始 · " + colorName(ed.first) + "先手 · 红 " + r + " 子 / 黑 " + b + " 子",
    placements: placements,
    first: ed.first
  };
}
