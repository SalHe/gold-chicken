/* 自残/引爆点击流：验证 UI 层真的能走到自残与二次确认。 */
import { describe, it, expect, beforeAll } from "vitest";
import { DRAGON, ELEPHANT, LEOPARD } from "../src/constants.js";
import * as state from "../src/state.js";
import * as ui from "../src/ui.js";
import { installDomStub } from "./helpers/dom-stub.js";
import { mk, xy2i } from "./helpers/factory.js";

beforeAll(() => {
  installDomStub();
  ui.initUi();
  ui.buildGrid();
  state.setChanged(function(reset){ if (reset) ui.clearPieceCache(); ui.render(); });
});

describe("自残/引爆点击流", () => {
  it("大的吃小的自残，两次点击", () => {
    const a = xy2i(1, 1), b2 = xy2i(1, 2);
    state.setGame(mk([[a, DRAGON], [b2, 10]], [[xy2i(3, 7), 3]]));
    state.setSel(-1); state.setArmed(-1);

    ui.onCell(a);
    expect(state.getSel()).toBe(a);
    expect(state.getCurMoves().some(m => m.to === b2 && m.kind === "self")).toBe(true);

    ui.onCell(b2);
    expect(state.getArmed()).toBe(b2);
    expect(state.getGame().board[b2] && state.getGame().board[b2].t).toBe(10);
    expect(state.getGame().board[a] && state.getGame().board[a].t).toBe(DRAGON);

    ui.onCell(b2);
    expect(state.getArmed()).toBe(-1);
    expect(state.getGame().board[b2] && state.getGame().board[b2].t).toBe(DRAGON);
    expect(state.getGame().board[a]).toBeFalsy();
  });

  it("自残后吃子方停在目标格", () => {
    const a = xy2i(1, 1), b2 = xy2i(1, 2);
    state.setGame(mk([[a, DRAGON], [b2, 10]], [[xy2i(3, 7), 3]]));
    state.setSel(-1); state.setArmed(-1);
    ui.onCell(a); ui.onCell(b2); ui.onCell(b2);
    const dest = state.getGame().board[b2];
    expect(dest && dest.t).toBe(DRAGON);
    expect(dest && dest.c).toBe("r");
    expect(state.getGame().caps.r.indexOf(10) >= 0).toBe(true);
  });

  it("同阶自残 = 同归于尽", () => {
    const a = xy2i(1, 1), b2 = xy2i(1, 2);
    state.setGame(mk([[a, 5], [b2, 5]], [[xy2i(3, 7), 3]]));
    state.setSel(-1); state.setArmed(-1);
    ui.onCell(a);
    expect(state.getCurMoves().some(m => m.to === b2 && m.kind === "self")).toBe(true);
    ui.onCell(b2);
    expect(state.getArmed()).toBe(b2);
    ui.onCell(b2);
    expect(!state.getGame().board[a] && !state.getGame().board[b2]).toBe(true);
    expect(state.getGame().caps.r.indexOf(5) >= 0).toBe(true);
  });

  it("点非目标的己方棋子仍是改选，不是自残", () => {
    const a = xy2i(1, 1), far = xy2i(4, 7);
    state.setGame(mk([[a, DRAGON], [far, 10]], [[xy2i(3, 4), 3]]));
    state.setSel(-1); state.setArmed(-1);
    ui.onCell(a);
    expect(state.getSel()).toBe(a);
    expect(state.getCurMoves().some(m => m.to === far)).toBe(false);
    ui.onCell(far);
    expect(state.getSel()).toBe(far);
    expect(state.getArmed()).toBe(-1);
    expect(state.getGame().board[a] && state.getGame().board[a].t).toBe(DRAGON);
  });

  it("弱子不能自残强子", () => {
    const a = xy2i(1, 1), b2 = xy2i(1, 2);
    state.setGame(mk([[a, 10], [b2, DRAGON]], [[xy2i(3, 7), 3]]));
    state.setSel(-1); state.setArmed(-1);
    ui.onCell(a);
    expect(state.getCurMoves().some(m => m.to === b2)).toBe(false);
    ui.onCell(b2);
    expect(state.getSel()).toBe(b2);
    expect(state.getGame().board[a] && state.getGame().board[a].t).toBe(10);
  });

  it("armed 后点非落点格取消，点另一目标改指向", () => {
    const a = xy2i(1, 1), b2 = xy2i(1, 2), empty = xy2i(2, 4);
    state.setGame(mk([[a, DRAGON], [b2, 10]], [[xy2i(3, 7), 3]]));
    state.setSel(-1); state.setArmed(-1);
    ui.onCell(a); ui.onCell(b2);
    expect(state.getArmed()).toBe(b2);
    expect(state.getCurMoves().some(m => m.to === empty)).toBe(false);
    ui.onCell(empty);
    expect(state.getArmed()).toBe(-1);
    expect(state.getSel()).toBe(-1);
    expect(state.getGame().board[a].t).toBe(DRAGON);
    expect(state.getGame().board[b2].t).toBe(10);

    const c = xy2i(2, 1);
    state.getGame().board[c] = { t: 8, c: "r", rv: true, uid: 99 };
    state.setSel(-1); state.setArmed(-1);
    ui.onCell(a); ui.onCell(b2);
    ui.onCell(c);
    expect(state.getArmed()).toBe(c);
    expect(state.getGame().board[b2].t).toBe(10);
    ui.onCell(c);
    expect(state.getGame().board[c].t).toBe(DRAGON);
    expect(state.getGame().board[a]).toBeFalsy();
  });

  it("豹引爆也要二次确认", () => {
    const L = xy2i(1, 4), R = xy2i(4, 4);
    const lp = xy2i(2, 3), river = xy2i(2, 4);
    state.setGame(mk([[lp, LEOPARD], [L, 3], [R, 3], [xy2i(3, 3), 3]], [[xy2i(1, 3), 1]]));
    state.setSel(-1); state.setArmed(-1);
    ui.onCell(lp);
    expect(state.getSel()).toBe(lp);
    const dv = state.getCurMoves().find(m => m.kind === "dive");
    expect(!!dv).toBe(true);

    ui.onCell(river);
    expect(state.getArmed()).toBe(river);
    expect(state.getGame().board[river]).toBe(null);
    expect(state.getGame().board[lp] && state.getGame().board[lp].t).toBe(6);
    expect(state.getGame().board[xy2i(3, 3)].t).toBe(3);

    ui.onCell(river);
    expect(state.getArmed()).toBe(-1);
    expect(state.getGame().board[lp]).toBeFalsy();
    expect(state.getGame().board[xy2i(3, 3)]).toBeFalsy();
    expect(!state.getGame().board[L] && !state.getGame().board[R]).toBe(true);
    expect(state.getGame().board[xy2i(1, 3)]).toBe(null);
    expect(state.getGame().board[xy2i(1, 6)] === undefined || !state.getGame().board[xy2i(1, 6)]).toBe(true);
  });

  it("引爆前点别处可取消", () => {
    const L = xy2i(1, 4), R = xy2i(4, 4);
    const lp = xy2i(2, 3), river = xy2i(2, 4);
    state.setGame(mk([[lp, LEOPARD], [L, 3], [R, 3]], []));
    state.setSel(-1); state.setArmed(-1);
    ui.onCell(lp); ui.onCell(river);
    expect(state.getArmed()).toBe(river);
    ui.onCell(xy2i(1, 1));
    expect(state.getArmed()).toBe(-1);
    expect(state.getGame().board[lp] && state.getGame().board[lp].t).toBe(6);
    expect(state.getGame().board[L] && state.getGame().board[R]).toBeTruthy();
  });
});

