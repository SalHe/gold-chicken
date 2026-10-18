/* 棋盘编辑器：纯摆棋模型与开局校验。无 DOM。 */
import { describe, it, expect } from "vitest";
import { N } from "../src/constants.js";
import {
  createEditor, selectRank, isPlaced, placementsOf, placeAt, removeAt,
  clearPlacements, setFirst, setHidden, buildGame, validatePosition, validateEditor
} from "../src/editor.js";
import { xy2i } from "./helpers/factory.js";

function place(ed, c, t, i){
  selectRank(ed, c, t);
  return placeAt(ed, i);
}

describe("摆棋草稿", () => {
  it("新草稿为空，校验不通过", () => {
    const ed = createEditor();
    expect(placementsOf(ed)).toEqual([]);
    expect(ed.first).toBe("r");
    expect(ed.hidden).toBe(true);
    expect(validateEditor(ed).ok).toBe(false);
  });

  it("选中、落子、移除与替换", () => {
    const ed = createEditor();
    expect(selectRank(ed, "r", 5)).toBe(true);
    expect(ed.sel).toEqual({ c: "r", t: 5 });
    expect(placeAt(ed, xy2i(1, 1))).toBe(true);
    expect(ed.sel).toBe(null);
    expect(isPlaced(ed, "r", 5)).toBe(true);
    expect(placementsOf(ed)).toEqual([{ i: xy2i(1, 1), t: 5, c: "r", rv: false }]);

    /* 已摆过的阶数不能再选 */
    expect(selectRank(ed, "r", 5)).toBe(false);

    /* 选中另一枚点同一格 = 替换，旧阶数随之释放 */
    expect(place(ed, "r", 6, xy2i(1, 1))).toBe(true);
    expect(isPlaced(ed, "r", 6)).toBe(true);
    expect(isPlaced(ed, "r", 5)).toBe(false);

    /* 没有选择时点已有棋子即移除；空点无效 */
    expect(removeAt(ed, xy2i(1, 1))).toBe(true);
    expect(removeAt(ed, xy2i(1, 1))).toBe(false);
    expect(placementsOf(ed)).toEqual([]);
  });

  it("再次点同一枚调色板棋子可取消选择；未选择时不能落子", () => {
    const ed = createEditor();
    selectRank(ed, "b", 3);
    selectRank(ed, "b", 3);
    expect(ed.sel).toBe(null);
    expect(placeAt(ed, 0)).toBe(false);
  });

  it("陆地、岸、河共 28 格都能落子", () => {
    for (let i = 0; i < N; i++){
      const ed = createEditor();
      expect(place(ed, "r", 5, i)).toBe(true);
      expect(placementsOf(ed)[0].i).toBe(i);
    }
    const ed = createEditor();
    expect(place(ed, "r", 5, xy2i(1, 4))).toBe(true);   /* 岸 */
    expect(place(ed, "r", 6, xy2i(4, 4))).toBe(true);   /* 岸 */
    expect(place(ed, "r", 1, xy2i(2, 4))).toBe(true);   /* 河 */
    expect(place(ed, "r", 4, xy2i(3, 4))).toBe(true);   /* 河 */
    expect(placementsOf(ed).length).toBe(4);
  });

  it("明暗只影响落子当时：暗棋保留具体身份，明棋 rv:true", () => {
    const ed = createEditor();
    place(ed, "r", 7, 0);
    setHidden(ed, false);
    place(ed, "b", 8, 1);
    const list = placementsOf(ed);
    expect(list[0]).toEqual({ i: 0, t: 7, c: "r", rv: false });
    expect(list[1]).toEqual({ i: 1, t: 8, c: "b", rv: true });
    /* 切换明暗不会改动已经摆好的棋子 */
    setHidden(ed, true);
    expect(placementsOf(ed)[1].rv).toBe(true);
  });

  it("清空棋子但保留先手与明暗选择", () => {
    const ed = createEditor();
    setFirst(ed, "b");
    place(ed, "r", 5, 0);
    selectRank(ed, "r", 6);
    clearPlacements(ed);
    expect(placementsOf(ed)).toEqual([]);
    expect(ed.first).toBe("b");
    expect(ed.sel).toBe(null);
    expect(ed.hidden).toBe(true);
  });
});

