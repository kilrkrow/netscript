#!/usr/bin/env node
/**
 * NetScript CLI (v0.1).
 *
 *   netscript <file.net> [--theme blueprint] [--view traffic] [--projection iso] [-o out.svg]
 *   netscript --example three-rack --theme clean -o out.svg
 *   netscript mcp                                    # start MCP server (stdio)
 *
 * Pass a `.net` file to render an authored diagram, or `--example` for a
 * bundled model. Theme precedence: --theme flag > frontmatter `theme:` > clean.
 *
 * `--view` picks WHAT is drawn (`topology` default, or `traffic` for the L4
 * flow view); `--projection` picks HOW (`flat` default, or `iso`). They are
 * independent — every combination is valid.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseNet } from "./parser.ts";
import { renderView, type View, type Projection } from "./views.ts";
import { threeRack, homelabLogical } from "./examples.ts";
import type { NetModel } from "./model.ts";

const argv = process.argv.slice(2);

if (argv[0] === "mcp") {
  // Delegate to the MCP server entry point (dynamic import keeps the MCP SDK
  // out of the critical path for plain render invocations).
  await import("./mcp-server.ts");
} else {
  main();
}

function main(): void {
  const arg = (flag: string, def?: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
  };

  const file = argv.find((a) => a.endsWith(".net"));
  const example = arg("--example");
  const outFile = arg("-o", arg("--out", "netscript.svg"))!;
  const view = arg("--view", "topology") as View;
  const projection = arg("--projection", "flat") as Projection;

  let model: NetModel;
  let source: string;
  if (file) {
    model = parseNet(readFileSync(file, "utf8"));
    source = file;
  } else {
    const models: Record<string, NetModel> = { "three-rack": threeRack, "homelab-logical": homelabLogical };
    const key = example ?? "three-rack";
    if (!models[key]) {
      console.error(`netscript: unknown example "${key}" (have: ${Object.keys(models).join(", ")})`);
      process.exit(1);
    }
    model = models[key];
    source = `example:${key}`;
  }

  const theme = arg("--theme") ?? model.theme ?? "clean";
  let svg: string;
  try {
    svg = renderView(model, { theme, view, projection });
  } catch (err) {
    console.error(`netscript: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
    return;
  }
  writeFileSync(outFile, svg);
  const tally = view === "traffic"
    ? `${model.devices.length} nodes / ${model.flows!.length} flows`
    : `${model.devices.length} nodes / ${model.links.length} links`;
  console.error(`netscript: rendered ${source} [${theme} · ${view} · ${projection}] → ${outFile} · ${tally}`);
}