describe("AI 对弈单步棋盘操作", () => {
  it("单步暂停时允许玩家走棋，自动对弈时仍拦截棋盘输入", () => {
    const from = xy2i(1, 1), to = xy2i(1, 2);
    state.setMode("aiai");
    state.setAiPaused(true);
    state.setGame(mk([[from, 3]], [[xy2i(4, 7), 3]]));

    ui.onCell(from);
    expect(state.getSel()).toBe(from);
    ui.onCell(to);
    expect(state.getActions().length).toBe(1);
    expect(state.getGame().board[to].c).toBe("r");

    state.setGame(mk([[from, 3]], [[xy2i(4, 7), 3]]));
    state.setAiPaused(false);
    ui.onCell(from);
    expect(state.getSel()).toBe(-1);
    state.setMode("pvp");
    state.setAiPaused(false);
  });
});

describe("压子与行棋记录", () => {
  it("河格压子一次点击即落子，被压的棋子缩成右下角徽记", () => {
    const from = xy2i(2, 3), to = xy2i(2, 4);
    state.setGame(mk([[from, DRAGON]], [[to, ELEPHANT]]));
    state.setSel(-1); state.setArmed(-1);
    ui.clearPieceCache();
    const piecesEl = document.getElementById("pieces");
    const before = piecesEl.children.length;

    ui.onCell(from);
    expect(state.getCurMoves().some(m => m.to === to && m.kind === "press")).toBe(true);
    ui.onCell(to);                       /* 压子不是危险着法，无需二次确认 */

    const G = state.getGame();
    expect(G.board[to] && G.board[to].c).toBe("r");
    expect(G.board[to].under && G.board[to].under.c).toBe("b");
    expect(state.getArmed()).toBe(-1);

    const added = piecesEl.children.slice(before);
    const pressed = added.filter(el => el.classList.contains("pressed"));
    expect(pressed.length).toBe(1);
    expect(pressed[0].dataset.i).toBe(to);
    /* 压在上面的棋子同时让位缩小，两枚棋子的名字都不会被挡住 */
    const pressing = added.filter(el => el.classList.contains("pressing"));
    expect(pressing.length).toBe(1);
    expect(pressing[0].dataset.i).toBe(to);
  });

  it("行棋记录总是滚到最新的一步", () => {
    const lg = document.getElementById("log");
    state.setGame(mk([[xy2i(1, 1), 3]], [[xy2i(4, 7), 3]]));
    lg.scrollHeight = 777;
    lg.scrollTop = 0;
    ui.render();
    expect(lg.scrollTop).toBe(777);
  });
});
