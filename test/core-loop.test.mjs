import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRepo, makeBareRepo, state, task, findTask, GREEN, RED } from "./helpers.mjs";

// ---------------------------------------------------------------------------
// status / next / show — the read surface
// ---------------------------------------------------------------------------

test("status shows the pointer task and open lanes", () => {
  const repo = makeRepo({
    state: state({
      current: "a",
      tasks: [
        task({ id: "a", name: "Alpha", status: "in_progress", started_at: "2026-07-10", updated_at: "2026-07-12" }),
        task({ id: "b", name: "Beta" }),
        task({ id: "c", name: "Gamma", status: "blocked", waiting_on: "vendor key" }),
      ],
    }),
  });
  const r = repo.run(["status"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /a/);
  assert.match(r.stdout, /Alpha/);
  assert.match(r.stdout, /in_progress/);
  assert.match(r.stdout, /vendor key/);
});

test("status --brief is a compact payload ending with the mutation rule", () => {
  const repo = makeRepo({
    state: state({
      current: "a",
      tasks: [task({ id: "a", name: "Alpha", status: "in_progress", verification: ["npm test -- alpha"] })],
    }),
  });
  const r = repo.run(["status", "--brief"]);
  assert.equal(r.code, 0);
  const lines = r.stdout.trim().split("\n");
  assert.ok(lines.length <= 14, `brief too long: ${lines.length} lines`);
  assert.ok(lines.every((l) => l.startsWith("[goalpost]")), "every brief line is [goalpost]-prefixed");
  assert.match(r.stdout, /Alpha/);
  assert.match(r.stdout, /npm test -- alpha/); // the loop-exit line
  assert.match(lines[lines.length - 1], /start\/done\/block\/point/);
  assert.match(lines[lines.length - 1], /never by hand/);
});

test("status --json returns machine-readable state", () => {
  const repo = makeRepo({ state: state({ current: "a", tasks: [task({ id: "a", status: "in_progress" })] }) });
  const r = repo.run(["status", "--json"]);
  assert.equal(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.current.id, "a");
});

test("status works from a nested subdirectory (upward discovery)", () => {
  const repo = makeRepo({ state: state({ current: "a", tasks: [task({ id: "a", status: "in_progress" })] }) });
  repo.write("src/deep/nested/file.txt", "x");
  const r = repo.run(["status"], { cwd: `${repo.root}/src/deep/nested` });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /a/);
});

test("status fails cleanly when no .goalpost exists anywhere up the tree", () => {
  const bare = makeBareRepo();
  const r = bare.run(["status"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /goalpost:/);
  assert.match(r.stderr, /init/); // points the user at goalpost init
});

test("next returns the first todo task whose deps are all done, in array order", () => {
  const repo = makeRepo({
    state: state({
      tasks: [
        task({ id: "a", status: "done", result: "shipped" }),
        task({ id: "b", depends_on: ["z"] }), // blocked by open dep
        task({ id: "c", depends_on: ["a"] }), // workable
        task({ id: "z" }), // workable but later in array than c
      ],
    }),
  });
  const r = repo.run(["next", "--json"]);
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.stdout).id, "c");
});

