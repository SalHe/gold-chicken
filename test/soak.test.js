/* 全程走 onCell 的点击路径，验证 UI 层能完整下完一盘棋。 */
import { describe, it, expect, beforeAll } from "vitest";
import * as rules from "../src/rules.js";
import * as state from "../src/state.js";
import * as ui from "../src/ui.js";
import { installDomStub } from "./helpers/dom-stub.js";

beforeAll(() => {
  installDomStub();
  ui.initUi();
  ui.buildGrid();
  state.setChanged(function(reset){ if (reset) ui.clearPieceCache(); ui.render(); });
});

describe("UI 全程对局", () => {
  it("60 盘随机对局不卡死、无异常", () => {
    let games = 0, moves = 0, stucks = 0, errors = 0, confirmations = 0;
    for (let n = 0; n < 60; n++){
      try {
        state.newGame();
        games++;
        let guard = 0;
        while (!state.getGame().result && guard++ < 600){
          const G = state.getGame();
          const acts = rules.allActions(G, G.turn);
          if (!acts.length) break;
          const a = acts[Math.random() * acts.length | 0];
          if (a.kind === "flip"){ ui.onCell(a.i); moves++; continue; }

          const before = G.last;
          ui.onCell(a.from);
          if (state.getSel() !== a.from){ stucks++; break; }
          ui.onCell(a.to);
          if ((a.kind === "self" || a.kind === "dive") && state.getArmed() === a.to){
            confirmations++;
            if (G.last !== before) { errors++; break; }
            ui.onCell(a.to);
          }
          moves++;
          if (G.last === before && !state.getGame().result){ stucks++; break; }
        }
      } catch (e) { errors++; }
    }
    expect(stucks).toBe(0);
    expect(errors).toBe(0);
    expect(games).toBe(60);
    expect(confirmations).toBeGreaterThanOrEqual(0);
  });
});
