/* 摆局构造器 + 坐标换算 */
import { N } from "../../src/constants.js";

export const xy2i = (x, y) => (y - 1) * 4 + (x - 1);
export const i2xy = i => ({ x: i % 4 + 1, y: (i / 4 | 0) + 1 });

/* 手工摆局。rv:true 已翻开（默认翻开，第三元组可为 false）。 */
export function mk(reds, blacks, extra){
  const b = new Array(N).fill(null);
  let uid = 0;
  reds.forEach(([i, t, rv]) => b[i] = { t, c: "r", rv: rv !== false, uid: ++uid });
  blacks.forEach(([i, t, rv]) => b[i] = { t, c: "b", rv: rv !== false, uid: ++uid });
  return Object.assign({
    board: b, turn: 0, pcolor: ["r", "b"], caps: { r: [], b: [] },
    log: [], firstFlip: true, noCap: 0, pulse: null, result: null
  }, extra || {});
}
