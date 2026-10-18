/* 编辑器弹层的渲染与点击流（DOM 桩）。 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import * as state from "../src/state.js";
import * as ui from "../src/ui.js";
import { installDomStub } from "./helpers/dom-stub.js";
import { mk, xy2i } from "./helpers/factory.js";

const el = id => globalThis.document.getElementById(id);
const cell = i => el("edGrid").children[i];
const palette = function(c, t){
  const box = c === "r" ? el("edRed") : el("edBlack");
  return box.children.find(function(b){
    return b.dataset.c === c && b.dataset.t === String(t);
  });
};

beforeAll(() => {
  installDomStub();
  ui.initUi();
  ui.buildGrid();
  state.setChanged(function(reset){ if (reset) ui.clearPieceCache(); ui.render(); });
});

beforeEach(() => {
  ui.closeEditor();
  ui.setPieceFace("text");
  state.setMode("pvp");
});

describe("编辑器渲染", () => {
  it("打开后 28 个格子、24 枚棋子按钮，未摆棋不能开始", () => {
    ui.openEditor();
    expect(el("editor").hidden).toBe(false);
    expect(ui.isEditorOpen()).toBe(true);
    expect(el("edGrid").children.length).toBe(28);
    expect(el("edRed").children.length).toBe(12);
    expect(el("edBlack").children.length).toBe(12);
    expect(el("edStart").disabled).toBe(true);
    expect(el("edReason").textContent).toContain("红方至少");
    expect(el("edReason").classList.contains("ok")).toBe(false);
  });

  it("选中棋子后点格子生成预览；暗棋保留正面并带「暗」角标", () => {
    ui.openEditor();
    palette("r", 5).click();
    expect(palette("r", 5).classList.contains("sel")).toBe(true);
    cell(xy2i(1, 4)).click();          /* 岸格也能落子 */

    const ed = ui.getEditorState();
    expect(ed.cells[xy2i(1, 4)]).toEqual({ t: 5, c: "r", rv: false });
    expect(ed.sel).toBe(null);
    const pieces = el("edPieces").children;
    expect(pieces.length).toBe(1);
    expect(pieces[0].classList.contains("ed-hidden")).toBe(true);
    expect(pieces[0].classList.contains("hidden")).toBe(false);
    expect(pieces[0].children.some(x => x.className === "ed-hide-tag")).toBe(true);
    expect(palette("r", 5).disabled).toBe(true);
    expect(palette("r", 5).classList.contains("used")).toBe(true);
  });

  it("没有选择时点已有棋子即移除；有选择时点已有棋子即替换", () => {
    ui.openEditor();
    palette("r", 5).click();
    cell(0).click();
    palette("r", 6).click();
    cell(0).click();                   /* 替换 */
    let ed = ui.getEditorState();
    expect(ed.cells[0]).toEqual({ t: 6, c: "r", rv: false });
    expect(palette("r", 5).disabled).toBe(false);
    expect(palette("r", 6).disabled).toBe(true);

    cell(0).click();                   /* 未选择 → 移除 */
    ed = ui.getEditorState();
    expect(ed.cells[0]).toBe(null);
    expect(el("edPieces").children.length).toBe(0);
  });

  it("再次点调色板同一枚取消选择", () => {
    ui.openEditor();
    palette("b", 3).click();
    palette("b", 3).click();
    expect(ui.getEditorState().sel).toBe(null);
    expect(palette("b", 3).classList.contains("sel")).toBe(false);
  });

  it("明暗切换只影响之后落下的棋子", () => {
    ui.openEditor();
    palette("r", 5).click();
    cell(0).click();
    ui.setEditorHidden(false);
    palette("b", 6).click();
    cell(27).click();
    const ed = ui.getEditorState();
    expect(ed.cells[0].rv).toBe(false);
    expect(ed.cells[27].rv).toBe(true);
    ui.setEditorHidden(true);
    expect(ed.cells[27].rv).toBe(true);
  });

  it("双方各摆一枚后可以开始；清空后重新禁用", () => {
    ui.openEditor();
    palette("r", 5).click();
    cell(0).click();
    expect(el("edStart").disabled).toBe(true);
    expect(el("edReason").textContent).toContain("黑方至少");

    palette("b", 6).click();
    cell(27).click();
    expect(el("edStart").disabled).toBe(false);
    expect(el("edReason").textContent).toContain("可以开始");
    expect(el("edReason").classList.contains("ok")).toBe(true);

    ui.clearEditor();
    expect(ui.getEditorState().cells.filter(Boolean).length).toBe(0);
    expect(el("edStart").disabled).toBe(true);
  });

  it("先手选择进入校验结果", () => {
    ui.openEditor();
    ui.setEditorFirst("b");
    expect(ui.editorStatus().first).toBe("b");
    expect(ui.getEditorState().first).toBe("b");
    ui.setEditorFirst("r");
    expect(ui.editorStatus().first).toBe("r");
  });
});

describe("编辑器不影响当前对局", () => {
  it("取消后对局快照不变，重新打开是空草稿", () => {
    state.setGame(mk([[xy2i(1, 1), 5]], [[xy2i(4, 7), 6]]));
    const before = state.snapshot();

    ui.openEditor();
    palette("r", 7).click();
    cell(xy2i(2, 2)).click();
    expect(ui.getEditorState().cells.filter(Boolean).length).toBe(1);
    ui.closeEditor();

    expect(ui.isEditorOpen()).toBe(false);
    expect(el("editor").hidden).toBe(true);
    expect(state.snapshot()).toBe(before);

    ui.openEditor();
    expect(ui.getEditorState().cells.filter(Boolean).length).toBe(0);
    expect(el("edPieces").children.length).toBe(0);
    expect(el("edStart").disabled).toBe(true);
  });

  it("棋子样式设置同步到编辑器预览", () => {
    ui.openEditor();
    ui.setPieceFace("icon");
    expect(el("edPieces").dataset.face).toBe("icon");
    ui.setPieceFace("art");
    expect(el("edPieces").dataset.face).toBe("art");
    ui.setPieceFace("bogus");
    expect(el("edPieces").dataset.face).toBe("text");
  });
});
