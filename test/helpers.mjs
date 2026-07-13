import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "goalpost.mjs");

// A verification command that always passes / always fails, portable.
export const GREEN = `node -e "process.exit(0)"`;
export const RED = `node -e "process.exit(1)"`;

export function task(overrides = {}) {
  return {
    id: "t1",
    name: "Task one",
    status: "todo",
    depends_on: [],
    success_criteria: ["it works"],
    verification: [GREEN],
    result: null,
    started_at: null,
    updated_at: null,
    waiting_on: null,
    ...overrides,
  };
}

export function state(overrides = {}) {
  return {
    version: 1,
    current: null,
    milestones: [],
    tasks: [],
    ...overrides,
  };
}

/**
 * Create a throwaway repo with a seeded .goalpost/ directory.
 * Returns { root, dir, read*, run } where run(args) invokes the real CLI
 * with cwd = repo root.
 */
export function makeRepo({ state: st = state(), config = {}, specs = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "goalpost-test-"));
  const dir = join(root, ".goalpost");
  mkdirSync(join(dir, "specs"), { recursive: true });
  mkdirSync(join(dir, "templates"), { recursive: true });
  writeFileSync(join(dir, "goalpost.json"), JSON.stringify(st, null, 2) + "\n");
  writeFileSync(join(dir, "config.json"), JSON.stringify(config, null, 2) + "\n");
  writeFileSync(join(dir, "archive.json"), JSON.stringify({ version: 1, tasks: [] }, null, 2) + "\n");
  writeFileSync(join(dir, "journal.jsonl"), "");
  writeFileSync(
    join(dir, "templates", "spec.md"),
    "# Spec: {{name}}\n\n## Success criteria\n\n{{success_criteria}}\n\n## Test plan\n\n{{verification}}\n",
  );
  for (const [rel, content] of Object.entries(specs)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  return withAccessors(root, dir);
}

/** A bare directory with no .goalpost/ — for init and discovery tests. */
export function makeBareRepo() {
  const root = mkdtempSync(join(tmpdir(), "goalpost-bare-"));
  return withAccessors(root, join(root, ".goalpost"));
}

function withAccessors(root, dir) {
  const run = (args, opts = {}) => {
    const res = spawnSync(process.execPath, [CLI, ...args], {
      cwd: opts.cwd ?? root,
      env: { ...process.env, ...opts.env },
      input: opts.input,
      encoding: "utf8",
    });
    return { code: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
  };
  return {
    root,
    dir,
    run,
    readState: () => JSON.parse(readFileSync(join(dir, "goalpost.json"), "utf8")),
    readArchive: () => JSON.parse(readFileSync(join(dir, "archive.json"), "utf8")),
    readConfig: () => JSON.parse(readFileSync(join(dir, "config.json"), "utf8")),
    readJournal: () =>
      readFileSync(join(dir, "journal.jsonl"), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l)),
    readMarkdown: (name = "ROADMAP.md") => readFileSync(join(root, name), "utf8"),
    exists: (rel) => existsSync(join(root, rel)),
    write: (rel, content) => {
      const p = join(root, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
    },
    read: (rel) => readFileSync(join(root, rel), "utf8"),
  };
}

export function findTask(repo, id) {
  return repo.readState().tasks.find((t) => t.id === id);
}
