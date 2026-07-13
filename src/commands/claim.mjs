import { openStore } from "../store.mjs";
import { parseArgs } from "../args.mjs";
import { performClaim } from "../transitions.mjs";

export function run(argv) {
  const { flags, positional } = parseArgs(argv, ["json"]);
  const store = openStore();
  const task = performClaim(store, positional[0]);
  if (flags.json) {
    console.log(JSON.stringify(task, null, 2));
    return 0;
  }
  console.log(`claimed ${task.id} — ${task.name}`);
  for (const c of task.success_criteria ?? []) console.log(`  goal: ${c}`);
  for (const v of task.verification ?? []) console.log(`  exit: ${v}`);
  if (task.write_scope?.length) console.log(`  scope: ${task.write_scope.join(", ")}`);
  if (task.spec) console.log(`  spec: .goalpost/${task.spec}`);
  console.log(`close with: goalpost done ${task.id} --result "<evidence>"`);
  return 0;
}
