import { openStore, fail } from "../store.mjs";
import { parseArgs } from "../args.mjs";
import { currentTask, nextWorkable } from "../model.mjs";
import { mustFindTask } from "../transitions.mjs";
import { buildPrompt } from "../prompt.mjs";

export function resolvePromptTask(store, id) {
  if (id) return mustFindTask(store.state, id);
  const cur = currentTask(store.state);
  if (cur && (cur.status === "in_progress" || cur.status === "todo")) return cur;
  const next = nextWorkable(store.state);
  if (!next) fail("no task to build a prompt for — nothing pointed and no workable task");
  return next;
}

export function run(argv) {
  const { positional } = parseArgs(argv, []);
  const store = openStore();
  const task = resolvePromptTask(store, positional[0]);
  process.stdout.write(buildPrompt(store, task));
  return 0;
}
