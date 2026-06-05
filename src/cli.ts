#!/usr/bin/env node
/**
 * NetScript CLI (v0.1).
 *
 *   netscript --example three-rack --theme blueprint -o diagram.svg
 *
 * v0.1 renders the bundled example model. The `.net` text DSL parser is the
 * next milestone; once it lands, a positional <file.net> argument will load a
 * model from disk.
 */
import { writeFileSync } from "node:fs";
import { renderModel } from "./render.ts";
import { threeRack } from "./examples.ts";

const argv = process.argv;
const arg = (flag: string, def?: string): string | undefined => {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
};

const theme = arg("--theme", "clean")!;
const outFile = arg("-o", arg("--out", "netscript.svg"))!;
const example = arg("--example", "three-rack")!;

const models: Record<string, typeof threeRack> = { "three-rack": threeRack };
const model = models[example];
if (!model) {
  console.error(`netscript: unknown example "${example}" (have: ${Object.keys(models).join(", ")})`);
  process.exit(1);
}

const svg = renderModel(model, theme);
writeFileSync(outFile, svg);
console.error(`netscript: rendered ${example} [${theme}] → ${outFile} · ${model.devices.length} nodes / ${model.links.length} links`);
