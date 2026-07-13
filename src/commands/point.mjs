import { openStore, fail } from "../store.mjs";
import { parseArgs } from "../args.mjs";
import { nextWorkable } from "../model.mjs";
import { mustFindTask, requirePointable } from "../transitions.mjs";

export function run(argv) {
  const { flags, positional } = parseArgs(argv, ["next"]);
  const store = openStore();
  let target;
  if (flags.next) {
    target = nextWorkable(store.state);
    if (!target) fail("no workable task to point at");
  } else {
    const [id] = positional;
    if (!id) fail("usage: goalpost point <id> | goalpost point --next");
    target = mustFindTask(store.state, id);
  }
  requirePointable(target);
  store.state.current = target.id;
  store.journal("pointed", target.id);
  store.save();
  console.log(`pointer → ${target.id} — ${target.name}`);
  return 0;
}
