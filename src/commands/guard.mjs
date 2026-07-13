import { readFileSync, realpathSync, existsSync } from "node:fs";
import { relative, resolve, join, dirname, basename, sep } from "node:path";
import { findGoalpostDir, Store } from "../store.mjs";
import { currentTask } from "../model.mjs";
import { matchesScope } from "../integrate.mjs";

// Runs as a Claude Code PreToolUse hook: exit 0 allows, exit 2 blocks
// (stderr is fed back to the agent). It must NEVER crash a hook chain,
// so every unknown situation resolves to allow.

function pathsFromStdin() {
  try {
    const raw = readFileSync(0, "utf8").trim();
    if (!raw) return [];
    const payload = JSON.parse(raw);
    const p = payload?.tool_input?.file_path ?? payload?.tool_input?.notebook_path;
    return p ? [p] : [];
  } catch {
    return [];
  }
}

export function run(argv) {
  const paths = argv.length > 0 ? argv : pathsFromStdin();
  if (paths.length === 0) return 0;

  const dir = findGoalpostDir();
  if (!dir) return 0;
  let store;
  try {
    store = new Store(dir);
  } catch {
    return 0;
  }

  // Canonicalize both sides — macOS tmp dirs are symlinked (/var → /private/var)
  // and hook payloads may use either form. The file itself may not exist yet,
  // so realpath the deepest existing ancestor and rejoin the remainder.
  const realAbs = (p) => {
    let cur = p;
    const suffix = [];
    while (!existsSync(cur)) {
      const parent = dirname(cur);
      if (parent === cur) break;
      suffix.unshift(basename(cur));
      cur = parent;
    }
    try {
      cur = realpathSync(cur);
    } catch {
      // keep as-is
    }
    return join(cur, ...suffix);
  };
  const realRoot = realAbs(store.root);
  const rels = paths.map((p) => relative(realRoot, realAbs(resolve(store.root, p))).split(sep).join("/"));

  // Machine-owned files are never hand-editable, regardless of scope.
  const protectedRels = new Set([
    ".goalpost/goalpost.json",
    ".goalpost/archive.json",
    ".goalpost/journal.jsonl",
    store.config.markdown.split(sep).join("/"),
  ]);
  for (const rel of rels) {
    if (protectedRels.has(rel)) {
      console.error(
        `goalpost guard: ${rel} is machine-owned — state moves only through the goalpost CLI (start/done/block/point), the roadmap markdown only through \`goalpost generate\``,
      );
      return 2;
    }
  }

  const cur = currentTask(store.state);
  if (!cur || cur.status !== "in_progress") return 0;
  const scope = cur.write_scope ?? [];
  if (scope.length === 0) return 0;

  for (const rel of rels) {
    if (rel.startsWith(".goalpost/")) continue; // specs, config, templates stay editable
    if (rel.startsWith("..")) {
      console.error(`goalpost guard: ${rel} is outside the repository`);
      return 2;
    }
    if (!matchesScope(rel, scope)) {
      console.error(
        `goalpost guard: ${rel} is outside task ${cur.id}'s write_scope (${scope.join(", ")}) — stay in scope or update the task's contract first`,
      );
      return 2;
    }
  }
  return 0;
}
