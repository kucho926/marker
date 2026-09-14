import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../worker/page.js", import.meta.url), "utf8");
const startMarker = "export default `";
const endMarker = "`;";
const start = source.indexOf(startMarker) + startMarker.length;
const end = source.indexOf(endMarker, start);

if (start < startMarker.length || end < 0) {
  throw new Error("Could not find embedded page");
}

const apiBase = "https://baro-grade.hrs251714.chatgpt.site";
const html = source
  .slice(start, end)
  .replace('const API_BASE="";', `const API_BASE=${JSON.stringify(apiBase)};`);

process.stdout.write(html);
