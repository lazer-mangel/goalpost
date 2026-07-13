import { openStore } from "../store.mjs";
import { doneNonStubs, byRecency } from "../model.mjs";

const STUB_FIELDS = ["id", "name", "milestone", "status", "depends_on"];

export function run() {
  const store = openStore();
  const { keepRecent, pin } = store.config.compact;
  const pinned = new Set(pin);

  const candidates = byRecency(doneNonStubs(store.state)).filter((t) => !pinned.has(t.id));
  const toArchive = candidates.slice(keepRecent);
  if (toArchive.length === 0) {
    console.log("nothing to compact");
    return 0;
  }

  const archive = store.loadArchive();
  for (const t of toArchive) {
    const idx = archive.tasks.findIndex((a) => a.id === t.id);
    const body = { ...t };
    if (idx >= 0) archive.tasks[idx] = body;
    else archive.tasks.push(body);

    const stub = { archived_body: "archive.json" };
    for (const f of STUB_FIELDS) if (t[f] !== undefined) stub[f] = t[f];
    const pos = store.state.tasks.findIndex((x) => x.id === t.id);
    store.state.tasks[pos] = stub;
  }
  store.saveArchive(archive);
  store.journal("compacted", null, { archived: toArchive.map((t) => t.id) });
  store.save();
  console.log(`compacted ${toArchive.length} done task(s) into archive.json`);
  return 0;
}
