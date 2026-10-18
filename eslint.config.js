import globals from "globals";

/* 只启用与现有代码一致的规则：格式交给约定，这里负责变量、相等与常见错误。
   不引入 eslint:recommended——它的 no-empty 会误报项目里有意留空的 catch(e){}。 */
const rules = {
  "no-var": "error",
  "prefer-const": ["error", { destructuring: "any", ignoreReadBeforeAssign: false }],
  eqeqeq: ["error", "smart"],              /* 允许 v == null 这种判空写法 */

  "no-redeclare": "error",
  "no-const-assign": "error",
  "no-undef": "error",
  "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }],
  "no-irregular-whitespace": "error",
  "no-unreachable": "error",
  "no-dupe-args": "error",
  "no-dupe-keys": "error",
  "no-func-assign": "error",
  "no-obj-calls": "error",
  "no-sparse-arrays": "error",
  "no-unsafe-negation": "error",
  "use-isnan": "error",
  "valid-typeof": "error",

  /* 现有代码的排版：双引号、分号。ESLint 11 会移除这两条格式规则，
     届时删除即可，STYLE.md 仍是约定来源。 */
  quotes: ["error", "double", { avoidEscape: true, allowTemplateLiterals: true }],
  semi: ["error", "always"]
};

export default [
  { ignores: ["node_modules/**", "index.html", "dist/**", "assets/**", "src/art/**", ".claude/**"] },
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.es2021 }
    },
    rules
  },
  {
    files: ["test/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      /* DOM 桩会挂 globalThis.document，个别用例直接用裸 document */
      globals: { ...globals.node, ...globals.browser, ...globals.vitest, ...globals.es2021 }
    },
    rules
  },
  {
    files: ["build.mjs", "vitest.config.js", "eslint.config.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node, ...globals.es2021 }
    },
    rules
  }
];