describe("开局校验", () => {
  it("最小合法局通过，并给出可展示的状态文案", () => {
    const ed = createEditor();
    place(ed, "r", 5, xy2i(1, 1));
    place(ed, "b", 6, xy2i(4, 7));
    const st = validateEditor(ed);
    expect(st.ok).toBe(true);
    expect(st.reason).toContain("红方先手");
    expect(st.reason).toContain("红 1 子 / 黑 1 子");
    expect(st.placements.length).toBe(2);
  });

  it("缺一方、重复阶数、同格重复都不合法", () => {
    const onlyRed = [{ i: 0, t: 5, c: "r", rv: true }];
    expect(validatePosition(onlyRed, "r").reason).toContain("黑方至少");

    const dupRank = [
      { i: 0, t: 5, c: "r", rv: true },
      { i: 1, t: 5, c: "r", rv: true },
      { i: 27, t: 6, c: "b", rv: true }
    ];
    expect(validatePosition(dupRank, "r").reason).toContain("已经摆过了");

    const dupCell = [
      { i: 0, t: 5, c: "r", rv: true },
      { i: 0, t: 6, c: "b", rv: true }
    ];
    expect(validatePosition(dupCell, "r").reason).toContain("同一格");

    /* 同阶但不同颜色是合法的（双方各有一枚） */
    const sameRank = [
      { i: 0, t: 5, c: "r", rv: true },
      { i: 27, t: 5, c: "b", rv: true }
    ];
    expect(validatePosition(sameRank, "r").ok).toBe(true);
  });

  it("先手无子可动且无暗棋可翻时不合法；有暗棋可翻即可", () => {
    /* 红龙困在河中，黑方明棋占住两岸，红先 */
    const blocked = [
      { i: xy2i(2, 4), t: 1, c: "r", rv: true },
      { i: xy2i(1, 4), t: 5, c: "b", rv: true },
      { i: xy2i(4, 4), t: 6, c: "b", rv: true }
    ];
    expect(validatePosition(blocked, "r").reason).toContain("无子可动");

    const withHidden = blocked.concat([{ i: xy2i(1, 1), t: 9, c: "b", rv: false }]);
    expect(validatePosition(withHidden, "r").ok).toBe(true);
  });

  it("非法先手与非法棋子被拒绝", () => {
    expect(validatePosition([], "x").ok).toBe(false);
    expect(validatePosition([
      { i: 0, t: 13, c: "r", rv: true },
      { i: 27, t: 6, c: "b", rv: true }
    ], "r").ok).toBe(false);
    expect(validatePosition([
      { i: 99, t: 5, c: "r", rv: true },
      { i: 27, t: 6, c: "b", rv: true }
    ], "r").ok).toBe(false);
  });
});

describe("生成游戏对象", () => {
  const list = [
    { i: xy2i(1, 1), t: 5, c: "r", rv: false },
    { i: xy2i(4, 7), t: 6, c: "b", rv: true }
  ];

  it("形状与 newGame 一致，暗棋身份保留", () => {
    const g = buildGame(list, "r", 100);
    expect(g.turn).toBe(0);
    expect(g.pcolor).toEqual(["r", "b"]);
    expect(g.firstFlip).toBe(true);
    expect(g.result).toBe(null);
    expect(g.noCap).toBe(0);
    expect(g.caps).toEqual({ r: [], b: [] });
    expect(g.log).toEqual([]);
    expect(g.board[xy2i(1, 1)]).toEqual({ uid: 101, t: 5, c: "r", rv: false });
    expect(g.board[xy2i(4, 7)]).toEqual({ uid: 102, t: 6, c: "b", rv: true });
    expect(g.board.filter(Boolean).length).toBe(2);
  });

  it("黑方先手时 pcolor 与座位一致", () => {
    const g = buildGame(list, "b", 0);
    expect(g.pcolor).toEqual(["b", "r"]);
    expect(g.turn).toBe(0);
  });
});
