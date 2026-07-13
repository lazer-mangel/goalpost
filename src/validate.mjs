import { findTask, findMilestone, isArchivedStub, unmetDependencies, nextWorkable } from "./model.mjs";

const STATUSES = new Set(["todo", "in_progress", "done", "blocked"]);

/** Structural problems. Non-empty result means the roadmap is unusable — exit 1. */
export function validateState(state, store) {
  const errors = [];
  if (state.version !== 1) errors.push(`unsupported state version: ${state.version}`);
  if (!Array.isArray(state.tasks)) return [...errors, "tasks must be an array"];

  const seen = new Set();
  for (const t of state.tasks) {
    const at = `task ${t.id ?? "<missing id>"}`;
    if (!t.id || typeof t.id !== "string") errors.push(`${at}: id is required`);
    if (seen.has(t.id)) errors.push(`${at}: duplicate id`);
    seen.add(t.id);
    if (!t.name || typeof t.name !== "string") errors.push(`${at}: name is required`);
    if (!STATUSES.has(t.status)) errors.push(`${at}: invalid status "${t.status}"`);
    if (!Array.isArray(t.depends_on)) errors.push(`${at}: depends_on must be an array`);

    if (!isArchivedStub(t)) {
      if (!Array.isArray(t.success_criteria) || t.success_criteria.length === 0) {
        errors.push(`${at}: success_criteria must be a non-empty array`);
      }
      if (!Array.isArray(t.verification) || t.verification.length === 0) {
        errors.push(`${at}: verification must be a non-empty array`);
      }
      if (t.spec && store && !store.specExists(t)) {
        errors.push(`${at}: spec file not found: ${t.spec}`);
      }
    }
    if (t.milestone && !findMilestone(state, t.milestone)) {
      errors.push(`${at}: unknown milestone "${t.milestone}"`);
    }
  }

  for (const t of state.tasks) {
    for (const dep of t.depends_on ?? []) {
      if (!findTask(state, dep)) errors.push(`task ${t.id}: unknown dependency "${dep}"`);
    }
  }

  if (state.current) {
    const cur = findTask(state, state.current);
    if (!cur) errors.push(`current points at unknown task "${state.current}"`);
    else if (cur.status === "done" || cur.status === "blocked") {
      errors.push(`current points at a ${cur.status} task "${state.current}" — repoint with \`goalpost point\``);
    }
  }

  return errors;
}

/** Soft signals the roadmap is going stale. Exit 0 unless --strict. */
export function livenessWarnings(state, config, now = new Date()) {
  const warnings = [];
  const staleMs = config.staleDays * 24 * 60 * 60 * 1000;

  for (const t of state.tasks) {
    if (t.status !== "in_progress") continue;
    const last = t.updated_at ?? t.started_at;
    if (!last) {
      warnings.push(`task ${t.id}: in_progress with no timestamps`);
    } else if (now - new Date(last) > staleMs) {
      warnings.push(`task ${t.id}: stale — in_progress with no update in over ${config.staleDays} days`);
    }
  }

  const hasLiveWork = state.tasks.some((t) => t.status === "in_progress");
  if (!hasLiveWork && !state.current) {
    const next = nextWorkable(state);
    if (next) warnings.push(`task ${next.id}: ready but idle — nothing is pointed or in progress`);
  }

  const blocked = state.tasks.filter((t) => t.status === "blocked" && !t.waiting_on);
  for (const t of blocked) warnings.push(`task ${t.id}: blocked without a waiting_on reason`);

  return warnings;
}

/** Deps that would make `done`/`start` refuse — shared refusal message. */
export function requireDepsMet(state, task) {
  const unmet = unmetDependencies(state, task);
  if (unmet.length > 0) {
    return `task ${task.id} has unmet dependencies: ${unmet.join(", ")}`;
  }
  return null;
}
