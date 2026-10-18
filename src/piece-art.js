/* 棋子图案素材。
   由 assets/ 里的 2048×2048 原图生成：先裁掉底部 160px 的水印（左右各去
   80px 保持方形），再按 alpha 裁掉透明边，等比缩进 192×192 方形（四周留
   3% 余量），存成 WebP（quality 88，保留透明通道）。十二张合计约 150KB；
   构建时 esbuild 以 data URI 内联，产物仍是单文件。 */
import dragon from "./art/01-dragon.webp";
import qilin from "./art/02-qilin.webp";
import lion from "./art/03-lion.webp";
import elephant from "./art/04-elephant.webp";
import tiger from "./art/05-tiger.webp";
import leopard from "./art/06-leopard.webp";
import wolf from "./art/07-wolf.webp";
import dog from "./art/08-dog.webp";
import fox from "./art/09-fox.webp";
import cat from "./art/10-cat.webp";
import mouse from "./art/11-mouse.webp";
import rooster from "./art/12-rooster.webp";

var ART = [dragon, qilin, lion, elephant, tiger, leopard, wolf, dog, fox, cat, mouse, rooster];

/* t 为棋子阶数（1 龙 … 12 金鸡）；越界返回空串，不画图案。 */
export function pieceArtSrc(t){
  return t >= 1 && t <= ART.length ? ART[t - 1] : "";
}
