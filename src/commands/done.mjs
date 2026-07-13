import { execSync } from "node:child_process";
import { openStore, fail } from "../store.mjs";
import { parseArgs } from "../args.mjs";
import { isArchivedStub } from "../model.mjs";
import { requireDepsMet } from "../validate.mjs";
import { mustFindTask, nowIso, advancePointer } from "../transitions.mjs";

export function run(argv) {
  const { flags, positional } = parseArgs(argv, ["advance"]);
  const [id] = positional;
  if (!id) fail(`usage: goalpost done <id> --result "evidence"`);
  const store = openStore();
  const task = mustFindTask(store.state, id);
  if (isArchivedStub(task)) fail(`task ${id} is archived`);
  if (task.status === "done") fail(`task ${id} is already done`);

  const result = flags.result && String(flags.result).trim();
  if (!result) fail("done requires --result with evidence of what was verified — a bare claim is not closure");

  const depsProblem = requireDepsMet(store.state, task);
  if (depsProblem) fail(depsProblem);

  // The gate: run the task's own verification commands; refuse on the first red.
  for (const cmd of task.verification ?? []) {
    console.log(`verify: ${cmd}`);
    try {
      execSync(cmd, { cwd: store.root, stdio: "inherit" });
    } catch {
      store.journal("verification_failed", id, { command: cmd });
      fail(`verification failed: ${cmd}\ntask ${id} stays ${task.status} — fix it and run done again`);
    }
  }

  task.status = "done";
  task.result = result;
  task.updated_at = nowIso();
  task.waiting_on = null;
  store.journal("done", id, { result });

  if (flags.advance || store.config.autoAdvance) {
    const next = advancePointer(store);
    store.save();
    console.log(`done ${id} — ${task.name}`);
    console.log(next ? `pointer → ${next.id} — ${next.name}` : "no workable task left — pointer cleared");
  } else {
    // Don't leave the pointer aimed at a closed task.
    if (store.state.current === id) store.state.current = null;
    store.save();
    console.log(`done ${id} — ${task.name}`);
  }
  return 0;
}