test("next reports when nothing is workable", () => {
  const repo = makeRepo({
    state: state({ tasks: [task({ id: "a", status: "done" }), task({ id: "b", status: "blocked", waiting_on: "x" })] }),
  });
  const r = repo.run(["next"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /no workable task/i);
});

test("show prints a task; --json round-trips; unknown id fails", () => {
  const repo = makeRepo({ state: state({ tasks: [task({ id: "a", name: "Alpha" })] }) });
  assert.match(repo.run(["show", "a"]).stdout, /Alpha/);
  assert.equal(JSON.parse(repo.run(["show", "a", "--json"]).stdout).id, "a");
  const r = repo.run(["show", "nope"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /nope/);
});

test("show --spec prints the linked spec file", () => {
  const repo = makeRepo({
    state: state({ tasks: [task({ id: "a", spec: "specs/a.md" })] }),
    specs: { "specs/a.md": "# Spec for A\ndetails here" },
  });
  const r = repo.run(["show", "a", "--spec"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /details here/);
});

// ---------------------------------------------------------------------------
// add — agents create goal contracts non-interactively
// ---------------------------------------------------------------------------

test("add creates a task with full goal contract and journals it", () => {
  const repo = makeRepo();
  const r = repo.run([
    "add", "auth-v1",
    "--name", "Session auth",
    "--criteria", "login works",
    "--criteria", "refresh works",
    "--verify", GREEN,
    "--depends", "db",
    "--milestone", "mvp",
    "--write-scope", "src/auth/**",
    "--owner", "agent",
  ]);
  assert.equal(r.code, 0);
  const t = findTask(repo, "auth-v1");
  assert.equal(t.name, "Session auth");
  assert.deepEqual(t.success_criteria, ["login works", "refresh works"]);
  assert.deepEqual(t.depends_on, ["db"]);
  assert.deepEqual(t.write_scope, ["src/auth/**"]);
  assert.equal(t.status, "todo");
  assert.ok(repo.readJournal().some((e) => e.event === "task_added" && e.task === "auth-v1"));
});

test("add refuses a task without criteria or without verification", () => {
  const repo = makeRepo();
  const noCriteria = repo.run(["add", "x", "--name", "X", "--verify", GREEN]);
  assert.equal(noCriteria.code, 1);
  assert.match(noCriteria.stderr, /criteri/i);
  const noVerify = repo.run(["add", "x", "--name", "X", "--criteria", "works"]);
  assert.equal(noVerify.code, 1);
  assert.match(noVerify.stderr, /verif/i);
});

test("add refuses duplicate ids", () => {
  const repo = makeRepo({ state: state({ tasks: [task({ id: "a" })] }) });
  const r = repo.run(["add", "a", "--name", "Again", "--criteria", "c", "--verify", GREEN]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /exists/i);
});

// ---------------------------------------------------------------------------
// start / block / point — state transitions
// ---------------------------------------------------------------------------

test("start moves todo → in_progress and stamps timestamps", () => {
  const repo = makeRepo({ state: state({ tasks: [task({ id: "a" })] }) });
  assert.equal(repo.run(["start", "a"]).code, 0);
  const t = findTask(repo, "a");
  assert.equal(t.status, "in_progress");
  assert.ok(t.started_at);
  assert.ok(t.updated_at);
  assert.ok(repo.readJournal().some((e) => e.event === "started" && e.task === "a"));
});

test("start refuses unmet dependencies and done tasks", () => {
  const repo = makeRepo({
    state: state({ tasks: [task({ id: "dep" }), task({ id: "a", depends_on: ["dep"] }), task({ id: "d", status: "done" })] }),
  });
  const unmet = repo.run(["start", "a"]);
  assert.equal(unmet.code, 1);
  assert.match(unmet.stderr, /dep/);
  assert.equal(repo.run(["start", "d"]).code, 1);
});

test("start unblocks a blocked task and clears waiting_on", () => {
  const repo = makeRepo({ state: state({ tasks: [task({ id: "a", status: "blocked", waiting_on: "key" })] }) });
  assert.equal(repo.run(["start", "a"]).code, 0);
  const t = findTask(repo, "a");
  assert.equal(t.status, "in_progress");
  assert.equal(t.waiting_on, null);
});

test("block requires a reason and sets waiting_on", () => {
  const repo = makeRepo({ state: state({ tasks: [task({ id: "a", status: "in_progress" })] }) });
  assert.equal(repo.run(["block", "a"]).code, 1); // no --on
  assert.equal(repo.run(["block", "a", "--on", "vendor key"]).code, 0);
  const t = findTask(repo, "a");
  assert.equal(t.status, "blocked");
  assert.equal(t.waiting_on, "vendor key");
});

test("point moves the pointer; refuses done and blocked targets", () => {
  const repo = makeRepo({
    state: state({
      current: null,
      tasks: [task({ id: "a" }), task({ id: "d", status: "done" }), task({ id: "b", status: "blocked", waiting_on: "x" })],
    }),
  });
  assert.equal(repo.run(["point", "a"]).code, 0);
  assert.equal(repo.readState().current, "a");
  assert.equal(repo.run(["point", "d"]).code, 1);
  assert.equal(repo.run(["point", "b"]).code, 1);
  assert.equal(repo.readState().current, "a"); // unchanged after refusals
});

test("point --next points at the next workable task", () => {
  const repo = makeRepo({
    state: state({ tasks: [task({ id: "a", status: "done" }), task({ id: "b", depends_on: ["a"] })] }),
  });
  assert.equal(repo.run(["point", "--next"]).code, 0);
  assert.equal(repo.readState().current, "b");
});

// ---------------------------------------------------------------------------
// done — the verification gate (the product)
// ---------------------------------------------------------------------------

test("done runs verification, requires evidence, closes green tasks", () => {
  const repo = makeRepo({
    state: state({ current: "a", tasks: [task({ id: "a", status: "in_progress", verification: [GREEN, GREEN] })] }),
  });
  const noEvidence = repo.run(["done", "a"]);
  assert.equal(noEvidence.code, 1);
  assert.match(noEvidence.stderr, /result/i);

  const r = repo.run(["done", "a", "--result", "tests green, verified login flow"]);
  assert.equal(r.code, 0);
  const t = findTask(repo, "a");
  assert.equal(t.status, "done");
  assert.equal(t.result, "tests green, verified login flow");
  assert.ok(repo.readJournal().some((e) => e.event === "done" && e.task === "a"));
});

test("done REFUSES on red verification and journals the failure", () => {
  const repo = makeRepo({
    state: state({ current: "a", tasks: [task({ id: "a", status: "in_progress", verification: [GREEN, RED] })] }),
  });
  const r = repo.run(["done", "a", "--result", "should not close"]);
  assert.equal(r.code, 1);
  const t = findTask(repo, "a");
  assert.equal(t.status, "in_progress"); // unchanged
  assert.equal(t.result, null);
  assert.ok(repo.readJournal().some((e) => e.event === "verification_failed" && e.task === "a"));
});

test("done refuses when dependencies are not done (deps checked before verification)", () => {
  const repo = makeRepo({
    state: state({ tasks: [task({ id: "dep" }), task({ id: "a", status: "in_progress", depends_on: ["dep"] })] }),
  });
  const r = repo.run(["done", "a", "--result", "evidence"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /dep/);
});

test("done --advance moves the pointer to the next workable task", () => {
  const repo = makeRepo({
    state: state({ current: "a", tasks: [task({ id: "a", status: "in_progress" }), task({ id: "b", depends_on: ["a"] })] }),
  });
  assert.equal(repo.run(["done", "a", "--result", "evidence", "--advance"]).code, 0);
  assert.equal(repo.readState().current, "b");
});

test("config autoAdvance makes done advance by default", () => {
  const repo = makeRepo({
    config: { autoAdvance: true },
    state: state({ current: "a", tasks: [task({ id: "a", status: "in_progress" }), task({ id: "b" })] }),
  });
  assert.equal(repo.run(["done", "a", "--result", "evidence"]).code, 0);
  assert.equal(repo.readState().current, "b");
});

test("done with autoAdvance still succeeds when nothing is left to point at", () => {
  const repo = makeRepo({
    config: { autoAdvance: true },
    state: state({ current: "a", tasks: [task({ id: "a", status: "in_progress" })] }),
  });
  const r = repo.run(["done", "a", "--result", "evidence"]);
  assert.equal(r.code, 0);
  assert.equal(findTask(repo, "a").status, "done");
});

test("verification commands run with cwd = repo root", () => {
  const repo = makeRepo({
    state: state({
      tasks: [
        task({
          id: "a",
          status: "in_progress",
          verification: [`node -e "process.exit(require('fs').existsSync('marker.txt') ? 0 : 1)"`],
        }),
      ],
    }),
  });
  repo.write("marker.txt", "x");
  repo.write("sub/dir/keep.txt", "x");
  const r = repo.run(["done", "a", "--result", "evidence"], { cwd: `${repo.root}/sub/dir` });
  assert.equal(r.code, 0);
});

// ---------------------------------------------------------------------------
// requireSpec grounding gate
// ---------------------------------------------------------------------------

test("requireSpec blocks start on a task without a spec file", () => {
  const repo = makeRepo({
    config: { requireSpec: true },
    state: state({ tasks: [task({ id: "a" }), task({ id: "b", spec: "specs/b.md" })] }),
    specs: { "specs/b.md": "# Spec" },
  });
  const r = repo.run(["start", "a"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /spec/i);
  assert.equal(repo.run(["start", "b"]).code, 0);
});

// ---------------------------------------------------------------------------
// every mutation regenerates the markdown snapshot
// ---------------------------------------------------------------------------

test("mutations keep ROADMAP.md in sync automatically", () => {
  const repo = makeRepo({ state: state({ tasks: [task({ id: "a", name: "Alpha task" })] }) });
  repo.run(["generate"]);
  repo.run(["add", "b", "--name", "Brand new thing", "--criteria", "c", "--verify", GREEN]);
  assert.match(repo.readMarkdown(), /Brand new thing/);
  repo.run(["start", "a"]);
  assert.match(repo.readMarkdown(), /in_progress/);
});
