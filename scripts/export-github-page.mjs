import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
const startMarker = "const page = `";
const endMarker = "`;\nconst publicApp=";
const start = source.indexOf(startMarker) + startMarker.length;
const end = source.indexOf(endMarker, start);

if (start < startMarker.length || end < 0) {
  throw new Error("Could not find embedded page");
}

const apiBase = "https://baro-grade.hrs251714.chatgpt.site";
const html = source
  .slice(start, end)
  .replace("<script>\nconst $", `<script>\nconst API_BASE=${JSON.stringify(apiBase)};\nconst $`)
  .replaceAll("fetch('/api/", "fetch(API_BASE+'/api/");

process.stdout.write(html);
