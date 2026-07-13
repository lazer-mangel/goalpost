export function findTask(state, id) {
  return state.tasks.find((t) => t.id === id);
}

export function findMilestone(state, id) {
  return (state.milestones ?? []).find((m) => m.id === id);
}

export function isArchivedStub(task) {
  return Boolean(task.archived_body);
}

export function unmetDependencies(state, task) {
  return (task.depends_on ?? []).filter((id) => {
    const dep = findTask(state, id);
    return !dep || dep.status !== "done";
  });
}

/** First todo task, in array order, whose dependencies are all done. */
export function nextWorkable(state) {
  return state.tasks.find(
    (t) => t.status === "todo" && !isArchivedStub(t) && unmetDependencies(state, t).length === 0,
  );
}

export function currentTask(state) {
  return state.current ? findTask(state, state.current) : undefined;
}

export function openLanes(state) {
  return state.tasks.filter((t) => t.status === "in_progress" || t.status === "blocked");
}

export function doneNonStubs(state) {
  return state.tasks.filter((t) => t.status === "done" && !isArchivedStub(t));
}

export function byRecency(tasks) {
  return [...tasks].sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));
}

export function counts(state) {
  const c = { total: state.tasks.length, todo: 0, in_progress: 0, done: 0, blocked: 0 };
  for (const t of state.tasks) c[t.status] = (c[t.status] ?? 0) + 1;
  return c;
}
