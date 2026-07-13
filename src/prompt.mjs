/** Assemble the self-contained mission brief an agent needs to work one task. */
export function buildPrompt(store, task) {
  const lines = [];
  lines.push(`You are working one task from this repository's goalpost roadmap.`);
  lines.push("");
  lines.push(`# Task: ${task.name}`);
  lines.push(`id: ${task.id}`);
  lines.push("");
  lines.push("## Success criteria (the goal)");
  for (const c of task.success_criteria ?? []) lines.push(`- ${c}`);
  lines.push("");
  lines.push("## Verification (the loop exit — all must pass)");
  for (const v of task.verification ?? []) lines.push(`- \`${v}\``);
  lines.push("");
  if (task.write_scope?.length) {
    lines.push("## Write scope (only touch files matching these patterns)");
    for (const p of task.write_scope) lines.push(`- \`${p}\``);
    lines.push("");
  }
  const spec = store.readSpec(task);
  if (spec) {
    lines.push("## Spec");
    lines.push("");
    lines.push(spec.trimEnd());
    lines.push("");
  }
  lines.push("## Operating rules");
  lines.push(`- Close ONLY via \`goalpost done ${task.id} --result "<evidence>"\` — it runs the verification commands and refuses on red. Never claim completion in prose.`);
  lines.push(`- If you cannot proceed, run \`goalpost block ${task.id} --on "<what you need>"\` and stop.`);
  lines.push("- Never hand-edit .goalpost/goalpost.json, the archive, or the generated roadmap markdown; state moves only through the goalpost CLI.");
  lines.push("- Stop when the task is done or blocked; do not start other roadmap tasks.");
  return lines.join("\n") + "\n";
}
