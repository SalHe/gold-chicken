/* 纯规则：全部以 `g` 为参数，读常量，不读模块状态、不碰 DOM。 */
import {
  W, H, N, DRAGON, ELEPHANT, LEOPARD, ROOSTER, NAME, NUM, VAL, DIRS
} from "./constants.js";

export function xy(i){ return { x: i % W + 1, y: (i / W | 0) + 1 }; }
export function id(x, y){ return (y - 1) * W + (x - 1); }
export function terrain(x, y){ return y === 4 ? ((x === 1 || x === 4) ? "bank" : "river") : "land"; }
export function isBank(i){ const c = xy(i); return terrain(c.x, c.y) === "bank"; }
export function isRiver(i){ const c = xy(i); return terrain(c.x, c.y) === "river"; }
/* 是否紧挨着「河」——上下左右任一边邻着河格，即算河口 */
export function touchesRiver(i){
  const c = xy(i);
  for (let d = 0; d < 4; d++){
    const nx = c.x + DIRS[d][0], ny = c.y + DIRS[d][1];
    if (nx < 1 || nx > W || ny < 1 || ny > H) continue;
    if (isRiver(id(nx, ny))) return true;
  }
  return false;
}
export function pname(p){ return NUM[p.t] + NAME[p.t]; }
export function posName(i){ const c = xy(i); return "(" + c.x + "," + c.y + ")"; }
/* 只含公开信息的局面键：暗子的颜色与身份都不可见，一律记为「?」。
   用于重复局面检测，不会泄露任何暗棋信息。 */
