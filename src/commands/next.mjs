import { openStore, fail } from "../store.mjs";
import { parseArgs } from "../args.mjs";
import { nextWorkable } from "../model.mjs";

export function run(argv) {
  const { flags } = parseArgs(argv, ["json"]);
  const store = openStore();
  const next = nextWorkable(store.state);
  if (!next) fail("no workable task — every todo task has open dependencies or nothing is left");
  if (flags.json) {
    console.log(JSON.stringify(next, null, 2));
  } else {
    console.log(`${next.id} — ${next.name}`);
    for (const c of next.success_criteria ?? []) console.log(`  goal: ${c}`);
    for (const v of next.verification ?? []) console.log(`  exit: ${v}`);
    console.log(`pick it up with: goalpost claim ${next.id}`);
  }
  return 0;
}
