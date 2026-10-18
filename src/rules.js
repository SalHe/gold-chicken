/* 纯规则：全部以 `g` 为参数，读常量，不读模块状态、不碰 DOM。 */
import {
  W, H, N, DRAGON, ELEPHANT, LEOPARD, ROOSTER, NAME, NUM, DIRS
} from "./constants.js";

export function xy(i){ return { x: i % W + 1, y: (i / W | 0) + 1 }; }
export function id(x, y){ return (y - 1) * W + (x - 1); }
export function terrain(x, y){ return y === 4 ? ((x === 1 || x === 4) ? "bank" : "river") : "land"; }
export function isBank(i){ var c = xy(i); return terrain(c.x, c.y) === "bank"; }
export function isRiver(i){ var c = xy(i); return terrain(c.x, c.y) === "river"; }
/* 是否紧挨着「河」——上下左右任一边邻着河格，即算河口 */
export function touchesRiver(i){
  var c = xy(i);
  for (var d = 0; d < 4; d++){
    var nx = c.x + DIRS[d][0], ny = c.y + DIRS[d][1];
    if (nx < 1 || nx > W || ny < 1 || ny > H) continue;
    if (isRiver(id(nx, ny))) return true;
  }
  return false;
}
export function pname(p){ return NUM[p.t] + NAME[p.t]; }
export function posName(i){ var c = xy(i); return "(" + c.x + "," + c.y + ")"; }
/* 只含公开信息的局面键：暗子的颜色与身份都不可见，一律记为「?」。
   用于重复局面检测，不会泄露任何暗棋信息。 */
export function positionKey(g){
  var parts = [];
  for (var i = 0; i < N; i++){
    var p = g.board[i];
    if (!p){ parts.push("."); continue; }
    parts.push(p.rv
      ? p.c + p.t + (p.under ? "/" + p.under.c + p.under.t : "")
      : "?");
  }
  return g.turn + "|" + parts.join(",");
}
export function shuffle(a){ for (var i = a.length - 1; i > 0; i--){ var j = Math.random() * (i + 1) | 0; var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

export function blockadeColor(g){
  var a = g.board[id(1, 4)], b = g.board[id(4, 4)];
  if (a && b && a.rv && b.rv && a.c === b.c) return a.c;
  return null;
}
export function isImmune(g, p, i){
  if (!p || !p.rv) return false;
  var bl = blockadeColor(g);
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
  var q = g.board[ti];
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
  var q = g.board[ti];
  if (!q) return { ok: true, kind: "move" };
  if (!q.rv) return { ok: false };
  if (q.c === p.c) return { ok: false };
  if (q.under && q.under.c === p.c) return { ok: false };
  return { ok: true, kind: "press" };
}
/* 某枚棋子的全部合法着法 */
export function movesFor(g, i){
  var p = g.board[i];
  if (!p || !p.rv) return [];
  var out = [], c = xy(i), k, nx, ny, ni, lc, ct;
  var inRiver = isRiver(i);
  var bl = blockadeColor(g);

  /* 河里的棋子被敌方堵岸封死：两岸都落在敌人手里，河水进出口全堵上，动弹不得 */
  if (inRiver && bl !== null && bl !== p.c) return [];

  if (p.t === ROOSTER){                       /* 金鸡：任意飞行 */
    var restrict = bl !== null && bl !== p.c;
    for (k = 0; k < N; k++){
      if (k === i) continue;
      if (isRiver(k)) continue;               /* 落点不能是河 */
      var tc = xy(k);
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
      var bv = xy(k);
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
      var rv = xy(k);
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
  var col = g.pcolor[pi], out = [], i, p;
  for (i = 0; i < N; i++){
    p = g.board[i];
    if (!p) continue;
    if (!p.rv){ out.push({ kind: "flip", i: i }); continue; }
    if (col && p.c === col){
      var ms = movesFor(g, i);
      for (var j = 0; j < ms.length; j++) out.push(ms[j]);
    }
  }
  return out;
}
export function counts(g){
  var r = 0, b = 0;
  for (var i = 0; i < N; i++){
    var p = g.board[i];
    if (!p) continue;
    if (p.c === "r") r++; else b++;
    /* 被压在河格下面的棋子仍然活着，也要计入 */
    if (p.under){ if (p.under.c === "r") r++; else b++; }
  }
  return { r: r, b: b };
}

export function kill(g, i, reason){
  var p = g.board[i];
  if (!p) return null;
  g.caps[p.c].push(p.t);
  g.board[i] = null;
  return p;
}
export function applyMove(g, a){
  var p = g.board[a.from];
  var q = g.board[a.to];
  var events = [];
  /* 本子若正压着别人，它一离开，底下的棋子就原地复位 */
  var below = p.under || null;

  /* 豹跳河引爆：落点可以是任意河格——河里有没有棋子都能跳。
     落点上的棋子（连同它压着的子）与 Y3–Y5 上的一切一并阵亡，
     豹自己也在其中。 */
  if (a.kind === "dive"){
    var lost = [];
    var occ = g.board[a.to], occUnder = occ && occ.under;
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
    for (var i = 0; i < N; i++){
      var c = xy(i);
      if (c.y < 3 || c.y > 5) continue;
      var top = g.board[i];
      if (!top) continue;
      lost.push({ p: kill(g, i), at: i });
      if (top.under){                     /* 压在河格下面的棋子同样被炸死 */
        var u = top.under;
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
    var dead = kill(g, a.to, "thirst");
    events.push({ type: "thirst", p: dead, at: a.to });
  }
  return events;
}

export function deadPosition(g){
  var i, j, p, q;
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
        var ms = movesFor(g, i);
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
