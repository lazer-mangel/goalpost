import { fail } from "./store.mjs";
import { findTask, isArchivedStub, nextWorkable, currentTask } from "./model.mjs";
import { requireDepsMet } from "./validate.mjs";

export function nowIso() {
  return new Date().toISOString();
}

export function mustFindTask(state, id) {
  const t = findTask(state, id);
  if (!t) fail(`unknown task "${id}"`);
  return t;
}

export function requireStartable(store, task) {
  if (isArchivedStub(task)) fail(`task ${task.id} is archived — it cannot be started`);
  if (task.status === "done") fail(`task ${task.id} is already done`);
  const depsProblem = requireDepsMet(store.state, task);
  if (depsProblem) fail(depsProblem);
  if (store.config.requireSpec && !store.specExists(task)) {
    fail(`task ${task.id} has no spec file and requireSpec is enabled — scaffold one with \`goalpost spec ${task.id}\``);
  }
}

/** todo/blocked → in_progress. Shared by start and claim. */
export function markStarted(store, task) {
  requireStartable(store, task);
  task.status = "in_progress";
  task.started_at = task.started_at ?? nowIso();
  task.updated_at = nowIso();
  task.waiting_on = null;
}

export function requirePointable(task) {
  if (task.status === "done") fail(`task ${task.id} is done — point at open work instead`);
  if (task.status === "blocked") fail(`task ${task.id} is blocked (${task.waiting_on ?? "no reason"}) — unblock it first`);
  if (isArchivedStub(task)) fail(`task ${task.id} is archived`);
}

/**
 * The atomic "go" verb: resolve target (explicit id or next workable),
 * refuse while the pointer task is still in_progress, then point + start.
 */
export function performClaim(store, id) {
  const cur = currentTask(store.state);
  if (cur && cur.status === "in_progress" && cur.id !== id) {
    fail(`task ${cur.id} is still in_progress at the pointer — finish it with \`goalpost done\` or park it with \`goalpost block\` first`);
  }
  const target = id ? mustFindTask(store.state, id) : nextWorkable(store.state);
  if (!target) fail("no workable task — every todo task is blocked by open dependencies or nothing is left");
  requirePointable(target);
  markStarted(store, target);
  store.state.current = target.id;
  store.journal("claimed", target.id);
  store.save();
  return target;
}

/** Advance the pointer to the next workable task, or clear it. Used by done --advance. */
export function advancePointer(store) {
  const next = nextWorkable(store.state);
  store.state.current = next ? next.id : null;
  if (next) store.journal("pointed", next.id, { via: "advance" });
  return next;
}
