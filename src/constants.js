/* 纯常量：棋盘尺寸、棋子身份、吃子价值、方向、对战模式。零依赖。 */

export const W = 4, H = 7, N = W * H;

export const DRAGON = 1, ELEPHANT = 4, LEOPARD = 6, ROOSTER = 12;

export const NAME = [null, "龙", "麒麟", "狮", "象", "虎", "豹", "狼", "狗", "狸", "猫", "鼠", "金鸡"];
export const NUM  = [null, "一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"];
export const VAL  = [0, 100, 70, 55, 45, 38, 30, 22, 16, 11, 7, 4, 26];

export const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export const MODE = { PVP: "pvp", AI: "ai" };
