/* 邀兑标记 / 行棋记录手数 / 终局悔棋 / 走子播报 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import * as state from "../src/state.js";
import * as ui from "../src/ui.js";
import { movesFor } from "../src/rules.js";
import { pieceArtSrc } from "../src/piece-art.js";
import { installDomStub } from "./helpers/dom-stub.js";
import { mk, xy2i } from "./helpers/factory.js";

const el = id => globalThis.document.getElementById(id);
/* DOM 桩的 innerHTML 置空不会清掉 children，取最后追加的那枚 */
const pieceAt = i => el("pieces").children.filter(x => x.dataset.i === i).at(-1);

beforeAll(() => {
  installDomStub();
  ui.initUi();
  ui.buildGrid();
  state.setChanged(function(reset){ if (reset) ui.clearPieceCache(); ui.render(); });
});
beforeEach(() => { ui.clearPieceCache(); state.setSel(-1); state.setCurMoves([]); });
afterEach(() => { state.setFeedback(null); });

describe("邀兑标记", () => {
  it("同阶敌子显示 trade，而不是普通吃子的 cap", () => {
    const g = mk([[xy2i(1, 1), 5]], [[xy2i(1, 2), 5]]);
    state.setGame(g);
    state.setSel(xy2i(1, 1));
    state.setCurMoves(movesFor(g, xy2i(1, 1)));
    ui.render();
    const t = pieceAt(xy2i(1, 2));
    expect(t.classList.contains("trade")).toBe(true);
    expect(t.classList.contains("cap")).toBe(false);
  });

  it("不同阶敌子仍然是 cap", () => {
    const g = mk([[xy2i(1, 1), 5]], [[xy2i(1, 2), 6]]);
    state.setGame(g);
    state.setSel(xy2i(1, 1));
    state.setCurMoves(movesFor(g, xy2i(1, 1)));
    ui.render();
    const t = pieceAt(xy2i(1, 2));
    expect(t.classList.contains("cap")).toBe(true);
    expect(t.classList.contains("trade")).toBe(false);
  });
});

describe("行棋记录手数", () => {
  it("翻棋与走子都带连续手数", () => {
    const g = mk(
      [[xy2i(1, 1), 5]],
      [[xy2i(2, 1), 10, false], [xy2i(4, 7), 5]],
      { firstFlip: false }
    );
    state.setGame(g);
    state.commit({ kind: "flip", i: xy2i(2, 1) });
    ui.render();
    expect(state.getGame().log.at(-1).no).toBe(1);
    expect(el("log").innerHTML).toContain('<span class="no">1.</span>');

    state.commit({ kind: "move", from: xy2i(1, 1), to: xy2i(1, 2) });
    ui.render();
    expect(state.getGame().log.at(-1).no).toBe(2);
    expect(el("log").innerHTML).toContain('<span class="no">2.</span>');
  });
});

describe("终局悔棋", () => {
  it("有悔棋栈时可用，悔棋后结束告示收起", () => {
    state.setGame(mk([[xy2i(1, 1), 5]], [[xy2i(4, 7), 5]]));
    state.commit({ kind: "move", from: xy2i(1, 1), to: xy2i(1, 2) });
    state.getGame().result = { kind: "win", winner: "r" };
    ui.render();

    expect(el("vUndo").disabled).toBe(false);
    expect(el("victory").hidden).toBe(false);

    state.undo(1);
    ui.render();
    expect(state.getGame().result).toBe(null);
    expect(el("victory").hidden).toBe(true);
  });
});

describe("棋子样式", () => {
  it("可在文字、图案与纯图案之间切换，非法值回落到文字", () => {
    state.setGame(mk([[xy2i(1, 1), 4]], [[xy2i(4, 7), 5]]));
    ui.setPieceFace("icon");
    ui.render();
    expect(el("pieces").dataset.face).toBe("icon");
    const piece = pieceAt(xy2i(1, 1));
    expect(piece.className).toContain("piece");
    expect(piece.innerHTML).toContain('class="art-img"');
    expect(piece.innerHTML).toContain('src="');

    ui.setPieceFace("art");
    ui.render();
    expect(el("pieces").dataset.face).toBe("art");
    expect(pieceAt(xy2i(1, 1)).innerHTML).toContain('class="art-img"');

    ui.setPieceFace("text");
    expect(el("pieces").dataset.face).toBe("text");
    ui.setPieceFace("bogus");
    expect(el("pieces").dataset.face).toBe("text");
  });

  it("十二阶各有一张棋子画，越界不画", () => {
    const seen = new Set();
    for (let t = 1; t <= 12; t++){
      const src = pieceArtSrc(t);
      expect(src.length).toBeGreaterThan(0);
      expect(src).toContain(".webp");
      seen.add(src);
    }
    expect(seen.size).toBe(12);
    expect(pieceArtSrc(0)).toBe("");
    expect(pieceArtSrc(13)).toBe("");
  });
});

describe("走子播报", () => {
  it("吃子会更新播报文本并发出来自状态层的事件", () => {
    const kinds = [];
    state.setFeedback(k => kinds.push(k));
    state.setGame(mk([[xy2i(1, 1), 5]], [[xy2i(1, 2), 6], [xy2i(4, 7), 5]]));
    state.commit({ kind: "move", from: xy2i(1, 1), to: xy2i(1, 2) });
    expect(state.getLastNote()).toContain("吃");
    expect(kinds).toEqual(["capture"]);
  });
});
