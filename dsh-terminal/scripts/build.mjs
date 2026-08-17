/**
 * 构建 lib/client.js：把 vendor 里的 xterm UMD + CSS 内联进模板。
 * 用法：node scripts/build.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tpl = readFileSync(resolve(root, "lib/client.template.js"), "utf8");
const xterm = readFileSync(resolve(root, "vendor/xterm.js"), "utf8");
const fit = readFileSync(resolve(root, "vendor/xterm-addon-fit.js"), "utf8");
const css = JSON.stringify(readFileSync(resolve(root, "vendor/xterm.css"), "utf8"));

const missing = [];
let out = tpl;
for (const [marker, content] of [
	["/*__XTERM_UMD__*/", xterm],
	["/*__FIT_UMD__*/", fit],
	["/*__XTERM_CSS__*/", css]
]) {
	if (!out.includes(marker)) missing.push(marker);
	else out = out.replace(marker, content);
}
if (missing.length > 0) {
	console.error("build: template missing markers:", missing.join(", "));
	process.exit(1);
}
writeFileSync(resolve(root, "lib/client.js"), out);
console.log(`built lib/client.js (${out.length} bytes)`);
