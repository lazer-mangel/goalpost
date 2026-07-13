import { existsSync, readFileSync } from "node:fs";
import { openStore, fail } from "../store.mjs";
import { parseArgs } from "../args.mjs";
import { renderMarkdown } from "../render.mjs";

export function run(argv) {
  const { flags } = parseArgs(argv, ["check"]);
  const store = openStore();
  const rendered = renderMarkdown(store.state, store.config);
  const path = store.markdownPath();

  if (flags.check) {
    const onDisk = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (onDisk !== rendered) {
      fail(`${store.config.markdown} is out of date or hand-edited — run \`goalpost generate\` to restore it`);
    }
    console.log(`${store.config.markdown} is in sync`);
    return 0;
  }

  store.writeMarkdown();
  console.log(`wrote ${store.config.markdown}`);
  return 0;
}
