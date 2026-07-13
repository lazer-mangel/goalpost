import { openStore, fail } from "../store.mjs";
import { parseArgs } from "../args.mjs";
import { mustFindTask, nowIso } from "../transitions.mjs";
import { isArchivedStub } from "../model.mjs";

export function run(argv) {
  const { flags, positional } = parseArgs(argv, []);
  const [id] = positional;
  if (!id) fail(`usage: goalpost block <id> --on "reason"`);
  if (!flags.on || !String(flags.on).trim()) fail("block requires --on with what you are waiting on");
  const store = openStore();
  const task = mustFindTask(store.state, id);
  if (isArchivedStub(task)) fail(`task ${id} is archived`);
  if (task.status === "done") fail(`task ${id} is already done`);
  task.status = "blocked";
  task.waiting_on = String(flags.on);
  task.updated_at = nowIso();
  store.journal("blocked", id, { reason: task.waiting_on });
  store.save();
  console.log(`blocked ${id} — waiting on: ${task.waiting_on}`);
  return 0;
}
