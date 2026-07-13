import { openStore, fail } from "../store.mjs";
import { parseArgs } from "../args.mjs";
import { mustFindTask, markStarted } from "../transitions.mjs";

export function run(argv) {
  const { positional } = parseArgs(argv, []);
  const [id] = positional;
  if (!id) fail("usage: goalpost start <id>");
  const store = openStore();
  const task = mustFindTask(store.state, id);
  markStarted(store, task);
  store.journal("started", id);
  store.save();
  console.log(`started ${id} — ${task.name}`);
  return 0;
}
