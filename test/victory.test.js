/* 终局告示内容测试 */
import { describe, it, expect, beforeAll } from "vitest";
import * as state from "../src/state.js";
import * as ui from "../src/ui.js";
import { installDomStub } from "./helpers/dom-stub.js";
import { mk, xy2i } from "./helpers/factory.js";

const el = id => globalThis.document.getElementById(id);

beforeAll(() => {
  installDomStub();
  ui.initUi();
  ui.buildGrid();
  state.setChanged(function(reset){ if (reset) ui.clearPieceCache(); ui.render(); });
});

describe("终局告示", () => {
  it("红方吃光对方", () => {
    state.setGame(mk([[xy2i(1, 1), 1]], [], { result: { kind: "win", winner: "r" } }));
    ui.renderVictory();
    expect(el("victory").hidden).toBe(false);
    expect(/win-r/.test(el("victory").className)).toBe(true);
    expect(el("vTitle").textContent).toBe("红方胜");
    expect(el("vBadge").textContent).toBe("胜");
    expect(el("vWhy").textContent).toBe("敌方棋子已被吃光");
  });

  it("黑方困毙取胜，换边摘掉 win-r", () => {
    state.setGame(mk([[xy2i(1, 1), 1]], [[xy2i(4, 7), 1]], { result: { kind: "win", winner: "b", stalemate: true } }));
    ui.renderVictory();
    expect(/win-b/.test(el("victory").className)).toBe(true);
    expect(/win-r/.test(el("victory").className)).toBe(false);
    expect(el("vTitle").textContent).toBe("黑方胜");
    expect(el("vWhy").textContent).toBe("对方无子可走，困毙判负");
  });

  it("和棋不带 win- 类", () => {
    for (const why of ["双方同归于尽", "连续 60 手无吃子", "双方已无法互吃，死局"]){
      state.setGame(mk([[xy2i(1, 1), 1]], [[xy2i(4, 7), 1]], { result: { kind: "draw", why } }));
      ui.renderVictory();
      expect(/win-/.test(el("victory").className)).toBe(false);
      expect(el("vTitle").textContent).toBe("和棋");
      expect(el("vBadge").textContent).toBe("和");
      expect(el("vWhy").textContent).toBe(why);
    }
  });

  it("未终局必须收起", () => {
    state.setGame(mk([[xy2i(1, 1), 1]], [[xy2i(4, 7), 1]]));
    ui.renderVictory();
    expect(el("victory").hidden).toBe(true);
  });

  it("走完一手后自动弹出", () => {
    state.newGame();
    expect(el("victory").hidden).toBe(true);
    state.setGame(mk([[xy2i(1, 1), 1]], [], { result: null }));
    ui.renderVictory();
    expect(el("victory").hidden).toBe(true);
    state.checkResult();          // 黑方没子了 -> 红胜
    ui.render();
    expect(el("victory").hidden).toBe(false);
    expect(el("vTitle").textContent).toBe("红方胜");
  });
});
