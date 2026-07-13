import { existsSync, readFileSync } from "node:fs";
import { openStore } from "../store.mjs";
import { parseArgs } from "../args.mjs";
import { validateState, livenessWarnings } from "../validate.mjs";
import { renderMarkdown } from "../render.mjs";

export function run(argv) {
  const { flags } = parseArgs(argv, ["strict"]);
  const store = openStore();

  const errors = validateState(store.state, store);

  const path = store.markdownPath();
  const rendered = renderMarkdown(store.state, store.config);
  const onDisk = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (onDisk !== rendered) {
    errors.push(`${store.config.markdown} is out of date or hand-edited — run \`goalpost generate\``);
  }

  if (errors.length > 0) {
    for (const e of errors) console.error(`goalpost check: ${e}`);
    return 1;
  }

  const warnings = livenessWarnings(store.state, store.config);
  for (const w of warnings) console.log(`warn: ${w}`);
  if (warnings.length > 0 && flags.strict) {
    console.error(`goalpost check: ${warnings.length} liveness warning(s) with --strict`);
    return 1;
  }
  console.log(`check passed${warnings.length ? ` with ${warnings.length} warning(s)` : ""}`);
  return 0;
}
