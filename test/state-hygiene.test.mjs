import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRepo, state, task, findTask, GREEN } from "./helpers.mjs";

// ---------------------------------------------------------------------------
// generate / check — the CI gates
// ---------------------------------------------------------------------------

test("generate writes a deterministic ROADMAP.md", () => {
  const repo = makeRepo({
    state: state({
      current: "b",
      milestones: [{ id: "mvp", name: "MVP launch" }],
      tasks: [
        task({ id: "a", name: "Alpha", status: "done", milestone: "mvp", result: "shipped" }),
        task({ id: "b", name: "Beta", status: "in_progress", milestone: "mvp" }),
      ],
    }),
  });
  assert.equal(repo.run(["generate"]).code, 0);
  const md = repo.readMarkdown();
  assert.match(md, /MVP launch/);
  assert.match(md, /Alpha/);
  assert.match(md, /Beta/);
  assert.match(md, /generated/i); // carries a do-not-hand-edit notice
  const first = repo.readMarkdown();
  repo.run(["generate"]);
  assert.equal(repo.readMarkdown(), first); // byte-identical on re-run
});

test("generate --check exits 1 when the markdown was hand-edited", () => {
  const repo = makeRepo({ state: state({ tasks: [task({ id: "a" })] }) });
  repo.run(["generate"]);
  assert.equal(repo.run(["generate", "--check"]).code, 0);
  repo.write("ROADMAP.md", repo.readMarkdown() + "\nsneaky hand edit\n");
  assert.equal(repo.run(["generate", "--check"]).code, 1);
});

test("config.markdown relocates the generated snapshot", () => {
  const repo = makeRepo({
    config: { markdown: "docs/PLAN.md" },
    state: state({ tasks: [task({ id: "a", name: "Alpha" })] }),
  });
  repo.run(["generate"]);
  assert.match(repo.readMarkdown("docs/PLAN.md"), /Alpha/);
});

test("check exits 1 on schema errors and names the offender", () => {
  const repo = makeRepo({
    state: state({ tasks: [{ id: "broken", name: "No contract", status: "todo", depends_on: [] }] }),
  });
  const r = repo.run(["check"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /broken/);
});

test("check catches pointer aimed at a done task", () => {
  const repo = makeRepo({ state: state({ current: "a", tasks: [task({ id: "a", status: "done", result: "x" })] }) });
  assert.equal(repo.run(["check"]).code, 1);
});

test("check catches unknown depends_on ids and dangling spec paths", () => {
  const badDep = makeRepo({ state: state({ tasks: [task({ id: "a", depends_on: ["ghost"] })] }) });
  assert.equal(badDep.run(["check"]).code, 1);
  const badSpec = makeRepo({ state: state({ tasks: [task({ id: "a", spec: "specs/missing.md" })] }) });
  assert.equal(badSpec.run(["check"]).code, 1);
});

test("liveness warnings exit 0 by default, 1 under --strict", () => {
  const repo = makeRepo({
    state: state({
      current: "a",
      tasks: [task({ id: "a", status: "in_progress", started_at: "2020-01-01", updated_at: "2020-01-01" })],
    }),
  });
  repo.run(["generate"]);
  const soft = repo.run(["check"]);
  assert.equal(soft.code, 0);
  assert.match(soft.stdout + soft.stderr, /stale/i);
  assert.equal(repo.run(["check", "--strict"]).code, 1);
});

test("check exits 1 when the markdown snapshot is out of date", () => {
  const repo = makeRepo({ state: state({ tasks: [task({ id: "a" })] }) });
  repo.run(["generate"]);
  repo.write("ROADMAP.md", "# stale\n");
  assert.equal(repo.run(["check"]).code, 1);
});

test("check passes on a healthy repo", () => {
  const repo = makeRepo({
    state: state({ current: "a", tasks: [task({ id: "a", status: "in_progress", started_at: "2026-07-12", updated_at: "2026-07-13" })] }),
  });
  repo.run(["generate"]);
  assert.equal(repo.run(["check"]).code, 0);
});

// ---------------------------------------------------------------------------
// compact / archive
// ---------------------------------------------------------------------------

function doneTask(id, updated_at) {
  return task({ id, status: "done", result: `${id} shipped`, started_at: updated_at, updated_at });
}

test("compact archives old done bodies, keeps recent ones and pinned ids", () => {
  const repo = makeRepo({
    config: { compact: { keepRecent: 1, pin: ["keep-me"] } },
    state: state({
      tasks: [
        doneTask("old-1", "2026-01-01"),
        doneTask("keep-me", "2026-01-02"),
        doneTask("old-2", "2026-02-01"),
        doneTask("recent", "2026-07-01"),
        task({ id: "open" }),
      ],
    }),
  });
  assert.equal(repo.run(["compact"]).code, 0);
  const st = repo.readState();
  const byId = Object.fromEntries(st.tasks.map((t) => [t.id, t]));
  // stubs: old-1, old-2. kept whole: keep-me (pinned), recent (keepRecent=1), open (not done)
  assert.ok(byId["old-1"].archived_body);
  assert.equal(byId["old-1"].result, undefined);
  assert.ok(byId["old-2"].archived_body);
  assert.equal(byId["keep-me"].result, "keep-me shipped");
  assert.equal(byId["recent"].result, "recent shipped");
  assert.equal(byId["open"].status, "todo");
  const archived = repo.readArchive().tasks.map((t) => t.id).sort();
  assert.deepEqual(archived, ["old-1", "old-2"]);
});

test("show resolves archived stubs transparently through archive.json", () => {
  const repo = makeRepo({
    config: { compact: { keepRecent: 0 } },
    state: state({ tasks: [doneTask("ancient", "2026-01-01")] }),
  });
  repo.run(["compact"]);
  const r = repo.run(["show", "ancient"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /ancient shipped/); // full body, from the archive
});

test("compact is idempotent", () => {
  const repo = makeRepo({
    config: { compact: { keepRecent: 0 } },
    state: state({ tasks: [doneTask("a", "2026-01-01")] }),
  });
  repo.run(["compact"]);
  const once = JSON.stringify(repo.readState()) + JSON.stringify(repo.readArchive());
  assert.equal(repo.run(["compact"]).code, 0);
  const twice = JSON.stringify(repo.readState()) + JSON.stringify(repo.readArchive());
  assert.equal(once, twice);
});

test("archived stubs cannot be started", () => {
  const repo = makeRepo({
    config: { compact: { keepRecent: 0 } },
    state: state({ tasks: [doneTask("a", "2026-01-01")] }),
  });
  repo.run(["compact"]);
  assert.equal(repo.run(["start", "a"]).code, 1);
});

// ---------------------------------------------------------------------------
// journal — append-only, every mutation leaves a trace
// ---------------------------------------------------------------------------

test("the journal records the full life of a task in order", () => {
  const repo = makeRepo();
  repo.run(["add", "a", "--name", "Alpha", "--criteria", "works", "--verify", GREEN]);
  repo.run(["point", "a"]);
  repo.run(["start", "a"]);
  repo.run(["block", "a", "--on", "waiting"]);
  repo.run(["start", "a"]);
  repo.run(["done", "a", "--result", "evidence"]);
  const events = repo.readJournal().map((e) => e.event);
  assert.deepEqual(events, ["task_added", "pointed", "started", "blocked", "started", "done"]);
  assert.ok(repo.readJournal().every((e) => e.ts), "every event is timestamped");
});
