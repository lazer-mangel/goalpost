import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openStore, fail } from "../store.mjs";
import { parseArgs } from "../args.mjs";
import { mustFindTask } from "../transitions.mjs";

const BUNDLED_TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "spec-template.md");

export function run(argv) {
  const { positional } = parseArgs(argv, ["open"]);
  const [id] = positional;
  if (!id) fail("usage: goalpost spec <id>");
  const store = openStore();
  const task = mustFindTask(store.state, id);

  const rel = task.spec ?? `specs/${id}.md`;
  const path = join(store.dir, rel);
  if (existsSync(path)) fail(`spec already exists: ${rel} — edit it directly`);

  const templatePath = join(store.dir, "templates", "spec.md");
  const template = readFileSync(existsSync(templatePath) ? templatePath : BUNDLED_TEMPLATE, "utf8");
  const filled = template
    .replaceAll("{{id}}", task.id)
    .replaceAll("{{name}}", task.name)
    .replaceAll("{{success_criteria}}", (task.success_criteria ?? []).map((c) => `- ${c}`).join("\n"))
    .replaceAll("{{verification}}", (task.verification ?? []).map((v) => `- \`${v}\``).join("\n"));

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, filled);
  task.spec = rel;
  store.journal("spec_created", id, { spec: rel });
  store.save();
  console.log(`spec scaffolded: .goalpost/${rel} — fill it in before starting the task`);
  return 0;
}
