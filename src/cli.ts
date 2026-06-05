#!/usr/bin/env node
/**
 * NetScript CLI (v0.1).
 *
 *   netscript <file.net> [--theme blueprint] [-o out.svg]
 *   netscript --example three-rack --theme clean -o out.svg
 *
 * Pass a `.net` file to render an authored diagram, or `--example` for a
 * bundled model. Theme precedence: --theme flag > frontmatter `theme:` > clean.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { renderModel } from "./render.ts";
import { parseNet } from "./parser.ts";
import { threeRack } from "./examples.ts";
import type { NetModel } from "./model.ts";

const argv = process.argv.slice(2);
const arg = (flag: string, def?: string): string | undefined => {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
};

const file = argv.find((a) => a.endsWith(".net"));
const example = arg("--example");
const outFile = arg("-o", arg("--out", "netscript.svg"))!;

let model: NetModel;
let source: string;
if (file) {
  model = parseNet(readFileSync(file, "utf8"));
  source = file;
} else {
  const models: Record<string, NetModel> = { "three-rack": threeRack };
  const key = example ?? "three-rack";
  if (!models[key]) {
    console.error(`netscript: unknown example "${key}" (have: ${Object.keys(models).join(", ")})`);
    process.exit(1);
  }
  model = models[key];
  source = `example:${key}`;
}

const theme = arg("--theme") ?? model.theme ?? "clean";
writeFileSync(outFile, renderModel(model, theme));
console.error(`netscript: rendered ${source} [${theme}] → ${outFile} · ${model.devices.length} nodes / ${model.links.length} links`);