export function positionKey(g){
  const parts = [];
  for (let i = 0; i < N; i++){
    const p = g.board[i];
    if (!p){ parts.push("."); continue; }
    parts.push(p.rv
      ? p.c + p.t + (p.under ? "/" + p.under.c + p.under.t : "")
      : "?");
  }
  return g.turn + "|" + parts.join(",");
}
export function shuffle(a){ for (let i = a.length - 1; i > 0; i--){ const j = Math.random() * (i + 1) | 0; const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

export function blockadeColor(g){
  const a = g.board[id(1, 4)], b = g.board[id(4, 4)];
  if (a && b && a.rv && b.rv && a.c === b.c) return a.c;
  return null;
}
export function isImmune(g, p, i){
  if (!p || !p.rv) return false;
  const bl = blockadeColor(g);
  return bl !== null && bl === p.c && isBank(i) && (i === id(1, 4) || i === id(4, 4));
}
/* 甲能否吃乙：靠前的吃靠后的，同阶可互吃（邀兑） */
export function canEat(a, d){
  if (a.t === DRAGON && d.t === ROOSTER) return false;
  if (a.t === ROOSTER && d.t === DRAGON) return true;
  return a.t <= d.t;
}
/* 落点判定 */
export function landCheck(g, p, ti){
  const q = g.board[ti];
  if (!q) return { ok: true, kind: "move" };
  if (!q.rv) return { ok: false };
  if (isImmune(g, q, ti)) return { ok: false };
  if (!canEat(p, q)) return { ok: false };
  return { ok: true, kind: q.c === p.c ? "self" : "capture" };
}
export function crossesRiver(fromY, toY){
  return (fromY < 4 && toY > 4) || (fromY > 4 && toY < 4);
}
/* 河格落点：河是「压」不是「吃」。
   - 空格：正常走入
   - 敌子：不论大小，压在其上（河里不兑子，也不吃子）
   - 己方子（无论明面还是被压在下面）：占不得，也不能自残河中的棋子 */
export function riverCheck(g, p, ti){
  const q = g.board[ti];
  if (!q) return { ok: true, kind: "move" };
  if (!q.rv) return { ok: false };
  if (q.c === p.c) return { ok: false };
  if (q.under && q.under.c === p.c) return { ok: false };
  return { ok: true, kind: "press" };
}
/* 某枚棋子的全部合法着法 */
export function movesFor(g, i){
  const p = g.board[i];
  if (!p || !p.rv) return [];
  const out = [], c = xy(i);
  let k, nx, ny, ni, lc, ct;
  const inRiver = isRiver(i);
  const bl = blockadeColor(g);

  /* 河里的棋子被敌方堵岸封死：两岸都落在敌人手里，河水进出口全堵上，动弹不得 */
  if (inRiver && bl !== null && bl !== p.c) return [];

  if (p.t === ROOSTER){                       /* 金鸡：任意飞行 */
    const restrict = bl !== null && bl !== p.c;
    for (k = 0; k < N; k++){
      if (k === i) continue;
      if (isRiver(k)) continue;               /* 落点不能是河 */
      const tc = xy(k);
      if (restrict && crossesRiver(c.y, tc.y)) continue;
      lc = landCheck(g, p, k);
      if (lc.ok) out.push({ from: i, to: k, kind: lc.kind });
    }
    return out;
  }

  /* 河中棋子：河是「口岸」不是通道——出来时朝河边任意方向出水，
     两个岸都能上，紧挨着河的 4 格陆地也都能走，共 6 个出口，
     与它此刻待在哪一格河无关；唯独不能游进另一格河。 */
  if (inRiver){
    for (k = 0; k < N; k++){
      if (k === i || isRiver(k) || !touchesRiver(k)) continue;
      lc = landCheck(g, p, k);
      if (lc.ok){
        out.push({ from: i, to: k, kind: (p.t === DRAGON && isBank(k)) ? "thirst" : lc.kind });
      }
    }
    return out;
  }

  /* 堵岸时，紧挨河界的陆地豹可以扑进任意一个河格引爆（站在岸上不行）。
     河里有没有棋子都能跳：落点上的棋子会随引爆一并阵亡。
     跳河不算一步走，因此不限于正对的那一格河。 */
  if (p.t === LEOPARD && bl && !isBank(i) && touchesRiver(i)){
    for (k = 0; k < N; k++){
      if (!isRiver(k)) continue;
      out.push({ from: i, to: k, kind: "dive" });
    }
  }

  /* 己方堵岸时，岸上的象可以直接跃入河中，两格河任选（正对的一格由
     下面的四邻循环处理，这里只补另一格），落点照常「压」子。
     象一离开岸，堵岸也随之解除。 */
  if (p.t === ELEPHANT && isBank(i) && bl === p.c){
    for (k = 0; k < N; k++){
      if (!isRiver(k)) continue;
      const bv = xy(k);
      if (Math.abs(bv.x - c.x) + Math.abs(bv.y - c.y) === 1) continue;
      lc = riverCheck(g, p, k);
      if (lc.ok) out.push({ from: i, to: k, kind: lc.kind });
    }
  }

  /* 龙、象可以斜着下河：站在河边的四格陆地上时，两格河都能进。
     正对的那一格由下面的四邻循环处理，这里只补斜角，避免重复着法。 */
  if ((p.t === DRAGON || p.t === ELEPHANT) && !isBank(i) && touchesRiver(i)){
    for (k = 0; k < N; k++){
      if (!isRiver(k)) continue;
      const rv = xy(k);
      if (Math.abs(rv.x - c.x) + Math.abs(rv.y - c.y) === 1) continue;
      lc = riverCheck(g, p, k);
      if (lc.ok) out.push({ from: i, to: k, kind: lc.kind });
    }
  }

  for (k = 0; k < 4; k++){
    nx = c.x + DIRS[k][0]; ny = c.y + DIRS[k][1];
    if (nx < 1 || nx > W || ny < 1 || ny > H) continue;
    ni = id(nx, ny); ct = terrain(nx, ny);

    if (ct === "river"){
      if (p.t === DRAGON || p.t === ELEPHANT){        /* 龙、象可下河；遇到敌子则压住 */
        lc = riverCheck(g, p, ni);
        if (lc.ok) out.push({ from: i, to: ni, kind: lc.kind });
      }
      continue;
    }
    lc = landCheck(g, p, ni);
    if (lc.ok){
      out.push({ from: i, to: ni, kind: (p.t === DRAGON && ct === "bank") ? "thirst" : lc.kind });
    }
  }
  return out;
}
export function allActions(g, pi){
  const col = g.pcolor[pi], out = [];
  let i, p;
  for (i = 0; i < N; i++){
    p = g.board[i];
    if (!p) continue;
    if (!p.rv){ out.push({ kind: "flip", i: i }); continue; }
    if (col && p.c === col){
      const ms = movesFor(g, i);
      for (let j = 0; j < ms.length; j++) out.push(ms[j]);
    }
  }
  return out;
}
export function counts(g){
  let r = 0, b = 0;
  for (let i = 0; i < N; i++){
    const p = g.board[i];
    if (!p) continue;
    if (p.c === "r") r++; else b++;
    /* 被压在河格下面的棋子仍然活着，也要计入 */
    if (p.under){ if (p.under.c === "r") r++; else b++; }
  }
  return { r: r, b: b };
}

/* ---------- 子力比较（堵岸改判用） ----------
   双方同阶棋子一一抵消后，若 A 剩下的每一枚都能在 B 剩下的棋子中
   找到能吃它的「天敌」，就认为 A 的子力较弱。暗棋和被压住的棋子
   都还是活棋，默认一并计入；revealedOnly 供 AI 只用公开信息估值。 */
export function materialWeaker(g, a, b, revealedOnly){
  const ca = new Array(13).fill(0), cb = new Array(13).fill(0);
  let i, p, t, k;
  if (revealedOnly){
    for (i = 0; i < N; i++){
      p = g.board[i];
      if (p && !p.rv) return false;          /* 有暗棋时无法按公开信息判定 */
    }
  }
  const add = function(piece){
    if (!piece) return;
    if (revealedOnly && !piece.rv) return;
    (piece.c === a ? ca : cb)[piece.t]++;
  };
  for (i = 0; i < N; i++){
    p = g.board[i];
    if (!p) continue;
    add(p);
    add(p.under);
  }
  const ra = [], rb = [];
  for (t = 1; t <= 12; t++){
    k = Math.min(ca[t], cb[t]);
    for (i = ca[t] - k; i > 0; i--) ra.push(t);
    for (i = cb[t] - k; i > 0; i--) rb.push(t);
  }
  /* 同阶抵消后 A 不剩子，B 还有子：A 子力更少，算弱 */
  if (!ra.length) return rb.length > 0;
  if (!rb.length) return false;
  for (i = 0; i < ra.length; i++){
    let found = false;
    for (k = 0; k < rb.length; k++){
      if (canEat({ t: rb[k] }, { t: ra[i] })){ found = true; break; }
    }
    if (!found) return false;
  }
  return true;
}
/* 和棋判定成立时仍在堵岸、且堵岸方子力较弱：返回应判负的堵岸方颜色。 */
export function blockadeDrawLoser(g, revealedOnly){
  const bl = blockadeColor(g);
  if (!bl) return null;
  return materialWeaker(g, bl, bl === "r" ? "b" : "r", revealedOnly) ? bl : null;
}

/* ---------- 长捉计数 ----------
   同一枚追子对同一枚目标形成吃子威胁、目标随后自己逃走，记一回合。
   「逃走」指目标走完后不再被同一追子威胁；目标不逃、换追子、换目标、
   任一方翻棋或有一方少于两枚棋子，都会重置。超过 10 回合追方判负。 */
function topAt(g, uid){
  for (let i = 0; i < N; i++){
    const p = g.board[i];
    if (p && p.uid === uid) return { p: p, i: i };
  }
  return null;
}
/* i 上的棋子是否正威胁 uid 这枚棋子（只看已翻开的吃子着法） */
function attacks(g, i, uid){
  const ms = movesFor(g, i);
  for (let k = 0; k < ms.length; k++){
    if (ms[k].kind !== "capture") continue;
    const q = g.board[ms[k].to];
    if (q && q.uid === uid) return true;
  }
  return false;
}
/* 刚移动的棋子威胁到的价值最高的敌子；没有威胁返回 null */
function bestVictim(g, i){
  const ms = movesFor(g, i);
  let best = null;
  for (let k = 0; k < ms.length; k++){
    if (ms[k].kind !== "capture") continue;
    const q = g.board[ms[k].to];
    if (!q) continue;
    if (!best || (VAL[q.t] || 0) > (VAL[best.p.t] || 0)) best = { p: q, i: ms[k].to };
  }
  return best;
}
/* 在 doMove / applyAction 应用完一步之后调用。
   movedUid 是刚移动的棋子；若它已阵亡（邀兑、渴死、引爆），这里找不到。 */
export function updateChase(g, movedUid, moverColor){
  const c = counts(g);
  if (c.r < 2 || c.b < 2){ g.chase = null; return; }
  let ch = g.chase;
  if (ch && ch.rounds > 10) return;          /* 已触发判负，等 checkResult 结算 */
  if (ch){
    const cp = topAt(g, ch.chaserUid), tp = topAt(g, ch.targetUid);
    if (!cp || !tp){ g.chase = null; ch = null; }
  }
  const moved = topAt(g, movedUid);

  if (ch && moverColor === ch.by){
    /* 追方又走了一步：仍由同一追子威胁同一目标才算续追 */
    if (!moved || movedUid !== ch.chaserUid || !attacks(g, moved.i, ch.targetUid)){
      g.chase = null;
    } else {
      ch.pending = true;
      return;
    }
  } else if (ch){
    /* 目标方走棋：必须自己逃走，且走完后不再被同一追子威胁，才记一回合 */
    if (!moved || movedUid !== ch.targetUid || !ch.pending){
      g.chase = null;
    } else {
      const cp2 = topAt(g, ch.chaserUid);
      if (!cp2){
        g.chase = null;                      /* 追子被吃或同归于尽，追逐结束 */
      } else if (attacks(g, cp2.i, ch.targetUid)){
        return;                              /* 仍被威胁：这步不算逃走 */
      } else {
        ch.rounds++;
        ch.pending = false;
        return;
      }
    }
  }

  if (!moved || moved.p.c !== moverColor){ g.chase = null; return; }
  const v = bestVictim(g, moved.i);
  g.chase = v
    ? { by: moverColor, chaserUid: movedUid, targetUid: v.p.uid, rounds: 0, pending: true }
    : null;
}
/* 长捉判负方（同一追子对同一目标超过 10 个追逃回合），未触发返回 null。 */
export function chaseLoss(g){
  return g.chase && g.chase.rounds > 10 ? g.chase.by : null;
}

export function kill(g, i, reason){
  const p = g.board[i];
  if (!p) return null;
  g.caps[p.c].push(p.t);
  g.board[i] = null;
  return p;
}
export function applyMove(g, a){
  const p = g.board[a.from];
  const q = g.board[a.to];
  const events = [];
  /* 本子若正压着别人，它一离开，底下的棋子就原地复位 */
  const below = p.under || null;

  /* 豹跳河引爆：落点可以是任意河格——河里有没有棋子都能跳。
     落点上的棋子（连同它压着的子）与 Y3–Y5 上的一切一并阵亡，
     豹自己也在其中。 */
  if (a.kind === "dive"){
    const lost = [];
    const occ = g.board[a.to], occUnder = occ && occ.under;
    p.under = null;
    g.board[a.from] = below;
    g.board[a.to] = p;
    if (occ){
      g.caps[occ.c].push(occ.t);
      lost.push({ p: occ, at: a.to });
      if (occUnder){                    /* 落点河格下面压着的子也要算上 */
        g.caps[occUnder.c].push(occUnder.t);
        lost.push({ p: occUnder, at: a.to });
      }
    }
    for (let i = 0; i < N; i++){
      const c = xy(i);
      if (c.y < 3 || c.y > 5) continue;
      const top = g.board[i];
      if (!top) continue;
      lost.push({ p: kill(g, i), at: i });
      if (top.under){                     /* 压在河格下面的棋子同样被炸死 */
        const u = top.under;
        top.under = null;
        g.caps[u.c].push(u.t);
        lost.push({ p: u, at: i });
      }
    }
    events.push({ type: "boom", at: a.to, lost: lost });
    return events;
  }

  if (a.kind === "press"){
    p.under = q;
    g.board[a.from] = below;
    g.board[a.to] = p;
    events.push({ type: "press", p: q, at: a.to });
    return events;
  }

  if (q){
    g.caps[q.c].push(q.t);
    events.push({ type: "eat", p: q, self: q.c === p.c, at: a.to });
  }
  p.under = null;
  g.board[a.from] = below;
  g.board[a.to] = p;

  /* 同子邀兑：同归于尽，吃子方也一并阵亡 */
  if (q && q.t === p.t){
    g.caps[p.c].push(p.t);
    g.board[a.to] = null;
    events.push({ type: "trade", p: p, at: a.to });
  }

  if (a.kind === "thirst"){
    const dead = kill(g, a.to, "thirst");
    events.push({ type: "thirst", p: dead, at: a.to });
  }
  return events;
}

export function deadPosition(g){
  let i, j, p, q;
  for (i = 0; i < N; i++){
    p = g.board[i];
    if (!p) continue;
    if (!p.rv) return false;              /* 还有暗棋，未定 */
    if (p.under) return false;            /* 还有被压住的子，松开后可能再生变数 */
  }
  /* 豹还能引爆则不算死局 */
  if (blockadeColor(g)){
    for (i = 0; i < N; i++){
      p = g.board[i];
      if (p && p.rv && p.t === LEOPARD){
        const ms = movesFor(g, i);
        for (j = 0; j < ms.length; j++) if (ms[j].kind === "dive") return false;
      }
    }
  }
  for (i = 0; i < N; i++){
    p = g.board[i];
    if (!p || p.c !== "r") continue;
    for (j = 0; j < N; j++){
      q = g.board[j];
      if (!q || q.c !== "b") continue;
      if (canEat(p, q) || canEat(q, p)) return false;
    }
  }
  return true;
}
