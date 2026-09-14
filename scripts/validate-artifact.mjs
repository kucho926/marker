import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
const manifest = JSON.parse(await readFile("dist/.openai/hosting.json", "utf8"));
const worker = await import(pathToFileURL(new URL("../dist/server/index.js", import.meta.url).pathname));
assert.equal(typeof worker.default?.fetch, "function");
assert.equal(manifest.d1, "DB");
console.log("Worker artifact valid");
