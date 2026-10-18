# 代码风格

本文件是 `gold-chicken` 的代码风格约定，覆盖 `src/`、`test/`、`build.mjs`、`vitest.config.js` 与 `eslint.config.js`。约定由 `npm run lint`（ESLint）机械检查；两者冲突时以 `eslint.config.js` 为准，并同步修改本文件。

## 语言与依赖

- 全部源码使用 ES 模块（`import` / `export`），由 esbuild 打成单文件经典脚本。
- 浏览器代码按 ES2020+ 编写；Node 工具脚本（`build.mjs`）可用 ES2022（顶层 `await`）。
- **运行时零依赖**：`src/` 不得 `import` 任何第三方包。构建与测试依赖只放 `devDependencies`。

## 变量

- 默认用 `const`；只有需要重新赋值时才用 `let`；**禁止 `var`**。
- 循环计数器用 `let`；`for...in` / `for...of` 中不重新赋值的绑定用 `const`。
- 对象的属性修改不影响 `const`（`const obj = {}; obj.x = 1;` 合法）。
- 先声明、稍后在 `try` 或回调里赋值的变量保留 `let`。
- 一条语句尽量只声明一组同类变量；混合场景拆开：

  ```js
  const out = [];
  let i, p;
  ```

## 相等与真值

- 一律使用 `===` / `!==`。
- 唯一例外是同时判断 `null` 与 `undefined`：允许 `x == null` / `x != null`。

## 排版

- 缩进 2 个空格；LF 换行；不允许 Tab 和行尾空白。
- 每条语句以分号结尾。
- 字符串默认双引号；字符串内部含 `"` 时（典型是 HTML 片段）可用单引号，避免转义。
- 关键字与括号之间留一个空格：`if (`、`for (`、`while (`、`switch (`。
- 左花括号紧跟右括号，不再加空格：`function f(){`、`if (x){`、`try{`、`catch(e){`。
- `else` / `else if` 与前一个 `}` 同行：`} else {`、`} else if (...){`。
- 软性上限 120 列；长 HTML 拼接、长字符串和表格型数据可以超出。
- 多行对象、数组字面量保留尾逗号。

## 字符串

- 现有代码以 `+` 拼接为主，不强制改写。
- 新代码在需要 2 个以上插值或多行文本时，优先使用模板字符串。
- 构造 HTML 时沿用现有拼接方式即可，注意所有插入文本先经过转义（见 `ui.js` 的 `esc`）。

## 函数

- `src/` 使用函数声明或函数表达式，不使用箭头函数；测试和短回调可以使用箭头函数。
- 短小的一次性辅助函数允许写成一行：`function pad2(n){ return ...; }`。
- 不要用 `var self = this` 之类的别名；本项目基本不使用 `this`。

## 模块与导出

- 只用具名导出，不使用默认导出。
- 本地模块导入必须带 `.js` 扩展名。
- 保持分层：
  - `rules.js` / `ai.js`：纯函数，不碰 DOM、不读写模块状态。
  - `state.js`：唯一持有活棋状态与回合流转。
  - `ui.js`：DOM 渲染与交互。
  - `main.js`：装配、事件绑定与启动。

## 命名

- 变量、函数用 camelCase；模块级常量用 UPPER_SNAKE_CASE。
- 测试与既有短名（`g`、`i`、`ui`、`ev`、`p`）可以沿用，不必为了长度改名。
- DOM id 用 camelCase（如 `btnRules`、`bannerTxt`）。

## 注释

- 注释用中文，解释「为什么」而不是复述代码。
- 分节使用 `/* ---------- 标题 ---------- */`。
- 不保留注释掉的旧代码；需要时查 git 历史。

## 测试

- 使用 Vitest，文件放在 `test/`，命名 `*.test.js`。
- `describe` / `it` 用中文描述行为。
- 公共摆局与 DOM 桩放在 `test/helpers/`。
- 纯规则测试不依赖 DOM；涉及渲染的用例显式 `installDomStub()`。

## 提交前

```sh
npm run lint     # 0 error / 0 warning
npm test         # 全部通过
npm run build    # 产物可构建
```

机械性修正可直接运行 `npm run lint:fix`，但提交前仍需人工过一遍 diff。
