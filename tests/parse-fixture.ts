import { readFile } from "node:fs/promises";
import { parseMovie } from "../src/parser.js";

const html = await readFile(new URL("../tests/fixtures/sample.html", import.meta.url), "utf8");
const info = parseMovie(html, "https://french-stream.one/film/dune-2");
console.log(JSON.stringify(info, null, 2));
