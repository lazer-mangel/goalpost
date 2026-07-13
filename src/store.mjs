import {
  existsSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
} from "node:fs";
import { join, dirname, resolve } from "node:path";
import { renderMarkdown } from "./render.mjs";

export class GoalpostError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

export function fail(message, exitCode = 1) {
  throw new GoalpostError(message, exitCode);
}

const CONFIG_DEFAULTS = {
  markdown: "ROADMAP.md",
  staleDays: 14,
  requireSpec: false,
  autoAdvance: false,
  compact: { keepRecent: 5, pin: [] },
  verification: { allowPrefixes: [] },
  agent: { command: null },
};

/** Walk upward from cwd looking for a .goalpost directory, like git finds .git. */
export function findGoalpostDir(cwd = process.cwd()) {
  if (process.env.GOALPOST_DIR) {
    const p = resolve(process.env.GOALPOST_DIR);
    return existsSync(p) ? p : null;
  }
  let dir = resolve(cwd);
  for (;;) {
    const candidate = join(dir, ".goalpost");
    if (existsSync(join(candidate, "goalpost.json"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function openStore(cwd = process.cwd()) {
  const dir = findGoalpostDir(cwd);
  if (!dir) {
    fail("no .goalpost directory found here or in any parent — run `goalpost init` to create one");
  }
  return new Store(dir);
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
}

export class Store {
  constructor(dir) {
    this.dir = dir;
    this.root = dirname(dir);
    const raw = readJson(join(dir, "config.json"), {});
    this.config = {
      ...CONFIG_DEFAULTS,
      ...raw,
      compact: { ...CONFIG_DEFAULTS.compact, ...(raw.compact ?? {}) },
      verification: { ...CONFIG_DEFAULTS.verification, ...(raw.verification ?? {}) },
      agent: { ...CONFIG_DEFAULTS.agent, ...(raw.agent ?? {}) },
    };
    this.state = readJson(join(dir, "goalpost.json"), null);
    if (!this.state) fail(`unreadable state: ${join(dir, "goalpost.json")}`);
  }

  reload() {
    this.state = readJson(join(this.dir, "goalpost.json"), null);
    return this.state;
  }

  loadArchive() {
    return readJson(join(this.dir, "archive.json"), { version: 1, tasks: [] });
  }

  saveArchive(archive) {
    writeFileSync(join(this.dir, "archive.json"), JSON.stringify(archive, null, 2) + "\n");
  }

  /** Persist state and regenerate the markdown snapshot — the single write path. */
  save() {
    writeFileSync(join(this.dir, "goalpost.json"), JSON.stringify(this.state, null, 2) + "\n");
    this.writeMarkdown();
  }

  markdownPath() {
    return join(this.root, this.config.markdown);
  }

  writeMarkdown() {
    const path = this.markdownPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, renderMarkdown(this.state, this.config));
  }

  journal(event, task, extra = {}) {
    const entry = { ts: new Date().toISOString(), event, ...(task ? { task } : {}), ...extra };
    appendFileSync(join(this.dir, "journal.jsonl"), JSON.stringify(entry) + "\n");
  }

  readJournal() {
    const path = join(this.dir, "journal.jsonl");
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  }

  specPath(task) {
    return task.spec ? join(this.dir, task.spec) : null;
  }

  specExists(task) {
    const p = this.specPath(task);
    return Boolean(p && existsSync(p));
  }

  readSpec(task) {
    return this.specExists(task) ? readFileSync(this.specPath(task), "utf8") : null;
  }
}
