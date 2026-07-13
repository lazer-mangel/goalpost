import { openStore, fail } from "../store.mjs";
import { parseArgs, asArray } from "../args.mjs";
import { findTask } from "../model.mjs";

export function run(argv) {
  const { flags, positional } = parseArgs(argv, []);
  const [id] = positional;
  if (!id) fail(`usage: goalpost add <id> --name ".." --criteria ".." --verify ".."`);
  const store = openStore();

  if (findTask(store.state, id)) fail(`task "${id}" already exists`);
  const name = flags.name;
  if (!name) fail("a task needs --name");
  const criteria = asArray(flags.criteria);
  if (criteria.length === 0) fail("a task needs at least one --criteria — no goal contract, no task");
  const verify = asArray(flags.verify);
  if (verify.length === 0) fail("a task needs at least one --verify command — without a loop exit, done is unprovable");

  const task = {
    id,
    name,
    ...(flags.milestone ? { milestone: flags.milestone } : {}),
    status: "todo",
    depends_on: asArray(flags.depends),
    ...(flags.spec ? { spec: flags.spec } : {}),
    success_criteria: criteria,
    verification: verify,
    ...(asArray(flags["write-scope"]).length ? { write_scope: asArray(flags["write-scope"]) } : {}),
    ...(flags.owner ? { owner: flags.owner } : {}),
    result: null,
    started_at: null,
    updated_at: null,
    waiting_on: null,
  };
  store.state.tasks.push(task);
  store.journal("task_added", id);
  store.save();
  console.log(`added ${id} — ${name}`);
  return 0;
}
