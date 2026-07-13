import { openStore } from "../store.mjs";
import { parseArgs } from "../args.mjs";
import { currentTask, nextWorkable, openLanes, counts } from "../model.mjs";
import { livenessWarnings } from "../validate.mjs";

export function run(argv) {
  const { flags } = parseArgs(argv, ["brief", "json"]);
  const store = openStore();
  const state = store.state;
  const cur = currentTask(state);
  const next = nextWorkable(state);

  if (flags.json) {
    console.log(JSON.stringify({ current: cur ?? null, next: next ?? null, counts: counts(state) }, null, 2));
    return 0;
  }

  if (flags.brief) {
    const out = [];
    if (cur) {
      out.push(`[goalpost] goal: ${cur.id} — ${cur.name} (${cur.status})`);
      for (const c of (cur.success_criteria ?? []).slice(0, 3)) out.push(`[goalpost] criteria: ${c}`);
      for (const v of (cur.verification ?? []).slice(0, 3)) out.push(`[goalpost] exit: ${v}`);
      if (cur.status === "blocked") out.push(`[goalpost] waiting on: ${cur.waiting_on}`);
    } else if (next) {
      out.push(`[goalpost] no pointer — next workable: ${next.id} — ${next.name}`);
      out.push(`[goalpost] pick it up with: goalpost claim`);
    } else {
      out.push(`[goalpost] no pointer and no workable task`);
    }
    const warnings = livenessWarnings(state, store.config);
    for (const w of warnings.slice(0, 2)) out.push(`[goalpost] warn: ${w}`);
    out.push(`[goalpost] state moves via goalpost start/done/block/point — never by hand`);
    console.log(out.join("\n"));
    return 0;
  }

  const c = counts(state);
  console.log(`goalpost — ${c.done}/${c.total} done, ${c.in_progress} in progress, ${c.blocked} blocked, ${c.todo} todo`);
  if (cur) {
    console.log(`\npointer: ${cur.id} — ${cur.name} (${cur.status})`);
    for (const s of cur.success_criteria ?? []) console.log(`  goal: ${s}`);
    for (const v of cur.verification ?? []) console.log(`  exit: ${v}`);
  } else {
    console.log(`\npointer: none${next ? ` — next workable: ${next.id}` : ""}`);
  }
  const lanes = openLanes(state);
  if (lanes.length > 0) {
    console.log("\nopen lanes:");
    for (const t of lanes) {
      const suffix = t.status === "blocked" && t.waiting_on ? ` — waiting on: ${t.waiting_on}` : "";
      console.log(`  ${t.id} — ${t.name} (${t.status})${suffix}`);
    }
  }
  for (const w of livenessWarnings(state, store.config)) console.log(`warn: ${w}`);
  return 0;
}
