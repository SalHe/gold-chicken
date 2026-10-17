/* 对战模式：人机先手与 AI 对弈的轮次判定。无 DOM。 */
import { describe, it, expect } from "vitest";
import * as state from "../src/state.js";

describe("对战模式", () => {
  it("双人对弈没有电脑回合", () => {
    state.newGame();
    state.setMode("pvp");
    expect(state.isAITurn()).toBe(false);
    state.getGame().turn = 1;
    expect(state.isAITurn()).toBe(false);
  });

  it("人机对弈：默认人执先手", () => {
    state.setMode("ai");
    state.setAiFirst(false);
    state.newGame();
    expect(state.getGame().turn).toBe(0);
    expect(state.isAITurn()).toBe(false);
    state.getGame().turn = 1;
    expect(state.isAITurn()).toBe(true);
  });

  it("人机对弈：可选电脑先手", () => {
    state.setMode("ai");
    state.setAiFirst(true);
    state.newGame();
    expect(state.isAITurn()).toBe(true);
    state.getGame().turn = 1;
    expect(state.isAITurn()).toBe(false);
    state.setAiFirst(false);
  });

  it("AI 对弈：两边都由电脑走", () => {
    state.setMode("aiai");
    state.setAiFirst(false);
    state.newGame();
    expect(state.isAITurn()).toBe(true);
    state.getGame().turn = 1;
    expect(state.isAITurn()).toBe(true);
  });

  it("AI 对弈可以暂停单步，开新局自动恢复连走", () => {
    state.setMode("aiai");
    state.newGame();
    expect(state.getAiPaused()).toBe(false);
    state.setAiPaused(true);
    expect(state.getAiPaused()).toBe(true);
    state.newGame();
    expect(state.getAiPaused()).toBe(false);
    state.setMode("pvp");
  });

  it("终局后不再调度电脑", () => {
    state.setMode("aiai");
    state.getGame().result = { kind: "draw", why: "测试" };
    expect(state.isAITurn()).toBe(false);
    state.setMode("pvp");
  });
});
