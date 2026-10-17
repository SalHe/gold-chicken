import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";

const css = readFileSync("src/styles.css", "utf8");
const tmpl = readFileSync("src/template.html", "utf8");
const r = await build({
  entryPoints: ["src/main.js"],
  bundle: true,
  format: "iife",
  minify: false,
  write: false
});
let js = r.outputFiles[0].text;
js = js.replace(/<\/script>/gi, "<\\/script>");   // 防止内联 JS 里的字符串提前闭合 <script>
js = '"use strict";\n' + js;                        // 与旧单文件的严格模式语义一致
writeFileSync("index.html",
  tmpl.replace("/*__CSS__*/", () => css).replace("/*__JS__*/", () => js));  // 函数替换，$ 不会被当正则替换组
