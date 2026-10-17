# 金鸡斗兽棋

4×7 河界翻棋斗兽棋的 HTML5 实现。单文件、零运行时依赖，`index.html` 双击即玩。

## 玩法

双方各十二枚棋子（一龙 / 二麒麟 / 三狮 / 四象 / 五虎 / 六豹 / 七狼 / 八狗 / 九狸 / 十猫 / 十一鼠 / 十二金鸡），开局全部盖在棋盘上，先手翻出的颜色即先手方阵营。靠前的吃靠后的，同子相吃同归于尽；龙上岸渴死，只有龙和象能下河，河里不吃子也不兑子——入河时可以把敌方棋子压在下面，被压的子留在原格但不能动，压子一方离开后重新露出。堵岸后豹可下河引爆 Y3–Y5。详细规则见游戏内「规则详解」。

支持双人对弈、人机对弈（可选人先手或电脑先手）与 AI 对弈三种模式。

对局可保存为 Demo（存在浏览器本地，最多 30 局）。回放支持单步前进/后退，点击行棋记录可直接跳到那一手；暂停时还能选择双人、人机或 AI 模式，从当前局面接着下。

## 开发

```sh
npm install      # 安装 esbuild + vitest
npm test         # 运行全部测试
npm run build    # 打包 src/ 到单文件 index.html
npm run test:watch
```

## 目录

```
src/             # 源码（ES 模块）
  constants.js   纯常量
  rules.js       纯规则（不碰 DOM、不碰全局状态）
  ai.js          纯 AI
  state.js       活棋状态 + 回合流转 + 访问器
  ui.js          DOM 渲染 + 点击交互
  main.js        装配/启动（esbuild 入口）
  template.html  页面骨架（含 __CSS__/__JS__ 占位符）
  styles.css     样式
test/            # Vitest 用例（含轻量 DOM 桩）
build.mjs        # esbuild 打包脚本
.github/workflows/deploy.yml   # CI：测试 → 构建 → 发布到 gh-pages
```

`index.html` 是 `npm run build` 的产物，不入版本库。克隆后跑一次构建即可得到可双击游玩的单文件。

## 发布

推送到 `main` 会触发 GitHub Actions：跑测试 → 构建 → 把 `index.html` 以孤立提交强制推送到 `gh-pages` 分支。GitHub Pages 的 Source 设为 **Deploy from a branch → gh-pages → / (root)** 即可。
