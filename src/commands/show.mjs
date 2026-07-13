import { openStore, fail } from "../store.mjs";
import { parseArgs } from "../args.mjs";
import { findTask, findMilestone, isArchivedStub } from "../model.mjs";

export function run(argv) {
  const { flags, positional } = parseArgs(argv, ["json", "spec"]);
  const [id] = positional;
  if (!id) fail("usage: goalpost show <id> [--json] [--spec]");
  const store = openStore();

  let task = findTask(store.state, id);
  if (!task) {
    const milestone = findMilestone(store.state, id);
    if (milestone) {
      const tasks = store.state.tasks.filter((t) => t.milestone === id);
      if (flags.json) console.log(JSON.stringify({ ...milestone, tasks }, null, 2));
      else {
        console.log(`milestone ${milestone.id} — ${milestone.name}`);
        for (const t of tasks) console.log(`  ${t.id} — ${t.name} (${t.status})`);
      }
      return 0;
    }
    fail(`unknown task or milestone "${id}"`);
  }

  // Resolve archived stubs transparently through the archive.
  if (isArchivedStub(task)) {
    const archived = store.loadArchive().tasks.find((t) => t.id === id);
    if (archived) task = { ...archived, archived_body: task.archived_body };
  }

  if (flags.json) {
    console.log(JSON.stringify(task, null, 2));
  } else {
    console.log(`${task.id} — ${task.name} (${task.status})`);
    if (task.milestone) console.log(`milestone: ${task.milestone}`);
    if (task.depends_on?.length) console.log(`depends on: ${task.depends_on.join(", ")}`);
    for (const c of task.success_criteria ?? []) console.log(`goal: ${c}`);
    for (const v of task.verification ?? []) console.log(`exit: ${v}`);
    if (task.write_scope?.length) console.log(`write scope: ${task.write_scope.join(", ")}`);
    if (task.spec) console.log(`spec: ${task.spec}`);
    if (task.waiting_on) console.log(`waiting on: ${task.waiting_on}`);
    if (task.result) console.log(`result: ${task.result}`);
  }

  if (flags.spec) {
    const spec = store.readSpec(task);
    if (!spec) fail(`task ${id} has no readable spec file`);
    console.log("");
    console.log(spec.trimEnd());
  }
  return 0;
}
