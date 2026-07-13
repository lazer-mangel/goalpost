import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { makeBareRepo } from "./helpers.mjs";

// ---------------------------------------------------------------------------
// init — scaffold
// ---------------------------------------------------------------------------

test("init scaffolds the full .goalpost/ layout plus ROADMAP.md", () => {
  const repo = makeBareRepo();
  const r = repo.run(["init", "--yes"]);
  assert.equal(r.code, 0);
  for (const p of [
    ".goalpost/goalpost.json",
    ".goalpost/config.json",
    ".goalpost/archive.json",
    ".goalpost/journal.jsonl",
    ".goalpost/templates/spec.md",
    "ROADMAP.md",
  ]) {
    assert.ok(repo.exists(p), `missing ${p}`);
  }
  assert.ok(repo.exists(".goalpost/specs"), "missing specs dir");
  const st = repo.readState();
  assert.equal(st.version, 1);
  // scaffolded state is immediately healthy
  assert.equal(repo.run(["check"]).code, 0);
});

test("init seeds a sample task that models a complete goal contract", () => {
  const repo = makeBareRepo();
  repo.run(["init", "--yes"]);
  const st = repo.readState();
  assert.equal(st.tasks.length, 1);
  const sample = st.tasks[0];
  assert.ok(sample.success_criteria.length >= 1);
  assert.ok(sample.verification.length >= 1);
});

test("init refuses to run twice", () => {
  const repo = makeBareRepo();
  assert.equal(repo.run(["init", "--yes"]).code, 0);
  const r = repo.run(["init", "--yes"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /exists/i);
});

// ---------------------------------------------------------------------------
// init --claude — settings merge, never clobbers
// ---------------------------------------------------------------------------

test("init --claude wires SessionStart, PreToolUse guard, and Stop hooks", () => {
  const repo = makeBareRepo();
  assert.equal(repo.run(["init", "--claude", "--yes"]).code, 0);
  const settings = JSON.parse(readFileSync(join(repo.root, ".claude", "settings.json"), "utf8"));
  const flat = JSON.stringify(settings);
  assert.ok(settings.hooks.SessionStart, "SessionStart hook missing");
  assert.match(flat, /status --brief/);
  assert.match(flat, /\|\| true/); // never blocks session start
  assert.ok(settings.hooks.PreToolUse, "PreToolUse guard missing");
  assert.match(flat, /goalpost guard/);
  assert.ok(settings.hooks.Stop, "Stop nudge missing");
});

test("init --claude merges into existing settings without clobbering", () => {
  const repo = makeBareRepo();
  repo.write(
    ".claude/settings.json",
    JSON.stringify({
      model: "opus",
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo preexisting" }] }] },
    }),
  );
  assert.equal(repo.run(["init", "--claude", "--yes"]).code, 0);
  const settings = JSON.parse(readFileSync(join(repo.root, ".claude", "settings.json"), "utf8"));
  assert.equal(settings.model, "opus"); // untouched
  const flat = JSON.stringify(settings);
  assert.match(flat, /echo preexisting/); // preserved
  assert.match(flat, /status --brief/); // added
});

test("init --claude is idempotent (no duplicate hooks on re-run)", () => {
  const repo = makeBareRepo();
  repo.run(["init", "--claude", "--yes"]);
  // simulate re-wiring on an already-initialized repo via integrate-only path
  const r = repo.run(["init", "--claude", "--yes"]);
  assert.equal(r.code, 1); // init refuses, so settings stay single-wired
  const flat = readFileSync(join(repo.root, ".claude", "settings.json"), "utf8");
  const count = flat.split("status --brief").length - 1;
  assert.equal(count, 1);
});

// ---------------------------------------------------------------------------
// init --agents-md — managed block
// ---------------------------------------------------------------------------

test("init --agents-md writes the managed block with the operating rules", () => {
  const repo = makeBareRepo();
  assert.equal(repo.run(["init", "--agents-md", "--yes"]).code, 0);
  const md = readFileSync(join(repo.root, "AGENTS.md"), "utf8");
  assert.match(md, /<!-- goalpost:start -->/);
  assert.match(md, /<!-- goalpost:end -->/);
  assert.match(md, /status --brief/);
  assert.match(md, /goalpost done/);
  assert.match(md, /never hand-edit/i);
});

test("init --agents-md preserves existing AGENTS.md content around the block", () => {
  const repo = makeBareRepo();
  repo.write("AGENTS.md", "# My project rules\n\nBe excellent.\n");
  repo.run(["init", "--agents-md", "--yes"]);
  const md = readFileSync(join(repo.root, "AGENTS.md"), "utf8");
  assert.match(md, /Be excellent\./);
  assert.match(md, /<!-- goalpost:start -->/);
});
